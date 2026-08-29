import { useCallback, useEffect, useState } from 'react';
import { call } from './client';
import type { Api } from '../../src/server/api';

/**
 * Reads re-run when `deps` change or when `bump` is called after a write.
 *
 * No cache and no query library: at one writer's scale every call is a
 * millisecond of SQLite, and a stale screen after an edit is a worse problem
 * than a repeated read.
 */
export function useQuery<K extends keyof Api>(
  route: K,
  input: Parameters<Api[K]> extends [infer I] ? I : undefined,
  deps: unknown[] = [],
): {
  data: Awaited<ReturnType<Api[K]>> | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<Awaited<ReturnType<Api[K]>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify(input ?? null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    (call as (r: K, i: unknown) => Promise<Awaited<ReturnType<Api[K]>>>)(route, input)
      .then((value) => { if (live) { setData(value); setError(null); } })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, key, nonce, ...deps]);

  return { data, error, loading, reload: useCallback(() => setNonce((n) => n + 1), []) };
}
