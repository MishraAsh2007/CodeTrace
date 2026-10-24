import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { environment, serverBinary } from './env.mjs';
if (!existsSync(serverBinary) || !existsSync('dist/index.html')) {
  throw new Error('Run npm run build first.');
}
const child = spawn(serverBinary, [], { env: environment(), stdio: 'inherit', windowsHide: true });
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
child.on('exit', code => process.exit(code ?? 0));
