import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openStore, type Store } from '../db/client';
import { createServer } from '../mcp/server';

/**
 * The MCP surface, driven the way it will actually be driven: a conversation
 * that builds a small piece of story and then asks the model questions about it.
 */
describe('MCP-fladen', () => {
  let store: Store;
  let client: Client;

  const call = async (name: string, args: Record<string, unknown> = {}): Promise<string> => {
    const result = await client.callTool({ name, arguments: args }) as
      { content: { type: string; text: string }[]; isError?: boolean };
    const text = result.content.map((c) => c.text).join('\n');
    if (result.isError) throw new Error(text);
    return text;
  };

  before(async () => {
    store = openStore(':memory:');
    const server = createServer(store);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'proeve', version: '1.0.0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  });

  after(async () => {
    await client.close();
    store.close();
  });

  it('viser hele fladen', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of [
      'opret_verden', 'saet_aktivt_vaerk', 'opret_lag', 'opret_entitet', 'opret_ben',
      'registrer_hukommelse',
      'opret_event', 'tilfoej_tidsbaand', 'registrer_faktum', 'registrer_overbevisning',
      'opret_afsloering', 'opdater', 'slet', 'fortryd', 'hvem_vidste_hvad', 'koer_tidsloesning',
      'vis_scene_til_gennemgang', 'tilfoej_margennote', 'vis_margennoter', 'afgoer_margennote',
      'registrer_tilstand', 'registrer_forsvinding', 'opret_plottraad', 'tilfoej_slag',
    ]) {
      assert.ok(names.includes(expected), `mangler værktøjet ${expected}`);
    }
    assert.ok(names.every((n) => /^[a-z_]+$/.test(n)), 'værktøjsnavne skal være danske og små');
  });

  it('siger pænt til, når der ikke er valgt noget endnu', async () => {
    assert.match(await call('hent_kontekst'), /ikke valgt en verden/);
  });

  it('bygger en verden gennem samtale', async () => {
    assert.match(await call('opret_verden', { navn: 'Kystbyen' }), /er oprettet og er nu den aktive/);
    await call('opret_vaerk', { titel: 'Det store fald' });

    await call('opret_entitet', { navn: 'Anna', slags: 'person' });
    await call('opret_entitet', { navn: 'Teddy', slags: 'person' });
    await call('opret_entitet', { navn: 'Havnen', slags: 'place' });

    const context = await call('hent_kontekst');
    assert.match(context, /Verden: Kystbyen/);
    assert.match(context, /Bog: Det store fald/);
    assert.match(context, /Entiteter: 3/);
  });

  it('finder folk på navn i stedet for at kræve id', async () => {
    const answer = await call('registrer_tilstedevaerelse', {
      person: 'Anna', sted: 'Havnen', fra: '1985-06-12', til: '1985-06-13',
    });
    assert.match(answer, /Anna var på Havnen/);
  });

  it('kan sætte personens hukommelse én gang gennem samtalen', async () => {
    assert.match(await call('registrer_hukommelse', {
      person: 'Anna', fra: '1985-06-12', varighed: '15 minutter',
      note: 'Efter ulykken.',
    }), /registreret for Anna/);
    const policy = store.sqlite.prepare(
      'select retention_seconds, note from memory_policy',
    ).get() as { retention_seconds: number; note: string };
    assert.equal(policy.retention_seconds, 15 * 60);
    assert.equal(policy.note, 'Efter ulykken.');
  });

  it('lader et præcist navn slå et delvist, men nægter at gætte ellers', async () => {
    await call('opret_entitet', { navn: 'Anna Berg', slags: 'person' });

    // "Anna" er stadig entydig: det præcise navn vinder over det delvise træf.
    assert.match(
      await call('registrer_tilstedevaerelse', { person: 'Anna', sted: 'Havnen' }),
      /Anna var på Havnen/,
    );

    // "Ann" passer på begge, og så skal den spørge frem for at vælge.
    await assert.rejects(
      () => call('registrer_tilstedevaerelse', { person: 'Ann', sted: 'Havnen' }),
      /kan være flere ting/,
    );
  });

  it('fletter to navne, der viste sig at være samme person', async () => {
    const answer = await call('flet_entiteter', { behold: 'Anna Berg', flet: 'Anna' });
    assert.match(answer, /flettet ind i/);
    // Nu er "Anna" entydig igen, fordi kun "Anna Berg" er tilbage.
    assert.match(await call('hvem_var_hvor', { sted: 'Havnen' }), /Anna Berg/);
  });

  it('holder tiden uskarp og lader båndene stramme den', async () => {
    await call('opret_event', { titel: 'Branden', tidligst: '1985-03-01', senest: '1985-04-30' });
    await call('opret_event', { titel: 'Mødet' });
    await call('opret_event', { titel: 'Afrejsen', tidligst: '1985-03-25', senest: '1985-03-25' });
    await call('tilfoej_tidsbaand', {
      fra_event: 'Branden', til_event: 'Mødet', slags: 'offset', forskydning: '3 dage',
    });
    await call('tilfoej_tidsbaand', { fra_event: 'Mødet', til_event: 'Afrejsen', slags: 'before' });

    const solved = await call('koer_tidsloesning');
    assert.match(solved, /Ingen problemer/);

    const found = await call('find', { tekst: 'Branden' });
    const id = /\(([0-9a-z]{16})\)/.exec(found)![1]!;
    const row = store.sqlite.prepare('select solved_latest from "event" where id = ?')
      .get(id) as { solved_latest: number };
    // "1985-03-25" er et helt døgn, så senest er kl. 23.59.59 — og branden kan
    // højst ligge tre døgn før dét. Uskarpheden går hele vejen igennem.
    const marts22Slut = Date.UTC(1985, 2, 22, 23, 59, 59) / 1000;
    assert.equal(row.solved_latest, marts22Slut, 'branden kan ikke være senere end tre dage før afrejsen');
  });

  it('skiller personens viden fra læserens', async () => {
    await call('registrer_faktum', {
      paastand: 'draebte', resume: 'Nogen dræbte Peter',
      pladser: [
        { navn: 'gerningsmand', slags: 'entity', vaerdi: { person: 'Teddy' } },
        { navn: 'offer', slags: 'text', vaerdi: { tekst: 'Peter' } },
      ],
    });
    await call('registrer_overbevisning', {
      person: 'Anna Berg', faktum: 'Nogen dræbte Peter', styrke: 'suspects',
      binder: { offer: { tekst: 'Peter' } },
    });

    const known = await call('hvem_vidste_hvad', { person: 'Anna Berg' });
    assert.match(known, /suspects/);
    assert.match(known, /offer: Peter/);
    assert.ok(!/gerningsmand: Teddy/.test(known), 'hun mistænker, men kender ikke gerningsmanden');

    await call('opret_kapitel', { titel: 'Liget' });
    await call('opret_scene', { kapitel: 'Liget', titel: 'På havnen', synsvinkel: 'Anna Berg' });
    await call('opret_afsloering', {
      faktum: 'Nogen dræbte Peter', scene: 'På havnen', plads: 'offer',
    });

    const reader = await call('hvad_ved_laeseren', { gennem_kapitel: 1 });
    assert.match(reader, /kun: offer/, 'læseren har heller ikke fået gerningsmanden endnu');
  });

  it('gennemgår manuskriptet i margenen uden at ændre prosaen', async () => {
    await call('gem_scenetekst', {
      scene: 'På havnen', tekst: 'Anna så ud over det mørke vand.',
    });
    const packet = await call('vis_scene_til_gennemgang', { scene: 'På havnen' });
    assert.match(packet, /PROSA\nAnna så ud over det mørke vand\./);
    assert.match(packet, /Ret aldrig prosaen/);

    const note = await call('tilfoej_margennote', {
      scene: 'På havnen', slags: 'craft', besked: 'Gør sanseindtrykket mere konkret.',
      foreslaaet_tekst: 'Tjæren og saltet hang i luften.',
    });
    const id = /\(id: ([0-9a-z]{16})\)/.exec(note)![1]!;
    assert.match(await call('vis_margennoter', { scene: 'På havnen' }), /ikke anvendt|Tjæren og saltet|forslag:/);

    const before = store.sqlite.prepare(
      `select st.id, st.markdown from scene_text st join scene s on s.id = st.scene_id
        where s.title = ? and st.is_current = 1`,
    ).get('På havnen') as { id: string; markdown: string };
    assert.match(await call('afgoer_margennote', { id, status: 'accepted' }), /prosaen er urørt/);
    const after = store.sqlite.prepare(
      `select st.id, st.markdown from scene_text st join scene s on s.id = st.scene_id
        where s.title = ? and st.is_current = 1`,
    ).get('På havnen') as { id: string; markdown: string };
    assert.deepEqual(after, before);
  });

  it('fortryder en hel handling og kan gentage den', async () => {
    await call('opret_entitet', { navn: 'Fejltagelsen', slags: 'person' });
    assert.match(await call('find', { tekst: 'Fejltagelsen' }), /Fejltagelsen/);

    assert.match(await call('fortryd'), /Fortrudt/);
    assert.match(await call('find', { tekst: 'Fejltagelsen' }), /Intet der matcher/);

    await call('gentag');
    assert.match(await call('find', { tekst: 'Fejltagelsen' }), /Fejltagelsen/);
  });

  it('ruller tilbage til et nedslag', async () => {
    await call('saet_nedslag', { maerkat: 'før oprydning' });
    await call('opret_entitet', { navn: 'Kladde 1', slags: 'person' });
    await call('opret_entitet', { navn: 'Kladde 2', slags: 'person' });

    const rolled = await call('rul_tilbage_til', { nedslag: 'før oprydning' });
    assert.match(rolled, /2 handlinger er fortrudt/);
    assert.match(await call('find', { tekst: 'Kladde' }), /Intet der matcher/);
  });

  it('viser hvem der lavede hvad', async () => {
    const log = await call('historik', { antal: 5 });
    assert.match(log, /af Claude/, 'alt fra MCP skal stå som Claudes arbejde');
    assert.match(log, /\[trin \d+\]/);
  });

  it('svarer med ord, ikke med et nedbrud, når noget er galt', async () => {
    await assert.rejects(() => call('opret_scene', { kapitel: 'Findes Ikke' }), /kan ikke finde/);
    await assert.rejects(
      () => call('opret_lov', { slags: 'ability', haardhed: 'hard', udsagn: 'Anna kan flyve' }),
      /skal pege på en regel/,
    );
    await assert.rejects(() => call('slet', { tabel: 'change', id: 'x' }), /del af historikken/);
  });
});

/**
 * Several worlds in one database is the ordinary case -- three prøvecases plus
 * whatever is actually being written. Keeping them apart is not a detail: the
 * failure mode is silent, and it looks like the model has gone mad.
 */
describe('flere verdener i samme database', () => {
  let store: Store;
  let client: Client;

  const call = async (name: string, args: Record<string, unknown> = {}): Promise<string> => {
    const result = await client.callTool({ name, arguments: args }) as
      { content: { type: string; text: string }[]; isError?: boolean };
    const text = result.content.map((c) => c.text).join('\n');
    if (result.isError) throw new Error(text);
    return text;
  };

  before(async () => {
    store = openStore(':memory:');
    const server = createServer(store);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'proeve', version: '1.0.0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

    await call('opret_verden', { navn: 'Første' });
    await call('opret_vaerk', { titel: 'Bog A' });
    await call('opret_entitet', { navn: 'Baren', slags: 'place' });

    await call('opret_verden', { navn: 'Anden' });
    await call('opret_vaerk', { titel: 'Bog B' });
    await call('opret_entitet', { navn: 'Baren', slags: 'place' });
  });

  after(async () => {
    await client.close();
    store.close();
  });

  it('skifter gren med, når man skifter verden', async () => {
    await call('saet_aktivt_vaerk', { verden: 'Første' });
    const context = await call('hent_kontekst');
    assert.match(context, /Verden: Første/);
    assert.match(context, /Entiteter: 1/, 'kun den ene verdens ting må tælle med');
  });

  it('vælger bogen selv, når verdenen kun har én', async () => {
    assert.match(await call('saet_aktivt_vaerk', { verden: 'Anden' }), /på bogen "Bog B"/);
  });

  it('holder to steder med samme navn adskilt', async () => {
    await call('saet_aktivt_vaerk', { verden: 'Første' });
    await call('opret_entitet', { navn: 'Ida', slags: 'person' });
    // Ville være tvetydigt, hvis begge verdeners "Baren" var i spil.
    assert.match(
      await call('registrer_tilstedevaerelse', { person: 'Ida', sted: 'Baren' }),
      /Ida var på Baren/,
    );
  });

  it('siger til, når navnet findes — men i en anden verden', async () => {
    await call('saet_aktivt_vaerk', { verden: 'Anden' });
    await assert.rejects(
      () => call('registrer_tilstedevaerelse', { person: 'Ida', sted: 'Baren' }),
      /findes en i "Første"/,
    );
  });

  it('kan løse tiden i hver verden for sig', async () => {
    for (const verden of ['Første', 'Anden']) {
      await call('saet_aktivt_vaerk', { verden });
      assert.match(await call('koer_tidsloesning'), /Ingen problemer/);
    }
  });
});
