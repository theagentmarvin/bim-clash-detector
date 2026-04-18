import * as THREE from 'three';
import type { IfcElement } from '../core/types.js';

/**
 * Simple BVH (Bounding Volume Hierarchy) node for spatial indexing
 */
class BVHNode {
  bbox: THREE.Box3;
  elements: IfcElement[] = [];
  left: BVHNode | null = null;
  right: BVHNode | null = null;
  depth: number;

  constructor(bbox: THREE.Box3, depth: number = 0) {
    this.bbox = bbox;
    this.depth = depth;
  }

  isLeaf(): boolean {
    return this.left === null && this.right === null;
  }
}

/**
 * Builds a BVH from elements with bounding boxes
 */
function buildBVH(elements: IfcElement[], maxDepth: number = 10, maxElementsPerLeaf: number = 10): BVHNode | null {
  if (elements.length === 0) return null;

  // Filter elements that have bounding boxes
  const elementsWithBBox = elements.filter(el => el.bbox !== undefined);
  if (elementsWithBBox.length === 0) return null;

  // Create overall bounding box
  const overallBBox = new THREE.Box3();
  elementsWithBBox.forEach(el => {
    const bbox = el.bbox!;
    overallBBox.expandByPoint(new THREE.Vector3(bbox.min[0], bbox.min[1], bbox.min[2]));
    overallBBox.expandByPoint(new THREE.Vector3(bbox.max[0], bbox.max[1], bbox.max[2]));
  });

  const root = new BVHNode(overallBBox, 0);
  
  // Recursively build the BVH
  buildBVHRecursive(root, elementsWithBBox, 0, maxDepth, maxElementsPerLeaf);
  
  return root;
}

function buildBVHRecursive(
  node: BVHNode,
  elements: IfcElement[],
  depth: number,
  maxDepth: number,
  maxElementsPerLeaf: number
): void {
  // Stop recursion if we've reached max depth or have few elements
  if (depth >= maxDepth || elements.length <= maxElementsPerLeaf) {
    node.elements = elements;
    return;
  }

  // Find the axis with the largest extent for splitting
  const size = node.bbox.getSize(new THREE.Vector3());
  let splitAxis: 'x' | 'y' | 'z' = 'x';
  if (size.y > size.x && size.y > size.z) splitAxis = 'y';
  if (size.z > size.x && size.z > size.y) splitAxis = 'z';

  // Sort elements by their center along the split axis
  elements.sort((a, b) => {
    const aCenter = (a.bbox!.min[splitAxis === 'x' ? 0 : splitAxis === 'y' ? 1 : 2] + 
                    a.bbox!.max[splitAxis === 'x' ? 0 : splitAxis === 'y' ? 1 : 2]) / 2;
    const bCenter = (b.bbox!.min[splitAxis === 'x' ? 0 : splitAxis === 'y' ? 1 : 2] + 
                    b.bbox!.max[splitAxis === 'x' ? 0 : splitAxis === 'y' ? 1 : 2]) / 2;
    return aCenter - bCenter;
  });

  // Split elements into two halves
  const mid = Math.floor(elements.length / 2);
  const leftElements = elements.slice(0, mid);
  const rightElements = elements.slice(mid);

  // Create bounding boxes for children
  const leftBBox = new THREE.Box3();
  leftElements.forEach(el => {
    const bbox = el.bbox!;
    leftBBox.expandByPoint(new THREE.Vector3(bbox.min[0], bbox.min[1], bbox.min[2]));
    leftBBox.expandByPoint(new THREE.Vector3(bbox.max[0], bbox.max[1], bbox.max[2]));
  });

  const rightBBox = new THREE.Box3();
  rightElements.forEach(el => {
    const bbox = el.bbox!;
    rightBBox.expandByPoint(new THREE.Vector3(bbox.min[0], bbox.min[1], bbox.min[2]));
    rightBBox.expandByPoint(new THREE.Vector3(bbox.max[0], bbox.max[1], bbox.max[2]));
  });

  // Create child nodes
  node.left = new BVHNode(leftBBox, depth + 1);
  node.right = new BVHNode(rightBBox, depth + 1);

  // Recursively build children
  buildBVHRecursive(node.left, leftElements, depth + 1, maxDepth, maxElementsPerLeaf);
  buildBVHRecursive(node.right, rightElements, depth + 1, maxDepth, maxElementsPerLeaf);
}

/**
 * Query BVH for potential collisions between two sets of elements
 */
function queryBVH(
  bvhA: BVHNode | null,
  bvhB: BVHNode | null,
  pairs: Array<[IfcElement, IfcElement]>
): void {
  if (!bvhA || !bvhB) return;

  // If bounding boxes don't intersect, no collisions possible
  if (!bvhA.bbox.intersectsBox(bvhB.bbox)) return;

  // If both are leaves, test all element pairs
  if (bvhA.isLeaf() && bvhB.isLeaf()) {
    for (const elemA of bvhA.elements) {
      for (const elemB of bvhB.elements) {
        // Skip self-collision if comparing same element sets
        if (elemA === elemB) continue;
        
        const bboxA = new THREE.Box3(
          new THREE.Vector3(elemA.bbox!.min[0], elemA.bbox!.min[1], elemA.bbox!.min[2]),
          new THREE.Vector3(elemA.bbox!.max[0], elemA.bbox!.max[1], elemA.bbox!.max[2])
        );
        const bboxB = new THREE.Box3(
          new THREE.Vector3(elemB.bbox!.min[0], elemB.bbox!.min[1], elemB.bbox!.min[2]),
          new THREE.Vector3(elemB.bbox!.max[0], elemB.bbox!.max[1], elemB.bbox!.max[2])
        );
        
        if (bboxA.intersectsBox(bboxB)) {
          pairs.push([elemA, elemB]);
        }
      }
    }
    return;
  }

  // Recursively traverse the BVH
  if (!bvhA.isLeaf()) {
    queryBVH(bvhA.left, bvhB, pairs);
    queryBVH(bvhA.right, bvhB, pairs);
  } else if (!bvhB.isLeaf()) {
    queryBVH(bvhA, bvhB.left, pairs);
    queryBVH(bvhA, bvhB.right, pairs);
  }
}

/**
 * Naive O(n²) broad-phase detection for comparison/testing
 */
function naiveBroadPhase(
  elementsA: IfcElement[],
  elementsB: IfcElement[]
): Array<[IfcElement, IfcElement]> {
  const pairs: Array<[IfcElement, IfcElement]> = [];
  
  const filteredA = elementsA.filter(el => el.bbox !== undefined);
  const filteredB = elementsB.filter(el => el.bbox !== undefined);
  
  for (let i = 0; i < filteredA.length; i++) {
    const elemA = filteredA[i];
    const bboxA = new THREE.Box3(
      new THREE.Vector3(elemA.bbox!.min[0], elemA.bbox!.min[1], elemA.bbox!.min[2]),
      new THREE.Vector3(elemA.bbox!.max[0], elemA.bbox!.max[1], elemA.bbox!.max[2])
    );
    
    for (let j = 0; j < filteredB.length; j++) {
      const elemB = filteredB[j];
      // Skip if comparing same element (when elementsA === elementsB)
      if (elemA === elemB) continue;
      
      const bboxB = new THREE.Box3(
        new THREE.Vector3(elemB.bbox!.min[0], elemB.bbox!.min[1], elemB.bbox!.min[2]),
        new THREE.Vector3(elemB.bbox!.max[0], elemB.bbox!.max[1], elemB.bbox!.max[2])
      );
      
      if (bboxA.intersectsBox(bboxB)) {
        pairs.push([elemA, elemB]);
      }
    }
  }
  
  return pairs;
}

/**
 * Main broad-phase detection function
 * 
 * @param elementsA First set of IFC elements
 * @param elementsB Second set of IFC elements (can be same as elementsA for self-collision)
 * @param options Configuration options
 * @returns Array of candidate element pairs that potentially collide
 */
export function broadPhaseDetection(
  elementsA: IfcElement[],
  elementsB: IfcElement[],
  options?: { useSpatialIndex?: boolean }
): Array<[IfcElement, IfcElement]> {
  const useSpatialIndex = options?.useSpatialIndex ?? true;
  
  if (!useSpatialIndex) {
    return naiveBroadPhase(elementsA, elementsB);
  }
  
  // Build BVH for both sets
  const bvhA = buildBVH(elementsA);
  const bvhB = buildBVH(elementsB);
  
  const pairs: Array<[IfcElement, IfcElement]> = [];
  
  if (bvhA && bvhB) {
    queryBVH(bvhA, bvhB, pairs);
  }
  
  return pairs;
}