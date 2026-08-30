import { useQuery } from '../store';

export function ReferenceLinks({
  targetKind, targetId, nonce,
}: { targetKind: string; targetId: string; nonce: number }) {
  const { data: references } = useQuery('reference.list', undefined, [nonce]);
  const { data: backlinks } = useQuery(
    'reference.backlinks', { targetKind, targetId }, [nonce, targetKind, targetId],
  );
  const codes = references?.filter((item) =>
    item.targetKind === targetKind && item.targetId === targetId) ?? [];

  return (
    <>
      {codes.length > 0 && (
        <div className="reference-heading">
          {codes.map((item) => <span className="reference-code" key={item.id}>{item.code}</span>)}
        </div>
      )}
      <h4>Omtalt i prosaen</h4>
      {backlinks?.length ? (
        <ul className="backlinks">
          {backlinks.map((item) => (
            <li key={item.anchorId}>
              <a href={`#${item.href}`}>{item.chapterTitle} · {item.sceneTitle}</a>
              <div className="dim small">{item.workTitle}</div>
              {item.excerpt && <div className="excerpt">«{item.excerpt}»</div>}
            </li>
          ))}
        </ul>
      ) : <p className="dim small">Ikke omtalt med et tekstanker endnu.</p>}
    </>
  );
}
