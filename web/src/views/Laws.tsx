import { useState, type FormEvent } from 'react';
import { call } from '../client';
import { useQuery } from '../store';
import { Editable } from './Editable';
import { DeleteRow } from './DeleteRow';

export function Laws({ nonce }: { nonce: number }) {
  const [own, setOwn] = useState(0);
  const [notice, setNotice] = useState('');
  const { data, loading } = useQuery('list.laws', undefined, [nonce, own]);
  const { data: people } = useQuery('list.entities', { kind: 'person' }, [nonce, own]);
  const { data: context } = useQuery('context.get', undefined, [nonce, own]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const [scopeKind, scopeId] = String(form.get('scope') ?? 'world:').split(':');
    try {
      await call('law.create', {
        kind: String(form.get('kind')) as 'ability' | 'prohibition',
        hardness: String(form.get('hardness')) as 'hard' | 'soft',
        statement: String(form.get('statement')),
        ruleCode: String(form.get('ruleCode') ?? '') || undefined,
        subjectKind: String(form.get('person') ?? '') ? 'entity' : 'everyone',
        subjectEntityId: String(form.get('person') ?? '') || undefined,
        scopeKind: scopeKind as 'world' | 'series' | 'work' | 'realm',
        scopeId: scopeId || undefined,
      });
      formElement.reset();
      setOwn((n) => n + 1);
      setNotice('Loven er gemt.');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };

  return (
    <div className="page">
      <h2>Love</h2>
      <p className="lede">
        Hvad der kan og ikke kan lade sig gøre her. En <em>evne</em> ophæver en indbygget regel for
        nogen bestemt; et <em>påbud</em> tilføjer en grænse, motoren ikke kendte.
      </p>
      {notice && <p className="notice" role="status">{notice}</p>}
      <form className="creation-card creation-inline" onSubmit={create}>
        <h3>Ny regel i historien</h3>
        <label>Slags<select name="kind"><option value="ability">Evne / undtagelse</option><option value="prohibition">Påbud / begrænsning</option></select></label>
        <label>Hvordan gælder den?<select name="hardness"><option value="soft">Blødt (fortællende tekst)</option><option value="hard">Hårdt (koblet til en kontrolregel)</option></select></label>
        <label>Regel, hvis hård<input name="ruleCode" placeholder="fx travel_time" /></label>
        <label>Hvem?<select name="person"><option value="">Alle</option>{people?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Omfang<select name="scope"><option value="world:">Hele verdenen</option>
          {context?.active?.workId && <option value={`work:${context.active.workId}`}>Denne bog</option>}
          {context?.realms.map((realm) => <option key={realm.id} value={`realm:${realm.id}`}>Lag: {realm.name}</option>)}
        </select></label>
        <label className="creation-wide">Beskrivelse<input name="statement" required placeholder="Mira kan bevæge sig mellem drømme uden at vågne" /></label>
        <button className="btn primary">Opret lov</button>
      </form>
      {loading && !data && <p className="empty">Henter …</p>}
      {data?.length === 0 && <p className="empty">Ingen love endnu.</p>}
      {data && data.length > 0 && <table className="table"><thead><tr><th>Slags</th><th>Loven</th><th>Gælder</th><th>Regel</th><th></th></tr></thead><tbody>
        {data.map((row) => <tr key={row.id}>
          <td><span className={row.kind === 'ability' ? 'chip story' : 'chip disc'}>{row.kind === 'ability' ? 'evne' : 'påbud'}</span><span className="chip quiet">{row.hardness === 'soft' ? 'blød' : 'hård'}</span></td>
          <td><Editable table="law" id={row.id} field="statement" value={row.statement} onSaved={() => setOwn((n) => n + 1)} onError={setNotice} /></td>
          <td className="dim">{row.subject ?? 'alle'}</td><td className="mono dim">{row.ruleCode ?? '—'}</td>
          <td><button className="btn small" onClick={async () => {
            try { await call('row.update', { table: 'law', id: row.id, patch: { enabled: !row.enabled } }); setOwn((n) => n + 1); }
            catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
          }}>{row.enabled ? 'Slå fra' : 'Slå til'}</button> <DeleteRow table="law" id={row.id} label={row.statement}
            onDeleted={() => setOwn((n) => n + 1)} onError={setNotice} /></td>
        </tr>)}
      </tbody></table>}
    </div>
  );
}
