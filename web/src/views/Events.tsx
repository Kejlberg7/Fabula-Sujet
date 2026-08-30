import { useState } from 'react';
import { useQuery } from '../store';
import { formatInstant, LINK_DA, MODE_DA, ROLE_DA } from '../format';
import { Editable } from './Editable';
import type { Notice } from '../main';
import { ReferenceLinks } from './ReferenceLinks';

export function Events({
  nonce, notify, onChanged,
}: { nonce: number; notify: (n: Notice) => void; onChanged: () => void }) {
  const requested = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('id');
  const [selected, setSelected] = useState<string | null>(requested);
  const { data, loading } = useQuery('list.events', undefined, [nonce]);
  const { data: references } = useQuery('reference.list', undefined, [nonce]);

  const unplaced = data?.filter((e) => !e.placed).length ?? 0;
  const vague = data?.filter((e) => e.placed && !e.certain).length ?? 0;

  return (
    <div className="page">
      <h2>Events</h2>
      <p className="lede">
        Hvad der skete, i den rækkefølge det skete. Et event har et spænd, ikke et tidspunkt —
        det er meningen, og løseren strammer det, efterhånden som du binder events sammen.
      </p>

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
  id, nonce, onSaved, onError,
}: { id: string; nonce: number; onSaved: (m: string) => void; onError: (m: string) => void }) {
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
              </li>
            ))}
          </ul>
        </>
      )}

      {data.exposes.length > 0 && (
        <>
          <h4>Lægger på bordet</h4>
          <ul>{data.exposes.map((e) => <li key={e.id}>{e.summary}</li>)}</ul>
        </>
      )}

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
              </li>
            ))}
          </ul>
        </>
      )}

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
