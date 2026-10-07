import path from 'node:path';
import { serialize, type Diagnostic } from '../core.js';
import { readJson, schemaDiagnostics } from './specs.js';
import { writeVerified } from './store.js';
import { open, planChanges, type Result } from './prepare.js';
import { loadManifest, prepared } from './run.js';

/** `keystone-bench record <run-id> --plan <plan> --input <file>`: captures a manual run's sessions.
 * It launches nothing; the next `run` performs the final oracle check and installs the record.
 */
export async function record(runIdArg: string, planFile: string, root: string, work: string | undefined, inputFile: string, repos?: string): Promise<Result> {
  const opened = await open('record', planFile, root, work, { repos, gates: ['canonical', 'frozen'] });
  if (!opened.context) return opened.result!;
  const context = opened.context;
  const identity = { id: context.plan.spec.id, hash: context.plan.hash };
  const blocked = (diagnostics: Diagnostic[]): Result => ({ command: 'record', outcome: 'blocked', plan: identity, diagnostics, run_id: runIdArg });
  const changed = await planChanges(context);
  if (changed.length) return blocked(changed);
  const manifest = await loadManifest(context);
  const entry = manifest?.runs.find(r => r.run_id === runIdArg);
  if (!entry) return blocked([{ code: 'BENCH_RUN_UNKNOWN', path: runIdArg, message: `${runIdArg} is not a prepared run of this plan.` }]);
  const p = await prepared(context, entry);
  if (p.profile.spec.mode !== 'manual') return blocked([{ code: 'BENCH_RUN_NOT_MANUAL', path: runIdArg, message: 'Only runs with a manual agent profile are recorded by hand.' }]);
  if (p.state?.status === 'recorded' || p.state?.status === 'done') return blocked([{ code: 'BENCH_RUN_ALREADY_RECORDED', path: runIdArg, message: 'The run is already recorded.' }]);
  if (p.state?.status !== 'awaiting-record') return blocked([{ code: 'BENCH_RUN_NOT_STARTED', path: runIdArg, message: 'Run the manual run first; its condition setup and prompts are prepared by run.' }]);
  const label = path.basename(inputFile);
  const { data, diagnostics } = await readJson(path.resolve(inputFile), label);
  if (diagnostics.length) return blocked(diagnostics.map(d => ({ ...d, code: 'BENCH_MANUAL_RECORD_INVALID' })));
  const schema = schemaDiagnostics('manual-record', data, label, 'BENCH_MANUAL_RECORD_INVALID');
  if (schema.length) return blocked(schema);
  const input = data as { sessions: { id: string }[]; fix_sessions: number };
  const task = p.task.spec;
  const expected = [...task.sessions.map(s => s.id), ...Array.from({ length: input.fix_sessions }, (_, i) => `fix${i + 1}`)];
  if (input.fix_sessions > (task.fix?.max ?? 0)) return blocked([{ code: 'BENCH_MANUAL_RECORD_INVALID', path: label, field: '/fix_sessions', message: `The task allows at most ${task.fix?.max ?? 0} fix sessions.` }]);
  if (input.sessions.map(s => s.id).join('\0') !== expected.join('\0')) {
    return blocked([{ code: 'BENCH_MANUAL_RECORD_INVALID', path: label, field: '/sessions', message: `Sessions must be, in order: ${expected.join(', ')}.` }]);
  }
  const trusted = p.profile.spec.trusted ?? {};
  const sessions = (data as { sessions: { usage: { tool?: unknown; model?: unknown } | null }[] }).sessions;
  for (const [i, session] of sessions.entries()) {
    const { tool, model } = session.usage ?? {};
    const untrusted = tool != null && !(trusted.tools ?? []).includes(tool as string) ||
      model != null && String(model).split(',').some(m => !(trusted.models ?? []).includes(m));
    if (untrusted) return blocked([{ code: 'BENCH_MANUAL_RECORD_INVALID', path: label, field: `/sessions/${i}/usage`, message: 'Tool and model may only name identities the profile declares as trusted.' }]);
  }
  const toolVersion = (data as { tool_version?: string }).tool_version;
  if (toolVersion !== undefined && !(trusted.tool_versions ?? []).includes(toolVersion)) {
    return blocked([{ code: 'BENCH_MANUAL_RECORD_INVALID', path: label, field: '/tool_version', message: 'The tool version may only name a version the profile declares as trusted.' }]);
  }
  const failure = await writeVerified(p.paths.state, serialize({ ...p.state, status: 'recorded', manual: data }), context.where.boundaries.work);
  if (failure) return { command: 'record', outcome: 'failed', plan: identity, diagnostics: failure.diagnostics, run_id: runIdArg };
  return { command: 'record', outcome: 'recorded', plan: identity, diagnostics: [], run_id: runIdArg, next: `keystone-bench run <plan> --run ${runIdArg}` };
}
