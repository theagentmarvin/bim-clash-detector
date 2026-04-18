# BIM Clash Detector — Performance Improvements Spec

## Context

The clash detector loads two IFC models (Structure + MEP) as merged `BufferGeometry` meshes. When a user selects a category (e.g., "IfcDuct" with 3,000 elements), `highlightByTypes` creates one `THREE.Mesh` + `THREE.BufferGeometry` per element — 3,000 draw calls, 3,000 heap allocations, all on the main thread before the next frame. This causes memory growth and UI freeze.

**Current stack:** Raw Three.js `^0.175.0` + web-ifc `^0.0.74`. No That Open Engine dependency. All changes must stay within this stack.

---

## Improvement 1 — InstancedMesh for Category Highlighting

### Problem
`createSubsetHighlight` creates a new `BufferGeometry` + `Mesh` per element. For 3,000 fittings = 3,000 draw calls + 3,000 heap allocations.

### Solution
Use `THREE.InstancedMesh` with **element bounding box proxies**. Instead of extracting element faces from the merged geometry, render a simplified box per selected element using `InstancedMesh`. One draw call regardless of element count.

### Implementation

**New file: `src/geometry/instanced-highlight.ts`**

```typescript
import * as THREE from 'three';

interface HighlightInstance {
  modelData: LoadedModelData;
  expressIDs: number[];
  colorHex: number;
  instancedMesh: THREE.InstancedMesh;
}

/**
 * Registry of active InstancedMesh highlights, keyed by modelData pointer.
 * Replaces the old `highlightMeshes[]` array.
 */
const activeHighlights = new Map<string, HighlightInstance>();

/**
 * Get stable key for a LoadedModelData object.
 */
function modelKey(modelData: LoadedModelData): string {
  return `${modelData.elementCount}-${modelData.categories.join(',')}`;
}

/**
 * Compute the bounding box of a single element from the merged geometry.
 * Reads vertex positions for all faces belonging to the element's expressID.
 * Results are cached in a Map to avoid re-computation on repeated highlights.
 */
const bboxCache = new Map<number, THREE.Box3>();

export function getElementBBox(
  modelData: LoadedModelData,
  expressID: number
): THREE.Box3 {
  const cached = bboxCache.get(expressID);
  if (cached) return cached;

  const bbox = new THREE.Box3();
  const geo = modelData.mesh.geometry;
  const index = geo.index!;
  const positions = geo.attributes.position;
  const count = index.count;

  for (let i = 0; i < count; i += 3) {
    if (modelData.expressIDLookup[i / 3] !== expressID) continue;
    for (let j = 0; j < 3; j++) {
      const vi = index.getX(i + j);
      bbox.expandByPoint(
        new THREE.Vector3(
          positions.getX(vi),
          positions.getY(vi),
          positions.getZ(vi)
        )
      );
    }
  }

  bboxCache.set(expressID, bbox);
  return bbox;
}

/**
 * Clear cached bounding boxes (call when model is unloaded).
 */
export function clearBboxCache(): void {
  bboxCache.clear();
}

/**
 * Build a bounding box proxy geometry (unit cube, scaled per element).
 */
const BOX_GEO = new THREE.BoxGeometry(1, 1, 1);

/**
 * Remove any active InstancedMesh highlight for a model+color combo.
 */
function disposeHighlight(key: string): void {
  const inst = activeHighlights.get(key);
  if (!inst) return;
  state.scene.remove(inst.instancedMesh);
  inst.instancedMesh.geometry.dispose();
  (inst.instancedMesh.material as THREE.Material).dispose();
  activeHighlights.delete(key);
}

/**
 * Highlight all elements matching `expressIDs` in a model using InstancedMesh.
 * - One InstancedMesh per (modelData, colorHex) pair
 * - One draw call regardless of element count
 * - Reuses existing InstancedMesh if already present (updates instance count)
 */
export function highlightWithInstancing(
  modelData: LoadedModelData,
  expressIDs: number[],
  colorHex: number,
  scene: THREE.Scene
): void {
  if (expressIDs.length === 0) return;

  const instancedColor = new THREE.Color(colorHex);
  const mat = new THREE.MeshLambertMaterial({
    color: instancedColor,
    transparent: true,
    opacity: 0.75,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  // Create or reuse InstancedMesh
  const im = new THREE.InstancedMesh(BOX_GEO, mat, expressIDs.length);
  const dummy = new THREE.Object3D();

  for (let i = 0; i < expressIDs.length; i++) {
    const bbox = getElementBBox(modelData, expressIDs[i]);
    // Center the box at the element's bounding box center, scaled to its size
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
  scene.add(im);

  const key = `${modelData.elementCount}-${colorHex}`;
  disposeHighlight(key);
  activeHighlights.set(key, { modelData, expressIDs, colorHex, instancedMesh: im });
}

/**
 * Remove all active InstancedMesh highlights from scene.
 */
export function clearAllInstancedHighlights(): void {
  for (const [key, inst] of activeHighlights) {
    state.scene.remove(inst.instancedMesh);
    inst.instancedMesh.geometry.dispose();
    (inst.instancedMesh.material as THREE.Material).dispose();
  }
  activeHighlights.clear();
}
```

**Key constraints:**
- `state.scene` and `LoadedModelData` must be imported from `main.ts` or moved to a shared `src/core/state.ts`
- BBox computation reads the merged geometry index — runs on main thread but is O(n) per element; with caching it's O(1) on repeat
- BBox cache cleared on model unload to prevent unbounded growth

---

## Improvement 2 — AbortController + Chunked Highlighting

### Problem
For very large element sets (5,000+), even the InstancedMesh creation blocks the main thread while computing bounding boxes and building instance matrices.

### Solution
Chunk the highlight operation. After each chunk of N elements, yield to the browser main thread via `setTimeout(resolve, 0)` before continuing. Wrap everything in an `AbortController` so a new selection immediately cancels the in-flight prior operation.

### Implementation
In `src/main.ts`, replace the current `highlightByTypes` with a chunked version:

```typescript
// Replace the global highlightMeshes[] and related functions:
// - Remove: highlightMeshes array
// - Remove: originalMaterialsRef Map (replace with scoped cleanup)
// - Remove: createSubset, createSubsetHighlight, dimMesh, restoreMesh, storeOriginalMaterial
// - Remove: clearAllHighlights (replace with clearAllInstancedHighlights)

let currentAbortController: AbortController | null = null;

async function highlightByTypes(
  types: string[],
  modelData: LoadedModelData | null,
  colorHex: number
): Promise<void> {
  // ── Cancellation: abort prior in-flight operation ──────────────────
  currentAbortController?.abort();
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  if (!modelData || types.length === 0) {
    clearAllInstancedHighlights();
    return;
  }

  // ── Early cancel check ───────────────────────────────────────────────
  if (signal.aborted) return;

  // ── Collect matching elements ───────────────────────────────────────
  const matching = modelData.elements.filter(el => types.includes(el.type));
  if (matching.length === 0) {
    clearAllInstancedHighlights();
    return;
  }

  // ── Dim base mesh (one material update, not per-element) ────────────
  const mesh = modelData.mesh;
  const baseMat = mesh.material as THREE.MeshStandardMaterial;
  // Store original material state so we can restore later
  if (!('_origColor' in baseMat)) {
    (baseMat as any)._origColor = baseMat.color.clone();
    (baseMat as any)._origOpacity = baseMat.opacity;
    (baseMat as any)._origTransparent = baseMat.transparent;
  }
  baseMat.color.set(0x333333);
  baseMat.transparent = true;
  baseMat.opacity = 0.4;
  baseMat.needsUpdate = true;

  // ── Chunked InstancedMesh creation ──────────────────────────────────
  const CHUNK_SIZE = 250;
  const expressIDs = matching.map(el => el.expressID);

  for (let i = 0; i < expressIDs.length; i += CHUNK_SIZE) {
    if (signal.aborted) return;
    const chunk = expressIDs.slice(i, i + CHUNK_SIZE);
    highlightWithInstancing(modelData, chunk, colorHex, state.scene);
    // Yield to main thread — prevents UI freeze
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

function clearHighlightsAndRestore(): void {
  clearAllInstancedHighlights();
  // Restore base mesh materials
  for (const data of [state.structure, state.mep]) {
    if (!data) continue;
    const mat = data.mesh.material as THREE.MeshStandardMaterial;
    if ('_origColor' in mat) {
      mat.color.copy((mat as any)._origColor);
      mat.opacity = (mat as any)._origOpacity;
      mat.transparent = (mat as any)._origTransparent;
      mat.needsUpdate = true;
    }
  }
}
```

**Key behavior:**
- `highlightByTypes` is now `async` — callers must `await` or fire-and-forget
- New selection cancels the prior via `AbortController`
- Chunk size 250: enough to batch work, small enough to yield frequently
- `clearHighlightsAndRestore` replaces `clearAllHighlights`

---

## Improvement 3 — Selection State Machine with `useReducer`

### Problem
`onSelectionAChange` and `onSelectionBChange` fire in arbitrary order, calling `highlightByTypes` without coordination. No formal state means race conditions between selection changes and detection runs.

### Solution
Introduce a formal selection state machine using `useReducer` in a new `src/hooks/useClashSelection.ts` hook. All state transitions are centralized and atomic.

### State Schema

```typescript
type ClashPhase =
  | 'idle'           // No models loaded
  | 'loaded'         // Models loaded, no category selected
  | 'highlighting_A' // Selection A highlighting in progress
  | 'highlighting_B' // Selection B highlighting in progress
  | 'ready'          // Both selections made, ready to detect
  | 'detecting'      // Clash detection running
  | 'results';       // Results displayed

interface ClashSelectionState {
  phase: ClashPhase;
  selectionA: string[];       // selected IFC types for group A
  selectionB: string[];       // selected IFC types for group B
  abortController: AbortController | null;
  error: string | null;
}
```

### Actions

```typescript
type ClashAction =
  | { type: 'MODELS_LOADED' }
  | { type: 'SELECTION_A_CHANGE'; types: string[] }
  | { type: 'SELECTION_B_CHANGE'; types: string[] }
  | { type: 'HIGHLIGHT_A_COMPLETE' }
  | { type: 'HIGHLIGHT_B_COMPLETE' }
  | { type: 'RUN_DETECTION' }
  | { type: 'DETECTION_COMPLETE' }
  | { type: 'DETECTION_ERROR'; error: string }
  | { type: 'RESET' };
```

### Reducer Logic

```
idle + MODELS_LOADED                    → loaded
loaded + SELECTION_A_CHANGE             → highlighting_A
highlighting_A + HIGHLIGHT_A_COMPLETE   → loaded (or ready if B also set)
highlighting_B + HIGHLIGHT_B_COMPLETE   → ready (if both A and B set)
loaded + SELECTION_B_CHANGE             → highlighting_B
ready + RUN_DETECTION                   → detecting
detecting + DETECTION_COMPLETE          → results
results + SELECTION_A_CHANGE | SELECTION_B_CHANGE → highlighting_A | highlighting_B
any + DETECTION_ERROR                   → previous_phase, set error
any + RESET                            → idle
any + SELECTION_*_CHANGE (if abortCtrl active) → abort, start new
```

### Hook API

```typescript
// src/hooks/useClashSelection.ts

export function useClashSelection(): {
  state: ClashSelectionState;
  setSelectionA: (types: string[]) => void;
  setSelectionB: (types: string[]) => void;
  runDetection: () => Promise<Clash[]>;
  reset: () => void;
  isReady: boolean;
}
```

The hook owns the `AbortController` lifecycle. On `SELECTION_A_CHANGE` or `SELECTION_B_CHANGE`, it calls `abortController.abort()` on the prior controller before starting a new one. This guarantees that no two highlight operations run concurrently.

The hook also exposes `isReady = phase === 'ready'`, which replaces the manual `updateRunButton()` check — the button's disabled state binds directly to `!isReady`.

### Files to Change

| File | Change |
|---|---|
| `src/main.ts` | Remove inline `state.settings`, `onSelectionAChange`, `onSelectionBChange`. Replace with `useClashSelection()` hook. Remove `highlightMeshes[]`, `originalMaterialsRef`, `dimMesh`, `restoreMesh`, `storeOriginalMaterial`. Remove `renderClashResults` — move to separate `src/components/ClashResultsUI.ts`. |
| `src/hooks/useClashSelection.ts` | **New file** — full reducer implementation |
| `src/geometry/instanced-highlight.ts` | **New file** — InstancedMesh registry |
| `src/components/ClashResultsUI.ts` | **New file** — extracted results rendering |

---

## Implementation Order

1. **Improve 3 first** — State machine establishes the contract that Improvements 1 and 2 depend on (AbortController lifecycle)
2. **Improve 1 second** — InstancedMesh replaces the subset mesh approach
3. **Improve 2 third** — Chunking and async flow on top of InstancedMesh

---

## Validation Checklist

After each improvement:
- [ ] `npm run build` succeeds with no TypeScript errors
- [ ] Selecting a large category (500+ elements) does not freeze the UI for >100ms
- [ ] Rapidly switching between categories cancels the prior highlight (no duplicate meshes)
- [ ] Selecting a category, then a clash from results, then another category — no orphaned highlight meshes in the scene
- [ ] Memory: open DevTools Performance tab, select a large MEP category, switch twice. Heap should not grow unbounded
