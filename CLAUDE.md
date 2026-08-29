# Fabula & Sujet

Story bible and manuscript workbench. See `README.md` for what it is and
`docs/ORDBOG.md` for the Danish ↔ English mapping.

## Rules that are not negotiable

- **Identifiers are English, the surface is Danish.** UI labels, MCP tool names
  and MCP arguments are Danish; tables, columns and functions are English. The
  mapping lives in `docs/ORDBOG.md` and nowhere else — add there before using a
  new word.
- **Nothing writes except the change log.** Every insert, update and delete goes
  through `Session` in `src/core/changelog.ts`, so it can be undone. The single
  documented exception is the time solver's derived bounds.
- **The bible is data, the prose is the writer's.** The model may be changed
  freely; scene text is never written or altered without an explicit yes.
- **Vague time stays vague.** Never invent a date the writer has not decided.
  Events get intervals and links, and the solver narrows them.

## Environment

Node 20 (`.nvmrc`). The shell may default to an older nvm version — check
`node -v` before running anything.

```bash
npm test                            # 54 prøver
npm run fixtures -- ./fabula.db     # Memento, Predestination, Inception
npm run build && npm run dev        # interface on :4173
npm run ask -- ./fabula.db hent_kontekst
```
