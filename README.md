# Fabula & Sujet

Et arbejdsværktøj til at holde en flerbindshistorie sammen — og til at skrive
den. Bygget på den ene skelnen alt andet hviler på: hvornår tingene **skete**,
og hvornår de **fortælles**.

Designdokumentet ligger som artefakt og er den fulde begrundelse for
beslutningerne nedenfor. Det her er, hvad der er bygget.

## Status

**Fase 0 — skemaet.** Datamodellen står. Domænekernen, tidsløseren og
MCP-serveren er ikke skrevet endnu.

## Hvad der ligger fast

- **To tidsakser.** Kronologien og fortællerordenen holdes adskilt; broen mellem
  dem er `scene_event`, `reveal` og `text_anchor`.
- **Uskarp tid.** Events har intervaller og bånd, ikke tidsstempler. Tid gemmes
  altid i et navngivet tidssystem, og et tidssystem hænger på et lag — dét er
  krogen til opdigtede kalendere og relativistisk tid senere.
- **Personlig tid.** Viden hører til et *ben* af et liv, ikke til personen.
- **Lag.** Drømme, simulationer, indlejrede fortællinger og sidetidslinjer er
  det samme begreb, med eget tidsforhold til laget over.
- **Fakta med pladser.** Delvis viden, voksende viden, falsk tro og delvise
  afsløringer falder alle ud af den ene beslutning.
- **Love.** De indbyggede regler spørger lovlaget, *før* de rapporterer noget.
- **Ændringsloggen.** Hver skrivning er en hændelse med en modsat, grupperet per
  samtaletur, med bruger-id og gren-id fra dag ét.
- **Bibelen er data, prosaen er din.** Claude arbejder frit i modellen.
  Manuskriptet røres aldrig uden et ja.

## Sprog

Engelsk indeni, dansk udenpå. `docs/ORDBOG.md` er den eneste sandhed om
oversættelsen — tilføj dér, før du bruger et nyt ord.

## Kom i gang

```bash
npm install
npm run db:generate
npm run typecheck
```

## Layout

```
src/db/schema/
  _shared.ts    delte kolonner: id, story-tid, gren
  world.ts      verden, tidssystem, lag, serie, stedgraf
  entities.ts   entitet, identitet, ben, tilstedeværelse, besiddelse, relation
  events.ts     event, deltagelse, tidsbånd
  knowledge.ts  faktum, plads, binding, overbevisning, udsagn, vidensbærer
  laws.ts       lov, kilde, kildehenvisning
  narrative.ts  gren, værk, kapitel, scene, prosa, broen
  history.ts    bruger, tur, ændring, nedslag
  findings.ts   fund, afvisning, forslag
docs/ORDBOG.md  dansk ↔ engelsk, regelkoder, MCP-flade
```

## Næste skridt

1. Domænekernen: tidsløseren og vidensudledningen.
2. Ændringsloggen som det eneste, der skriver.
3. MCP-serveren oven på kernen.
4. Fixturerne ind: *Memento*, *Predestination*, *Inception*.
