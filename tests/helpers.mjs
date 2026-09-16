import { mkdtemp, mkdir, writeFile, cp, rm, realpath, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

export const project = fileURLToPath(new URL('../', import.meta.url));
export const fixture = fileURLToPath(new URL('./fixtures/valid/', import.meta.url));

export async function temporary(t, copy = true) {
  const base = await realpath(tmpdir());
  const root = await mkdtemp(path.join(base, 'keystone-test-'));
  t.after(async () => {
    // Verify the exact temporary directory before any recursive removal on Windows.
    const resolved = await realpath(root);
    if (path.dirname(resolved) !== base || !path.basename(resolved).startsWith('keystone-test-')) {
      throw new Error('Refusing cleanup outside the test temporary directory');
    }
    await rm(resolved, { recursive: true, force: true });
  });
  if (copy) await cp(fixture, root, { recursive: true });
  return root;
}

export async function put(root, file, contents) {
  const destination = path.join(root, ...file.split('/'));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}

export function artifact(type, fields, body = '# Artifact\n') {
  return `---\n${JSON.stringify({ context_type: type, schema_version: 1, ...fields })}\n---\n${body}`;
}

export function cli(root, ...args) {
  const result = spawnSync(process.execPath, [path.join(project, 'dist/cli/index.js'), ...args, '--root', root, '--json'], {
    encoding: 'utf8', timeout: 15000,
    // Runtime commands have no dependency on the network or registry.
    env: { ...process.env, HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', npm_config_offline: 'true' },
  });
  if (result.error) throw result.error;
  return { ...result, result: JSON.parse(result.stdout) };
}

export async function snapshot(root, prefix = '') {
  const entries = {};
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const file = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(entries, await snapshot(root, file));
    else entries[file] = (await readFile(path.join(root, file))).toString('base64');
  }
  return entries;
}
