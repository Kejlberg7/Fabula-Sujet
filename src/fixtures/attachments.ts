import { eq } from 'drizzle-orm';
import type { Store } from '../db/client';
import { source } from '../db/schema';
import { archiveRoot, attachBytes } from '../core/attachments';
import { inTurn } from '../core/changelog';
import type { Context } from '../core/workbench';

const actor = { kind: 'system' as const };

/**
 * Two real files in the prøvecase, so the archive can be seen doing its job.
 *
 * They are built here rather than committed: a repository is a poor place for
 * binaries, and a file whose bytes are written in code has a checksum anyone
 * can recompute. Both are genuine -- the PDF opens, the PNG renders -- because
 * a placeholder that no viewer accepts would prove nothing about «vises eller
 * åbnes sikkert».
 *
 * Nothing happens without an archive. Tests load into memory, and a prøvecase
 * that quietly wrote files next to an in-memory database would be writing
 * somewhere nobody asked for.
 */

/** A one-page PDF saying what it is. Hand-assembled; there is no PDF library here. */
function samplePdf(lines: string[]): Buffer {
  const text = lines
    .map((line, i) => `BT /F1 12 Tf 56 ${740 - i * 18} Td (${line.replace(/[()\\]/g, ' ')}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
      + '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const startxref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** A 4×4 grey PNG. Small enough to write out by hand, real enough to open. */
function samplePng(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(4, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 0;   // greyscale
  // Fire rækker, hver med filterbyte 0 og fire grå pixels.
  const raw = Buffer.concat(Array.from({ length: 4 }, (_, y) =>
    Buffer.from([0, 60 + y * 40, 70 + y * 40, 80 + y * 30, 90 + y * 20])));
  // zlib uden komprimering: den kan skrives i hånden og læses af enhver viser.
  const zlib = (() => {
    const blocks: Buffer[] = [Buffer.from([0x78, 0x01])];
    const head = Buffer.alloc(5);
    head[0] = 1;
    head.writeUInt16LE(raw.length, 1);
    head.writeUInt16LE(~raw.length & 0xffff, 3);
    blocks.push(head, raw);
    let a = 1;
    let b = 0;
    for (const byte of raw) { a = (a + byte) % 65521; b = (b + a) % 65521; }
    const adler = Buffer.alloc(4);
    adler.writeUInt32BE(((b << 16) | a) >>> 0);
    blocks.push(adler);
    return Buffer.concat(blocks);
  })();
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Attaches the prøvecase's own files. Does nothing without an archive. */
export function attachSampleFiles(store: Store, ctx: Context): number {
  if (!archiveRoot(store)) return 0;
  const byTitle = (title: string) => store.db.select().from(source)
    .where(eq(source.title, title)).all()
    .find((row) => row.worldId === ctx.worldId);

  const wanted: { title: string; name: string; bytes: Buffer }[] = [];
  const protocol = byTitle('Søforhørsprotokol, Sundby herredsret');
  if (protocol && !protocol.filePath) {
    wanted.push({
      title: protocol.title, name: 'soeforhoer-1893.pdf',
      bytes: samplePdf([
        'Soeforhoer, Sundby herredsret, 14. november 1893',
        '',
        'Afhoert: Valdemar Sund, styrmand.',
        'Om ladningen og om vejret den paagaeldende nat.',
        '',
        'Fotograferede sider. Laeses af mennesker, ikke af programmet.',
      ]),
    });
  }
  const photo = byTitle('Fotografi: kajen set fra nord, 1951');
  if (photo && !photo.filePath) {
    wanted.push({ title: photo.title, name: 'kajen-1951.png', bytes: samplePng() });
  }
  if (wanted.length === 0) return 0;

  inTurn(store, {
    branchId: ctx.branchId, actor, summary: 'Læg prøvecasens filer i arkivet',
  }, (session) => {
    for (const item of wanted) {
      const row = byTitle(item.title)!;
      attachBytes(store, session, ctx, {
        sourceId: row.id, name: item.name, bytes: item.bytes,
      });
    }
  });
  return wanted.length;
}
