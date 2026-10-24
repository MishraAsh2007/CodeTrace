import { buildWorker, run } from './env.mjs';
await buildWorker();
await run('cargo', ['build', '--locked']);
