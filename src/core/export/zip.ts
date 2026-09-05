import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * A ZIP file, written and read by hand.
 *
 * Two things in this phase are ZIP archives whether we like it or not: a DOCX
 * is one, and so is a backup that has to carry the writer's attachments beside
 * the data. The format's own header is a hundred lines and it has not changed
 * since 1993 -- against a dependency that would have to be trusted with every
 * file that ever leaves this program, and updated for the rest of its life,
 * a hundred lines is the cheaper side.
 *
 * No ZIP64, no encryption, no split archives. A manuscript with its research
 * files does not reach four gigabytes, and if one ever does, the writer gets a
 * clear error rather than a subtly wrong file.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS packs a timestamp into two 16-bit words, to the nearest two seconds. */
function dosStamp(when: Date): { time: number; date: number } {
  const year = Math.max(when.getFullYear(), 1980);
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

export interface ZipEntry {
  /** Forward slashes, always -- a ZIP path is not a platform path. */
  name: string;
  bytes: Buffer;
  /** Set for bytes that are already compressed; storing them saves the effort. */
  store?: boolean;
}

const LIMIT = 0xffffffff;

export function zipBytes(entries: ZipEntry[], modified = new Date()): Buffer {
  const { time, date } = dosStamp(modified);
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = entry.bytes;
    const deflated = entry.store ? raw : deflateRawSync(raw, { level: 9 });
    // Deflate can grow bytes that are already compressed; storing them then
    // makes the archive smaller and the write faster.
    const stored = entry.store || deflated.byteLength >= raw.byteLength;
    const payload = stored ? raw : deflated;
    if (raw.byteLength > LIMIT || payload.byteLength > LIMIT) {
      throw new Error(`Filen «${entry.name}» er for stor til et almindeligt ZIP-arkiv.`);
    }
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    // Bit 11 says the name is UTF-8, which is what a Danish chapter title needs.
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(payload.byteLength, 18);
    local.writeUInt32LE(raw.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    locals.push(local, name, payload);

    const entryHeader = Buffer.alloc(46);
    entryHeader.writeUInt32LE(0x02014b50, 0);
    entryHeader.writeUInt16LE(20, 4);
    entryHeader.writeUInt16LE(20, 6);
    entryHeader.writeUInt16LE(0x0800, 8);
    entryHeader.writeUInt16LE(stored ? 0 : 8, 10);
    entryHeader.writeUInt16LE(time, 12);
    entryHeader.writeUInt16LE(date, 14);
    entryHeader.writeUInt32LE(sum, 16);
    entryHeader.writeUInt32LE(payload.byteLength, 20);
    entryHeader.writeUInt32LE(raw.byteLength, 24);
    entryHeader.writeUInt16LE(name.byteLength, 28);
    entryHeader.writeUInt32LE(offset, 42);
    central.push(entryHeader, name);

    offset += local.byteLength + name.byteLength + payload.byteLength;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/**
 * The archive back as named buffers.
 *
 * Read through the central directory rather than by walking local headers:
 * the directory is the authority on what an archive contains, and an entry
 * that only appears in front of the file is exactly the trick a hand-built
 * reader should not fall for.
 */
export function unzipBytes(archive: Buffer): Map<string, Buffer> {
  const start = findDirectory(archive);
  const count = archive.readUInt16LE(start.end + 10);
  const files = new Map<string, Buffer>();
  let at = start.offset;

  for (let i = 0; i < count; i += 1) {
    if (archive.readUInt32LE(at) !== 0x02014b50) {
      throw new Error('Arkivet er beskadiget: en post i indholdsfortegnelsen mangler.');
    }
    const method = archive.readUInt16LE(at + 10);
    const compressedSize = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const localOffset = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');

    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const from = localOffset + 30 + localNameLength + localExtraLength;
    const payload = archive.subarray(from, from + compressedSize);
    if (method !== 0 && method !== 8) {
      throw new Error(`«${name}» er pakket på en måde, programmet ikke kender (metode ${method}).`);
    }
    // A directory entry is a name ending in a slash and no bytes; it carries
    // nothing a restore needs, and the folders come back with their files.
    if (!name.endsWith('/')) {
      files.set(name, method === 0 ? Buffer.from(payload) : inflateRawSync(payload));
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/** The end record sits last, behind a comment nobody writes but everybody allows. */
function findDirectory(archive: Buffer): { offset: number; end: number } {
  for (let i = archive.byteLength - 22; i >= 0; i -= 1) {
    if (archive.readUInt32LE(i) === 0x06054b50) {
      return { offset: archive.readUInt32LE(i + 16), end: i };
    }
  }
  throw new Error('Det er ikke et ZIP-arkiv.');
}
