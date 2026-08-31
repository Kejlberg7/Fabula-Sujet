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
import { branchTools } from './tools/branches';
import { dramaturgyTools } from './tools/dramaturgy';

export const allTools: ToolDef[] = [
  ...worldTools,
  ...entityTools,
  ...eventTools,
  ...knowledgeTools,
  ...narrativeTools,
  ...historyTools,
  ...branchTools,
  ...queryTools,
  ...reviewTools,
  ...dramaturgyTools,
];

const INSTRUCTIONS = `
Fabula & Sujet holder styr på, hvornår ting SKETE og hvornår de FORTÆLLES, og på hvem der vidste
hvad hvornår. Alt hvad du skriver, går gennem en ændringslog og kan fortrydes, så arbejd frit —
opret, ret, flet og slet uden at spørge om lov. Bliver noget forkert, siger forfatteren det bare.

Nogle vaner, der gør modellen brugbar frem for larmende:

• Sæt en verden og en bog først (opret_verden / saet_aktivt_vaerk). Så behøver ingen nævne bogen igen.
• Giv events et SPÆND, ikke et tidspunkt, og bind dem sammen med tidsbånd. Opfind aldrig en dato,
  forfatteren ikke har besluttet — det er hele pointen med modellen.
• Brug arbejdsreferencer som P1, G4 og E12, når forfatteren gør det. vis_referencer slår dem op,
  og de almindelige værktøjer accepterer koden direkte. Gæt aldrig hvad en kode peger på.
• Fakta har pladser. Delvis viden er en ubunden plads, ikke et nyt faktum.
• Hvis en persons oplevelser glemmes efter en fast tid, så sig det én gang med registrer_hukommelse.
  Det ændrer ikke ældre minder, udtrykkelige overbevisninger eller noget, personen bærer på skrift.
• Skeln skarpt mellem hvornår en PERSON får noget at vide (registrer_overbevisning) og hvornår
  LÆSEREN gør (opret_afsloering). Afstanden mellem dem er hele fortællegrebet.
• Når forfatteren vil prøve en anden rækkefølge, brug opret_gren før flyt_scene eller
  flyt_afsloering. Sammenlign bagefter; en gren flettes aldrig skjult ind i en anden.
• vurder_afsloeringer svarer på, om et greb er noget værd — ikke om det er muligt. Giv aldrig
  aflæsningen som et tal; videregiv aksen og de scener, den kommer af. Er to rækkefølger på tale,
  så læg dem på hver sin gren og brug sammenlign_afsloeringer frem for at gætte.
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
  må aldrig ændre sceneteksten.
• gem_scenetekst spørger forfatteren selv, hver eneste gang, og skriver kun ved et ja. Spørg derfor
  også i samtalen først, og vis teksten frem, før du kalder værktøjet — prompten skal bekræfte en
  beslutning, forfatteren allerede har truffet, ikke være første gang de hører om den.
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
    // the history screen says so. That is the safety net for the model: there
    // is no approval prompt in front of it, so what happened has to be easy to
    // see afterwards, and the change log can take it back.
    actor: { kind: 'assistant' },

    /**
     * Prose is the one thing that gets a real question first.
     *
     * The question goes out over MCP's own elicitation, so it lands in the
     * writer's client and is answered by the writer -- not by the model that
     * wants to write. A client that cannot ask gets told so plainly; the tool
     * then refuses, because «ask first» with no way to ask is just writing.
     */
    askWriter: async (request) => {
      if (!server.server.getClientCapabilities()?.elicitation) return 'kan_ikke_spoerge';
      const answer = await server.server.elicitInput({
        message: `${request.question}\n\n${request.detail}`,
        requestedSchema: {
          type: 'object',
          properties: {
            svar: {
              type: 'string', enum: ['ja', 'nej'],
              title: 'Må jeg skrive det ind?',
              description: 'Svar ja, hvis teksten må gemmes som scenens prosa.',
            },
          },
          required: ['svar'],
        },
      });
      // Anything but a plain yes is a no. A cancelled prompt is not consent.
      return answer.action === 'accept' && answer.content?.['svar'] === 'ja' ? 'ja' : 'nej';
    },
  };

  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (args: never) => {
        try {
          return { content: [{ type: 'text' as const, text: await tool.run(args, tools) }] };
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
