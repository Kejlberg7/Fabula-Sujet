import { useRef, useState, type FormEvent } from 'react';
import { call } from '../client';
import { formatSpan, SOURCE_KIND_DA } from '../format';
import { useQuery } from '../store';
import type { Notice } from '../main';
import { Editable } from './Editable';
import { ReferenceLinks } from './ReferenceLinks';

type Tab = 'objects' | 'relationships' | 'travel' | 'identities' | 'threads' | 'sources';

const RELATION_DA: Record<string, string> = {
  supports: 'understøtter', context: 'kontekst', conflicts: 'mulig modstrid',
};
const BEAT_DA: Record<string, string> = {
  setup: 'setup', complication: 'komplikation', payoff: 'payoff',
};
/** Filens tilstand, som hylden kan se den uden at læse den. */
const FILE_DA: Record<string, { text: string; chip: string }> = {
  ok: { text: 'fil i arkivet', chip: 'quiet' },
  mangler: { text: 'filen mangler', chip: 'alert' },
  beskadiget: { text: 'filen er en anden', chip: 'alert' },
  intet_arkiv: { text: 'intet arkiv', chip: 'disc' },
};

/** Størrelser skrives, som man siger dem, ikke i bytes med ti cifre. */
function size(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Kun vist, når tråden når længere end den bog, den begynder i. */
const SCOPE_DA: Record<string, string> = {
  series: 'hele serien', world: 'hele verden',
};

/**
 * Kildens fil: læg ind, åbn, slip.
 *
 * At slippe henvisningen og at slette filen er to knapper med hver sin
 * bekræftelse. Den første kan fortrydes; den anden kan ikke, og det står der.
 */
function Attachment({
  item, onSaved, onError,
}: {
  item: { id: string; filePath: string | null; originalName: string | null;
    byteSize: number | null; mimeType: string | null; fileState: string | null };
  onSaved: (text: string) => void;
  onError: (text: string) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const attach = async (file: File) => {
    setBusy(true);
    try {
      // Filen læses her for at kunne sendes, ikke for at forstås. Base64 i
      // samme JSON-krop som alt andet -- se `source.attach` på serveren.
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const filed = await call('source.attach', {
        sourceId: item.id, name: file.name, base64: btoa(binary),
      });
      onSaved(`«${filed.originalName}» ligger nu i arkivet.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const detach = async (removeFile: boolean) => {
    const question = removeFile
      ? 'Slet selve filen fra arkivet? Det kan ikke fortrydes.'
      : 'Slip kildens henvisning til filen? Filen bliver liggende, og Fortryd henter henvisningen tilbage.';
    if (!window.confirm(question)) return;
    try {
      const done = await call('source.detach', { sourceId: item.id, removeFile });
      onSaved(done.fileRemoved ? 'Filen er slettet fra arkivet.' : 'Henvisningen er sluppet. Filen ligger der endnu.');
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  if (!item.filePath) {
    return (
      <p className="attachment">
        <input type="file" ref={picker} hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void attach(f); }} />
        <button className="btn small" disabled={busy} onClick={() => picker.current?.click()}>
          {busy ? 'Lægger ind …' : 'Vedhæft fil'}
        </button>
        <span className="dim small">Filen kopieres ind i arkivet ved siden af databasen. Den bliver ikke læst.</span>
      </p>
    );
  }

  const state = FILE_DA[item.fileState ?? 'ok'] ?? FILE_DA['ok']!;
  return (
    <div className="attachment">
      <span className={`chip ${state.chip}`}>{state.text}</span>
      <a href={`/api/fil/${item.id}`} target="_blank" rel="noreferrer">
        {item.originalName ?? item.filePath}
      </a>
      <span className="dim small">{[item.mimeType, size(item.byteSize)].filter(Boolean).join(' · ')}</span>
      <button className="btn small" onClick={() => void detach(false)}>Slip filen</button>
      <button className="btn small" onClick={() => void detach(true)}>Slet filen</button>
    </div>
  );
}

export function Continuity({
  nonce, notify, onChanged,
}: { nonce: number; notify: (n: Notice) => void; onChanged: () => void }) {
  const [own, setOwn] = useState(0);
  const [tab, setTab] = useState<Tab>('objects');
  const { data, loading } = useQuery('continuity.get', undefined, [nonce, own]);
  const { data: entities } = useQuery('list.entities', {}, [nonce, own]);
  const { data: works } = useQuery('context.get', undefined, [nonce, own]);

  const saved = (text: string) => {
    notify({ text });
    setOwn((n) => n + 1);
    onChanged();
  };
  const failed = (text: string) => notify({ text, bad: true });
  const remove = async (table: string, id: string, label: string) => {
    try {
      const preview = await call('row.delete.preview', { table, id });
      const warning = preview.dependencies.length
        ? `\n\nDette bruger posten stadig:\n${preview.dependencies.map((item) => `• ${item.kind}: ${item.label}`).join('\n')}\n\nSlet de afhængige poster først.`
        : '';
      if (preview.dependencies.length) {
        failed(`Kan ikke slette endnu. ${preview.dependencies.length} afhængige ${preview.dependencies.length === 1 ? 'post' : 'poster'} er vist i bekræftelsen.`);
        window.alert(`${label} har afhængigheder:${warning}`);
        return;
      }
      if (!window.confirm(`Slet ${label}? Du kan hente det tilbage med Fortryd.${warning}`)) return;
      await call('row.delete', { table, id });
      saved('Slettet. Fortryd henter det tilbage.');
    } catch (error) {
      failed(error instanceof Error ? error.message : String(error));
    }
  };
  /**
   * Den grundige prøve, som ingen skal betale for uden at bede om den:
   * hver fil læses tilbage og hashes. Hylden viser i forvejen det billige svar.
   */
  const checkFiles = async () => {
    try {
      const report = await call('source.check');
      const bad = report.files.filter((row) => row.state !== 'ok');
      const parts = [
        report.files.length === 0
          ? 'Ingen kilder har en fil vedhæftet.'
          : `${report.files.length} filer prøvet, ${report.files.length - bad.length} uændrede.`,
        ...bad.map((row) => `${row.title}: ${row.note}`),
        report.orphans.length > 0
          ? `${report.orphans.length} fil(er) i arkivet peger ingen kilde på.`
          : '',
      ].filter(Boolean);
      notify({ text: parts.join(' '), bad: bad.length > 0 });
      setOwn((n) => n + 1);
    } catch (error) {
      failed(error instanceof Error ? error.message : String(error));
    }
  };

  const edit = (table: string, id: string, field: string, value: string | null, multiline = false) => (
    <Editable table={table} id={id} field={field} value={value} multiline={multiline}
      onSaved={saved} onError={failed} />
  );
  const create = (route: string, summary: string, toInput: (form: FormData) => object) =>
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      try {
        await call(route as never, toInput(form) as never);
        formElement.reset();
        saved(summary);
      } catch (error) { failed(error instanceof Error ? error.message : String(error)); }
    };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'objects', label: 'Genstande', count: data?.objects.length },
    { id: 'relationships', label: 'Relationer', count: data?.relationships.length },
    { id: 'travel', label: 'Steder og rejser', count: (data?.presences.length ?? 0) + (data?.placeLinks.length ?? 0) },
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

      <details className="creation-drawer">
        <summary>Opret oplysninger i historien</summary>
        <div className="creation-grid">
          <form className="creation-card" onSubmit={create('continuity.relationship.create', 'Relationen er oprettet.', (f) => ({
            fromEntityId: String(f.get('from')), toEntityId: String(f.get('to')), kind: String(f.get('kind')),
            category: String(f.get('category') ?? '') || undefined, symmetric: f.get('symmetric') === 'on',
            note: String(f.get('note') ?? '') || undefined,
          }))}>
            <h3>Relation</h3>
            <label>Fra<select name="from" required>{entities?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
            <label>Til<select name="to" required>{entities?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
            <label>Relationen<input name="kind" required placeholder="stoler på" /></label>
            <label>Kategori<input name="category" placeholder="familie, konflikt …" /></label>
            <label className="check-label"><input type="checkbox" name="symmetric" /> Gensidig</label>
            <button className="btn primary">Opret relation</button>
          </form>

          <form className="creation-card" onSubmit={create('continuity.state.create', 'Tilstanden er oprettet.', (f) => ({
            entityId: String(f.get('entity')), category: String(f.get('category')), value: String(f.get('value')),
            note: String(f.get('note') ?? '') || undefined,
          }))}>
            <h3>Tilstand for en ting</h3>
            <label>Ting<select name="entity" required>{entities?.filter((e) => e.kind === 'object').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
            <label>Aspekt<input name="category" required placeholder="fx stand" /></label>
            <label>Værdi<input name="value" required placeholder="revnet" /></label>
            <label>Note<input name="note" /></label>
            <button className="btn primary">Registrer tilstand</button>
          </form>

          <form className="creation-card" onSubmit={create('possession.create', 'Besiddelsen er registreret.', (f) => ({
            holderEntityId: String(f.get('holder')), objectEntityId: String(f.get('object')),
            note: String(f.get('note') ?? '') || undefined,
          }))}>
            <h3>Hvem har genstanden?</h3>
            <label>Person<select name="holder" required>{entities?.filter((e) => e.kind === 'person').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
            <label>Genstand<select name="object" required>{entities?.filter((e) => e.kind === 'object').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
            <label>Note<input name="note" /></label>
            <button className="btn primary">Registrer besiddelse</button>
          </form>

          <form className="creation-card" onSubmit={create('presence.create', 'Tilstedeværelsen er registreret.', (f) => ({
            entityId: String(f.get('person')), placeId: String(f.get('place')), realmId: String(f.get('realm')),
            fromTime: String(f.get('from') ?? '') ? Math.floor(new Date(String(f.get('from'))).getTime() / 1000) : undefined,
            toTime: String(f.get('to') ?? '') ? Math.floor(new Date(String(f.get('to'))).getTime() / 1000) : undefined,
            note: String(f.get('note') ?? '') || undefined,
          }))}>
            <h3>Hvor er personen?</h3>
            <label>Person<select name="person" required>{entities?.filter((e) => e.kind === 'person').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
            <label>Sted<select name="place" required>{entities?.filter((e) => e.kind === 'place').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
            <label>Fortællingslag<select name="realm" required>{works?.realms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            <label>Fra tidspunkt<input name="from" type="datetime-local" /></label>
            <label>Til tidspunkt<input name="to" type="datetime-local" /></label>
            <button className="btn primary">Registrer ophold</button>
          </form>

          <form className="creation-card" onSubmit={create('place-link.create', 'Rejseforbindelsen er oprettet.', (f) => ({
            realmId: String(f.get('realm')), fromPlaceId: String(f.get('from')), toPlaceId: String(f.get('to')),
            mode: String(f.get('mode')), travelMin: Number(f.get('min') || 0) * 86400,
            travelMax: Number(f.get('max') || 0) * 86400,
            bidirectional: f.get('both') === 'on',
          }))}>
            <h3>Rejsetid mellem steder</h3>
            <label>Fra<select name="from" required>{entities?.filter((e) => e.kind === 'place').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
            <label>Til<select name="to" required>{entities?.filter((e) => e.kind === 'place').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
            <label>Fortællingslag<select name="realm" required>{works?.realms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            <label>Transport<input name="mode" required placeholder="til fods, bil, portal …" /></label>
            <label>Mindst (dage)<input name="min" type="number" min="0" step="any" /></label>
            <label>Højst (dage)<input name="max" type="number" min="0" step="any" /></label>
            <label className="check-label"><input type="checkbox" name="both" defaultChecked /> Gælder begge veje</label>
            <button className="btn primary">Opret rejseforbindelse</button>
          </form>

          <form className="creation-card" onSubmit={create('identity.create', 'Identiteten er oprettet.', (f) => ({
            entityId: String(f.get('entity')), name: String(f.get('name')), note: String(f.get('note') ?? '') || undefined,
          }))}>
            <h3>Et navn eller en identitet</h3>
            <label>Person eller entitet<select name="entity" required>{entities?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
            <label>Navn/skikkelse<input name="name" required /></label>
            <label>Note<input name="note" /></label>
            <button className="btn primary">Opret identitet</button>
          </form>

          <form className="creation-card" onSubmit={create('continuity.thread.create', 'Plottråden er oprettet.', (f) => ({
            name: String(f.get('name')), summary: String(f.get('summary') ?? '') || undefined,
            scope: String(f.get('scope') ?? 'work'),
          }))}>
            <h3>Ny plottråd</h3>
            <label>Navn<input name="name" required /></label>
            <label>Hvad lover fortællingen?<input name="summary" /></label>
            <label>Rækkevidde<select name="scope"><option value="work">Denne bog</option><option value="series">Hele serien</option><option value="world">Hele verden</option></select></label>
            <button className="btn primary">Opret plottråd</button>
          </form>

          <div className="creation-card">
            <h3>Næste: plotslag</h3>
            <p className="dim small">Vælg først en eksisterende plottråd nedenfor; dens kort får formularen til setup, komplikation og payoff.</p>
            <span className="dim small">Aktiv bog: {works?.active?.workTitle ?? 'ingen valgt'}</span>
          </div>
        </div>
      </details>

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

      {data && tab === 'travel' && (
        <div className="continuity-columns">
          <section>
            <h3>Ophold</h3>
            {data.presences.map((row) => <article className="continuity-card" key={row.id}>
              <strong>{row.personName}</strong> · {row.placeName}
              <p className="dim small">{row.realmName} · {row.when}</p>
              {row.note && <p>{row.note}</p>}
              <button className="btn small" onClick={() => void remove('presence', row.id, `${row.personName}s ophold i ${row.placeName}`)}>Slet</button>
            </article>)}
            {data.presences.length === 0 && <p className="empty">Ingen ophold registreret endnu.</p>}
          </section>
          <section>
            <h3>Rejsetid</h3>
            {data.placeLinks.map((row) => <article className="continuity-card" key={row.id}>
              <strong>{row.fromName}</strong> → <strong>{row.toName}</strong>
              <p>{row.mode} · {row.realmName}{row.bidirectional ? ' · begge veje' : ''}</p>
              <p className="dim small">{row.travelMin == null && row.travelMax == null ? 'Rejsetid ikke angivet' : `${row.travelMin == null ? '?' : formatSpan(row.travelMin)}–${row.travelMax == null ? '?' : formatSpan(row.travelMax)}`}</p>
              {row.note && <p>{row.note}</p>}
              <button className="btn small" onClick={() => void remove('place_link', row.id, `forbindelsen mellem ${row.fromName} og ${row.toName}`)}>Slet</button>
            </article>)}
            {data.placeLinks.length === 0 && <p className="empty">Ingen rejseforbindelser registreret endnu.</p>}
          </section>
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
              <h3>{line.name} {line.scope !== 'work'
                && <span className="chip quiet">{SCOPE_DA[line.scope] ?? line.scope}</span>}</h3>
              <div className="dim">{edit('thread', line.id, 'summary', line.summary, true)}</div>
              <div className="beat-line">
                {line.beats.map((item) => (
                  <div className={`beat ${item.kind}`} key={item.id}>
                    <span className="chip quiet">{BEAT_DA[item.kind] ?? item.kind}</span>
                    <strong>{item.summary ?? '(uden beskrivelse)'}</strong>
                    {item.sceneName && (
                      <small>
                        {item.sceneName}
                        {line.scope !== 'work' && item.workTitle && ` · ${item.workTitle}`}
                      </small>
                    )}
                    <button className="icon-delete" aria-label="Slet plotslaget"
                      onClick={() => void remove('beat', item.id, 'plotslaget')}>×</button>
                  </div>
                ))}
              </div>
              <form className="beat-create" onSubmit={create('continuity.beat.create', 'Plotslaget er oprettet.', (f) => ({
                threadId: line.id, kind: String(f.get('kind')), summary: String(f.get('summary') ?? '') || undefined,
              }))}>
                <select name="kind" aria-label="Plotslagstype"><option value="setup">Setup</option><option value="complication">Komplikation</option><option value="payoff">Payoff</option></select>
                <input name="summary" aria-label="Beskrivelse af plotslaget" placeholder="Hvad sker der?" required />
                <button className="btn small">Tilføj plotslag</button>
              </form>
              <ReferenceLinks targetKind="thread" targetId={line.id} nonce={nonce} />
              <button className="btn" onClick={() => void remove('thread', line.id, `plottråden «${line.name}»`)}>Slet tråd</button>
            </article>
          ))}
          {data.threads.length === 0 && <p className="empty">Ingen plottråde endnu.</p>}
        </div>
      )}

      {data && tab === 'sources' && (
        <>
          <form className="creation-card creation-inline" onSubmit={create('source.create', 'Kilden er oprettet.', (f) => ({
            title: String(f.get('title')), kind: String(f.get('kind')),
            url: String(f.get('url') ?? '') || undefined,
            note: String(f.get('note') ?? '') || undefined,
          }))}>
            <h3>Ny researchkilde</h3>
            <label>Titel<input name="title" required /></label>
            <label>Slags<select name="kind"><option value="note">Note</option><option value="link">Link</option><option value="article">Artikel</option><option value="pdf">PDF</option><option value="image">Billede</option><option value="file">Fil</option></select></label>
            <label>Link, hvis relevant<input name="url" type="url" /></label>
            <label>Note<input name="note" /></label>
            <button className="btn primary">Opret kilde</button>
          </form>
          <p className="lede small">
            Kilden gemmes og vises — den bliver aldrig læst maskinelt. Hylden er sorteret efter de
            to spørgsmål, den er til for: hvad har du markeret som en mulig modstrid, og hvad blev
            gemt og aldrig knyttet til noget.
          </p>
          <p className="attachment">
            <button className="btn small" onClick={() => void checkFiles()}>Tjek filerne</button>
            <span className="dim small">
              Læser hver vedhæftet fil tilbage og sammenligner bytes med det, der blev lagt ind.
            </span>
          </p>
          <div className="continuity-grid">
            {data.sources.map((item) => (
              <article className="continuity-card source-card" key={item.id}>
                <span className="chip quiet">{SOURCE_KIND_DA[item.kind] ?? item.kind}</span>
                {item.conflicts > 0 && <span className="chip alert">mulig modstrid</span>}
                {item.unused && <span className="chip disc">bakker ikke noget op</span>}
                <h3>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</h3>
                <Attachment item={item} onSaved={saved} onError={failed} />
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
