import { existsSync } from 'node:fs';
process.exitCode = existsSync('debug.log') ? 1 : 0;
