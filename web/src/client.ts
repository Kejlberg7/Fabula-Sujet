import type { Api } from '../../src/server/api';

/**
 * The typed bridge to the server.
 *
 * The route names and both ends of every call are checked against the server's
 * own handlers, so a renamed field breaks the build rather than the page.
 */
export async function call<K extends keyof Api>(
  route: K,
  ...[input]: Parameters<Api[K]> extends [infer I] ? [I] : []
): Promise<Awaited<ReturnType<Api[K]>>> {
  const response = await fetch(`/api/${String(route)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input ?? null),
  });
  const payload = await response.json() as { data?: unknown; error?: string };
  if (!response.ok) throw new Error(payload.error ?? 'Noget gik galt.');
  return payload.data as Awaited<ReturnType<Api[K]>>;
}
