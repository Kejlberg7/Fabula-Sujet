import { readBindings } from '../queries/bindings';
import { personalTimeOf, whoKnewWhat } from '../queries/knowledge';
import { formatInstant } from '../time/gregorian';
import { fingerprint, type Finding, type Rule, type Snapshot } from './kit';

/**
 * Somebody says something true that they have no way of knowing.
 *
 * A lie is not a gap -- it is a plot -- so this only looks at statements the
 * writer marked truthful. And it does not stop at the fact: a statement may
 * bind a slot the speaker has never filled, which is the ordinary shape of the
 * mistake. She knows someone was killed; the sentence she is given names the
 * killer. That is the line that has to be rewritten, and it is very easy to
 * write without noticing.
 */
export const knowledgeGap: Rule = {
  code: 'knowledge_gap',
  title: 'Vidensbrud',
  run: (snap) => {
    const findings: Finding[] = [];
    const { store, ctx } = snap;

    for (const said of snap.statements) {
      // An unmarked statement is not a claim about truthfulness, and a lie is
      // supposed to outrun what the speaker knows.
      if (said.truthful !== true) continue;
      const when = said.atTime ?? (said.eventId
        ? snap.events.get(said.eventId)?.solvedEarliest ?? snap.events.get(said.eventId)?.earliest
        : null);
      if (when == null) continue;

      const clock = personalTimeOf(store, ctx, {
        entityId: said.speakerEntityId, worldTime: when, legId: said.speakerLegId,
      });
      const held = whoKnewWhat(store, ctx, {
        entityId: said.speakerEntityId, at: clock.at,
        ...(clock.legId ? { legId: clock.legId } : {}),
      });

      const who = snap.name(said.speakerEntityId);
      const what = snap.facts.get(said.factId)?.summary ?? 'noget';
      const knows = held.items.find((k) => k.factId === said.factId);

      if (!knows) {
        findings.push({
          ruleCode: 'knowledge_gap',
          severity: 'error',
          message:
            `${who} siger «${what}» ${formatInstant(when, 'day')} og ved det ikke på det tidspunkt. `
            + 'Enten lyver hun, eller også mangler der noget, hun har fået at vide først.',
          subjects: {
            entities: [said.speakerEntityId], facts: [said.factId],
            events: said.eventId ? [said.eventId] : [], rows: [said.id],
          },
          fingerprint: fingerprint('knowledge_gap', said.id),
          ...(liftedFor(snap, 'knowledge_gap', said.speakerEntityId, when) ?? {}),
        });
        continue;
      }

      /**
       * The fact is hers, but is the *filling* hers? A slot bound in what she
       * says and left open in what she knows is the whole of the mistake.
       */
      const spoken = readBindings(store, 'statement', said.id);
      const missing = Object.keys(spoken).filter((slot) => !(slot in knows.binds));
      if (missing.length === 0) continue;

      findings.push({
        ruleCode: 'knowledge_gap',
        severity: 'error',
        message:
          `${who} navngiver ${missing.map((m) => `«${m}»`).join(' og ')} i «${what}», `
          + `men har ikke selv den plads udfyldt ${formatInstant(when, 'day')}. `
          + `Hun ved ${Object.keys(knows.binds).length === 0
            ? 'kun at det er sket'
            : `kun ${Object.keys(knows.binds).map((s) => `«${s}»`).join(' og ')}`}.`,
        subjects: {
          entities: [said.speakerEntityId], facts: [said.factId],
          events: said.eventId ? [said.eventId] : [], rows: [said.id],
        },
        fingerprint: fingerprint('knowledge_gap', said.id, ...missing),
        ...(liftedFor(snap, 'knowledge_gap', said.speakerEntityId, when) ?? {}),
      });
    }
    return findings;
  },
};

/**
 * The note she is acting on was left at home.
 *
 * Written knowledge is only knowledge while the thing it is written on is in
 * her hands. This is the rule Memento is made of, and it catches two shapes of
 * the mistake: relying on a carrier she is not holding, and writing something
 * onto an object that nobody ever carries at all.
 */
export const missingCarrier: Rule = {
  code: 'missing_carrier',
  title: 'Bæreren mangler',
  run: (snap) => {
    const findings: Finding[] = [];

    for (const held of snap.beliefs) {
      if (!held.sourceCarrierId) continue;
      const written = snap.carriers.find((c) => c.id === held.sourceCarrierId);
      if (!written) continue;
      if (held.sincePersonal == null) continue;

      // Beliefs are indexed on the believer's own clock, possessions on the
      // world's. One of them has to be moved before they can be compared.
      const leg = held.legId ? snap.legs.get(held.legId) : (snap.legsOf.get(held.entityId) ?? [])[0];
      const worldAt = leg && leg.personalStart != null && leg.worldStart != null
        ? leg.worldStart + (held.sincePersonal - leg.personalStart)
        : held.sincePersonal;

      const hasIt = snap.possessions.some((p) =>
        p.holderEntityId === held.entityId
        && p.objectEntityId === written.objectEntityId
        && (p.fromTime ?? Number.NEGATIVE_INFINITY) <= worldAt
        && (p.toTime ?? Number.POSITIVE_INFINITY) >= worldAt);
      if (hasIt) continue;

      findings.push({
        ruleCode: 'missing_carrier',
        severity: 'error',
        message:
          `${snap.name(held.entityId)} bygger «${snap.facts.get(held.factId)?.summary ?? 'noget'}» `
          + `på ${snap.name(written.objectEntityId)}, men har den ikke på sig `
          + `${formatInstant(worldAt, 'day')}.`,
        subjects: {
          entities: [held.entityId, written.objectEntityId],
          facts: [held.factId], rows: [held.id, written.id],
        },
        fingerprint: fingerprint('missing_carrier', held.id),
        ...(liftedFor(snap, 'missing_carrier', held.entityId, worldAt) ?? {}),
      });
    }

    // Something written on an object that never ends up in anyone's hands. Not
    // wrong, but almost always an unfinished thought.
    for (const written of snap.carriers) {
      if (snap.possessions.some((p) => p.objectEntityId === written.objectEntityId)) continue;
      findings.push({
        ruleCode: 'missing_carrier',
        severity: 'note',
        message:
          `«${snap.facts.get(written.factId)?.summary ?? 'Noget'}» står på `
          + `${snap.name(written.objectEntityId)}, men ingen har nogensinde den ting på sig. `
          + 'Så er der ikke nogen, det kan nå frem til.',
        subjects: {
          entities: [written.objectEntityId], facts: [written.factId], rows: [written.id],
        },
        fingerprint: fingerprint('missing_carrier', 'unheld', written.id),
      });
    }

    return findings;
  },
};

function liftedFor(
  snap: Snapshot, ruleCode: string, entityId: string, at: number,
): { lifted: string } | undefined {
  const statement = snap.lifted({ ruleCode, entityId, at });
  return statement ? { lifted: statement } : undefined;
}
