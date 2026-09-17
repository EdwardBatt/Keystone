import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fail, KeystoneError } from '../core.js';
import { repositoryRoot } from '../paths.js';

const exec = promisify(execFile);

/** Git owns repository/worktree discovery; do not infer roots from .git directory shapes. */
export async function gitRoot(input: string): Promise<string> {
  const start = await repositoryRoot(input);
  const overrides = new Set(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !overrides.has(key.toUpperCase())));
  // Stable Git diagnostic language; preserve GIT_CONFIG_* trust/configuration settings.
  env.LC_ALL = 'C';
  try {
    const { stdout } = await exec('git', ['-C', start, 'rev-parse', '--show-toplevel'], {
      env, windowsHide: true, timeout: 10000, encoding: 'utf8',
    });
    const root = await repositoryRoot(stdout.trim());
    const relative = path.relative(root, start);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      fail('GIT_ROOT_NOT_FOUND', '.', 'Git root must contain the requested directory.');
    }
    return root;
  } catch (error) {
    if (error instanceof KeystoneError) throw error;
    const failure = error as { code?: string | number; stderr?: string };
    if (typeof failure.code === 'number' && /not a git repository/i.test(failure.stderr ?? '')) {
      fail('GIT_ROOT_NOT_FOUND', '.', 'The requested directory is not inside a Git worktree.');
    }
    fail('GIT_DISCOVERY_FAILED', '.', 'Git root discovery failed. Check Git installation, repository trust, permissions, and Git configuration.');
  }
}
