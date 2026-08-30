# Arbejdsstatus

Sidst opdateret: 30. august 2026

## Aktiv fase

**Fase 9 — Entydige referencer i prosaen.** I gang.

Fase 0–8 er færdige og pushet. Udgangspunktet er commit `12febf6`. Den aftalte
fortsættelsesplan ligger i `docs/ROADMAP.md`.

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

## I gang nu

- Verificér hele skriveforløbet i en rigtig browser: skriv `@G1`, vælg målet,
  gem, åbn kortet, og gå tilbage gennem backlinket til den samme passage.

## Beslutninger

- En referencekode er et arbejdsredskab, ikke en del af bogens ordlyd.
- Omdøbning af et mål må ikke omskrive prosa.
- En slettet reference skal stå som brudt; den må ikke forsvinde tavst.
- Eksisterende ProseMirror-mærker videreføres frem for tegnpositioner.

## Verificering

- 190/190 prøver grønne.
- Typecheck og produktionsbuild er rene. Vite gentager den kendte advarsel om
  en JavaScript-chunk over 500 kB; det er ikke en buildfejl.
- Migration 0007 er prøvet mod en kopi af den eksisterende database. Prøven
  fandt og rettede migrationsjournalens fremskudte tidsstempler.
- Browserprøven mangler endnu.

## Næste konkrete handling

Start appen på en isoleret fixture-database og udfør browserforløbet ovenfor.
Ret den konkrete UX, udvid prøvecasene med synlige ankre, og afslut derefter
dokumentation, commit og push.

## Åbne risici

- Eksisterende ankre har ingen kode i selve ProseMirror-mærket. Rækken i
  `text_anchor` leverer koden ved læsning, men browserprøven skal bekræfte, at
  klik og visning stadig virker.
- `@`-menuens placering er endnu ikke prøvet tæt ved vinduets kanter.
