import { useQuery } from '../store';
import { formatInstant } from '../format';
import type { View } from '../main';

export function Overview({ nonce, onGo }: { nonce: number; onGo: (v: View) => void }) {
  const { data: context } = useQuery('context.get', undefined, [nonce]);
  const { data: entities } = useQuery('list.entities', {}, [nonce]);
  const { data: events } = useQuery('list.events', undefined, [nonce]);
  const { data: facts } = useQuery('list.facts', undefined, [nonce]);
  const { data: history } = useQuery('history.list', { limit: 6 }, [nonce]);

  const count = (kind: string) => entities?.filter((e) => e.kind === kind).length ?? 0;
  const placed = events?.filter((e) => e.placed).length ?? 0;
  const certain = events?.filter((e) => e.certain).length ?? 0;
  const multiLeg = entities?.filter((e) => e.legCount > 1).length ?? 0;
  const nested = context?.realms.filter((r) => r.parentRealmId).length ?? 0;

  const card = (label: string, value: string | number, note: string, go?: View) => (
    <button
      className="panel"
      onClick={go ? () => onGo(go) : undefined}
      style={{
        position: 'static', textAlign: 'left', cursor: go ? 'pointer' : 'default',
        border: '1px solid var(--line)', font: 'inherit',
      }}
    >
      <span className="kind">{label}</span>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 30, lineHeight: 1.1, margin: '2px 0 4px' }}>
        {value}
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 12 }}>{note}</div>
    </button>
  );

  return (
    <div className="page">
      <h2>{context?.active?.worldName ?? 'Forsiden'}</h2>
      <p className="lede">
        {context?.active?.workTitle
          ? <>Du arbejder på <strong>{context.active.workTitle}</strong>, på grenen {context.active.branchName}.</>
          : <>Ingen bog er valgt. Vælg en foroven, eller arbejd bare i verdenen.</>}
      </p>

      <div style={{
        display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
        marginBottom: 26,
      }}>
        {card('Personer', count('person'),
          multiLeg > 0 ? `${multiLeg} med flere ben` : 'alle med ét ben', 'personer')}
        {card('Steder', count('place'), 'i verdenen', 'steder')}
        {card('Events', events?.length ?? 0,
          `${certain} fastlagt, ${placed - certain} inden for et spænd`, 'events')}
        {card('Fakta', facts?.length ?? 0, 'påstande med pladser', 'fakta')}
        {card('Lag', context?.realms.length ?? 0,
          nested > 0 ? `${nested} inden i et andet` : 'kun virkeligheden')}
      </div>

      {events && events.length > placed && (
        <div className="banner">
          <h4>{events.length - placed} events er ikke placeret i tiden</h4>
          <p>
            Det er ikke en fejl — det er sådan, man arbejder. Bind dem til noget, du kender
            tidspunktet på, og tryk «Løs tiden».
          </p>
        </div>
      )}

      <h3 style={{ fontFamily: 'var(--serif)', fontSize: 18, margin: '24px 0 8px' }}>
        Det seneste
      </h3>
      {history?.length === 0 && <p className="empty">Der er ikke sket noget endnu.</p>}
      {history?.map((turn) => (
        <div key={turn.turnId} className={turn.undone ? 'turn undone' : 'turn'}
          style={{ gridTemplateColumns: '1fr auto' }}>
          <div>
            <div className="summary">{turn.summary ?? '(uden beskrivelse)'}</div>
            <div className="meta">
              {formatInstant(Math.floor(turn.startedAt / 1000), 'minute')} · af {turn.who}
            </div>
          </div>
          <button className="btn" onClick={() => onGo('historik')}>Se historikken</button>
        </div>
      ))}
    </div>
  );
}
