# Fabula & Sujet

Story bible and manuscript workbench. See `README.md` for what it is and
`docs/ORDBOG.md` for the Danish ↔ English mapping.

## Start here

Before changing anything, read these files in order:

1. `docs/STATUS.md` -- the current hand-off, including the exact next action.
2. `docs/ROADMAP.md` -- the agreed continuation after phase 8.
3. `README.md` -- what the finished phases do.
4. `docs/ORDBOG.md` -- the only Danish ↔ English vocabulary.

Update `docs/STATUS.md` while a phase is in progress, not only when it is done.
It must be possible for another AI to continue safely from the working tree and
that file alone. At a minimum record the active phase, completed slices, open
decisions, verification already run, and the next concrete action.

## Rules that are not negotiable

- **Identifiers are English, the surface is Danish.** UI labels, MCP tool names
  and MCP arguments are Danish; tables, columns and functions are English. The
  mapping lives in `docs/ORDBOG.md` and nowhere else — add there before using a
  new word.
- **Nothing writes except the change log.** Every insert, update and delete goes
  through `Session` in `src/core/changelog.ts`, so it can be undone. Two
  documented exceptions, both derived data that is recomputable at any moment:
  the time solver's bounds, and the `finding` rows the review writes. A
  *dismissal* is a person deciding something, so that goes through the log.
- **The bible is data, the prose is the writer's.** The model may be changed
  freely; scene text is never written or altered without an explicit yes. A
  margin note may propose a wording, but only the writer clicking it in the
  editor writes it: `applySuggestion` is on the interface's API and has no MCP
  tool. Prose and note go in one turn, so one undo takes back both.
- **A source is stored and shown, never read.** No PDF, article or photographed
  page is opened to guess what it says. What the rules act on is the writer's own
  marking -- supports, context, or possible contradiction.
- **Vague time stays vague.** Never invent a date the writer has not decided.
  Events get intervals and links, and the solver narrows them.
- **Memory retention only governs experience.** A person's memory policy may
  expire knowledge derived from events. Explicit beliefs and facts written on
  carried objects keep their own stated lifetimes.
- **Ask the law layer before reporting.** A built-in rule calls `lawsLifting`
  first; an `ability` naming its rule code switches it off. A warning the writer
  has already written an exception for is noise, and noise gets the tool
  switched off within a week.
- **En serie læses i rækkefølge.** Læseren af bind to har læst bind et, så
  `whatReaderKnows` tæller tidligere bøger i den samme serie med. En anden serie
  i den samme verden arver ingenting.
- **Vurderinger får aldrig et tal.** Gennemgangen siger, om noget er muligt;
  Grebet siger, om det er noget værd — og en karakter kan hverken diskuteres
  eller handles på. En aflæsning nævner altid de scener, den kommer af, og tier,
  når der ikke er noget at regne på. Se `src/core/queries/dramaturgy.ts`.
- **A read-through is bound to the version it read.** `review_run` records the
  exact `scene_text` of every scene in its scope, and every margin note carries
  the version it was written about. A note whose scene has been saved since is
  *stale*, not wrong -- it is marked, never blocked, because prose saves as you
  type and a lock would close the whole margin.
- **A mention names; it does not place.** A mark in the prose says the writer
  was pointing at something, not that anybody was in the room -- «Han tænkte på
  Valdemar» names Valdemar and puts him nowhere. So presence, possession and
  object state are never derived from an anchor. What does follow from one is
  checked in `src/core/rules/mentions.ts`: time, a name's validity, and what the
  reading order has handed the reader.
- **Only report what cannot be arranged otherwise.** A vague date can be placed
  anywhere in its interval; if any placement is consistent, there is nothing
  wrong — the writer has not decided yet. Every rule in `src/core/rules/` proves
  impossibility before it speaks, and every rule has a test for its silence.

## Environment

Node 20 (`.nvmrc`). The shell may default to an older nvm version — check
`node -v` before running anything.

```bash
npm test                            # 238 prøver
npm run fixtures -- ./fabula.db     # Memento, Predestination, Inception, Havnen
npm run build && npm run dev        # interface on :4173
npm run ask -- ./fabula.db hent_kontekst
```
