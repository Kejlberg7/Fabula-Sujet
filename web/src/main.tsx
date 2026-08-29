import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';
import { call } from './client';
import { useQuery } from './store';
import { Overview } from './views/Overview';
import { Timeline } from './views/Timeline';
import { Entities } from './views/Entities';
import { Events } from './views/Events';
import { Facts } from './views/Facts';
import { Laws } from './views/Laws';
import { Chapters } from './views/Chapters';
import { History } from './views/History';

export type View =
  | 'overblik' | 'tidslinje' | 'personer' | 'steder' | 'ting'
  | 'events' | 'fakta' | 'love' | 'kapitler' | 'historik';

export interface Notice { text: string; bad?: boolean }

function useHashView(): [View, (v: View) => void] {
  const read = (): View => (window.location.hash.slice(1) || 'overblik') as View;
  const [view, setView] = useState<View>(read);
  useEffect(() => {
    const onChange = () => setView(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return [view, (v) => { window.location.hash = v; }];
}

/**
 * The work picker.
 *
 * It is the first thing on the screen because it is the thing everything else
 * is relative to -- and because it is the same context the MCP surface uses, so
 * what you pick here is what Claude is talking about too.
 */
function TopBar({
  nonce, notify, onChanged,
}: { nonce: number; notify: (n: Notice) => void; onChanged: () => void }) {
  const [own, setOwn] = useState(0);
  // The picker follows the shared nonce as well as its own: when Claude
  // switches book through MCP, the control has to move with the page.
  const { data, reload } = useQuery('context.get', undefined, [own, nonce]);
  const active = data?.active ?? null;

  const act = useCallback(async (fn: () => Promise<string>) => {
    try {
      notify({ text: await fn() });
      setOwn((n) => n + 1);
      reload();
      onChanged();
    } catch (error) {
      notify({ text: error instanceof Error ? error.message : String(error), bad: true });
    }
  }, [notify, reload, onChanged]);

  const switchTo = (patch: { worldId?: string; workId?: string | null; branchId?: string }) =>
    act(async () => {
      await call('context.set', { worldId: patch.worldId ?? active!.worldId, ...patch });
      return 'Skiftet.';
    });

  return (
    <header className="topbar">
      <span className="brand">Fabula <span className="amp">&amp;</span> Sujet</span>

      {active && (
        <>
          <div className="picker">
            <label htmlFor="world">Verden</label>
            <select
              id="world" value={active.worldId}
              onChange={(e) => switchTo({ worldId: e.target.value, workId: null })}
            >
              {data!.worlds.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>

          <div className="picker">
            <label htmlFor="work">Bog</label>
            <select
              id="work" value={active.workId ?? ''}
              onChange={(e) => switchTo({ workId: e.target.value || null })}
            >
              <option value="">(ingen valgt)</option>
              {data!.works.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.seriesName ? `${w.seriesName}: ${w.title}` : w.title}
                </option>
              ))}
            </select>
          </div>

          <div className="picker">
            <label htmlFor="branch">Gren</label>
            <select
              id="branch" value={active.branchId}
              onChange={(e) => switchTo({ branchId: e.target.value })}
            >
              {data!.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </>
      )}

      <span className="spacer" />

      <button className="btn" onClick={() => act(async () => {
        const r = await call('history.undo');
        return r.turnId ? 'Fortrudt.' : 'Der er ikke noget at fortryde.';
      })}>Fortryd</button>
      <button className="btn" onClick={() => act(async () => {
        const r = await call('history.redo');
        return r.turnId ? 'Gentaget.' : 'Der er ikke nogen fortrydelse at gentage.';
      })}>Gentag</button>
      <button className="btn primary" onClick={() => act(async () => {
        const r = await call('solve');
        return r.findings.length === 0
          ? `Tiden er løst. ${r.updated} events fik nye grænser.`
          : `${r.findings.length} problem${r.findings.length === 1 ? '' : 'er'}: ${r.findings[0]!.message}`;
      })}>Løs tiden</button>
    </header>
  );
}

function App() {
  const [view, setView] = useHashView();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dataNonce, setDataNonce] = useState(0);
  const bump = useCallback(() => setDataNonce((n) => n + 1), []);

  const notify = useCallback((n: Notice) => {
    setNotice(n);
    window.setTimeout(() => setNotice((current) => (current === n ? null : current)), 5000);
  }, []);

  // The screen follows the conversation: Claude writes to the same database
  // through MCP, so anything it changes has to show up here without a reload.
  useEffect(() => {
    let previous = '';
    let stopped = false;
    const beat = async () => {
      try {
        const pulse = await call('pulse');
        const signature = JSON.stringify(pulse);
        if (previous && signature !== previous) bump();
        previous = signature;
      } catch {
        // The server may be restarting. Keep beating; it comes back.
      }
      if (!stopped) window.setTimeout(beat, 2500);
    };
    void beat();
    return () => { stopped = true; };
  }, [bump]);

  const { data: context } = useQuery('context.get', undefined, [dataNonce]);
  const { data: entities } = useQuery('list.entities', {}, [dataNonce]);
  const { data: events } = useQuery('list.events', undefined, [dataNonce]);

  const count = (kind: string) => entities?.filter((e) => e.kind === kind).length ?? 0;
  const item = (id: View, label: string, n?: number) => (
    <button key={id} aria-current={view === id} onClick={() => setView(id)}>
      <span>{label}</span>
      {n != null && <span className="count">{n}</span>}
    </button>
  );

  if (context && !context.active) {
    return (
      <div className="app">
        <TopBar nonce={dataNonce} notify={notify} onChanged={bump} />
        <div className="page">
          <h2>Ingen verden endnu</h2>
          <p className="lede">
            Der er ikke oprettet en verden i denne database. Tal med Claude og sig
            «opret en verden», eller kør <span className="mono">npm run fixtures</span> for at
            lægge prøvecasene ind.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar nonce={dataNonce} notify={notify} onChanged={bump} />
      <div className="body">
        <nav className="nav">
          <h3>Overblik</h3>
          {item('overblik', 'Forsiden')}
          {item('tidslinje', 'Tidslinje')}
          <h3>Verden</h3>
          {item('personer', 'Personer', count('person'))}
          {item('steder', 'Steder', count('place'))}
          {item('ting', 'Ting', count('object'))}
          {item('events', 'Events', events?.length)}
          {item('fakta', 'Fakta')}
          {item('love', 'Love')}
          <h3>Fortælling</h3>
          {item('kapitler', 'Kapitler')}
          <h3>Arbejdet</h3>
          {item('historik', 'Historik')}
        </nav>
        <main>
          {view === 'overblik' && <Overview nonce={dataNonce} onGo={setView} />}
          {view === 'tidslinje' && <Timeline nonce={dataNonce} />}
          {view === 'personer' && <Entities kind="person" nonce={dataNonce} notify={notify} onChanged={bump} />}
          {view === 'steder' && <Entities kind="place" nonce={dataNonce} notify={notify} onChanged={bump} />}
          {view === 'ting' && <Entities kind="object" nonce={dataNonce} notify={notify} onChanged={bump} />}
          {view === 'events' && <Events nonce={dataNonce} notify={notify} onChanged={bump} />}
          {view === 'fakta' && <Facts nonce={dataNonce} />}
          {view === 'love' && <Laws nonce={dataNonce} />}
          {view === 'kapitler' && <Chapters nonce={dataNonce} />}
          {view === 'historik' && <History nonce={dataNonce} notify={notify} onChanged={bump} />}
        </main>
      </div>
      {notice && (
        <div className={notice.bad ? 'toast bad' : 'toast'} onClick={() => setNotice(null)}>
          {notice.text}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
