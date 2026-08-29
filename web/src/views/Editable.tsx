import { useEffect, useRef, useState } from 'react';
import { call } from '../client';

/**
 * Edit in place, straight into the change log.
 *
 * Nothing is saved until you leave the field, and everything that is saved is
 * one undo away -- so there is no confirm step and no save button. Escape
 * abandons the edit.
 */
export function Editable({
  table, id, field, value, multiline, placeholder, onSaved, onError,
}: {
  table: string;
  id: string;
  field: string;
  value: string | null;
  multiline?: boolean;
  placeholder?: string;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  useEffect(() => setDraft(value ?? ''), [value, id, field]);

  const commit = async () => {
    const next = draft.trim();
    if (next === (value ?? '').trim()) return;
    try {
      await call('row.update', { table, id, patch: { [field]: next || null } });
      onSaved('Gemt. Fortryd henter det gamle tilbage.');
    } catch (error) {
      setDraft(value ?? '');
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const shared = {
    ref: ref as never,
    className: 'editable',
    value: draft,
    placeholder,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') { setDraft(value ?? ''); (e.target as HTMLElement).blur(); }
      if (e.key === 'Enter' && !multiline) (e.target as HTMLElement).blur();
    },
    style: {
      background: 'transparent', width: '100%', resize: 'vertical' as const,
      fontFamily: 'inherit', fontSize: 'inherit',
    },
  };

  return multiline
    ? <textarea {...shared} rows={3} />
    : <input {...shared} />;
}
