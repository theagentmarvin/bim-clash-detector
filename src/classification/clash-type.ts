import type { ClashType, IfcElement } from '../core/types.js';

export { ClashType };

/**
 * Detects the type of clash between two elements.
 *
 * Detection logic:
 * - HARD clash: elements overlap in 3D (positive volume intersection)
 * - SOFT clash: elements are near each other (within clearance gap but don't touch)
 * - CLEARANCE clash: gap between elements is below minimum clearance distance
 *
 * For now, we treat all AABB overlaps as HARD clashes.
 * CLEARANCE detection would require analyzing actual mesh geometry
 * (computing minimum distance between surfaces).
 */
export function detectClashType(
  elemA: IfcElement,
  elemB: IfcElement,
  overlapVolume: number,
  clearanceDistance?: number,
): ClashType {
  // If there's actual volume overlap → HARD clash
  if (overlapVolume > 0) {
    return 'HARD';
  }

  // If clearance distance is provided and below threshold → CLEARANCE clash
  if (clearanceDistance !== undefined && clearanceDistance < 0.01) {
    return 'CLEARANCE';
  }

  // Default: SOFT clash (near-miss)
  return 'SOFT';
}

/**
 * Classifies a clash based on element type combination.
 * Used for rule-based clash classification.
 */
export function classifyByType(
  typeA: string,
  typeB: string,
  defaultType: ClashType = 'HARD',
): ClashType {
  // Common MEP + Structure clash combinations
  const upperA = typeA.toUpperCase();
  const upperB = typeB.toUpperCase();

  // Duct + beam/column → typically HARD if penetrating
  if ((upperA.includes('DUCT') || upperB.includes('DUCT')) &&
      (upperA.includes('BEAM') || upperA.includes('COLUMN') ||
       upperB.includes('BEAM') || upperB.includes('COLUMN'))) {
    return 'HARD';
  }

  // Pipe + slab/wall → typically HARD
  if ((upperA.includes('PIPE') || upperB.includes('PIPE')) &&
      (upperA.includes('SLAB') || upperA.includes('WALL') ||
       upperB.includes('SLAB') || upperB.includes('WALL'))) {
    return 'HARD';
  }

  return defaultType;
}

/**
 * Returns clash type label for display.
 */
export function getClashTypeLabel(type: ClashType): string {
  switch (type) {
    case 'HARD': return '🔴 Hard Clash';
    case 'SOFT': return '🟡 Soft Clash';
    case 'CLEARANCE': return '🟠 Clearance';
    default: return '❓ Unknown';
  }
}