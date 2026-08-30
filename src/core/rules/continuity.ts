import { and, eq } from 'drizzle-orm';
import {
  beat, chapter, disappearance, entityState, identity, participation, relationship,
  scene, source, sourceLink, thread,
} from '../../db/schema';
import { labelForTarget } from '../queries/sources';
import { fingerprint, type Finding, type Rule, type Snapshot } from './kit';

interface Interval { from: number; to: number }

const interval = (from: number | null, to: number | null): Interval => ({
  from: from ?? -Infinity,
  to: to ?? Infinity,
});

/** Intervals are half-open: handing an object over at noon is not double possession. */
const overlaps = (a: Interval, b: Interval): boolean =>
  Math.max(a.from, b.from) < Math.min(a.to, b.to);

const eventRange = (snap: Snapshot, id: string) => {
  const row = snap.events.get(id);
  if (!row) return null;
  const earliest = row.solvedEarliest ?? row.earliest;
  if (earliest == null) return null;
  const latest = row.solvedLatest ?? row.latest ?? earliest;
  return {
    earliest,
    latest,
    endEarliest: earliest + (row.durationMin ?? 0),
    endLatest: latest + (row.durationMax ?? row.durationMin ?? 0),
  };
};

export const objectContinuity: Rule = {
  code: 'object_continuity',
  title: 'Genstandskontinuitet',
  run: (snap) => {
    const findings: Finding[] = [];
    for (let i = 0; i < snap.possessions.length; i += 1) {
      const a = snap.possessions[i]!;
      for (const b of snap.possessions.slice(i + 1)) {
        if (a.objectEntityId !== b.objectEntityId) continue;
        if (a.holderEntityId === b.holderEntityId && a.holderLegId === b.holderLegId) continue;
        if (!overlaps(interval(a.fromTime, a.toTime), interval(b.fromTime, b.toTime))) continue;
        const at = Math.max(a.fromTime ?? -Infinity, b.fromTime ?? -Infinity);
        const lifted = snap.lifted({
          ruleCode: 'object_continuity', entityId: a.objectEntityId,
          at: Number.isFinite(at) ? at : null,
        });
        findings.push({
          ruleCode: 'object_continuity', severity: 'error',
          message: `${snap.name(a.objectEntityId)} bæres af både ${snap.name(a.holderEntityId)} `
            + `og ${snap.name(b.holderEntityId)} i det samme tidsrum. En overdragelse må slutte `
            + 'det første tidsrum, før det næste begynder.',
          subjects: {
            entities: [a.objectEntityId, a.holderEntityId, b.holderEntityId], rows: [a.id, b.id],
          },
          fingerprint: fingerprint('object_continuity', 'possession', a.id, b.id),
          ...(lifted ? { lifted } : {}),
        });
      }
    }

    const states = snap.store.db.select().from(entityState)
      .where(eq(entityState.branchId, snap.ctx.branchId)).all();
    for (let i = 0; i < states.length; i += 1) {
      const a = states[i]!;
      for (const b of states.slice(i + 1)) {
        if (a.entityId !== b.entityId || a.category !== b.category || a.value === b.value) continue;
        if (!overlaps(interval(a.fromTime, a.toTime), interval(b.fromTime, b.toTime))) continue;
        const lifted = snap.lifted({ ruleCode: 'object_continuity', entityId: a.entityId });
        findings.push({
          ruleCode: 'object_continuity', severity: 'error',
          message: `${snap.name(a.entityId)} er både «${a.value}» og «${b.value}» `
            + `i kategorien ${a.category} i det samme tidsrum.`,
          subjects: { entities: [a.entityId], rows: [a.id, b.id] },
          fingerprint: fingerprint('object_continuity', 'state', a.id, b.id),
          ...(lifted ? { lifted } : {}),
        });
      }
    }
    return findings;
  },
};

export const relationshipState: Rule = {
  code: 'relationship_state',
  title: 'Relationstilstand',
  run: (snap) => {
    const rows = snap.store.db.select().from(relationship)
      .where(eq(relationship.branchId, snap.ctx.branchId)).all();
    const findings: Finding[] = [];
    const key = (r: typeof relationship.$inferSelect) => {
      const pair = r.symmetric
        ? [r.fromEntityId, r.toEntityId].sort().join('<>')
        : `${r.fromEntityId}>${r.toEntityId}`;
      return `${pair}:${r.category}`;
    };
    for (let i = 0; i < rows.length; i += 1) {
      const a = rows[i]!;
      if (!a.category) continue;
      for (const b of rows.slice(i + 1)) {
        if (!b.category || key(a) !== key(b) || a.kind === b.kind) continue;
        if (!overlaps(interval(a.fromTime, a.toTime), interval(b.fromTime, b.toTime))) continue;
        const lifted = snap.lifted({ ruleCode: 'relationship_state', entityId: a.fromEntityId });
        findings.push({
          ruleCode: 'relationship_state', severity: 'warning',
          message: `${snap.name(a.fromEntityId)} er både «${a.kind}» og «${b.kind}» over for `
            + `${snap.name(a.toEntityId)} i relationen ${a.category} på samme tid.`,
          subjects: { entities: [a.fromEntityId, a.toEntityId], rows: [a.id, b.id] },
          fingerprint: fingerprint('relationship_state', a.id, b.id),
          ...(lifted ? { lifted } : {}),
        });
      }
    }
    return findings;
  },
};

export const danglingSetup: Rule = {
  code: 'dangling_setup',
  title: 'Hængende setup',
  run: (snap) => {
    const threads = snap.store.db.select().from(thread)
      .where(eq(thread.branchId, snap.ctx.branchId)).all()
      .filter((row) => !snap.ctx.workId || row.workId === snap.ctx.workId);
    const chapters = snap.store.db.select().from(chapter)
      .where(eq(chapter.branchId, snap.ctx.branchId)).all();
    const chapterPosition = new Map(chapters.map((row) => [row.id, row.position]));
    const scenes = snap.store.db.select().from(scene)
      .where(eq(scene.branchId, snap.ctx.branchId)).all();
    const scenePosition = new Map(scenes.map((row) => [
      row.id, (chapterPosition.get(row.chapterId) ?? 0) * 100_000 + row.position,
    ]));
    const findings: Finding[] = [];
    for (const line of threads) {
      const rows = snap.store.db.select().from(beat).where(and(
        eq(beat.threadId, line.id), eq(beat.branchId, snap.ctx.branchId),
      )).all();
      const order = (row: typeof beat.$inferSelect) =>
        row.position ?? (row.sceneId ? scenePosition.get(row.sceneId) : null) ?? Infinity;
      const payoffs = rows.filter((row) => row.kind === 'payoff');
      for (const setup of rows.filter((row) => row.kind === 'setup')) {
        if (payoffs.some((row) => order(row) > order(setup))) continue;
        findings.push({
          ruleCode: 'dangling_setup', severity: 'note',
          message: `Plottråden «${line.name}» sætter «${setup.summary ?? 'noget'}» op, `
            + 'men har intet senere payoff endnu.',
          subjects: { rows: [line.id, setup.id, ...(setup.sceneId ? [setup.sceneId] : [])] },
          fingerprint: fingerprint('dangling_setup', setup.id),
        });
      }
    }
    return findings;
  },
};

export const nameOrIdentity: Rule = {
  code: 'name_or_identity',
  title: 'Navn og identitet',
  run: (snap) => {
    const identities = snap.store.db.select().from(identity)
      .where(eq(identity.branchId, snap.ctx.branchId)).all();
    const byId = new Map(identities.map((row) => [row.id, row]));
    const findings: Finding[] = [];
    for (const alias of identities) {
      if (alias.validFrom != null && alias.validTo != null && alias.validFrom > alias.validTo) {
        findings.push({
          ruleCode: 'name_or_identity', severity: 'error',
          message: `Identiteten «${alias.name}» slutter før den begynder.`,
          subjects: { entities: [alias.entityId], rows: [alias.id] },
          fingerprint: fingerprint('name_or_identity', 'interval', alias.id),
        });
      }
    }
    for (const leg of snap.legs.values()) {
      if (!leg.identityId) continue;
      const alias = byId.get(leg.identityId);
      if (!alias || alias.entityId === leg.entityId) continue;
      findings.push({
        ruleCode: 'name_or_identity', severity: 'error',
        message: `${snap.name(leg.entityId)}s ben bruger identiteten «${alias.name}», `
          + `som tilhører ${snap.name(alias.entityId)}.`,
        subjects: { entities: [leg.entityId, alias.entityId], rows: [leg.id, alias.id] },
        fingerprint: fingerprint('name_or_identity', 'leg', leg.id, alias.id),
      });
    }
    for (const part of snap.participations) {
      if (!part.identityId) continue;
      const alias = byId.get(part.identityId);
      const happened = eventRange(snap, part.eventId);
      if (!alias) continue;
      let message: string | null = null;
      if (alias.entityId !== part.entityId) {
        message = `${snap.name(part.entityId)} optræder som «${alias.name}», men identiteten tilhører ${snap.name(alias.entityId)}.`;
      } else if (happened && alias.validFrom != null && happened.endLatest < alias.validFrom) {
        message = `${snap.name(part.entityId)} optræder som «${alias.name}», før identiteten er taget i brug.`;
      } else if (happened && alias.validTo != null && happened.earliest > alias.validTo) {
        message = `${snap.name(part.entityId)} optræder som «${alias.name}», efter identiteten er ophørt.`;
      }
      if (!message) continue;
      const lifted = snap.lifted({
        ruleCode: 'name_or_identity', entityId: part.entityId,
        at: happened?.earliest,
      });
      findings.push({
        ruleCode: 'name_or_identity', severity: 'warning', message,
        subjects: { entities: [part.entityId, alias.entityId], events: [part.eventId], rows: [part.id, alias.id] },
        fingerprint: fingerprint('name_or_identity', 'appearance', part.id, alias.id),
        ...(lifted ? { lifted } : {}),
      });
    }
    return findings;
  },
};

export const disappearanceRule: Rule = {
  code: 'disappearance',
  title: 'Forsvinding',
  run: (snap) => {
    const rows = snap.store.db.select().from(disappearance)
      .where(eq(disappearance.branchId, snap.ctx.branchId)).all();
    const findings: Finding[] = [];
    for (const gap of rows) {
      const gone = eventRange(snap, gap.disappearsEventId);
      const back = gap.returnsEventId ? eventRange(snap, gap.returnsEventId) : null;
      if (!gone) continue;
      if (back && back.endLatest < gone.earliest) {
        findings.push({
          ruleCode: 'disappearance', severity: 'error',
          message: `${snap.name(gap.entityId)} vender tilbage, før vedkommende forsvinder.`,
          subjects: { entities: [gap.entityId], events: [gap.disappearsEventId, gap.returnsEventId!], rows: [gap.id] },
          fingerprint: fingerprint('disappearance', 'order', gap.id),
        });
      }
      for (const part of snap.participations) {
        if (part.entityId !== gap.entityId || part.role === 'mentioned') continue;
        if (part.eventId === gap.disappearsEventId || part.eventId === gap.returnsEventId) continue;
        const appearance = eventRange(snap, part.eventId);
        if (!appearance || appearance.earliest <= gone.endLatest) continue;
        if (back && appearance.endLatest >= back.earliest) continue;
        const lifted = snap.lifted({
          ruleCode: 'disappearance', entityId: gap.entityId, at: appearance.earliest,
        });
        findings.push({
          ruleCode: 'disappearance', severity: 'warning',
          message: `${snap.name(gap.entityId)} optræder i «${snap.events.get(part.eventId)?.title ?? 'et event'}» `
            + `efter forsvindingen${back ? ' og før tilbagekomsten' : ''}.`,
          subjects: { entities: [gap.entityId], events: [gap.disappearsEventId, part.eventId], rows: [gap.id, part.id] },
          fingerprint: fingerprint('disappearance', gap.id, part.id),
          ...(lifted ? { lifted } : {}),
        });
      }
    }
    return findings;
  },
};

const TARGET_DA: Record<string, string> = {
  fact: 'faktummet', law: 'loven', event: 'eventet',
  entity: 'personen', scene: 'scenen', work: 'bogen',
};

export const sourceConflict: Rule = {
  code: 'source_conflict',
  title: 'Modstrid med kilde',
  run: (snap) => {
    const sources = new Map(snap.store.db.select().from(source)
      .where(eq(source.worldId, snap.ctx.worldId)).all().map((row) => [row.id, row]));
    return snap.store.db.select().from(sourceLink)
      .where(eq(sourceLink.branchId, snap.ctx.branchId)).all()
      .filter((row) => row.relation === 'conflicts')
      .map((row): Finding => {
        // Uden navnet på det, kilden strider mod, er noten ubrugelig: «en mulig
        // modstrid med fact» fortæller ikke, hvilket faktum man skal se på.
        const target = labelForTarget(snap.store, row.targetKind, row.targetId);
        return {
        ruleCode: 'source_conflict', severity: 'note',
        message: `Kilden «${sources.get(row.sourceId)?.title ?? 'Ukendt kilde'}» er markeret som en mulig `
          + `modstrid med ${TARGET_DA[row.targetKind]} «${target ?? row.targetId}»`
          + `${row.note ? `: ${row.note}` : '.'} `
          + 'Programmet har ikke læst eller fortolket kildens indhold.',
        subjects: { rows: [row.id, row.targetId] },
        fingerprint: fingerprint('source_conflict', row.id),
        };
      });
  },
};

export const continuityRules: Rule[] = [
  objectContinuity,
  relationshipState,
  danglingSetup,
  nameOrIdentity,
  disappearanceRule,
  sourceConflict,
];
