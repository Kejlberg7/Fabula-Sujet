import { useEffect, useState, type FormEvent } from 'react';
import { call } from '../client';
import { TRUTH_DA } from '../format';
import { useQuery } from '../store';
import { Editable } from './Editable';
import { DeleteRow } from './DeleteRow';
import { ReferenceLinks } from './ReferenceLinks';

const STRENGTHS = [
  ['knows', 'ved'], ['convinced', 'overbevist'], ['suspects', 'mistænker'],
  ['mistaken', 'tror fejlagtigt'], ['denies', 'benægter'], ['unaware', 'uvidende'],
];

export function Facts({ nonce }: { nonce: number }) {
  const [own, setOwn] = useState(0);
  const [notice, setNotice] = useState('');
  const requestedId = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('id');
  const { data, loading } = useQuery('list.facts', undefined, [nonce, own]);
  const { data: references } = useQuery('reference.list', undefined, [nonce, own]);
  const { data: people } = useQuery('list.entities', { kind: 'person' }, [nonce, own]);
  const { data: events } = useQuery('list.events', undefined, [nonce, own]);
  const { data: scenes } = useQuery('scene.list', {}, [nonce, own]);
  const { data: objects } = useQuery('list.entities', { kind: 'object' }, [nonce, own]);
  const { data: context } = useQuery('context.get', undefined, [nonce, own]);

  useEffect(() => {
    if (requestedId && data?.some((row) => row.id === requestedId)) {
      document.getElementById(`fact-${requestedId}`)?.scrollIntoView({ block: 'center' });
    }
  }, [data, requestedId]);

  const submit = (route: 'fact.create' | 'belief.create' | 'statement.create' | 'carrier.create' | 'reveal.create', build: (form: FormData) => object) =>
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      try {
        await call(route, build(form) as never);
        formElement.reset();
        setOwn((n) => n + 1);
        setNotice('Gemt i historikken. Fortryd kan hente det tilbage.');
      } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    };

  return (
    <div className="page">
      <h2>Fakta og viden</h2>
      <p className="lede">
        Et faktum beskriver, hvad der er sandt i verden. Personers overbevisninger og udsagn
        beskriver, hvad de selv tror eller siger — også når de tager fejl eller lyver.
      </p>
      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="creation-grid">
        <form className="creation-card" onSubmit={submit('fact.create', (f) => ({
          summary: String(f.get('summary') ?? ''), predicate: String(f.get('predicate') ?? ''),
          realmId: String(f.get('realmId') ?? ''), truth: String(f.get('truth') ?? 'true'),
          slots: String(f.get('slots') ?? '').split(',').map((name) => name.trim()).filter(Boolean)
            .map((name) => ({ name, valueKind: 'text' as const })),
        }))}>
          <h3>Nyt faktum</h3>
          <label>Påstand<input name="summary" required placeholder="Mira gemte nøglen" /></label>
          <label>Maskinnavn<input name="predicate" required placeholder="gemte" /></label>
          <label>Virkelighedslag<select name="realmId" required>
            {context?.realms.map((realm) => <option key={realm.id} value={realm.id}>{realm.name}</option>)}
          </select></label>
          <label>Sandhed<select name="truth">{Object.entries(TRUTH_DA).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Pladser, adskilt med komma<input name="slots" placeholder="gerningsmand, genstand" /></label>
          <button className="btn primary">Opret faktum</button>
        </form>

        <form className="creation-card" onSubmit={submit('belief.create', (f) => ({
          entityId: String(f.get('person') ?? ''), factId: String(f.get('fact') ?? ''),
          strength: String(f.get('strength') ?? 'knows'), note: String(f.get('note') ?? '') || undefined,
        }))}>
          <h3>Hvad tror en person?</h3>
          <label>Person<select name="person" required>{people?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Faktum<select name="fact" required>{data?.map((f) => <option key={f.id} value={f.id}>{f.summary}</option>)}</select></label>
          <label>Overbevisning<select name="strength">{STRENGTHS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
          <label>Note<input name="note" placeholder="Valgfrit" /></label>
          <button className="btn primary">Registrer viden</button>
        </form>

        <form className="creation-card" onSubmit={submit('statement.create', (f) => ({
          speakerEntityId: String(f.get('speaker') ?? ''), factId: String(f.get('fact') ?? ''),
          truthful: f.get('truthful') === '' ? undefined : f.get('truthful') === 'true',
          audienceEntityId: String(f.get('audience') ?? '') || undefined,
          eventId: String(f.get('event') ?? '') || undefined,
          note: String(f.get('note') ?? '') || undefined,
        }))}>
          <h3>Hvad siger personen?</h3>
          <label>Taler<select name="speaker" required>{people?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Udsagn om<select name="fact" required>{data?.map((f) => <option key={f.id} value={f.id}>{f.summary}</option>)}</select></label>
          <label>Sandfærdigt?<select name="truthful"><option value="">Ikke afgjort</option><option value="true">Ja</option><option value="false">Nej, løgn</option></select></label>
          <label>Til hvem (valgfrit)<select name="audience"><option value="">Åbent</option>{people?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Ved hvilket event<select name="event"><option value="">Ikke knyttet til et event</option>{events?.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>
          <label>Note<input name="note" placeholder="Valgfrit" /></label>
          <button className="btn primary">Registrer udsagn</button>
        </form>

        <form className="creation-card" onSubmit={submit('carrier.create', (f) => ({
          objectEntityId: String(f.get('object') ?? ''), factId: String(f.get('fact') ?? ''),
          accurate: f.get('accurate') === 'true', note: String(f.get('note') ?? '') || undefined,
        }))}>
          <h3>En genstand bærer viden</h3>
          <label>Genstand<select name="object" required>{objects?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label>Faktum<select name="fact" required>{data?.map((f) => <option key={f.id} value={f.id}>{f.summary}</option>)}</select></label>
          <label>Er indholdet korrekt?<select name="accurate"><option value="true">Ja</option><option value="false">Nej, genstanden vildleder</option></select></label>
          <label>Note<input name="note" /></label>
          <button className="btn primary">Knyt faktum til genstand</button>
        </form>

        <form className="creation-card" onSubmit={submit('reveal.create', (f) => ({
          sceneId: String(f.get('scene') ?? ''), factId: String(f.get('fact') ?? ''),
          strength: String(f.get('strength') ?? 'stated'),
        }))}>
          <h3>Afsløring til læseren</h3>
          <label>Scene<select name="scene" required>{scenes?.map((s) => <option key={s.id} value={s.id}>{s.chapterTitle} · {s.title ?? 'scene uden titel'}</option>)}</select></label>
          <label>Faktum<select name="fact" required>{data?.map((f) => <option key={f.id} value={f.id}>{f.summary}</option>)}</select></label>
          <label>Hvor tydeligt?<select name="strength"><option value="hinted">vink</option><option value="implied">antydet</option><option value="stated">fortalt</option><option value="confirmed">bekræftet</option></select></label>
          <button className="btn primary">Planlæg afsløring</button>
        </form>
      </div>

      {loading && !data && <p className="empty">Henter …</p>}
      {data?.length === 0 && <p className="empty">Ingen fakta endnu.</p>}
      {data && data.length > 0 && <table className="table"><thead><tr><th>Faktum</th><th>Pladser</th><th>Sandhed</th><th>Tror det</th><th></th></tr></thead><tbody>
        {data.map((row) => <tr key={row.id} id={`fact-${row.id}`}>
          <td>{references?.filter((r) => r.targetKind === 'fact' && r.targetId === row.id).map((r) => <span className="reference-code" key={r.id}>{r.code}</span>)}
            <Editable table="fact" id={row.id} field="summary" value={row.summary} onSaved={() => setOwn((n) => n + 1)} onError={setNotice} />
            <div className="fact-edit-row"><span className="mono dim">Prædikat</span><Editable table="fact" id={row.id} field="predicate" value={row.predicate} onSaved={() => setOwn((n) => n + 1)} onError={setNotice} /></div>
            {(row.beliefs.length > 0 || row.statements.length > 0 || row.carriers.length > 0) && <details className="fact-claims">
              <summary>{row.beliefs.length} overbevisninger · {row.statements.length} udsagn · {row.carriers.length} genstande</summary>
              {row.beliefs.map((belief) => <div className="fact-claim-row" key={belief.id}>{belief.person}
                <select aria-label={`Overbevisning: ${belief.person}`} value={belief.strength} onChange={async (event) => {
                  try { await call('row.update', { table: 'belief', id: belief.id, patch: { strength: event.target.value } }); setOwn((n) => n + 1); }
                  catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
                }}>{STRENGTHS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                {belief.note && ` · ${belief.note}`} <DeleteRow table="belief" id={belief.id} label={`${belief.person}s overbevisning`} onDeleted={() => setOwn((n) => n + 1)} onError={setNotice} />
              </div>)}
              {row.statements.map((statement) => <div className="fact-claim-row" key={statement.id}>{statement.speaker} siger det
                <select aria-label={`Sandhed i udsagn fra ${statement.speaker}`} value={statement.truthful == null ? 'unknown' : String(statement.truthful)} onChange={async (event) => {
                  try { await call('row.update', { table: 'statement', id: statement.id, patch: { truthful: event.target.value === 'unknown' ? null : event.target.value === 'true' } }); setOwn((n) => n + 1); }
                  catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
                }}><option value="unknown">uafgjort</option><option value="true">sandt</option><option value="false">usandt</option></select>
                {statement.audience && ` til ${statement.audience}`}{statement.note && ` · ${statement.note}`} <DeleteRow table="statement" id={statement.id} label={`${statement.speaker}s udsagn`} onDeleted={() => setOwn((n) => n + 1)} onError={setNotice} />
              </div>)}
              {row.carriers.map((carrier) => <div className="fact-claim-row" key={carrier.id}>{carrier.object} bærer det {carrier.accurate ? 'korrekt' : 'forkert'}{carrier.note && ` · ${carrier.note}`}
                <DeleteRow table="carrier" id={carrier.id} label={`${carrier.object}s notat`} onDeleted={() => setOwn((n) => n + 1)} onError={setNotice} />
              </div>)}
            </details>}</td>
          <td className="mono">{Object.entries(row.binds).map(([slot, value]) => <div key={slot}>{slot}: {value}</div>)}</td>
          <td><select aria-label={`Sandhed: ${row.summary}`} value={row.truth} onChange={async (event) => {
            try { await call('row.update', { table: 'fact', id: row.id, patch: { truth: event.target.value } }); setOwn((n) => n + 1); }
            catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
          }}>{Object.entries(TRUTH_DA).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td><td>{row.believers}</td>
          <td><details className="fact-backlinks"><summary>Omtaler</summary><ReferenceLinks targetKind="fact" targetId={row.id} nonce={nonce} /></details>
            <DeleteRow table="fact" id={row.id} label={row.summary}
            onDeleted={() => { setOwn((n) => n + 1); setNotice('Faktummet er slettet. Fortryd henter det tilbage.'); }} onError={setNotice} /></td>
        </tr>)}
      </tbody></table>}
    </div>
  );
}
