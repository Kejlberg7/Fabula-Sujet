import { and, eq } from 'drizzle-orm';
import { chapter, reveal, scene, sceneEvent } from '../../db/schema';
import { sceneDesk } from '../queries/desk';
import { fingerprint, type Finding, type Rule, type Snapshot } from './kit';

/** The desk's scene-local POV checks, promoted into the global review. */
export const povLeak: Rule = {
  code: 'pov_leak',
  title: 'POV-lækage',
  run: (snap) => {
    const findings: Finding[] = [];
    const scenes = snap.store.db.select().from(scene)
      .where(eq(scene.branchId, snap.ctx.branchId)).all()
      .filter((s) => s.povEntityId != null);

    for (const sc of scenes) {
      const desk = sceneDesk(snap.store, snap.ctx, { sceneId: sc.id });
      for (const leak of [...desk.leaks, ...desk.lifted]) {
        findings.push({
          ruleCode: 'pov_leak',
          severity: leak.kind === 'unaware_of_own_scene' ? 'warning' : 'error',
          message: `«${desk.scene.title ?? desk.scene.chapterTitle}»: ${leak.message}`,
          subjects: {
            rows: [sc.id], entities: sc.povEntityId ? [sc.povEntityId] : [],
            events: leak.eventId ? [leak.eventId] : [],
            facts: leak.factId ? [leak.factId] : [],
          },
          fingerprint: fingerprint('pov_leak', sc.id, leak.kind,
            leak.eventId ?? '', leak.factId ?? ''),
          ...(leak.lifted ? { lifted: leak.lifted } : {}),
        });
      }
    }
    return findings;
  },
};

/** A dramatised event belongs to the layer in which the scene is set. */
export const realmLeak: Rule = {
  code: 'realm_leak',
  title: 'Lagbrud',
  run: (snap) => {
    const findings: Finding[] = [];
    const scenes = snap.store.db.select().from(scene)
      .where(eq(scene.branchId, snap.ctx.branchId)).all();

    for (const sc of scenes) {
      // No realm is a decision not yet made, not a contradiction.
      if (!sc.realmId) continue;
      const links = snap.store.db.select().from(sceneEvent).where(and(
        eq(sceneEvent.sceneId, sc.id), eq(sceneEvent.branchId, snap.ctx.branchId),
      )).all().filter((l) => l.mode === 'dramatised');
      for (const link of links) {
        const happened = snap.events.get(link.eventId);
        if (!happened || happened.realmId === sc.realmId) continue;
        const lifted = snap.lifted({
          ruleCode: 'realm_leak', entityId: sc.povEntityId,
          realmId: sc.realmId, at: happened.solvedEarliest ?? happened.earliest,
        });
        findings.push({
          ruleCode: 'realm_leak', severity: 'error',
          message:
            `Scenen «${sc.title ?? sc.id}» er sat i ${snap.realms.get(sc.realmId)?.name ?? 'ét lag'}, `
            + `men dramatiserer «${happened.title}» i ${snap.realms.get(happened.realmId)?.name ?? 'et andet lag'}. `
            + 'Et omtalt minde må gerne krydse grænsen; noget scenen viser som nutid må ikke.',
          subjects: { rows: [sc.id, link.id], events: [happened.id], realms: [sc.realmId, happened.realmId] },
          fingerprint: fingerprint('realm_leak', sc.id, link.id),
          ...(lifted ? { lifted } : {}),
        });
      }
    }
    return findings;
  },
};

/** A self-meeting needs to say which stretch of the shared life owns the POV. */
export const selfMeetingLeak: Rule = {
  code: 'self_meeting_leak',
  title: 'Selvmøde-lækage',
  run: (snap) => {
    const findings: Finding[] = [];
    const scenes = snap.store.db.select().from(scene)
      .where(eq(scene.branchId, snap.ctx.branchId)).all()
      .filter((s) => s.povEntityId != null && s.povLegId == null);

    for (const sc of scenes) {
      const links = snap.store.db.select().from(sceneEvent).where(and(
        eq(sceneEvent.sceneId, sc.id), eq(sceneEvent.branchId, snap.ctx.branchId),
      )).all().filter((l) => l.mode === 'dramatised');
      for (const link of links) {
        const selves = snap.participations.filter((p) =>
          p.eventId === link.eventId && p.entityId === sc.povEntityId && p.legId != null);
        const legs = [...new Set(selves.map((p) => p.legId!))];
        if (legs.length < 2) continue;
        const eventTitle = snap.events.get(link.eventId)?.title ?? 'eventet';
        const lifted = snap.lifted({
          ruleCode: 'self_meeting_leak', entityId: sc.povEntityId,
          realmId: snap.events.get(link.eventId)?.realmId,
          at: snap.events.get(link.eventId)?.solvedEarliest ?? snap.events.get(link.eventId)?.earliest,
        });
        findings.push({
          ruleCode: 'self_meeting_leak', severity: 'error',
          message:
            `«${sc.title ?? sc.id}» fortælles gennem ${snap.name(sc.povEntityId)}, `
            + `men ${eventTitle} har ${legs.length} ben af det samme liv til stede. `
            + 'Vælg POV-ben, ellers kan viden og identitet ikke holdes adskilt.',
          subjects: { rows: [sc.id, link.id, ...selves.map((p) => p.id)], entities: [sc.povEntityId!], events: [link.eventId] },
          fingerprint: fingerprint('self_meeting_leak', sc.id, link.eventId),
          ...(lifted ? { lifted } : {}),
        });
      }
    }
    return findings;
  },
};

/** Reveal labels should grow in force as the reader moves through a book. */
export const revealOrder: Rule = {
  code: 'reveal_order',
  title: 'Afsløringsrækkefølge',
  run: (snap) => {
    const rank: Record<string, number> = { hinted: 0, implied: 1, stated: 2, confirmed: 3 };
    const chapters = snap.store.db.select().from(chapter)
      .where(eq(chapter.branchId, snap.ctx.branchId)).all();
    const position = new Map<string, { workId: string; chapter: number; scene: number }>();
    for (const ch of chapters) {
      for (const sc of snap.store.db.select().from(scene).where(and(
        eq(scene.chapterId, ch.id), eq(scene.branchId, snap.ctx.branchId),
      )).all()) position.set(sc.id, { workId: ch.workId, chapter: ch.position, scene: sc.position });
    }

    const rows = snap.store.db.select().from(reveal)
      .where(eq(reveal.branchId, snap.ctx.branchId)).all()
      .filter((r) => position.has(r.sceneId))
      .sort((a, b) => {
        const ap = position.get(a.sceneId)!;
        const bp = position.get(b.sceneId)!;
        return ap.workId.localeCompare(bp.workId) || ap.chapter - bp.chapter || ap.scene - bp.scene;
      });
    const strongest = new Map<string, typeof reveal.$inferSelect>();
    const findings: Finding[] = [];
    for (const row of rows) {
      const pos = position.get(row.sceneId)!;
      const key = `${pos.workId}:${row.factId}:${row.slotId ?? '*'}`;
      const before = strongest.get(key);
      if (before && rank[row.strength]! < rank[before.strength]!) {
        const earlier = position.get(before.sceneId)!;
        const laterScene = snap.store.db.select().from(scene).where(eq(scene.id, row.sceneId)).get();
        const eventLink = snap.store.db.select().from(sceneEvent).where(and(
          eq(sceneEvent.sceneId, row.sceneId), eq(sceneEvent.mode, 'dramatised'),
        )).get();
        const linkedEvent = eventLink ? snap.events.get(eventLink.eventId) : undefined;
        const lifted = snap.lifted({
          ruleCode: 'reveal_order', entityId: laterScene?.povEntityId,
          realmId: laterScene?.realmId,
          at: linkedEvent?.solvedEarliest ?? linkedEvent?.earliest,
        });
        findings.push({
          ruleCode: 'reveal_order', severity: 'note',
          message:
            `«${snap.facts.get(row.factId)?.summary ?? 'Et faktum'}» er ${before.strength} i kapitel ${earlier.chapter}, `
            + `men kun ${row.strength} i kapitel ${pos.chapter}. Hvis det er en gentagelse, bør styrken ikke gå baglæns; `
            + 'hvis det er et nyt spor, bør det knyttes til en anden plads.',
          subjects: { facts: [row.factId], rows: [before.id, row.id, before.sceneId, row.sceneId] },
          fingerprint: fingerprint('reveal_order', before.id, row.id),
          ...(lifted ? { lifted } : {}),
        });
      }
      if (!before || rank[row.strength]! > rank[before.strength]!) strongest.set(key, row);
    }
    return findings;
  },
};

export const narrativeRules: Rule[] = [povLeak, realmLeak, selfMeetingLeak, revealOrder];
