import type { Project } from './types';

/** Share links carry the whole project in the URL fragment, so the server never receives it. */
export const SHARE_PREFIX = '#project=';
const MAX_COMPRESSED = 256 * 1024;
const MAX_JSON = 1024 * 1024;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('This share link is malformed.');
  let binary: string;
  try { binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4)); }
  catch { throw new Error('This share link is malformed.'); }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encodeProject(project: Project): Promise<string> {
  const stream = new Blob([JSON.stringify(project)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/** Decodes a share payload with a decompressed-size cap. The caller must still validate the project. */
export async function decodeProject(payload: string): Promise<unknown> {
  if (payload.length > MAX_COMPRESSED * 1.4) throw new Error('This share link is too large.');
  const bytes = fromBase64Url(payload);
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_JSON) { await reader.cancel(); throw new Error('This share link expands beyond the 1 MiB project limit.'); }
      chunks.push(value);
    }
  } catch (error) {
    throw error instanceof Error && error.message.startsWith('This share link') ? error : new Error('This share link is damaged or incomplete.');
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(joined)); }
  catch { throw new Error('This share link does not contain a project.'); }
}
