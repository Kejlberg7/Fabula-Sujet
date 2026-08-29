# Fabula & Sujet

Et arbejdsværktøj til at holde en flerbindshistorie sammen — og til at skrive
den. Bygget på den ene skelnen alt andet hviler på: hvornår tingene **skete**,
og hvornår de **fortælles**.

## Status

**Fase 0 og fase 1 er færdige.** Datamodellen, tidsløseren, ændringsloggen og
MCP-serveren står; oven på dem er der nu et interface med værkvælger, lister,
kronologi-tidslinje, kapiteloversigt og historik med tilbagerulning.

```bash
npm install
npm test                              # 55 prøver
npm run fixtures -- ./fabula.db       # læg Memento, Predestination og Inception ind
npm run build && npm run dev          # interfacet på http://localhost:4173
npm run ask -- ./fabula.db hent_kontekst
```

Kræver Node 20 (`.nvmrc`).

## Interfacet

Interfacet og MCP-serveren deler kontekst og database. Skifter Claude bog midt
i en samtale, følger skærmen med af sig selv — og en rettelse fra skærmen
lander i den samme log, som Claude skriver til.

| Skærm | Viser |
|---|---|
| **Forsiden** | Hvor meget der er lagt ind, og hvad der senest skete |
| **Tidslinjen** | Kronologien i baner, med uskarpe events tegnet som det spænd, de kan ligge i |
| **Personer · Steder · Ting** | Listerne, med et panel der viser ben, tilstedeværelse og hvad personen ved |
| **Events** | Hvad der skete, og hvor fast tiden på det er |
| **Fakta · Love** | Påstande med pladser, og hvad der kan lade sig gøre i verdenen |
| **Kapitler** | Bogen i læserækkefølge, med hvert events kronologiske plads ved siden af |
| **Historik** | Hvem ændrede hvad, og rul tilbage til et hvilket som helst punkt |

Redigering sker i panelerne: ret et felt, klik væk, og det er gemt — og ét
fortryd væk. Der er ingen gem-knap, fordi der ikke er noget at fortryde ved.

## Sådan kobler du Claude på

```bash
claude mcp add fabula -- npx -y tsx /Users/kejlberg/Fabula-Sujet/src/mcp/server.ts
```

Sæt `FS_DATABASE_URL` for at pege på en anden database end `./fabula.db`.
Serveren taler dansk: `opret_verden`, `hvem_vidste_hvad`, `fortryd`.

## Hvad der ligger fast

- **To tidsakser.** Kronologien og fortællerordenen holdes adskilt; broen mellem
  dem er `scene_event`, `reveal` og `text_anchor`.
- **Uskarp tid.** Events har intervaller og bånd, ikke tidsstempler. «1985» er et
  helt år, og uskarpheden går hele vejen gennem løseren. Tid gemmes i et
  navngivet tidssystem, som hænger på et lag — dét er krogen til opdigtede
  kalendere og relativistisk tid senere.
- **Personlig tid.** Viden hører til et *ben* af et liv, ikke til personen. Det
  er den kolonne, der holder det unge ben uvidende om, hvad det ældre ved.
- **Lag.** Drømme, simulationer, indlejrede fortællinger og sidetidslinjer er
  det samme begreb, med hvert sit ur og sit eget forhold til laget over.
- **Fakta med pladser.** Delvis viden, voksende viden, falsk tro og delvise
  afsløringer falder alle ud af den ene beslutning.
- **Love.** De indbyggede regler spørger lovlaget, *før* de rapporterer noget.
- **Ændringsloggen.** Hver skrivning er en hændelse med en modsat, grupperet per
  samtaletur, med bruger-id og gren-id fra dag ét.
- **Bibelen er data, prosaen er din.** Claude arbejder frit i modellen.
  Manuskriptet røres aldrig uden et ja.

## Prøvecases

Tre film, hver med sin akse. Kan modellen holde dem, kan den holde det meste.

| | Presser på | Lagt ind |
|---|---|---|
| **Memento** | Fortællerorden mod kronologi; viden der udløber | Farvesporet baglæns, Sammy Jankis-sporet, polaroiden |
| **Predestination** | Personlig tid, selvmøder, flere identiteter | Hovedpersonens verdenslinje: tre ben, tre navne |
| **Inception** | Lag inden i lag med hvert sit ur | Fire lag, deres forhold og ind- og udgange |

## Sprog

Engelsk indeni, dansk udenpå. `docs/ORDBOG.md` er den eneste sandhed om
oversættelsen — tilføj dér, før du bruger et nyt ord.

## Layout

```
src/db/schema/     43 tabeller. Læs index.ts først; den siger i hvilken rækkefølge.
src/core/
  changelog.ts     det eneste, der skriver
  workbench.ts     hvilken verden, bog og gren vi arbejder på
  time/            gregoriansk tid, lagure, og løseren
  services/        skrivning, som UI og MCP begge kalder
  queries/         hvem vidste hvad, hvem var hvor, hvad ved læseren
  solve.ts         løseren kørt på databasen
src/mcp/           45 værktøjer, danske navne
src/server/        API'et interfacet taler med, og HTTP-serveren
src/fixtures/      de tre prøvecases
web/               interfacet: React, egen CSS, ingen komponentbibliotek
docs/ORDBOG.md     dansk ↔ engelsk, regelkoder, MCP-flade
```

## Næste skridt

**Fase 2: skriv i det.** Scene-editoren, tekstankre og skrivebordet med
videnssidepanelet. Personkort med videns-skyder. Båndvisningen mellem de to
akser.
