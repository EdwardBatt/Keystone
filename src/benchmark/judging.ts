import { readdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compare, serialize, type Diagnostic } from '../core.js';
import { readJson, schemaDiagnostics, sha256, specificationDirectory, type InspectionTerms, type Judge, type LoadedPlan } from './specs.js';
import { patch, snapshots } from './git.js';
import { BoundaryError, evidenceHash, guard, guardTree, readJsonFile, sealRecord, writeVerified, type Boundary, type StoredRecord } from './store.js';
import { open, runPaths, type Context, type Result } from './prepare.js';

/** Version 2 judging (TASK-0015 items 3 and 8): judges declared in the plan, judgements preserved
 * per judge, a seeded audit sample, symmetric packet inspection, and the owner's recorded release.
 */

/** The generic default term list ships with the harness; it names Keystone identifiers only. */
export const defaultTerms: InspectionTerms = JSON.parse(readFileSync(new URL('inspection/keystone-terms.json', specificationDirectory), 'utf8'));

interface Matcher { id: string; expression: RegExp }
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function matchers(lists: InspectionTerms[]): Matcher[] {
  return lists.flatMap(list => list.terms.map(t => ({ id: t.id, expression: new RegExp(t.pattern ?? escape(t.literal!), 'gi') })));
}

export interface Hit { item: string; file: string; line: number; term: string; excerpt: string }

/** Applies every term to every line with one fixed replacement: the same rule for every run,
 * whatever its condition. Bytes are handled as latin1 so binary patch content round-trips.
 */
export function redact(bytes: Buffer, item: string, file: string, terms: Matcher[], replacement: string): { bytes: Buffer; hits: Hit[] } {
  const hits: Hit[] = [];
  const lines = bytes.toString('latin1').split('\n');
  const out = lines.map((line, i) => {
    let current = line;
    for (const term of terms) {
      term.expression.lastIndex = 0;
      if (!term.expression.test(current)) continue;
      hits.push({ item, file, line: i + 1, term: term.id, excerpt: current.slice(0, 200) });
      term.expression.lastIndex = 0;
      current = current.replace(term.expression, replacement);
    }
    return current;
  });
  return { bytes: Buffer.from(out.join('\n'), 'latin1'), hits };
}

/** The owner-audit sample: per task stratum, blinded IDs in ascending SHA-256(seed:blind ID) order,
 * ⌈fraction × stratum size⌉ of them. Computed from blinded IDs only, before any import.
 */
export function auditSample(items: { blind_id: string; task: string }[], audit: { fraction: number; seed: number }): string[] {
  const strata = new Map<string, string[]>();
  for (const item of items) strata.set(item.task, [...(strata.get(item.task) ?? []), item.blind_id]);
  const sample: string[] = [];
  for (const [, ids] of [...strata.entries()].sort(([a], [b]) => compare(a, b))) {
    const ordered = [...ids].sort((a, b) => compare(sha256(`${audit.seed}:${a}`), sha256(`${audit.seed}:${b}`)));
    sample.push(...ordered.slice(0, Math.ceil(audit.fraction * ids.length - 1e-9)));
  }
  return sample.sort(compare);
}

const packetsDirectory = (context: Context) => path.join(context.where.work, 'judging', 'packets');
/** Kept in the work directory so `release` can verify a packet. It is mutable, so nothing is taken
 * from it on trust: `release` uses only its packet and audit texts, after checking their hashes.
 */
interface PacketManifest { kind: 'keystone-bench-packet-manifest'; plan: { id: string; hash: string }; packet_hash: string; packet_text: string; audit_text: string }
/** What a sealed release record binds: the released items and the audit sample (C5; finding 5). */
interface Released { packet_hash: string; items: { blind_id: string; task: string }[]; audit: string[] }

/** Version 2 export: patches and statements are scanned and redacted before any packet file is written. */
export async function exportPacket2(context: Context, records: StoredRecord[], target: string, boundary: Boundary, secret: string, blindId: (secret: string, run: string) => string): Promise<Diagnostic[]> {
  const { plan, where } = context;
  const judging = plan.spec.judging!;
  const terms = matchers([defaultTerms, ...plan.terms]);
  const replacement = judging.inspection?.replacement ?? '[REDACTED]';
  const files: [string, Buffer][] = [];
  const hits: Hit[] = [];
  const items: { blind_id: string; task: string; statement: string; patch: string }[] = [];
  for (const task of plan.tasks) {
    const statement = redact(await readFile(path.join(task.directory, ...task.spec.statement.split('/'))), `tasks/${task.spec.id}.md`, 'statement', terms, replacement);
    hits.push(...statement.hits);
    files.push([path.join(target, 'tasks', `${task.spec.id}.md`), statement.bytes]);
  }
  for (const { record } of records.filter(r => r.record.status === 'completed')) {
    const { setup_tree, final_tree } = record.evidence ?? {};
    if (!setup_tree || !final_tree) return [{ code: 'BENCH_JUDGING_EVIDENCE_MISSING', path: record.run_id, message: 'The record names no evidence trees.' }];
    const id = blindId(secret, record.run_id);
    const store = snapshots(runPaths(where, record.run_id).harness);
    try { await guardTree(where.boundaries.work, store.gitDir); } catch (error) { if (error instanceof BoundaryError) return [error.diagnostic]; throw error; }
    let change: Buffer;
    try { change = await patch(store, setup_tree, final_tree, judging.exclude ?? []); } catch {
      return [{ code: 'BENCH_JUDGING_EVIDENCE_MISSING', path: record.run_id, message: 'The record’s evidence trees are not available in this work directory.' }];
    }
    const redacted = redact(change, id, 'patch', terms, replacement);
    hits.push(...redacted.hits);
    files.push([path.join(target, `${id}.patch`), redacted.bytes]);
    items.push({ blind_id: id, task: record.provenance.task.id, statement: `tasks/${record.provenance.task.id}.md`, patch: `${id}.patch` });
  }
  items.sort((a, b) => compare(a.blind_id, b.blind_id));
  const audit = judging.audit ? auditSample(items, judging.audit) : [];
  // The inspection log holds subject content, so it stays in the work directory; only its hash travels.
  const log = serialize({ kind: 'keystone-bench-inspection-log', plan: { id: plan.spec.id, hash: plan.hash }, replacement, hits });
  const logHash = sha256(log);
  const logFailure = await writeVerified(path.join(where.work, 'judging', 'inspection', `${logHash.slice(0, 16)}.json`), log, where.boundaries.work);
  if (logFailure) return logFailure.diagnostics;
  const termsHash = sha256(serialize([defaultTerms, ...plan.terms]));
  // Collision-safe counts: a term ID such as "constructor" is an ordinary key.
  const counts = new Map<string, number>();
  for (const hit of hits) counts.set(hit.term, (counts.get(hit.term) ?? 0) + 1);
  const auditFile = serialize({ kind: 'keystone-bench-audit-sample', judge: judging.audit?.judge ?? null, items: audit });
  const packet = serialize({
    kind: 'keystone-bench-judging-packet', schema_version: 2, plan: { id: plan.spec.id, hash: plan.hash }, procedure: judging.procedure, items,
    audit: { file: 'audit.json', hash: sha256(auditFile) },
    inspection: { terms_hash: termsHash, replacement, log_hash: logHash, hits: Object.fromEntries([...counts.entries()].sort(([a], [b]) => compare(a, b))) },
  });
  const put = async (file: string, data: string | Buffer) => {
    const failure = await writeVerified(file, data, boundary);
    if (failure) throw new BoundaryError(failure.diagnostics[0]);
  };
  for (const [file, data] of files) await put(file, data);
  await put(path.join(target, 'audit.json'), auditFile);
  await put(path.join(target, 'packet.json'), packet);
  const packetHash = sha256(packet);
  const manifest: PacketManifest = { kind: 'keystone-bench-packet-manifest', plan: { id: plan.spec.id, hash: plan.hash }, packet_hash: packetHash, packet_text: packet, audit_text: auditFile };
  const kept = await writeVerified(path.join(packetsDirectory(context), `${packetHash}.json`), serialize(manifest), where.boundaries.work);
  return kept?.diagnostics ?? [];
}

const releaseDirectory = (context: Context) => path.join(context.where.results, 'judging');

/** Packets the owner released after reviewing their inspection logs (C5). Item and audit membership
 * come only from sealed release records, never from the mutable work-directory manifest, and the
 * audit sample is recomputed from the plan's declared rule.
 */
async function releasedPackets(context: Context): Promise<Released[]> {
  let names: string[] = [];
  try { names = (await readdir(releaseDirectory(context))).filter(n => n.startsWith('release-') && n.endsWith('.json')).sort(compare); } catch { return []; }
  const released: Released[] = [];
  const audit = context.plan.spec.judging?.audit;
  for (const name of names) {
    const record = await readJsonFile<Record<string, any>>(path.join(releaseDirectory(context), name));
    if (!record || record.kind !== 'keystone-bench-packet-release-record' || record.evidence_hash !== evidenceHash(record) || record.plan?.hash !== context.plan.hash) continue;
    if (!Array.isArray(record.items) || !Array.isArray(record.audit)) continue;
    const expected = audit ? auditSample(record.items, audit) : [];
    if (serialize(expected) !== serialize(record.audit)) continue;
    released.push({ packet_hash: record.packet_hash, items: record.items, audit: record.audit });
  }
  return released;
}

export interface Judgement2 { run_id: string; judge: string; role: 'vendor' | 'audit'; verdict: string; blocking: number; non_blocking: number; condition_guess: string | null }

/** Version 2 judgement records, keyed by run and judge. A second judgement by one judge for one run is refused. */
export async function loadJudgements2(context: Context): Promise<{ judgements: Map<string, Map<string, Judgement2>>; refused: Diagnostic[] }> {
  const directory = path.join(context.where.results, 'judgements');
  const judgements = new Map<string, Map<string, Judgement2>>();
  const refused: Diagnostic[] = [];
  let names: string[] = [];
  try { names = (await readdir(directory)).filter(n => n.endsWith('.json')).sort(compare); } catch { /* None imported. */ }
  for (const name of names) {
    const record = await readJsonFile<Record<string, any>>(path.join(directory, name));
    const label = `judgements/${name}`;
    if (!record || record.kind !== 'keystone-bench-judgement-record' || record.schema_version !== 2 || record.evidence_hash !== evidenceHash(record)) { refused.push({ code: 'BENCH_RESULT_EVIDENCE_MISMATCH', path: label, message: 'Judgement record is unreadable or does not match its evidence hash.' }); continue; }
    if (record.plan?.hash !== context.plan.hash) { refused.push({ code: 'BENCH_PLAN_MISMATCH', path: label, message: 'Judgement record was made under different plan content.' }); continue; }
    for (const j of record.judgements as Judgement2[]) {
      const byJudge = judgements.get(j.run_id) ?? new Map<string, Judgement2>();
      if (byJudge.has(j.judge)) { refused.push({ code: 'BENCH_JUDGEMENT_DUPLICATE', path: label, message: 'A judge has already judged this run; each judge judges a run once.' }); continue; }
      byJudge.set(j.judge, j);
      judgements.set(j.run_id, byJudge);
    }
  }
  return { judgements, refused };
}

/** Version 2 import: the declared judge, its rubric and prompt provenance, a released packet, the
 * audit sample for audit-role judges, and one judgement per run and judge.
 */
export async function importJudgements2(context: Context, records: StoredRecord[], file: string, secret: string, blindId: (secret: string, run: string) => string): Promise<Diagnostic[]> {
  const { plan } = context;
  const label = path.basename(file);
  const { data, diagnostics } = await readJson(path.resolve(file), label);
  if (diagnostics.length) return diagnostics.map(d => ({ ...d, code: 'BENCH_JUDGEMENTS_INVALID' }));
  if ((data as { schema_version?: unknown })?.schema_version !== 2) return [{ code: 'BENCH_JUDGEMENTS_INVALID', path: label, message: 'A version 2 plan imports version 2 judgements.' }];
  const schema = schemaDiagnostics('judgements', data, label, 'BENCH_JUDGEMENTS_INVALID');
  if (schema.length) return schema;
  const input = data as { plan: { id: string; hash: string }; attestation: { judge: string; procedure: string; date: string; statement: string; rubric: { commit: string; hash: string }; prompt_hash: string }; judgements: { blind_id: string; verdict: string; blocking: number; non_blocking: number; condition_guess?: string | null }[] };
  if (input.plan.id !== plan.spec.id || input.plan.hash !== plan.hash) return [{ code: 'BENCH_PLAN_MISMATCH', path: label, message: 'The judgements were made for different plan content.' }];
  const judge = plan.spec.judging?.judges?.find(j => j.id === input.attestation.judge);
  if (!judge) return [{ code: 'BENCH_JUDGEMENT_PROVENANCE_INVALID', path: label, field: '/attestation/judge', message: `${input.attestation.judge} is not a judge declared by the plan.` }];
  const pinned = plan.judging!;
  if (input.attestation.rubric.commit !== pinned.rubric.commit || input.attestation.rubric.hash !== pinned.rubric.hash || input.attestation.prompt_hash !== pinned.prompt.hash) {
    return [{ code: 'BENCH_JUDGEMENT_PROVENANCE_INVALID', path: label, field: '/attestation', message: 'The rubric commit and hash and the judge-prompt hash must equal those the plan pins.' }];
  }
  const released = await releasedPackets(context);
  if (!released.length) return [{ code: 'BENCH_PACKET_NOT_RELEASED', path: label, message: 'No judging packet of this plan has a recorded owner release; record the release before importing judgements.' }];
  const releasedIds = new Set(released.flatMap(m => m.items.map(i => i.blind_id)));
  const sampled = new Set(released.flatMap(m => m.audit));
  const byBlind = new Map(records.map(r => [blindId(secret, r.record.run_id), r.record.run_id as string]));
  const conditions = plan.conditions.map(c => c.spec.id);
  const existing = await loadJudgements2(context);
  const seen = new Set<string>();
  const out: Judgement2[] = [];
  const problems: Diagnostic[] = [];
  for (const j of input.judgements) {
    const run = byBlind.get(j.blind_id);
    if (!run) { problems.push({ code: 'BENCH_JUDGEMENT_UNKNOWN', path: label, message: `${j.blind_id} is not a blinded run of this plan.` }); continue; }
    if (!releasedIds.has(j.blind_id)) { problems.push({ code: 'BENCH_PACKET_NOT_RELEASED', path: label, message: `${j.blind_id} is in no released packet.` }); continue; }
    if (judge.role === 'audit' && !sampled.has(j.blind_id)) { problems.push({ code: 'BENCH_JUDGEMENT_NOT_SAMPLED', path: label, message: `${j.blind_id} is outside the audit sample.` }); continue; }
    if (j.condition_guess != null && !conditions.includes(j.condition_guess)) { problems.push({ code: 'BENCH_JUDGEMENTS_INVALID', path: label, message: `${j.condition_guess} is not a condition of the plan.` }); continue; }
    if (seen.has(run) || existing.judgements.get(run)?.has(judge.id)) { problems.push({ code: 'BENCH_JUDGEMENT_DUPLICATE', path: label, message: `${j.blind_id} is already judged by ${judge.id}.` }); continue; }
    seen.add(run);
    out.push({ run_id: run, judge: judge.id, role: judge.role, verdict: j.verdict, blocking: j.blocking, non_blocking: j.non_blocking, condition_guess: j.condition_guess ?? null });
  }
  if (problems.length) return problems;
  const source = sha256(await readFile(path.resolve(file)));
  const target = path.join(context.where.results, 'judgements', `${source.slice(0, 16)}.json`);
  if (await readJsonFile(target)) return [];
  out.sort((a, b) => compare(a.run_id, b.run_id));
  const failure = await writeVerified(target, sealRecord({ kind: 'keystone-bench-judgement-record', schema_version: 2, plan: input.plan, source_hash: source, judge: { ...judge }, attestation: input.attestation, judgements: out }), context.where.boundaries.results);
  return failure?.diagnostics ?? [];
}

/** Version 2 run-level judged values: counts are the mean over vendor judges (all vendor judges
 * must have judged the run); each judge's verdict is kept separately and never averaged (C2).
 */
export function judgedValues(judges: Judge[], byJudge: Map<string, Judgement2> | undefined): { blocking: number | null; non_blocking: number | null; verdicts: Record<string, string> } {
  const vendors = judges.filter(j => j.role === 'vendor');
  const given = vendors.map(v => byJudge?.get(v.id)).filter(Boolean) as Judgement2[];
  const complete = given.length === vendors.length && vendors.length > 0;
  const mean = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) / values.length * 1e6) / 1e6;
  const verdicts: Record<string, string> = {};
  for (const [id, j] of [...(byJudge?.entries() ?? [])].sort(([a], [b]) => compare(a, b))) verdicts[id] = j.verdict;
  return { blocking: complete ? mean(given.map(j => j.blocking)) : null, non_blocking: complete ? mean(given.map(j => j.non_blocking)) : null, verdicts };
}

/** Agreement, completeness and blinding statistics, per judge. Never an outcome or classification input. */
export function judgingSummary(plan: LoadedPlan, runs: { run_id: string; condition: string; status: string }[], judgements: Map<string, Map<string, Judgement2>>) {
  const judges = plan.spec.judging?.judges ?? [];
  const vendors = judges.filter(j => j.role === 'vendor').map(j => j.id);
  const per = judges.map(judge => {
    const mine = runs.map(r => ({ run: r, j: judgements.get(r.run_id)?.get(judge.id) })).filter(x => x.j);
    const verdicts: Record<string, number> = {};
    for (const { j } of mine) verdicts[j!.verdict] = (verdicts[j!.verdict] ?? 0) + 1;
    const guessed = mine.filter(x => x.j!.condition_guess !== null);
    return {
      judge: judge.id, role: judge.role, judged: mine.length,
      verdicts: Object.fromEntries(Object.entries(verdicts).sort(([a], [b]) => compare(a, b))),
      blinding: {
        guess_participation: mine.length ? guessed.length / mine.length : null,
        guess_accuracy: guessed.length ? guessed.filter(x => x.j!.condition_guess === x.run.condition).length / guessed.length : null,
      },
    };
  });
  const pairs: { judges: [string, string]; runs: number; verdict_agreement: number | null; mean_abs_blocking_difference: number | null; mean_abs_non_blocking_difference: number | null }[] = [];
  const pair = (a: string, b: string) => {
    const both = runs.map(r => [judgements.get(r.run_id)?.get(a), judgements.get(r.run_id)?.get(b)]).filter(([x, y]) => x && y) as [Judgement2, Judgement2][];
    const avg = (f: (x: Judgement2, y: Judgement2) => number) => both.length ? Math.round(both.reduce((s, [x, y]) => s + f(x, y), 0) / both.length * 1e6) / 1e6 : null;
    pairs.push({ judges: [a, b], runs: both.length, verdict_agreement: avg((x, y) => x.verdict === y.verdict ? 1 : 0), mean_abs_blocking_difference: avg((x, y) => Math.abs(x.blocking - y.blocking)), mean_abs_non_blocking_difference: avg((x, y) => Math.abs(x.non_blocking - y.non_blocking)) });
  };
  for (let i = 0; i < vendors.length; i++) for (let k = i + 1; k < vendors.length; k++) pair(vendors[i], vendors[k]);
  for (const auditor of judges.filter(j => j.role === 'audit')) for (const vendor of vendors) pair(vendor, auditor.id);
  return { judges: per, agreement: pairs, note: 'Verdicts are categorical and never averaged. Agreement and blinding statistics are never outcome measures.' };
}

/** `keystone-bench release <plan> --attestation <file>`: records the owner's review of a packet's
 * inspection log before its release to judges (C5). Launches nothing; writes a content-free record.
 */
export async function release(planFile: string, root: string, work: string | undefined, attestationFile: string, repos?: string): Promise<Result> {
  const opened = await open('release', planFile, root, work, { repos });
  if (!opened.context) return opened.result!;
  const context = opened.context;
  const { plan } = context;
  const identity = { id: plan.spec.id, hash: plan.hash };
  const blocked = (diagnostics: Diagnostic[]): Result => ({ command: 'release', outcome: 'blocked', plan: identity, diagnostics });
  if (plan.version !== 2 || !plan.spec.judging) return blocked([{ code: 'BENCH_JUDGING_NOT_DECLARED', path: plan.spec.id, message: 'Packet release applies to version 2 plans that declare judging.' }]);
  const label = path.basename(attestationFile);
  const { data, diagnostics } = await readJson(path.resolve(attestationFile), label);
  if (diagnostics.length) return blocked(diagnostics.map(d => ({ ...d, code: 'BENCH_RELEASE_INVALID' })));
  const schema = schemaDiagnostics('packet-release', data, label, 'BENCH_RELEASE_INVALID');
  if (schema.length) return blocked(schema);
  const input = data as { plan: { id: string; hash: string }; packet_hash: string; inspection_log_hash: string; reviewed_by: 'owner'; date: string; statement: string };
  if (input.plan.id !== plan.spec.id || input.plan.hash !== plan.hash) return blocked([{ code: 'BENCH_PLAN_MISMATCH', path: label, message: 'The release names different plan content.' }]);
  // The packet is bound by its hash: its items, audit sample and inspection log hash are read from
  // the exported packet text, verified against the attested hash, never from mutable metadata.
  const manifest = await readJsonFile<PacketManifest>(path.join(packetsDirectory(context), `${input.packet_hash}.json`));
  if (typeof manifest?.packet_text !== 'string' || sha256(manifest.packet_text) !== input.packet_hash) {
    return blocked([{ code: 'BENCH_RELEASE_INVALID', path: label, field: '/packet_hash', message: 'No packet with this hash was exported from this work directory, or its stored text does not match the hash.' }]);
  }
  let packet: { plan?: { hash?: string }; items?: { blind_id: string; task: string }[]; audit?: { hash?: string }; inspection?: { log_hash?: string } };
  try { packet = JSON.parse(manifest.packet_text); } catch { return blocked([{ code: 'BENCH_RELEASE_INVALID', path: label, field: '/packet_hash', message: 'The packet text is not valid JSON.' }]); }
  if (packet.plan?.hash !== plan.hash || !Array.isArray(packet.items)) return blocked([{ code: 'BENCH_RELEASE_INVALID', path: label, field: '/packet_hash', message: 'The packet was exported for different plan content.' }]);
  if (packet.inspection?.log_hash !== input.inspection_log_hash) return blocked([{ code: 'BENCH_RELEASE_INVALID', path: label, field: '/inspection_log_hash', message: 'The inspection log hash does not match the packet’s inspection log.' }]);
  if (typeof manifest.audit_text !== 'string' || sha256(manifest.audit_text) !== packet.audit?.hash) return blocked([{ code: 'BENCH_RELEASE_INVALID', path: label, field: '/packet_hash', message: 'The audit sample does not match the hash the packet records.' }]);
  const items = packet.items.map(i => ({ blind_id: i.blind_id, task: i.task })).sort((a, b) => compare(a.blind_id, b.blind_id));
  const audit = (JSON.parse(manifest.audit_text) as { items: string[] }).items;
  const expected = plan.spec.judging.audit ? auditSample(items, plan.spec.judging.audit) : [];
  if (serialize(expected) !== serialize(audit)) return blocked([{ code: 'BENCH_RELEASE_INVALID', path: label, field: '/packet_hash', message: 'The packet’s audit sample does not follow the plan’s declared sampling rule.' }]);
  const file = path.join(releaseDirectory(context), `release-${input.packet_hash.slice(0, 16)}.json`);
  await guard(context.where.boundaries.results, file);
  const failure = await writeVerified(file, sealRecord({ kind: 'keystone-bench-packet-release-record', schema_version: 1, plan: identity, packet_hash: input.packet_hash, inspection_log_hash: input.inspection_log_hash, reviewed_by: input.reviewed_by, date: input.date, items, audit, source_hash: sha256(await readFile(path.resolve(attestationFile))) }), context.where.boundaries.results);
  if (failure) return { command: 'release', outcome: 'failed', plan: identity, diagnostics: failure.diagnostics };
  return { command: 'release', outcome: 'released', plan: identity, diagnostics: [], packet: input.packet_hash, release: file };
}
