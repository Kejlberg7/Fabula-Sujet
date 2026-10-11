# Glossary

The implementation is English internally and Danish on the user-facing surface. This file is the source of truth for that mapping. Do not invent a term ad hoc; add it here first.

The rule applies in both directions: an English UI label is a bug, and a Danish table or field name is also a bug.

## Domain model

| Danish (UI and MCP) | English (code) | Meaning |
|---|---|---|
| Verden | `world` | The universe. Owns realms, people, laws, and chronology. |
| Tidssystem | `time_system` | How time is counted; Gregorian is currently the only implemented system. |
| Lag | `realm` | A world within a world: reality, dream, simulation, or alternate timeline. |
| Serie | `series` | Optional grouping of books. |
| Rejseforbindelse | `place_link` | Edge in the place graph, with travel time per mode of transport. |
| Entitet | `entity` | Person, place, object, organization, or concept. |
| Identitet | `identity` | A name or persona an entity appears under. |
| Ben | `entity_leg` | A span of an entity's personal time. |
| Tilstedeværelse | `presence` | Which leg was where, in which realm, and when. |
| Besiddelse | `possession` | Who carries what, and when. |
| Tilstand | `entity_state` | An entity's value in a user-defined category over time. |
| Relation | `relationship` | A relationship between two entities, valid over an interval. |
| Forsvinding | `disappearance` | An event where someone disappears and may return. |
| Event | `event` | Something that happened. Has an interval and precision, not a single timestamp. |
| Blotlægning | `event_fact` | Facts an event reveals, and which of their slots. |
| Deltagelse | `participation` | Who took part, in which leg and role. |
| Tidsbånd | `temporal_link` | “B happens three days after A,” on world time or personal time. |
| Faktum | `fact` | A claim with slots, true within a realm. |
| Plads | `fact_slot` | A slot in a fact, such as culprit, victim, or time. |
| Binding | `binding` | A filled slot used by truth, a belief, statement, carrier, or reveal. |
| Overbevisning | `belief` | What someone thinks they know, indexed to **personal** time. |
| Hukommelsesregel | `memory_policy` | How long experienced knowledge is retained from a point in personal time. |
| Udsagn | `statement` | What someone says to someone else, whether true or not. |
| Vidensbærer | `carrier` | A fact recorded in an object, such as a Polaroid, tattoo, or letter. |
| Lov | `law` | An ability (exception) or prohibition, hard or soft. |
| Kilde | `source` | Research: note, link, PDF, article, image, or file. |
| Projektarkiv | `fabula-filer/` | Folder beside the database where attachments are copied. |
| Vedhæftet fil | `attachment` | A source file in the archive: original name, type, size, and checksum. |
| Kontrolsum | `checksum` | SHA-256 of stored bytes; detects whether the file has changed. |
| Forældreløs fil | `orphan file` | A file in the archive that no source points to. |
| Kildehenvisning | `source_link` | What a source supports, contextualizes, or may contradict. |
| Gren | `branch` | A story line with a parent branch and fork point. |
| Værk | `work` | A book. |
| Del | `part` | A part within a work. |
| Kapitel | `chapter` | A chapter. |
| Scene | `scene` | A scene with a viewpoint and narration mode. |
| Scenetekst | `scene_text` | Prose stored as ProseMirror JSON and Markdown. |
| Scene ↔ event | `scene_event` | Which events a scene tells, and how. |
| Afsløring | `reveal` | When the **reader** learns something. |
| Tekstanker | `text_anchor` | A span of prose linked to what it expresses. |
| Tekstankerets brug | `text_anchor.use` | `mentioned`, `depicted`, `held`, or `state`; a mention never implies presence. |
| Arbejdsreference | `story_reference` | Stable short ID such as P1, G1, or E4 for a bible target. |
| Tråd | `thread` | A plotline. It begins in one book and reaches as far as its scope allows. |
| Rækkevidde | `thread.scope` | How far a thread reaches: `work`, `series`, or `world`. |
| Læseorden | `readingOrder` | Series → book → chapter → scene in one ascending order. |
| Serieoversigt | `seriesOverview` | Series view of volumes, recurring characters, threads, reveals, and unresolved setups. |
| Slag | `beat` | A setup, complication, or payoff within a thread. |
| Bruger | `app_user` | Application user. |
| Arbejdssted | `app_state` | The currently selected world, book, and branch. |
| Den, der arbejder | `current_user` | Single row identifying the current author. |
| Tur | `turn` | One conversational or UI action; changes are grouped by turn. |
| Ændring | `change` | One write, with its inverse. |
| Nedslag | `checkpoint` | Named point to roll back to or branch from. |
| Fund | `finding` | A possible continuity issue reported by the engine. |
| Afvisning | `dismissal` | “This is intentional”—permanent and accompanied by a reason. |
| Forslag | `suggestion` | Manuscript-review comment; applied only by the author. |
| Gennemlæsning | `review_run` | A review of a scene, chapter, book, or series tied to the versions it read. |
| Gennemlæst scene | `review_scene` | A scene as observed in one review, identified by `text_id`. |
| Navn uden kobling | `prose gap` | A name in prose not linked to a bible record in that scene. |
| Ingen post svarer til navnet | `unknown name` | A prose name unknown to the bible. |
| Kildehylde | `sourceShelf` | Research inventory and what each source supports. |
| Læseudgave | `readingEdition` | Reader-facing book text without working IDs or anchor marks. |
| Appendiks | `appendix` | Optional people, places, timeline, and sources after the story. |
| Eksportmappe | `fabula-eksport/` | Folder beside the database for exports and backups. |
| Backup | `backup` | Every row from every table, versioned; ZIP includes archive files, JSON does not. |
| Skemastempel | `schemaStamp` | Fingerprint of applied migrations; checks backup compatibility. |
| Forhåndsoversigt | `inspectBackup` | Inspects a backup without touching the database. |
| Genoprettelse | `restoreBackup` | Restores a backup into an empty database; never overwrites existing work. |

## Rule codes

The code is stored in `finding.rule_code`; a hard `law` lifts a rule by referencing that same code. A broken law appears as the rule it belongs to, rather than receiving its own code. The phase column records when a rule was introduced; ✓ means it is active.

Every rule proves impossibility before reporting. An uncertain date may be placed anywhere within its interval; if any placement is consistent, there is no contradiction—the author has not decided yet.

| Code | Danish display name | Phase |
|---|---|---:|
| `bilocation` | Bilokation — same person, leg, and realm in two places | 3 ✓ |
| `impossible_chronology` | Umulig kronologi — empty interval or personal-time cycle | 3 ✓ |
| `life_span` | Liv og alder | 3 ✓ |
| `knowledge_gap` | Vidensbrud — acts on a slot not bound in their knowledge | 3 ✓ |
| `missing_carrier` | Bæreren mangler | 3 ✓ |
| `travel_time` | Rejsetid — hard limit, lifted only by an ability | 3 ✓ |
| `realm_leak` | Lagbrud — scene dramatizes an event in another realm | 4 ✓ |
| `self_meeting_leak` | Selvmøde-lækage — missing POV leg at a meeting with oneself | 4 ✓ |
| `pov_leak` | POV-lækage | 4 ✓ |
| `reveal_order` | Afsløringsrækkefølge | 4 ✓ |
| `object_continuity` | Genstandskontinuitet | 5 ✓ |
| `relationship_state` | Relationstilstand | 5 ✓ |
| `dangling_setup` | Hængende setup | 5 ✓ |
| `name_or_identity` | Navn og identitet | 5 ✓ |
| `disappearance` | Forsvinding | 5 ✓ |
| `source_conflict` | Modstrid med kilde — author-marked only; file is not read | 5 ✓ |
| `mention_ahead_of_time` | Omtale før sin tid — anchored narration points to a future event | 10 ✓ |
| `mention_name_not_yet` | Navn uden for sin tid — prose uses an identity outside its validity | 10 ✓ |
| `mention_reader_ahead` | Omtale før læseren ved det — prose points to a fact not yet revealed | 10 ✓ |
| `depicted_person_elsewhere` | Person vist et andet sted — only with exact time and a known life-leg | 15 ✓ |
| `prose_object_claim` | Genstandspåstand i prosaen — explicit holder or state conflicts with the bible | 15 ✓ |
| `unanchored_realm` | Ufæstnet lag — realm not anchored to world time | 3 ✓ |
| `attachment_missing` | Fil væk fra arkivet — source file is missing or its size changed | 12 ✓ |

## Enum values

Model enums are English in storage and Danish in the UI. Their translations live in `src/core/words.ts`; both surfaces read from there to avoid diverging labels.

| Field | English value(s) | Danish display value(s) |
|---|---|---|
| `reveal.strength` | `hinted` · `implied` · `stated` · `confirmed` | vink · antydet · fortalt · bekræftet |
| `belief.strength` | `knows` · `convinced` · `suspects` · `mistaken` · `denies` · `unaware` | ved · overbevist · mistænker · tror fejlagtigt · benægter · uvidende |
| `belief.source` | `stated` · `derived` · `carried` | nedskrevet · var til stede · bærer det på sig |
| `scene_event.mode` | `dramatised` · `mentioned` · `implied` | dramatiseret · omtalt · antydet |
| `source.kind` | `note` · `link` · `pdf` · `article` · `image` · `file` | note · link · PDF · artikel · billede · fil |
| `fact.truth` | `true` · `false` · `disputed` · `undecided` | sand · falsk · omstridt · uafgjort |
| `entity.kind` | `person` · `place` · `object` · `organisation` · `concept` | person · sted · genstand · organisation · begreb |
| `event.precision` | `minute` · `hour` · `day` · `month` · `year` · `unknown` | minut · time · dag · måned · år · ukendt |
| `law.kind` | `ability` · `prohibition` | evne · forbud |
| `law.hardness` | `hard` · `soft` | hård · blød |
| `law.scope_kind` | `world` · `series` · `work` · `realm` | verden · serie · bog · lag |
| `law.subject_kind` | `everyone` · `entity` · `entity_kind` · `carrier_holder` | alle · person eller ting · slags · den, der bærer genstanden |
| `temporal_link.kind` | `before` · `after` · `same_time` · `offset` · `during` | før · efter · samtidig · afstand · under |
| `temporal_link.axis` | `world` · `personal` | verdenstid · personlig tid |
| `thread.scope` | `work` · `series` · `world` | bog · serie · verden |
| Export appendix sections | `people` · `places` · `timeline` · `sources` | personer · steder · tidslinje · kilder |

“Antydet” maps to `implied` only. A brief hint is `hinted`, displayed as “vink.” Appendix sections are not stored enum values; they are Danish options in the export interface and are translated in `src/mcp/tools/export.ts`.

## MCP surface

The MCP surface has 88 tools. Tool names and arguments are Danish because the author communicates with them; implementation details remain English. Enum arguments use the model's English values above, which are generated by the model rather than typed by the author.

Two operations can write prose, and both ask for approval: `gem_scenetekst` asks the author each time; `overfoer_forskel` asks when the selected difference contains prose. Both proceed only after approval. All other changes can be undone; prose is not the program's to alter without consent.

| Group | Tools |
|---|---|
| Context | `opret_verden` · `saet_aktivt_vaerk` · `hent_kontekst` |
| World | `opret_lag` · `opret_serie` · `opret_vaerk` |
| Entities | `opret_entitet` · `opret_identitet` · `opret_ben` · `registrer_hukommelse` · `registrer_tilstedevaerelse` · `registrer_besiddelse` · `registrer_tilstand` · `opret_relation` · `registrer_forsvinding` · `opret_rejseforbindelse` · `flet_entiteter` |
| Events | `opret_event` · `tilfoej_tidsbaand` · `tilfoej_deltager` · `knyt_event_til_faktum` |
| Knowledge | `registrer_faktum` · `registrer_overbevisning` · `registrer_udsagn` · `knyt_faktum_til_baerer` |
| Laws and sources | `opret_lov` · `opret_kilde` · `knyt_kilde` · `vis_kilder` · `vedhaeft_fil` · `fjern_fil` · `tjek_vedhaeftninger` |
| Narrative | `opret_plottraad` · `tilfoej_slag` · `opret_kapitel` · `opret_scene` · `knyt_scene_til_event` · `opret_afsloering` · `gem_scenetekst` · `vis_kapitler` · `saet_tekstanker` · `vis_skrivebord` · `vis_baand` |
| Edit and remove | `opdater` · `slet` · `fortryd` · `gentag` · `saet_nedslag` · `rul_tilbage_til` · `historik` · `vis_aendringer` |
| Queries | `vis_serieoversigt` · `vis_referencer` · `vis_omtaler` · `hvem_vidste_hvad` · `hvem_var_hvor` · `hvad_ved_laeseren` · `vis_verdenslinje` · `find` · `koer_tidsloesning` |
| Review | `koer_gennemgang` · `vis_fund` · `afvis_fund` · `genaabn_fund` · `vis_regler` · `vis_scene_til_gennemgang` · `tilfoej_margennote` · `vis_margennoter` · `afgoer_margennote` |
| Read-through | `start_gennemlaesning` · `afslut_gennemlaesning` · `vis_gennemlaesninger` |
| Unlinked names | `vis_navne_uden_kobling` |
| Branches | `vis_grene` · `opret_gren` · `sammenlign_grene` · `overfoer_forskel` · `vaelg_hovedgren` · `arkiver_gren` · `genaabn_gren` · `flyt_scene` · `flyt_afsloering` |
| Dramaturgy | `vurder_afsloeringer` · `sammenlign_afsloeringer` |
| Export | `eksporter_bog` · `lav_backup` · `se_backup` · `genopret_backup` |

`opdater` and `slet` accept an English table name from the model above. Creation is typed by record kind because the fields differ; an update means “this record, these fields.”
