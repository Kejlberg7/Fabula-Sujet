import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { inTurn } from '../core/changelog';
import { manuscriptPacket } from '../core/queries/manuscript';
import { runRules } from '../core/rules';
import { createFact } from '../core/services/knowledge';
import { createLaw } from '../core/services/laws';
import { createChapter, createReveal, createScene } from '../core/services/narrative';
import { createSuggestion, decideSuggestion } from '../core/services/suggestions';
import { createWork } from '../core/services/world';
import { Workbench } from '../core/workbench';
import { chapter, event, scene, sceneEvent, sceneText } from '../db/schema';
import { loadInception, loadMemento, loadPredestination } from '../fixtures';
import { makeWorld } from './helpers';

const actor = { kind: 'user' as const };

describe('Fortællelaget', () => {
  it('fanger en scene, der dramatiserer et event i det forkerte lag', () => {
    const store = makeWorld().store;
    const loaded = loadInception(store);
    const ctx = new Workbench(store).setActive(loaded);
    const root = store.sqlite.prepare(
      'select id from realm where branch_id = ? and parent_realm_id is null',
    ).get(ctx.branchId) as { id: string };
    const nestedScene = store.db.select().from(scene)
      .where(eq(scene.branchId, ctx.branchId)).all()
      .find((sc) => {
        const link = store.db.select().from(sceneEvent).where(and(
          eq(sceneEvent.sceneId, sc.id), eq(sceneEvent.mode, 'dramatised'),
        )).get();
        const linkedEvent = link
          ? store.db.select().from(event).where(eq(event.id, link.eventId)).get()
          : undefined;
        return linkedEvent != null && linkedEvent.realmId !== root.id;
      });
    assert.ok(nestedScene, 'Inception skal have en scene i et indlejret lag');
    inTurn(store, { branchId: ctx.branchId, actor }, (s) =>
      s.update(scene, nestedScene.id, { realmId: root.id }));
    const out = runRules(store, ctx, ['realm_leak']);
    assert.equal(out.findings.length, 1);
    assert.match(out.findings[0]!.message, /forkerte lag|men dramatiserer/i);
  });

  it('kræver et POV-ben, når en person møder sig selv', () => {
    const w = makeWorld();
    const loaded = loadPredestination(w.store);
    const ctx = new Workbench(w.store).setActive(loaded);
    const sc = w.store.db.select().from(scene).where(eq(scene.branchId, ctx.branchId)).all()
      .find((item) => item.title === 'Jeg fortæller ham det hele')!;
    inTurn(w.store, { branchId: ctx.branchId, actor }, (s) =>
      s.update(scene, sc.id, { povLegId: null }));
    const out = runRules(w.store, ctx, ['self_meeting_leak']);
    assert.equal(out.findings.length, 1);
    assert.match(out.findings[0]!.message, /Vælg POV-ben/);
  });

  it('bemærker når en afsløring bliver svagere senere i læserækkefølgen', () => {
    const w = makeWorld();
    const ctx = new Workbench(w.store).setActive({ worldId: w.worldId, userId: w.userId });
    inTurn(w.store, { branchId: ctx.branchId, actor }, (s) => {
      const workId = createWork(s, ctx, { title: 'Prøven' });
      const c1 = createChapter(s, ctx, w.store, { workId, title: 'Før' });
      const c2 = createChapter(s, ctx, w.store, { workId, title: 'Efter' });
      const s1 = createScene(s, ctx, w.store, { chapterId: c1, title: 'Sandheden' });
      const s2 = createScene(s, ctx, w.store, { chapterId: c2, title: 'Et sent vink' });
      const f = createFact(s, ctx, {
        predicate: 'hemmelighed', summary: 'Døren er en portal', realmId: w.realmId, slots: [],
      });
      createReveal(s, ctx, { sceneId: s1, factId: f.factId, strength: 'confirmed' });
      createReveal(s, ctx, { sceneId: s2, factId: f.factId, strength: 'hinted' });
    });
    const out = runRules(w.store, ctx, ['reveal_order']);
    assert.equal(out.findings.length, 1);
    assert.match(out.findings[0]!.message, /kapitel 1.*kapitel 2/);

    inTurn(w.store, { branchId: ctx.branchId, actor }, (s) => createLaw(s, ctx, {
      kind: 'ability', hardness: 'hard', ruleCode: 'reveal_order',
      statement: 'Denne bog må med vilje genfortælle afsløringer svagere.',
    }));
    const allowed = runRules(w.store, ctx, ['reveal_order']);
    assert.equal(allowed.findings.length, 0);
    assert.equal(allowed.lifted.length, 1, 'fortælleregler spørger også lovlaget først');
  });

  it('lægger AI-kommentarer i margenen uden at ændre prosaen', () => {
    const w = makeWorld();
    const loaded = loadMemento(w.store);
    const ctx = new Workbench(w.store).setActive(loaded);
    const sc = w.store.db.select().from(chapter).where(eq(chapter.workId, loaded.workId)).all()
      .flatMap((ch) => w.store.db.select().from(scene).where(eq(scene.chapterId, ch.id)).all())[0]!;
    const before = w.store.db.select().from(sceneText).where(and(
      eq(sceneText.sceneId, sc.id), eq(sceneText.isCurrent, true),
    )).get()!;
    let noteId = '';
    inTurn(w.store, { branchId: ctx.branchId, actor }, (s) => {
      createLaw(s, ctx, {
        kind: 'prohibition', hardness: 'soft', statement: 'Telefoner virker ikke under jorden.',
      });
      noteId = createSuggestion(s, ctx, {
        sceneId: sc.id, kind: 'continuity', message: 'Tjek telefonens forbindelse.',
        proposedText: 'Der var ingen tone.',
      }, w.store);
    });
    const packet = manuscriptPacket(w.store, ctx, sc.id);
    assert.ok(packet.laws.some((item) => item.statement.includes('Telefoner')));
    assert.equal(packet.suggestions[0]!.message, 'Tjek telefonens forbindelse.');

    inTurn(w.store, { branchId: ctx.branchId, actor }, (s) =>
      decideSuggestion(s, ctx, w.store, { id: noteId, status: 'accepted' }));
    const after = w.store.db.select().from(sceneText).where(and(
      eq(sceneText.sceneId, sc.id), eq(sceneText.isCurrent, true),
    )).get()!;
    assert.equal(after.id, before.id, 'at følge en note er ikke tilladelse til at gemme ny prosa');
    assert.deepEqual(after.doc, before.doc);
  });
});
