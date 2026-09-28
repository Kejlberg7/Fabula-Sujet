import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { describe, it } from 'node:test';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openStore } from '../db/client';
import { createApi } from '../server/api';
import { Workbench } from '../core/workbench';
import { entity, textAnchor } from '../db/schema';
import { loadMemento } from '../fixtures/memento';
import { findingTargets } from '../../web/src/finding-targets';
import { makeWorld } from './helpers';

describe('Fase 16 — overblik og robusthed', () => {
  it('tager imod en ny, tom database uden at opfinde en verden', () => {
    const store = openStore(':memory:');
    try {
      const api = createApi(store);
      assert.equal(api['context.get']().active, null);
    } finally { store.close(); }
  });

  it('holder fremmednøglerne intakte efter alle aktuelle migreringer', () => {
    const sample = makeWorld();
    try {
      const violations = sample.store.sqlite.pragma('foreign_key_check') as unknown[];
      assert.deepEqual(violations, []);
      const anchorUse = sample.store.sqlite.prepare('pragma table_info(text_anchor)').all() as { name: string; dflt_value: string | null }[];
      assert.equal(anchorUse.find((column) => column.name === 'use')?.dflt_value, "'mentioned'");
    } finally { sample.store.close(); }
  });

  it('opgraderer en eksisterende fortælling fra før de nye ankerfelter', () => {
    const sample = makeWorld();
    try {
      loadMemento(sample.store);
      const before = sample.store.db.select().from(textAnchor).all().length;
      assert.ok(before > 0);
      // Re-create the schema shape just before migrations 0011/0012. This is
      // an in-memory copy only; the populated user database is never altered.
      sample.store.sqlite.exec(`
        alter table text_anchor drop column state_value;
        alter table text_anchor drop column state_category;
        alter table text_anchor drop column related_entity_id;
        alter table text_anchor drop column use;
      `);
      const journal = JSON.parse(readFileSync(new URL('../../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as {
        entries: { when: number }[];
      };
      for (const entry of journal.entries.slice(-2)) {
        sample.store.sqlite.prepare('delete from __drizzle_migrations where created_at = ?').run(entry.when);
      }
      migrate(sample.store.db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
      const columns = sample.store.sqlite.prepare('pragma table_info(text_anchor)').all() as { name: string; dflt_value: string | null }[];
      assert.equal(columns.find((column) => column.name === 'use')?.dflt_value, "'mentioned'");
      assert.ok(columns.some((column) => column.name === 'related_entity_id'));
      const legacyLabels = sample.store.sqlite.prepare(
        'select count(*) as n from text_anchor where use != ?',
      ).get('mentioned') as { n: number };
      assert.equal(legacyLabels.n, 0);
      assert.deepEqual(sample.store.sqlite.pragma('foreign_key_check'), []);
    } finally { sample.store.close(); }
  });

  it('tegner tidslinjen for mindst 2.000 events uden at miste en deltager', () => {
    const sample = makeWorld();
    try {
      const api = createApi(sample.store);
      new Workbench(sample.store).setActive({ worldId: sample.worldId, branchId: sample.branchId });
      const personId = 'person-performance';
      sample.store.db.insert(entity).values({
        id: personId, worldId: sample.worldId, branchId: sample.branchId,
        kind: 'person', name: 'Prøveperson', createdAt: new Date(),
      }).run();
      const putEvent = sample.store.sqlite.prepare(`
        insert into event (id, world_id, realm_id, branch_id, title, earliest, latest, precision, created_at)
        values (?, ?, ?, ?, ?, ?, ?, 'day', ?)
      `);
      const putParticipant = sample.store.sqlite.prepare(`
        insert into participation (id, branch_id, event_id, entity_id, role)
        values (?, ?, ?, ?, 'witness')
      `);
      const seed = sample.store.sqlite.transaction(() => {
        for (let i = 0; i < 2_000; i += 1) {
          const id = `event-performance-${i}`;
          const time = 946_684_800 + i * 86_400;
          putEvent.run(id, sample.worldId, sample.realmId, sample.branchId, `Hændelse ${i}`, time, time, time * 1000);
          putParticipant.run(`part-performance-${i}`, sample.branchId, id, personId);
        }
      });
      seed();
      const started = performance.now();
      const result = api['timeline.get']({ by: 'person' });
      const elapsed = performance.now() - started;
      assert.equal(result.items.length, 2_000);
      assert.equal(result.lanes.find((lane) => lane.id === personId)?.itemCount, 2_000);
      assert.ok(elapsed < 5_000, `2.000 events tog ${Math.round(elapsed)} ms (grænse: 5.000 ms)`);
    } finally { sample.store.close(); }
  });

  it('læser et manuskript på 100.000 ord fordelt på 250 scener', () => {
    const sample = makeWorld();
    try {
      const api = createApi(sample.store);
      new Workbench(sample.store).setActive({ worldId: sample.worldId, branchId: sample.branchId });
      sample.store.sqlite.prepare(`
        insert into work (id, world_id, branch_id, title, created_at) values (?, ?, ?, ?, ?)
      `).run('work-manuscript', sample.worldId, sample.branchId, 'Stor roman', Date.now());
      sample.store.sqlite.prepare(`
        insert into chapter (id, work_id, branch_id, title, position) values (?, ?, ?, ?, 1)
      `).run('chapter-manuscript', 'work-manuscript', sample.branchId, 'Del I');
      const putScene = sample.store.sqlite.prepare(`
        insert into scene (id, chapter_id, branch_id, title, position, realm_id)
        values (?, ?, ?, ?, ?, ?)
      `);
      const putText = sample.store.sqlite.prepare(`
        insert into scene_text (id, scene_id, branch_id, doc, markdown, word_count, is_current, created_at)
        values (?, ?, ?, ?, ?, 400, 1, ?)
      `);
      const paragraph = Array.from({ length: 400 }, (_, i) => `ord${i}`).join(' ');
      const seed = sample.store.sqlite.transaction(() => {
        for (let i = 0; i < 250; i += 1) {
          const sceneId = `scene-manuscript-${i}`;
          putScene.run(sceneId, 'chapter-manuscript', sample.branchId, `Scene ${i}`, i + 1, sample.realmId);
          putText.run(`text-manuscript-${i}`, sceneId, sample.branchId,
            JSON.stringify({ type: 'doc', content: [] }), paragraph, Date.now());
        }
      });
      seed();
      const started = performance.now();
      const scenes = api['scene.list']({ workId: 'work-manuscript' });
      const elapsed = performance.now() - started;
      assert.equal(scenes.length, 250);
      assert.equal(scenes.reduce((sum, row) => sum + row.wordCount, 0), 100_000);
      assert.ok(elapsed < 5_000, `manuskriptindekset tog ${Math.round(elapsed)} ms (grænse: 5.000 ms)`);
    } finally { sample.store.close(); }
  });

  it('holder ordbogens antal og navne i takt med MCP-serverens faktiske værktøjer', async () => {
    const { readFileSync } = await import('node:fs');
    const { allTools } = await import('../mcp/server');
    const glossary = readFileSync(new URL('../../docs/ORDBOG.md', import.meta.url), 'utf8');
    assert.equal(Number(glossary.match(/(\d+) værktøjer/)?.[1]), allTools.length);
    for (const tool of allTools) assert.ok(glossary.includes(`\`${tool.name}\``), tool.name);
  });

  it('fører et fund direkte til person, event, faktum og konkret scene', () => {
    const targets = findingTargets({
      entities: ['person-1'], events: ['event-1'], facts: ['fact-1'], rows: ['scene-1'],
    }, [{ id: 'person-1', name: 'Mira', kind: 'person' }],
    [{ id: 'event-1', title: 'Mødet' }], [{ id: 'fact-1', summary: 'Nøglen er væk' }],
    [{ title: 'Kapitel 3', scenes: [{ id: 'scene-1', title: 'Bagdøren' }] }]);
    assert.deepEqual(targets, [
      { label: 'Mira', href: 'personer?id=person-1' },
      { label: 'Mødet', href: 'events?id=event-1' },
      { label: 'Nøglen er væk', href: 'fakta?id=fact-1' },
      { label: 'Kapitel 3 · Bagdøren', href: 'skrivebord?scene=scene-1' },
    ]);
  });
});
