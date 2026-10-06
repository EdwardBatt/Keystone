import { readFileSync } from 'node:fs';
process.exitCode = readFileSync('README.md', 'utf8').startsWith('# Fixture subject') ? 0 : 1;
