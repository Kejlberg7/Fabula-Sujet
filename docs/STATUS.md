# Project Status and Handoff

Last updated: 28 September 2026 (project implementation status). Documentation was translated to English afterward.

## Active phase

**No phase is active. Phases 0–16 are complete.** Phase 16 was tested, built, and browser-verified on 28 September 2026. The original personal-use app vision is implemented. Phase 17 is deliberately deferred; see [`ROADMAP.md`](ROADMAP.md).

## Current implementation

- Story bible and manuscript workbench with a shared database and active context across the Danish UI and MCP server.
- Separate chronological and narrative-order axes, uncertain time intervals, temporal links, personal time, identity legs, nested realms, and reader-knowledge queries.
- Facts, partial bindings, beliefs, statements, carriers, world laws, relationships, presence, possessions, object state, plot threads, and source records.
- Stable prose references (`@P1`, `@G1`, `@E1`, etc.), bidirectional links between manuscript and bible, scene editor, and reader/viewpoint knowledge panels.
- Review rules for continuity and explicit prose claims; suggestions remain inert until the author applies them. Every MCP prose write asks for approval.
- Change log, undo/redo, rollback, checkpoints, branch history, branch comparison, and explicit one-difference transfers with visible conflicts.
- Timeline, zoom/pan, band view, chapters, series overview, dramaturgy, knowledge curve, time/place matrix, relationship graph, source shelf, export and restore.

## Latest verification

Phase 16 verification completed:

- 325/325 automated tests pass.
- Typecheck and production build pass.
- Browser checks covered timeline/overviews, keyboard navigation, issue navigation, and the rendered relationship graph.
- Automated cases cover an empty database, foreign-key integrity, legacy anchor migration, 2,000 events, 100,000 words in 250 scenes, and MCP glossary synchronization.
- Existing `fabula.db` had zero foreign-key violations.

Use `npm test`, `npm run build`, and `npm run dev` for local verification. Node 20 is required; check `node -v` because the shell may select an older version.

## Design decisions that must remain true

- The app surface is Danish; source code, identifiers, schema, and this repository's documentation are English. [`GLOSSARY.md`](GLOSSARY.md) is the vocabulary source of truth for Danish UI/MCP strings and English model terms.
- UI and MCP call the same domain services. No alternate write path should bypass the change log.
- Every user change is undoable. Derived solver bounds and review findings are recomputable; archived file bytes remain outside the change log so undo never deletes an author's file.
- The bible is editable by the AI; prose is not. Each prose write needs the author's explicit approval. If the MCP client cannot ask, the write must be refused.
- A mention identifies a target but does not imply physical presence, possession, or object state. Such checks require an explicit anchor usage.
- Uncertain time remains uncertain. Report only contradictions that cannot be arranged consistently.
- Review checks laws before reporting. A rule-specific ability can lift the corresponding rule.
- Sources are stored and displayed, never machine-read. The author marks the source relationship.
- A series reader carries knowledge from previous books in that series, but not from another series in the same world.
- Dramaturgy is evidence-based and qualitative; do not reduce it to a numeric score.
- Branch transfer is explicit, one difference at a time; conflicts are visible and merges are never silent.
- Backup restore only targets an empty database with a compatible schema.

## Known limitations / open risks

- In-app browser tooling did not reliably display PDFs during earlier verification. PNG display and attachment integrity checks were verified; if PDF inline display regresses in a normal browser, inspect the content-security policy on `GET /api/fil/:sourceId`.
- Removing an archived file is deliberately not undone automatically. Undo restores the source reference; the integrity rule reports the missing file.
- Sample fixtures are intended for an empty database. There is no merge/import path for loading them into a database already containing those worlds.
- Older ProseMirror anchors without stable codes remain readable through their stored target, but may not have the full current reference behavior.
- Identities open their owner's person card; reveals are accessed from Dramaturgy and Alternatives. They do not yet have standalone detail pages.

## Next action

No implementation phase is active. The current request is complete when the English documentation is consistent and validated. Future development should begin with the intentionally deferred areas in phase 17, or with a newly agreed roadmap item.

## Continuation checklist for another agent

1. Read this file, [`ROADMAP.md`](ROADMAP.md), [`README.md`](../README.md), and [`GLOSSARY.md`](GLOSSARY.md).
2. Preserve any user changes in the working tree; inspect `git status` before editing.
3. Keep the UI and MCP vocabulary Danish, while keeping code and documentation English.
4. Record the active phase, completed slices, open decisions, verification, and next action here while work is underway.
5. Run tests, typecheck, build, and browser checks proportionate to the change before marking a phase complete.
