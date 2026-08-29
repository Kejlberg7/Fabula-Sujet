import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SECONDS, formatInstant, formatSpan, parseInstant, parseSpan,
} from '../core/time/gregorian';
import { RealmClocks, type RealmClock } from '../core/time/realms';
import { solve, type SolverEvent, type SolverLink } from '../core/time/solver';

const DAY = SECONDS.DAY;

describe('gregoriansk tid', () => {
  it('bevarer uskarpheden i det, der blev skrevet', () => {
    const year = parseInstant('1985');
    assert.equal(year.precision, 'year');
    assert.equal(year.latest - year.earliest, 365 * DAY - 1);

    const month = parseInstant('1985-06');
    assert.equal(month.precision, 'month');
    assert.equal(month.latest - month.earliest, 30 * DAY - 1);

    const day = parseInstant('1985-06-12');
    assert.equal(day.precision, 'day');
    assert.equal(day.latest - day.earliest, DAY - 1);
  });

  it('klarer tid før epoken', () => {
    const medieval = parseInstant('1200-04-03');
    assert.ok(medieval.earliest < 0, 'år 1200 er ikke et særtilfælde');
    assert.equal(formatInstant(medieval.earliest, 'day'), '3. april 1200');
  });

  it('siger tidspunkter og varigheder på dansk', () => {
    assert.equal(formatInstant(parseInstant('1985-06-12').earliest, 'month'), 'juni 1985');
    assert.equal(formatSpan(3 * DAY), '3 døgn');
    assert.equal(formatSpan(200 * 60), '3 timer 20 minutter');
    assert.equal(parseSpan('3 dage'), 3 * DAY);
    assert.equal(parseSpan('10 min'), 600);
    assert.equal(parseSpan('2 uger'), 14 * DAY);
  });
});

describe('lag og deres ure', () => {
  /** Inception: virkeligheden og tre drømmelag, hvert tyve gange hurtigere. */
  const realms: RealmClock[] = [
    { id: 'reality', parentRealmId: null, timeRatioNum: 1, timeRatioDen: 1, parentEpoch: null, localEpoch: null },
    { id: 'd1', parentRealmId: 'reality', timeRatioNum: 20, timeRatioDen: 1, parentEpoch: 0, localEpoch: 0 },
    { id: 'd2', parentRealmId: 'd1', timeRatioNum: 20, timeRatioDen: 1, parentEpoch: 0, localEpoch: 0 },
    { id: 'd3', parentRealmId: 'd2', timeRatioNum: 20, timeRatioDen: 1, parentEpoch: 0, localEpoch: 0 },
  ];
  const clocks = new RealmClocks(realms);

  it('regner ti minutter om til otte uger tre lag nede', () => {
    const tenMinutes = 10 * 60;
    assert.equal(clocks.spanFromRoot('d1', tenMinutes), 200 * 60);
    assert.equal(formatSpan(clocks.spanFromRoot('d1', tenMinutes)), '3 timer 20 minutter');
    assert.equal(formatSpan(clocks.spanFromRoot('d2', tenMinutes)), '2 døgn 19 timer');
    assert.equal(formatSpan(clocks.spanFromRoot('d3', tenMinutes)), '56 døgn');
  });

  it('kommer frem og tilbage til samme tal', () => {
    const at = clocks.fromRoot('d3', 12345);
    assert.equal(Math.round(clocks.toRoot('d3', at)), 12345);
  });

  it('nægter at sammenligne et lag, der ikke er fæstnet', () => {
    const loose = new RealmClocks([
      { id: 'reality', parentRealmId: null, timeRatioNum: 1, timeRatioDen: 1, parentEpoch: null, localEpoch: null },
      { id: 'drøm', parentRealmId: 'reality', timeRatioNum: 20, timeRatioDen: 1, parentEpoch: null, localEpoch: null },
    ]);
    assert.equal(loose.isAnchored('drøm'), false);
    assert.throws(() => loose.toRoot('drøm', 0), /fæstnet/);
  });
});

describe('tidsløseren', () => {
  const realms: RealmClock[] = [
    { id: 'r', parentRealmId: null, timeRatioNum: 1, timeRatioDen: 1, parentEpoch: null, localEpoch: null },
  ];
  const ev = (id: string, earliest: number | null, latest: number | null): SolverEvent =>
    ({ id, realmId: 'r', earliest, latest, durationMin: 0, durationMax: 0 });

  it('strammer to uskarpe events ved hjælp af ét kendt', () => {
    // Branden: engang i foråret. Mødet: tre dage efter branden, og før afrejsen.
    const events = [
      ev('branden', 1 * DAY, 60 * DAY),
      ev('mødet', null, null),
      ev('afrejsen', 25 * DAY, 25 * DAY),
    ];
    const links: SolverLink[] = [
      { id: 'l1', fromEventId: 'branden', toEventId: 'mødet', kind: 'offset', offsetMin: 3 * DAY, offsetMax: 3 * DAY, axis: 'world' },
      { id: 'l2', fromEventId: 'mødet', toEventId: 'afrejsen', kind: 'before', offsetMin: null, offsetMax: null, axis: 'world' },
    ];

    const { bounds, findings } = solve(events, links, realms);
    assert.deepEqual(bounds.get('branden'), { earliest: 1 * DAY, latest: 22 * DAY });
    assert.deepEqual(bounds.get('mødet'), { earliest: 4 * DAY, latest: 25 * DAY });
    assert.equal(findings.length, 0, 'et stramt forløb er ikke et problem');
  });

  it('melder det, når et interval presses ned til ingenting', () => {
    const events = [ev('sent', 10 * DAY, 10 * DAY), ev('tidligt', null, 5 * DAY)];
    const links: SolverLink[] = [
      { id: 'l', fromEventId: 'sent', toEventId: 'tidligt', kind: 'before', offsetMin: null, offsetMax: null, axis: 'world' },
    ];
    const { findings } = solve(events, links, realms);
    const impossible = findings.filter((f) => f.ruleCode === 'impossible_chronology');
    assert.equal(impossible.length, 1, 'én umulighed er ét fund, ikke ét per klemt event');
    assert.match(impossible[0]!.message, /ingenting/);
    assert.deepEqual(impossible[0]!.subjects.events!.sort(), ['sent', 'tidligt']);
  });

  it('fanger en ring i rækkefølgen', () => {
    const events = [ev('a', null, null), ev('b', null, null)];
    const links: SolverLink[] = [
      { id: 'l1', fromEventId: 'a', toEventId: 'b', kind: 'before', offsetMin: null, offsetMax: null, axis: 'world' },
      { id: 'l2', fromEventId: 'b', toEventId: 'a', kind: 'before', offsetMin: null, offsetMax: null, axis: 'world' },
    ];
    const { findings } = solve(events, links, realms);
    assert.ok(findings.some((f) => /ring/.test(f.message)));
  });

  it('tillader at verdens tid springer tilbage, men ikke at et liv gør det', () => {
    // To ben af samme person: det andet ligger tidligere i verdens tid.
    const events = [ev('ungdom', 40 * DAY, 40 * DAY), ev('senere_besøg', 10 * DAY, 10 * DAY)];
    const worldOnly: SolverLink[] = [
      { id: 'l1', fromEventId: 'ungdom', toEventId: 'senere_besøg', kind: 'offset', offsetMin: -30 * DAY, offsetMax: -30 * DAY, axis: 'personal' },
    ];
    assert.equal(solve(events, worldOnly, realms).findings.length, 0,
      'et spring tilbage i verdens tid er tidsrejse, ikke en fejl');

    const loop: SolverLink[] = [
      { id: 'l1', fromEventId: 'ungdom', toEventId: 'senere_besøg', kind: 'offset', offsetMin: 1, offsetMax: 1, axis: 'personal' },
      { id: 'l2', fromEventId: 'senere_besøg', toEventId: 'ungdom', kind: 'offset', offsetMin: 1, offsetMax: 1, axis: 'personal' },
    ];
    const findings = solve(events, loop, realms).findings;
    assert.ok(findings.some((f) => /egen tid/.test(f.message)), 'personlig tid må ikke gå i ring');
  });

  it('holder et ufæstnet lag for sig selv i stedet for at gætte', () => {
    const twoRealms: RealmClock[] = [
      { id: 'r', parentRealmId: null, timeRatioNum: 1, timeRatioDen: 1, parentEpoch: null, localEpoch: null },
      { id: 'drøm', parentRealmId: 'r', timeRatioNum: 20, timeRatioDen: 1, parentEpoch: null, localEpoch: null },
    ];
    const events: SolverEvent[] = [
      ev('vågen', 5 * DAY, 5 * DAY),
      { id: 'drømt', realmId: 'drøm', earliest: null, latest: null, durationMin: 0, durationMax: 0 },
    ];
    const links: SolverLink[] = [
      { id: 'l', fromEventId: 'vågen', toEventId: 'drømt', kind: 'before', offsetMin: null, offsetMax: null, axis: 'world' },
    ];
    const { bounds, findings } = solve(events, links, twoRealms);
    assert.equal(bounds.get('drømt')!.earliest, null, 'uden holdepunkt smitter tiden ikke over');
    assert.ok(findings.some((f) => f.ruleCode === 'unanchored_realm'));
  });
});
