import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { temporary, snapshot, project } from './helpers.mjs';

/** Shared keystone-bench test helpers (Phase 7 and its review remediation). */
export const fixtures = path.join(project, 'tests', 'fixtures', 'bench');
export const reference = path.join(project, 'benchmark', 'specification', 'conditions');
export const benchCli = path.join(project, 'dist', 'benchmark', 'cli.js');
export const offline = { HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', npm_config_offline: 'true' };

export function git(cwd, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  const result = spawnSync('git', ['-c', 'init.templateDir=', '-c', 'user.name=Keystone test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, env });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

export function bench(args, env = {}) {
  const result = spawnSync(process.execPath, [benchCli, ...args, '--json'], { encoding: 'utf8', timeout: 300000, env: { ...process.env, ...offline, ...env } });
  if (result.error) throw result.error;
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { assert.fail(`keystone-bench printed no JSON (exit ${result.status}): ${result.stdout}${result.stderr}`); }
  return { status: result.status, result: parsed };
}

export function keystone(args, cwd, env = {}) {
  return spawnSync(process.execPath, [path.join(project, 'dist', 'cli', 'index.js'), ...args, '--json'], { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, ...offline, ...env } });
}

/** A temporary area whose paths contain spaces, holding a fresh fixture subject repository. */
export async function area(t) {
  const base = path.join(await temporary(t, false), 'bench area with spaces');
  await mkdir(base, { recursive: true });
  const subject = path.join(base, 'subject repo');
  await cp(path.join(fixtures, 'subject'), subject, { recursive: true });
  git(subject, 'init', '--quiet');
  git(subject, 'add', '-A');
  git(subject, 'commit', '--quiet', '-m', 'fixture base');
  const root = path.join(base, 'keystone root');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'PROJECT.md'), '# Keystone checkout stand-in\n');
  return { base, subject, root, commit: git(subject, 'rev-parse', 'HEAD'), work: path.join(base, 'work dir') };
}

export async function writePlan(a, name, fields = {}) {
  const plan = {
    kind: 'keystone-bench-plan', schema_version: 1, id: name, purpose: 'experiment',
    subject: { id: 'fixture', repository: 'subject repo', commit: a.commit },
    tasks: [path.join(fixtures, 'tasks', 'change-app', 'task.json')],
    conditions: [path.join(fixtures, 'conditions', 'plain', 'condition.json'), path.join(fixtures, 'conditions', 'guided', 'condition.json')],
    profiles: [path.join(fixtures, 'profiles', 'fake', 'profile.json')],
    repetitions: 1, seed: 7,
    limits: { session_timeout_seconds: 60, setup_timeout_seconds: 120, oracle_timeout_seconds: 60 },
    telemetry: { enabled: true, wrap: ['git', 'helper'] },
    ...fields,
  };
  const file = path.join(a.base, `${name}.json`);
  await writeFile(file, JSON.stringify(plan, null, 2));
  return file;
}

export const common = a => ['--root', a.root, '--work', a.work];
export async function records(a, plan) {
  const directory = path.join(a.root, 'benchmark', 'results', plan, 'runs');
  return Promise.all((await readdir(directory)).sort().map(async name => JSON.parse(await readFile(path.join(directory, name), 'utf8'))));
}
export const byCondition = (list, id) => list.filter(r => r.provenance.condition.id === id);
export const scores = async (a, plan) => JSON.parse(await readFile(path.join(a.root, 'benchmark', 'analysis', plan, 'scores.json'), 'utf8'));

/** A prepared and run experiment: plain and guided, two repetitions, telemetry, judging and a composite. */
export async function experiment(t, fields = {}, name = 'main') {
  const a = await area(t);
  const plan = await writePlan(a, name, {
    repetitions: 2,
    judging: { procedure: 'Blinded review of the task statement and the resulting change.', exclude: ['.bench-fixture'] },
    composite: { weights: { task_oracle_pass_rate: 1, rework_sessions: -0.1 } },
    ...fields,
  });
  const subjectBefore = await snapshot(a.subject);
  const prepared = bench(['prepare', plan, ...common(a)]);
  assert.equal(prepared.status, 0, JSON.stringify(prepared.result));
  const ran = bench(['run', plan, ...common(a)]);
  assert.equal(ran.status, 0, JSON.stringify(ran.result));
  return { a, plan, subjectBefore, prepared: prepared.result, ran: ran.result };
}
