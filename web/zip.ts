/** Minimal, dependency-free ZIP reader and writer (store and deflate; no ZIP64 or encryption). */
export type ZipEntry = { path: string; data: Uint8Array };
export type ZipLimits = { maxEntries: number; maxEntry: number; maxTotal: number };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function transform(data: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const reader = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error('A file in this zip expands beyond the size limit.'); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

/**
 * Reads a ZIP archive. `want` filters entries by path before they are decompressed;
 * limits apply to the wanted entries' declared and actual sizes.
 */
export async function readZip(bytes: Uint8Array, limits: ZipLimits, want: (path: string) => boolean = () => true): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This file is not a zip archive.');
  const count = view.getUint16(eocd + 10, true);
  const directory = view.getUint32(eocd + 16, true);
  if (count === 0xffff || directory === 0xffffffff) throw new Error('ZIP64 archives are not supported.');
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = directory, total = 0;
  const damaged = () => new Error('This zip archive is damaged.');
  for (let k = 0; k < count; k++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw damaged();
    const flags = view.getUint16(p + 8, true), method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true), size = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true), extraLength = view.getUint16(p + 30, true), commentLength = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const path = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength)).replace(/\\/g, '/');
    p += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith('/') || !want(path)) continue;
    if (entries.length >= limits.maxEntries) throw new Error(`This zip has more than ${limits.maxEntries} usable files.`);
    if (flags & 1) throw new Error('Encrypted zip files are not supported.');
    if (compressed === 0xffffffff || size === 0xffffffff) throw new Error('ZIP64 archives are not supported.');
    if (size > limits.maxEntry) throw new Error(`${path} is larger than ${Math.round(limits.maxEntry / 1024)} KiB.`);
    total += size;
    if (total > limits.maxTotal) throw new Error(`The files in this zip add up to more than ${Math.round(limits.maxTotal / 1024)} KiB.`);
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw damaged();
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compressed);
    if (raw.length !== compressed) throw damaged();
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await transform(raw, new DecompressionStream('deflate-raw'), limits.maxEntry).catch(error => { throw error instanceof Error && error.message.includes('size limit') ? error : damaged(); });
    else throw new Error(`${path} uses an unsupported compression method.`);
    if (data.length !== size) throw damaged();
    entries.push({ path, data });
  }
  return entries;
}

function dosDateTime(date: Date): [number, number] {
  const year = Math.max(1980, date.getFullYear());
  return [(date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2), ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()];
}

/** Writes a ZIP archive, deflating entries when that makes them smaller. */
export async function writeZip(entries: ZipEntry[], date = new Date()): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const [time, day] = dosDateTime(date);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.data);
    const deflated = await transform(entry.data, new CompressionStream('deflate-raw'));
    const useDeflate = deflated.length < entry.data.length;
    const body = useDeflate ? deflated : entry.data;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, useDeflate ? 8 : 0, true);
    lv.setUint16(10, time, true); lv.setUint16(12, day, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true); lv.setUint32(22, entry.data.length, true); lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, useDeflate ? 8 : 0, true);
    cv.setUint16(12, time, true); cv.setUint16(14, day, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true); cv.setUint32(24, entry.data.length, true); cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const directorySize = centrals.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directorySize, true); ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
