import { z } from 'zod';
import { addParticipation, addTemporalLink, createEvent, linkEventFact } from '../../core/services/events';
import { rootRealmOf } from '../../core/services/world';
import { slotsOf } from '../../core/queries/bindings';
import { asInstant, asSpan, defineTool, made, timeArg, write, type ToolDef } from '../kit';
import { resolveEntity, resolveEvent, resolveFact, resolveRealm } from '../resolve';

export const eventTools: ToolDef[] = [
  defineTool({
    name: 'opret_event',
    title: 'Opret event',
    description:
      'Noget der skete. Giv ikke et tidspunkt, men et spænd: "tidligst" og "senest". "1985" betyder '
      + 'et helt år, "1985-06" en måned. Ved du ingenting om tidspunktet, så udelad begge — så finder '
      + 'løseren det selv ud fra båndene til andre events.',
    inputSchema: {
      titel: z.string(),
      resume: z.string().optional(),
      sted: z.string().optional(),
      tidligst: timeArg.optional(),
      senest: timeArg.optional(),
      varighed: z.union([z.string(), z.number()]).optional().describe('Fx "20 min" eller "3 dage"'),
      lag: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Event: ${args.titel}`, (session, ctx) =>
        createEvent(session, ctx, {
          title: args.titel, summary: args.resume,
          realmId: args.lag ? resolveRealm(tools.store, ctx, args.lag).id : rootRealmOf(tools.store, ctx),
          placeId: args.sted ? resolveEntity(tools.store, ctx, args.sted, 'place').id : undefined,
          earliest: asInstant(args.tidligst, 'earliest'),
          latest: asInstant(args.senest ?? args.tidligst, 'latest'),
          durationMin: asSpan(args.varighed),
          durationMax: asSpan(args.varighed),
        }));
      return made('Eventet', args.titel, value);
    },
  }),

  defineTool({
    name: 'tilfoej_tidsbaand',
    title: 'Tilføj tidsbånd',
    description:
      'Bind to events sammen: "B sker tre dage efter A", "A før B". Løseren strammer intervallerne '
      + 'ud fra båndene, så du kan sige, hvad du ved, uden at opfinde datoer, du ikke har besluttet. '
      + 'Akse "personal" bruges, når båndet gælder en persons egen tid frem for verdens — det er '
      + 'dét, en tidsrejsendes eget liv adlyder.',
    inputSchema: {
      fra_event: z.string(),
      til_event: z.string(),
      slags: z.enum(['before', 'after', 'same_time', 'offset', 'during']),
      forskydning: z.union([z.string(), z.number()]).optional().describe('Til "offset": fx "3 dage"'),
      forskydning_hoejst: z.union([z.string(), z.number()]).optional(),
      akse: z.enum(['world', 'personal']).optional(),
      note: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `Bånd: ${args.fra_event} ${args.slags} ${args.til_event}`, (session, ctx) =>
        addTemporalLink(session, ctx, {
          fromEventId: resolveEvent(tools.store, ctx, args.fra_event).id,
          toEventId: resolveEvent(tools.store, ctx, args.til_event).id,
          kind: args.slags,
          offsetMin: asSpan(args.forskydning),
          offsetMax: asSpan(args.forskydning_hoejst ?? args.forskydning),
          axis: args.akse,
          note: args.note,
        }));
      return `Båndet er sat. Kør koer_tidsloesning for at se, hvad det strammer. (id: ${value})`;
    },
  }),

  defineTool({
    name: 'tilfoej_deltager',
    title: 'Tilføj deltager',
    description:
      'Hvem deltog, og hvordan. Rollen afgør, hvad de får med sig: "actor", "witness" og "victim" '
      + 'tager til sig, hvad eventet blotlagde, mens "present_unaware" var der uden at opdage noget. '
      + 'Sæt "opfatter" til falsk for den, der var i rummet, men overhørte det — uden den ventil '
      + 'opfinder ét selskab hundrede overbevisninger.',
    inputSchema: {
      event: z.string(),
      person: z.string(),
      rolle: z.enum(['actor', 'witness', 'victim', 'present_unaware', 'mentioned']),
      ben: z.number().optional(),
      opfatter: z.boolean().optional(),
      note: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `${args.person} i ${args.event}`, (session, ctx) => {
        const who = resolveEntity(tools.store, ctx, args.person, 'person');
        const legs = tools.store.sqlite
          .prepare('select id, ordinal from entity_leg where entity_id = ? and branch_id = ? order by ordinal')
          .all(who.id, ctx.branchId) as { id: string; ordinal: number }[];
        const leg = args.ben ? legs.find((l) => l.ordinal === args.ben) : legs[0];
        if (args.ben && !leg) throw new Error(`${who.name} har ikke et ben nummer ${args.ben}.`);
        return addParticipation(session, ctx, {
          eventId: resolveEvent(tools.store, ctx, args.event).id,
          entityId: who.id, legId: leg?.id, role: args.rolle,
          absorbsKnowledge: args.opfatter, note: args.note,
        });
      });
      return `${args.person} deltager i "${args.event}" som ${args.rolle}. (id: ${value})`;
    },
  }),

  defineTool({
    name: 'knyt_event_til_faktum',
    title: 'Knyt event til faktum',
    description:
      'Hvad eventet lægger på bordet. Uden det ved motoren, at Anna var i rummet, men ikke hvad '
      + 'rummet indeholdt. Nævn "pladser" for kun at blotlægge en del: skriget siger, at nogen døde, '
      + 'ikke hvem der gjorde det.',
    inputSchema: {
      event: z.string(),
      faktum: z.string(),
      blotlaegger: z.enum(['establishes', 'reveals', 'evidences']).optional(),
      pladser: z.array(z.string()).optional().describe('Navne på de pladser, eventet afslører'),
      note: z.string().optional(),
    },
    run: (args, tools) => {
      const { value } = write(tools, `${args.event} blotlægger ${args.faktum}`, (session, ctx) => {
        const theFact = resolveFact(tools.store, ctx, args.faktum);
        let slotIds: string[] | undefined;
        if (args.pladser?.length) {
          const all = slotsOf(tools.store, theFact.id);
          slotIds = args.pladser.map((name) => {
            const hit = all.find((s) => s.name.toLowerCase() === name.toLowerCase());
            if (!hit) {
              throw new Error(
                `Faktummet har ingen plads der hedder "${name}". Det har: ${all.map((s) => s.name).join(', ')}`,
              );
            }
            return hit.id;
          });
        }
        return linkEventFact(session, ctx, {
          eventId: resolveEvent(tools.store, ctx, args.event).id,
          factId: theFact.id, exposes: args.blotlaegger, slotIds, note: args.note,
        });
      });
      const part = args.pladser?.length ? ` (kun ${args.pladser.join(', ')})` : '';
      return `"${args.event}" blotlægger nu "${args.faktum}"${part}. (id: ${value})`;
    },
  }),
];
