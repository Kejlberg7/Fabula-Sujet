import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { openStore } from '../db/client';
import { createApi, type Api } from './api';

/**
 * One POST endpoint per route, and the built interface behind it.
 *
 * Local, single user, no auth: every scrap of complexity saved here is
 * complexity that can go into the model instead.
 */
export function createHttpApp(databaseUrl: string) {
  const store = openStore(databaseUrl);
  const api = createApi(store) as Record<string, (input: unknown) => unknown>;
  const app = new Hono();

  app.post('/api/:route', async (c) => {
    const route = c.req.param('route');
    const handler = api[route];
    if (!handler) return c.json({ error: `Ukendt kald: ${route}` }, 404);
    try {
      const body = c.req.header('content-length') === '0' ? undefined : await c.req.json().catch(() => undefined);
      return c.json({ data: handler(body) ?? null });
    } catch (error) {
      // A failed call is an answer, not a crash -- the interface shows the
      // sentence, the same way the MCP surface does.
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  // Resolved from this file, not from wherever the process happens to be
  // started: a launcher may run it from another directory entirely.
  const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));
  const indexPath = join(webRoot, 'index.html');
  if (existsSync(indexPath)) {
    // The bundles are content-hashed and may be cached forever. The document
    // that points at them must never be, or a rebuild leaves you looking at
    // yesterday's interface and wondering why nothing changed. Setting the
    // header after serveStatic does not work -- it has already built its own
    // response -- so the document is served by hand.
    const page = () => readFileSync(indexPath, 'utf8');
    app.get('/', (c) => c.html(page(), 200, { 'cache-control': 'no-store' }));
    app.use('/assets/*', serveStatic({ root: webRoot }));
    app.get('*', (c) => c.html(page(), 200, { 'cache-control': 'no-store' }));
  }

  return { app, store };
}

export type { Api };

const invokedDirectly = process.argv[1]?.endsWith('http.ts') || process.argv[1]?.endsWith('http.js');
if (invokedDirectly) {
  const port = Number(process.env['FS_PORT'] ?? 4173);
  const { app } = createHttpApp(
    process.env['FS_DATABASE_URL'] ?? fileURLToPath(new URL('../../fabula.db', import.meta.url)),
  );
  serve({ fetch: app.fetch, port }, (info) => {
    process.stdout.write(`Fabula & Sujet kører på http://localhost:${info.port}\n`);
  });
}
