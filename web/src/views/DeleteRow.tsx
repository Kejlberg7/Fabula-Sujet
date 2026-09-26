import { useState } from 'react';
import { call } from '../client';

/** Preview named dependants before a reversible row deletion. */
export function DeleteRow({
  table, id, label, onDeleted, onError,
}: {
  table: string; id: string; label: string;
  onDeleted: () => void; onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return <button className="btn small" disabled={busy} onClick={async () => {
    setBusy(true);
    try {
      const preview = await call('row.delete.preview', { table, id });
      if (preview.dependencies.length) {
        const items = preview.dependencies.map((item) => `• ${item.kind}: ${item.label}`).join('\n');
        window.alert(`«${label}» bruges stadig her:\n\n${items}\n\nFjern afhængighederne først.`);
        return;
      }
      if (!window.confirm(`Slet «${label}»? Handlingen kan fortrydes fra historikken.`)) return;
      await call('row.delete', { table, id });
      onDeleted();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }}>{busy ? 'Tjekker …' : 'Slet'}</button>;
}
