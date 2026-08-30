# Arbejdsstatus

Sidst opdateret: 30. august 2026

## Aktiv fase

**Fase 10 — Prosaen kontrolleres mod bibelen.** Næste aktive fase; endnu ikke
implementeret. Fase 9 er færdig og verificeret.

Fase 0–9 er færdige. Fase 9 begyndte med plan/status i `424e4bc` og fik sit
første gennemtestede referencecheckpoint i `8ce4e26`. Den aftalte videre plan
ligger i `docs/ROADMAP.md`.

## Færdigt i denne fase

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

## I gang nu

- Ingen halv implementering står åben. Næste konkrete arbejde er første snit af
  fase 10 nedenfor.

## Beslutninger

- En referencekode er et arbejdsredskab, ikke en del af bogens ordlyd.
- Omdøbning af et mål må ikke omskrive prosa.
- En slettet reference skal stå som brudt; den må ikke forsvinde tavst.
- Eksisterende ProseMirror-mærker videreføres frem for tegnpositioner.

## Verificering

- 194/194 prøver er grønne.
- Typecheck og produktionsbuild er rene. Vite gentager den kendte advarsel om
  en JavaScript-chunk over 500 kB; det er ikke en buildfejl.
- Migration 0007 er prøvet mod en kopi af den eksisterende database. Prøven
  fandt og rettede migrationsjournalens fremskudte tidsstempler.
- Browserprøven er grøn. Forslagmenuens placering er også kontrolleret visuelt
  i den smalle trekolonnevisning.

## Næste konkrete handling

Begynd fase 10 med en versionsbundet gennemgangskørsel: en gennemgang skal kende
den konkrete `scene_text`-version, omfatte scene/kapitel/bog/serie og kunne
markere sine margennoter som forældede efter næste prosagemning. Derefter kan
koblingsforslag og kontinuitetstjek bygges ovenpå uden at give MCP en vej til at
skrive prosa.

## Åbne risici

- Ældre ProseMirror-mærker har stadig ingen kode i selve dokumentet. Det er
  bagudkompatibelt: `text_anchor` leverer E8 i sidepanelet, og det ældre anker
  kan fortsat åbnes derfra. Nye ankre gemmer både kode og mål i mærket.
- Identiteter åbner ejerens personkort, mens afsløringer åbner
  alternativvisningen. Egne detailkort til de to typer hører til fase 16.
