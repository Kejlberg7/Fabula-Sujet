import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { openStore } from '../db/client';
import { readAttachment } from '../core/attachments';
import { Workbench } from '../core/workbench';
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

  /**
   * The one GET that hands over bytes.
   *
   * A stored file is shown, never read, and this route is the whole «shown»
   * part. It answers with exactly what was filed and takes three precautions,
   * because the file came from outside and the interface's own origin is on
   * the other side of it:
   *
   * - the type comes from the name it was filed under, never from sniffing the
   *   bytes, and `nosniff` holds the browser to it;
   * - anything not on the inline list is handed over as a download, so an SVG
   *   or an HTML page cannot run as a document on this origin;
   * - the content policy allows the file nothing but itself -- no script, no
   *   network, no frame.
   *
   * The policy deliberately stops short of `sandbox`. It was in here first,
   * and it turned every PDF into a forced download: the browser will not put a
   * sandboxed document in front of its viewer. A file that can only be
   * downloaded is not «vist», so the directive that costs us the whole point
   * is the one that goes. What is left still gives the file nothing to work
   * with -- the inline list holds no format that can run code in the first
   * place, and anything that can is handed over as a download.
   */
  app.get('/api/fil/:sourceId', (c) => {
    try {
      const file = readAttachment(store, new Workbench(store).context(), c.req.param('sourceId'));
      const name = encodeURIComponent(file.originalName);
      // Kopieres til et rent ArrayBuffer: Node's Buffer kan ligge i delt
      // hukommelse, og webstandardens svartype tager kun den ene slags.
      const body = new Uint8Array(file.bytes);
      return c.body(body, 200, {
        'content-type': file.mimeType,
        'content-length': String(body.byteLength),
        'content-disposition':
          `${file.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
        'x-content-type-options': 'nosniff',
        'content-security-policy':
          "default-src 'none'; img-src 'self'; object-src 'none'; "
          + "base-uri 'none'; form-action 'none'",
        'cache-control': 'no-store',
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 404);
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
