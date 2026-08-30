# Arbejdsstatus

Sidst opdateret: 30. august 2026

## Aktiv fase

**Fase 10 — Prosaen kontrolleres mod bibelen.** I gang. Første snit — den
versionsbundne gennemlæsning — er implementeret, prøvet og browserprøvet.

Fase 0–9 er færdige. Den aftalte videre plan ligger i `docs/ROADMAP.md`.

## Færdigt i fase 10 indtil nu

- `review_run` og `review_scene` findes, migration 0008 er skrevet og prøvet mod
  en kopi af den rigtige database. Journalens tidsstempel blev sat til
  1790000004000: migratoren springer alt over, der er ældre end det sidst kørte,
  så en genereret nutidsdato ville have gjort migrationen usynlig.
- En gennemlæsning åbnes på scene, kapitel, bog eller serie og skriver ned,
  hvilken `scene_text`-version hver scene stod i. Serien læses bind for bind i
  læserækkefølge.
- `suggestion` har `run_id` og `text_id`. Stemplet læses ved oprettelsen, ikke
  af den, der kalder: en note handler om det, der står i scenen, når den skrives.
- `suggestionsFor` giver `stale`. Mærket er en oplysning, ikke en lås — prosa
  gemmes, mens man skriver, så en lås ville lukke hele margenen.
- MCP: `start_gennemlaesning`, `afslut_gennemlaesning`, `vis_gennemlaesninger`.
  `tilfoej_margennote` tager `gennemlaesning_id`. `vis_scene_til_gennemgang`
  viser versionen, og både den og `vis_margennoter` skriver, når en note er
  skrevet til en tidligere version.
- API: `review.scope`, `review.runs`, `review.start`, `review.finish`.
- UI: Gennemgangen har en Gennemlæsninger-sektion, og margennoter får mærket
  «tidligere version». Der er med vilje ingen knap til at starte en læsning —
  det er Claude, der læser.
- Havnen har en afsluttet gennemlæsning af første bind med margennoten hængt på
  sig. Den ligger efter omtalerne i indlæsningen, ellers ville prøvecasen blive
  født forældet.

## Færdigt i fase 9

- Roadmap og denne overdragelsesfil er oprettet.
- `CLAUDE.md` kræver, at begge læses før nyt arbejde.
- Tabellen `story_reference` og migration 0007 findes. Eksisterende grene får
  samme kode for samme ophav, og nye mål indekseres i deres egen ændringslogtur.
- Koderne dækker P/S/G/O/B, identiteter, events, fakta, afsløringer, scener og
  plottråde.
- Omdøbning bevarer koden; sletning efterlader den synligt brudt; fortryd
  reparerer både mål og kode.
- MCP kan slå koder op i de almindelige værktøjer og har `vis_referencer` samt
  `vis_omtaler`.
- Skrivebordet henter nu alle referencetyper. `@` åbner en filtreret menu, og
  eksisterende markering-med-vælger viser kode og navn.
- Person-, sted-, ting- og eventkort viser arbejdsreference og backlinks.
- Browserforløbet er prøvet på en isoleret Havnen-database: `@G1` bliver til
  «Ingeborgs brev», omtalen åbner genstandskortet, og backlinket vender tilbage
  til den præcise fremhævede passage.
- Memento, Predestination og Inception har nu synlige prøveankre til henholdsvis
  en genstand, en identitet og et sted. Havnen har både sit ældre eventanker og
  en interaktivt oprettet reference i browserprøven.
- Browserprøven fandt og rettede to fejl: ProseMirror slugte Enter før Reacts
  forslagshåndtering, og nyligt oprettede ankre beholdt en forældet
  navigationscallback. Backlinkets fremhævelse venter nu også på, at editorens
  dokument faktisk er monteret.

## Efterslæt til fase 9 — omtalerne i prøvecasene

Fase 9 blev prøvet på en isoleret database, og prøvecasene fik aldrig en eneste
omtale med. Åbnede man appen, var feltet tomt: funktionen fandtes, men der var
intet at se og intet at klikke på.

- `src/fixtures/mentions.ts` sætter omtalerne i en tur for sig efter
  indlæsningen. Det er nødvendigt: en kode uddeles først, når turen, der
  skabte målet, lukker, så under indlæsningen findes den ikke endnu.
- Samme gennemløb stempler koden på de ankre, indlæsningen allerede havde lavet.
  Dermed er den åbne risiko om «ældre mærker uden kode» væk i prøvecasene.
- Femten omtaler fordelt på alle fire prøvecases, med person, sted og genstand
  repræsenteret. Havnen har `@G1` «Ingeborgs brev» og `@S1` «Fyret».
- Vægtprøven har fået en prøve mere pr. bog: prosaen skal pege tilbage på
  bibelen med mindst én kode, og hver kode skal findes på grenen. Det er den
  prøve, der manglede, da fase 9 blev afsluttet.
- Browserprøvet på den rigtige `fabula.db`: `@G1` viser «G1 · Ingeborgs brev ·
  Genstande», valget bliver til en omtale i prosaen, og backlinket fra
  genstandskortet fører til «Han spørger sin mor» i Tidevandet.

## I gang nu

- Ingen halv implementering står åben. Næste konkrete arbejde er andet snit af
  fase 10 nedenfor.

## Beslutninger

- En gennemlæsning er bundet til den version, den læste. Uden det kan en gammel
  læsning ikke skelnes fra en aktuel.
- «Forældet» er en oplysning, ikke en spærring. Prosa gemmes, mens man skriver.
- Interfacet starter ikke en gennemlæsning. Det er Claude, der læser prosaen.
- En referencekode er et arbejdsredskab, ikke en del af bogens ordlyd.
- Omdøbning af et mål må ikke omskrive prosa.
- En slettet reference skal stå som brudt; den må ikke forsvinde tavst.
- Eksisterende ProseMirror-mærker videreføres frem for tegnpositioner.

## Verificering

- 212/212 prøver er grønne.
- Typecheck og produktionsbuild er rene. Vite gentager den kendte advarsel om
  en JavaScript-chunk over 500 kB; det er ikke en buildfejl.
- Migration 0007 er prøvet mod en kopi af den eksisterende database. Prøven
  fandt og rettede migrationsjournalens fremskudte tidsstempler.
- Browserprøvet på en kopi af den rigtige database: en rettelse i «Vandet står
  ind» giver margennoten mærket «tidligere version», og Gennemgangen skifter fra
  «ingen af scenerne er skrevet om siden» til «1 af scenerne».
- Browserprøven er grøn. Forslagmenuens placering er også kontrolleret visuelt
  i den smalle trekolonnevisning.

## Næste konkrete handling

Fase 10, andet snit: find det, der kun står i prosaen. En scenes tekst
sammenholdes med de omtaler, den bærer — er der navngivet en person, et sted
eller en genstand, som ingen omtale peger på, skal gennemlæsningen kunne
foreslå enten en kobling til en eksisterende post eller en ny post. Forslaget
lander i margenen som alt andet, og MCP får stadig ingen vej til at skrive prosa.

Derefter tredje snit: sammenhold de knyttede omtaler med tilstedeværelse,
besiddelse, genstandstilstand, POV-viden, identitet, navnekendskab, love og
kronologi.

## Åbne risici

- Prøvecasene indlæses altid i en tom database. Der er ingen vej til at hente
  nye eksempler ind i en database, man selv har arbejdet i, uden at få
  verdenerne dobbelt. Det var præcis den fælde, efterslættet ovenfor faldt i.
- Ældre ProseMirror-mærker uden kode kan stadig findes i en database, der er
  ældre end omtale-turen. Det er bagudkompatibelt: `text_anchor` leverer målet
  i sidepanelet, og ankret kan fortsat åbnes derfra.
- Identiteter åbner ejerens personkort, mens afsløringer åbner
  alternativvisningen. Egne detailkort til de to typer hører til fase 16.
