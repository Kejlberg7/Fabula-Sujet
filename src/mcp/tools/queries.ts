import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { work } from '../../db/schema';
import { whoKnewWhat } from '../../core/queries/knowledge';
import { whoWasWhere, worldline } from '../../core/queries/presence';
import { whatReaderKnows } from '../../core/queries/reader';
import { find } from '../../core/queries/search';
import { seriesOverview } from '../../core/queries/series';
import {
  referenceBacklinks, referenceByCode, referenceCatalog,
} from '../../core/queries/references';
import { solveTime } from '../../core/solve';
import { BELIEF_DA, REVEAL_DA, say } from '../../core/words';
import { formatInstant } from '../../core/time/gregorian';
import { asInstant, defineTool, timeArg, type ToolDef } from '../kit';
import { resolveEntity, resolveSeries, resolveWork } from '../resolve';

const at = (v: number | null) => (v == null ? '?' : formatInstant(v, 'day'));

/** Rækkevidden sagt på dansk. Koden er engelsk indeni; overfladen er ikke. */
const REACH_DA: Record<string, string> = {
  work: 'kun sin egen bog', series: 'hele serien', world: 'hele verden',
};

/** «1 bind», «2 bind» — men «1 scene», «2 scener». Endelsen skal passe. */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const queryTools: ToolDef[] = [
  defineTool({
    name: 'vis_serieoversigt',
    title: 'Vis serieoversigt',
    description:
      'Serien læst som én fortælling: bindene i rækkefølge, de personer der går igen, '
      + 'plottrådene og hvor langt de når, afsløringerne i læserækkefølge, og de setups der '
      + 'endnu ikke er indfriet. En anden serie i den samme verden er ikke med — læseren af '
      + 'denne serie har ikke læst den.',
    inputSchema: {
      serie: z.string().optional().describe('Navn på serien. Uden den bruges den aktive bogs serie'),
    },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const chosen = args.serie
        ? resolveSeries(tools.store, ctx, args.serie).id
        : (ctx.workId
          ? tools.store.db.select().from(work).where(eq(work.id, ctx.workId)).get()?.seriesId
          : null);
      if (!chosen) return 'Den aktive bog hører ikke til en serie. Vælg en serie med «serie».';
      const view = seriesOverview(tools.store, ctx, { seriesId: chosen });
      if (!view) return 'Serien findes ikke i den aktive verden.';

      const blocks: string[] = [`SERIEN «${view.name}»${view.summary ? ` — ${view.summary}` : ''}`];

      blocks.push(['BIND', ...view.volumes.map((v, i) =>
        `  ${i + 1}. ${v.title} — ${count(v.chapters, 'kapitel', 'kapitler')}, `
        + count(v.scenes, 'scene', 'scener'))].join('\n'));

      blocks.push(view.people.length === 0
        ? 'GENNEMGÅENDE PERSONER\n  Ingen går igen på tværs af bindene endnu.'
        : ['GENNEMGÅENDE PERSONER', ...view.people.map((person) =>
          `  ${person.code ? `${person.code} ` : ''}${person.name} — ${person.volumes.join(', ')}`,
        )].join('\n'));

      blocks.push(view.threads.length === 0
        ? 'PLOTTRÅDE\n  Ingen tråde i serien endnu.'
        : ['PLOTTRÅDE', ...view.threads.map((line) =>
          `  ${line.name} · begynder i ${line.home} · når ${REACH_DA[line.scope]}`
          + `\n    ${count(line.setups, 'setup', 'setups')}, `
          + `${count(line.payoffs, 'indfrielse', 'indfrielser')}`
          + (line.volumes.length > 0 ? ` · ligger i ${line.volumes.join(', ')}` : ' · endnu uskrevet'),
        )].join('\n'));

      blocks.push(view.reveals.length === 0
        ? 'AFSLØRINGER\n  Ingen afsløringer i serien endnu.'
        : ['AFSLØRINGER (i læserækkefølge)', ...view.reveals.map((item) =>
          `  ${item.volume} · ${item.sceneTitle} — ${item.summary} [${say(REVEAL_DA, item.strength)}]`
          + (item.carriedFrom ? `\n    Læseren har det med fra «${item.carriedFrom}».` : ''),
        )].join('\n'));

      blocks.push(view.open.length === 0
        ? 'ULØSTE SETUPS\n  Ingen. Hvert setup i serien har noget efter sig.'
        : ['ULØSTE SETUPS', ...view.open.map((item) => `  ${item.message}`)].join('\n'));

      return blocks.join('\n\n');
    },
  }),

  defineTool({
    name: 'vis_referencer',
    title: 'Vis arbejdsreferencer',
    description:
      'Viser de korte, stabile adresser som P1, G4 og E12. De kan bruges i alle andre '
      + 'værktøjer i stedet for et internt id eller et navn, og de bliver de samme på en gren.',
    inputSchema: {
      soeg: z.string().optional().describe('Kode eller en del af navnet'),
    },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const needle = args.soeg?.trim().toLocaleLowerCase('da');
      const rows = referenceCatalog(tools.store, ctx).filter((item) => !needle
        || item.code.toLocaleLowerCase('da').includes(needle)
        || item.label.toLocaleLowerCase('da').includes(needle));
      if (rows.length === 0) return 'Ingen arbejdsreferencer matcher.';
      return rows.slice(0, 100).map((item) =>
        `• ${item.code} — ${item.label} · ${item.group.toLocaleLowerCase('da')}`
        + `${item.exists ? '' : ' · BRUDT'} · ${item.mentionCount} omtale${item.mentionCount === 1 ? '' : 'r'}`)
        .join('\n');
    },
  }),

  defineTool({
    name: 'vis_omtaler',
    title: 'Vis omtaler i prosaen',
    description:
      'Finder alle tekstankre, der omtaler én arbejdsreference, og viser bog, kapitel, scene og uddrag.',
    inputSchema: { reference: z.string().describe('Fx G1 eller @G1') },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const ref = referenceByCode(tools.store, ctx, args.reference);
      if (!ref) throw new Error(`Jeg kan ikke finde arbejdsreferencen «${args.reference}».`);
      const hits = referenceBacklinks(tools.store, ctx, {
        targetKind: ref.targetKind, targetId: ref.targetId,
      });
      if (hits.length === 0) return `${ref.code} er ikke omtalt i prosaen endnu.`;
      return hits.map((hit) =>
        `• ${hit.workTitle} · ${hit.chapterTitle} · ${hit.sceneTitle}`
        + `${hit.excerpt ? `\n  «${hit.excerpt}»` : ''}`).join('\n');
    },
  }),

  defineTool({
    name: 'hvem_vidste_hvad',
    title: 'Hvem vidste hvad',
    description:
      'Alt hvad en person ved, tror og bærer på sig på et punkt i HENDES egen tid. Tre kilder, i '
      + 'den rækkefølge de vinder: det du selv har skrevet ned, det hun tog til sig ved at være til '
      + 'stede, og det der står på hendes sedler. Udelad tidspunktet for at se det hele.',
    inputSchema: {
      person: z.string(),
      tidspunkt: timeArg.optional().describe('I personens egen tid'),
      ben: z.number().optional(),
    },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const who = resolveEntity(tools.store, ctx, args.person, 'person');
      const legs = worldline(tools.store, ctx, who.id);
      const leg = args.ben ? legs.find((l) => l.ordinal === args.ben) : undefined;
      if (args.ben && !leg) throw new Error(`${who.name} har ikke et ben nummer ${args.ben}.`);

      const result = whoKnewWhat(tools.store, ctx, {
        entityId: who.id,
        // "Hvad vidste hun den 12. juni" betyder ved dagens udgang, ikke ved
        // midnat. Et uskarpt tidspunkt læses som "på det tidspunkt, senest".
        at: asInstant(args.tidspunkt, 'latest'),
        legId: leg?.id,
      });
      if (result.items.length === 0) {
        return `${result.entityName} ved ingenting på det tidspunkt.`;
      }
      const label = { stated: 'nedskrevet', derived: 'var til stede', carried: 'står på noget hun bærer' };
      const lines = result.items.map((item) => {
        const binds = Object.entries(item.binds);
        const detail = binds.length ? `  [${binds.map(([k, v]) => `${k}: ${v}`).join(', ')}]` : '';
        const via = item.viaObject ? ` — på "${item.viaObject}"` : '';
        const unsure = item.timeUnknown ? ' (eventet har ingen plads i tiden endnu)' : '';
        return `• ${item.summary} — ${say(BELIEF_DA, item.strength)} (${label[item.source]}${via})${unsure}\n${detail}`;
      });
      return `${result.entityName} ved:\n${lines.join('\n')}`;
    },
  }),

  defineTool({
    name: 'hvem_var_hvor',
    title: 'Hvem var hvor',
    description:
      'Hvem befandt sig hvor på et tidspunkt. Siger med vilje intet om, hvorvidt et sammenfald er '
      + 'et problem — samme person to steder er kun en fejl, hvis det er samme ben i samme lag.',
    inputSchema: {
      tidspunkt: timeArg.optional(),
      sted: z.string().optional(),
      person: z.string().optional(),
    },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const hits = whoWasWhere(tools.store, ctx, {
        from: asInstant(args.tidspunkt, 'earliest'),
        to: asInstant(args.tidspunkt, 'latest'),
        placeId: args.sted ? resolveEntity(tools.store, ctx, args.sted, 'place').id : undefined,
        entityId: args.person ? resolveEntity(tools.store, ctx, args.person, 'person').id : undefined,
      });
      if (hits.length === 0) return 'Ingen registreret tilstedeværelse der.';
      return hits.map((h) => {
        const leg = h.legOrdinal && h.legOrdinal > 1 ? ` (ben ${h.legOrdinal}${h.legLabel ? `, ${h.legLabel}` : ''})` : '';
        return `• ${h.entityName}${leg} — ${h.placeName} i ${h.realmName}, ${at(h.fromTime)} til ${at(h.toTime)}`;
      }).join('\n');
    },
  }),

  defineTool({
    name: 'hvad_ved_laeseren',
    title: 'Hvad ved læseren',
    description:
      'Hvad læseren har fået at vide til og med et kapitel. Sammenlign den med hvem_vidste_hvad — '
      + 'afstanden mellem de to er den dramatiske ironi.',
    inputSchema: {
      gennem_kapitel: z.number().describe('Kapitlets placering i læserækkefølgen'),
      vaerk: z.string().optional(),
    },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const workId = args.vaerk ? resolveWork(tools.store, ctx, args.vaerk).id : ctx.workId;
      if (!workId) throw new Error('Der er ikke valgt en bog.');
      const facts = whatReaderKnows(tools.store, ctx, {
        workId, throughChapterPosition: args.gennem_kapitel,
      });
      if (facts.length === 0) return `Læseren har intet fået at vide til og med kapitel ${args.gennem_kapitel}.`;
      return facts.map((f) => {
        const part = f.complete ? 'helt' : f.slots.length ? `kun: ${f.slots.join(', ')}` : 'antydet';
                // Kapitler tæller fra et i hver bog, så et nøgent kapitelnummer peger
        // to steder hen i en serie. Kommer det fra et tidligere bind, skal
        // bindet stå der.
        const where = f.fromEarlierWork
          ? `fra «${f.fromEarlierWork}», kapitel ${f.firstChapter}: ${f.firstChapterTitle}`
          : `fra kapitel ${f.firstChapter}: ${f.firstChapterTitle}`;
        return `• ${f.summary} — ${part} (${say(REVEAL_DA, f.strength)}, ${where})`;
      }).join('\n');
    },
  }),

  defineTool({
    name: 'vis_verdenslinje',
    title: 'Vis verdenslinje',
    description:
      'En persons ben i den rækkefølge, de blev levet. For alle andre end tidsrejsende er der ét.',
    inputSchema: { person: z.string() },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const who = resolveEntity(tools.store, ctx, args.person, 'person');
      const legs = worldline(tools.store, ctx, who.id);
      if (legs.length === 0) return `${who.name} har ingen ben registreret.`;
      return `${who.name}:\n` + legs.map((l) =>
        `  ${l.ordinal}. ${l.label ?? '(uden mærkat)'} — verdens tid ${at(l.worldStart)} til ${at(l.worldEnd)}`
        + `, egen tid ${at(l.personalStart)} til ${at(l.personalEnd)}`).join('\n');
    },
  }),

  defineTool({
    name: 'find',
    title: 'Find',
    description: 'Fritekst på tværs af bibelen og prosaen.',
    inputSchema: { tekst: z.string(), antal: z.number().optional() },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const hits = find(tools.store, ctx, args.tekst, args.antal ?? 30);
      if (hits.length === 0) return `Intet der matcher "${args.tekst}".`;
      return hits.map((h) => `• [${h.kind}] ${h.label}${h.detail ? ` — ${h.detail}` : ''}  (${h.id})`).join('\n');
    },
  }),

  defineTool({
    name: 'koer_tidsloesning',
    title: 'Kør tidsløsning',
    description:
      'Regner alle intervaller igennem ud fra båndene og skriver de fundne grænser tilbage. '
      + 'Melder to ting: et forløb, der er presset ned til ingenting, og en rækkefølge, der går i ring.',
    inputSchema: {},
    run: (_args, tools) => {
      const ctx = tools.bench.context();
      const report = solveTime(tools.store, ctx);
      const head = `Løst på ${report.iterations} gennemløb. ${report.updated} events fik nye grænser.`;
      if (report.findings.length === 0) return `${head}\nIngen problemer.`;
      return `${head}\n\n` + report.findings.map((f) =>
        `${f.severity === 'error' ? '✗' : '·'} ${f.message}`
        + (f.subjects.events?.length ? `\n   events: ${f.subjects.events.join(', ')}` : '')).join('\n');
    },
  }),
];
