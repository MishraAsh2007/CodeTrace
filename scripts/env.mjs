import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
process.chdir(root);
export const windows = process.platform === 'win32';
const exe = (name) => name + (windows ? '.exe' : '');

export function javaHome() {
  const candidates = [process.env.TRACELAB_JAVA_HOME, process.env.JAVA_HOME];
  const extensionRoot = join(process.env.USERPROFILE || process.env.HOME || '', '.vscode', 'extensions');
  if (existsSync(extensionRoot)) {
    for (const ext of readdirSync(extensionRoot).filter(n => n.startsWith('redhat.java-')).sort().reverse()) {
      const dir = join(extensionRoot, ext, 'jre');
      if (existsSync(dir)) for (const jdk of readdirSync(dir)) candidates.push(join(dir, jdk));
    }
  }
  for (const dir of candidates.filter(Boolean)) {
    if (existsSync(join(dir, 'bin', exe('javac')))) {
      const result = spawnSync(join(dir, 'bin', exe('java')), ['-version'], { encoding: 'utf8' });
      const major = Number((result.stderr + result.stdout).match(/version "(\d+)/)?.[1]);
      if (major >= 21) return dir;
    }
  }
  const pathJavac = spawnSync(windows ? 'where.exe' : 'which', ['javac'], { encoding: 'utf8' });
  if (pathJavac.status === 0) {
    const candidate = resolve(pathJavac.stdout.trim().split(/\r?\n/)[0], '../..');
    const version = spawnSync(join(candidate, 'bin', exe('java')), ['-version'], { encoding: 'utf8' });
    if (Number((version.stderr + version.stdout).match(/version "(\d+)/)?.[1]) >= 21) return candidate;
  }
  throw new Error('A JDK 21+ is required. Set JAVA_HOME or TRACELAB_JAVA_HOME to its directory.');
}

/**
 * Eclipse JDT Language Server for editor features: TRACELAB_JDTLS_HOME, a copy downloaded by
 * `npm run setup:jdtls` into .tools/jdtls, or the one bundled with the VS Code Java extension.
 * Returns the folder that contains plugins/ and config_*, or null.
 */
export function jdtlsHome() {
  const valid = dir => dir && existsSync(join(dir, 'plugins')) && readdirSync(join(dir, 'plugins')).some(n => n.startsWith('org.eclipse.equinox.launcher_'));
  if (valid(process.env.TRACELAB_JDTLS_HOME)) return process.env.TRACELAB_JDTLS_HOME;
  if (valid(join(root, '.tools/jdtls'))) return join(root, '.tools/jdtls');
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const version = name => (name.match(/(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1).map(Number);
  const newer = (a, b) => { const x = version(a), y = version(b); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0); return 0; };
  for (const editor of ['.vscode', '.kiro', '.vscode-insiders', '.cursor']) {
    const extensions = join(home, editor, 'extensions');
    if (!existsSync(extensions)) continue;
    for (const ext of readdirSync(extensions).filter(n => n.startsWith('redhat.java-')).sort(newer)) {
      if (valid(join(extensions, ext, 'server'))) return join(extensions, ext, 'server');
    }
  }
  return null;
}

export function environment() {
  const env = { ...process.env, JAVA_HOME: javaHome() };
  const jdtls = jdtlsHome();
  if (jdtls && process.env.TRACELAB_LANGUAGE_SERVER !== 'off') {
    env.TRACELAB_JDTLS_HOME = jdtls;
    env.TRACELAB_JDTLS_JAVA = join(env.JAVA_HOME, 'bin', exe('java'));
  } else {
    delete env.TRACELAB_JDTLS_HOME;
    delete env.TRACELAB_JDTLS_JAVA;
  }
  if (existsSync(join(root, '.tools/cargo/bin', exe('cargo')))) {
    env.CARGO_HOME = join(root, '.tools/cargo');
    env.RUSTUP_HOME = join(root, '.tools/rustup');
    env.PATH = join(root, '.tools/cargo/bin') + (windows ? ';' : ':') + env.PATH;
  }
  env.TRACELAB_ROOT = root;
  return env;
}

export function run(command, args, env = environment()) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`)));
  });
}

export async function buildWorker() {
  const env = environment();
  mkdirSync(join(root, '.local/worker'), { recursive: true });
  await run(join(env.JAVA_HOME, 'bin', exe('javac')), ['--release', '21', '--add-modules', 'jdk.jdi', '-d', '.local/worker', 'worker/TraceWorker.java', 'worker/AssistProxy.java'], env);
}

export const serverBinary = join(root, 'target/debug', exe('tracelab-server'));
