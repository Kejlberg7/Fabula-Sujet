/**
 * Fabula & Sujet -- phase 0 schema.
 *
 * Identifiers here are English. Everything the writer sees -- UI labels, MCP
 * tool names, MCP arguments -- is Danish, and docs/ORDBOG.md is the only place
 * the mapping is defined.
 *
 * Read the tables in this order; each layer only depends on the ones above it:
 *
 *   world      the universe, its clocks and its realms, and the travel graph
 *   entities   people, places, objects -- their identities, legs and whereabouts
 *   events     what happened, who took part, and how events are tied in time
 *   knowledge  facts with slots, and what is believed, said and written down
 *   laws       what can and cannot happen here, plus research borrowed from reality
 *   narrative  branches, works, chapters, scenes, prose, and the bridge tables
 *   history    the change log everything is written through
 *   findings   what the consistency engine reported, and what was dismissed
 */

export * from './_shared';
export * from './world';
export * from './entities';
export * from './events';
export * from './knowledge';
export * from './laws';
export * from './narrative';
export * from './history';
export * from './findings';
