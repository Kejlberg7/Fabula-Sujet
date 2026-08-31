import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import {
  beat, disappearance, entityState, identity, participation, relationship,
  source, sourceLink, thread,
} from '../../db/schema';
import { archiveRoot } from '../attachments';
import { readingOrder } from '../queries/order';
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
    const order = readingOrder(snap.store, snap.ctx);
    const threads = snap.store.db.select().from(thread)
      .where(eq(thread.branchId, snap.ctx.branchId)).all()
      .filter((row) => !snap.ctx.workId || order.covers(row, snap.ctx.workId));
    /**
     * Where a beat lands in the reading, when it lands anywhere. A beat hung on
     * a scene is placed by that scene; a beat with only a `position` is not
     * placed at all -- that number sorts it against the thread's other unwritten
     * beats and says nothing about where in the book it will end up.
     */
    const placed = (row: typeof beat.$inferSelect) =>
      row.sceneId ? order.sceneRank(row.sceneId) : null;
    const findings: Finding[] = [];
    for (const line of threads) {
      const rows = snap.store.db.select().from(beat).where(and(
        eq(beat.threadId, line.id), eq(beat.branchId, snap.ctx.branchId),
      )).all();
      const payoffs = rows.filter((row) => row.kind === 'payoff');
      for (const setup of rows.filter((row) => row.kind === 'setup')) {
        const kept = payoffs.some((row) => {
          const here = placed(row);
          const there = placed(setup);
          if (here != null && there != null) return here > there;
          // One of the two is not written into the book yet, so nothing stops
          // the writer from putting it after the setup. Only a payoff that is
          // demonstrably too early -- or missing outright -- is a finding.
          if (here != null || there != null) return true;
          return (row.position ?? Infinity) > (setup.position ?? -Infinity);
        });
        if (kept) continue;
        const reach = line.scope === 'series' ? ' — heller ikke i et senere bind'
          : line.scope === 'world' ? ' — heller ikke i en anden bog i verden' : '';
        // Spørg lovlaget, før der meldes. En verden, hvor løse ender er meningen,
        // siger det med en evne, og så er den her ikke en bemærkning.
        const lifted = snap.lifted({ ruleCode: 'dangling_setup' });
        findings.push({
          ruleCode: 'dangling_setup', severity: 'note',
          message: `Plottråden «${line.name}» sætter «${setup.summary ?? 'noget'}» op, `
            + `men har intet senere payoff endnu${reach}.`,
          subjects: { rows: [line.id, setup.id, ...(setup.sceneId ? [setup.sceneId] : [])] },
          fingerprint: fingerprint('dangling_setup', setup.id),
          ...(lifted ? { lifted } : {}),
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
        // Også her spørges lovlaget først. Er en modstrid med kilden husets
        // egen beslutning, står den som en lov, ikke som en note ved hver
        // gennemgang.
        const lifted = snap.lifted({ ruleCode: 'source_conflict' });
        return {
        ruleCode: 'source_conflict', severity: 'note',
        message: `Kilden «${sources.get(row.sourceId)?.title ?? 'Ukendt kilde'}» er markeret som en mulig `
          + `modstrid med ${TARGET_DA[row.targetKind]} «${target ?? row.targetId}»`
          + `${row.note ? `: ${row.note}` : '.'} `
          + 'Programmet har ikke læst eller fortolket kildens indhold.',
        subjects: { rows: [row.id, row.targetId] },
        fingerprint: fingerprint('source_conflict', row.id),
        ...(lifted ? { lifted } : {}),
        };
      });
  },
};

/**
 * The cheap half of the attachment check, and it runs every time.
 *
 * Only two questions are asked of the disk: is the file there, and is it still
 * the size it was. Both are one `stat`. Reading and hashing every attachment
 * on every review would cost seconds for an answer that changes about once a
 * year -- that is `tjek_vedhaeftninger`, and it is asked for.
 *
 * Nothing here opens the file. A size that has changed is reported as exactly
 * what it is: the bytes are not the ones that were filed, and the program does
 * not know what they say now.
 */
export const attachmentMissing: Rule = {
  code: 'attachment_missing',
  title: 'Fil væk fra arkivet',
  run: (snap) => {
    const root = archiveRoot(snap.store);
    // Uden et arkiv er der ingenting at savne. En database i hukommelsen har
    // aldrig haft filerne, og det er ikke en fejl at melde.
    if (!root) return [];
    const findings: Finding[] = [];
    for (const row of snap.store.db.select().from(source)
      .where(eq(source.worldId, snap.ctx.worldId)).all()) {
      if (!row.filePath) continue;
      const path = join(root, row.filePath);
      const lifted = snap.lifted({ ruleCode: 'attachment_missing' });
      const found = existsSync(path) ? statSync(path) : null;
      if (!found) {
        findings.push({
          ruleCode: 'attachment_missing', severity: 'warning',
          message: `Kilden «${row.title}» peger på filen «${row.originalName ?? row.filePath}», `
            + 'som ikke ligger i arkivet længere. Henvisningen og filen er to ting: '
            + 'læg filen ind igen, eller slip den med vilje.',
          subjects: { rows: [row.id] },
          fingerprint: fingerprint('attachment_missing', row.id),
          ...(lifted ? { lifted } : {}),
        });
        continue;
      }
      if (row.byteSize != null && found.size !== row.byteSize) {
        findings.push({
          ruleCode: 'attachment_missing', severity: 'warning',
          message: `Filen «${row.originalName ?? row.filePath}» under kilden «${row.title}» fylder `
            + `${found.size} byte og fyldte ${row.byteSize}, da den blev lagt ind. `
            + 'Det er ikke længere den samme fil. Programmet har ikke læst den.',
          subjects: { rows: [row.id] },
          fingerprint: fingerprint('attachment_missing', 'size', row.id),
          ...(lifted ? { lifted } : {}),
        });
      }
    }
    return findings;
  },
};

export const continuityRules: Rule[] = [
  objectContinuity,
  relationshipState,
  danglingSetup,
  nameOrIdentity,
  disappearanceRule,
  sourceConflict,
  attachmentMissing,
];
