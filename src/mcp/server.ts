import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openStore, type Store } from '../db/client';
import { Workbench } from '../core/workbench';
import type { ToolDef, Tools } from './kit';
import { worldTools } from './tools/world';
import { entityTools } from './tools/entities';
import { eventTools } from './tools/events';
import { knowledgeTools } from './tools/knowledge';
import { narrativeTools } from './tools/narrative';
import { historyTools } from './tools/history';
import { queryTools } from './tools/queries';
import { reviewTools } from './tools/review';

export const allTools: ToolDef[] = [
  ...worldTools,
  ...entityTools,
  ...eventTools,
  ...knowledgeTools,
  ...narrativeTools,
  ...historyTools,
  ...queryTools,
  ...reviewTools,
];

const INSTRUCTIONS = `
Fabula & Sujet holder styr på, hvornår ting SKETE og hvornår de FORTÆLLES, og på hvem der vidste
hvad hvornår. Alt hvad du skriver, går gennem en ændringslog og kan fortrydes, så arbejd frit —
opret, ret, flet og slet uden at spørge om lov. Bliver noget forkert, siger forfatteren det bare.

Nogle vaner, der gør modellen brugbar frem for larmende:

• Sæt en verden og en bog først (opret_verden / saet_aktivt_vaerk). Så behøver ingen nævne bogen igen.
• Giv events et SPÆND, ikke et tidspunkt, og bind dem sammen med tidsbånd. Opfind aldrig en dato,
  forfatteren ikke har besluttet — det er hele pointen med modellen.
• Fakta har pladser. Delvis viden er en ubunden plads, ikke et nyt faktum.
• Hvis en persons oplevelser glemmes efter en fast tid, så sig det én gang med registrer_hukommelse.
  Det ændrer ikke ældre minder, udtrykkelige overbevisninger eller noget, personen bærer på skrift.
• Skeln skarpt mellem hvornår en PERSON får noget at vide (registrer_overbevisning) og hvornår
  LÆSEREN gør (opret_afsloering). Afstanden mellem dem er hele fortællegrebet.
• Brug registrer_tilstand til værdier, der udelukker hinanden inden for en kategori, og sæt kategori
  på relationer, når deres tilstande skal kontrolleres. Registrer setups og payoffs på en plottråd.
• Kilder gemmes og vises kun. Læs aldrig en fil på programmets vegne; markér blot den relation,
  forfatteren selv angiver som støtte, kontekst eller mulig modstrid.
• Var nogen til stede uden at opdage noget, så brug rollen present_unaware eller opfatter=false.
• Kør koer_tidsloesning, når du har sat bånd, og fortæl hvad den fandt.
• Kør koer_gennemgang, når du har lagt en større bid ind, og fortæl hvad den fandt. Den melder kun
  det, der ikke kan arrangeres anderledes — er noget bare uskarpt, er det ikke en fejl.
• Før du vurderer en scene, brug vis_scene_til_gennemgang. Den samler POV, viden, love, kildemetadata
  og prosa. Skriv vurderingen med tilfoej_margennote. En margennote — også en markeret som fulgt —
  må aldrig ændre sceneteksten. Gem kun ny prosa, når forfatteren udtrykkeligt har sagt ja til den.
• Er et fund forkert, fordi verdenen er sådan, så skriv en LOV (opret_lov, evne, med regelkoden)
  frem for at afvise fundet. Afvis kun det enkelte tilfælde, der er en undtagelse i sig selv.
`.trim();

export function createServer(store: Store): McpServer {
  const server = new McpServer(
    { name: 'fabula-sujet', version: '0.1.0' },
    { instructions: INSTRUCTIONS },
  );

  const tools: Tools = {
    store,
    bench: new Workbench(store),
    // Everything arriving over MCP is Claude acting on the writer's behalf, and
    // the history screen says so. That is the whole safety net: there is no
    // approval prompt, so what happened has to be easy to see afterwards.
    actor: { kind: 'assistant' },
  };

  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((args: never) => {
        try {
          return { content: [{ type: 'text' as const, text: tool.run(args, tools) }] };
        } catch (error) {
          // A failed call is an answer, not a crash: say what went wrong in
          // words the writer can act on, and let the conversation continue.
          const message = error instanceof Error ? error.message : String(error);
          return { content: [{ type: 'text' as const, text: message }], isError: true };
        }
      }) as never,
    );
  }

  return server;
}

export async function main(): Promise<void> {
  // Absolute by default: a client may start this from any directory, and a
  // database quietly created somewhere else is a very confusing kind of empty.
  const store = openStore(
    process.env['FS_DATABASE_URL'] ?? fileURLToPath(new URL('../../fabula.db', import.meta.url)),
  );
  const server = createServer(store);
  await server.connect(new StdioServerTransport());
}

const invokedDirectly = process.argv[1]?.endsWith('server.ts')
  || process.argv[1]?.endsWith('server.js');
if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`Fabula & Sujet kunne ikke starte: ${String(error)}\n`);
    process.exit(1);
  });
}
