import { z } from 'zod';
import {
  createEntity, createIdentity, createLeg, createPlaceLink, createRelationship,
  mergeEntities, recordDisappearance, recordEntityState, recordMemoryPolicy,
  recordPossession, recordPresence,
} from '../../core/services/entities';
import { rootRealmOf } from '../../core/services/world';
import { asInstant, asSpan, defineTool, made, timeArg, write, type ToolDef } from '../kit';
import { resolveEntity, resolveEvent, resolveRealm } from '../resolve';

export const entityTools: ToolDef[] = [
  defineTool({
    name: 'opret_entitet',
    title: 'Opret entitet',
    description:
      'En person, et sted, en genstand, en organisation eller et begreb. Personer får automatisk '
      + 'deres første ben — det afsnit af deres eget liv, som al deres viden hænger på.',
    inputSchema: {
      navn: z.string(),
      slags: z.enum(['person', 'place', 'object', 'organisation', 'concept']),
      resume: z.string().optional(),
      beskrivelse: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Opret ${args.slags}: ${args.navn}`, (session, ctx) =>
        createEntity(session, ctx, {
          name: args.navn, kind: args.slags,
          summary: args.resume, description: args.beskrivelse,
        }));
      return made('Entiteten', args.navn, value);
    },
  }),

  defineTool({
    name: 'opret_identitet',
    title: 'Opret identitet',
    description:
      'Et navn eller en skikkelse, en person optræder under. Én person kan have flere; at de er '
      + 'samme person er selv et faktum, som kan afsløres for læseren på et bestemt sted.',
    inputSchema: {
      person: z.string(),
      navn: z.string(),
      fra: timeArg.optional().describe('Hvornår navnet eller skikkelsen tages i brug'),
      til: timeArg.optional().describe('Hvornår navnet eller skikkelsen ophører'),
      note: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Identitet: ${args.navn}`, (session, ctx) =>
        createIdentity(session, ctx, {
          entityId: resolveEntity(tools.store, ctx, args.person, 'person').id,
          name: args.navn,
          validFrom: asInstant(args.fra, 'earliest'), validTo: asInstant(args.til, 'latest'),
          note: args.note,
        }));
      return made('Identiteten', args.navn, value);
    },
  }),

  defineTool({
    name: 'registrer_tilstand',
    title: 'Registrer tilstand',
    description:
      'En genstands eller anden entitets tilstand i et tidsrum. Kategorien samler værdier, der '
      + 'udelukker hinanden: fx kategori "lås" med værdierne "låst" og "åben". Overlap bliver '
      + 'fundet af genstandskontinuiteten.',
    inputSchema: {
      entitet: z.string(),
      kategori: z.string(),
      vaerdi: z.string(),
      fra: timeArg.optional(),
      til: timeArg.optional(),
      note: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Tilstand: ${args.entitet} er ${args.vaerdi}`, (session, ctx) =>
        recordEntityState(session, ctx, {
          entityId: resolveEntity(tools.store, ctx, args.entitet).id,
          category: args.kategori, value: args.vaerdi,
          fromTime: asInstant(args.fra, 'earliest'), toTime: asInstant(args.til, 'latest'),
          note: args.note,
        }));
      return `Noteret: ${args.entitet} er «${args.vaerdi}» i kategorien ${args.kategori}. (id: ${value})`;
    },
  }),

  defineTool({
    name: 'opret_ben',
    title: 'Opret ben',
    description:
      'Et afsnit af en persons egen tid. Alle har ét; en tidsrejsende har flere. Nummeret løber '
      + 'altid fremad i personens egen tid, uanset hvad verdens ur siger om, hvor de befinder sig. '
      + 'Det er dét, der gør, at det unge ben ikke ved, hvad det ældre ved.',
    inputSchema: {
      person: z.string(),
      nummer: z.number().describe('1, 2, 3 ... i personens egen rækkefølge'),
      maerkat: z.string().optional().describe('Fx "som Jane" eller "efter springet"'),
      personlig_start: timeArg.optional(),
      personlig_slut: timeArg.optional(),
      verdens_start: timeArg.optional(),
      verdens_slut: timeArg.optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Ben ${args.nummer} for ${args.person}`, (session, ctx) =>
        createLeg(session, ctx, tools.store, {
          entityId: resolveEntity(tools.store, ctx, args.person, 'person').id,
          ordinal: args.nummer,
          label: args.maerkat,
          personalStart: asInstant(args.personlig_start, 'earliest'),
          personalEnd: asInstant(args.personlig_slut, 'latest'),
          worldStart: asInstant(args.verdens_start, 'earliest'),
          worldEnd: asInstant(args.verdens_slut, 'latest'),
        }));
      return `Ben ${args.nummer}${args.maerkat ? ` (${args.maerkat})` : ''} er oprettet for ${args.person}. (id: ${value})`;
    },
  }),

  defineTool({
    name: 'registrer_hukommelse',
    title: 'Registrer hukommelse',
    description:
      'Hvor længe oplevelser bliver i en persons hukommelse fra et tidspunkt i personens eget liv. '
      + 'Udelad varigheden for permanent hukommelse. Nedskrevne fakta og udtrykkelige overbevisninger '
      + 'følger fortsat deres egne regler.',
    inputSchema: {
      person: z.string(),
      fra: timeArg.optional().describe('Fra dette tidspunkt i personens egen tid'),
      til: timeArg.optional().describe('Til dette tidspunkt i personens egen tid'),
      varighed: z.union([z.string(), z.number()]).optional().describe('Fx "15 minutter"; udeladt betyder permanent'),
      ben: z.number().optional().describe('Kun dette ben; udelad for hele personen'),
      note: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Hukommelse for ${args.person}`, (session, ctx) => {
        const who = resolveEntity(tools.store, ctx, args.person, 'person');
        const legs = tools.store.sqlite.prepare(
          'select id, ordinal from entity_leg where entity_id = ? and branch_id = ? order by ordinal',
        ).all(who.id, ctx.branchId) as { id: string; ordinal: number }[];
        const leg = args.ben == null ? undefined : legs.find((l) => l.ordinal === args.ben);
        if (args.ben != null && !leg) throw new Error(`${who.name} har ikke et ben nummer ${args.ben}.`);
        return recordMemoryPolicy(session, ctx, {
          entityId: who.id, legId: leg?.id,
          fromPersonal: asInstant(args.fra, 'earliest'),
          untilPersonal: asInstant(args.til, 'latest'),
          retentionSeconds: args.varighed == null ? null : asSpan(args.varighed),
          note: args.note,
        });
      });
      return `Hukommelsesreglen er registreret for ${args.person}. (id: ${value})`;
    },
  }),

  defineTool({
    name: 'registrer_tilstedevaerelse',
    title: 'Registrer tilstedeværelse',
    description:
      'Hvem var hvor, hvornår, i hvilket lag. To tilstedeværelser af samme ben i samme lag på '
      + 'samme tid er bilokation; forskellige ben er tidsrejse, og forskellige lag er en krop, '
      + 'der sover ovenpå.',
    inputSchema: {
      person: z.string(),
      sted: z.string(),
      fra: timeArg.optional(),
      til: timeArg.optional(),
      lag: z.string().optional(),
      ben: z.number().optional().describe('Benets nummer. Udelad, hvis personen kun har ét.'),
      note: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `${args.person} på ${args.sted}`, (session, ctx) => {
        const who = resolveEntity(tools.store, ctx, args.person, 'person');
        const where = resolveEntity(tools.store, ctx, args.sted, 'place');
        const legs = tools.store.sqlite
          .prepare('select id, ordinal from entity_leg where entity_id = ? and branch_id = ? order by ordinal')
          .all(who.id, ctx.branchId) as { id: string; ordinal: number }[];
        const leg = args.ben ? legs.find((l) => l.ordinal === args.ben) : legs[0];
        if (args.ben && !leg) throw new Error(`${who.name} har ikke et ben nummer ${args.ben}.`);
        return recordPresence(session, ctx, {
          entityId: who.id, placeId: where.id,
          realmId: args.lag ? resolveRealm(tools.store, ctx, args.lag).id : rootRealmOf(tools.store, ctx),
          legId: leg?.id,
          fromTime: asInstant(args.fra, 'earliest'),
          toTime: asInstant(args.til, 'latest'),
          note: args.note,
        });
      });
      return `Noteret: ${args.person} var på ${args.sted}. (id: ${value})`;
    },
  }),

  defineTool({
    name: 'registrer_besiddelse',
    title: 'Registrer besiddelse',
    description:
      'Hvem bærer hvad, hvornår. Det er dét, der afgør, om en person kan handle på noget, hun kun '
      + 'ved fra en seddel — eller om sedlen lå hjemme.',
    inputSchema: {
      baerer: z.string(),
      genstand: z.string(),
      fra: timeArg.optional(),
      til: timeArg.optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `${args.baerer} bærer ${args.genstand}`, (session, ctx) =>
        recordPossession(session, ctx, {
          holderEntityId: resolveEntity(tools.store, ctx, args.baerer, 'person').id,
          objectEntityId: resolveEntity(tools.store, ctx, args.genstand, 'object').id,
          fromTime: asInstant(args.fra, 'earliest'),
          toTime: asInstant(args.til, 'latest'),
        }));
      return `Noteret: ${args.baerer} har ${args.genstand} på sig. (id: ${value})`;
    },
  }),

  defineTool({
    name: 'opret_relation',
    title: 'Opret relation',
    description:
      'Et forhold mellem to entiteter, gyldigt i et tidsrum. Venner indtil kapitel tolv og fjender '
      + 'derefter er to relationer, ikke én, der bliver rettet.',
    inputSchema: {
      fra: z.string(),
      til: z.string(),
      slags: z.string().describe('Fx "mor til", "forråder", "forelsket i"'),
      kategori: z.string().optional()
        .describe('Fx "loyalitet". Værdier i samme kategori må ikke overlappe'),
      gensidig: z.boolean().optional(),
      fra_tid: timeArg.optional(),
      til_tid: timeArg.optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `${args.fra} ${args.slags} ${args.til}`, (session, ctx) =>
        createRelationship(session, ctx, {
          fromEntityId: resolveEntity(tools.store, ctx, args.fra).id,
          toEntityId: resolveEntity(tools.store, ctx, args.til).id,
          kind: args.slags, category: args.kategori, symmetric: args.gensidig,
          fromTime: asInstant(args.fra_tid, 'earliest'),
          toTime: asInstant(args.til_tid, 'latest'),
        }));
      return `Noteret: ${args.fra} — ${args.slags} — ${args.til}. (id: ${value})`;
    },
  }),

  defineTool({
    name: 'registrer_forsvinding',
    title: 'Registrer forsvinding',
    description:
      'Markerer eventet hvor en person eller ting forsvinder og eventuelt eventet hvor den kommer '
      + 'tilbage. En sikker optræden midt i hullet bliver meldt; en uskarp dato bliver ladt i fred.',
    inputSchema: {
      entitet: z.string(),
      forsvinder_i: z.string(),
      vender_tilbage_i: z.string().optional(),
      note: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Forsvinding: ${args.entitet}`, (session, ctx) =>
        recordDisappearance(session, ctx, {
          entityId: resolveEntity(tools.store, ctx, args.entitet).id,
          disappearsEventId: resolveEvent(tools.store, ctx, args.forsvinder_i).id,
          returnsEventId: args.vender_tilbage_i
            ? resolveEvent(tools.store, ctx, args.vender_tilbage_i).id : undefined,
          note: args.note,
        }));
      return `${args.entitet}s forsvinding er registreret. (id: ${value})`;
    },
  }),

  defineTool({
    name: 'opret_rejseforbindelse',
    title: 'Opret rejseforbindelse',
    description:
      'Rejsetid mellem to steder, per transportmåde. Stedgrafen er hård: den kan ikke brydes, '
      + 'medmindre en udtrykkelig evne tillader det.',
    inputSchema: {
      fra_sted: z.string(),
      til_sted: z.string(),
      transport: z.string().describe('Fx "til fods", "med tog", "på hest"'),
      rejsetid: z.union([z.string(), z.number()]).describe('Fx "2 dage" eller "4 timer"'),
      rejsetid_hoejst: z.union([z.string(), z.number()]).optional(),
      begge_veje: z.boolean().optional(),
      lag: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `${args.fra_sted} → ${args.til_sted}`, (session, ctx) =>
        createPlaceLink(session, ctx, {
          realmId: args.lag ? resolveRealm(tools.store, ctx, args.lag).id : rootRealmOf(tools.store, ctx),
          fromPlaceId: resolveEntity(tools.store, ctx, args.fra_sted, 'place').id,
          toPlaceId: resolveEntity(tools.store, ctx, args.til_sted, 'place').id,
          mode: args.transport,
          travelMin: asSpan(args.rejsetid),
          travelMax: asSpan(args.rejsetid_hoejst ?? args.rejsetid),
          bidirectional: args.begge_veje ?? true,
        }));
      return `Noteret: ${args.fra_sted} til ${args.til_sted} tager ${args.rejsetid} ${args.transport}. (id: ${value})`;
    },
  }),

  defineTool({
    name: 'flet_entiteter',
    title: 'Flet entiteter',
    description:
      'Når "Anna" og "Anna Berg" viser sig at være den samme. Alle henvisninger peger om, og den '
      + 'ene forsvinder. Det hele sker i én tur, så en fletning lavet i vildfarelse er ét fortryd væk.',
    inputSchema: {
      behold: z.string().describe('Den, der skal blive tilbage'),
      flet: z.string().describe('Den, der skal opsluges'),
    },
    run: (args, tools) => {
      const { value, receipt } = write(tools, `Flet ${args.flet} ind i ${args.behold}`, (session, ctx) =>
        mergeEntities(session, tools.store, ctx, {
          keepId: resolveEntity(tools.store, ctx, args.behold).id,
          mergeId: resolveEntity(tools.store, ctx, args.flet).id,
        }));
      return `"${args.flet}" er flettet ind i "${args.behold}". ${value.moved} henvisninger peger nu om.${receipt}`;
    },
  }),
];
