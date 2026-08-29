# Fabula & Sujet

Et arbejdsværktøj til at holde en flerbindshistorie sammen — og til at skrive
den. Bygget på den ene skelnen alt andet hviler på: hvornår tingene **skete**,
og hvornår de **fortælles**.

## Status

**Fase 0 til 3 er færdige.** Datamodellen, tidsløseren, ændringsloggen og
MCP-serveren står; oven på dem et interface med værkvælger, tidslinje, lister og
historik, et skrivebord hvor prosaen bliver til med bibelen åben ved siden af —
og en motor, der siger fra, når noget ikke kan lade sig gøre.

```bash
npm install
npm test                              # 109 prøver
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
| **Båndet** | De to akser mod hinanden, en tråd for hver gang bogen fortæller noget |
| **Skrivebordet** | Manuskriptet, og ved siden af det hvad synsvinklen ved her og hvad læseren ved |
| **Gennemgangen** | Det, der ikke kan lade sig gøre — og det, du har lagt til side, med din grund |
| **Historik** | Hvem ændrede hvad, og rul tilbage til et hvilket som helst punkt |

Redigering sker i panelerne: ret et felt, klik væk, og det er gemt — og ét
fortryd væk. Der er ingen gem-knap, fordi der ikke er noget at fortryde ved.

### Skrivebordet

Manuskriptet står i midten og gemmer sig selv et sekund efter, du holder op med
at skrive. Til højre svarer panelet på de to spørgsmål, der faktisk standser et
udkast: **hvad ved synsvinklen lige her**, og **hvad ved læseren nu**. Afstanden
mellem dem er den dramatiske ironi. Får læseren noget udtalt, som synsvinklen
ikke har, bliver det meldt — men et *vink* bliver stående, for det er
foregribelse og ikke en fejl.

Svaret er læst på personens egen tid, ikke verdens. To scener af den samme aften
i Predestination, fortalt fra hver sit ben af det samme liv, får derfor to
forskellige svar: som John ved han ingenting, som bartenderen ved han det hele.

Markér en passage og knyt den til et event, et faktum eller en person. Ankret
hænger på et mærke-id i dokumentet, aldrig på en tegnposition — positioner
overlever ikke den næste rettelse.

**Prosaen er din.** Skrivebordet gemmer det, du selv skriver, og hver gemning
lader det forrige udkast blive liggende. Ingenting andet i programmet retter i
teksten uden at spørge.

### Videnskurven

Personkortet har en skyder gennem personens eget liv. Stoppene er ikke jævnt
fordelt — de ligger præcis dér, hvor modellen ved, at noget sker. Leonards kurve
stiger, når han ser noget, og et kvarter senere står der: *«en overbevisning
løber ud — Teddy kan ikke stoles på · nedskrevet → bærer det på sig»*. Det er
hele filmen på én linje.

### Gennemgangen

Seks regler kører: **bilokation**, **rejsetid**, **liv og alder**, **vidensbrud**,
**bæreren mangler** og **umulig kronologi**. De har alle den samme disciplin:

> Meld kun det, der ikke kan arrangeres anderledes.

En uskarp dato kan lægges hvor som helst i sit spillerum. Findes der bare én
placering, hvor det hele går op, er der ikke noget galt — så har du bare ikke
besluttet dig endnu. To scener «en gang den uge» i hver sin ende af landet er
ikke en fejl; to scener klokken otte samme aften er.

Tre skel afgør, om motoren er til at holde ud at have kørende:

- **Ben.** Samme person to steder på én gang er kun en fejl, hvis det er det
  samme ben af livet. To ben er tidsrejse, og det er hele *Predestination*.
- **Lag.** Samme person i to lag er en krop, der sover ovenpå.
- **Ophold mod ærinde.** Et event fastholder dig; et ophold siger, hvor du bor.
  «Leonard, Motellet, 1.–6. marts» betyder ikke, at han aldrig gik ud — så
  bilokationen tier om ærindet. Om han kan *nå* det, er rejsetidens spørgsmål,
  og den siger kun noget, når du selv har skrevet afstanden ned.

Er et fund forkert, fordi verdenen er sådan, skal du skrive en **lov** — en
evne, der nævner regelkoden. Så gælder den for alle tilfældene, og motoren
spørger loven, *før* den melder noget. Er det enkelte tilfælde en undtagelse i
sig selv, kan du lægge fundet til side med en grund. Grunden er ikke valgfri: en
advarsel, der kan slukkes uden at sige hvorfor, bliver til en liste, ingen
læser.

Et fund hænger på et fingeraftryk, ikke på en række. Derfor holder en afvisning
på tværs af kørsler, lukker et rettet problem sig selv, og «den er kommet
tilbage» er noget, du kan se.

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
| **Memento** | Fortællerorden mod kronologi; viden der udløber | 10 kapitler, 22 scener, 20 events over to år. Otte personer, seks fakta, en løgn og en polaroid |
| **Predestination** | Personlig tid, selvmøder, flere identiteter | 5 kapitler, 10 scener. Fire ben af det samme liv, fortalt fra tre af dem |
| **Inception** | Lag inden i lag med hvert sit ur | 4 kapitler, 10 scener, et per lag. Syv på holdet, med hver sin del af sandheden |

De er skrevet til at have vægt, ikke til at være korte. Et kapitel med én scene
og én synsvinkel beviser næsten ingenting — det er først ved den her tæthed, at
tallene i kapitelvisningen løber baglæns, at båndet bliver et gitter, og at det
kan ses, om et svar afhænger af *hvilket* hoved man spørger. Prøverne holder
tætheden fast, så de ikke stille bliver tynde igen.

Alle tre loader rent: `koer_gennemgang` melder ingenting på nogen af dem. Det er
den egentlige prøve på reglerne — de skal kunne tie om tre indviklede historier,
der alle går op.

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

**Fase 4: fortællelaget.** POV-lækagen står allerede i skrivebordet; resten
mangler — lovbrud, lagbrud, selvmøde-lækage og afsløringsrækkefølge, kørt som en
del af den samme gennemgang. Og manuskriptgennemgangen, der kommenterer i
margenen og aldrig rører prosaen uden et ja.
