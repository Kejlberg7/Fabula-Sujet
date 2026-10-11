# Fabula & Sujet

A story bible and manuscript workbench for keeping a multi-book story coherent—and writing it. The model is built around one distinction: **when things happened** and **when they are told**.

## Status

**Phases 0–16 are complete.** The app includes the data model, temporal solver, change log, MCP server, Danish-language UI, writing desk, continuity checks, manuscript review, branching, and export/backup. The original personal-use vision is implemented; phase 17 contains deliberately deferred extensions.

```bash
npm install
npm test                              # 325 tests
npm run fixtures -- ./fabula.db       # load the four sample stories
npm run build && npm run dev          # UI at http://localhost:4173
npm run ask -- ./fabula.db hent_kontekst
```

Requires Node 20 (`.nvmrc`).

## What the app does

The UI and MCP server share the same database, active context, and domain services. If Claude switches books, the UI follows; edits made in the UI and through MCP appear in the same history.

| View | Purpose |
|---|---|
| Overview | See how much story data exists and what changed recently. |
| Timeline | Explore chronological lanes; focus on the densest interval, zoom, pan, or jump with the overview strip. |
| People, Places, Things | Browse entities and inspect identity legs, presence, and character knowledge. |
| Events | Review events and how precisely their time is known. |
| Facts & Laws | Create and edit facts, beliefs, statements, carried knowledge, and world rules. |
| Continuity | Manage relationships, identities, presence, travel, possessions, states, plot threads, and sources. |
| Series | View books, recurring characters, cross-book plot threads, and unresolved setups. |
| Chapters | Read in narrative order, with each event's chronological position alongside it. |
| Band | Compare the two axes: story chronology and narrative order. |
| Writing Desk | Edit the manuscript with character knowledge and reader knowledge beside it. |
| Dramaturgy | Inspect how revelations work across eight evidence-based dimensions. |
| Alternatives | Compare branches, move scenes and reveals, and inspect differences and conflicts. |
| Review | Inspect continuity findings and dismissed findings with their reasons. |
| History | See who changed what and roll back to a previous point. |
| Export | Create a clean Markdown/DOCX reading edition, or back up and restore a project. |

Edits save automatically and can be undone. There is no Save button because every edit is already recorded.

## Writing and references

The manuscript is edited in the center of the Writing Desk. A side panel answers two questions: **what does this viewpoint character know now**, and **what does the reader know now**? Their difference is dramatic irony. A direct disclosure that the viewpoint character cannot know is flagged; a hint remains valid foreshadowing.

All 58 scenes across the four sample stories contain original short prose, so the desk can be tested as a book read scene by scene rather than as empty placeholders.

Type `@` followed by a stable story reference or a name—for example, `@G1`—to link prose to a person, identity, place, object, organization, concept, event, fact, reveal, scene, or plot thread. The prose displays the natural name while the stable ID is kept in a text anchor. Click a mention to open its card; backlinks take you to the exact passage. Existing text can also be selected and linked. Anchors attach to document marks, not character offsets, so they survive edits.

The reference ID is an authoring aid, not part of the book text. Renaming a target never rewrites the author's prose; deleting a target leaves a visibly broken reference. IDs remain stable through renames, undo, and branches.

**The prose belongs to the author.** The editor saves what the author writes and retains earlier versions. If Claude asks to write prose, the author is shown both the old and proposed text and must explicitly approve each write. Review notes and suggested wording are inert until the author applies them in the editor.

The Margin view collects notes about continuity, narrative, pacing, and research. A note can include suggested wording, but even marking a note as addressed never changes the manuscript.

## Time, knowledge, and continuity

Character knowledge is evaluated on that character's personal timeline, not just the world's clock. This supports time travel and multiple identity legs: the same evening can produce different knowledge for two incarnations of one person.

The review engine reports only contradictions that cannot be arranged otherwise. An uncertain date may fall anywhere in its interval; if at least one consistent placement exists, the app does not claim a contradiction. Built-in checks include:

- Two places at once, travel time, lifespan and age, impossible chronology, and knowledge gaps.
- Missing knowledge carriers, realm leaks, self-meeting and viewpoint leaks, and reveal order.
- Object continuity, relationship state, dangling setups, names and identities, disappearances, and conflicts explicitly marked against sources.
- Manuscript references that appear before their event, use an invalid identity, reveal facts before the reader knows them, or make explicit claims about a person's location or an object's holder/state that contradict the bible.
- Missing or changed files in the project archive.

An uncertain date is not forced to a point. If a finding is actually allowed by a world's rules, add a law tied to the relevant rule code; the rule engine consults laws before reporting. One-off exceptions can be dismissed with a reason, so the history of that decision stays visible.

Soft world laws are free text and are not presented as machine-understood. During manuscript review, an AI receives the scene together with applicable laws, viewpoint knowledge, reader knowledge, and source metadata. Potential violations are suggestions in the margin, not confident engine findings.

Research sources can be notes, links, PDFs, articles, images, or other files. The app stores and displays them but does **not** OCR, extract, or interpret their contents. The author marks whether a source supports, contextualizes, or may contradict a claim. Attachments are copied into a project archive beside the database and checked for missing or changed bytes.

## Branches and dramaturgy

A branch is a complete, independent version of a story, not a filter or hidden undo. Start one from any history point; the original remains unchanged. Compare branches across scenes, reveals, prose, entities, events, time, facts, laws, relationships, and plot threads. Conflicts are visible; no silent merge occurs. A single selected difference can be transferred as one undoable action. Prose becomes a new version so the old text remains available.

Dramaturgy is not a numeric score. It examines a reveal across surprise, fairness, hindsight, timing, consequence, misdirection, setup, and information control. Each reading points to the scenes that support it and stays silent when there is not enough information. Branch comparison can show how changing reveal order affects these dimensions.

## Series and exports

Plot threads can span one book, a series, or a world. Reading order is series → book → chapter → scene. Reader knowledge carries from earlier books in the same series, but not from another series in the same world. The series overview brings together recurring characters, threads, unresolved setups, and reveals in reader order.

Markdown and DOCX exports are generated from the same neutral manuscript representation. Reading editions include the author's words and omit internal IDs, anchors, notes, and findings. An optional appendix can include the people, places, timeline, and sources that the exported book actually introduces. Backups include every database row and, in ZIP form, archived attachments. Restore is permitted only into an empty database with a compatible schema.

## Connecting Claude

```bash
claude mcp add fabula -- npx -y tsx /Users/kejlberg/Fabula-Sujet/src/mcp/server.ts
```

Set `FS_DATABASE_URL` to use a database other than `./fabula.db`. MCP tool names and the UI are Danish; internal identifiers and code are English. The server includes tools for creating, reading, editing, deleting, undoing, branching, reviewing, and exporting story data. Prose writes always require the author's approval.

## Sample stories

| Story | What it tests | Included material |
|---|---|---|
| **Memento** | Narrative order vs. chronology; knowledge that fades | 10 chapters, 22 prose scenes, 1,034 words; 18 described people/places/objects and 20 events across two years. |
| **Predestination** | Personal time, self-meetings, multiple identities | 5 chapters, 10 prose scenes, 480 words; four life-legs, told from three of them. |
| **Inception** | Nested realms, each with its own clock | 4 chapters, 10 prose scenes, 504 words; 13 described entities across four realms. |
| **Harbor (Havnen)** | A series spanning two books, 60 years, and three generations | *The Salt* (9 scenes, 541 words) and *The Tide* (7 scenes, 422 words). |

The samples are loaded into an empty database. `npm run fixtures` creates their worlds from scratch; do not run it against a database that already contains them unless duplicates are intended.

## Language and project structure

The implementation is English internally; the UI and MCP surface are Danish. `docs/GLOSSARY.md` is the source of truth for this mapping. Add new terms there before using them.

```text
src/db/schema/     database schema
src/core/          change log, workbench, time, services, queries, rules, export
src/mcp/           Danish-named MCP tools
src/server/        typed API and HTTP server
src/fixtures/      the four sample stories
web/               React interface and custom CSS
docs/GLOSSARY.md   Danish UI/MCP vocabulary and English model terms
docs/ROADMAP.md    agreed phases and deferred extensions
docs/STATUS.md     current hand-off and verification status
```

## Deferred extensions

The model is designed not to block future work, but these are not implemented: invented calendars and relativistic time, more advanced parallel universes, concurrent users and permissions, or public hosting/product operations. See [`docs/ROADMAP.md`](docs/ROADMAP.md).
