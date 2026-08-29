import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { branch, realm, series, work, world } from '../../db/schema';
import {
  createRealm, createSeries, createWork, createWorld, defaultTimeSystemOf, rootRealmOf,
} from '../../core/services/world';
import { asInstant, defineTool, made, timeArg, write, type ToolDef } from '../kit';
import { resolveRealm, resolveWork } from '../resolve';

export const worldTools: ToolDef[] = [
  defineTool({
    name: 'opret_verden',
    title: 'Opret verden',
    description:
      'Opretter et univers. Flere serier og enkeltstående bøger kan dele det, i hver sin tid og egn. '
      + 'Verdenen får en hovedgren, et gregoriansk tidssystem og laget "Virkeligheden" med det samme, '
      + 'og bliver den aktive.',
    inputSchema: {
      navn: z.string().describe('Verdenens navn'),
      beskrivelse: z.string().optional(),
    },
    run: (args, tools) => {
      const created = createWorld(tools.store, { name: args.navn, summary: args.beskrivelse });
      tools.bench.setActive({ worldId: created.worldId, userId: created.userId });
      return `Verdenen "${args.navn}" er oprettet og er nu den aktive. (id: ${created.worldId})\n`
        + `Den har grenen "hoved" og laget "Virkeligheden".`;
    },
  }),

  defineTool({
    name: 'saet_aktivt_vaerk',
    title: 'Sæt aktivt værk',
    description:
      'Vælger hvilken verden, bog og gren alt det følgende hører til. Sæt den én gang, '
      + 'så behøver du ikke nævne bogen i hver sætning bagefter.',
    inputSchema: {
      verden: z.string().optional().describe('Navn eller id. Udelad for at blive i den nuværende.'),
      vaerk: z.string().optional().describe('Navn eller id på bogen'),
      gren: z.string().optional().describe('Navn eller id på grenen'),
    },
    run: (args, tools) => {
      const current = tools.bench.peek();
      let worldId = current?.worldId;
      if (args.verden) {
        const worlds = tools.store.db.select().from(world).all();
        const hit = worlds.find((w) => w.id === args.verden)
          ?? worlds.find((w) => w.name.toLowerCase() === args.verden!.toLowerCase())
          ?? worlds.find((w) => w.name.toLowerCase().includes(args.verden!.toLowerCase()));
        if (!hit) throw new Error(`Jeg kan ikke finde en verden der hedder "${args.verden}".`);
        worldId = hit.id;
      }
      if (!worldId) throw new Error('Der er ingen verden endnu. Opret en med opret_verden.');

      let branchId: string | undefined;
      if (args.gren) {
        const branches = tools.store.db.select().from(branch).where(eq(branch.worldId, worldId)).all();
        const hit = branches.find((b) => b.id === args.gren)
          ?? branches.find((b) => b.name.toLowerCase() === args.gren!.toLowerCase());
        if (!hit) throw new Error(`Jeg kan ikke finde en gren der hedder "${args.gren}".`);
        branchId = hit.id;
      }

      const ctx = tools.bench.setActive({ worldId, branchId });
      let workId = ctx.workId;
      let note = '';
      if (args.vaerk) {
        workId = resolveWork(tools.store, ctx, args.vaerk).id;
      } else if (!workId) {
        // setActive picks the book when there is only one; say so when there
        // are several, so the next sentence does not land in the wrong place.
        const inWorld = tools.store.db.select().from(work)
          .where(eq(work.worldId, worldId)).all()
          .filter((w) => w.branchId === ctx.branchId);
        if (inWorld.length > 1) {
          note = `\nDer er flere bøger her: ${inWorld.map((w) => w.title).join(', ')}. Sig hvilken.`;
        }
      }
      const next = tools.bench.setActive({ worldId, branchId: ctx.branchId, workId });

      const workTitle = next.workId
        ? tools.store.db.select().from(work).where(eq(work.id, next.workId)).get()?.title
        : null;
      return `Nu arbejder vi i verdenen "${tools.bench.worldName(next.worldId)}"`
        + (workTitle ? `, på bogen "${workTitle}"` : ', uden en bog valgt')
        + `, på grenen "${tools.store.db.select().from(branch).where(eq(branch.id, next.branchId)).get()?.name}".`
        + note;
    },
  }),

  defineTool({
    name: 'hent_kontekst',
    title: 'Hent kontekst',
    description: 'Hvor er vi, og hvad findes der. Kald den, når du er i tvivl om, hvad der allerede er lagt ind.',
    inputSchema: {},
    run: (_args, tools) => {
      const ctx = tools.bench.peek();
      if (!ctx) return 'Der er ikke valgt en verden endnu. Opret en med opret_verden.';
      const count = (table: string) =>
        (tools.store.sqlite.prepare(`select count(*) as n from "${table}" where branch_id = ?`)
          .get(ctx.branchId) as { n: number }).n;
      const workTitle = ctx.workId
        ? tools.store.db.select().from(work).where(eq(work.id, ctx.workId)).get()?.title
        : null;
      const realms = tools.store.db.select().from(realm).where(eq(realm.branchId, ctx.branchId)).all();
      return [
        `Verden: ${tools.bench.worldName(ctx.worldId)}`,
        `Bog: ${workTitle ?? '(ingen valgt)'}`,
        `Lag: ${realms.map((r) => r.name).join(', ')}`,
        '',
        `Entiteter: ${count('entity')}`,
        `Events: ${count('event')}`,
        `Fakta: ${count('fact')}`,
        `Love: ${count('law')}`,
        `Kapitler: ${count('chapter')}   Scener: ${count('scene')}`,
      ].join('\n');
    },
  }),

  defineTool({
    name: 'opret_lag',
    title: 'Opret lag',
    description:
      'Et lag er en verden inde i verdenen: en drøm, en simulation, en virtuel verden, en historie '
      + 'nogen fortæller, eller en sidetidslinje. Tidsforholdet siger, hvor mange gange hurtigere det '
      + 'løber end laget over — 20 betyder tyve gange. Holdepunkterne fæstner de to ure til hinanden; '
      + 'uden dem kan lagets tidspunkter ikke sammenlignes med noget udenfor.',
    inputSchema: {
      navn: z.string(),
      slags: z.enum(['reality', 'dream', 'simulation', 'story', 'timeline', 'other']),
      forlaeg: z.string().optional().describe('Navn eller id på laget udenom. Udelad for virkeligheden.'),
      tidsforhold: z.number().optional().describe('Hvor mange gange hurtigere end laget over. Standard 1.'),
      forlaeg_holdepunkt: timeArg.optional().describe('Tidspunkt i forældrelaget, hvor lagene mødes'),
      lokalt_holdepunkt: timeArg.optional().describe('Lagets eget tidspunkt samme øjeblik'),
      beskrivelse: z.string().optional(),
    },
    run: (args, tools) => {
      const { value, receipt } = write(tools, `Opret lag: ${args.navn}`, (session, ctx) => {
        const parent = args.forlaeg
          ? resolveRealm(tools.store, ctx, args.forlaeg).id
          : rootRealmOf(tools.store, ctx);
        return createRealm(session, ctx, {
          name: args.navn,
          kind: args.slags,
          parentRealmId: args.slags === 'reality' ? undefined : parent,
          timeSystemId: defaultTimeSystemOf(tools.store, ctx),
          timeRatio: args.tidsforhold,
          parentEpoch: asInstant(args.forlaeg_holdepunkt, 'earliest'),
          localEpoch: asInstant(args.lokalt_holdepunkt, 'earliest'),
          summary: args.beskrivelse,
        });
      });
      const anchored = args.forlaeg_holdepunkt != null && args.lokalt_holdepunkt != null;
      return made('Laget', args.navn, value)
        + (anchored ? '' : '\nBemærk: laget er ikke fæstnet til sit forældrelag, så dets tidspunkter kan ikke sammenlignes udenfor. Sæt holdepunkterne, når du ved, hvornår man går ind i det.')
        + receipt;
    },
  }),

  defineTool({
    name: 'opret_serie',
    title: 'Opret serie',
    description: 'En valgfri gruppering af bøger inde i verdenen.',
    inputSchema: { navn: z.string(), beskrivelse: z.string().optional() },
    run: (args, tools) => {
      const { value } = write(tools, `Opret serie: ${args.navn}`, (session, ctx) =>
        createSeries(session, ctx, { name: args.navn, summary: args.beskrivelse }));
      return made('Serien', args.navn, value);
    },
  }),

  defineTool({
    name: 'opret_vaerk',
    title: 'Opret værk',
    description:
      'En bog. Den hører til den aktive verden og kan valgfrit høre til en serie. Bliver den aktive bog.',
    inputSchema: {
      titel: z.string(),
      serie: z.string().optional().describe('Navn eller id. Udelad for en enkeltstående bog.'),
      beskrivelse: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Opret værk: ${args.titel}`, (session, ctx) => {
        let seriesId: string | undefined;
        if (args.serie) {
          const all = tools.store.db.select().from(series).where(eq(series.worldId, ctx.worldId)).all();
          const hit = all.find((s) => s.id === args.serie)
            ?? all.find((s) => s.name.toLowerCase() === args.serie!.toLowerCase());
          if (!hit) throw new Error(`Jeg kan ikke finde en serie der hedder "${args.serie}".`);
          seriesId = hit.id;
        }
        return createWork(session, ctx, { title: args.titel, seriesId, summary: args.beskrivelse });
      });
      const ctx = tools.bench.context();
      tools.bench.setActive({ worldId: ctx.worldId, branchId: ctx.branchId, workId: value });
      return `${made('Bogen', args.titel, value)} Den er nu den aktive.`;
    },
  }),
];
