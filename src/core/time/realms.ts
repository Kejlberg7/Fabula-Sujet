/**
 * Converting between the clocks of nested realms.
 *
 * A realm runs at `num/den` of its parent -- 20/1 for each dream level in the
 * Inception fixture, so ten minutes upstairs is over eight weeks four levels
 * down. The ratio alone is not enough to compare instants: `parentEpoch` and
 * `localEpoch` pin the two clocks to each other at one moment, and everything
 * else follows from there.
 *
 * Without a pinned epoch a realm's instants are simply not comparable with
 * anything outside it, and this module says so rather than guessing.
 */

export interface RealmClock {
  id: string;
  parentRealmId: string | null;
  timeRatioNum: number;
  timeRatioDen: number;
  parentEpoch: number | null;
  localEpoch: number | null;
}

export class RealmClocks {
  private readonly byId: Map<string, RealmClock>;

  constructor(realms: readonly RealmClock[]) {
    this.byId = new Map(realms.map((r) => [r.id, r]));
  }

  private get(id: string): RealmClock {
    const r = this.byId.get(id);
    if (!r) throw new Error(`Ukendt lag: ${id}`);
    return r;
  }

  /** The root of the chain: the realm with no parent. */
  rootOf(realmId: string): string {
    let current = this.get(realmId);
    while (current.parentRealmId) current = this.get(current.parentRealmId);
    return current.id;
  }

  /** Whether this realm's instants can be compared with the root's at all. */
  isAnchored(realmId: string): boolean {
    let current = this.get(realmId);
    while (current.parentRealmId) {
      if (current.parentEpoch == null || current.localEpoch == null) return false;
      current = this.get(current.parentRealmId);
    }
    return true;
  }

  /** A duration in this realm, expressed in the root realm's seconds. */
  spanToRoot(realmId: string, span: number): number {
    let current = this.get(realmId);
    let value = span;
    while (current.parentRealmId) {
      value = (value * current.timeRatioDen) / current.timeRatioNum;
      current = this.get(current.parentRealmId);
    }
    return value;
  }

  /** A duration in the root realm, expressed in this realm's seconds. */
  spanFromRoot(realmId: string, span: number): number {
    const chain = this.chainToRoot(realmId);
    let value = span;
    for (const realm of chain) {
      value = (value * realm.timeRatioNum) / realm.timeRatioDen;
    }
    return value;
  }

  /** An instant in this realm, expressed on the root realm's clock. */
  toRoot(realmId: string, instant: number): number {
    let current = this.get(realmId);
    let value = instant;
    while (current.parentRealmId) {
      if (current.parentEpoch == null || current.localEpoch == null) {
        throw new Error(`Laget "${current.id}" er ikke fæstnet til sin forælder`);
      }
      value = current.parentEpoch + ((value - current.localEpoch) * current.timeRatioDen) / current.timeRatioNum;
      current = this.get(current.parentRealmId);
    }
    return value;
  }

  /** An instant on the root clock, expressed in this realm's own time. */
  fromRoot(realmId: string, instant: number): number {
    const chain = this.chainToRoot(realmId);
    let value = instant;
    for (const realm of chain) {
      if (realm.parentEpoch == null || realm.localEpoch == null) {
        throw new Error(`Laget "${realm.id}" er ikke fæstnet til sin forælder`);
      }
      value = realm.localEpoch + ((value - realm.parentEpoch) * realm.timeRatioNum) / realm.timeRatioDen;
    }
    return value;
  }

  /** From the realm down-to-up, excluding the root itself. Outermost last. */
  private chainToRoot(realmId: string): RealmClock[] {
    const chain: RealmClock[] = [];
    let current = this.get(realmId);
    while (current.parentRealmId) {
      chain.push(current);
      current = this.get(current.parentRealmId);
    }
    return chain.reverse();
  }
}
