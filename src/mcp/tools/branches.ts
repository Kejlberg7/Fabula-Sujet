import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { branch, change, checkpoint } from '../../db/schema';
import {
  compareBranches, createBranchFromHistory, moveChapter, moveReveal, moveScene,
  setBranchArchived, setDefaultBranch, transferBranchDifference,
} from '../../core/branches';
import { defineTool, write, type ToolDef } from '../kit';
import {
  resolveBranch, resolveChapter, resolveReveal, resolveScene,
} from '../resolve';

const branchState = (item: typeof branch.$inferSelect) =>
  `${item.isDefault ? ' [hovedspor]' : ''}${item.archivedAt ? ' [arkiveret]' : ''}`;

export const branchTools: ToolDef[] = [
  defineTool({
    name: 'vis_grene',
    title: 'Vis grene',
    description:
      'Viser fortællingens alternative spor, deres forældre og forgreningspunkter. En arkiveret '
      + 'gren er gemt, ikke slettet.',
    inputSchema: {},
    run: (_args, tools) => {
      const ctx = tools.bench.context();
      const rows = tools.store.db.select().from(branch).where(eq(branch.worldId, ctx.worldId)).all();
      const names = new Map(rows.map((item) => [item.id, item.name]));
      return rows.map((item) => {
        const active = item.id === ctx.branchId ? ' [valgt]' : '';
        const parent = item.parentBranchId ? ` · fra ${names.get(item.parentBranchId) ?? 'ukendt'} ved trin ${item.forkChangeSeq}` : '';
        return `${item.name}${active}${branchState(item)}${parent} (id: ${item.id})`;
      }).join('\n');
    },
  }),

  defineTool({
    name: 'opret_gren',
    title: 'Opret gren',
    description:
      'Starter et selvstændigt fortællespor fra nu, et nedslag eller et synligt trinnummer. '
      + 'Kildegrenen røres ikke, og den nye gren vælges med det samme.',
    inputSchema: {
      navn: z.string(),
      nedslag: z.string().optional().describe('Mærkat eller id på et nedslag'),
      trin: z.number().optional().describe('Trinnummer fra historikken'),
    },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      let seq = args.trin;
      if (args.nedslag) {
        const marks = tools.store.db.select().from(checkpoint)
          .where(eq(checkpoint.branchId, ctx.branchId)).all();
        const hit = marks.find((item) => item.id === args.nedslag)
          ?? marks.find((item) => item.label.toLowerCase() === args.nedslag!.toLowerCase());
        if (!hit) throw new Error(`Jeg kan ikke finde et nedslag, der hedder «${args.nedslag}».`);
        seq = hit.changeSeq;
      }
      if (seq == null) {
        seq = tools.store.db.select({ max: sql<number | null>`max(${change.seq})` }).from(change)
          .where(eq(change.branchId, ctx.branchId)).get()?.max ?? 0;
      }
      const created = createBranchFromHistory(tools.store, {
        sourceBranchId: ctx.branchId,
        sourceWorkId: ctx.workId,
        name: args.navn,
        changeSeq: seq,
        actor: tools.actor,
      });
      tools.bench.setActive({
        worldId: ctx.worldId, branchId: created.branchId, workId: created.workId,
      });
      return `Grenen «${args.navn}» er oprettet fra trin ${seq} og valgt. `
        + `${created.copiedRows} fortællerækker blev kopieret; originalen er urørt. `
        + `(id: ${created.branchId})`;
    },
  }),

  defineTool({
    name: 'sammenlign_grene',
    title: 'Sammenlign grene',
    description:
      'Sammenligner den valgte gren med en anden og viser flyttede kapitler, scener, afsløringer '
      + 'og ændret prosa. Grenene ændres ikke.',
    inputSchema: { med: z.string().describe('Navn eller id på den anden gren') },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      if (!ctx.workId) throw new Error('Der er ikke valgt en bog.');
      const other = resolveBranch(tools.store, ctx, args.med);
      const compared = compareBranches(tools.store, {
        leftBranchId: ctx.branchId, rightBranchId: other.id, workId: ctx.workId,
      });
      if (compared.differences.length === 0) return `«${other.name}» er endnu identisk med den valgte gren.`;
      return compared.differences.map((item) => {
        const conflict = item.conflict ? ' · konflikt: den valgte gren er også ændret' : '';
        const blocked = item.canTransfer ? '' : ` · kan ikke stå alene: ${item.transferNote}`;
        const prose = item.detail
          ? `\n  før: ${item.detail.before}${item.detail.removed}${item.detail.after}`
            + `\n  efter: ${item.detail.before}${item.detail.added}${item.detail.after}`
          : '';
        return `${item.label}: ${item.left ?? '—'} → ${item.right ?? '—'} (${item.kind}${conflict}${blocked})`
          + `${prose}\n  forskel-id: ${item.id}`;
      }).join('\n');
    },
  }),

  defineTool({
    name: 'overfoer_forskel',
    title: 'Overfør forskel',
    description:
      'Overfører præcis én navngiven forskel fra en anden gren til den valgte gren. '
      + 'Sammenlign først; konflikter og det, der bliver erstattet, står dér. Handlingen kan fortrydes.',
    inputSchema: {
      fra: z.string().describe('Navn eller id på grenen, ændringen kommer fra'),
      forskel: z.string().describe('Forskel-id fra sammenlign_grene'),
    },
    run: async (args, tools) => {
      const ctx = tools.bench.context();
      if (!ctx.workId) throw new Error('Der er ikke valgt en bog.');
      const source = resolveBranch(tools.store, ctx, args.fra);
      const compared = compareBranches(tools.store, {
        leftBranchId: ctx.branchId, rightBranchId: source.id, workId: ctx.workId,
      });
      const difference = compared.differences.find((item) => item.id === args.forskel);
      if (!difference) throw new Error('Forskellen findes ikke længere. Sammenlign grenene igen.');
      if (difference.detail) {
        const answer = await tools.askWriter({
          question: `Må prosaen i «${difference.label}» erstattes med teksten fra «${source.name}»?`,
          detail: `Nuværende uddrag:\n${difference.detail.before}${difference.detail.removed}${difference.detail.after}`
            + `\n\nUddrag efter overførsel:\n${difference.detail.before}${difference.detail.added}${difference.detail.after}`,
        });
        if (answer !== 'ja') {
          if (answer === 'kan_ikke_spoerge') {
            throw new Error('Klienten kan ikke spørge forfatteren om lov, så prosaen blev ikke ændret.');
          }
          return 'Prosaen blev ikke ændret.';
        }
      }
      const result = write(tools, `Overfør fra ${source.name}: ${difference.label}`, (session) =>
        transferBranchDifference(session, tools.store, {
          leftBranchId: ctx.branchId,
          rightBranchId: source.id,
          workId: ctx.workId!,
          differenceId: args.forskel,
        }));
      return `«${result.value.label}» er overført fra «${source.name}» som én handling.${result.receipt}`;
    },
  }),

  defineTool({
    name: 'vaelg_hovedgren',
    title: 'Vælg hovedgren',
    description:
      'Gør en åben gren til verdens hovedspor og vælger den. De andre grene bliver liggende.',
    inputSchema: { gren: z.string() },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const target = resolveBranch(tools.store, ctx, args.gren);
      setDefaultBranch(tools.store, target.id, tools.actor);
      tools.bench.setActive({ worldId: ctx.worldId, branchId: target.id });
      return `«${target.name}» er nu hovedsporet og er valgt. De andre grene er bevaret.`;
    },
  }),

  defineTool({
    name: 'arkiver_gren',
    title: 'Arkivér gren',
    description: 'Lægger en fravalgt gren væk uden at slette den. Skift væk fra grenen først.',
    inputSchema: { gren: z.string() },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const target = resolveBranch(tools.store, ctx, args.gren);
      if (target.id === ctx.branchId) throw new Error('Skift til en anden gren først.');
      write(tools, `Arkivér gren: ${target.name}`, (session) =>
        setBranchArchived(session, tools.store, target.id, true));
      return `«${target.name}» er arkiveret, men ikke slettet.`;
    },
  }),

  defineTool({
    name: 'genaabn_gren',
    title: 'Genåbn gren',
    description: 'Gør en arkiveret gren synlig blandt de aktive alternativer igen.',
    inputSchema: { gren: z.string() },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const target = resolveBranch(tools.store, ctx, args.gren);
      write(tools, `Genåbn gren: ${target.name}`, (session) =>
        setBranchArchived(session, tools.store, target.id, false));
      return `«${target.name}» er genåbnet.`;
    },
  }),

  defineTool({
    name: 'flyt_scene',
    title: 'Flyt scene',
    description:
      'Flytter en scene til en placering i et kapitel på den valgte gren. Kronologien ændres ikke.',
    inputSchema: {
      scene: z.string(),
      kapitel: z.string(),
      placering: z.number().int().min(1).describe('1 er først i kapitlet'),
    },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const moving = resolveScene(tools.store, ctx, args.scene);
      const target = resolveChapter(tools.store, ctx, args.kapitel);
      write(tools, `Flyt scene: ${moving.title ?? moving.id}`, (session) =>
        moveScene(session, tools.store, ctx, {
          sceneId: moving.id, targetChapterId: target.id, toIndex: args.placering - 1,
        }));
      return `«${moving.title ?? moving.id}» står nu som nr. ${args.placering} i «${target.title}».`;
    },
  }),

  defineTool({
    name: 'flyt_afsloering',
    title: 'Flyt afsløring',
    description:
      'Flytter læserens afsløring til en anden scene og kan samtidig ændre den fra vink til '
      + 'antydning, udsagn eller bekræftelse. Personernes viden ændres ikke.',
    inputSchema: {
      afsloering: z.string().describe('Id eller faktummets navn'),
      scene: z.string(),
      styrke: z.enum(['hinted', 'implied', 'stated', 'confirmed']).optional(),
    },
    run: (args, tools) => {
      const ctx = tools.bench.context();
      const moving = resolveReveal(tools.store, ctx, args.afsloering);
      const target = resolveScene(tools.store, ctx, args.scene);
      write(tools, 'Flyt afsløring', (session) => moveReveal(session, tools.store, ctx, {
        revealId: moving.id, sceneId: target.id, strength: args.styrke,
      }));
      return `Afsløringen er flyttet til «${target.title ?? target.id}».`;
    },
  }),
];
