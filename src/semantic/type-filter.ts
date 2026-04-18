import type { IfcElement } from '../core/types.js';

/**
 * Filters elements by IFC type (category).
 */
export function filterByType(
  elements: IfcElement[],
  allowedTypes: string[],
): IfcElement[] {
  if (!allowedTypes.length) return elements;
  const typeSet = new Set(allowedTypes.map(t => t.toUpperCase()));
  return elements.filter(el => typeSet.has(el.type.toUpperCase()));
}

/**
 * Excludes elements by IFC type.
 */
export function excludeByType(
  elements: IfcElement[],
  excludedTypes: string[],
): IfcElement[] {
  if (!excludedTypes.length) return elements;
  const excludeSet = new Set(excludedTypes.map(t => t.toUpperCase()));
  return elements.filter(el => !excludeSet.has(el.type.toUpperCase()));
}

/**
 * Checks if an element's type matches any of the given type patterns.
 * Supports prefix wildcards (e.g., 'IFCWALL*' matches 'IfcWallStandardCase').
 */
export function typeMatches(element: IfcElement, patterns: string[]): boolean {
  if (!patterns.length) return true;
  const upperType = element.type.toUpperCase();
  return patterns.some(pattern => {
    if (pattern.endsWith('*')) {
      return upperType.startsWith(pattern.slice(0, -1).toUpperCase());
    }
    return upperType === pattern.toUpperCase();
  });
}

/**
 * Returns unique IFC types from a list of elements.
 */
export function getUniqueTypes(elements: IfcElement[]): string[] {
  const types = new Set<string>();
  for (const el of elements) types.add(el.type);
  return Array.from(types).sort();
}