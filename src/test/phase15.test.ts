import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { entity, fact, belief, statement, work } from '../db/schema';
import { makeWorld } from './helpers';
import { createApi } from '../server/api';
import { Workbench } from '../core/workbench';
import { inTurn } from '../core/changelog';
import { runRules } from '../core/rules';

describe('Fase 15 — opret og slet fra arbejdsfladen', () => {
  it('opretter faktum, overbevisning og udsagn som tre historikførte handlinger', () => {
    const sample = makeWorld();
    const api = createApi(sample.store);
    new Workbench(sample.store).setActive({ worldId: sample.worldId, branchId: sample.branchId });
    const person = api['entity.create']({ name: 'Mira', kind: 'person' });
    api['entity.create']({ name: 'Nøglen', kind: 'object' });
    const created = api['fact.create']({
      predicate: 'gemte', summary: 'Mira gemte nøglen', realmId: sample.realmId,
      slots: [{ name: 'person', valueKind: 'entity' }],
    });
    api['belief.create']({ entityId: person.id, factId: created.factId, strength: 'mistaken' });
    api['statement.create']({ speakerEntityId: person.id, factId: created.factId, truthful: false });

    assert.equal(sample.store.db.select().from(fact).all().length, 1);
    assert.equal(sample.store.db.select().from(belief).all().length, 1);
    assert.equal(sample.store.db.select().from(statement).all().length, 1);
    assert.equal(sample.store.db.select().from(entity).all().length, 2);
    const history = api['history.list']({ limit: 10 });
    assert.equal(history.filter((turn) => turn.kind === 'edit').length, 6);
    sample.store.close();
  });

  it('viser afhængigheder med menneskelige navne før sletning', () => {
    const sample = makeWorld();
    const api = createApi(sample.store);
    new Workbench(sample.store).setActive({ worldId: sample.worldId, branchId: sample.branchId });
    const first = api['entity.create']({ name: 'Mira', kind: 'person' });
    const second = api['entity.create']({ name: 'Jon', kind: 'person' });
    api['continuity.relationship.create']({
      fromEntityId: first.id, toEntityId: second.id, kind: 'stoler på',
    });

    const preview = api['row.delete.preview']({ table: 'entity', id: first.id });
    assert.equal(preview.canDelete, false);
    assert.ok(preview.dependencies.some((item) => item.label === 'stoler på'));
    assert.equal(JSON.stringify(preview).includes(first.id), false);
    sample.store.close();
  });

  it('skelner mellem en person, der vises i scenen, og en person, der blot nævnes', () => {
    const sample = makeWorld();
    const api = createApi(sample.store);
    const bench = new Workbench(sample.store);
    bench.setActive({ worldId: sample.worldId, branchId: sample.branchId });
    const mira = api['entity.create']({ name: 'Mira', kind: 'person' });
    const room = api['entity.create']({ name: 'Rummet', kind: 'place' });
    const street = api['entity.create']({ name: 'Gaden', kind: 'place' });
    let workId = '';
    inTurn(sample.store, { branchId: sample.branchId, actor: { kind: 'system' }, summary: 'Prøvebog' }, (session) => {
      workId = session.insert(work, {
        worldId: sample.worldId, branchId: sample.branchId,
        title: 'Prøvebog', createdAt: new Date(),
      })['id'] as string;
    });
    const ctx = bench.setActive({ worldId: sample.worldId, branchId: sample.branchId, workId });
    const chapter = api['chapter.create']({ title: 'Afsnit' });
    const scene = api['scene.create']({ chapterId: chapter.id, title: 'I rummet', realmId: sample.realmId });
    const onScene = api['event.create']({ title: 'Scenen foregår', realmId: sample.realmId, earliest: 100, latest: 100 });
    const elsewhere = api['event.create']({ title: 'Mira er på gaden', realmId: sample.realmId, earliest: 100, latest: 100 });
    api['row.update']({ table: 'event', id: onScene.id, patch: { placeId: room.id } });
    api['row.update']({ table: 'event', id: elsewhere.id, patch: { placeId: street.id } });
    api['scene.linkEvent']({ sceneId: scene.id, eventId: onScene.id, mode: 'dramatised' });
    api['participation.create']({ eventId: elsewhere.id, entityId: mira.id, role: 'witness' });
    api['anchor.create']({
      sceneId: scene.id, markId: 'anchor-test', targetKind: 'entity', targetId: mira.id,
      excerpt: 'Mira', use: 'depicted',
    });
    assert.equal(runRules(sample.store, ctx, ['depicted_person_elsewhere']).findings.length, 1);
    const anchorId = sample.store.sqlite.prepare('select id from text_anchor where mark_id = ?').get('anchor-test') as { id: string };
    api['row.update']({ table: 'text_anchor', id: anchorId.id, patch: { use: 'mentioned' } });
    assert.equal(runRules(sample.store, ctx, ['depicted_person_elsewhere']).findings.length, 0);
    sample.store.close();
  });

  it('kontrollerer kun tilstand og besiddelse, når teksten selv gør den påstand', () => {
    const sample = makeWorld();
    const api = createApi(sample.store);
    const bench = new Workbench(sample.store);
    bench.setActive({ worldId: sample.worldId, branchId: sample.branchId });
    const object = api['entity.create']({ name: 'Nøglen', kind: 'object' });
    const room = api['entity.create']({ name: 'Rummet', kind: 'place' });
    const mira = api['entity.create']({ name: 'Mira', kind: 'person' });
    const jon = api['entity.create']({ name: 'Jon', kind: 'person' });
    let workId = '';
    inTurn(sample.store, { branchId: sample.branchId, actor: { kind: 'system' }, summary: 'Prøvebog' }, (session) => {
      workId = session.insert(work, { worldId: sample.worldId, branchId: sample.branchId, title: 'Prøvebog', createdAt: new Date() })['id'] as string;
    });
    const ctx = bench.setActive({ worldId: sample.worldId, branchId: sample.branchId, workId });
    const ch = api['chapter.create']({ title: 'Afsnit' });
    const sc = api['scene.create']({ chapterId: ch.id, title: 'Nøglen', realmId: sample.realmId });
    const ev = api['event.create']({ title: 'Nøglen vises', realmId: sample.realmId, earliest: 200, latest: 200 });
    api['row.update']({ table: 'event', id: ev.id, patch: { placeId: room.id } });
    api['scene.linkEvent']({ sceneId: sc.id, eventId: ev.id, mode: 'dramatised' });
    api['continuity.state.create']({ entityId: object.id, category: 'stand', value: 'intakt', fromTime: 100, toTime: 300 });
    api['possession.create']({ holderEntityId: jon.id, objectEntityId: object.id, fromTime: 100, toTime: 300 });
    api['anchor.create']({
      sceneId: sc.id, markId: 'state-anchor', targetKind: 'entity', targetId: object.id,
      use: 'state', stateCategory: 'stand', stateValue: 'revnet',
    });
    api['anchor.create']({
      sceneId: sc.id, markId: 'held-anchor', targetKind: 'entity', targetId: object.id,
      use: 'held', relatedEntityId: mira.id,
    });
    assert.equal(runRules(sample.store, ctx, ['prose_object_claim']).findings.length, 2);
    sample.store.close();
  });
});
