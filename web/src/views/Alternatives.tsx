import { useEffect, useMemo, useState } from 'react';
import { call } from '../client';
import { useQuery } from '../store';
import type { Notice } from '../main';

const differenceName: Record<string, string> = {
  chapter_moved: 'Kapitel flyttet',
  scene_moved: 'Scene flyttet',
  scene_added: 'Scene tilføjet',
  scene_removed: 'Scene fjernet',
  scene_changed: 'Scene ændret',
  reveal_moved: 'Afsløring flyttet',
  reveal_changed: 'Afsløring ændret',
  reveal_added: 'Afsløring tilføjet',
  reveal_removed: 'Afsløring fjernet',
};

const strengthName: Record<string, string> = {
  hinted: 'vink', implied: 'antydet', stated: 'fortalt', confirmed: 'bekræftet',
};

export function Alternatives({
  nonce, notify, onChanged,
}: { nonce: number; notify: (n: Notice) => void; onChanged: () => void }) {
  const { data, loading, reload } = useQuery('branch.workspace', undefined, [nonce]);
  const [name, setName] = useState('');
  const [compareId, setCompareId] = useState('');

  const others = useMemo(() => data?.branches.filter((item) => item.id !== data.activeBranchId) ?? [], [data]);
  useEffect(() => {
    if (!others.some((item) => item.id === compareId)) setCompareId(others[0]?.id ?? '');
  }, [others, compareId]);

  const act = async (fn: () => Promise<string>) => {
    try {
      notify({ text: await fn() });
      reload();
      onChanged();
    } catch (error) {
      notify({ text: error instanceof Error ? error.message : String(error), bad: true });
    }
  };

  if (loading && !data) return <div className="page"><p className="empty">Henter alternativer …</p></div>;
  if (!data) return null;
  const active = data.branches.find((item) => item.id === data.activeBranchId)!;

  return (
    <div className="page alternatives-page">
      <div className="page-head">
        <div>
          <h2>Alternativer</h2>
          <p className="lede">
            Prøv en anden læserækkefølge uden at ændre originalen. Hver gren har sin egen prosa,
            sine egne scener og afsløringer; verdens fakta og kronologi er fælles.
          </p>
        </div>
        <div className="branch-create">
          <input
            aria-label="Navn på ny gren" placeholder="Fx Afsløringen tidligere"
            value={name} onChange={(event) => setName(event.target.value)}
          />
          <button className="btn primary" disabled={!name.trim()} onClick={() => act(async () => {
            const created = await call('branch.create', { name: name.trim() });
            setName('');
            return `«${name.trim()}» er oprettet fra nu. ${created.copiedRows} fortællerækker blev kopieret.`;
          })}>Ny gren fra nu</button>
        </div>
      </div>

      <div className="branch-current banner">
        <div>
          <span className="eyebrow">Du arbejder her</span>
          <h3>{active.name}</h3>
          <p>
            {active.parentName
              ? `Forgrenet fra ${active.parentName} ved trin ${active.forkChangeSeq}.`
              : 'Historiens oprindelige spor.'}
          </p>
        </div>
        {active.isDefault
          ? <span className="chip story">hovedspor</span>
          : <button className="btn" onClick={() => act(async () => {
            await call('branch.choose', { branchId: active.id });
            return `«${active.name}» er nu hovedsporet. De andre er bevaret.`;
          })}>Gør til hovedspor</button>}
      </div>

      <h3 className="section">Alle spor</h3>
      <div className="branch-list">
        {data.branches.map((item) => (
          <div key={item.id} className={`branch-card${item.archivedAt ? ' archived' : ''}`}>
            <div>
              <strong>{item.name}</strong>
              <div className="small">
                {item.parentName
                  ? `fra ${item.parentName} · trin ${item.forkChangeSeq}`
                  : 'oprindeligt spor'}
              </div>
            </div>
            <div className="branch-badges">
              {item.id === data.activeBranchId && <span className="chip disc">valgt</span>}
              {item.isDefault && <span className="chip story">hovedspor</span>}
              {item.archivedAt && <span className="chip quiet">arkiveret</span>}
            </div>
            <div className="branch-actions">
              {item.id !== data.activeBranchId && !item.archivedAt && (
                <button className="btn" onClick={() => act(async () => {
                  await call('context.set', { worldId: active.worldId, branchId: item.id });
                  return `Skiftet til «${item.name}».`;
                })}>Arbejd her</button>
              )}
              {item.id !== data.activeBranchId && !item.isDefault && !item.archivedAt && (
                <button className="btn" onClick={() => act(async () => {
                  await call('branch.archive', { branchId: item.id });
                  return `«${item.name}» er lagt i arkivet.`;
                })}>Arkivér</button>
              )}
              {item.archivedAt && (
                <button className="btn" onClick={() => act(async () => {
                  await call('branch.reopen', { branchId: item.id });
                  return `«${item.name}» er genåbnet.`;
                })}>Genåbn</button>
              )}
            </div>
          </div>
        ))}
      </div>

      <h3 className="section">Rækkefølgen på «{active.name}»</h3>
      <p className="small branch-help">
        Pilene flytter kun fortællingen på denne gren. Eventets plads på tidslinjen ændres ikke.
      </p>
      <div className="order-editor">
        {data.outline.chapters.map((chapter, chapterIndex) => (
          <section className="order-chapter" key={chapter.id}>
            <header>
              <span className="order-number">{chapterIndex + 1}</span>
              <h3>{chapter.title}</h3>
              <div>
                <button className="btn arrow" aria-label={`Flyt ${chapter.title} op`}
                  disabled={chapterIndex === 0} onClick={() => act(async () => {
                    await call('branch.chapter.move', { chapterId: chapter.id, toIndex: chapterIndex - 1 });
                    return `«${chapter.title}» er flyttet op.`;
                  })}>↑</button>
                <button className="btn arrow" aria-label={`Flyt ${chapter.title} ned`}
                  disabled={chapterIndex === data.outline.chapters.length - 1} onClick={() => act(async () => {
                    await call('branch.chapter.move', { chapterId: chapter.id, toIndex: chapterIndex + 1 });
                    return `«${chapter.title}» er flyttet ned.`;
                  })}>↓</button>
              </div>
            </header>
            <ol>
              {chapter.scenes.map((scene, sceneIndex) => (
                <li key={scene.id}>
                  <span className="scene-order">{scene.globalPosition}</span>
                  <div>
                    <strong>{scene.title}</strong>
                    <span className="small">{scene.wordCount} ord · {scene.revealCount} afsløringer</span>
                  </div>
                  <div className="scene-move">
                    <button className="btn arrow" aria-label={`Flyt ${scene.title} op`}
                      disabled={sceneIndex === 0} onClick={() => act(async () => {
                        await call('branch.scene.move', {
                          sceneId: scene.id, targetChapterId: chapter.id, toIndex: sceneIndex - 1,
                        });
                        return `«${scene.title}» er flyttet op.`;
                      })}>↑</button>
                    <button className="btn arrow" aria-label={`Flyt ${scene.title} ned`}
                      disabled={sceneIndex === chapter.scenes.length - 1} onClick={() => act(async () => {
                        await call('branch.scene.move', {
                          sceneId: scene.id, targetChapterId: chapter.id, toIndex: sceneIndex + 1,
                        });
                        return `«${scene.title}» er flyttet ned.`;
                      })}>↓</button>
                    <select aria-label={`Flyt ${scene.title} til kapitel`}
                      value={chapter.id} onChange={(event) => act(async () => {
                        const target = data.outline.chapters.find((item) => item.id === event.target.value)!;
                        await call('branch.scene.move', {
                          sceneId: scene.id, targetChapterId: target.id, toIndex: target.scenes.length,
                        });
                        return `«${scene.title}» er flyttet til «${target.title}».`;
                      })}>
                      {data.outline.chapters.map((item) => (
                        <option key={item.id} value={item.id}>{item.title}</option>
                      ))}
                    </select>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      <h3 className="section">Afsløringer på denne gren</h3>
      <div className="reveal-editor">
        {data.outline.reveals.length === 0 && <p className="empty">Der er ingen registrerede afsløringer.</p>}
        {data.outline.reveals.map((item) => (
          <div className="reveal-row" key={item.id}>
            <div>
              <strong>{item.factSummary}</strong>
              <span className="small">læseren får det i «{item.sceneTitle}»</span>
            </div>
            <select aria-label={`Styrke for ${item.factSummary}`} value={item.strength}
              onChange={(event) => act(async () => {
                await call('branch.reveal.move', {
                  revealId: item.id, sceneId: item.sceneId,
                  strength: event.target.value as 'hinted' | 'implied' | 'stated' | 'confirmed',
                });
                return `Afsløringen af «${item.factSummary}» er nu ${strengthName[event.target.value]}.`;
              })}>
              {Object.entries(strengthName).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select aria-label={`Scene for ${item.factSummary}`} value={item.sceneId}
              onChange={(event) => act(async () => {
                const target = data.outline.scenes.find((scene) => scene.id === event.target.value)!;
                await call('branch.reveal.move', { revealId: item.id, sceneId: target.id });
                return `Afsløringen af «${item.factSummary}» er flyttet til «${target.title}».`;
              })}>
              {data.outline.chapters.flatMap((chapter) => chapter.scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>{chapter.position}. {scene.title}</option>
              )))}
            </select>
          </div>
        ))}
      </div>

      {others.length > 0 && (
        <>
          <div className="compare-head">
            <div>
              <h3 className="section">Sammenlign</h3>
              <p className="small">Se præcis hvad der flyttede sig; ingen af grenene ændres.</p>
            </div>
            <select aria-label="Gren at sammenligne med" value={compareId}
              onChange={(event) => setCompareId(event.target.value)}>
              {others.map((item) => <option key={item.id} value={item.id}>{item.name}{item.archivedAt ? ' (arkiveret)' : ''}</option>)}
            </select>
          </div>
          {compareId && <Comparison branchId={compareId} nonce={nonce} />}
        </>
      )}
    </div>
  );
}

function Comparison({ branchId, nonce }: { branchId: string; nonce: number }) {
  const { data, loading, error } = useQuery('branch.compare', { otherBranchId: branchId }, [nonce, branchId]);
  if (loading && !data) return <p className="empty">Sammenligner …</p>;
  if (error) return <div className="banner bad"><p>{error}</p></div>;
  if (!data) return null;
  return (
    <div className="branch-comparison">
      <div className="comparison-summary">
        <strong>{data.left.branch.name}</strong>
        <span>{data.left.scenes.length} scener · {data.left.reveals.length} afsløringer</span>
        <span className="comparison-arrow">mod</span>
        <strong>{data.right.branch.name}</strong>
        <span>{data.right.scenes.length} scener · {data.right.reveals.length} afsløringer</span>
      </div>
      {data.differences.length === 0 ? (
        <div className="banner"><p>De to grene er stadig ens.</p></div>
      ) : (
        <div className="difference-list">
          {data.differences.map((item, index) => (
            <div className="difference" key={`${item.kind}-${item.label}-${index}`}>
              <span className="chip quiet">{differenceName[item.kind] ?? item.kind}</span>
              <strong>{item.label}</strong>
              <span>{item.left ?? '—'}</span>
              <span className="difference-arrow">→</span>
              <span>{item.right ?? '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
