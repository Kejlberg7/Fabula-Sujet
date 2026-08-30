import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import {
  Session, history, inTurn, markCheckpoint, redoLast, rollbackTo, undoLast, undoTurn,
} from '../core/changelog';
import { change, entity } from '../db/schema';
import { makeWorld } from './helpers';

const actor = { kind: 'user' as const };

describe('ændringsloggen', () => {
  const w = makeWorld();
  const { db } = w.store;
  const store = w.store;
  after(() => w.store.close());

  const person = (name: string) => ({
    worldId: w.worldId, branchId: w.branchId, kind: 'person' as const,
    name, createdAt: new Date(),
  });

  it('optegner en indsættelse med sin modsatte', () => {
    const s = Session.begin(store, { branchId: w.branchId, actor, summary: 'Opret Anna' });
    const row = s.insert(entity, person('Anna'));
    s.end();

    const logged = db.select().from(change).where(eq(change.turnId, s.id)).all();
    assert.equal(logged.length, 1);
    assert.equal(logged[0]!.op, 'insert');
    assert.equal(logged[0]!.tableName, 'entity');
    assert.equal(logged[0]!.before, null);
    assert.equal((logged[0]!.after as { name: string }).name, 'Anna');
    assert.equal(s.changeCount, 1);
    assert.ok(row['id']);
  });

  it('fortryder en hel tur, ikke én række ad gangen', () => {
    const s = Session.begin(store, { branchId: w.branchId, actor, summary: 'Tre personer' });
    s.insert(entity, person('Bo'));
    s.insert(entity, person('Cecilie'));
    s.insert(entity, person('David'));
    s.end();
    assert.equal(db.select().from(entity).all().length, 4);

    undoTurn(store, s.id, actor);
    assert.equal(db.select().from(entity).all().length, 1, 'alle tre skal væk på én gang');
  });

  it('lader en tur, der ikke ændrede noget, slippe forbi fortryd', () => {
    // Oprydningen af forladte tekstankre skriver en tur, hver gang prosaen
    // gemmes, og som regel er der intet at rydde op. Fandt fortryd den, ville
    // klikket sige «Fortrudt» uden at tage noget tilbage.
    const real = Session.begin(store, { branchId: w.branchId, actor, summary: 'Frida' });
    real.insert(entity, person('Frida'));
    real.end();

    Session.begin(store, { branchId: w.branchId, actor, summary: 'Intet at rydde op' }).end();

    undoLast(store, w.branchId, actor);
    assert.equal(
      db.select().from(entity).where(eq(entity.name, 'Frida')).all().length, 0,
      'fortryd skal ramme den sidste tur, der faktisk skrev noget',
    );
  });

  it('gentag er at fortryde fortrydelsen', () => {
    const s = Session.begin(store, { branchId: w.branchId, actor, summary: 'Emil' });
    s.insert(entity, person('Emil'));
    s.end();

    undoLast(store, w.branchId, actor);
    assert.equal(db.select().from(entity).where(eq(entity.name, 'Emil')).all().length, 0);

    redoLast(store, w.branchId, actor);
    assert.equal(db.select().from(entity).where(eq(entity.name, 'Emil')).all().length, 1);
  });

  it('fører en rettelse tilbage til den tidligere værdi', () => {
    const created = inTurn(store, { branchId: w.branchId, actor, summary: 'Frida' }, (s) =>
      s.insert(entity, person('Frida')));
    const id = created['id'] as string;

    const edit = Session.begin(store, { branchId: w.branchId, actor, summary: 'Omdøb Frida' });
    edit.update(entity, id, { name: 'Frida Berg' });
    edit.end();
    assert.equal(db.select().from(entity).where(eq(entity.id, id)).get()!.name, 'Frida Berg');

    undoTurn(store, edit.id, actor);
    assert.equal(db.select().from(entity).where(eq(entity.id, id)).get()!.name, 'Frida');
  });

  it('genskaber en slettet række med alle felter', () => {
    const created = inTurn(store, { branchId: w.branchId, actor, summary: 'Gustav' }, (s) =>
      s.insert(entity, { ...person('Gustav'), summary: 'en gartner' }));
    const id = created['id'] as string;

    const del = Session.begin(store, { branchId: w.branchId, actor, summary: 'Slet Gustav' });
    del.remove(entity, id);
    del.end();
    assert.equal(db.select().from(entity).where(eq(entity.id, id)).get(), undefined);

    undoTurn(store, del.id, actor);
    const back = db.select().from(entity).where(eq(entity.id, id)).get();
    assert.equal(back!.name, 'Gustav');
    assert.equal(back!.summary, 'en gartner', 'felterne skal med tilbage, ikke bare rækken');
  });

  it('ruller tilbage til et nedslag', () => {
    const before = db.select().from(entity).all().length;
    const mark = markCheckpoint(db, w.branchId, 'før oprydning');
    const seq = db.select().from(change).all()
      .reduce((m, c) => Math.max(m, c.seq), 0);
    assert.ok(mark);

    for (const name of ['Hanne', 'Ib', 'Jens']) {
      inTurn(store, { branchId: w.branchId, actor, summary: name }, (s) =>
        s.insert(entity, person(name)));
    }
    assert.equal(db.select().from(entity).all().length, before + 3);

    const undone = rollbackTo(store, w.branchId, seq, actor);
    assert.equal(undone, 3);
    assert.equal(db.select().from(entity).all().length, before);
  });

  it('viser hvem der ændrede hvad', () => {
    inTurn(store, {
      branchId: w.branchId,
      actor: { kind: 'assistant' },
      summary: 'Claude tilføjede Karen',
    }, (s) => s.insert(entity, person('Karen')));

    const entries = history(db, w.branchId, 5);
    const claude = entries.find((e) => e.actorKind === 'assistant');
    assert.ok(claude, 'historikken skal kunne skelne dig fra Claude');
    assert.equal(claude!.changeCount, 2, 'personen og dens arbejdsreference er én synlig handling');
    assert.equal(claude!.summary, 'Claude tilføjede Karen');
  });
});
