# Ordbog

Koden er engelsk indeni, dansk udenpå. Det her er den eneste sandhed om
oversættelsen. Opfind aldrig en ny på stedet — tilføj den her først.

Reglen gælder begge veje: et engelsk navn i en UI-label er en fejl, og et dansk
navn i en tabel eller et felt er også en fejl.

## Modellen

| Dansk (UI og MCP) | Engelsk (kode) | Hvad det er |
|---|---|---|
| Verden | `world` | Universet. Ejer lag, personer, love og kronologi |
| Tidssystem | `time_system` | Hvordan tid tælles. Gregoriansk er den eneste indtil videre |
| Lag | `realm` | Verden inden i verden: virkelighed, drøm, simulation, sidetidslinje |
| Serie | `series` | Valgfri gruppering af bøger |
| Rejseforbindelse | `place_link` | Kant i stedgrafen, med rejsetid per transportmåde |
| Entitet | `entity` | Person, sted, genstand, organisation, begreb |
| Identitet | `identity` | Et navn eller en skikkelse en entitet optræder under |
| Ben | `entity_leg` | Et afsnit af en entitets egen tid |
| Tilstedeværelse | `presence` | Hvilket ben var hvor, i hvilket lag, hvornår |
| Besiddelse | `possession` | Hvem bærer hvad, hvornår |
| Tilstand | `entity_state` | En entitets værdi i en brugerdefineret kategori gennem et tidsrum |
| Relation | `relationship` | Forhold mellem to entiteter, gyldigt i et interval |
| Forsvinding | `disappearance` | Et event hvor nogen forsvinder og eventuelt vender tilbage |
| Event | `event` | Noget der skete. Har interval og præcision, ikke et tidspunkt |
| Blotlægning | `event_fact` | Hvilke fakta et event lægger på bordet, og hvilke pladser af dem |
| Deltagelse | `participation` | Hvem deltog, i hvilket ben, i hvilken rolle |
| Tidsbånd | `temporal_link` | «B sker tre dage efter A». Læses på verdens tid eller personlig tid |
| Faktum | `fact` | Påstand med pladser, sand i et lag |
| Plads | `fact_slot` | En plads i et faktum: gerningsmand, offer, tid |
| Binding | `binding` | En udfyldt plads — bruges af sandheden, en overbevisning, et udsagn, en bærer og en afsløring |
| Overbevisning | `belief` | Hvad nogen mener at vide, indekseret på **personlig** tid |
| Hukommelsesregel | `memory_policy` | Hvor længe oplevet viden fastholdes fra et tidspunkt i personlig tid |
| Udsagn | `statement` | Hvad nogen siger, til hvem, sandt eller ej |
| Vidensbærer | `carrier` | Et faktum skrevet ned i en genstand: polaroid, tatovering, brev |
| Lov | `law` | Evne (undtagelse) eller påbud (forbud), hård eller blød |
| Kilde | `source` | Research: note, link, PDF, artikel, billede |
| Kildehenvisning | `source_link` | Hvad kilden understøtter, giver kontekst til eller muligvis modsiger |
| Gren | `branch` | Udviklingslinje. Forældregren plus forgreningspunkt |
| Værk | `work` | Bogen |
| Del | `part` | |
| Kapitel | `chapter` | |
| Scene | `scene` | Med POV og fortælleform |
| Scenetekst | `scene_text` | Prosaen, som ProseMirror-JSON plus markdown |
| Scene ↔ event | `scene_event` | Hvilke events en scene fortæller, og hvordan |
| Afsløring | `reveal` | Hvornår **læseren** får noget at vide |
| Tekstanker | `text_anchor` | Et stykke prosa bundet til det, det udtrykker |
| Tråd | `thread` | Plotlinje |
| Slag | `beat` | Setup, komplikation eller payoff i en tråd |
| Bruger | `app_user` | |
| Arbejdssted | `app_state` | Hvilken verden, bog og gren der er valgt lige nu |
| Tur | `turn` | Én samtaletur eller én handling i UI'et. Ændringer grupperes herefter |
| Ændring | `change` | Én skrivning, med sin modsatte |
| Nedslag | `checkpoint` | Navngivet punkt at rulle tilbage til eller forgrene fra |
| Fund | `finding` | Noget konsistensmotoren mener er galt |
| Afvisning | `dismissal` | «Det er meningen — han lyver.» Permanent, med begrundelse |
| Forslag | `suggestion` | Kommentar fra manuskriptgennemgangen. Anvendes aldrig af sig selv |

## Regelkoder

Koden står i `finding.rule_code`, og en `law` med `hardness = 'hard'` peger på
den samme kode, når den løfter reglen. Fase-tallet er, hvornår reglen bygges;
✓ betyder, at den kører.

Alle reglerne beviser umulighed, før de siger noget. En uskarp dato kan lægges
hvor som helst i sit spillerum, og findes der bare én placering, der går op, er
der ikke noget galt — så har forfatteren bare ikke besluttet sig endnu.

| Kode | Dansk navn | Fase |
|---|---|---|
| `bilocation` | Bilokation — samme person, ben og lag, to steder | 3 ✓ |
| `impossible_chronology` | Umulig kronologi — tomt interval, eller cyklus i personlig tid | 3 ✓ |
| `life_span` | Liv og alder | 3 ✓ |
| `knowledge_gap` | Vidensbrud — handler på en plads, hun ikke har bundet | 3 ✓ |
| `missing_carrier` | Bæreren mangler | 3 ✓ |
| `travel_time` | Rejsetid — hård grænse, kun en evne løfter den | 3 ✓ |
| `law_violation` | Lovbrud — bløde fritekstlove vurderes af AI og bliver til margennoter | 4 AI/margen ✓ |
| `realm_leak` | Lagbrud — en scene dramatiserer et event i et andet lag | 4 ✓ |
| `self_meeting_leak` | Selvmøde-lækage — manglende POV-ben ved mødet med sig selv | 4 ✓ |
| `pov_leak` | POV-lækage | 4 ✓ |
| `reveal_order` | Afsløringsrækkefølge | 4 ✓ |
| `object_continuity` | Genstandskontinuitet | 5 ✓ |
| `relationship_state` | Relationstilstand | 5 ✓ |
| `dangling_setup` | Hængende setup | 5 ✓ |
| `name_or_identity` | Navn og identitet | 5 ✓ |
| `disappearance` | Forsvinding | 5 ✓ |
| `source_conflict` | Modstrid med kilde — kun forfatterens markering, filen læses ikke | 5 ✓ |

## MCP-fladen

62 værktøjer. Navnene og argumenterne er danske, fordi du skal tale til dem.
Alt indenfor er engelsk.

| Gruppe | Værktøj |
|---|---|
| Kontekst | `opret_verden` · `saet_aktivt_vaerk` · `hent_kontekst` |
| Verden | `opret_lag` · `opret_serie` · `opret_vaerk` |
| Entiteter | `opret_entitet` · `opret_identitet` · `opret_ben` · `registrer_hukommelse` · `registrer_tilstedevaerelse` · `registrer_besiddelse` · `registrer_tilstand` · `opret_relation` · `registrer_forsvinding` · `opret_rejseforbindelse` · `flet_entiteter` |
| Events | `opret_event` · `tilfoej_tidsbaand` · `tilfoej_deltager` · `knyt_event_til_faktum` |
| Viden | `registrer_faktum` · `registrer_overbevisning` · `registrer_udsagn` · `knyt_faktum_til_baerer` |
| Love og kilder | `opret_lov` · `opret_kilde` · `knyt_kilde` |
| Fortælling | `opret_plottraad` · `tilfoej_slag` · `opret_kapitel` · `opret_scene` · `knyt_scene_til_event` · `opret_afsloering` · `gem_scenetekst` · `vis_kapitler` · `saet_tekstanker` · `vis_skrivebord` · `vis_baand` |
| Ret og fjern | `opdater` · `slet` · `fortryd` · `gentag` · `saet_nedslag` · `rul_tilbage_til` · `historik` · `vis_aendringer` |
| Spørg | `hvem_vidste_hvad` · `hvem_var_hvor` · `hvad_ved_laeseren` · `vis_verdenslinje` · `find` · `koer_tidsloesning` |
| Gennemgang | `koer_gennemgang` · `vis_fund` · `afvis_fund` · `genaabn_fund` · `vis_regler` · `vis_scene_til_gennemgang` · `tilfoej_margennote` · `vis_margennoter` · `afgoer_margennote` |

`opdater` og `slet` tager et engelsk tabelnavn fra listen ovenfor. Oprettelse er
typet per slags, fordi felterne er vidt forskellige, når noget skabes — mens en
rettelse altid er «denne række, disse felter».
