import { and, eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { inTurn } from '../src/core/changelog';
import { createLaw } from '../src/core/services/laws';
import { saveSceneText } from '../src/core/services/narrative';
import { openStore } from '../src/db/client';
import {
  branch, entity, event, fact, relationship, scene, thread, turn, work, world,
} from '../src/db/schema';
import { markdownOf, paragraphs } from '../src/fixtures/prose';
import type { Context } from '../src/core/workbench';

/**
 * Adds the phase-14 comparison sample to a database that already contains the
 * older Memento fixture. New fixture databases receive the same sample directly
 * from `loadMemento`; this small, idempotent bridge keeps the writer's existing
 * local database useful without reloading or duplicating any worlds.
 */
export function enrichPhase14(databaseUrl: string): 'added' | 'already-there' | 'not-found' {
  const store = openStore(databaseUrl);
  try {
    const memento = store.db.select().from(world).where(eq(world.name, 'Memento')).get();
    if (!memento) return 'not-found';
    const branches = store.db.select().from(branch).where(eq(branch.worldId, memento.id)).all();
    const main = branches.find((item) => item.isDefault)
      ?? branches.find((item) => item.name === 'hoved');
    const alternative = branches.find((item) => item.name === 'Teddy afsløres tidligere');
    if (!main || !alternative) return 'not-found';
    const done = store.db.select().from(turn).where(eq(turn.branchId, alternative.id)).all()
      .some((item) => item.summary === 'Tilføj fase 14-eksempel');
    if (done) return 'already-there';

    const mainWork = store.db.select().from(work)
      .where(and(eq(work.branchId, main.id), eq(work.title, 'Memento'))).get();
    const alternativeWork = store.db.select().from(work)
      .where(and(eq(work.branchId, alternative.id), eq(work.title, 'Memento'))).get();
    const teddy = store.db.select().from(entity)
      .where(and(eq(entity.branchId, alternative.id), eq(entity.name, 'Teddy'))).get();
    const teddyFact = store.db.select().from(fact)
      .where(and(eq(fact.branchId, alternative.id), eq(fact.summary, 'Teddy kan ikke stoles på'))).get();
    const truthEvent = store.db.select().from(event)
      .where(and(eq(event.branchId, alternative.id), eq(event.title, 'Teddy fortæller ham sandheden'))).get();
    const leonard = store.db.select().from(entity)
      .where(and(eq(entity.branchId, alternative.id), eq(entity.name, 'Leonard'))).get();
    const alliance = leonard && teddy ? store.db.select().from(relationship)
      .where(and(
        eq(relationship.branchId, alternative.id),
        eq(relationship.fromEntityId, leonard.id),
        eq(relationship.toEntityId, teddy.id),
        eq(relationship.kind, 'samarbejder'),
      )).get() : undefined;
    const teddyThread = store.db.select().from(thread)
      .where(and(eq(thread.branchId, alternative.id), eq(thread.name, 'Hvem er Teddy?'))).get();
    const opening = store.db.select().from(scene)
      .where(and(eq(scene.branchId, alternative.id), eq(scene.title, 'Nogen har ringet'))).get();
    if (!mainWork || !alternativeWork || !teddy || !teddyFact || !truthEvent
      || !alliance || !teddyThread || !opening) return 'not-found';

    const ctx: Context = {
      worldId: memento.id, branchId: alternative.id, workId: alternativeWork.id, userId: null,
    };
    inTurn(store, {
      branchId: alternative.id,
      actor: { kind: 'system' },
      summary: 'Tilføj fase 14-eksempel',
    }, (session) => {
      session.update(entity, teddy.id, {
        description: 'I dette spor fremstår Teddy tidligere som den mand, der styrer jagten.',
      });
      session.update(fact, teddyFact.id, { truth: 'false' });
      session.update(event, truthEvent.id, {
        summary: 'Teddy giver forklaringen, før Leonard når at gøre ham til næste mål.',
        latest: truthEvent.earliest == null ? null : truthEvent.earliest + 5 * 60,
      });
      session.update(relationship, alliance.id, { kind: 'fører Leonard' });
      session.update(thread, teddyThread.id, {
        summary: 'Teddys navn og rolle lægges åbent frem allerede ved telefonen.',
      });
      createLaw(session, ctx, {
        kind: 'prohibition', hardness: 'soft',
        statement: 'I dette spor må Teddy ikke skjule sit navn efter den første telefonsamtale.',
        scopeKind: 'work', scopeId: alternativeWork.id, subjectKind: 'entity',
        subjectEntityId: teddy.id,
      });
      const prose = [
        'Telefonen står på natbordet med røret ved siden af. Stemmen har sagt navnet Teddy, og Leonard skriver det ned, før det kan forsvinde.',
        'Han begynder forfra: navnet, værelset, hvorfor han er her. Denne gang står hjælperens navn allerede mellem ham og historien om Sammy Jankis.',
      ];
      saveSceneText(session, ctx, store, {
        sceneId: opening.id, doc: paragraphs(...prose), markdown: markdownOf(...prose),
        label: 'Teddy afsløres tidligere',
      });
    });
    return 'added';
  } finally {
    store.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const databaseUrl = process.argv[2] ?? fileURLToPath(new URL('../fabula.db', import.meta.url));
  process.stdout.write(`${enrichPhase14(databaseUrl)}\n`);
}
