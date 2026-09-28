# Fabula & Sujet

Et arbejdsværktøj til at holde en flerbindshistorie sammen — og til at skrive
den. Bygget på den ene skelnen alt andet hviler på: hvornår tingene **skete**,
og hvornår de **fortælles**.

## Status

**Fase 0 til 16 er færdige.** Datamodellen, tidsløseren, ændringsloggen og
MCP-serveren står; oven på dem et interface med værkvælger, tidslinje, lister og
historik, et skrivebord hvor prosaen bliver til med bibelen åben ved siden af —
tid × sted-matrix og relationskort — og en motor, der siger fra, når noget ikke
kan lade sig gøre. Fortællelaget
kontrollerer desuden POV, lag, selvmøder og afsløringsrækkefølge, mens en AI kan
lægge manuskriptforslag i margenen uden at røre prosaen. Kontinuitetslaget følger
desuden genstande, relationer, identiteter, forsvindinger, setups og researchkilder,
og kildehylden viser, hvad hver kilde faktisk holder oppe. Prosa og bibel er nu
bundet sammen med stabile arbejdsreferencer, der kan skrives som `@G1` og vises
som det naturlige navn på siden. En gennemlæsning af manuskriptet ved, hvilken
version af hver scene den faktisk læste, skrivebordet siger til, når et navn
står i prosaen uden at hænge sammen med bibelen, og de omtaler, der *er* knyttet,
bliver prøvet mod tid, navnegyldighed og læserens rækkefølge. En plottråd kan
nu nå ud over den bog, den begynder i, så et løfte givet i bind et kan blive
indfriet i bind to. Og bogen kan forlade programmet: en læseudgave som Markdown
eller Word med forfatterens ord og ingenting andet, og en versionsmærket backup,
der kan hentes hel tilbage — prosa, historik og vedhæftede filer — i en tom
database.

```bash
npm install
npm test                              # 325 prøver
npm run fixtures -- ./fabula.db       # læg de fire prøvecases ind
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
| **Tidslinje** | Kronologien i baner. Starter på historiens tætteste område; skift til hele tiden, zoom, panorér eller hop i oversigtsbåndet |
| **Personer · Steder · Ting** | Listerne, med et panel der viser ben, tilstedeværelse og hvad personen ved |
| **Events** | Hvad der skete, og hvor fast tiden på det er |
| **Fakta · Love** | Opret og ret fakta, overbevisninger, udsagn, viden på genstande og verdensregler |
| **Kontinuitet** | Opret relationer, identiteter, ophold, rejser, besiddelser, tilstande, plottråde og kilder; se og slet dem individuelt |
| **Serien** | Serien som én fortælling: bindene, de gennemgående personer, trådene og de uløste setups |
| **Kapitler** | Bogen i læserækkefølge, med hvert events kronologiske plads ved siden af |
| **Båndet** | De to akser mod hinanden, en tråd for hver gang bogen fortæller noget |
| **Skrivebordet** | Manuskriptet, og ved siden af det hvad synsvinklen ved her og hvad læseren ved |
| **Grebet** | Hvor godt afsløringerne virker, læst på otte akser med scenerne som begrundelse |
| **Alternativer** | Grenene ved siden af hinanden: flyt scener og afsløringer, og se hvad der skiller de to |
| **Gennemgangen** | Det, der ikke kan lade sig gøre — og det, du har lagt til side, med din grund |
| **Historik** | Hvem ændrede hvad, og rul tilbage til et hvilket som helst punkt |
| **Eksport** | Læseudgaven ud som Markdown eller Word, backup ud, og backup ind igen |

Redigering sker i panelerne: ret et felt, klik væk, og det er gemt — og ét
fortryd væk. Der er ingen gem-knap, fordi der ikke er noget at fortryde ved.

### Skrivebordet

Manuskriptet står i midten og gemmer sig selv et sekund efter, du holder op med
at skrive. Til højre svarer panelet på de to spørgsmål, der faktisk standser et
udkast: **hvad ved synsvinklen lige her**, og **hvad ved læseren nu**. Afstanden
mellem dem er den dramatiske ironi. Får læseren noget udtalt, som synsvinklen
ikke har, bliver det meldt — men et *vink* bliver stående, for det er
foregribelse og ikke en fejl.

Alle 42 scener i de tre prøvehistorier har deres egen korte, nyskrevne prosa.
Dermed kan skrivebordet prøves som en bog, man går igennem scene for scene, ikke
kun som en håndfuld tomme beholdere omkring datamodellen.

Svaret er læst på personens egen tid, ikke verdens. To scener af den samme aften
i Predestination, fortalt fra hver sit ben af det samme liv, får derfor to
forskellige svar: som John ved han ingenting, som bartenderen ved han det hele.

Skriv `@` efterfulgt af en arbejdsreference eller et navn — for eksempel
`@G1` — og vælg målet. På siden står det naturlige navn, mens den stabile kode
ligger i et tekstanker. Personer, identiteter, steder, genstande,
organisationer, begreber, events, fakta, afsløringer, scener og plottråde kan
adresseres på den måde. Klik på omtalen for at åbne kortet; kortets backlinks
fører tilbage til den præcise passage. Man kan også markere en eksisterende
passage og vælge et mål. Ankret hænger på et mærke-id i dokumentet, aldrig på en
tegnposition — positioner overlever ikke den næste rettelse.

Alle fire prøvecases har omtaler i prosaen, så funktionen kan ses i brug frem
for kun læses om: `@G1` er Ingeborgs brev i Havnen, `@S1` er Fyret, og de tre
film har hver deres. Prøvecasene indlæses i en tom database — `npm run fixtures`
opretter verdenerne forfra, så en database, der allerede har dem, får dem én
gang til.

På Skrivebordet står et grønt `@G2`, `@P6` eller tilsvarende ud for de scener,
der allerede har omtaler. Dermed kan eksemplerne findes direkte i
læserækkefølgen; vælg scenen og åbn fanen **Ankre** for at se mål og uddrag.

Koden er et arbejdsredskab, ikke en del af bogens ordlyd. En omdøbning ændrer
derfor ikke forfatterens ord, og en slettet reference står som brudt frem for at
forsvinde. Koderne er stabile gennem omdøbning, fortryd og historiegrene.

**Prosaen er din.** Skrivebordet gemmer det, du selv skriver, og hver gemning
lader det forrige udkast blive liggende. Skal Claude skrive prosa ind, bliver du
spurgt først — hver eneste gang, med både den gamle og den nye tekst foran dig —
og der bliver kun skrevet ved et ja.

Fanen **Margen** samler kommentarer til sammenhæng, fortælling, tempo og
research. En kommentar kan indeholde en foreslået formulering, men formuleringen
er kun vist. Selv knappen «Markér som fulgt» registrerer kun beslutningen; den
gemmer aldrig en ny udgave af sceneteksten.

### Videnskurven

Personkortet har en skyder gennem personens eget liv. Stoppene er ikke jævnt
fordelt — de ligger præcis dér, hvor modellen ved, at noget sker. En
hukommelsesregel kan sige én gang, at nye oplevelser kun holder et kvarter,
mens ældre minder og det, der står på en polaroid, består. Leonards kurve
stiger derfor, når han ser noget, og falder igen, når oplevelsen glider ud.

### Kontinuitet

Tilstande er brugerdefinerede frem for hårdkodede. Kategorien kan være
«lås», «helbred» eller «ladning»; værdierne inden for den kan være «åben» og
«låst». To forskellige værdier i samme kategori må ikke overlappe. Det samme
gælder relationer, når du giver dem en kategori som «alliance» eller «forhold».
Uden en kategori gætter programmet ikke på, hvilke ord der udelukker hinanden.

Plottråde samler setups, komplikationer og payoffs i læserækkefølgen. Et setup
uden et senere payoff bliver en bemærkning i gennemgangen. En tråd kan nå
længere end den bog, den begynder i — se «Serien som én fortælling». Identiteter kan have
deres eget tidsrum og knyttes til en konkret deltagelse, og en registreret
forsvinding gør en sikker optræden midt i hullet synlig.

Researchkilder er fortsat **kun gemt og vist**. En henvisning kan markeres som
støtte, kontekst eller mulig modstrid, men programmet åbner, udtrækker eller
fortolker aldrig filens indhold. Det er markeringen — ikke et maskinelt gæt —
der bliver vist i gennemgangen. Selve filen kan lægges ind i projektets arkiv,
så henvisningen holder, og en fil, der forsvinder eller bliver en anden, bliver
opdaget.

### Gennemgangen

Enogtyve regler kører. Ud over **bilokation**, **rejsetid**, **liv og alder**, **vidensbrud**,
**bæreren mangler**, **umulig kronologi**, **POV-lækage**, **lagbrud**,
**selvmøde-lækage** og **afsløringsrækkefølge** følger
**genstandskontinuitet**, **relationstilstande**, **hængende setups**,
**navne og identiteter**, **forsvindinger** og **kildemodstrid** — og fra prosaen
**omtale før sin tid**, **navn uden for sin tid**, **omtale før læseren ved det**,
**person vist et andet sted** og **genstandspåstand i prosaen**,
samt **fil væk fra arkivet**. De har alle den samme disciplin:

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

Bløde verdenslove er fritekst og bliver ikke foregivet maskinforstået. Ved en
manuskriptgennemgang får AI'en scenen sammen med gældende love, POV-viden,
læservarviden og metadata om kilder. Et muligt lovbrud bliver derfor en synlig
margennote, som forfatteren kan følge eller afvise — ikke et skråsikkert fund
fra en motor, der ikke kan læse lovens betydning.

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
  Manuskriptet røres aldrig uden et ja — enten et klik i editoren, eller et
  spørgsmål, du selv svarer på, hver gang Claude vil skrive. Gennemgangens
  forslag er inerte: kun dit klik skriver dem ind.
- **Kilder gemmes og vises, aldrig læst.** Programmet åbner ikke en PDF for at
  gætte, hvad den siger. Det, der regnes på, er forfatterens egen markering.

## Prøvecases

Tre film, hver med sin akse — og en serie, der er vores egen. Kan modellen holde
dem, kan den holde det meste.

| | Presser på | Lagt ind |
|---|---|---|
| **Memento** | Fortællerorden mod kronologi; viden der udløber | 10 kapitler, 22 skrevne scener og 1.034 ord. 18 beskrevne personer, steder og ting; 20 events over to år |
| **Predestination** | Personlig tid, selvmøder, flere identiteter | 5 kapitler, 10 skrevne scener og 480 ord. Fire ben af det samme liv, fortalt fra tre af dem |
| **Inception** | Lag inden i lag med hvert sit ur | 4 kapitler, 10 skrevne scener og 504 ord. 13 beskrevne personer, steder og ting fordelt over fire lag |
| **Havnen** | En serie: to bøger, tres år, tre slægtled | «Saltet» 5 kapitler, 9 scener, 541 ord; «Tidevandet» 4 kapitler, 7 scener, 422 ord. Ingen af de tre film rørte den almindelige sag: at læseren af bind to har bind et med sig |

De er skrevet til at have vægt, ikke til at være korte. Et kapitel med én scene
og én synsvinkel beviser næsten ingenting — det er først ved den her tæthed, at
tallene i kapitelvisningen løber baglæns, at båndet bliver et gitter, og at det
kan ses, om et svar afhænger af *hvilket* hoved man spørger. Prøverne holder
tætheden fast, så de ikke stille bliver tynde igen: hver scene skal have mindst
30 ord, og hver person, hvert sted og hver ting en egentlig beskrivelse.

De tre film loader rent: `koer_gennemgang` melder ingenting på nogen af dem. Det
er den egentlige prøve på reglerne — de skal kunne tie om tre indviklede
historier, der alle går op. Havnen melder én bemærkning, og den er sat der med
vilje: en kilde, forfatteren selv har markeret som en mulig modstrid med en
scene. Reglerne skal også kunne sige den slags højt uden at kalde det en fejl.

Prøvecasene måles per bog, ikke per verden. Én egenskab gælder ikke alle: de tre
film brydes med kronologien inde i bogen, mens Havnens to bind hver fortælles
fremad — afstanden dér ligger *mellem* bindene, og den prøves for sig.

## Sprog

Engelsk indeni, dansk udenpå. `docs/ORDBOG.md` er den eneste sandhed om
oversættelsen — tilføj dér, før du bruger et nyt ord.

## Layout

```
src/db/schema/     50 tabeller. Læs index.ts først; den siger i hvilken rækkefølge.
src/core/
  changelog.ts     det eneste, der skriver
  workbench.ts     hvilken verden, bog og gren vi arbejder på
  time/            gregoriansk tid, lagure, og løseren
  services/        skrivning, som UI og MCP begge kalder
  queries/         hvem vidste hvad, hvem var hvor, hvad ved læseren
  solve.ts         løseren kørt på databasen
src/mcp/           88 værktøjer, danske navne
src/server/        API'et interfacet taler med, og HTTP-serveren
src/fixtures/      de fire prøvecases
web/               interfacet: React, egen CSS, ingen komponentbibliotek
docs/ORDBOG.md     dansk ↔ engelsk, regelkoder, MCP-flade
```

### Alternativer

En gren er en hel, selvstændig udgave af historien — ikke et filter og ikke en
skjult fortrydelse. Under **Historik** kan du sige «start gren her» ved et
hvilket som helst trin, og så bliver hele fortællingen som den så ud dér kopieret
til et nyt spor med sine egne id'er. Originalen røres ikke.

På **Alternativer** flytter du scener og kapitler op og ned og afsløringer fra
scene til scene, og **Sammenlign** viser præcis hvad der har rykket sig. Det er
ikke længere kun fortællerækkefølgen: prosa, personer, events, tid, fakta, love,
relationer og plottråde står i hvert sit afsnit:

```
SCENE FLYTTET      Teddy siger det hele          nr. 1  →  nr. 3
AFSLØRING FLYTTET  Teddy hedder John Edward G.   Nogen har ringet → Teddy siger det hele
AFSLØRING ÆNDRET   Teddy hedder John Edward G.   hinted → confirmed
PROSA ÆNDRET       Nogen har ringet               [slettet tekst] → [ny tekst]
TID ÆNDRET         Teddy fortæller sandheden      03.10 → 03.05
```

Sammenligningen finder det sidste punkt, grenene var enige ved. Har den aktive
gren også ændret den samme oplysning siden da, står der **konflikt** — den bliver
ikke løst i stilhed. Du kan overføre præcis én vist forskel fra den anden gren;
det er én handling og ét Fortryd væk. Prosa bliver en ny udgave, så den gamle
tekst stadig kan læses. Hele grene flettes aldrig.

Prøvecasen for Memento har en variant med i forvejen — «Teddy afsløres tidligere»
— så der er noget at sammenligne fra første kørsel.

### Grebet

Alt andet i programmet svarer på, om noget **kan lade sig gøre**. Det her svarer
på, om det er **noget værd**. Otte akser, hver regnet ud af noget, du allerede
har skrevet ned:

| Akse | Spørger |
|---|---|
| Overraskelse | Hvor sent lander det, og hvor meget var varslet først |
| Retfærdighed | Lå sporene på siden, før det blev sagt |
| Efterrationalisering | Lå de der *uskiltet* — den slags læseren vender tilbage til |
| Timing | Hvor sidder den, og hvor meget bog er der tilbage bagefter |
| Konsekvens | Sker der noget, fordi den falder |
| Vildledning | Står der en troværdig forkert forklaring i vejen |
| Forberedelse | Hvor langt er der fra setup til indfrielse |
| Informationskontrol | Hvem vidste det før læseren, og fortalte de scenen |

**Der gives ingen karakter.** «7,4 ud af 10» kan hverken diskuteres eller
handles på; en aflæsning, der peger på de scener, den kommer af, kan begge dele.
En akse tier, når der ikke er noget at regne på.

```
✓ Retfærdighed   1 scene bærer sporet, før det bliver sagt — første gang i scene 12.
                 12. NATALIE SER PÅ HAM
? Konsekvens     Der sker 6 scener efter afsløringen, men ingen af dem er
                 registreret som en indfrielse. 1 person ved det — ændrer det noget?
✓ Vildledning    Der står en troværdig forkert forklaring i vejen: Natalie lyver om det.
```

Og det er her fase 6 betaler sig: «twistet i kapitel 8» mod «twistet i kapitel
12» kan ikke afgøres i luften, men med begge rækkefølger lagt på hver sin gren
viser **Mod en anden gren**, hvilke akser der flytter sig — og det er selve
argumentet for at vælge den ene.

### Kilderne og det udtrykkelige ja

Research bliver aldrig læst maskinelt. En kilde gemmes og vises: titel, fil,
link og forfatterens egen note. Det er ikke en mangel, det er hele holdningen —
programmet skal ikke lade som om, det har forstået en fotograferet protokolside.
Det, der arbejdes videre på, er forfatterens egen markering: **understøtter**,
**kontekst** eller **mulig modstrid**. Den sidste bliver til en bemærkning i
gennemgangen, med navnet på det, den strider mod.

**Filen ligger i projektets arkiv, ikke i en sti.** En sti er et løfte, ingen har
givet: flytter du mappen, peger henvisningen ud i luften, og programmet opdager
det aldrig. Så filen kopieres ind i `fabula-filer/` ved siden af databasen, og
originalt navn, type, størrelse og kontrolsum bliver gemt. At kopiere og hashe
bytes er ikke at læse dem — der bliver hverken udtrukket tekst, genkendt sider
eller fortolket noget som helst.

To ting følger af det. **Fil og henvisning er to ting:** at slippe henvisningen
kan fortrydes og lader filen ligge; at slette filen kan ikke fortrydes og bliver
bedt om for sig. Og **filen vises kun, hvor det er sikkert:** typen kommer fra
navnet, den bliver aldrig gættet ud fra indholdet, og alt, der kan køre kode —
en SVG, en HTML-side — bliver hentet ned frem for vist på stedet.

Den billige prøve er en regel, der kører hver gang: ligger filen der, og har den
stadig sin størrelse. Den grundige læser hver fil tilbage og sammenligner
kontrolsummen, og den bliver bedt om — «Tjek filerne» på hylden eller
`tjek_vedhaeftninger`. Den nævner også filer i arkivet, ingen kilde peger på, og
sletter dem aldrig selv.

**Kildehylden** står under Kontinuitet og er sorteret efter de to spørgsmål, den
er til for: hvad er markeret som en mulig modstrid, og hvad blev gemt og aldrig
knyttet til noget. En henvisning, hvis mål er slettet, skjules ikke — der står,
at den peger på ingenting.

Manuskriptgennemgangen kommenterer i margenen. En note må foreslå en formulering,
og forslaget er inert: en margennote skriver aldrig noget selv, heller ikke en
markeret som fulgt. Hænger noten på et anker i teksten, kan forfatteren skrive
den ind med ét klik i editoren — og det klik *er* tilsagnet:

```
research   Vejrarkivet noterer kuling den aften. Enten skal Mads tage fejl med
           vilje — og så skal det stå — eller også skal sætningen om vejret gå.

           Foreslået formulering — ikke anvendt
           «Der var storm, og alligevel var det ikke stormen …»

           [ Skriv den ind ]  [ Markér som fulgt ]  [ Afvis ]
```

Udskiftningen sker i editoren, hvor sætningen kan ses lande, og prosa og note
gemmes i **den samme tur** — ét fortryd tager begge dele tilbage. Serveren
afviser at gemme en tekst, der ikke indeholder den foreslåede formulering, så en
gemning kan ikke rejse ind under en notes navn. Er passagen skrevet om, siden
noten blev lagt, siger den det frem for at gætte, hvor sætningen sad.

Claude kan også skrive prosa direkte — med `gem_scenetekst` — og det gør ingen
forskel på tilsagnet: **værktøjet spørger dig selv, hver eneste gang.** Spørgsmålet
går ud gennem MCP's egen elicitation, så det lander i dit program og bliver
besvaret af dig, ikke af modellen, der gerne vil skrive. Det viser begge tekster:
den, der bliver til en tidligere udgave, og den, der kommer i stedet.

```
Må jeg skrive ny prosa ind i «Vandet står ind»?

Det, der står nu (312 ord), bliver til en tidligere udgave:
Der var ingen storm. Det var det, han nåede at tænke …

Det, jeg vil skrive (298 ord):
Kulingen stod ind fra nordvest, og alligevel …

                                        [ ja ]  [ nej ]
```

Et nej skriver ingenting. Et afbrudt spørgsmål er også et nej. Og kan programmet
i den anden ende slet ikke stille dig et spørgsmål, nægter værktøjet at skrive —
«spørg først» uden nogen at spørge er bare at skrive.

### Gennemlæsningen

En gennemgang er motoren, der regner. En **gennemlæsning** er nogen, der læser.
De to hører sammen i den samme skærm, fordi de svarer på det samme spørgsmål —
hvad er der set efter — men på hver sin akse.

En gennemlæsning åbnes på en scene, et kapitel, en bog eller en hel serie, og
den skriver ned, præcis hvilken version af prosaen hver scene stod i:

```
Gennemlæsning af serien «Krag» er åbnet. (id: 9yvh59ba2nw8pkhq)
16 scener.

    1. Saltet · Aftalen · Sundvej, september — 42 ord, version pytn1182dxnw6p0r
    2. Saltet · Aftalen · Ingeborg tæller ugerne — 58 ord, version 3rn1x22p9s9zdgq3
    3. Saltet · Natten ved Fyret · Vandet står ind — 58 ord, version svsg9rhftkrgevy3
   …
   16. Tidevandet · Sundvej, tres år efter · Ellen bliver stående — 65 ord
```

Det er ikke bogholderi. Uden versionen kan en læsning fra i går ikke skelnes fra
en, der handler om det, der står nu — og en margennote om et afsnit, der siden er
skrevet om, ser ud som om den stadig gælder. Hver note bærer derfor den version,
den blev skrevet til, og siger **tidligere version**, når scenen er gemt igen.

Mærket er en oplysning, ikke en lås. Prosa gemmes, mens du skriver, så en note er
forældet et minut efter den blev skrevet; at nægte at handle på den ville lukke
hele margenen. Det, mærket ændrer, er hvad noten påstår om sig selv.

Oversigten siger det samme om hele læsningen: *ni scener, én margennote, én af
scenerne er skrevet om siden.* Er alle scener skrevet om, siger læsningen ikke
længere noget om bogen, og så skal den ikke stå som om den gør.

Der er ingen knap til at starte en gennemlæsning i interfacet. Det er Claude, der
læser prosaen; en tom læsning uden nogen til at skrive noterne ville kun være en
dato.

### Navne uden kobling

Prosaen bruger navne. Bibelen har poster. De to falder fra hinanden hele tiden,
fordi man skriver «Valdemar» uden at gå op i `@`-menuen først. Skrivebordet
holder derfor øje med begge slags huller, og de er ikke det samme problem:

```
NÆVNT UDEN OMTALE
  P7  Valdemar Sund   «Valdemar»            [Knyt her]

INGEN POST SVARER TIL NAVNET
  Marie Krag                    Opret som  [person] [sted] [genstand]
```

Det øverste er ét klik fra at være i orden: posten findes, forfatteren skrev bare
navnet i stedet for at vælge det. Det nederste er en beslutning, ingen har taget
endnu — en forbipasserende behøver ingen post, og programmet må ikke lade som om
det ved, hvornår et navn er en person.

Hverken det ene eller det andet kaldes en fejl, og intet af det skriver i
prosaen. **Knyt her** lægger et mærke om de ord, der allerede står der; ordtallet
rykker sig ikke. **Opret** laver posten og stopper — koden uddeles først, når
turen lukker, så navnet flytter op i listen ovenfor og bliver knyttet med det
rigtige nummer.

Tavsheden er den halvdel, der er svær. Dansk skriver kun store bogstaver på
navne, så et stort bogstav midt i en sætning er et godt spor — men et stort
bogstav *først* i en sætning er ingenting, «Valdemars båd» er stadig Valdemar,
og et efternavn, tre personer i bogen deler, peger ikke på nogen af dem. En liste,
der melder alt det, bliver lukket den første dag. Hver af de tavsheder har sin
egen prøve.

MCP kan spørge om det samme med `vis_navne_uden_kobling`, og gennemgangspakken
for en scene tager det med — men der findes ingen vej derfra til at sætte
omtalen. Et mærke i manuskriptet er stadig kun forfatterens klik.

### Omtalen som påstand

Alle de andre regler læser modellen. Fem regler læser manuskriptet: en omtale er
forfatteren, der peger på noget, mens hun skriver, og det kan holdes op mod, hvad
bibelen siger var sandt i det øjeblik.

```
· [mention_ahead_of_time] «Sundvej, september» peger i prosaen på «Marie Krag
  går ned», som tidligst sker senere. Scenen er bunden til Mads Krag, så enten
  varsler fortælleren noget, synsvinklen ikke kan kende, eller også er det noget,
  den venter sig — og så mangler bibelen forventningen, ikke mærket.
```

- **Omtale før sin tid.** En bunden narration kan ikke pege på noget, der endnu
  ikke er sket. En alvidende fortæller må gerne, og gør det hele dagen, så reglen
  spørger først, hvem der fortæller. Kun sikkerhed meldes: eventets *tidligste*
  mulige tidspunkt skal ligge efter scenens. Kan det arrangeres, så det går op,
  er der ikke noget galt — datoen er bare ikke besluttet endnu.
- **Navn uden for sin tid.** Prosaen kalder ham Teddy, og på det tidspunkt hed
  ingen Teddy endnu. Modellen nægtede allerede at lade nogen *optræde* under et
  navn uden for dets gyldighed; det her er den samme påstand, fremsat af teksten.
- **Omtale før læseren ved det.** Prosaen peger på et faktum, læserækkefølgen
  ikke har udleveret endnu. Det er ikke «du røbede det» — det er «enten er det en
  antydning, der mangler at stå som en afsløring, eller også står den for
  tidligt», og begge dele er forfatterens valg. En antydning, ingen har skrevet
  ned, er usynlig for alt andet i programmet: afsløringsrækkefølgen, læserviden,
  Grebet.

Scenens nutid er det, den *dramatiserer* — ikke, som i desken, med tilbagefald
til noget omtalt. En bartender, der i 1970 fortæller om et barn i 1945, ville
ellers blive målt mod 1945, og hvert navn, han har brugt siden, ville se ud, som
om det ikke fandtes endnu. En scene, der dramatiserer ingenting, har ingen nutid,
og så tier reglerne.

**Hvad en omtale ikke siger.** Den sætter ingen i rummet. «Han tænkte på
Valdemar» nævner Valdemar og placerer ham ingen steder. Forfatteren kan derfor
markere et anker som blot nævnt, vist i scenen, holdt af en bestemt person eller
med en bestemt tilstand. Kun de sidste, udtrykkelige påstande sammenholdes med
besiddelser og tilstande; personers fysiske tilstedeværelse kontrolleres kun,
når tid og livslinje er sikre. Uskarphed bliver stående som uskarphed.

Alle fire prøvecases er tavse under prosareglerne, og der er en vægtprøve pr. bog
på netop den tavshed.

### Serien som én fortælling

En plottråd har altid haft en bog. Nu har den to ting: den bog, den **begynder**
i, og hvor langt den **når** — kun bogen, hele serien eller hele verden.

```
Gælden  ·  hele serien
  SETUP          Valdemar tager imod pengene            Sundvej, september · Saltet
  KOMPLIKATION   Ingeborg bliver medvider og bliver     Han fortæller hende det · Saltet
  PAYOFF         Barnebarnet betaler tres år efter      Jens siger det · Tidevandet
```

Før kunne det her ikke skrives. Setuppet lå i bind et og indfrielsen i bind to,
så de måtte være to tråde, og gennemgangen så et løfte, der aldrig blev holdt, og
en indfrielse, der aldrig var blevet lovet. Nu er det én tråd, og gennemgangen
tier — fordi løftet faktisk bliver holdt.

Det krævede en rækkefølge, der gælder på tværs af bindene. Kapitler tæller fra
et i hver bog, så en sammenligning, der kun så på kapitel og scene, lagde bind
to's første kapitel før bind et's andet. `readingOrder` i
`src/core/queries/order.ts` lægger serie → bog → kapitel → scene i én stigende
orden, og alt, der skal sige hvilken af to scener læseren når først, spørger der.

Et slag, der endnu ikke er skrevet ind i en scene, bliver ikke placeret. Det er
ikke en mangel, det er reglen: så længe et payoff kan lægges efter sit setup,
er der ikke noget galt. Kun det setup, hvis payoff mangler helt eller
beviseligt ligger for tidligt, bliver meldt.

Grebet regner på den samme akse. Forberedelsen af «Marie Krag blev sænket med
vilje» målte før seks scener, fordi bogen kun har ni; nu måler den fjorten, fra
setuppet i «Saltet» til indfrielsen i «Tidevandet», og siger hvilke bind den går
mellem. Sporene tælles på samme måde: en scene i et tidligere bind, der viser
tingen uden at pege på den, er et spor som alle andre. Overraskelse, timing og
konsekvens bliver derimod stående i bogen — «der er to scener tilbage bagefter»
handler om denne bog og ikke om serien.

Scenenumre tæller fra et i hvert bind. Et spor eller et setup fra et andet bind
får derfor bindets titel skrevet på, for nummeret alene ville pege på den
forkerte scene.

Rækkevidden bestemmer også, hvad du får at se. Med «Saltet» valgt viser
kontinuitetspanelet bogens egen tråd og seriens — men ikke den, der udelukkende
hører til «Tidevandet». En anden serie i den samme verden arver stadig
ingenting.

Og så er der oversigten selv. **Serien** viser bindene i rækkefølge, de personer
der går igen, trådene og hvor langt de når, de setups der endnu ikke er
indfriet, og alle afsløringerne i læserækkefølge:

```
AFSLØRINGER I LÆSERÆKKEFØLGE
Saltet       Han fortæller hende det   Marie Krag blev sænket med vilje              bekræftet
Tidevandet   Brevet                    Marie Krag blev sænket med vilje              antydet
                                       · læseren har det med fra «Saltet»
```

Den sidste linje er hele grunden til, at oversigten findes. I bind to er den
sætning ikke en afsløring; læseren har vidst det i en hel bog. Det, der sker
der, er afstanden mellem det læseren ved, og det personerne ved — og den
afstand kan ingen enkelt bog vise.

En person går igen, når hun er i mere end ét bind, og «at være i et bind» er tre
ting forfatteren selv har skrevet ned: bindet fortæller et event, hun deltager
i, en scene er fortalt fra hendes side, eller prosaen peger på hende. Der bliver
ikke gættet ud fra navne.

Grænsen er hele pointen. En verden kan rumme flere serier, og de arver
ingenting fra hinanden — læseren af den ene har ikke læst den anden. Oversigten
samler derfor fra seriens bind og ingen andre. Står du i en bog uden serie,
siger den det og lader være med at fylde en side.

### Bogen ud af programmet

Alt, hvad programmet ved om bogen, er apparat: arbejds-id'er, ankermærker,
margennoter, fund, afsløringsregnskabet. Intet af det hører til i den tekst, en
forlægger eller en første læser får. Så **læseudgaven** går ét sted igennem —
`fromProse`, der beholder ordene og taber mærkerne — og der er ikke en gengiver
i programmet, der kan komme til at glemme det.

```
Eksport ▸ Læseudgave ▸ Hele serien: Krag ▸ Word (.docx)
Krag.docx: 9 kapitler, 16 af 16 scener, 963 ord.
```

Markdown og DOCX er to gengivelser af den **samme** neutrale model, bygget én
gang af scenens egen ProseMirror-JSON. Bygges de hver for sig, begynder de før
eller siden at være uenige om, hvad bogen er. DOCX'en er manuskriptets egen form:
Times 12 pkt, halvanden linje, indryk på alle afsnit undtagen det, der åbner en
scene, scenebrud som ⁂, og hvert kapitel på en frisk side. ZIP og DOCX er skrevet
i hånden — formaterne har ikke ændret sig siden 1993, og en afhængighed i vejen
for hver eneste fil, der forlader programmet, er den dyrere side.

Et **appendiks** kan bedes om: personer, steder, tidslinje, kilder. Det dækker
det, den eksporterede bog selv bringer på scenen — personerne i dens events,
stederne de sker i, den kronologi og den research, der hænger på noget af det.
En appendiks til bind to skal ikke præsentere alle dem, bind fem får brug for.
Vage datoer bliver stående som intervaller; tidslinjen finder ikke på en dag,
forfatteren ikke har besluttet.

**Backuppen** er det modsatte af læseudgaven: hver eneste række i hver eneste
tabel, med et versionsstempel for den skemaudgave, den er lavet på. Som ZIP
følger arkivets filer med i samme fil — en backup af en bog uden den
fotograferede side, den bygger på, er kun en halv backup.

En **genoprettelse** er den femte dokumenterede undtagelse fra «kun
ændringsloggen skriver», og den kan kun være det, fordi den siger nej: den
genopretter loggen, så den kan ikke gå gennem den, og derfor lægger den sig
aldrig oven i noget. Er databasen ikke tom, bliver den stoppet, før den rører
noget. Er backuppen lavet på en anden skemaudgave, det samme. Først vises en
forhåndsoversigt — verdener, bøger, scener, ord, filer — læst ud af filen uden
at databasen bliver rørt:

```
fabula-backup-2026-09-05.zip
Lavet 2026-09-05 16:15 · udgave 1 · 2855 rækker · 2 filer pakket med
  Memento — Memento (44 scener, 2068 ord, 2 grene)
  Havnen — Saltet, Tidevandet (16 scener, 963 ord)
```

Prøven for det er ikke to halve: der bliver skrevet en bog med en vedhæftet fil,
pakket, hentet ind i en anden, tom database — og bagefter læst ud igen og
sammenlignet ord for ord med den, der gik ind, byte for byte på filen, og tur for
tur på historikken.

## Næste skridt

Den oprindelige personlige appvision er implementeret. Fase 17 i
`docs/ROADMAP.md` er bevidst udskudt: alternative kalendere, relativistisk tid,
samtidige brugere og offentlig drift.
