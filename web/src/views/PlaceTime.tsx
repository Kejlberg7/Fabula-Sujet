import { useMemo } from 'react';
import { useQuery } from '../store';

/** A cautious pivot: only explicitly recorded presence is placed in a cell. */
export function PlaceTime({ nonce }: { nonce: number }) {
  const { data, loading } = useQuery('continuity.get', undefined, [nonce]);
  const { data: chronology } = useQuery('timeline.get', { by: 'place' }, [nonce]);
  const rows = data?.presences ?? [];
  const events = chronology?.items ?? [];
  const years = useMemo(() => {
    const bounds = [
      ...rows.flatMap((row) => [row.fromTime, row.toTime]),
      ...events.flatMap((row) => [row.from, row.toLatest]),
    ].filter((n): n is number => n != null);
    if (!bounds.length) return [];
    const first = new Date(Math.min(...bounds) * 1000).getUTCFullYear();
    const last = new Date(Math.max(...bounds) * 1000).getUTCFullYear();
    const stride = last - first > 24 ? Math.ceil((last - first) / 24) : 1;
    return Array.from({ length: Math.ceil((last - first + 1) / stride) }, (_, i) => {
      const start = Date.UTC(first + i * stride, 0, 1) / 1000;
      const end = Date.UTC(first + (i + 1) * stride, 0, 1) / 1000 - 1;
      return { label: stride === 1 ? String(first + i) : `${first + i * stride}–${Math.min(last, first + (i + 1) * stride - 1)}`, start, end };
    });
  }, [rows, events]);
  const placeName = new Map((chronology?.lanes ?? []).map((lane) => [lane.id, lane.name]));
  const places = [...new Set([...rows.map((row) => row.placeName), ...events.map((row) => placeName.get(row.laneId)).filter((name): name is string => !!name)])].sort((a, b) => a.localeCompare(b, 'da'));

  if (loading && !data) return <div className="page"><p className="empty">Læser …</p></div>;
  return <div className="page">
    <h2>Tid × sted</h2>
    <p className="lede">Hvilke events og udtrykkeligt registrerede ophold hører til hvert sted. Tomt betyder «intet registreret her» — ikke «der skete intet».</p>
    {!places.length ? <p className="empty">Der er ingen events med sted eller registrerede ophold endnu.</p> : <div className="matrix-scroll" role="region" aria-label="Tid og sted matrix" tabIndex={0}>
      <table className="table place-time"><thead><tr><th>Sted</th>{years.map((year) => <th key={year.label}>{year.label}</th>)}</tr></thead>
        <tbody>{places.map((place) => <tr key={place}><th scope="row">{place}</th>{years.map((year) => {
          const presenceHits = rows.filter((row) => row.placeName === place
            && (row.fromTime ?? -Infinity) <= year.end && (row.toTime ?? Infinity) >= year.start);
          const eventHits = events.filter((row) => placeName.get(row.laneId) === place
            && row.from <= year.end && row.toLatest >= year.start);
          return <td key={year.label}>
            {eventHits.map((hit) => <div className="matrix-event" key={hit.id} title={`${hit.realmName} · ${formatTime(hit.from)}${hit.certain ? '' : ' (uskarpt)'}`}><a href={`#events?id=${encodeURIComponent(hit.id)}`}>{hit.title}</a></div>)}
            {presenceHits.map((hit) => <div className="matrix-presence" key={hit.id} title={`${hit.personName} · ${hit.realmName} · ${hit.when}`}>{hit.personName}{hit.realmName !== 'Virkeligheden' && <small>{hit.realmName}</small>}</div>)}
          </td>;
        })}</tr>)}</tbody>
      </table>
      <p className="dim small">År er vist i UTC-kalendergrænser. Events uden placering i tid og ophold uden sikre grænser står ikke i en tidskolonne.</p>
    </div>}
  </div>;
}

function formatTime(seconds: number): string {
  return new Intl.DateTimeFormat('da-DK', { dateStyle: 'medium', timeZone: 'UTC' }).format(seconds * 1000);
}
