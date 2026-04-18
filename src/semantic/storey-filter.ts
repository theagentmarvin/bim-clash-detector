import type { IfcElement } from '../core/types.js';

/**
 * Filters elements by building level (storey).
 */
export function filterByLevel(
  elements: IfcElement[],
  allowedLevels: string[],
): IfcElement[] {
  if (!allowedLevels.length) return elements;
  const levelSet = new Set(allowedLevels.map(l => l.toLowerCase()));
  return elements.filter(el =>
    el.level != null && levelSet.has(el.level.toLowerCase())
  );
}

/**
 * Excludes elements by building level.
 */
export function excludeByLevel(
  elements: IfcElement[],
  excludedLevels: string[],
): IfcElement[] {
  if (!excludedLevels.length) return elements;
  const excludeSet = new Set(excludedLevels.map(l => l.toLowerCase()));
  return elements.filter(el =>
    el.level == null || !excludeSet.has(el.level.toLowerCase())
  );
}

/**
 * Returns elements from a specific level only.
 */
export function getElementsOnLevel(elements: IfcElement[], level: string): IfcElement[] {
  return elements.filter(el =>
    el.level != null && el.level.toLowerCase() === level.toLowerCase()
  );
}

/**
 * Returns unique levels from a list of elements (sorted).
 */
export function getUniqueLevels(elements: IfcElement[]): string[] {
  const levels = new Set<string>();
  for (const el of elements) {
    if (el.level) levels.add(el.level);
  }
  return Array.from(levels).sort();
}

/**
 * Checks if two elements are on the same level.
 */
export function isSameLevel(a: IfcElement, b: IfcElement): boolean {
  if (!a.level || !b.level) return false;
  return a.level.toLowerCase() === b.level.toLowerCase();
}

/**
 * Returns elements whose center Z is within a vertical band.
 * Useful for cross-floor clash detection with zSeparation threshold.
 */
export function filterByVerticalRange(
  elements: IfcElement[],
  minZ: number,
  maxZ: number,
): IfcElement[] {
  return elements.filter(el => {
    if (!el.bbox) return false;
    const centerZ = (el.bbox.min[2] + el.bbox.max[2]) / 2;
    return centerZ >= minZ && centerZ <= maxZ;
  });
}