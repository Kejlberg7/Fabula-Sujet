import { useState, type FormEvent } from 'react';
import { call } from '../client';
import { useQuery } from '../store';
import { formatInstant, KIND_DA, ROLE_DA, SOURCE_DA, STRENGTH_DA } from '../format';
import { Editable } from './Editable';
import { Scrubber } from './Scrubber';
import type { Notice } from '../main';
import { ReferenceLinks } from './ReferenceLinks';
import { DeleteRow } from './DeleteRow';

const TITLES: Record<string, { heading: string; lede: string }> = {
  person: {
    heading: 'Personer',
    lede: 'Hvem der er med. Klik for at se, hvor de har været, hvad de har deltaget i, og hvad de ved.',
  },
  place: {
    heading: 'Steder',
    lede: 'Hvor det foregår. Rejsetid mellem steder er en hård grænse, kun en evne kan løfte den.',
  },
  object: {
    heading: 'Ting',
    lede: 'Genstande. Nogle af dem bærer viden — en seddel, et fotografi, en tatovering.',
  },
};

export function Entities({
  kind, nonce, notify, onChanged,
}: { kind: string; nonce: number; notify: (n: Notice) => void; onChanged: () => void }) {
  const requested = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('id');
  const [selected, setSelected] = useState<string | null>(requested);
  const { data, loading } = useQuery('list.entities', { kind }, [nonce]);
  const { data: references } = useQuery('reference.list', undefined, [nonce]);
  const meta = TITLES[kind]!;

  const saved = (text: string) => { notify({ text }); onChanged(); };
  const failed = (text: string) => notify({ text, bad: true });

  const createEntity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const made = await call('entity.create', {
        name: String(form.get('name')), kind: kind as 'person' | 'place' | 'object',
        summary: String(form.get('summary') ?? '') || undefined,
      });
      const createdName = String(form.get('name'));
      formElement.reset();
      setSelected(made.id);
      saved(`${createdName} er oprettet.`);
    } catch (error) { failed(error instanceof Error ? error.message : String(error)); }
  };

  return (
    <div className="page">
      <h2>{meta.heading}</h2>
      <p className="lede">{meta.lede}</p>

      <form className="creation-card creation-inline" onSubmit={createEntity}>
        <h3>Opret {meta.heading.toLowerCase().replace(/er$/, '')}</h3>
        <label>Navn<input name="name" required /></label>
        <label>Beskrivelse<input name="summary" placeholder="Det, du vil huske om den" /></label>
        <button className="btn primary">Opret</button>
      </form>

      {loading && !data && <p className="empty">Henter …</p>}
      {data?.length === 0 && <p className="empty">Ingen {meta.heading.toLowerCase()} endnu.</p>}

      {data && data.length > 0 && (
        <div className="split">
          <table className="table">
            <thead>
              <tr>
                <th>Navn</th>
                <th>Beskrivelse</th>
                {kind === 'person' && <th className="num">Ben</th>}
                <th className="num">Optræder</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id} aria-selected={selected === row.id}
                  onClick={() => setSelected(row.id)}>
                  <td>
                    {references?.filter((item) => item.targetKind === 'entity' && item.targetId === row.id)
                      .map((item) => <span className="reference-code" key={item.id}>{item.code}</span>)}
                    {row.name}
                  </td>
                  <td className="dim">{row.summary ?? '—'}</td>
                  {kind === 'person' && (
                    <td className="num">
                      {row.legCount > 1
                        ? <span className="chip story">{row.legCount}</span>
                        : row.legCount}
                    </td>
                  )}
                  <td className="num">{row.appearances}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {selected && (
            <EntityPanel id={selected} kind={kind} nonce={nonce} onSaved={saved} onError={failed} />
          )}
        </div>
      )}
    </div>
  );
}

function EntityPanel({
  id, kind, nonce, onSaved, onError,
}: { id: string; kind: string; nonce: number; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const { data, error } = useQuery('entity.get', { id }, [nonce]);
  if (error) return <div className="panel">{error}</div>;
  if (!data) return <div className="panel">Henter …</div>;

  return (
    <aside className="panel">
      <span className="kind">{KIND_DA[data.kind] ?? data.kind}</span>
      <h3>
        <Editable table="entity" id={data.id} field="name" value={data.name}
          onSaved={onSaved} onError={onError} />
      </h3>
      <Editable table="entity" id={data.id} field="summary" value={data.summary} multiline
        placeholder="Kort beskrivelse …" onSaved={onSaved} onError={onError} />

      <ReferenceLinks targetKind="entity" targetId={data.id} nonce={nonce} />
      <DeleteRow table="entity" id={data.id} label={data.name}
        onDeleted={() => { onSaved(`${data.name} er slettet.`); window.location.hash = kind === 'person' ? 'personer' : kind === 'place' ? 'steder' : 'ting'; }}
        onError={onError} />

      {data.kind === 'person' && (
        <>
          {data.memoryPolicies.length > 0 && (
            <>
              <h4>Hukommelse</h4>
              <ul>
                {data.memoryPolicies.map((policy) => (
                  <li key={policy.id}>
                    {policy.retentionSeconds == null
                      ? 'Oplevelser huskes permanent'
                      : `Oplevelser huskes i ${formatDuration(policy.retentionSeconds)}`}
                    <div className="mono" style={{ color: 'var(--muted)' }}>
                      fra {policy.fromPersonal == null ? 'altid' : formatInstant(policy.fromPersonal, 'minute')}
                      {policy.untilPersonal != null
                        ? ` til ${formatInstant(policy.untilPersonal, 'minute')}` : ''}
                    </div>
                    {policy.note && <div className="dim small">{policy.note}</div>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <h4>Videnskurven</h4>
          <Scrubber entityId={data.id} nonce={nonce} legCount={data.legs.length} />
        </>
      )}

      {data.legs.length > 1 && (
        <>
          <h4>Verdenslinje — {data.legs.length} ben</h4>
          <ul>
            {data.legs.map((leg) => (
              <li key={leg.id}>
                <strong>{leg.ordinal}.</strong> {leg.label ?? '(uden mærkat)'}
                <div className="mono" style={{ color: 'var(--muted)' }}>
                  {leg.worldFrom ?? '?'} – {leg.worldTo ?? '?'}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.presences.length > 0 && (
        <>
          <h4>Var her</h4>
          <ul>
            {data.presences.map((p) => (
              <li key={p.placeId + String(p.fromTime)}>
                {p.placeName}
                {p.legOrdinal && p.legOrdinal > 1 && (
                  <span className="chip story" style={{ marginLeft: 6 }}>ben {p.legOrdinal}</span>
                )}
                <div className="mono" style={{ color: 'var(--muted)' }}>
                  {p.fromTime == null ? '?' : formatInstant(p.fromTime, 'day')}
                  {p.toTime != null && p.toTime !== p.fromTime
                    ? ` – ${formatInstant(p.toTime, 'day')}` : ''}
                  {p.realmName !== 'Virkeligheden' ? ` · ${p.realmName}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.participations.length > 0 && (
        <>
          <h4>Deltager i</h4>
          <ul>
            {data.participations.map((p) => (
              <li key={p.id}>
                {p.eventTitle}
                <span className="chip quiet" style={{ marginLeft: 6 }}>
                  {ROLE_DA[p.role] ?? p.role}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {(data.knows.length > 0 || data.legs.length > 1) && (
        <>
          <h4>
            Ved
            <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
              {data.knownLeg && data.legs.length > 1
                && ` som ${data.knownLeg.label ?? `ben ${data.knownLeg.ordinal}`}`}
              {data.knownAt != null && ` — pr. ${formatInstant(data.knownAt, 'day')}`}
            </span>
          </h4>
          {data.knows.length === 0 && (
            <p style={{ color: 'var(--muted)', margin: '4px 0 0' }}>
              Ingenting — {data.legs.length > 1
                ? 'ikke på dette ben af livet.'
                : 'endnu.'}
            </p>
          )}
          <ul>
            {data.knows.map((k) => (
              <li key={k.factId}>
                {k.summary}
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  {STRENGTH_DA[k.strength] ?? k.strength} · {SOURCE_DA[k.source] ?? k.source}
                  {k.viaObject ? ` (${k.viaObject})` : ''}
                </div>
                {Object.keys(k.binds).length > 0 && (
                  <div className="mono" style={{ color: 'var(--muted)' }}>
                    {Object.entries(k.binds).map(([slot, v]) => `${slot}: ${v}`).join(' · ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

function formatDuration(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} dage`;
  if (seconds % 3600 === 0) return `${seconds / 3600} timer`;
  if (seconds % 60 === 0) return `${seconds / 60} minutter`;
  return `${seconds} sekunder`;
}
