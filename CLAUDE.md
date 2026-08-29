# Fabula & Sujet

Story bible and manuscript workbench. See `README.md` for what it is and
`docs/ORDBOG.md` for the Danish ↔ English mapping.

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
  freely; scene text is never written or altered without an explicit yes.
- **Vague time stays vague.** Never invent a date the writer has not decided.
  Events get intervals and links, and the solver narrows them.
- **Memory retention only governs experience.** A person's memory policy may
  expire knowledge derived from events. Explicit beliefs and facts written on
  carried objects keep their own stated lifetimes.
- **Ask the law layer before reporting.** A built-in rule calls `lawsLifting`
  first; an `ability` naming its rule code switches it off. A warning the writer
  has already written an exception for is noise, and noise gets the tool
  switched off within a week.
- **Only report what cannot be arranged otherwise.** A vague date can be placed
  anywhere in its interval; if any placement is consistent, there is nothing
  wrong — the writer has not decided yet. Every rule in `src/core/rules/` proves
  impossibility before it speaks, and every rule has a test for its silence.

## Environment

Node 20 (`.nvmrc`). The shell may default to an older nvm version — check
`node -v` before running anything.

```bash
npm test                            # 111 prøver
npm run fixtures -- ./fabula.db     # Memento, Predestination, Inception
npm run build && npm run dev        # interface on :4173
npm run ask -- ./fabula.db hent_kontekst
```
