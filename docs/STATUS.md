# Arbejdsstatus

Sidst opdateret: 26. september 2026

## Aktiv fase

**Ingen. Fase 15 — hele modellen i interfacet — er færdig** og browserprøvet
26. september 2026. Fase 0–15 er færdige. Næste er fase 16: de sidste overblik
og robusthedsprøver. Den samlede plan ligger i `docs/ROADMAP.md`.

## Færdigt i fase 15

- Interfacet kan oprette personer, steder, ting, events, fakta, overbevisninger,
  udsagn, viden på genstande, afsløringer, love, relationer, identiteter,
  besiddelser, tilstande, ophold, rejseforbindelser, deltagere, eventfakta,
  tidsbånd, plottråde, plotslag og researchkilder. Retning sker inline eller via
  samme ændringslogførte API; sletning er individuel og fortrydelig.
- Sletningsforhåndsvisning finder direkte fremmednøgler og polymorfiske
  henvisninger (tekstankre, kildehenvisninger og bindinger) og viser forståelige
  navne uden UUID'er. Afhængige poster skal ryddes først.
- Tekstankre skelner mellem blot nævnt, vist, holdt og markeret tilstand.
  Gamle rækker migreres sikkert til «blot nævnt». Gennemgangen kontrollerer
  kun præcise og eksplicitte påstande: person et andet sted, forkert holder
  eller uforenelig genstandstilstand. Uskarp tid tier.
- 317/317 prøver, typecheck og build er grønne. Browserprøven oprettede et
  prøvefaktum, viste det og fjernede det med appens Fortryd; kontinuitetsformen
  blev gennemgået mod Memento.

## Næste konkrete handling

Fase 16 — tid × sted-matrix, relationskort, afsløringstavle, backlinks fra alle
kort, navigation fra fund til scene, ydelsesprøve med mindst 2.000 events,
tilgængelighed, integritets- og migrationsprøver samt onboarding til tom
database. Se `docs/ROADMAP.md`.

## Færdigt i fase 14

- `compareBranches` dækker nu fortællerækkefølge, afsløringer, konkret prosa,
  personer/steder/ting, events, eventtid, tidsbånd, fakta, love, relationer og
  plottråde. Sammenligningen grupperes med de samme ord i API, UI og MCP.
- **En rigtig trevejssammenligning.** Grenenes fælles forfader og
  forgreningspunkt genskabes fra ændringsloggen. «Konflikt» betyder, at den
  aktive gren også har ændret samme felt siden det fælles punkt — ikke bare at
  de to nutidige værdier er forskellige.
- Prosaforskellen viser den fælles sammenhæng samt præcis slettet og tilføjet
  tekst. En overført tekst går gennem `saveSceneText`, så den bliver en ny
  udgave, og den nuværende bevares som tidligere udgave.
- `transferBranchDifference` tager altid én synlig forskel fra den anden gren
  ind i den aktive. Flytning af kapitler, scener og afsløringer bruger de
  eksisterende domæneoperationer; modelrækker får alle greninterne henvisninger
  peget om. Handlingen er én tur i ændringsloggen og dermed ét Fortryd væk.
- En sammensat tilføjelse udgiver sig ikke for at være sikker: en hel scene,
  person, event, faktum eller plottråd med børn står synligt som «kan ikke
  overføres alene». Opdateringer og selvstændige poster kan overføres.
- MCP har fået `overfoer_forskel`. `sammenlign_grene` giver et stabilt
  forskel-id og viser både konflikt og konkret prosa. Skal prosa overføres via
  MCP, spørges forfatteren om lov gennem den samme elicitation som ved anden
  prosaskrivning.
- Mementos «Teddy afsløres tidligere» er udvidet i både fixture og den lokale
  `fabula.db`: den har nu synlige eksempler i samtlige ni afsnit. Det
  idempotente bro-script er `scripts/enrich-phase14.ts`.
- 313/313 prøver, typecheck og build er grønne. Browserprøven er kørt på den
  rigtige database: ni afsnit vises, klokkeslættet 03.10 → 03.05 kan læses,
  Teddy-beskrivelsen blev overført og derefter taget tilbage med ét Fortryd,
  og browserkonsollen er tom.

## Aktuelt efterslæt — omtalerne skal kunne findes

- Memento havde allerede fem omtaler på hovedgrenen, men Skrivebordets
  læserækkefølge viste kun scenetitel og ordtal. Funktionen fandtes; eksemplerne
  var skjult i 22 scener.
- `scene.list` leverer nu antal ankre og deres arbejdsreferencer. Skrivebordet
  viser, hvor mange scener der har omtaler, og mærker de konkrete scener med
  eksempelvis `@G2` eller `@P6`.
- Memento-eksemplerne ligger i «Han skriver på bagsiden», «Natten, i glimt»,
  «Han vågner hos Natalie», «Nålen» og «Natalie kommer forbi».
- 313/313 prøver, typecheck og build er grønne. Browserprøven er kørt mod den
  rigtige `fabula.db`: alle fem mærker står i scenelisten, og `@G2` åbner
  «Polaroid af Teddy» med det korrekte uddrag under **Ankre**.

## Færdigt i fase 13

### Første snit — læseudgaven

- `src/core/export/document.ts`: den neutrale model. Markdown og DOCX er to
  gengivelser af det samme, og bygges de hver for sig, begynder de at være
  uenige. Blokke og løb; en gengiver laver bytes og bestemmer intet om teksten.
- **Ét sted, der fjerner apparatet.** `fromProse` beholder ordene og taber
  mærkerne, og hele læseudgaven går derigennem. Editorens egen Markdown gik før
  gennem sin egen kopi i `web/`; den kunne eksporten ikke importere, så en bog,
  der forlod programmet, blev serialiseret af anden kode end den, søgningen
  læser. Nu kalder begge det samme.
- `src/core/export/zip.ts`: ZIP skrevet og læst i hånden. En DOCX er et
  ZIP-arkiv, og det er en backup med vedhæftninger også. Formatets eget hoved
  er hundrede linjer og har ikke ændret sig siden 1993 — mod en afhængighed i
  vejen for hver eneste fil, der forlader programmet, er hundrede linjer den
  billigere side.
- `src/core/export/docx.ts`: manuskriptets egen form. Times 12 pkt, halvanden
  linje, indryk på alle afsnit undtagen det, der åbner en scene, og hvert
  kapitel på en frisk side. Prøvet med Apples egen `textutil`, som åbner filen
  og læser hele bogen ud igen.
- `src/core/export/reading.ts`: bog eller serie i læserækkefølge, scenebrud
  mellem scener i samme kapitel, og et appendiks, der kun kommer med, når der
  bliver bedt om det. Appendikset dækker det, bogen selv bringer på scenen —
  ikke hele verdenen.

### Andet snit — backup og genoprettelse

- `src/core/export/backup.ts`: hver række i hver tabel, sorteret, med et
  versionsstempel — sha256 af `__drizzle_migrations`' hashes, tolv tegn, plus
  antallet af migreringer. `backupBundle` pakker data og arkivets filer i ét
  ZIP-arkiv; `backupJson` er data alene.
- `inspectBackup` læser filen og siger, hvad der er i den — verdener, bøger,
  scener, ord, grene og filer — uden at røre databasen. Titler tælles per
  verden og dubletteres ikke: to grene af den samme bog er «Memento, 2 grene»,
  ikke «Memento, Memento».
- `restoreBackup` er **den femte dokumenterede undtagelse fra «kun
  ændringsloggen skriver»**. Den kan ikke gå gennem loggen, fordi den
  genopretter loggen. Det, der gør undtagelsen sikker, er et afslag: er
  databasen ikke tom, eller er skemastemplet et andet, bliver den stoppet, før
  den rører noget — så der findes aldrig en historik, den kan skade. Afslaget
  ligger i kernen, ikke i fladerne. Indsættelsen kører i én transaktion med
  `pragma defer_foreign_keys = on`, samme greb som `undoTurn`.
- `holdsSomething` springer `app_state` over. Hvilken verden der er valgt, er en
  indstilling og ikke arbejde; ellers ville en database, der havde været åbnet
  én gang, aldrig kunne tage imod en backup.

### Tredje snit — fladerne

- MCP: `eksporter_bog`, `lav_backup`, `se_backup`, `genopret_backup`. **87
  værktøjer** i alt. De skriver til projektets eksportmappe — `fabula.db` giver
  `fabula-eksport/` — af samme grund som arkivet ligger der: eksporten hører til
  projektet.
- API: `export.reading`, `export.backup`, `backup.inspect`, `backup.restore`.
  Bytes går base64 i den almindelige JSON-krop, som vedhæftninger allerede gør,
  og bliver til en fil i browseren. Ingen nedhentningsrute, ingen midlertidig
  fil, der bliver liggende.
- UI: skærmen **Eksport** under «Arbejdet». Læseudgavens valg, to backupknapper,
  og en filvælger, der viser forhåndsoversigten, før noget hentes ind. Skærmen
  findes også i en helt tom database — det er dér, en genoprettelse skal bruges.

## Efterslæt: prøvet mod dokumentationen

En agent fik de fem dokumenter og ellers ingenting og prøvede at få programmet
til at modsige dem. Den fandt tre rigtige fejl og en række tal, der ikke passede.
Alt herunder er rettet.

- **Prosa gennem MCP spørger nu om lov, hver gang.** `gem_scenetekst` blev og
  bliver, men den skriver ikke længere uden et ja. Spørgsmålet går ud gennem
  MCP's egen elicitation, så det lander i forfatterens program og besvares af
  forfatteren — ikke af modellen, der vil skrive. Det viser begge tekster: den,
  der bliver til en tidligere udgave, og den, der kommer i stedet. Nej skriver
  ingenting, et afbrudt spørgsmål er også et nej, og en klient, der slet ikke
  kan spørge, får et afslag: «spørg først» uden nogen at spørge er bare at
  skrive. `npm run ask` kan svare — den stiller spørgsmålet i terminalen.
  Løftet i ROADMAP og README var før dette «prosa kan aldrig ændres gennem
  MCP», og det passede ikke. Nu passer både løftet og programmet.
- **`dangling_setup` og `source_conflict` spørger lovlaget.** De var de to
  eneste regler, der ikke gjorde det, så en evne med regelkoden slukkede ikke
  for dem. Begge har nu en prøve for tavsheden.
- **`law_violation` er ude af ordbogen.** Koden fandtes ingen steder i
  programmet, så en hård lov, der pegede på den, løftede ingenting. `unanchored_realm`
  og `current_user` var omvendt i brug uden at stå i ordbogen; nu står de der.
- **Ét sted til de danske ord.** `src/core/words.ts`. «Antydet» betød `hinted`
  på to skærme og `implied` på en tredje — det samme danske ord om to
  forskellige ting. Nu hedder `hinted` **vink** overalt, og både interfacet og
  MCP-fladen læser ordene fra den samme fil. Kilde-arter, afsløringsstyrker og
  vidensstyrker står ikke længere rå på skærmen.
- Mindre ting: «1 margennoter» hedder nu «1 margennote», en reference til en
  slettet post står under **Brudte** frem for under Begreber, en sletning, der
  ikke kan lade sig gøre, svarer på dansk i stedet for «FOREIGN KEY constraint
  failed», og `hvad_ved_laeseren` sætter bindets navn på et kapitelnummer fra et
  tidligere bind.
- READMEs tal var ikke ført ajour siden fase 9: seksten regler var nitten, 48
  tabeller var 50, 75 værktøjer var 83, «Saltet» har 541 ord, ikke 521, og
  skærmtabellen manglede Serien og Alternativer.

## Færdigt i fase 12

- `src/core/attachments.ts`: arkivet. `fabula.db` giver `fabula-filer/`, og en
  database i hukommelsen har intet arkiv — alt heri tier så, frem for at melde
  hver kilde væk. Filen ligger under sin kildes id med sit eget navn; et navn
  med skråstreger i bliver et filnavn, ikke en vej ud af arkivet.
- Filen skrives før rækken opdateres. Bliver turen afbrudt, ligger der en kopi,
  ingen peger på — den er harmløs og bliver listet. Den anden rækkefølge ville
  give en kilde, der peger på ingenting, og det er præcis den fejl, fasen
  findes for at slutte.
- **Bytene ligger uden for ændringsloggen.** Rækken går gennem `Session` som
  alt andet, men fortryd henter kun henvisningen tilbage og rører aldrig filen.
  Det er den sikre retning: en fil, forfatteren har lagt ind, er ikke
  programmets at smide væk. Det er den tredje dokumenterede undtagelse fra «kun
  ændringsloggen skriver», ved siden af tidsløserens grænser og `finding`.
- To prøver, ikke én. Den billige er reglen `attachment_missing`: ligger filen
  der, og har den stadig sin størrelse — den kører hver gang. Den grundige
  læser hver fil tilbage og sammenligner kontrolsummen; den bliver bedt om,
  fordi hashning af hele arkivet ved hver gennemgang ville gøre gennemgangen
  langsom for et svar, der ændrer sig cirka en gang om året.
- `GET /api/fil/:sourceId` rækker bytene ud. Typen kommer fra det navn, filen
  blev gemt under, aldrig fra indholdet, og `nosniff` holder browseren fast på
  den. Alt uden for den korte indlejringsliste bliver hentet ned frem for vist,
  så en SVG eller en HTML-side ikke kan køre som dokument på interfacets egen
  oprindelse.
- MCP: `vedhaeft_fil`, `fjern_fil` (med `slet_filen`), `tjek_vedhaeftninger`.
  `opret_kilde`s `sti` betyder nu «kopiér denne fil ind», og kilde og fil
  lægges ind i én tur, så én fortrydelse tager begge tilbage.
- API: `source.attach` (base64 i samme JSON-krop som alt andet),
  `source.attachPath`, `source.detach`, `source.check`. Kildehylden bærer
  `originalName` og `fileState`, den billige prøve, så listen kan vise en chip
  uden at læse noget.
- UI: Kilder-fanen under Kontinuitet. «Vedhæft fil», status som chip, navnet
  som link til filen, «Slip filen» og «Slet filen» som to knapper med hver sin
  bekræftelse, og «Tjek filerne» til den grundige prøve.
- Prøvecasen har to rigtige filer. De bygges ved indlæsningen — en gyldig
  ét-sides PDF og en gyldig PNG — frem for at ligge i repoet, og de lægges kun
  ind, når der er et arkiv at lægge dem i.

## Færdigt i fase 11, tredje snit

- `src/core/queries/series.ts` med `seriesOverview`: bindene i læserækkefølge,
  de personer der går igen, trådene og hvor langt de når, afsløringerne i
  læserækkefølge, og de uløste setups. Læser kun.
- «At være i et bind» er tre ting, forfatteren selv har skrevet ned: bindet
  fortæller et event, personen deltager i, en scene er fortalt fra hendes side,
  eller prosaen peger på hende. Der gættes ikke ud fra navne. Går igen betyder
  mere end ét bind — ellers er det ikke en gennemgående person.
- Afsløringerne bærer `carriedFrom`. I bind to er «Marie Krag blev sænket med
  vilje» ikke en afsløring; læseren har vidst det i en hel bog. Det er den
  linje, oversigten findes for.
- De uløste setups kommer fra `dangling_setup` selv, kørt uden valgt bog og
  filtreret til seriens tråde bagefter. En regel skrevet om til et panel er en
  regel, der kan være uenig med sig selv.
- Grænsen er prøvet i begge retninger: en anden serie i den samme verden dukker
  ikke op i Krag-oversigten, og Krag dukker ikke op i dens. En tråd med
  rækkevidde `verden` står i begge, med hjemstavnen sat til «(uden for serien)»
  der, hvor den ikke begynder.
- MCP: `vis_serieoversigt` (valgfrit `serie`; ellers den aktive bogs).
  API: `series.overview`, som svarer `null`, når bogen ikke er i en serie.
- UI: ny visning **Serien** under Overblik. Står du i en bog uden serie, siger
  den det frem for at vise en tom side.

## Færdigt i fase 11, andet snit

- Grebet har to akser i stedet for én. Bogens egen akse bærer overraskelse,
  timing og konsekvens — «der er to scener tilbage bagefter» handler om denne
  bog. Seriens akse bærer forberedelse og sporene.
- Seriens akse er bindene i serien, nummereret lige igennem. Bindene ligger i
  forlængelse af hinanden i læsningen, og det er det, der gør en optælling hen
  over dem til et rigtigt tal frem for et regnestykke på id'er.
- Forberedelsen af «Marie Krag blev sænket med vilje» målte seks scener, fordi
  «Saltet» kun har ni. Den måler nu fjorten og skriver, hvilke bind den går
  mellem.
- Sporene tælles på samme akse. En scene i et tidligere bind, der viser tingen
  uden at pege på den, er et spor som alle andre; en scene i et *senere* bind
  falder efter afsløringen og ryger ud i den samme sammenligning, så der ikke
  skal siges noget særskilt om retning.
- `ScenePoint.otherWork` bærer bindets titel, når scenen ikke står i den bog,
  der læses. Scenenumre tæller fra et i hvert bind, så nummeret alene ville
  pege på den forkerte scene.
- En aflæsning nævner hver scene én gang. «Sundvej, september» bærer et setup på
  to tråde, og en scene kan holde to afsløringer af hver sin plads — det blev
  til to ens chips med samme React-nøgle.
- Læserviden fra tidligere bind var der i forvejen: `whatReaderKnows` tæller
  serien med, og `carriedIn` siger det rent ud i overraskelsesaksen.

## Færdigt i fase 11, første snit

- `thread.scope` (`work` | `series` | `world`) og migration 0009. `work_id` blev
  stående og betyder nu den bog, tråden **begynder** i.
- Tabellen kunne ikke bygges om, og det er prøvet, ikke gættet: SQLite slipper
  ikke NOT NULL uden at genskabe tabellen, og en genskabelse fejler ved COMMIT,
  selv med `defer_foreign_keys = ON` og et tomt `foreign_key_check`. `beat`s
  fremmednøgle tæller `DROP TABLE`s implicitte sletninger med og tæller dem
  aldrig tilbage. En tilføjet kolonne med default er derfor både den mulige og
  den rigtige vej: enhver eksisterende tråd får `work` og opfører sig præcis som
  før.
- `src/core/queries/order.ts` med `readingOrder`: bøgerne i serieorden, én
  stigende `sceneRank` på tværs af hele grenen, og `reach`/`covers`, der siger,
  hvilke bøger en tråd når.
- `danglingSetup` regner nu i den orden. Før lagde den `kapitel × 100.000 +
  scene`, som kun gælder inden i ét bind — bind to's første kapitel kom før bind
  et's andet, og et løfte holdt i bind to så ud som et løfte brudt.
- Et slag uden scene er **ikke placeret**. Et `position`-tal sorterer det mod
  trådens andre uskrevne slag og siger intet om, hvor i bogen det havner. Så
  længe et payoff kan lægges efter sit setup, tier reglen — det er den samme
  regel som alle de andre: kun det umulige meldes.
- `resolveThread`, `continuity.get`, `continuity.thread.create`, `createThread`,
  `opret_plottraad` (nyt argument `raekkevidde`: bog/serie/verden) og
  `twistReadings` spørger alle rækkevidden i stedet for at sammenligne
  `work_id`.
- Kontinuitetspanelet viser rækkevidden som chip og skriver bindets titel på
  hvert slag, når tråden når længere end sin egen bog. Slagene sorteres i
  læserækkefølge, ikke efter et manuelt tal, der kun gjaldt inden i ét bind.
- Havnen har fået tråden «Gælden» med setup i «Saltet» og payoff i
  «Tidevandet» — den tråd, der ikke kunne skrives før.

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

- Ingenting. Fase 13 er lukket: alle tre snit er implementeret, prøvet og
  dokumenteret. Næste fase er 14.

## Beslutninger

- Markdown og DOCX er to gengivelser af den samme model, ikke to formater. Det
  ene bygget af det andet ville kræve en Markdown-parser og ville drive fra
  hinanden; scenens ProseMirror-JSON er sandheden, og begge gengivere læser den.
- Ét sted fjerner apparatet. `fromProse` er den eneste vej til en læseudgave, så
  «ingen ankermærker» kan prøves i stedet for at huskes af hver gengiver.
- Ét sted serialiserer Markdown. Editorens kopi i `web/` er nu en videreeksport
  af kernens; ellers blev en færdig bog skrevet af anden kode end den,
  søgningen læser.
- ZIP og DOCX skrives i hånden. En afhængighed ligger i vejen for hver eneste
  fil, der forlader programmet, og formaternes hoveder har ikke ændret sig siden
  1993.
- En genoprettelse lægger sig aldrig oven i noget. Fletning ville betyde to
  historikker, der skal forliges, og der findes ikke et rigtigt svar på det —
  en tom database er den eneste tilstand, hvor genoprettelsen er entydig.
- Afslaget ligger i kernen. Både MCP og interfacet kalder det samme; en flade,
  der glemte at spørge, ville ikke kunne komme udenom.
- Appendikset dækker det, bogen selv bringer på scenen. Et verdensbredt register
  ville være længere og mindre brugbart — bind to skal ikke præsentere alle dem,
  bind fem får brug for.
- Appendiksets dele siges på dansk. MCP-fladens enum-værdier er ellers modellens
  egne engelske, fordi det er modellen, der skriver dem — men de her gemmes ingen
  steder og er en menu, forfatteren vælger i.
- Vag tid bliver stående vag, også i tidslinjen. Intervallet skrives som
  interval på eventets egen præcision; to ender på samme dag skrives én gang.
- Prosa må gerne skrives gennem MCP — men der skal spørges om lov, hver gang.
  Ikke en indstilling, ikke et tilsagn, der gælder resten af samtalen: hver
  skrivning har sit eget spørgsmål, og forfatteren svarer på det selv.
- Kan klienten ikke spørge, skrives der ikke. Et afslag er det ærlige svar; at
  skrive alligevel ville gøre reglen til en formulering.
- De danske ord bor ét sted i koden. Tre filer, der oversatte de samme fire
  værdier hver for sig, endte med at sige noget forskelligt — og et dansk ord,
  der betyder to ting, er værre end det engelske ord.
- En sti er et løfte, ingen har givet. Filen kopieres ind; den bliver ikke
  linket til der, hvor forfatteren tilfældigvis havde den liggende.
- Arkivet ligger ved siden af databasen, ikke inde i den. De to følges ad, når
  projektet flyttes, og en database bliver ikke til et sted at gemme megabytes.
- Bytene ligger uden for ændringsloggen. Fortryd henter rækken tilbage og lader
  filen ligge; at slette en fil er en handling for sig, for `rm` har ingen
  fortrydelse, og programmet skal ikke lade som om.
- At kopiere og hashe bytes er ikke at læse dem. Reglen «en kilde gemmes og
  vises, aldrig læses» står uændret.
- Typen kommer fra navnet, aldrig fra indholdet. Og det, der kan køre kode,
  bliver hentet ned frem for vist — «vises sikkert» gælder kun, hvor det passer.
- CSP'en fik ikke `sandbox`. Direktivet gjorde enhver PDF til en tvungen
  nedhentning, og en fil, der kun kan hentes ned, er ikke vist. Resten af
  politikken står; indlejringslisten rummer ingen type, der kan køre kode.
- Den billige prøve er en regel, den grundige bliver bedt om. En gennemgang, der
  hashede hele arkivet hver gang, ville blive slukket inden for en uge.
- En oversigt bruger reglen, ikke en kopi af den. `dangling_setup` køres og
  filtreres; den bliver ikke skrevet om til panelet.
- En person går igen, når hun er i mere end ét bind. Ét bind er ikke «igen».
- Grebet måler på to akser. Bogens egen, når spørgsmålet er «hvor i bogen»;
  seriens, når spørgsmålet er «hvor lang tid gik der».
- Et scenenummer gælder inden i sit bind. Står scenen i et andet bind, skal
  bindet stå der; et gennemløbende serienummer kunne ingen slå op.
- En tråd begynder ét sted og når et andet. `work_id` er hjemstavnen, `scope`
  er rækkevidden, og alt, der spørger hvad tråden dækker, spørger rækkevidden.
- Et uskrevet slag har ingen plads i læserækkefølgen. Et manuelt `position`-tal
  er en sortering inden i tråden, ikke en påstand om, hvor i bogen det ligger.
- En løs ende i en serietråd er seriens sag og vises fra alle dens bind.
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

- 313/313 prøver er grønne.
- Typecheck og produktionsbuild er rene. Vite gentager den kendte advarsel om
  en JavaScript-chunk over 500 kB; det er ikke en buildfejl.
- Migration 0007 er prøvet mod en kopi af den eksisterende database. Prøven
  fandt og rettede migrationsjournalens fremskudte tidsstempler.
- Migration 0009 er prøvet mod en kopi af den rigtige `fabula.db`: ni tråde, 23
  slag, 294 arbejdsreferencer og alt andet står uændret, og hver tråd har fået
  `work`. Journalens tidsstempel er 1790000005000; migrationerne køres i
  tidsstempelorden, ikke i journalens indeksorden.
- Browserprøvet på en kopi af den rigtige database: en rettelse i «Vandet står
  ind» giver margennoten mærket «tidligere version», og Gennemgangen skifter fra
  «ingen af scenerne er skrevet om siden» til «1 af scenerne».
- Browserprøven er grøn. Forslagmenuens placering er også kontrolleret visuelt
  i den smalle trekolonnevisning.
- Browserprøvet på den rigtige `fabula.db`: «Knyt her» flyttede P6 Mads Krag fra
  «nævnt uden omtale» op i ankrene uden at ændre ordtallet, og «Marie Krag» blev
  oprettet som genstand, fik G2 og blev knyttet i næste klik.
- `vis_navne_uden_kobling` på hele serien melder seks scener og ingen støj.
- Browserprøvet på den rigtige `fabula.db`: Serien viser de to bind side om
  side, «P5 Karen Krag · Saltet · Tidevandet» som den eneste gennemgående, de
  tre tråde med hver sin rækkevidde, «Ingen. Hvert setup i serien har noget
  efter sig», og de ti afsløringer i læserækkefølge med «læseren har det med
  fra «Saltet»» på dem i bind to. Skiftes verden til Memento, siger visningen,
  at bogen ikke hører til en serie. Ingen fejl i konsollen.
- Browserprøvet på den rigtige `fabula.db`: Kontinuitet viser «Gælden · hele
  serien» med bindets titel på hvert slag i læserækkefølge, gennemgangen melder
  ingen hængende setups, og Grebet skriver «Der går 14 scener fra det første
  setup til den sidste indfrielse — fra «Saltet» til «Tidevandet»» med chippen
  «6. Jens siger det». Bindtitlen står kun på scener fra et andet bind — «1.
  Sundvej, september · Saltet» — hvilket er hele pointen med to akser. Ingen
  fejl i konsollen.
- Browserprøvet på en kopi af den rigtige database: et anker fra «Sundvej,
  september» til «Marie Krag går ned» giver bemærkningen «Omtale før sin tid» i
  Gennemgangen med Læg til side-knappen, som alle andre fund.
- Migration 0010 lægger `original_name` og `checksum` på `source` som to
  `ADD COLUMN`. Journalens tidsstempel er 1790000006000.
- Browserprøvet på den rigtige `fabula.db`: Kilder-fanen viser «FIL I ARKIVET ·
  kajen-1951.png · image/png · 88 B» og protokollen på 925 B, «Tjek filerne»
  svarer «2 filer prøvet, 2 uændrede», og en fil, der fjernes bag om
  programmet, giver chippen «FILEN MANGLER» og bemærkningen «Kilden «Vejrarkiv
  for Kattegat, november 1893» peger på filen …, som ikke ligger i arkivet
  længere» i gennemgangen. Fortryd tog vedhæftningen tilbage. Ingen fejl i
  konsollen.
- `GET /api/fil/:id` svarer med `content-type` fra det gemte navn,
  `content-disposition: inline` for PDF og PNG, `nosniff` og politikken uden
  `sandbox`. PNG'en vises i browserruden; se den åbne risiko om PDF.
- Prøvecasens to filer er rigtige: `file` genkender dem, `sips` læser PNG'ens
  4×4, og PDF'en tegner sin side i en miniature med teksten i.
- DOCX'en er læst tilbage af Apples egen `textutil`, som åbner filen og skriver
  hele bogen ud igen. Formatet er altså ikke bare vores egen antagelse om ZIP.
- Roundtrip på den rigtige `fabula.db`: 2855 rækker i 45 tabeller, fire verdener
  og to filer pakket, hentet ind i en frisk database — den samme bog eksporteret
  igen er ord for ord identisk, vedhæftningerne er byte for byte de samme, og
  historikken kom med som historik. Prøven `src/test/backup.test.ts` gør det
  samme i det små ved hver kørsel.
- MCP end-to-end: `eksporter_bog` skrev bogen, `lav_backup` pakkede arkivet,
  `se_backup` afviste korrekt at hente ind i en database, der ikke var tom, og
  `genopret_backup` hentede 2849 rækker i 45 tabeller og 2 filer ind i en tom.
- Browserprøvet: læseudgaven hentes ned med den rigtige besked («9 kapitler, 16
  af 16 scener, 963 ord»), forhåndsoversigten viser de fire verdener og siger
  «Kan ikke hentes ind her» i en database med arbejde i — og en genoprettelse
  gennem interfacet i en tom database ender med forsiden på «Havnen / Du
  arbejder på Saltet» og den oprindelige historik. Ingen fejl i konsollen.

## Historisk: planen for fase 15

Fase 15 er afsluttet ovenfor. Dens oprindelige dækning og beslutninger står i
`docs/ROADMAP.md`; fase 16 er næste konkrete arbejde.

## Åbne risici

- PDF'ens visning på stedet er ikke prøvet i en rigtig browser. Den indbyggede
  browserrude i værktøjet henter altid en PDF ned i stedet for at vise den, og
  Chrome-forbindelsen var ikke tilgængelig. Billeder er prøvet og vises. Går en
  PDF stadig i nedhentning i en almindelig browser, er det næste sted at se
  `content-security-policy` på `GET /api/fil/:sourceId`.
- En fil, der er slettet fra arkivet, kommer ikke igen af sig selv. Fortryd
  henter henvisningen tilbage, og så melder reglen den manglende fil — det er
  med vilje synligt frem for tavst.
- Prøvecasene indlæses altid i en tom database. Der er ingen vej til at hente
  nye eksempler ind i en database, man selv har arbejdet i, uden at få
  verdenerne dobbelt. Det var præcis den fælde, efterslættet ovenfor faldt i.
- Ældre ProseMirror-mærker uden kode kan stadig findes i en database, der er
  ældre end omtale-turen. Det er bagudkompatibelt: `text_anchor` leverer målet
  i sidepanelet, og ankret kan fortsat åbnes derfra.
- Identiteter åbner ejerens personkort, mens afsløringer åbner
  alternativvisningen. Egne detailkort til de to typer hører til fase 16.
