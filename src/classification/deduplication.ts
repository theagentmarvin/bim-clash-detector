import type { Clash } from '../core/types.js';

/**
 * Deduplicates clash results by element pair.
 * A clash between element 100 and 200 is the same as 200 and 100.
 * Also handles same-element duplicates based on ruleset rules.
 */
export class ClashDeduplicator {
  /**
   * Remove duplicate clashes from an array.
   * Keeps the clash with higher severity score when duplicates are found.
   */
  deduplicate(clashes: Clash[]): Clash[] {
    const seen = new Map<string, Clash>();

    for (const clash of clashes) {
      const key = this.makeKey(clash);
      const existing = seen.get(key);

      if (!existing || clash.severity > existing.severity) {
        seen.set(key, clash);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Group clashes by element pair (ignoring order).
   */
  groupByPair(clashes: Clash[]): Map<string, Clash[]> {
    const groups = new Map<string, Clash[]>();

    for (const clash of clashes) {
      const key = this.makeKey(clash);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(clash);
    }

    return groups;
  }

  /**
   * Filter clashes by minimum severity score.
   */
  filterByMinSeverity(clashes: Clash[], minScore: number): Clash[] {
    return clashes.filter(c => c.severity >= minScore);
  }

  /**
   * Filter clashes by clash type.
   */
  filterByType(clashes: Clash[], types: Clash['type'][]): Clash[] {
    if (!types.length) return clashes;
    const typeSet = new Set(types);
    return clashes.filter(c => typeSet.has(c.type));
  }

  /**
   * Limit total clashes to maxCount (keeping highest severity).
   */
  limit(clashes: Clash[], maxCount: number): Clash[] {
    const sorted = [...clashes].sort((a, b) => b.severity - a.severity);
    return sorted.slice(0, maxCount);
  }

  /**
   * Make a canonical key for an element pair (order-independent).
   */
  private makeKey(clash: Clash): string {
    const idA = Math.min(clash.elementA.expressID, clash.elementB.expressID);
    const idB = Math.max(clash.elementA.expressID, clash.elementB.expressID);
    return `${idA}:${idB}`;
  }
}

/**
 * Default deduplicator instance.
 */
export const defaultDeduplicator = new ClashDeduplicator();