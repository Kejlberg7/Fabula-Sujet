import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import type { Store } from '../../db/client';
import { backupBundle, backupJson, inspectBackup, restoreBackup } from '../../core/export/backup';
import { toDocx } from '../../core/export/docx';
import { toMarkdown } from '../../core/export/markdown';
import { readingEdition, type AppendixPart, type ReadingTarget } from '../../core/export/reading';
import { defineTool, type Tools } from '../kit';
import { resolveSeries, resolveWork } from '../resolve';

/**
 * Getting the work out of the program, from the conversation.
 *
 * The interface hands a file straight to the browser; there is nothing to hand
 * it to here, so these write to disk and answer with the path. They put it
 * beside the database by default -- `fabula.db` gives `fabula-eksport/` -- for
 * the same reason the file archive lives there: the export belongs to the
 * project, and a project that is moved should bring it along.
 */

/** Where exports land when nobody says otherwise. */
function exportRoot(store: Store): string {
  if (store.sqlite.memory) throw new Error('Databasen ligger kun i hukommelsen, så der er ingen mappe at skrive i.');
  const file = resolve(store.sqlite.name);
  const stem = basename(file).replace(/\.[^.]+$/, '');
  return join(dirname(file), `${stem}-eksport`);
}

function put(store: Store, path: string | undefined, name: string, bytes: Buffer): string {
  const target = path
    ? (isAbsolute(path) ? path : resolve(path))
    : join(exportRoot(store), name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return target;
}

function read(path: string): Buffer {
  const from = resolve(path);
  if (!existsSync(from)) throw new Error(`Der ligger ingen fil på «${path}».`);
  return readFileSync(from);
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} kB`;

/**
 * The appendix parts, in Danish.
 *
 * Values on this surface are usually the English ones the database stores,
 * because that is what they are. These are not stored anywhere -- they are a
 * menu of sections to include -- so they are said the way the writer would say
 * them, and translated here.
 */
const APPENDIX: Record<string, AppendixPart> = {
  personer: 'people', steder: 'places', tidslinje: 'timeline', kilder: 'sources',
};

function target(tools: Tools, book: string | undefined, series: string | undefined): ReadingTarget {
  const ctx = tools.bench.context();
  if (series) return { seriesId: resolveSeries(tools.store, ctx, series).id };
  if (book) return { workId: resolveWork(tools.store, ctx, book).id };
  if (ctx.workId) return { workId: ctx.workId };
  throw new Error('Sig hvilken bog eller serie, du vil have ud — der er ikke valgt en bog.');
}

export const exportTools = [
  defineTool({
    name: 'eksporter_bog',
    title: 'Eksportér læseudgave',
    description:
      'Skriver en bog eller en hel serie ud som Markdown eller Word. Læseudgaven er forfatterens '
      + 'ord og ingenting andet: arbejds-id\'er, ankermærker og margennoter kommer ikke med. '
      + 'Et appendiks med personer, steder, tidslinje og kilder kan bedes om, og dækker det, den '
      + 'eksporterede bog selv bringer på scenen.',
    inputSchema: {
      bog: z.string().optional().describe('Titel eller id. Standard: den aktive bog'),
      serie: z.string().optional().describe('Hele serien i stedet for én bog'),
      format: z.enum(['markdown', 'docx']).optional().describe('Standard: markdown'),
      appendiks: z.array(z.enum(['personer', 'steder', 'tidslinje', 'kilder'])).optional(),
      scenetitler: z.boolean().optional().describe('Tag arbejdstitlerne på scenerne med'),
      huller: z.boolean().optional().describe('Markér scener, der ikke er skrevet endnu'),
      sti: z.string().optional().describe('Skriv filen her i stedet for i projektets eksportmappe'),
    },
    run: (args, tools) => {
      const { document, stats } = readingEdition(
        tools.store, tools.bench.context(), target(tools, args.bog, args.serie),
        {
          sceneTitles: args.scenetitler, gaps: args.huller,
          appendix: args.appendiks?.map((word) => APPENDIX[word]!),
        },
      );
      const docx = args.format === 'docx';
      const bytes = docx ? toDocx(document) : Buffer.from(toMarkdown(document), 'utf8');
      const name = `${document.title.replace(/[/\\:*?"<>|]/g, '-')}.${docx ? 'docx' : 'md'}`;
      const path = put(tools.store, args.sti, name, bytes);
      return `«${document.title}» ligger nu på ${path} — ${stats.chapters} kapitler, `
        + `${stats.written} af ${stats.scenes} scener skrevet, ${stats.words} ord (${kb(bytes.byteLength)}).`;
    },
  }),

  defineTool({
    name: 'lav_backup',
    title: 'Lav backup',
    description:
      'Skriver hele databasen ud: hver række i hver tabel, med et versionsstempel for den '
      + 'skemaudgave, den er lavet på. Som standard et ZIP-arkiv, der også indeholder arkivets '
      + 'vedhæftede filer — en backup af en bog uden den fotograferede side, den bygger på, er '
      + 'kun en halv backup. Sig med_filer: false for kun at få JSON.',
    inputSchema: {
      sti: z.string().optional().describe('Skriv filen her i stedet for i projektets eksportmappe'),
      med_filer: z.boolean().optional().describe('Standard: ja, tag arkivets filer med'),
    },
    run: (args, tools) => {
      const withFiles = args.med_filer !== false;
      const stamp = new Date().toISOString().slice(0, 10);
      const made = withFiles ? backupBundle(tools.store) : null;
      const bytes = made ? made.bytes : backupJson(tools.store);
      const path = put(
        tools.store, args.sti, `fabula-backup-${stamp}.${withFiles ? 'zip' : 'json'}`, bytes,
      );
      const missing = made?.missing.length
        ? ` ${made.missing.length} filer manglede i arkivet og kunne ikke pakkes med.`
        : '';
      return `Backup skrevet til ${path} (${kb(bytes.byteLength)}`
        + `${made ? `, ${made.rows} rækker, ${made.files} filer` : ''}).${missing}`;
    },
  }),

  defineTool({
    name: 'se_backup',
    title: 'Se, hvad der er i en backup',
    description:
      'Læser en backup og fortæller, hvad den indeholder — verdener, bøger, scener, ord og '
      + 'vedhæftede filer — uden at røre databasen. Brug den altid før genopret_backup.',
    inputSchema: { sti: z.string().describe('Sti til .zip- eller .json-backuppen') },
    run: (args, tools) => {
      const view = inspectBackup(tools.store, read(args.sti));
      const worlds = view.worlds.map((world) =>
        `  • ${world.name}: ${world.works.join(', ') || 'ingen bøger'} `
        + `(${world.scenes} scener, ${world.words} ord`
        + `${world.branches > 1 ? `, ${world.branches} grene` : ''})`);
      return [
        `Backup fra ${view.createdAt.slice(0, 16).replace('T', ' ')}, udgave ${view.version}, `
        + `${view.rows} rækker.`,
        ...worlds,
        `Filer: ${view.files.inData} i data, ${view.files.inArchive} pakket med.`,
        view.canRestore
          ? 'Den kan hentes ind her.'
          : 'Den kan ikke hentes ind her:',
        ...view.warnings.map((line) => `  ! ${line}`),
      ].join('\n');
    },
  }),

  defineTool({
    name: 'genopret_backup',
    title: 'Genopret fra backup',
    description:
      'Henter en backup ind i databasen. Kun i en tom database: en genoprettelse lægger sig ikke '
      + 'oven i noget, og den bliver stoppet, før den rører noget, hvis der allerede står noget '
      + 'her, eller hvis backuppen er lavet på en anden skemaudgave. Det er også derfor, den ikke '
      + 'går gennem ændringsloggen — den genopretter loggen.',
    inputSchema: {
      sti: z.string().describe('Sti til .zip- eller .json-backuppen'),
      accepter_anden_udgave: z.boolean().optional()
        .describe('Hent ind, selvom skemaudgaven er en anden. Kan give en halvt genoprettet database.'),
    },
    run: (args, tools) => {
      const report = restoreBackup(tools.store, read(args.sti), {
        allowOtherSchema: args.accepter_anden_udgave,
      });
      return `Hentet ind: ${report.rows} rækker i ${report.tables} tabeller, `
        + `${report.files} filer, verdener: ${report.worlds.join(', ')}. `
        + 'Sæt en aktiv verden med saet_aktivt_vaerk.';
    },
  }),
];
