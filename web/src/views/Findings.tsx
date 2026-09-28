import { useState } from 'react';
import { call } from '../client';
import { plural } from '../format';
import { useQuery } from '../store';
import type { Notice } from '../main';
import { findingTargets } from '../finding-targets';

const SEVERITY_DA: Record<string, string> = {
  error: 'fejl', warning: 'advarsel', note: 'bemærkning',
};

const SCOPE_DA: Record<string, string> = {
  scene: 'Scene', chapter: 'Kapitel', work: 'Bog', series: 'Serie',
};

const WHEN = new Intl.DateTimeFormat('da-DK', { dateStyle: 'long' });

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
  const { data: runs } = useQuery('review.runs', {}, [nonce, own]);
  const { data: rules } = useQuery('review.rules', undefined, []);
  const { data: entities } = useQuery('list.entities', {}, [nonce]);
  const { data: events } = useQuery('list.events', undefined, [nonce]);
  const { data: facts } = useQuery('list.facts', undefined, [nonce]);
  const { data: chapters } = useQuery('list.chapters', {}, [nonce]);
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
          {findingTargets(f.subjects, entities ?? [], events ?? [], facts ?? [], chapters ?? []).length > 0 && <div className="finding-targets" aria-label="Gå til berørt indhold">
            <span className="dim small">Berører:</span>
            {findingTargets(f.subjects, entities ?? [], events ?? [], facts ?? [], chapters ?? []).map((target) => <a key={target.href} href={`#${target.href}`}>{target.label} ↗</a>)}
          </div>}

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

      {/*
        Gennemlæsningerne står her, fordi de svarer på det samme spørgsmål som
        fundene ovenfor -- hvad er der set efter -- men på den anden akse:
        motoren regner, læsningen læser. Der er ingen knap til at starte en:
        det er Claude, der læser prosaen, og en tom læsning uden nogen til at
        skrive noterne ville kun være en dato.
      */}
      <h3 className="section">Gennemlæsninger</h3>
      {(runs ?? []).length === 0 ? (
        <p className="empty">
          Der er ikke læst noget igennem endnu. Bed Claude om at læse en scene,
          et kapitel, en bog eller hele serien igennem.
        </p>
      ) : (
        (runs ?? []).map((run) => (
          <article key={run.id} className="finding">
            <header>
              <span className="chip quiet">{SCOPE_DA[run.scopeKind] ?? run.scopeKind}</span>
              <strong>{run.scopeLabel}</strong>
              {!run.finishedAt && <span className="chip disc">stadig åben</span>}
              <span className="spacer" />
              <span className="dim small">{WHEN.format(new Date(run.createdAt))}</span>
            </header>
            <p>
              {plural(run.scenes, 'scene', 'scener')} · {plural(run.notes, 'margennote', 'margennoter')}
              {run.openNotes > 0 && ` (${run.openNotes} åbne)`}
            </p>
            <p className="dim">
              {run.rewritten === 0
                ? 'Ingen af scenerne er skrevet om siden.'
                : `${run.rewritten} af scenerne er skrevet om siden — så meget af `
                  + 'læsningen handler om ord, der ikke står der længere.'}
            </p>
            {run.summary && <p className="reason">«{run.summary}»</p>}
          </article>
        ))
      )}

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
