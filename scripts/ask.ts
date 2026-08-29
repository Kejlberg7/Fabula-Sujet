/**
 * Talks to the running server from the command line, one tool call at a time.
 *
 *   npm run ask -- ./fabula.db hvem_vidste_hvad '{"person":"Leonard"}'
 *
 * There is no interface in phase 0, so this is how you look at what is in
 * there without opening a database browser.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [dbPath, toolName, rawArgs] = process.argv.slice(2);
if (!dbPath || !toolName) {
  console.error('Brug: npm run ask -- <database> <værktøj> [json-argumenter]');
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: 'node',
  args: ['--import', 'tsx', 'src/mcp/server.ts'],
  env: { ...process.env, FS_DATABASE_URL: dbPath } as Record<string, string>,
});
const client = new Client({ name: 'ask', version: '1.0.0' });
await client.connect(transport);

const result = await client.callTool({
  name: toolName,
  arguments: rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {},
}) as { content: { text: string }[]; isError?: boolean };

console.log(result.content.map((c) => c.text).join('\n'));
await client.close();
process.exit(result.isError ? 1 : 0);
