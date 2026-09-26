import { useState, type FormEvent } from 'react';
import { call } from '../client';
import { useQuery } from '../store';
import { formatInstant, LINK_DA, MODE_DA, ROLE_DA } from '../format';
import { Editable } from './Editable';
import type { Notice } from '../main';
import { ReferenceLinks } from './ReferenceLinks';
import { DeleteRow } from './DeleteRow';

export function Events({
  nonce, notify, onChanged,
}: { nonce: number; notify: (n: Notice) => void; onChanged: () => void }) {
  const requested = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('id');
  const [selected, setSelected] = useState<string | null>(requested);
  const { data, loading } = useQuery('list.events', undefined, [nonce]);
  const { data: references } = useQuery('reference.list', undefined, [nonce]);
  const { data: context } = useQuery('context.get', undefined, [nonce]);
  const { data: people } = useQuery('list.entities', { kind: 'person' }, [nonce]);
  const { data: facts } = useQuery('list.facts', undefined, [nonce]);

  const unplaced = data?.filter((e) => !e.placed).length ?? 0;
  const vague = data?.filter((e) => e.placed && !e.certain).length ?? 0;

  const createEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const title = String(form.get('title'));
    const rawTime = String(form.get('time') ?? '');
    try {
      const made = await call('event.create', {
        title, realmId: String(form.get('realm')),
        summary: String(form.get('summary') ?? '') || undefined,
        ...(rawTime ? { earliest: Math.floor(new Date(rawTime).getTime() / 1000), latest: Math.floor(new Date(rawTime).getTime() / 1000) } : {}),
      });
      formElement.reset(); setSelected(made.id); notify({ text: `Eventet «${title}» er oprettet.` }); onChanged();
    } catch (error) { notify({ text: error instanceof Error ? error.message : String(error), bad: true }); }
  };

  return (
    <div className="page">
      <h2>Events</h2>
      <p className="lede">
        Hvad der skete, i den rækkefølge det skete. Et event har et spænd, ikke et tidspunkt —
        det er meningen, og løseren strammer det, efterhånden som du binder events sammen.
      </p>
      <form className="creation-card creation-inline" onSubmit={createEvent}>
        <h3>Nyt event</h3>
        <label>Hvad sker der?<input name="title" required /></label>
        <label>Fortællingslag<select name="realm" required>{context?.realms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label>Tidspunkt, hvis kendt<input name="time" type="datetime-local" /></label>
        <label>Notat<input name="summary" /></label>
        <button className="btn primary">Opret event</button>
      </form>

      {data && data.length > 0 && (unplaced > 0 || vague > 0) && (
        <div className="banner">
          <h4>Sådan står tiden</h4>
          <p>
            {data.length - unplaced - vague} fastlagt · {vague} inden for et spænd
            {unplaced > 0 && ` · ${unplaced} slet ikke placeret`}
          </p>
        </div>
      )}

      {loading && !data && <p className="empty">Henter …</p>}
      {data?.length === 0 && <p className="empty">Ingen events endnu.</p>}

      {data && data.length > 0 && (
        <div className="split">
          <table className="table">
            <thead>
              <tr>
                <th>Hvornår</th>
                <th>Hvad</th>
                <th>Hvor</th>
                <th className="num">Med</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id} aria-selected={selected === row.id}
                  onClick={() => setSelected(row.id)}>
                  <td className={row.certain ? 'mono' : 'mono vague'}>{row.when}</td>
                  <td>
                    {references?.filter((item) => item.targetKind === 'event' && item.targetId === row.id)
                      .map((item) => <span className="reference-code" key={item.id}>{item.code}</span>)}
                    {row.title}
                  </td>
                  <td className="dim">
                    {row.placeName ?? '—'}
                    {row.realmName !== 'Virkeligheden' && (
                      <span className="chip disc" style={{ marginLeft: 6 }}>{row.realmName}</span>
                    )}
                  </td>
                  <td className="num">{row.participants}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {selected && (
            <EventPanel
              id={selected} nonce={nonce}
              events={data ?? []} people={people ?? []} facts={facts ?? []}
              onSaved={(text) => { notify({ text }); onChanged(); }}
              onError={(text) => notify({ text, bad: true })}
            />
          )}
        </div>
      )}
    </div>
  );
}

function EventPanel({
  id, nonce, events, people, facts, onSaved, onError,
}: { id: string; nonce: number; events: { id: string; title: string }[]; people: { id: string; name: string }[]; facts: { id: string; summary: string }[]; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const { data, error } = useQuery('event.get', { id }, [nonce]);
  if (error) return <div className="panel">{error}</div>;
  if (!data) return <div className="panel">Henter …</div>;

  const b = data.bounds;
  return (
    <aside className="panel">
      <span className="kind">Event · {data.realmName}</span>
      <h3>
        <Editable table="event" id={data.id} field="title" value={data.title}
          onSaved={onSaved} onError={onError} />
      </h3>
      <Editable table="event" id={data.id} field="summary" value={data.summary} multiline
        placeholder="Hvad skete der …" onSaved={onSaved} onError={onError} />

      <ReferenceLinks targetKind="event" targetId={data.id} nonce={nonce} />
      <DeleteRow table="event" id={data.id} label={data.title}
        onDeleted={() => { onSaved(`Eventet «${data.title}» er slettet.`); window.location.hash = 'events'; }} onError={onError} />

      <dl>
        <dt>Tid</dt>
        <dd className={b.from != null && b.from === b.fromLatest ? '' : 'vague'}>
          {b.from == null
            ? 'ikke placeret'
            : b.from === b.fromLatest
              ? formatInstant(b.from, data.precision === 'unknown' ? 'day' : data.precision)
              : `${formatInstant(b.from, 'day')} – ${formatInstant(b.fromLatest!, 'day')}`}
        </dd>
        {data.duration && (<><dt>Varighed</dt><dd>{data.duration}</dd></>)}
        {data.placeName && (<><dt>Sted</dt><dd>{data.placeName}</dd></>)}
        {(data.solvedAt != null) && (
          <><dt>Løst</dt><dd className="mono" style={{ color: 'var(--muted)' }}>af tidsløseren</dd></>
        )}
      </dl>

      {data.participants.length > 0 && (
        <>
          <h4>Deltagere</h4>
          <ul>
            {data.participants.map((p) => (
              <li key={p.id}>
                {p.name}
                <span className="chip quiet" style={{ marginLeft: 6 }}>
                  {ROLE_DA[p.role] ?? p.role}
                </span>
                {p.absorbs === false && (
                  <span className="chip alert" style={{ marginLeft: 4 }}>opfatter ikke</span>
                )}
                <DeleteRow table="participation" id={p.id} label={`${p.name} som ${ROLE_DA[p.role] ?? p.role}`}
                  onDeleted={() => onSaved('Deltagelsen er slettet.')} onError={onError} />
              </li>
            ))}
          </ul>
        </>
      )}
      <form className="event-mini-form" onSubmit={async (event) => {
        event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
        try {
          await call('participation.create', {
            eventId: data.id, entityId: String(form.get('person')),
            role: String(form.get('role')) as 'actor' | 'witness' | 'victim' | 'present_unaware' | 'mentioned',
          });
          formElement.reset(); onSaved('Deltageren er knyttet til eventet.');
        } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
      }}>
        <label>Tilføj deltager<select name="person" required>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Rolle<select name="role"><option value="actor">handler</option><option value="witness">vidne</option><option value="victim">offer</option><option value="present_unaware">til stede, uvidende</option><option value="mentioned">omtalt</option></select></label>
        <button className="btn small">Knyt</button>
      </form>

      {data.exposes.length > 0 && (
        <>
          <h4>Lægger på bordet</h4>
          <ul>{data.exposes.map((e) => <li key={e.id}>{e.summary}
            <DeleteRow table="event_fact" id={e.id} label={`knytningen til ${e.summary}`}
              onDeleted={() => onSaved('Faktumtilknytningen er slettet.')} onError={onError} />
          </li>)}</ul>
        </>
      )}
      <form className="event-mini-form" onSubmit={async (event) => {
        event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
        try {
          await call('event.fact.create', {
            eventId: data.id, factId: String(form.get('fact')),
            exposes: String(form.get('exposes')) as 'establishes' | 'reveals' | 'evidences',
          });
          formElement.reset(); onSaved('Faktummet er knyttet til eventet.');
        } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
      }}>
        <label>Eventet afslører<select name="fact" required>{facts.map((fact) => <option key={fact.id} value={fact.id}>{fact.summary}</option>)}</select></label>
        <label>Hvordan?<select name="exposes"><option value="reveals">afslører</option><option value="evidences">giver tegn på</option><option value="establishes">slår fast som sandt</option></select></label>
        <button className="btn small">Knyt faktum</button>
      </form>

      {data.links.length > 0 && (
        <>
          <h4>Tidsbånd</h4>
          <ul>
            {data.links.map((l) => (
              <li key={l.id}>
                <span className="mono" style={{ color: 'var(--muted)' }}>
                  {l.outgoing ? '→' : '←'}
                </span>{' '}
                {LINK_DA[l.kind] ?? l.kind}{l.offset ? ` ${l.offset}` : ''} {l.otherTitle}
                {l.axis === 'personal' && (
                  <span className="chip story" style={{ marginLeft: 6 }}>personlig tid</span>
                )}
                <DeleteRow table="temporal_link" id={l.id} label={`tidsbånd til ${l.otherTitle}`}
                  onDeleted={() => onSaved('Tidsbåndet er slettet.')} onError={onError} />
              </li>
            ))}
          </ul>
        </>
      )}
      <form className="event-mini-form" onSubmit={async (event) => {
        event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
        try {
          await call('temporal.create', {
            fromEventId: data.id, toEventId: String(form.get('other')),
            kind: String(form.get('kind')) as 'before' | 'after' | 'same_time' | 'offset' | 'during',
            axis: String(form.get('axis')) as 'world' | 'personal',
            offsetMin: Number(form.get('offsetMin') || 0) * 86400,
            offsetMax: Number(form.get('offsetMax') || 0) * 86400,
          });
          formElement.reset(); onSaved('Tidsbåndet er oprettet.');
        } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
      }}>
        <label>Tidsbånd til<select name="other" required>{events.filter((e) => e.id !== data.id).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>
        <label>Forhold<select name="kind"><option value="before">før</option><option value="after">efter</option><option value="same_time">samtidig</option><option value="during">under</option><option value="offset">forskudt</option></select></label>
        <label>Tidsakse<select name="axis"><option value="world">verdens tid</option><option value="personal">personlig tid</option></select></label>
        <label>Forskydning mindst (dage)<input name="offsetMin" type="number" step="any" /></label>
        <label>Forskydning højst (dage)<input name="offsetMax" type="number" step="any" /></label>
        <button className="btn small">Opret tidsbånd</button>
      </form>

      {data.scenes.length > 0 && (
        <>
          <h4>Fortælles i</h4>
          <ul>
            {data.scenes.map((s) => (
              <li key={s.sceneId}>
                <span className="chip disc">{s.chapterPosition}</span>{' '}
                {s.chapterTitle}
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  {s.sceneTitle} · {MODE_DA[s.mode] ?? s.mode}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
