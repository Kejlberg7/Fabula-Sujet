import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { denseEventRange, panRange, zoomRange } from '../core/time/focus';

const event = (id: string, at: number) => ({
  id, kind: 'event', from: at, toLatest: at + 10,
});

const DAY = 24 * 60 * 60;

describe('tidslinjens fokusvindue', () => {
  it('finder den tætte historie uden at lade en gammel baghistorie mase den sammen', () => {
    const items = [event('old', -600 * DAY), event('night', -90 * DAY)];
    for (let n = 0; n < 10; n += 1) items.push(event(`day-${n}`, n * DAY));
    const focus = denseEventRange(items)!;
    assert.ok(focus.from > -10 * DAY, `fokus begyndte for tidligt: ${focus.from}`);
    assert.ok(focus.to < 20 * DAY, `fokus sluttede for sent: ${focus.to}`);
  });

  it('tæller samme event én gang, selv om fem personer deltager', () => {
    const crowded = Array.from({ length: 5 }, (_, n) => event(`old:person-${n}`, -600 * DAY));
    const recent = Array.from({ length: 8 }, (_, n) => event(`new-${n}`, n * DAY));
    const focus = denseEventRange([...crowded, ...recent])!;
    assert.ok(focus.from > -10 * DAY);

    const lone = denseEventRange([event('one', 100)])!;
    assert.ok(lone.to - lone.from >= 3_600, 'ét øjeblik skal stadig få et læsbart vindue');
  });

  it('zoomer omkring midten og holder panorering inden for hele kronologien', () => {
    const bounds = { from: 0, to: 10_000 };
    assert.deepEqual(zoomRange({ from: 2_000, to: 8_000 }, 0.5, bounds), {
      from: 3_200, to: 6_800,
    });
    assert.deepEqual(panRange({ from: 7_000, to: 9_000 }, 1, bounds), {
      from: 8_000, to: 10_000,
    });
  });
});
