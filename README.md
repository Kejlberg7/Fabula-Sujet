# Fabula & Sujet

Et arbejdsværktøj til at holde en flerbindshistorie sammen — og til at skrive
den. Bygget på den ene skelnen alt andet hviler på: hvornår tingene **skete**,
og hvornår de **fortælles**.

## Status

**Fase 0 er færdig.** Datamodellen, tidsløseren, ændringsloggen og MCP-serveren
står, og de tre prøvecases er lagt ind. Der er ingen grafisk brugerflade — det
er fase 1 — men alt kan bruges gennem samtale allerede nu.

```bash
npm install
npm test                              # 53 prøver
npm run fixtures -- ./fabula.db       # læg Memento, Predestination og Inception ind
npm run ask -- ./fabula.db hent_kontekst
```

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
src/fixtures/      de tre prøvecases
docs/ORDBOG.md     dansk ↔ engelsk, regelkoder, MCP-flade
```

## Næste skridt

**Fase 1: se det.** Værkvælgeren, historikskærmen med rul-tilbage, lister over
personer, events, steder, fakta og love, og én kronologi-tidslinje med baner.
