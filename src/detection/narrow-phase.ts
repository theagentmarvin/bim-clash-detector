import * as THREE from 'three';
import type { IfcElement } from '../core/types.js';

/**
 * Result of narrow-phase collision detection between two elements.
 */
export interface NarrowPhaseResult {
  elementA: number; // expressID
  elementB: number; // expressID
  overlapVolume: number; // cubic meters
  intersectionBox: { min: [number, number, number]; max: [number, number, number] } | null;
}

/**
 * Takes broad-phase candidate pairs and performs precise AABB intersection tests.
 *
 * Algorithm:
 * 1. For each candidate pair, load their AABBs as Three.js Box3
 * 2. Expand both boxes by `tolerance` (mm) in all directions
 * 3. If boxes intersect → compute the intersection box
 * 4. Calculate overlap volume from intersection box dimensions
 *
 * @param candidates  Array of element pairs from broad-phase
 * @param tolerance  Expansion margin in meters (default 0.002m = 2mm)
 * @returns Array of narrow-phase results for intersecting pairs
 */
export function narrowPhaseDetection(
  candidates: Array<[IfcElement, IfcElement]>,
  tolerance: number = 0.002,
): NarrowPhaseResult[] {
  const results: NarrowPhaseResult[] = [];

  for (const [elemA, elemB] of candidates) {
    if (!elemA.bbox || !elemB.bbox) continue;

    // Create Three.js Box3 from element AABBs
    const boxA = new THREE.Box3(
      new THREE.Vector3(elemA.bbox.min[0], elemA.bbox.min[1], elemA.bbox.min[2]),
      new THREE.Vector3(elemA.bbox.max[0], elemA.bbox.max[1], elemA.bbox.max[2]),
    );
    const boxB = new THREE.Box3(
      new THREE.Vector3(elemB.bbox.min[0], elemB.bbox.min[1], elemB.bbox.min[2]),
      new THREE.Vector3(elemB.bbox.max[0], elemB.bbox.max[1], elemB.bbox.max[2]),
    );

    // Expand by tolerance before testing intersection
    boxA.expandByScalar(tolerance);
    boxB.expandByScalar(tolerance);

    // Check if expanded boxes intersect
    if (!boxA.intersectsBox(boxB)) continue;

    // Compute the actual intersection box (without tolerance expansion)
    // Use clone so we don't modify the originals
    const intersection = boxA.clone();
    intersection.intersect(boxB);

    // Only count if there's actual volume overlap (not just a shared edge or corner)
    const size = new THREE.Vector3();
    intersection.getSize(size);

    // Skip degenerate intersections (zero-volume: coplanar faces, edges, points)
    if (size.x <= 0 || size.y <= 0 || size.z <= 0) continue;

    const overlapVolume = size.x * size.y * size.z;

    results.push({
      elementA: elemA.expressID,
      elementB: elemB.expressID,
      overlapVolume,
      intersectionBox: {
        min: [intersection.min.x, intersection.min.y, intersection.min.z],
        max: [intersection.max.x, intersection.max.y, intersection.max.z],
      },
    });
  }

  return results;
}