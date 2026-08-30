# Fortsættelsesplan

Den oprindelige plan blev gennemført som fase 0–8. Denne plan fortsætter den
samme nummerering og er aftalt med forfatteren. Fase 9–16 afslutter den
personlige appvision; fase 17 holder de bevidst udskudte døre åbne.

## Regler for alle faser

- Engelsk indeni, dansk udenpå.
- UI og MCP bruger de samme domænetjenester.
- Alle brugerændringer går gennem ændringsloggen og kan fortrydes.
- Prosa kan aldrig ændres gennem MCP. Kun et synligt ja i editoren må skrive et
  tekstforslag ind.
- Kilder gemmes og vises, men deres indhold fortolkes aldrig maskinelt.
- Eksisterende databaser migreres uden datatab.
- Prøvecasene udvides, når en funktion kræver realistiske data.
- Typecheck, test, build og browserprøve skal bestå før en fase afsluttes.
- `README.md`, `docs/ORDBOG.md` og `docs/STATUS.md` opdateres før commit og push.

## Fase 9 — Entydige referencer i prosaen

**Status: færdig.** Implementeret og browserprøvet 30. august 2026.

Prosaen og bibelen bindes rigtigt sammen.

- Stabile arbejds-id'er som `P1`, `S1`, `G1`, `E1` og `F1`.
- `@`-autocomplete på arbejds-id eller navn.
- Personer, identiteter, steder, genstande, organisationer, begreber, events,
  fakta, afsløringer, scener og plottråde kan refereres.
- Manuskriptet viser naturlig tekst; arbejds-id og mål ligger i et skjult anker.
- Klik på en omtale åbner målet. Et kort viser alle omtaler tilbage i prosaen.
- Omdøbning omskriver aldrig forfatterens ord, og en slettet reference bliver
  synligt brudt frem for at forsvinde.
- Arbejds-id'er er stabile gennem fortryd, omdøbning og historiegrene.

## Fase 10 — Prosaen kontrolleres mod bibelen

- Gennemgå scene, kapitel, bog eller serie.
- Find personer, steder, genstande og events, der kun findes i prosaen.
- Foreslå kobling til en eksisterende post eller oprettelse af en ny.
- Sammenlign omtaler med tilstedeværelse, besiddelse, genstandstilstand,
  POV-viden, identitet, navnekendskab, love og kronologi.
- En gennemgang husker hvilken tekstversion den gælder og bliver markeret som
  forældet, når scenen ændres.
- Forslag lander i margenen og ændrer aldrig prosa uden forfatterens klik.

## Fase 11 — Serien som én fortælling

- Plottråde kan høre til en bog, serie eller verden.
- Setup i ét bind kan få payoff i et senere bind.
- Orden regnes som serie → bog → kapitel → scene.
- Grebet medregner forberedelse og læservarviden fra tidligere bind.
- En serieoversigt viser gennemgående personer, plottråde, afsløringer og
  uløste setups uden at blande andre serier i samme verden ind.

## Fase 12 — Holdbare kildevedhæftninger

- PDF'er, billeder og andre filer kopieres ind i et administreret projektarkiv.
- Originalt navn, MIME-type, størrelse og kontrolsum gemmes.
- Filer kan vises eller åbnes sikkert, men aldrig OCR-behandles, udtrækkes eller
  fortolkes af programmet.
- Manglende og beskadigede filer opdages.
- Sletning af en henvisning og fjernelse af selve filen er to handlinger.

## Fase 13 — Eksport, backup og genoprettelse

- Eksportér bog eller serie som Markdown og DOCX.
- Arbejds-id'er og skjulte ankermærker er ikke med i læseudgaven.
- Et valgfrit appendiks kan indeholde personer, steder, tidslinje og kilder.
- Eksportér en versionsmærket JSON-backup og en samlet ZIP med vedhæftninger.
- Vis en forhåndsoversigt før genoprettelse, og prøv et komplet roundtrip i en
  tom database.

## Fase 14 — Alternativer uden blinde vinkler

- Sammenlign også events, fakta, personer, love, relationer, plottråde og tid.
- Vis konkrete prosaforskelle.
- Overfør en valgt ændring mellem grene med synlige konflikter.
- Ingen tavs automatisk sammenfletning; hver overførsel er én fortrydelig tur.
- Grebet og gennemgangen kan sammenligne grene på samme grundlag.

## Fase 15 — Hele modellen kan betjenes i UI'et

- Opret, ret og slet alle centrale datatyper uden Claude.
- Dækkende formularer til fakta, love, relationer, identiteter, viden, udsagn,
  besiddelser, tilstande, rejseforbindelser, tidsbånd, deltagere, afsløringer og
  plotbeats.
- Før en sletning vises alle afhængigheder med navne, aldrig interne UUID'er.

## Fase 16 — De sidste overblik og robusthed

- Tid × sted-matrix, relationskort, afsløringstavle og backlinks fra alle kort.
- Bog- og serieoversigt samt navigation fra fund til den konkrete scene.
- Ydelsestest med mindst 2.000 events og et stort manuskript.
- Tastaturnavigation, tilgængelighed, integritetskontrol, migrationsprøver og
  onboarding til en tom verden.
- Dokumentation og MCP-værktøjsliste holdes automatisk synkroniseret.

Når fase 16 er færdig, er den oprindelige personlige appvision færdig.

## Fase 17 — Bevidst senere

- Opdigtede kalendere og dynamisk relativistisk tid.
- Mere avancerede parallelle universer.
- Samtidige brugere, konflikthåndtering, login og rettigheder.
- Offentlig hosting og produktdrift.

Modellen må ikke spænde ben for disse muligheder, men de implementeres ikke som
del af fase 9–16.
