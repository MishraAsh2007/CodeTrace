import { spawn } from 'node:child_process';
import { buildWorker, environment, run, serverBinary } from './env.mjs';
await buildWorker();
await run('cargo', ['build', '--locked']);
const children = [
  spawn(serverBinary, [], { env: environment(), stdio: 'inherit', windowsHide: true }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', windowsHide: true }),
];
let exiting = false;
function stop() { if (!exiting) { exiting = true; children.forEach(c => c.kill()); } }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach(c => c.on('exit', stop));
