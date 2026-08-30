# Arbejdsstatus

Sidst opdateret: 30. august 2026

## Aktiv fase

**Fase 10 — Prosaen kontrolleres mod bibelen. Færdig, med én bevidst
undtagelse.** Alle tre snit er implementeret, prøvet og browserprøvet:
den versionsbundne gennemlæsning, navnene uden kobling, og omtalen som en
påstand, motoren kan prøve.

Fase 0–10 er færdige. Næste fase er 11 — serien som én fortælling. Den aftalte
plan ligger i `docs/ROADMAP.md`.

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

## Færdigt i fase 10, tredje snit

- `src/core/rules/mentions.ts` med tre regler, alle registreret i `RULES` og
  dermed i `koer_gennemgang`, `vis_regler`, Gennemgangen og afvisningerne.
- `mention_ahead_of_time`: en bunden narration peger på et event, hvis
  *tidligste* mulige tidspunkt ligger efter scenens. Alvidende fortæller er
  undtaget, og et event, scenen selv dramatiserer, er POV-reglens sag.
- `mention_name_not_yet`: prosaen bruger en identitet uden for dens
  gyldighedsperiode. Samme påstand som `name_or_identity`, men fremsat af
  teksten i stedet for af en deltagelse.
- `mention_reader_ahead`: prosaen peger på et faktum, læserækkefølgen ikke har
  udleveret. Meldes som bemærkning, ikke fejl — en antydning, der mangler at
  stå som en afsløring, er lige så sandsynlig som en for tidlig afsløring.
- Scenens nutid er kun det, den **dramatiserer**. Desken falder tilbage til et
  omtalt event; det er rigtigt for «hvornår handler scenen om», og forkert for
  «hvad var sandt imens». Bartenderen, der i 1970 fortæller om 1945, ville
  ellers blive målt mod 1945. Dramatiserer scenen ingenting, tier reglerne.
- Alle tre spørger lovlaget først og bærer `lifted`, som resten af motoren.
- Vægtprøve pr. bog: de fire prøvecases melder ingenting under de tre regler.
- `vis_regler` beregner nu sin kolonnebredde i stedet for at bruge 18 tegn.

## Bevidst ikke bygget i fase 10

Tilstedeværelse, besiddelse og genstandstilstand udledes **ikke** af en omtale.
Et mærke siger, at forfatteren pegede på noget, ikke at nogen var i rummet:
«Han tænkte på Valdemar» nævner Valdemar og placerer ham ingen steder. En regel,
der læste det som tilstedeværelse, ville melde den mest almindelige sætning i
bogen, og så bliver hele værktøjet slået fra.

Vejen dertil er kendt og skrevet ned: et anker skal kunne sige *hvordan*
passagen bruger sit mål — vist i rummet eller blot nævnt — præcis som
`scene_event.mode` allerede gør for events. Det er en modelændring med migration
og en UI-beslutning ved hvert anker, og den ligger nu i fase 15 i `ROADMAP.md`.
Den er ikke glemt; den er valgt fra her.

## Færdigt i fase 10, andet snit

- `src/core/queries/proseGaps.ts` finder to slags huller pr. scene: en post,
  prosaen navngiver uden at nogen omtale i scenen peger på den, og et navn,
  bibelen slet ikke kender. De holdes adskilt, fordi de kræver hver sin handling.
- Tavshedsreglerne er det egentlige arbejde: et stort bogstav først i en sætning
  er ingenting (to store ord i træk er derimod et navn, for dansk skriver kun det
  første ord stort), genitiv-s tælles med i navnet, en navnedel bruges kun når
  hvert ord i navnet er stort («Den rejsende» giver ingen «Den»), og en navnedel,
  to poster deler, bruges slet ikke — tre Krag'er peger ikke på nogen af dem.
- En post, der allerede har en omtale i scenen, meldes ikke. Signalet er «intet
  peger på den her», ikke «du glemte den femte forekomst».
- MCP: `vis_navne_uden_kobling` på scene, kapitel, bog eller serie.
  `vis_scene_til_gennemgang` tager hullerne med, så de opdages under læsningen.
- API: `review.gaps`. `desk.get` bærer `gaps`, så skrivebordet ikke skal hente
  en gang til.
- UI: Ankre-fanen har «Nævnt uden omtale» med en Knyt her-knap og «Ingen post
  svarer til navnet» med Opret som person/sted/genstand. Fanens tal er ankrene;
  plusset er det, der venter.
- `ProseHandle.anchorPhrase` sætter mærket om ord, der allerede står der. Det
  ændrer ikke ét bogstav, og ordtallet rykker sig ikke.
- Opret knytter ikke selv. Koden uddeles først, når turen lukker, så navnet
  flytter op i den øverste liste og knyttes derfra med det rigtige nummer.
- Havnen har fået én sætning mere i «Valdemar forklarer sig», hvor skibet Marie
  Krag får sit navn. Skibet er en faktumværdi og ikke en post, så prøvecasen
  viser nu begge slags huller.

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

- Ingen halv implementering står åben. Fase 10 er lukket. Næste arbejde er
  fase 11.

## Beslutninger

- En gennemlæsning er bundet til den version, den læste. Uden det kan en gammel
  læsning ikke skelnes fra en aktuel.
- «Forældet» er en oplysning, ikke en spærring. Prosa gemmes, mens man skriver.
- Interfacet starter ikke en gennemlæsning. Det er Claude, der læser prosaen.
- En omtale nævner; den placerer ikke. Tilstedeværelse følger ikke af et mærke.
- Scenens nutid er det, den dramatiserer. Et omtalt event er ikke en nutid.
- Et hul er et spørgsmål, ikke en fejl. En forbipasserende behøver ingen post.
- Panelet må pege på et navn; kun forfatterens klik må sætte mærket.
- En navnedel, to poster deler, bruges ikke. Et gæt her er værre end tavshed.
- En referencekode er et arbejdsredskab, ikke en del af bogens ordlyd.
- Omdøbning af et mål må ikke omskrive prosa.
- En slettet reference skal stå som brudt; den må ikke forsvinde tavst.
- Eksisterende ProseMirror-mærker videreføres frem for tegnpositioner.

## Verificering

- 238/238 prøver er grønne.
- Typecheck og produktionsbuild er rene. Vite gentager den kendte advarsel om
  en JavaScript-chunk over 500 kB; det er ikke en buildfejl.
- Migration 0007 er prøvet mod en kopi af den eksisterende database. Prøven
  fandt og rettede migrationsjournalens fremskudte tidsstempler.
- Browserprøvet på en kopi af den rigtige database: en rettelse i «Vandet står
  ind» giver margennoten mærket «tidligere version», og Gennemgangen skifter fra
  «ingen af scenerne er skrevet om siden» til «1 af scenerne».
- Browserprøven er grøn. Forslagmenuens placering er også kontrolleret visuelt
  i den smalle trekolonnevisning.
- Browserprøvet på den rigtige `fabula.db`: «Knyt her» flyttede P6 Mads Krag fra
  «nævnt uden omtale» op i ankrene uden at ændre ordtallet, og «Marie Krag» blev
  oprettet som genstand, fik G2 og blev knyttet i næste klik.
- `vis_navne_uden_kobling` på hele serien melder fire scener og ingen støj.
- Browserprøvet på en kopi af den rigtige database: et anker fra «Sundvej,
  september» til «Marie Krag går ned» giver bemærkningen «Omtale før sin tid» i
  Gennemgangen med Læg til side-knappen, som alle andre fund.

## Næste konkrete handling

Fase 11 — serien som én fortælling. Den kendte grænse er `thread.work_id`: en
plottråd hører til én bog, så et setup i bind et og en indfrielse i bind to kan
ikke skrives som den samme tråd. Første snit er derfor at lade en tråd høre til
en bog, en serie eller en verden, med migration og uden datatab, og at regne
orden som serie → bog → kapitel → scene. Derefter skal Grebet medregne
forberedelse og læservarviden fra tidligere bind, og en serieoversigt skal vise
gennemgående personer, tråde, afsløringer og uløste setups — uden at blande en
anden serie i den samme verden ind.

## Åbne risici

- Prøvecasene indlæses altid i en tom database. Der er ingen vej til at hente
  nye eksempler ind i en database, man selv har arbejdet i, uden at få
  verdenerne dobbelt. Det var præcis den fælde, efterslættet ovenfor faldt i.
- Ældre ProseMirror-mærker uden kode kan stadig findes i en database, der er
  ældre end omtale-turen. Det er bagudkompatibelt: `text_anchor` leverer målet
  i sidepanelet, og ankret kan fortsat åbnes derfra.
- Identiteter åbner ejerens personkort, mens afsløringer åbner
  alternativvisningen. Egne detailkort til de to typer hører til fase 16.
