import { readFileSync } from 'node:fs';
process.exitCode = readFileSync('src/app.txt', 'utf8') === 'two\n' ? 0 : 1;
