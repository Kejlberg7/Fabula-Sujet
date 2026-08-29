import { formatInstant, formatSpan } from '../time/gregorian';
import {
  endsEarliest, fingerprint, mustOverlap, sameLife,
  type Finding, type Occupation, type Rule, type Snapshot,
} from './kit';

/**
 * The same person, the same leg of their life, the same layer of the world --
 * and two places at once.
 *
 * Every part of that sentence is doing work. Different legs is time travel and
 * the whole of Predestination; a different realm is a body asleep upstairs
 * while its owner walks through a dream. Neither is an error, and a rule that
 * did not make the distinction would report the two most interesting things a
 * writer can do as mistakes.
 */
export const bilocation: Rule = {
  code: 'bilocation',
  title: 'Bilokation',
  run: (snap) => {
    const findings: Finding[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < snap.occupations.length; i += 1) {
      for (let j = i + 1; j < snap.occupations.length; j += 1) {
        const a = snap.occupations[i]!;
        const b = snap.occupations[j]!;
        if (a.placeId === b.placeId) continue;
        // Only two claims that each pin her somewhere can contradict each
        // other. An errand during a stay is not a contradiction; whether the
        // errand is *reachable* from the stay is the travel rule's question,
        // and that one only speaks when a route has actually been written down.
        if (!a.exclusive || !b.exclusive) continue;
        if (!sameLife(snap, a, b)) continue;
        if (!mustOverlap(a, b)) continue;

        const key = fingerprint('bilocation', a.sourceId, b.sourceId);
        if (seen.has(key)) continue;
        seen.add(key);

        const who = snap.name(a.entityId);
        const lifted = snap.lifted({
          ruleCode: 'bilocation', entityId: a.entityId,
          realmId: a.realmId, at: a.earliest,
        });
        findings.push({
          ruleCode: 'bilocation',
          severity: 'error',
          message:
            `${who} er både i ${snap.name(a.placeId)} og i ${snap.name(b.placeId)} `
            + `omkring ${formatInstant(Math.max(a.earliest, b.earliest), 'day')}. `
            + `${a.label} og ${b.label} kan ikke skilles ad, uanset hvor i deres spillerum de lægges.`,
          subjects: {
            entities: [a.entityId],
            places: [a.placeId, b.placeId],
            events: [a.eventId, b.eventId].filter((x): x is string => !!x),
            rows: [a.sourceId, b.sourceId],
          },
          fingerprint: key,
          ...(lifted ? { lifted } : {}),
        });
      }
    }
    return findings;
  },
};

/**
 * She cannot be in both places, because she cannot get there in time.
 *
 * This is the one rule the writer asked for as unbreakable: only an explicit
 * ability lifts it. It stays quiet where it knows nothing -- with no route
 * recorded between two places there is no distance to violate, and inventing
 * one would be worse than saying nothing. What it does have, it holds to.
 */
export const travelTime: Rule = {
  code: 'travel_time',
  title: 'Rejsetid',
  run: (snap) => {
    const findings: Finding[] = [];
    const seen = new Set<string>();

    /** The quickest recorded way from one place to another, if there is one. */
    const quickest = (from: string, to: string, realmId: string): number | null => {
      const times = snap.links
        .filter((l) => l.realmId === realmId && l.travelMin != null)
        .filter((l) => (l.fromPlaceId === from && l.toPlaceId === to)
          || (l.bidirectional && l.fromPlaceId === to && l.toPlaceId === from))
        .map((l) => l.travelMin!);
      return times.length ? Math.min(...times) : null;
    };

    /**
     * The earliest moment an occupation can let her go, and the latest moment
     * she can still turn up for one.
     *
     * A stay is not a cage: she can leave the motel the minute she arrives and
     * come back that evening, so a stay releases her at its start rather than
     * at its end. Something that pins her -- an event -- holds her for its whole
     * length. Getting this wrong in either direction is the difference between
     * a rule that catches "she was in Australia yesterday" and one that
     * complains every time a character runs an errand.
     */
    const releasedAt = (o: Occupation) => (o.exclusive ? endsEarliest(o) : o.earliest);
    const mustArriveBy = (o: Occupation) => (o.exclusive ? o.latest : o.latest + o.duration);

    const check = (first: Occupation, second: Occupation) => {
      const leave = releasedAt(first);
      const arrive = mustArriveBy(second);
      // Only ask about an order that is open at all. The other order gets its
      // own turn, and "no order works" is bilocation's business, not ours.
      if (leave > arrive) return;

      const need = quickest(first.placeId, second.placeId, first.realmId);
      if (need == null) return;
      // The most generous reading: leave as early as she can, arrive as late as
      // she may. If even that is not enough, no arrangement of the vague dates
      // saves it.
      const available = arrive - leave;
      if (available >= need) return;

      const key = fingerprint('travel_time', first.sourceId, second.sourceId);
      if (seen.has(key)) return;
      seen.add(key);

      const lifted = snap.lifted({
        ruleCode: 'travel_time', entityId: first.entityId,
        realmId: first.realmId, at: first.earliest,
      });
      findings.push({
        ruleCode: 'travel_time',
        severity: 'error',
        message:
          `${snap.name(first.entityId)} skal fra ${snap.name(first.placeId)} til `
          + `${snap.name(second.placeId)}, og der er højst ${formatSpan(Math.max(0, available))} `
          + `til en tur, der tager ${formatSpan(need)}. `
          + `${first.label} slipper hende tidligst ${formatInstant(leave, 'day')}, `
          + `og ${second.label} kræver hende senest ${formatInstant(arrive, 'day')}.`,
        subjects: {
          entities: [first.entityId],
          places: [first.placeId, second.placeId],
          events: [first.eventId, second.eventId].filter((x): x is string => !!x),
          rows: [first.sourceId, second.sourceId],
        },
        fingerprint: key,
        ...(lifted ? { lifted } : {}),
      });
    };

    for (let i = 0; i < snap.occupations.length; i += 1) {
      for (let j = i + 1; j < snap.occupations.length; j += 1) {
        const a = snap.occupations[i]!;
        const b = snap.occupations[j]!;
        if (a.placeId === b.placeId) continue;
        if (!sameLife(snap, a, b)) continue;
        // Two things that both pin her, with no order that works, is already
        // reported as bilocation. One problem, one finding.
        if (a.exclusive && b.exclusive && mustOverlap(a, b)) continue;
        check(a, b);
        check(b, a);
      }
    }
    return findings;
  },
};

/**
 * Somebody is somewhere outside their own life.
 *
 * A leg says when in world time that stretch of the person runs. Standing in a
 * room before it begins or after it ends is either a mistake or an
 * unrecorded journey -- and both are worth a look, which is why this is a
 * warning and not an error.
 */
export const lifeSpan: Rule = {
  code: 'life_span',
  title: 'Liv og alder',
  run: (snap) => {
    const findings: Finding[] = [];

    for (const o of snap.occupations) {
      const legs = snap.legsOf.get(o.entityId) ?? [];
      // With no leg on the row and several to choose from, we cannot say which
      // one should have contained it, and we do not guess.
      const leg = o.legId ? snap.legs.get(o.legId) : legs.length === 1 ? legs[0] : undefined;
      if (!leg) continue;

      const before = leg.worldStart != null && endsLatestOf(o) < leg.worldStart;
      const after = leg.worldEnd != null && o.earliest > leg.worldEnd;
      if (!before && !after) continue;

      const key = fingerprint('life_span', o.sourceId, leg.id);
      const lifted = snap.lifted({
        ruleCode: 'life_span', entityId: o.entityId,
        realmId: o.realmId, at: o.earliest,
      });
      const legName = leg.label ?? `ben ${leg.ordinal}`;
      findings.push({
        ruleCode: 'life_span',
        severity: 'warning',
        message:
          `${snap.name(o.entityId)} er med i ${o.label} `
          + `${before ? 'før' : 'efter'} ${legName} `
          + `${before
            ? `begynder (${formatInstant(leg.worldStart!, 'day')})`
            : `slutter (${formatInstant(leg.worldEnd!, 'day')})`}. `
          + 'Enten hører det til et andet ben, eller også skal benet strækkes.',
        subjects: {
          entities: [o.entityId],
          events: o.eventId ? [o.eventId] : [],
          rows: [o.sourceId, leg.id],
        },
        fingerprint: key,
        ...(lifted ? { lifted } : {}),
      });
    }
    return findings;
  },
};

const endsLatestOf = (o: Occupation) => o.latest + o.duration;
