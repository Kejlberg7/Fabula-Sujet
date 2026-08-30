import { z } from 'zod';
import {
  attachFactToCarrier, createFact, recordBelief, recordStatement, type SlotValue,
} from '../../core/services/knowledge';
import { createLaw, createSource, linkSource } from '../../core/services/laws';
import { rootRealmOf } from '../../core/services/world';
import { slotsOf } from '../../core/queries/bindings';
import type { Store } from '../../db/client';
import type { Context } from '../../core/workbench';
import { asInstant, defineTool, timeArg, write, type ToolDef } from '../kit';
import { resolveEntity, resolveEvent, resolveFact, resolveRealm, resolveSource } from '../resolve';

const slotValue = z.object({
  person: z.string().optional().describe('Navn eller id på en entitet'),
  tid: timeArg.optional(),
  tekst: z.string().optional(),
  tal: z.number().optional(),
});

function toSlotValue(
  store: Store, ctx: Context, raw: z.infer<typeof slotValue>,
): SlotValue {
  return {
    entityId: raw.person ? resolveEntity(store, ctx, raw.person).id : undefined,
    time: asInstant(raw.tid, 'earliest'),
    text: raw.tekst,
    number: raw.tal,
  };
}

function slotMap(store: Store, factId: string): Map<string, string> {
  return new Map(slotsOf(store, factId).map((s) => [s.name, s.id]));
}

function bindingsFrom(
  store: Store, ctx: Context, factId: string,
  binder: Record<string, z.infer<typeof slotValue>> | undefined,
): { slotIds: Map<string, string>; binds: Record<string, SlotValue> } | undefined {
  if (!binder) return undefined;
  const slotIds = slotMap(store, factId);
  const binds: Record<string, SlotValue> = {};
  for (const [name, raw] of Object.entries(binder)) {
    if (!slotIds.has(name)) {
      throw new Error(`Faktummet har ingen plads der hedder "${name}". Det har: ${[...slotIds.keys()].join(', ')}`);
    }
    binds[name] = toSlotValue(store, ctx, raw);
  }
  return { slotIds, binds };
}

export const knowledgeTools: ToolDef[] = [
  defineTool({
    name: 'registrer_faktum',
    title: 'Registrer faktum',
    description:
      'En påstand om verden, med pladser frem for en færdig sætning: draebte(gerningsmand, offer). '
      + 'Pladserne er hele pointen — delvis viden er en ubunden plads, at blive klogere er at binde '
      + 'én mere, falsk tro er at binde den forkerte, og en delvis afsløring er at give læseren én '
      + 'af dem. Lad en plads stå tom, hvis sandheden ikke er afgjort.',
    inputSchema: {
      paastand: z.string().describe('Kort maskinnavn, fx "draebte" eller "er_far_til"'),
      resume: z.string().describe('Sådan som du ville sige det højt'),
      pladser: z.array(z.object({
        navn: z.string(),
        slags: z.enum(['entity', 'time', 'place', 'text', 'number']),
        vaerdi: slotValue.optional().describe('Den sande udfyldning, hvis den er afgjort'),
      })).min(1),
      sandhed: z.enum(['true', 'false', 'disputed', 'undecided']).optional()
        .describe('"undecided" er et fortællegreb, ikke sjusk — motoren lader det være'),
      lag: z.string().optional().describe('Hvilket lag faktummet er sandt i'),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Faktum: ${args.resume}`, (session, ctx) =>
        createFact(session, ctx, {
          predicate: args.paastand, summary: args.resume, truth: args.sandhed,
          realmId: args.lag ? resolveRealm(tools.store, ctx, args.lag).id : rootRealmOf(tools.store, ctx),
          slots: args.pladser.map((p) => ({
            name: p.navn, valueKind: p.slags,
            value: p.vaerdi ? toSlotValue(tools.store, ctx, p.vaerdi) : undefined,
          })),
        }));
      return `Faktummet "${args.resume}" er oprettet med pladserne ${args.pladser.map((p) => p.navn).join(', ')}. (id: ${value.factId})`;
    },
  }),

  defineTool({
    name: 'registrer_overbevisning',
    title: 'Registrer overbevisning',
    description:
      'Hvad nogen mener at vide, fra et punkt i deres EGEN tid. Bind færre pladser end sandheden '
      + 'har, hvis de kun ved en del. "til" lader overbevisningen udløbe — amnesi i yderste fald, '
      + 'almindelig glemsomhed ellers. Det her slår altid det, motoren selv udleder.',
    inputSchema: {
      person: z.string(),
      faktum: z.string(),
      styrke: z.enum(['knows', 'convinced', 'suspects', 'mistaken', 'denies', 'unaware']),
      binder: z.record(z.string(), slotValue).optional().describe('Plads → værdi, kun dem hun har bundet'),
      fra: timeArg.optional().describe('I personens egen tid'),
      til: timeArg.optional().describe('Hvornår hun glemmer det igen'),
      ben: z.number().optional(),
      kilde_event: z.string().optional(),
      note: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `${args.person} ${args.styrke}: ${args.faktum}`, (session, ctx) => {
        const who = resolveEntity(tools.store, ctx, args.person, 'person');
        const theFact = resolveFact(tools.store, ctx, args.faktum);
        const bound = bindingsFrom(tools.store, ctx, theFact.id, args.binder);
        const legs = tools.store.sqlite
          .prepare('select id, ordinal from entity_leg where entity_id = ? and branch_id = ? order by ordinal')
          .all(who.id, ctx.branchId) as { id: string; ordinal: number }[];
        const leg = args.ben ? legs.find((l) => l.ordinal === args.ben) : legs[0];
        return recordBelief(session, ctx, {
          entityId: who.id, factId: theFact.id, strength: args.styrke, legId: leg?.id,
          sincePersonal: asInstant(args.fra, 'earliest'),
          untilPersonal: asInstant(args.til, 'latest'),
          sourceEventId: args.kilde_event ? resolveEvent(tools.store, ctx, args.kilde_event).id : undefined,
          note: args.note, slotIds: bound?.slotIds, binds: bound?.binds,
        });
      });
      return `Noteret: ${args.person} — ${args.styrke} — "${args.faktum}". (id: ${value})`;
    },
  }),

  defineTool({
    name: 'registrer_udsagn',
    title: 'Registrer udsagn',
    description:
      'Hvad nogen siger, til hvem, sandt eller ej. Taler og tilhører må gerne være samme person — '
      + 'at lyve for sig selv er både et fortællegreb og den mest almindelige form for '
      + 'karakterudvikling der findes.',
    inputSchema: {
      taler: z.string(),
      faktum: z.string(),
      sandt: z.boolean().optional(),
      tilhoerer: z.string().optional().describe('Udelad for noget sagt åbent'),
      binder: z.record(z.string(), slotValue).optional(),
      event: z.string().optional(),
      tid: timeArg.optional(),
      note: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `${args.taler} siger: ${args.faktum}`, (session, ctx) => {
        const theFact = resolveFact(tools.store, ctx, args.faktum);
        const bound = bindingsFrom(tools.store, ctx, theFact.id, args.binder);
        return recordStatement(session, ctx, {
          speakerEntityId: resolveEntity(tools.store, ctx, args.taler, 'person').id,
          factId: theFact.id, truthful: args.sandt,
          audienceEntityId: args.tilhoerer
            ? resolveEntity(tools.store, ctx, args.tilhoerer, 'person').id : undefined,
          eventId: args.event ? resolveEvent(tools.store, ctx, args.event).id : undefined,
          atTime: asInstant(args.tid, 'earliest'),
          note: args.note, slotIds: bound?.slotIds, binds: bound?.binds,
        });
      });
      const truth = args.sandt === false ? ' (og det passer ikke)' : '';
      return `Noteret: ${args.taler} siger "${args.faktum}"${truth}. (id: ${value})`;
    },
  }),

  defineTool({
    name: 'knyt_faktum_til_baerer',
    title: 'Knyt faktum til bærer',
    description:
      'Et faktum skrevet ned i en genstand: en polaroid, en tatovering, et brev. En persons '
      + 'virkelige viden er, hvad hun husker, plus hvad hun har på sig — og en seddel kan være '
      + 'forkert eller forfalsket.',
    inputSchema: {
      genstand: z.string(),
      faktum: z.string(),
      korrekt: z.boolean().optional().describe('Falsk for en seddel, der lyver'),
      binder: z.record(z.string(), slotValue).optional(),
      note: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `${args.genstand} bærer: ${args.faktum}`, (session, ctx) => {
        const theFact = resolveFact(tools.store, ctx, args.faktum);
        const bound = bindingsFrom(tools.store, ctx, theFact.id, args.binder);
        return attachFactToCarrier(session, ctx, {
          objectEntityId: resolveEntity(tools.store, ctx, args.genstand, 'object').id,
          factId: theFact.id, accurate: args.korrekt, note: args.note,
          slotIds: bound?.slotIds, binds: bound?.binds,
        });
      });
      return `Der står nu "${args.faktum}" på ${args.genstand}. (id: ${value})`;
    },
  }),

  defineTool({
    name: 'opret_lov',
    title: 'Opret lov',
    description:
      'Hvad der kan og ikke kan lade sig gøre her. En "ability" ophæver en indbygget regel for '
      + 'nogen bestemt — Anna kan flyve, så rejsetid gælder ikke hende. Et "prohibition" tilføjer '
      + 'en grænse, motoren ikke kendte. Hårde love peger på en regelkode og regnes på; bløde love '
      + 'er fritekst, som læses sammen med scenen. Love arves nedad gennem lagene.',
    inputSchema: {
      slags: z.enum(['ability', 'prohibition']),
      haardhed: z.enum(['hard', 'soft']),
      udsagn: z.string().describe('Loven, sagt på almindeligt dansk'),
      regel: z.string().optional().describe('Regelkode, fx "travel_time". Kræves for hårde love.'),
      omfang: z.enum(['world', 'series', 'work', 'realm']).optional(),
      omfang_id: z.string().optional(),
      subjekt: z.enum(['everyone', 'entity', 'entity_kind', 'carrier_holder']).optional(),
      subjekt_person: z.string().optional(),
      subjekt_udtryk: z.string().optional().describe('Fx navnet på den genstand, bæreren skal have'),
      gaelder_fra: timeArg.optional(),
      gaelder_til: timeArg.optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Lov: ${args.udsagn}`, (session, ctx) =>
        createLaw(session, ctx, {
          kind: args.slags, hardness: args.haardhed, statement: args.udsagn,
          ruleCode: args.regel, scopeKind: args.omfang, scopeId: args.omfang_id,
          subjectKind: args.subjekt,
          subjectEntityId: args.subjekt_person
            ? resolveEntity(tools.store, ctx, args.subjekt_person).id : undefined,
          subjectExpression: args.subjekt_udtryk,
          validFrom: asInstant(args.gaelder_fra, 'earliest'),
          validTo: asInstant(args.gaelder_til, 'latest'),
        }));
      return `Loven er noteret: "${args.udsagn}". (id: ${value})`;
    },
  }),

  defineTool({
    name: 'opret_kilde',
    title: 'Opret kilde',
    description:
      'Research: en note, et link, en PDF, en artikel eller et billede. Kilden gemmes og vises — '
      + 'den læses ikke maskinelt. De påstande, du udleder af den, hører hjemme som bløde love med '
      + 'kilden som ophav.',
    inputSchema: {
      titel: z.string(),
      slags: z.enum(['note', 'link', 'pdf', 'article', 'image', 'file']),
      url: z.string().optional(),
      sti: z.string().optional().describe('Sti til filen på disken'),
      note: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Kilde: ${args.titel}`, (session, ctx) =>
        createSource(session, ctx, {
          title: args.titel, kind: args.slags, url: args.url, filePath: args.sti, note: args.note,
        }));
      return `Kilden "${args.titel}" er gemt. (id: ${value})`;
    },
  }),

  defineTool({
    name: 'knyt_kilde',
    title: 'Knyt kilde',
    description:
      'Knytter en kilde til et faktum, en lov, et event, en person eller en scene. Angiv om den '
      + 'understøtter, giver kontekst eller er markeret som en mulig modstrid. Programmet læser '
      + 'aldrig selve filen for at gætte relationen.',
    inputSchema: {
      kilde: z.string(),
      maal_slags: z.enum(['fact', 'law', 'event', 'entity', 'scene', 'work']),
      maal: z.string().describe('Id på det, kilden bakker op'),
      relation: z.enum(['supports', 'context', 'conflicts']).optional(),
      citat: z.string().optional(),
      note: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Kildehenvisning`, (session, ctx) =>
        linkSource(session, ctx, {
          sourceId: resolveSource(tools.store, ctx, args.kilde).id,
          targetKind: args.maal_slags, targetId: args.maal,
          relation: args.relation, quote: args.citat, note: args.note,
        }));
      return `Kilden er knyttet til ${args.maal_slags} ${args.maal}. (id: ${value})`;
    },
  }),
];
