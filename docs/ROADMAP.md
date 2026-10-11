# Continuation Roadmap

Phases 0–8 completed the original plan. This continuation keeps the agreed phase numbering. Phases 9–16 complete the personal-use vision; phase 17 keeps deliberately deferred extensions open.

## Rules for every phase

- English internally, Danish on the user-facing surface.
- The UI and MCP use the same domain services.
- All user changes go through the change log and can be undone.
- Prose is never written without the author's explicit approval for each write. A suggested edit is applied only by a visible editor action; direct MCP prose writes ask the author and proceed only after approval.
- Sources are stored and displayed, never interpreted by machine.
- Existing databases migrate without data loss.
- Sample stories grow when a feature needs realistic data.
- Typecheck, tests, build, and browser verification must pass before a phase closes.
- Update `README.md`, `docs/GLOSSARY.md`, and `docs/STATUS.md` before committing and pushing.

## Phase 9 — Stable references in prose

**Complete.** Implemented and browser-tested on 30 August 2026.

Bind the manuscript to the story bible using stable working IDs such as `P1`, `S1`, `G1`, `E1`, and `F1`. Provide `@` autocomplete by ID or name. People, identities, places, objects, organizations, concepts, events, facts, reveals, scenes, and plot threads can be referenced. The manuscript displays natural language while the target ID lives in a hidden text anchor. Clicking a mention opens its target; target cards link back to every mention. Renaming never rewrites prose, deleting leaves a visible broken reference, and IDs survive undo and branches.

## Phase 10 — Check prose against the bible

**Complete, with one deliberate exception.** Implemented and browser-tested on 30 August 2026.

- Review a scene, chapter, book, or series.
- A review records the exact prose version it examined and becomes marked stale when the scene changes.
- Find people, places, objects, and events mentioned in prose but missing from the bible.
- Suggest linking to an existing record or creating a new one.
- Compare mentions with viewpoint knowledge, identity, name validity, laws, and chronology.
- Put suggestions in the margin; they never alter prose without the author's action.

**Exception: presence, possession, and object state cannot be inferred from a mention.** “He thought of Valdemar” names him but does not put him anywhere. Anchors need an explicit usage mode—mentioned, depicted, held, or state—before the app can check these claims. This model change was completed in phase 15.

## Phase 11 — Treat a series as one story

**Complete.** Implemented and browser-tested on 31 August 2026.

Plot threads can belong to a book, series, or world. A setup in one volume can pay off in a later volume. Reading order is series → book → chapter → scene. Dramaturgy includes preparation and reader knowledge from earlier volumes. A series overview shows recurring characters, threads, reveals, and unresolved setups without mixing in other series from the same world.

`thread.work_id` remains the book where a thread begins; a new scope field records how far it reaches. SQLite's foreign-key behavior made rebuilding the existing table unsafe, so the compatible schema was retained and extended.

## Phase 12 — Durable source attachments

**Complete.** Implemented and browser-tested on 31 August 2026.

PDFs, images, and other files are copied into a managed project archive. Store the original filename, MIME type, size, and checksum. Files can be displayed or opened safely, but are never OCR-processed, extracted, or interpreted. Detect missing or changed files. Removing a source reference and deleting the archived file are separate actions.

The archive sits beside the database (`fabula.db` → `fabula-filer/`) so they travel together. File bytes stay outside the change log: undo restores the reference without deleting a file the author added. A lightweight integrity check runs routinely; a full checksum verification is explicitly requested.

## Phase 13 — Export, backup, and restore

**Complete.** Implemented and browser-tested on 5 September 2026.

- Export a book or series as Markdown or DOCX.
- Exclude working IDs and hidden anchor marks from the reading edition.
- Optionally include an appendix with people, places, timeline, and sources.
- Export a versioned JSON backup or a ZIP bundle with attachments.
- Preview a backup before restore and test a complete round-trip in an empty database.

Markdown and DOCX render from the same neutral manuscript representation. A single conversion removes internal markup before either format is written. ZIP and DOCX are generated directly without adding a dependency to the export path.

Restore is a documented exception to the “only the change log writes” rule: restore must restore the change log itself. It is safe because it refuses to touch a non-empty database or an incompatible schema, and the refusal is enforced in core rather than in the UI.

## Phase 14 — Compare alternatives without blind spots

**Complete.**

Branch comparison includes narrative order, reveals, prose, entities, events, event times, temporal links, facts, laws, relationships, and plot threads. It finds the last state the branches shared and uses it as the merge base. A conflict means the active branch also changed the same field after that shared point.

Transfer one named difference from the compared branch into the active branch at a time. Prose becomes a new version; the old text remains available. Composite additions such as a scene with children cannot be represented as a safe single-row transfer. No silent automatic merge occurs; each transfer is one undoable action. Dramaturgy and review compare branches on the same basis.

## Phase 15 — Make the complete model editable in the UI

**Complete.** Implemented and browser-tested on 26 September 2026.

The UI can create, edit, and individually delete core story records: entities, events, facts, beliefs, statements, carried knowledge, reveals, laws, relationships, identities, possessions, states, presence, routes, participants, event facts, temporal links, plot threads, beats, and sources. Edits use the same change-logged API as MCP; deletion is undoable.

Before deletion, show dependent records by readable names rather than UUIDs. Anchors distinguish a mere mention from depiction, possession, or an explicit state claim. Continuity checks use only precise, explicit claims and remain silent when time or the claim is uncertain. Legacy anchors migrate safely as “mentioned.”

## Phase 16 — Final overviews and robustness

**Complete.** Browser-tested on 28 September 2026.

- Time × place matrix and relationship graph; the matrix includes only explicitly recorded presence, and the graph has an accessible text and keyboard alternative.
- Findings link to affected entities and scenes; fact, plot-thread, and reveal cards link to prose mentions.
- Timeline participant and name lookups are batched before rendering.
- Automated coverage for empty databases, foreign-key integrity, legacy anchor migration, 2,000 events, 100,000 words across 250 scenes, finding navigation, and MCP glossary synchronization.
- Screen-reader labels and keyboard navigation checked on the relationship graph and main content.
- Clean browser console and zero foreign-key violations in the existing database.
- **325/325 tests, typecheck, build, and browser checks passed.**

The original personal-use app vision is complete after phase 16.

## Phase 17 — Deliberately deferred

- Invented calendars and dynamically relativistic time.
- More advanced parallel universes.
- Concurrent users, conflict handling, authentication, and permissions.
- Public hosting and product operations.

The model should not block these options, but they are not part of phases 9–16.
