import { useState } from 'react';
import { call } from '../client';
import { useQuery } from '../store';
import type { Notice } from '../main';
import { Editable } from './Editable';

type Tab = 'objects' | 'relationships' | 'identities' | 'threads' | 'sources';

const RELATION_DA: Record<string, string> = {
  supports: 'understøtter', context: 'kontekst', conflicts: 'mulig modstrid',
};
const BEAT_DA: Record<string, string> = {
  setup: 'setup', complication: 'komplikation', payoff: 'payoff',
};

export function Continuity({
  nonce, notify, onChanged,
}: { nonce: number; notify: (n: Notice) => void; onChanged: () => void }) {
  const [own, setOwn] = useState(0);
  const [tab, setTab] = useState<Tab>('objects');
  const { data, loading } = useQuery('continuity.get', undefined, [nonce, own]);

  const saved = (text: string) => {
    notify({ text });
    setOwn((n) => n + 1);
    onChanged();
  };
  const failed = (text: string) => notify({ text, bad: true });
  const remove = async (table: string, id: string, label: string) => {
    if (!window.confirm(`Slet ${label}? Du kan hente det tilbage med Fortryd.`)) return;
    try {
      await call('row.delete', { table, id });
      saved('Slettet. Fortryd henter det tilbage.');
    } catch (error) {
      failed(error instanceof Error ? error.message : String(error));
    }
  };
  const edit = (table: string, id: string, field: string, value: string | null, multiline = false) => (
    <Editable table={table} id={id} field={field} value={value} multiline={multiline}
      onSaved={saved} onError={failed} />
  );

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'objects', label: 'Genstande', count: data?.objects.length },
    { id: 'relationships', label: 'Relationer', count: data?.relationships.length },
    { id: 'identities', label: 'Identiteter og huller', count: (data?.identities.length ?? 0) + (data?.disappearances.length ?? 0) },
    { id: 'threads', label: 'Setups og payoffs', count: data?.threads.length },
    { id: 'sources', label: 'Kilder', count: data?.sources.length },
  ];

  return (
    <div className="page continuity-page">
      <h2>Kontinuitet</h2>
      <p className="lede">
        Det, der ændrer sig gennem historien: hvem der har genstanden, hvilken tilstand den er i,
        hvad relationen hedder nu, hvilke navne der er i brug, og hvilke løfter bogen skylder et payoff.
      </p>

      {data && (
        <div className="continuity-stats">
          <span><strong>{data.stats.states}</strong> tilstande</span>
          <span><strong>{data.stats.possessions}</strong> besiddelser</span>
          <span><strong>{data.stats.relationships}</strong> relationer</span>
          <span><strong>{data.stats.identities}</strong> identiteter</span>
          <span><strong>{data.stats.threads}</strong> plottråde</span>
          <span><strong>{data.stats.sources}</strong> kilder</span>
        </div>
      )}

      <div className="continuity-tabs" role="tablist" aria-label="Kontinuitetens områder">
        {tabs.map((item) => (
          <button key={item.id} className="btn" role="tab" aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}>
            {item.label}{item.count != null ? ` ${item.count}` : ''}
          </button>
        ))}
      </div>

      {loading && !data && <p className="empty">Henter …</p>}

      {data && tab === 'objects' && (
        <div className="continuity-grid">
          {data.objects.map((object) => (
            <article className="continuity-card" key={object.id}>
              <h3>{object.name}</h3>
              <p className="dim">{object.summary}</p>
              <h4>Tilstande</h4>
              {object.states.length === 0 && <p className="dim small">Ingen tilstande registreret.</p>}
              {object.states.map((state) => (
                <div className="continuity-row" key={state.id}>
                  <span className="chip quiet">{state.category}</span>
                  <div>{edit('entity_state', state.id, 'value', state.value)}</div>
                  <span className="mono dim">{state.when}</span>
                  <button className="icon-delete" aria-label={`Slet tilstanden ${state.value}`}
                    onClick={() => void remove('entity_state', state.id, `tilstanden «${state.value}»`)}>×</button>
                </div>
              ))}
              <h4>Hos hvem</h4>
              {object.possessions.length === 0 && <p className="dim small">Ingen besiddelser registreret.</p>}
              {object.possessions.map((held) => (
                <div className="continuity-row" key={held.id}>
                  <strong>{held.holderName}</strong>
                  <span className="mono dim">{held.when}</span>
                  <button className="icon-delete" aria-label={`Slet besiddelsen hos ${held.holderName}`}
                    onClick={() => void remove('possession', held.id, `besiddelsen hos ${held.holderName}`)}>×</button>
                </div>
              ))}
            </article>
          ))}
          {data.objects.length === 0 && <p className="empty">Ingen genstande endnu.</p>}
        </div>
      )}

      {data && tab === 'relationships' && (
        <div className="continuity-list">
          {data.relationships.map((row) => (
            <article className="continuity-card relation-card" key={row.id}>
              <strong>{row.fromName}</strong>
              <span className="relation-arrow">{row.symmetric ? '↔' : '→'}</span>
              <div>{edit('relationship', row.id, 'kind', row.kind)}</div>
              <strong>{row.toName}</strong>
              <span className="chip quiet">{row.category ?? 'fri relation'}</span>
              <span className="mono dim">{row.when}</span>
              <button className="icon-delete" aria-label={`Slet relationen ${row.kind}`}
                onClick={() => void remove('relationship', row.id, `relationen «${row.kind}»`)}>×</button>
            </article>
          ))}
          {data.relationships.length === 0 && <p className="empty">Ingen relationer endnu.</p>}
        </div>
      )}

      {data && tab === 'identities' && (
        <div className="continuity-columns">
          <section>
            <h3>Navne og skikkelser</h3>
            {data.identities.map((row) => (
              <article className="continuity-card" key={row.id}>
                <span className="eyebrow">{row.entityName}</span>
                <div className="continuity-title-edit">{edit('identity', row.id, 'name', row.name)}</div>
                <span className="mono dim">{row.when}</span>
                {row.note && <p>{edit('identity', row.id, 'note', row.note, true)}</p>}
                <button className="btn" onClick={() => void remove('identity', row.id, `identiteten «${row.name}»`)}>Slet</button>
              </article>
            ))}
            {data.identities.length === 0 && <p className="empty">Ingen ekstra identiteter.</p>}
          </section>
          <section>
            <h3>Forsvindinger</h3>
            {data.disappearances.map((row) => (
              <article className="continuity-card" key={row.id}>
                <h3>{row.entityName}</h3>
                <p><span className="chip alert">forsvinder</span> {row.disappearsEvent}</p>
                <p><span className="chip story">tilbage</span> {row.returnsEvent ?? 'ikke endnu'}</p>
                {row.note && edit('disappearance', row.id, 'note', row.note, true)}
                <button className="btn" onClick={() => void remove('disappearance', row.id, `${row.entityName}s forsvinding`)}>Slet</button>
              </article>
            ))}
            {data.disappearances.length === 0 && <p className="empty">Ingen forsvindinger registreret.</p>}
          </section>
        </div>
      )}

      {data && tab === 'threads' && (
        <div className="continuity-grid">
          {data.threads.map((line) => (
            <article className="continuity-card thread-card" key={line.id}>
              <h3>{line.name}</h3>
              <div className="dim">{edit('thread', line.id, 'summary', line.summary, true)}</div>
              <div className="beat-line">
                {line.beats.map((item) => (
                  <div className={`beat ${item.kind}`} key={item.id}>
                    <span className="chip quiet">{BEAT_DA[item.kind] ?? item.kind}</span>
                    <strong>{item.summary ?? '(uden beskrivelse)'}</strong>
                    {item.sceneName && <small>{item.sceneName}</small>}
                    <button className="icon-delete" aria-label="Slet plotslaget"
                      onClick={() => void remove('beat', item.id, 'plotslaget')}>×</button>
                  </div>
                ))}
              </div>
              <button className="btn" onClick={() => void remove('thread', line.id, `plottråden «${line.name}»`)}>Slet tråd</button>
            </article>
          ))}
          {data.threads.length === 0 && <p className="empty">Ingen plottråde endnu.</p>}
        </div>
      )}

      {data && tab === 'sources' && (
        <>
          <p className="lede small">
            Kilden gemmes og vises — den bliver aldrig læst maskinelt. Hylden er sorteret efter de
            to spørgsmål, den er til for: hvad har du markeret som en mulig modstrid, og hvad blev
            gemt og aldrig knyttet til noget.
          </p>
          <div className="continuity-grid">
            {data.sources.map((item) => (
              <article className="continuity-card source-card" key={item.id}>
                <span className="chip quiet">{item.kind}</span>
                {item.conflicts > 0 && <span className="chip alert">mulig modstrid</span>}
                {item.unused && <span className="chip disc">bakker ikke noget op</span>}
                <h3>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</h3>
                {item.filePath && <p className="mono dim">{item.filePath}</p>}
                <div>{edit('source', item.id, 'note', item.note, true)}</div>
                <h4>Henviser til</h4>
                {item.backs.map((link) => (
                  <div className={`source-link ${link.relation}`} key={link.id}>
                    <span className="chip quiet">{RELATION_DA[link.relation] ?? link.relation}</span>
                    {/* Et manglende navn betyder, at rækken er slettet, siden
                        henvisningen blev lavet. Det skal stå, ikke skjules. */}
                    <strong>{link.label ?? 'peger på noget, der er slettet'}</strong>
                    {link.note && <span>{link.note}</span>}
                    <button className="icon-delete" aria-label="Slet kildehenvisningen"
                      onClick={() => void remove('source_link', link.id, 'kildehenvisningen')}>×</button>
                  </div>
                ))}
                {item.unused && (
                  <p className="dim small">
                    Ikke knyttet til noget endnu. Sig til Claude, hvad den understøtter,
                    giver kontekst til eller muligvis modsiger.
                  </p>
                )}
                <button className="btn" onClick={() => void remove('source', item.id, `kilden «${item.title}»`)}>Slet kilde</button>
              </article>
            ))}
            {data.sources.length === 0 && <p className="empty">Ingen researchkilder endnu.</p>}
          </div>
        </>
      )}
    </div>
  );
}
