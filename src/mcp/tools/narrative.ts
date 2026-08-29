import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { chapter } from '../../db/schema';
import {
  createChapter, createReveal, createScene, linkSceneToEvent, saveSceneText,
} from '../../core/services/narrative';
import { createTextAnchor } from '../../core/services/narrative';
import { slotsOf } from '../../core/queries/bindings';
import { sceneDesk } from '../../core/queries/desk';
import { bandView } from '../../core/queries/band';
import { formatInstant } from '../../core/time/gregorian';
import { defineTool, made, write, type ToolDef } from '../kit';
import { resolveChapter, resolveEntity, resolveEvent, resolveFact, resolveRealm, resolveScene, resolveWork } from '../resolve';

function activeWork(tools: Parameters<ToolDef['run']>[1], given?: string): string {
  const ctx = tools.bench.context();
  if (given) return resolveWork(tools.store, ctx, given).id;
  if (!ctx.workId) throw new Error('Der er ikke valgt en bog. Brug saet_aktivt_vaerk eller angiv den.');
  return ctx.workId;
}

export const narrativeTools: ToolDef[] = [
  defineTool({
    name: 'opret_kapitel',
    title: 'Opret kapitel',
    description:
      'Et kapitel i læserækkefølge. Placeringen er den anden tidsakse — den har intet med '
      + 'kronologien at gøre, og det er netop afstanden mellem dem, der er fortællegrebet.',
    inputSchema: {
      titel: z.string(),
      placering: z.number().optional().describe('Udelad for at lægge det bagest'),
      resume: z.string().optional(),
      vaerk: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Kapitel: ${args.titel}`, (session, ctx) =>
        createChapter(session, ctx, tools.store, {
          workId: activeWork(tools, args.vaerk), title: args.titel,
          position: args.placering, summary: args.resume,
        }));
      return made('Kapitlet', args.titel, value);
    },
  }),

  defineTool({
    name: 'opret_scene',
    title: 'Opret scene',
    description:
      'Den mindste fortælleenhed. Synsvinkel og fortælleform er billige at skrive ned nu og dyre '
      + 'at eftermontere — og de er forudsætningen for at kunne opdage, at en scene fortalt fra '
      + 'Anna indeholder noget, kun Peter kunne vide.',
    inputSchema: {
      kapitel: z.string(),
      titel: z.string().optional(),
      synsvinkel: z.string().optional().describe('Hvem scenen fortælles fra'),
      person: z.enum(['first', 'second', 'third_limited', 'third_omniscient']).optional(),
      tid: z.enum(['past', 'present', 'future']).optional(),
      lag: z.string().optional().describe('Hvilket lag scenen foregår i'),
      resume: z.string().optional(),
      placering: z.number().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Scene i ${args.kapitel}`, (session, ctx) =>
        createScene(session, ctx, tools.store, {
          chapterId: resolveChapter(tools.store, ctx, args.kapitel).id,
          title: args.titel, position: args.placering,
          povEntityId: args.synsvinkel
            ? resolveEntity(tools.store, ctx, args.synsvinkel, 'person').id : undefined,
          narrationPerson: args.person, narrationTense: args.tid,
          realmId: args.lag ? resolveRealm(tools.store, ctx, args.lag).id : undefined,
          summary: args.resume,
        }));
      return made('Scenen', args.titel ?? '(uden titel)', value);
    },
  }),

  defineTool({
    name: 'knyt_scene_til_event',
    title: 'Knyt scene til event',
    description:
      'Hvilke hændelser scenen fortæller, og hvordan. Mange til mange med vilje: den samme hændelse '
      + 'fortalt fra to synsvinkler er to knytninger. Det er her, de to tidsakser mødes.',
    inputSchema: {
      scene: z.string(),
      event: z.string(),
      maade: z.enum(['dramatised', 'mentioned', 'implied']).optional(),
      note: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Scene fortæller ${args.event}`, (session, ctx) =>
        linkSceneToEvent(session, ctx, {
          sceneId: resolveScene(tools.store, ctx, args.scene).id,
          eventId: resolveEvent(tools.store, ctx, args.event).id,
          mode: args.maade, note: args.note,
        }));
      return `Scenen fortæller nu "${args.event}". (id: ${value})`;
    },
  }),

  defineTool({
    name: 'opret_afsloering',
    title: 'Opret afsløring',
    description:
      'Hvornår LÆSEREN får noget at vide — holdt strengt adskilt fra, hvornår personerne gør. '
      + 'Afstanden mellem de to er den dramatiske ironi. Nævn en plads for kun at give en del af '
      + 'faktummet væk: offeret i kapitel to, gerningsmanden i kapitel tredive.',
    inputSchema: {
      faktum: z.string(),
      scene: z.string(),
      plads: z.string().optional().describe('Navnet på den plads, der gives væk her'),
      styrke: z.enum(['hinted', 'implied', 'stated', 'confirmed']).optional(),
      note: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Afsløring: ${args.faktum}`, (session, ctx) => {
        const theFact = resolveFact(tools.store, ctx, args.faktum);
        let slotId: string | undefined;
        if (args.plads) {
          const all = slotsOf(tools.store, theFact.id);
          const hit = all.find((s) => s.name.toLowerCase() === args.plads!.toLowerCase());
          if (!hit) {
            throw new Error(`Faktummet har ingen plads der hedder "${args.plads}". Det har: ${all.map((s) => s.name).join(', ')}`);
          }
          slotId = hit.id;
        }
        return createReveal(session, ctx, {
          factId: theFact.id,
          sceneId: resolveScene(tools.store, ctx, args.scene).id,
          slotId, strength: args.styrke, note: args.note,
        });
      });
      const part = args.plads ? ` (kun "${args.plads}")` : '';
      return `Læseren får "${args.faktum}"${part} at vide her. (id: ${value})`;
    },
  }),

  defineTool({
    name: 'gem_scenetekst',
    title: 'Gem scenetekst',
    description:
      'Gemmer prosaen til en scene. Den forrige udgave bliver liggende, så "hvad stod der, før jeg '
      + 'skrev om" har et svar.',
    inputSchema: {
      scene: z.string(),
      tekst: z.string().describe('Markdown'),
      maerkat: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Tekst til scene`, (session, ctx) =>
        saveSceneText(session, ctx, tools.store, {
          sceneId: resolveScene(tools.store, ctx, args.scene).id,
          doc: { type: 'markdown', text: args.tekst },
          markdown: args.tekst, label: args.maerkat,
        }));
      const words = args.tekst.trim().split(/\s+/).filter(Boolean).length;
      return `Teksten er gemt (${words} ord). (id: ${value})`;
    },
  }),

  defineTool({
    name: 'vis_kapitler',
    title: 'Vis kapitler',
    description: 'Kapitlerne i læserækkefølge, med scener og hvilke events de fortæller.',
    inputSchema: { vaerk: z.string().optional() },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const workId = activeWork(tools, args.vaerk);
      const chapters = tools.store.db.select().from(chapter)
        .where(eq(chapter.workId, workId)).all()
        .sort((a, b) => a.position - b.position);
      if (chapters.length === 0) return 'Bogen har ingen kapitler endnu.';

      return chapters.map((c) => {
        const scenes = tools.store.sqlite.prepare(
          `select s.id, s.title, s.position,
                  (select group_concat(e.title, ' · ') from scene_event se
                     join event e on e.id = se.event_id
                    where se.scene_id = s.id and se.branch_id = ?) as events
             from scene s where s.chapter_id = ? and s.branch_id = ? order by s.position`,
        ).all(ctx.branchId, c.id, ctx.branchId) as
          { id: string; title: string | null; position: number; events: string | null }[];
        const body = scenes.length
          ? scenes.map((s) => `    ${s.position}. ${s.title ?? '(uden titel)'}${s.events ? ` — ${s.events}` : ''}`).join('\n')
          : '    (ingen scener)';
        return `${c.position}. ${c.title}\n${body}`;
      }).join('\n');
    },
  }),

  defineTool({
    name: 'vis_skrivebord',
    title: 'Vis skrivebordet for en scene',
    description:
      'De to svar, der standser et udkast: hvad synsvinklen ved lige her, og hvad læseren ved '
      + 'på dette sted i bogen. Afstanden mellem dem er den dramatiske ironi; et sammenfald, '
      + 'hvor læseren får noget udtalt, som synsvinklen ikke har, bliver meldt.',
    inputSchema: { scene: z.string() },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const found = resolveScene(tools.store, ctx, args.scene);
      const desk = sceneDesk(tools.store, ctx, { sceneId: found.id });

      const lines: string[] = [
        `${desk.scene.chapterPosition}. ${desk.scene.chapterTitle} — ${desk.scene.title ?? '(uden titel)'}`,
        desk.moment.at == null
          ? 'Ikke placeret i tiden: scenen er ikke knyttet til et event, der har en dato.'
          : `Sat ${formatInstant(desk.moment.at, 'day')}.`,
      ];

      if (desk.pov) {
        lines.push('', `${desk.pov.name}${desk.pov.legLabel ? ` (${desk.pov.legLabel})` : ''} ved her:`);
        lines.push(...(desk.pov.knows.length === 0
          ? ['  ingenting']
          : desk.pov.knows.map((k) => `  • ${k.summary} — ${k.strength}, ${k.source}`)));
      } else {
        lines.push('', 'Scenen har ingen synsvinkel, så der er ingen at svare for.');
      }

      lines.push('', 'Læseren ved på dette sted:');
      lines.push(...(desk.readerKnows.length === 0
        ? ['  ingenting endnu']
        : desk.readerKnows.map((f) =>
          `  • ${f.summary} — fra kapitel ${f.firstChapter}, ${f.strength}`
          + (f.complete ? '' : ' (ikke hele vejen)'))));

      if (desk.tells.length > 0) {
        lines.push('', 'Scenen fortæller:');
        lines.push(...desk.tells.map((t) =>
          `  • ${t.title} (${t.mode})${desk.pov && !t.povPresent ? ' — uden synsvinklen' : ''}`));
      }

      if (desk.leaks.length > 0) {
        lines.push('', 'Det klemmer:');
        lines.push(...desk.leaks.map((l) => `  ✗ ${l.message}`));
      }
      if (desk.lifted.length > 0) {
        lines.push('', `${desk.lifted.length} advarsel(er) er løftet af en lov: «${desk.lifted[0]!.lifted}»`);
      }
      if (desk.anchors.length > 0) {
        lines.push('', `${desk.anchors.length} tekstanker i scenen.`);
      }
      if (desk.prose.wordCount) {
        lines.push('', `Prosaen fylder ${desk.prose.wordCount} ord.`);
      }
      return lines.join('\n');
    },
  }),

  defineTool({
    name: 'vis_baand',
    title: 'Vis båndet mellem de to akser',
    description:
      'Kronologien mod læserækkefølgen, og hvor mange gange bogen springer bagud. '
      + 'Melder også det, der er lagt ind uden at være skrevet, og de scener, der ikke kan '
      + 'placeres i tiden, fordi de ikke hænger på et event.',
    inputSchema: { vaerk: z.string().optional() },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const band = bandView(tools.store, ctx, { workId: activeWork(tools, args.vaerk) });
      const lines = [
        band.stats.backwards === 0
          ? 'Bogen fortælles i den rækkefølge, tingene skete.'
          : `${band.stats.backwards} scene(r) springer bagud i tiden.`,
        `${band.stats.told} events bliver fortalt, ${band.stats.untold} er ikke skrevet endnu.`,
      ];
      if (band.stats.floating > 0) {
        lines.push(`${band.stats.floating} scene(r) hænger ikke på et event og kan ikke placeres.`);
      }
      if (band.stats.untold > 0) {
        lines.push('', 'Ikke fortalt endnu:');
        lines.push(...band.events.filter((e) => e.untold)
          .map((e) => `  • ${e.title} — ${formatInstant(e.from, 'day')}`));
      }
      lines.push('', 'Læserækkefølge mod kronologisk plads:');
      for (const s of band.scenes) {
        const ranks = band.ribbons.filter((r) => r.sceneId === s.sceneId)
          .map((r) => band.events.find((e) => e.eventId === r.eventId)?.rank)
          .filter((r): r is number => r != null);
        lines.push(`  ${s.order}. ${s.title} → kronologisk ${ranks.length ? ranks.join(', ') : '—'}`);
      }
      return lines.join('\n');
    },
  }),

  defineTool({
    name: 'saet_tekstanker',
    title: 'Sæt tekstanker',
    description:
      'Knytter et stykke prosa til det, det udtrykker. Ankret hænger på et mærke-id i '
      + 'dokumentet, aldrig på en tegnposition — positioner overlever ikke den næste rettelse, '
      + 'og et anker, der er skredet, er værre end intet anker.',
    inputSchema: {
      scene: z.string(),
      maerke_id: z.string().describe('Mærke-id fra dokumentet'),
      slags: z.enum(['event', 'fact', 'reveal', 'belief', 'beat', 'entity']),
      maal: z.string().describe('Hvad det peger på'),
      uddrag: z.string().optional(),
    },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const found = resolveScene(tools.store, ctx, args.scene);
      const targetId = args.slags === 'event' ? resolveEvent(tools.store, ctx, args.maal).id
        : args.slags === 'fact' ? resolveFact(tools.store, ctx, args.maal).id
        : args.slags === 'entity' ? resolveEntity(tools.store, ctx, args.maal).id
        : args.maal;
      const { value } = write(tools, 'Sæt tekstanker', (session, c) =>
        createTextAnchor(session, c, {
          sceneId: found.id, markId: args.maerke_id,
          targetKind: args.slags, targetId, excerpt: args.uddrag,
        }));
      return made('Tekstankret', `${args.slags} i «${found.title ?? args.scene}»`, value);
    },
  }),
];