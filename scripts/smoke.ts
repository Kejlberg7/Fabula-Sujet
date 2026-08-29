/**
 * Starts the real server as its own process and talks to it over stdio, the way
 * a client actually will. The in-memory tests prove the logic; this proves the
 * thing starts, speaks the protocol and answers.
 */
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const dbPath = join(tmpdir(), `fabula-smoke-${Date.now()}.db`);

const transport = new StdioClientTransport({
  command: 'node',
  args: ['--import', 'tsx', 'src/mcp/server.ts'],
  env: { ...process.env, FS_DATABASE_URL: dbPath } as Record<string, string>,
});

const client = new Client({ name: 'smoke', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`Serveren svarer. ${tools.length} værktøjer.\n`);

const say = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args }) as
    { content: { text: string }[]; isError?: boolean };
  const text = result.content.map((c) => c.text).join('\n');
  console.log(`→ ${name}\n${text}\n`);
  if (result.isError) throw new Error(`${name} fejlede`);
  return text;
};

await say('opret_verden', { navn: 'Røgtåge' });
await say('opret_vaerk', { titel: 'Den sidste vagt' });
await say('opret_entitet', { navn: 'Ida', slags: 'person' });
await say('opret_entitet', { navn: 'Fyrtårnet', slags: 'place' });
await say('opret_event', { titel: 'Stormen', tidligst: '1911-11', varighed: '2 dage' });
await say('opret_event', { titel: 'Lyset slukkes' });
await say('tilfoej_tidsbaand', {
  fra_event: 'Stormen', til_event: 'Lyset slukkes', slags: 'offset', forskydning: '1 dag',
});
await say('tilfoej_deltager', { event: 'Lyset slukkes', person: 'Ida', rolle: 'witness' });
await say('koer_tidsloesning');
await say('hent_kontekst');
await say('historik', { antal: 4 });

await client.close();
rmSync(dbPath, { force: true });
rmSync(`${dbPath}-wal`, { force: true });
rmSync(`${dbPath}-shm`, { force: true });
console.log('Rigtig proces, rigtig stdio, rigtige svar.');
