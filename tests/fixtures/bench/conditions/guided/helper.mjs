// A condition-declared tool. It records only that it ran, in the workspace's fixture folder.
import { appendFileSync, mkdirSync } from 'node:fs';
mkdirSync('.bench-fixture', { recursive: true });
appendFileSync('.bench-fixture/helper.txt', `${process.argv[2] ?? 'run'}\n`);
