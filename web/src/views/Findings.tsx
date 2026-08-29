import { useState } from 'react';
import { call } from '../client';
import { useQuery } from '../store';
import type { Notice } from '../main';

const SEVERITY_DA: Record<string, string> = {
  error: 'fejl', warning: 'advarsel', note: 'bemærkning',
};

/**
 * What the engine believes is wrong.
 *
 * It only speaks when it is certain: an event whose date is vague can be placed
 * anywhere in its interval, and if any placement works there is nothing to
 * report -- the writer simply has not decided yet. That restraint is the whole
 * point. A screen that fires on half a working draft is a screen you stop
 * opening, and then the one warning that mattered is never read either.
 */
export function Findings({
  nonce, notify, onChanged,
}: { nonce: number; notify: (n: Notice) => void; onChanged: () => void }) {
  const [own, setOwn] = useState(0);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Awaited<ReturnType<
    typeof call<'review.run'>>> | null>(null);
  const [asideFor, setAsideFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const { data: standing } = useQuery('review.list', undefined, [nonce, own]);
  const { data: rules } = useQuery('review.rules', undefined, []);
  const findings = report?.findings ?? standing ?? [];
  const titleOf = (code: string) =>
    rules?.find((r) => r.code === code)?.title
    ?? (code === 'impossible_chronology' ? 'Umulig kronologi'
      : code === 'unanchored_realm' ? 'Ufæstnet lag' : code);

  const run = async () => {
    setRunning(true);
    try {
      const result = await call('review.run', {});
      setReport(result);
      const { errors, warnings, notes } = result.counts;
      notify({
        text: errors + warnings + notes === 0
          ? 'Gennemgangen fandt ingenting.'
          : `${errors} fejl, ${warnings} advarsler, ${notes} bemærkninger.`,
        bad: errors > 0,
      });
      setOwn((n) => n + 1);
      onChanged();
    } catch (error) {
      notify({ text: error instanceof Error ? error.message : String(error), bad: true });
    } finally {
      setRunning(false);
    }
  };

  const putAside = async (fingerprint: string) => {
    if (!reason.trim()) return;
    try {
      await call('review.dismiss', { fingerprint, reason: reason.trim() });
      notify({ text: 'Lagt til side. Fortryd henter den tilbage.' });
      setAsideFor(null);
      setReason('');
      setReport(null);
      setOwn((n) => n + 1);
      onChanged();
    } catch (error) {
      notify({ text: error instanceof Error ? error.message : String(error), bad: true });
    }
  };

  const takeBack = async (fingerprint: string) => {
    await call('review.undismiss', { fingerprint });
    notify({ text: 'Afvisningen er taget tilbage.' });
    setReport(null);
    setOwn((n) => n + 1);
    onChanged();
  };

  const live = findings.filter((f) => f.dismissedReason == null);
  const aside = findings.filter((f) => f.dismissedReason != null);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Gennemgangen</h2>
          <p className="lede">
            Motoren melder kun det, der ikke kan lade sig gøre — uanset hvor i deres spillerum
            de uskarpe datoer lægges. Er noget bare ubesluttet, siger den ingenting.
          </p>
        </div>
        <button className="btn primary" onClick={run} disabled={running}>
          {running ? 'Kører …' : 'Kør gennemgangen'}
        </button>
      </div>

      {report && (
        <div className="banner">
          <h4>
            {report.counts.errors === 0 && report.counts.warnings === 0
              ? 'Ingenting, der ikke kan lade sig gøre'
              : `${report.counts.errors} fejl og ${report.counts.warnings} advarsler`}
          </h4>
          <p>
            Tiden blev løst på {report.solved.iterations} gennemløb;
            {' '}{report.solved.updated} events fik nye grænser.
            {report.appeared > 0 && ` ${report.appeared} fund er nye.`}
            {report.resolved > 0 && ` ${report.resolved} er blevet rettet siden sidst.`}
            {report.counts.dismissed > 0 && ` ${report.counts.dismissed} er lagt til side.`}
          </p>
        </div>
      )}

      {report && report.lifted.length > 0 && (
        <div className="banner">
          <h4>Løftet af en lov — meldes ikke</h4>
          {report.lifted.map((f, index) => (
            <p key={index}>
              {f.message}
              <br />
              <span className="dim">lov: «{f.lifted}»</span>
            </p>
          ))}
        </div>
      )}

      {live.length === 0 && (
        <p className="empty">
          {report
            ? 'Der er ikke noget, der ikke kan lade sig gøre.'
            : 'Ingen åbne fund. Kør gennemgangen for at se efter.'}
        </p>
      )}

      {live.map((f) => (
        <article key={f.fingerprint} className={`finding ${f.severity}`}>
          <header>
            <span className={`chip ${f.severity}`}>{SEVERITY_DA[f.severity] ?? f.severity}</span>
            <strong>{titleOf(f.ruleCode)}</strong>
            {f.returned && <span className="chip disc">kommet tilbage</span>}
            <span className="spacer" />
            {asideFor === f.fingerprint ? (
              <button className="btn" onClick={() => { setAsideFor(null); setReason(''); }}>
                Fortryd
              </button>
            ) : (
              <button className="btn" onClick={() => setAsideFor(f.fingerprint)}>
                Læg til side
              </button>
            )}
          </header>
          <p>{f.message}</p>

          {asideFor === f.fingerprint && (
            <div className="aside-form">
              <input
                autoFocus
                value={reason}
                placeholder="Hvorfor er det her i orden?"
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void putAside(f.fingerprint); }}
              />
              <button className="btn primary" disabled={!reason.trim()}
                onClick={() => void putAside(f.fingerprint)}>Læg til side</button>
              <p className="dim small">
                Grunden er ikke valgfri. Er det verdenen, der er sådan, hører det hjemme
                som en lov i stedet — så gælder den for alle tilfældene.
              </p>
            </div>
          )}
        </article>
      ))}

      {aside.length > 0 && (
        <>
          <h3 className="section">Lagt til side</h3>
          {aside.map((f) => (
            <article key={f.fingerprint} className="finding aside">
              <header>
                <span className="chip quiet">{titleOf(f.ruleCode)}</span>
                <span className="spacer" />
                <button className="btn" onClick={() => void takeBack(f.fingerprint)}>
                  Tag tilbage
                </button>
              </header>
              <p className="dim">{f.message}</p>
              <p className="reason">«{f.dismissedReason}»</p>
            </article>
          ))}
        </>
      )}
    </div>
  );
}
