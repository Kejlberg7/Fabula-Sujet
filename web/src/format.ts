export { formatInstant, formatSpan, SECONDS } from '../../src/core/time/gregorian';

export const ROLE_DA: Record<string, string> = {
  actor: 'handler', witness: 'vidne', victim: 'offer',
  present_unaware: 'til stede, uvidende', mentioned: 'omtalt',
};

export const KIND_DA: Record<string, string> = {
  person: 'person', place: 'sted', object: 'genstand',
  organisation: 'organisation', concept: 'begreb',
};

export const STRENGTH_DA: Record<string, string> = {
  knows: 'ved', convinced: 'overbevist', suspects: 'mistænker',
  mistaken: 'tror fejlagtigt', denies: 'benægter', unaware: 'uvidende',
};

export const TRUTH_DA: Record<string, string> = {
  true: 'sandt', false: 'falsk', disputed: 'omstridt', undecided: 'uafklaret',
};

export const SOURCE_DA: Record<string, string> = {
  stated: 'nedskrevet', derived: 'var til stede', carried: 'bærer det på sig',
};

export const MODE_DA: Record<string, string> = {
  dramatised: 'dramatiseret', mentioned: 'omtalt', implied: 'antydet',
};

export const LINK_DA: Record<string, string> = {
  before: 'før', after: 'efter', same_time: 'samtidig med',
  offset: 'forskudt fra', during: 'under',
};
