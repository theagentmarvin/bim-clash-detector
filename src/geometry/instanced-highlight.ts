/**
 * src/geometry/instanced-highlight.ts — InstancedMesh Highlight Registry
 *
 * Replaces per-element subset meshes with a single InstancedMesh per
 * (modelData, colorHex) pair. One draw call regardless of element count.
 *
 * Bounding boxes are computed per element from the merged geometry and cached
 * so repeated highlights are O(1) lookup.
 */

import * as THREE from 'three';
import type { LoadedModelData } from '../core/types';
import { state } from '../core/state';

// ─── Types ─────────────────────────────────────────────────────────────

interface HighlightInstance {
  modelData: LoadedModelData;
  expressIDs: number[];
  colorHex: number;
  instancedMesh: THREE.InstancedMesh;
}

// ─── Registry ─────────────────────────────────────────────────────────

/**
 * Registry of active InstancedMesh highlights.
 * Replaces the old unbounded `highlightMeshes[]` array.
 */
const activeHighlights = new Map<string, HighlightInstance>();

// ─── BBox Cache ───────────────────────────────────────────────────────

/**
 * Cached bounding boxes per expressID — avoids O(n) recomputation on
 * repeated highlights of the same element.
 */
const bboxCache = new Map<number, THREE.Box3>();

/**
 * Compute bounding box of a single element by reading all its faces
 * from the merged geometry index.
 */
export function getElementBBox(
  modelData: LoadedModelData,
  expressID: number,
): THREE.Box3 {
  const cached = bboxCache.get(expressID);
  if (cached) return cached;

  // Fast path: use the pre-built expressID → bbox map from IFC loading.
  // This is O(1) vs the O(n·faces) face-scan fallback below.
  if (modelData.bboxByExpressId) {
    const prebuilt = modelData.bboxByExpressId.get(expressID);
    if (prebuilt) {
      const bbox = new THREE.Box3(
        new THREE.Vector3(...prebuilt.min),
        new THREE.Vector3(...prebuilt.max),
      );
      bboxCache.set(expressID, bbox);
      return bbox;
    }
  }

  // Fallback: scan merged geometry faces — expensive, only runs once per
  // expressID that lacks pre-built bbox data.
  const bbox = new THREE.Box3();
  const geo = modelData.mesh.geometry;
  const index = geo.index!;
  const positions = geo.attributes.position;
  const count = index.count;

  for (let i = 0; i < count; i += 3) {
    if (modelData.expressIDLookup[Math.floor(i / 3)] !== expressID) continue;
    for (let j = 0; j < 3; j++) {
      const vi = index.getX(i + j);
      bbox.expandByPoint(
        new THREE.Vector3(
          positions.getX(vi),
          positions.getY(vi),
          positions.getZ(vi),
        ),
      );
    }
  }

  bboxCache.set(expressID, bbox);
  return bbox;
}

/**
 * Clear the bounding box cache (call when model is unloaded).
 */
export function clearBboxCache(): void {
  bboxCache.clear();
}

// ─── Unit Box Proxy ────────────────────────────────────────────────────

/** Shared unit cube geometry — scaled per element via instance matrices */
const BOX_GEO = new THREE.BoxGeometry(1, 1, 1);

// ─── Disposal ─────────────────────────────────────────────────────────

function disposeHighlight(key: string): void {
  const inst = activeHighlights.get(key);
  if (!inst) return;
  state.scene.remove(inst.instancedMesh);
  inst.instancedMesh.geometry.dispose();
  (inst.instancedMesh.material as THREE.Material).dispose();
  activeHighlights.delete(key);
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Highlight all elements matching `expressIDs` in a model using InstancedMesh.
 *
 * - One InstancedMesh per (elementCount, colorHex) pair
 * - One draw call regardless of element count
 * - Full replace on each call (disposes prior InstancedMesh)
 * - Bounding box proxy per element — a box scaled to the element's bbox size
 */
export function highlightWithInstancing(
  modelData: LoadedModelData,
  expressIDs: number[],
  colorHex: number,
): void {
  if (expressIDs.length === 0) return;

  const key = `${modelData.elementCount}-${colorHex}`;
  disposeHighlight(key); // clean up any prior highlight for this slot

  const instancedColor = new THREE.Color(colorHex);
  const mat = new THREE.MeshLambertMaterial({
    color: instancedColor,
    transparent: true,
    opacity: 0.75,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  const im = new THREE.InstancedMesh(BOX_GEO, mat, expressIDs.length);
  const dummy = new THREE.Object3D();

  for (let i = 0; i < expressIDs.length; i++) {
    const bbox = getElementBBox(modelData, expressIDs[i]);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    dummy.position.copy(center);
    dummy.scale.copy(size);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
  }

  im.instanceMatrix.needsUpdate = true;
  state.scene.add(im);

  activeHighlights.set(key, { modelData, expressIDs, colorHex, instancedMesh: im });
}

/**
 * Remove all active InstancedMesh highlights from the scene and dispose resources.
 */
export function clearAllInstancedHighlights(): void {
  for (const key of activeHighlights.keys()) {
    disposeHighlight(key);
  }
}
