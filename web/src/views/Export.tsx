import { useRef, useState } from 'react';
import { call } from '../client';
import { useQuery } from '../store';
import type { Notice } from '../main';
import type { Api } from '../../../src/server/api';

/**
 * Udgivelsen: bogen ud, det hele ud, og vejen tilbage.
 *
 * Bytes kommer base64 i det almindelige JSON-svar og bliver til en fil her i
 * browseren -- ingen nedhentningsrute på serveren, ingen midlertidig fil, der
 * bliver liggende. Det er den samme vej som en vedhæftning, bare den anden vej.
 */

const APPENDIX = [
  { id: 'people' as const, label: 'Personer' },
  { id: 'places' as const, label: 'Steder' },
  { id: 'timeline' as const, label: 'Tidslinje' },
  { id: 'sources' as const, label: 'Kilder' },
];

type AppendixPart = (typeof APPENDIX)[number]['id'];

/** Lægger filen i browserens hænder og rydder op efter sig. */
function download(name: string, mimeType: string, base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function Export({
  nonce, notify,
}: { nonce: number; notify: (n: Notice) => void }) {
  const { data: context } = useQuery('context.get', undefined, [nonce]);
  const [target, setTarget] = useState('');
  const [format, setFormat] = useState<'markdown' | 'docx'>('markdown');
  const [sceneTitles, setSceneTitles] = useState(false);
  const [gaps, setGaps] = useState(false);
  const [appendix, setAppendix] = useState<AppendixPart[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<Api['backup.inspect']>> | null>(null);
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const works = context?.works ?? [];
  const active = context?.active ?? null;
  const series = [...new Map(works
    .filter((w) => w.seriesId)
    .map((w) => [w.seriesId!, w.seriesName ?? 'Serien'] as const)).entries()];
  const chosen = target || (active?.workId ? `work:${active.workId}` : '');

  const fail = (error: unknown) =>
    notify({ text: error instanceof Error ? error.message : String(error), bad: true });

  const run = async <T,>(work: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    try {
      return await work();
    } catch (error) {
      fail(error);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const exportReading = () => run(async () => {
    const [kind, id] = chosen.split(':');
    const made = await call('export.reading', {
      ...(kind === 'series' ? { seriesId: id } : { workId: id }),
      format, sceneTitles, gaps, appendix,
    });
    download(made.name, made.mimeType, made.base64);
    notify({
      text: `${made.name}: ${made.stats.chapters} kapitler, `
        + `${made.stats.written} af ${made.stats.scenes} scener, ${made.stats.words} ord.`,
    });
  });

  const exportBackup = (withFiles: boolean) => run(async () => {
    const made = await call('export.backup', { withFiles });
    download(made.name, made.mimeType, made.base64);
    notify({
      text: `${made.name}${made.rows ? `: ${made.rows} rækker, ${made.files} filer` : ''}.`
        + (made.missing.length ? ` ${made.missing.length} filer manglede i arkivet.` : ''),
    });
  });

  const inspect = async (picked: File) => {
    const bytes = new Uint8Array(await picked.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const base64 = btoa(binary);
    const view = await run(() => call('backup.inspect', { base64 }));
    if (!view) return;
    setFile({ name: picked.name, base64 });
    setPreview(view);
  };

  const restore = () => run(async () => {
    if (!file) return;
    if (!window.confirm(
      'Hent backuppen ind i den her database? Den lægger sig kun i en tom database, '
      + 'og den kan ikke fortrydes bagefter.',
    )) return;
    const report = await call('backup.restore', { base64: file.base64 });
    notify({
      text: `Hentet ind: ${report.rows} rækker, ${report.files} filer, `
        + `verdener: ${report.worlds.join(', ')}.`,
    });
    setPreview(null);
    setFile(null);
  });

  return (
    <div className="page">
      <h2>Eksport</h2>
      <p className="lede">
        Læseudgaven er forfatterens ord og ingenting andet: arbejds-id&apos;er, ankermærker
        og margennoter kommer ikke med. Backuppen er det modsatte — hver eneste række,
        og arkivets filer med i samme fil.
      </p>

      <div className="export-grid">
        <section className="panel">
          <h3>Læseudgave</h3>

          <label className="export-field" htmlFor="target">Hvad</label>
          <select
            id="target" value={chosen} onChange={(e) => setTarget(e.target.value)}
          >
            {works.map((w) => (
              <option key={w.id} value={`work:${w.id}`}>{w.title}</option>
            ))}
            {series.map(([id, name]) => (
              <option key={id} value={`series:${id}`}>Hele serien: {name}</option>
            ))}
          </select>

          <label className="export-field" htmlFor="format">Format</label>
          <select
            id="format" value={format}
            onChange={(e) => setFormat(e.target.value as 'markdown' | 'docx')}
          >
            <option value="markdown">Markdown (.md)</option>
            <option value="docx">Word (.docx)</option>
          </select>

          <div className="export-field">Appendiks</div>
          <div className="export-checks">
            {APPENDIX.map((part) => (
              <label key={part.id}>
                <input
                  type="checkbox" checked={appendix.includes(part.id)}
                  onChange={(e) => setAppendix((current) => (e.target.checked
                    ? [...current, part.id]
                    : current.filter((one) => one !== part.id)))}
                />
                {part.label}
              </label>
            ))}
          </div>

          <div className="export-checks">
            <label>
              <input
                type="checkbox" checked={sceneTitles}
                onChange={(e) => setSceneTitles(e.target.checked)}
              />
              Tag scenernes arbejdstitler med
            </label>
            <label>
              <input type="checkbox" checked={gaps} onChange={(e) => setGaps(e.target.checked)} />
              Markér scener, der ikke er skrevet
            </label>
          </div>

          <button className="btn primary" disabled={busy || !chosen} onClick={exportReading}>
            Hent læseudgaven
          </button>
        </section>

        <section className="panel">
          <h3>Backup</h3>
          <p className="dim small">
            Hver række i hver tabel, med et stempel for den skemaudgave, den er lavet på.
            ZIP&apos;en har arkivets filer med; JSON&apos;en er kun data.
          </p>
          <div className="export-checks">
            <button className="btn primary" disabled={busy} onClick={() => exportBackup(true)}>
              Hent backup med filer (.zip)
            </button>
            <button className="btn" disabled={busy} onClick={() => exportBackup(false)}>
              Kun data (.json)
            </button>
          </div>

          <h4>Genoprettelse</h4>
          <p className="dim small">
            En genoprettelse lægger sig ikke oven i noget. Den kan kun hentes ind i en tom
            database — start programmet med en ny databasefil, hvis du vil se en backup
            uden at røre den, du arbejder i.
          </p>
          <input
            ref={picker} type="file" accept=".zip,.json" style={{ display: 'none' }}
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = '';
              if (picked) void inspect(picked);
            }}
          />
          <button className="btn" disabled={busy} onClick={() => picker.current?.click()}>
            Vælg en backupfil
          </button>

          {preview && (
            <div className="export-preview">
              <h4>{file?.name}</h4>
              <p className="dim small">
                Lavet {preview.createdAt.slice(0, 16).replace('T', ' ')} · udgave {preview.version}
                {' · '}{preview.rows} rækker · {preview.files.inArchive} filer pakket med
              </p>
              <ul>
                {preview.worlds.map((world) => (
                  <li key={world.name}>
                    <strong>{world.name}</strong>{' — '}
                    {world.works.join(', ') || 'ingen bøger'}
                    {' '}<span className="dim">
                      ({world.scenes} scener, {world.words} ord
                      {world.branches > 1 ? `, ${world.branches} grene` : ''})
                    </span>
                  </li>
                ))}
              </ul>
              {preview.warnings.map((line) => (
                <p key={line} className="chip alert">{line}</p>
              ))}
              <button
                className="btn primary" disabled={busy || !preview.canRestore} onClick={restore}
              >
                {preview.canRestore ? 'Hent den ind' : 'Kan ikke hentes ind her'}
              </button>
            </div>
          )}
        </section>
      </div>

      {works.length === 0 && (
        <p className="empty">Der er ingen bøger i den her gren at eksportere.</p>
      )}
    </div>
  );
}
