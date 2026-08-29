import { useState } from 'react';
import { call } from '../client';
import { useQuery } from '../store';
import { formatInstant } from '../format';
import type { Notice } from '../main';

/**
 * The history screen.
 *
 * There is no approval prompt in front of the MCP surface, so this is the
 * safety net: what happened, when, and whether it was you or Claude. From any
 * point you can roll back -- and rolling back is itself an action, so it too
 * can be undone.
 */
export function History({
  nonce, notify, onChanged,
}: { nonce: number; notify: (n: Notice) => void; onChanged: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const { data, loading, reload } = useQuery('history.list', { limit: 60 }, [nonce]);

  const act = async (fn: () => Promise<string>) => {
    try {
      notify({ text: await fn() });
      reload();
      onChanged();
    } catch (error) {
      notify({ text: error instanceof Error ? error.message : String(error), bad: true });
    }
  };

  return (
    <div className="page">
      <h2>Historik</h2>
      <p className="lede">
        Hvad der er sket, og af hvem. Alt kan rulles tilbage — også tilbagerulningen.
      </p>

      <div className="tl-controls">
        <button className="btn" onClick={() => act(async () => {
          const label = window.prompt('Hvad skal nedslaget hedde?');
          if (!label) return 'Intet nedslag sat.';
          await call('history.checkpoint', { label });
          return `Nedslaget «${label}» er sat.`;
        })}>Sæt nedslag her</button>
      </div>

      {loading && !data && <p className="empty">Henter …</p>}
      {data?.length === 0 && <p className="empty">Der er ikke sket noget endnu.</p>}

      {data?.map((turn) => (
        <div key={turn.turnId} className={turn.undone ? 'turn undone' : 'turn'}>
          <span className="seq">trin {turn.lastSeq}</span>
          <div>
            <div className="summary">{turn.summary ?? '(uden beskrivelse)'}</div>
            <div className="meta">
              {formatInstant(Math.floor(turn.startedAt / 1000), 'minute')} · af {turn.who} ·{' '}
              {turn.changeCount} {turn.changeCount === 1 ? 'ændring' : 'ændringer'}
              {turn.kind === 'undo' && ' · fortrydelse'}
              {' · '}
              <button
                className="btn" style={{ padding: '1px 6px', fontSize: 11 }}
                onClick={() => setOpen(open === turn.turnId ? null : turn.turnId)}
              >
                {open === turn.turnId ? 'skjul' : 'vis rækker'}
              </button>
            </div>
            {open === turn.turnId && <Rows turnId={turn.turnId} nonce={nonce} />}
          </div>
          <button
            className="btn" disabled={turn.undone}
            onClick={() => act(async () => {
              const result = await call('history.rollback', { seq: turn.lastSeq });
              return result.undone === 0
                ? 'Der var ikke noget at rulle tilbage.'
                : `Rullet tilbage hertil. ${result.undone} handling${result.undone === 1 ? '' : 'er'} fortrudt.`;
            })}
          >
            Rul tilbage hertil
          </button>
        </div>
      ))}
    </div>
  );
}

function Rows({ turnId, nonce }: { turnId: string; nonce: number }) {
  const { data } = useQuery('changes.list', { turnId, limit: 200 }, [nonce]);
  if (!data) return null;
  const verb: Record<string, string> = {
    insert: 'oprettede', update: 'rettede', delete: 'slettede', merge: 'flettede',
  };
  return (
    <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
      {data.map((row) => (
        <li key={row.seq} className="mono" style={{ color: 'var(--muted)' }}>
          [{row.seq}] {verb[row.op] ?? row.op} {row.table}
          {row.label ? ` — ${row.label}` : ''}
          {row.undone && ' (fortrudt)'}
        </li>
      ))}
    </ul>
  );
}
