# Fortsættelsesplan

Den oprindelige plan blev gennemført som fase 0–8. Denne plan fortsætter den
samme nummerering og er aftalt med forfatteren. Fase 9–16 afslutter den
personlige appvision; fase 17 holder de bevidst udskudte døre åbne.

## Regler for alle faser

- Engelsk indeni, dansk udenpå.
- UI og MCP bruger de samme domænetjenester.
- Alle brugerændringer går gennem ændringsloggen og kan fortrydes.
- Prosa skrives aldrig uden forfatterens ja, hver gang. Et tekstforslag skrives
  kun ind ved et synligt klik i editoren; skriver Claude direkte gennem MCP,
  spørger værktøjet forfatteren selv og skriver kun ved et ja.
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

**Status: færdig, med én bevidst undtagelse.** Implementeret og browserprøvet
30. august 2026.

- ~~Gennemgå scene, kapitel, bog eller serie.~~
- ~~En gennemgang husker hvilken tekstversion den gælder og bliver markeret som
  forældet, når scenen ændres.~~
- ~~Find personer, steder, genstande og events, der kun findes i prosaen.~~
- ~~Foreslå kobling til en eksisterende post eller oprettelse af en ny.~~
- ~~Sammenlign omtaler med POV-viden, identitet, navnekendskab, love og
  kronologi.~~
- ~~Forslag lander i margenen og ændrer aldrig prosa uden forfatterens klik.~~

**Undtagelsen: tilstedeværelse, besiddelse og genstandstilstand.** De kan ikke
udledes af en omtale. «Han tænkte på Valdemar» nævner Valdemar og placerer ham
ingen steder, så en regel, der læste et mærke som «var i rummet», ville melde
den mest almindelige sætning i bogen. Skal prosaen kunne bære den påstand, skal
et anker kunne sige *hvordan* passagen bruger sit mål — vist i rummet eller blot
nævnt, sådan som `scene_event.mode` allerede gør for events. Det er en
modelændring, og den ligger i fase 15.

## Fase 11 — Serien som én fortælling

**Status: færdig.** Implementeret og browserprøvet 31. august 2026.

- ~~Plottråde kan høre til en bog, serie eller verden.~~
- ~~Setup i ét bind kan få payoff i et senere bind.~~
- ~~Orden regnes som serie → bog → kapitel → scene.~~
- ~~Grebet medregner forberedelse og læservarviden fra tidligere bind.~~
- ~~En serieoversigt viser gennemgående personer, plottråde, afsløringer og
  uløste setups uden at blande andre serier i samme verden ind.~~

`thread.work_id` blev stående og betyder nu den bog, tråden **begynder** i;
rækkevidden er en ny kolonne. Tabellen kunne ikke bygges om: SQLite slipper ikke
NOT NULL uden at genskabe tabellen, og en genskabelse fejler ved commit, fordi
`beat`s fremmednøgle tæller de implicitte sletninger med og aldrig tæller dem
tilbage. Prøvet mod en kopi af den rigtige database, ikke gættet.

## Fase 12 — Holdbare kildevedhæftninger

**Status: færdig.** Implementeret og browserprøvet 31. august 2026.

- ~~PDF'er, billeder og andre filer kopieres ind i et administreret projektarkiv.~~
- ~~Originalt navn, MIME-type, størrelse og kontrolsum gemmes.~~
- ~~Filer kan vises eller åbnes sikkert, men aldrig OCR-behandles, udtrækkes eller
  fortolkes af programmet.~~
- ~~Manglende og beskadigede filer opdages.~~
- ~~Sletning af en henvisning og fjernelse af selve filen er to handlinger.~~

Arkivet ligger ved siden af databasen — `fabula.db` giver `fabula-filer/` — så de
to følges ad, når projektet flyttes. Selve bytene ligger uden for ændringsloggen:
rækken går gennem loggen som alt andet, men fortryd henter henvisningen tilbage
og rører aldrig filen. Det er den sikre retning; en fil, forfatteren har lagt
ind, er ikke programmets at smide væk. Den billige prøve — ligger filen der, og
har den stadig sin størrelse — er en regel, der kører hver gang. Den grundige,
som læser hver fil tilbage og sammenligner kontrolsummen, bliver bedt om.

## Fase 13 — Eksport, backup og genoprettelse

**Status: færdig.** Implementeret og browserprøvet 5. september 2026.

- ~~Eksportér bog eller serie som Markdown og DOCX.~~
- ~~Arbejds-id'er og skjulte ankermærker er ikke med i læseudgaven.~~
- ~~Et valgfrit appendiks kan indeholde personer, steder, tidslinje og kilder.~~
- ~~Eksportér en versionsmærket JSON-backup og en samlet ZIP med vedhæftninger.~~
- ~~Vis en forhåndsoversigt før genoprettelse, og prøv et komplet roundtrip i en
  tom database.~~

Markdown og DOCX er to gengivelser af den samme neutrale model, bygget én gang
af scenens egen ProseMirror-JSON. Bygges de hver for sig, begynder de før eller
siden at være uenige om, hvad bogen er. Læseudgaven går ét sted igennem —
`fromProse`, der beholder ordene og taber mærkerne — så «ingen apparat» kan
prøves frem for at huskes. Editorens Markdown lå før i `web/` og kunne ikke
importeres af eksporten; den er flyttet til `src/core/export/prose.ts`, og
begge flader kalder nu den samme.

ZIP og DOCX er skrevet i hånden. En afhængighed i vejen for hver eneste fil, der
forlader programmet, er den dyrere side af hundrede linjer, der ikke har ændret
sig siden 1993.

Genoprettelsen er den femte dokumenterede undtagelse fra «kun ændringsloggen
skriver» — den genopretter loggen, så den kan ikke gå gennem den. Det, der gør
undtagelsen sikker, er et afslag og ikke et løfte: den bliver stoppet, før den
rører noget, hvis databasen holder arbejde, eller hvis backuppen er lavet på en
anden skemaudgave. Afslaget ligger i kernen, ikke i fladerne.

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
- Et anker kan sige, hvordan passagen bruger sit mål: vist i rummet eller blot
  nævnt. Først da kan tilstedeværelse, besiddelse og genstandstilstand prøves
  mod prosaen — se undtagelsen i fase 10.

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
