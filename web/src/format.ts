export { formatInstant, formatSpan, SECONDS } from '../../src/core/time/gregorian';

/**
 * «1 margennoter» er en lille ting, men den står midt på skærmen.
 *
 * Dansk har ingen regel, der kan udledes af tallet alene, så begge former
 * skrives frem på stedet.
 */
export const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

export const ROLE_DA: Record<string, string> = {
  actor: 'handler', witness: 'vidne', victim: 'offer',
  present_unaware: 'til stede, uvidende', mentioned: 'omtalt',
};

export const KIND_DA: Record<string, string> = {
  person: 'person', place: 'sted', object: 'genstand',
  organisation: 'organisation', concept: 'begreb',
};

/**
 * De ord, begge flader deler, kommer ét sted fra.
 *
 * `STRENGTH_DA` beholder sit gamle navn her, fordi det er sådan skærmene
 * kalder det; det er de samme ord som `BELIEF_DA`.
 */
export {
  BELIEF_DA as STRENGTH_DA, BELIEF_SOURCE_DA, MODE_DA, REVEAL_DA, SOURCE_KIND_DA, say,
} from '../../src/core/words';

export const TRUTH_DA: Record<string, string> = {
  true: 'sandt', false: 'falsk', disputed: 'omstridt', undecided: 'uafklaret',
};

export { BELIEF_SOURCE_DA as SOURCE_DA } from '../../src/core/words';

export const LINK_DA: Record<string, string> = {
  before: 'før', after: 'efter', same_time: 'samtidig med',
  offset: 'forskudt fra', during: 'under',
};
