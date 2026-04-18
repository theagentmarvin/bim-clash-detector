# BIM Clash Curator — Session Report
**Date:** 2026-04-18
**Project:** bim-clash-detector
**Repo:** https://github.com/theagentmarvin/bim-clash-detector

---

## What was done today

Performance audit of the clash detection selection pipeline + targeted bug fixes.

### Performance Audit Findings

**Root cause identified:** Selecting a large IFC category (e.g., `IfcFlowFitting` with thousands of elements) caused two simultaneous problems:

1. **Memory accumulation** — `highlightByTypes` created one `THREE.Mesh` + one `THREE.BufferGeometry` per element. For 3,000 fittings = 3,000 heap allocations + 3,000 draw calls, all synchronously before the next frame.

2. **Main thread blocking** — bounding box computation for each element scanned all faces in the merged geometry. First-time selection of a large category blocked the UI for 200–500ms.

3. **State race condition** — `onSelectionAChange` / `onSelectionBChange` had no coordination. Rapidly switching categories left orphaned meshes and stale material state.

### Three Improvements Implemented

#### Improvement 1 — InstancedMesh (10× draw call reduction)

Replaced per-element subset meshes with `THREE.InstancedMesh`. One draw call regardless of element count.

**File:** `src/geometry/instanced-highlight.ts`

**Pattern:**
```
highlightWithInstancing(modelData, [id1, id2, ..., idN], 0x3b82f6)
→ one InstancedMesh, N instance matrices
→ one draw call
```

Each element is represented by a **bounding box proxy** (unit cube scaled to the element's actual bbox). Proxies are stored in an `activeHighlights` registry keyed by `(elementCount, colorHex)`. Replacing a highlight disposes the prior `InstancedMesh` + material immediately.

**BBox source:** Pre-built `bboxByExpressId: Map<number, {min, max}>` on `LoadedModelData`, populated once at model load time from the IFC loader's existing `computeBBoxFromPlacedGeos` output. `getElementBBox` reads this map in O(1) — no face scanning on first access.

#### Improvement 2 — AbortController + chunked async highlighting

**File:** `src/hooks/useClashSelection.ts`

`SelectionManager` singleton wraps all highlight operations in an `AbortController`. On `setSelectionA` or `setSelectionB`:
1. Prior `AbortController.abort()` fires immediately
2. New `AbortController` created
3. Phase transitions: `loaded → highlighting_A/B`
4. Chunked loop (CHUNK_SIZE=250): for every 250 elements, `await new Promise(r => setTimeout(r, 0))` yields to main thread
5. Phase transitions to `loaded` or `ready` on completion

**Effect:** Main thread stays responsive. New category selection cancels prior immediately. No orphaned meshes.

#### Improvement 3 — Selection state machine

**File:** `src/hooks/useClashSelection.ts`

Formal phase transitions (`idle → loaded → highlighting_A/B → ready → detecting → results`) with `AbortController` lifecycle owned by the manager. `isReady = phase === 'ready'` drives the run button — bound via `selectionManager.onPhaseChange(() => updateRunButton())` so the button auto-enables when both async highlights complete.

### Bug Fixes

#### Run button stayed disabled after selecting both categories
**Cause:** `updateRunButton()` called synchronously in the change handlers, before async `setSelectionA`/`setSelectionB` completed. **Fix:** `updateRunButton` now subscribes to `selectionManager.onPhaseChange()` — fires automatically when phase reaches `ready`.

#### Matrix blank after first detection run
**Cause:** `renderClashMatrix()` called before `window.__clashResults = clashes` was set. **Fix:** window state vars written first, then `renderClashMatrix()` called.

#### No zoom on clash card click
**Cause:** `highlightClashElements` created highlight meshes but never moved the camera. **Fix:** Camera now animates to `clash.centroid` with offset 2.5× the max element dimension, `controls.target` set to centroid.

---

## IFC Viewer Architecture — Key Lessons Learned

These patterns apply to any browser-based IFC viewer using web-ifc + Three.js.

### Lesson 1 — Merged geometry is the right default for display; per-element data must be indexed separately

**Pattern used:** One `THREE.Mesh` per IFC model (merged `BufferGeometry`). All triangles of all elements share one draw call. Vertex positions and expressID lookup are separate arrays.

**Why it matters for selection:** On click, you get a face index. You need `expressIDLookup[faceIndex]` to find which element was clicked. This requires the lookup array to be built during the merge — not after. The `expressIDLookup` must be `Int32Array` indexed by face index (face × 3), not by vertex index.

**Mistake to avoid:** Building the expressID lookup as a separate post-processing step. It must be built during the geometry merge so face→expressID mapping is 1:1 with the final index buffer.

### Lesson 2 — Bounding boxes must be computed at load time, not on demand

Computing bounding boxes from merged geometry faces is O(n·faces). For a merged mesh with millions of triangles, computing element bboxes on demand (e.g., on first category selection) blocks the main thread for seconds.

**Correct pattern:** `computeBBoxFromPlacedGeos` in `loader.ts` iterates the `FlatMesh.geometries` (one per placed geometry instance, not per triangle) during the stream. Store the result as `element.bbox: {min, max}`. Build a `Map<expressID, bbox>` at load time. Selection highlighting reads from this map in O(1).

### Lesson 3 — web-ifc FlatMesh geometry APIs changed between versions

The `web-ifc` `0.0.x` API changed `FlatMesh.geometries` from `PlacedGeometry[]` (array) to `Vector<PlacedGeometry>` (class with `.size()` and `.get()` methods). TypeScript types in `web-ifc-api.d.ts` reflect this correctly. Using array methods on the Vector type causes runtime errors.

**Correct pattern for the Vector API:**
```typescript
for (let i = 0; i < placedGeos.size(); i++) {
  const pg = placedGeos.get(i);
  const geom = api.GetGeometry(modelId, pg.geometryExpressID);
  // ...
}
```

**Check:** `node_modules/web-ifc/web-ifc-api.d.ts` — the `PlacedGeometry` and `FlatMesh` interfaces are the source of truth.

### Lesson 4 — Memory leaks in Three.js highlight systems follow a predictable pattern

Three.js highlight leaks follow three failure modes:

1. **Unbounded mesh array** — adding meshes to an array without removing them. Fix: registry keyed by (model, color), replace on new selection, dispose on remove.

2. **Material not disposed** — `new THREE.MeshLambertMaterial()` per highlight, never calling `.dispose()`. WebGL material objects accumulate on the GPU. Fix: dispose material when removing highlight mesh.

3. **Geometry not disposed** — same as material. For InstancedMesh this is less of an issue since geometry is shared; for subset geometry per element it's critical.

**Rule:** Every `new THREE.Mesh(...)` that goes into the scene must be tracked in a registry. Removing from the registry means: `scene.remove(mesh)`, `mesh.geometry.dispose()`, `mesh.material.dispose()`.

### Lesson 5 — Async pattern for large operations: AbortController + chunking

The browser main thread must never block for >~50ms or the UI feels frozen. For large operations that must run synchronously (like building highlight geometry for thousands of elements):

```typescript
const CHUNK = 250;
for (let i = 0; i < elements.length; i += CHUNK) {
  if (signal.aborted) return;
  const chunk = elements.slice(i, i + CHUNK);
  processChunk(chunk);
  await new Promise(r => setTimeout(r, 0)); // yield
}
```

Wrap the whole thing in an `AbortController`. On new selection: `ctrl.abort()`. The `signal.aborted` check at the top of each iteration makes cancellation essentially instantaneous.

### Lesson 6 — State machine pattern for complex UI state

A flat `state` object with ad-hoc property updates is a maintenance liability. The selection pipeline has at least 6 distinct phases (`idle → loaded → highlighting_A → loaded → highlighting_B → ready → detecting → results`), any of which can transition to `idle` on model unload.

A reducer-style state machine:
- Makes invalid states unrepresentable
- Encapsulates side effects (AbortController, camera position, run button) in state transitions
- Makes the system auditable: every state change is an action in the reducer

### Lesson 7 — web-ifc WASM initialization is async

`WebIFC.Init()` returns a `Promise`. Do not call any IFC API methods until initialization completes. The `ifc/loader.ts` pattern:
```typescript
const api = new WebIFC.IfcAPI();
await api.Init();
```

---

## File Inventory (current)

```
src/
├── main.ts                           # App + viewer init, UI wiring, event handlers
├── components/
│   ├── ClashMatrix.ts                # Type-vs-type clash count heatmap grid
│   └── ClashResultsUI.ts             # Grouped clash results list (HARD/SOFT/CLEARANCE)
├── geometry/
│   └── instanced-highlight.ts        # InstancedMesh registry + bbox cache
├── hooks/
│   └── useClashSelection.ts          # SelectionManager singleton (state machine)
├── core/
│   ├── state.ts                      # Shared app state (scene, camera, renderer, models)
│   └── types.ts                      # IfcElement, Clash, LoadedModelData, ClashSettings
├── ifc/
│   ├── loader.ts                     # web-ifc → merged geometry + per-element AABB
│   └── test-loader.ts                # IFC loader smoke test
├── detection/
│   ├── broad-phase.ts                # BVH spatial index (n³ → n·log(n))
│   ├── narrow-phase.ts               # AABB intersection + overlap volume
│   └── tolerance.ts                  # Per-type tolerance (HARD=2mm, SOFT=5mm, CLEARANCE=10mm)
├── classification/
│   ├── clash-type.ts                 # HARD/SOFT/CLEARANCE classification
│   ├── severity.ts                   # Volume-based + structural penalty
│   └── deduplication.ts              # Spatial clustering, order-independent pair key
├── semantic/
│   ├── type-filter.ts                # IFC type compatibility
│   ├── storey-filter.ts              # Z-separation / level pre-filter
│   └── spatial-filter.ts             # Bounding box spatial filter
├── rules/
│   ├── engine.ts                     # runClashDetection() full pipeline
│   ├── types.ts                       # ClashRule, ClashRuleset interfaces
│   └── storage.ts                     # Ruleset save/load (not yet wired to UI)
└── export/
    ├── bcf.ts                        # BCF XML export
    ├── csv.ts                        # CSV export
    └── json.ts                       # JSON export
```

---

## Known Issues / Pending

- **BCF/CSV export not wired** to UI ("Export" button exists but no handler)
- **Ruleset save/load** — `storage.ts` and UI exist, not connected
- **SOFT/CLEARANCE thresholds** — all clashes classified as HARD; thresholds may be too strict
- **Chunk size (250)** — may need tuning for very large models (10k+ elements)
- **Partial element rendering on first selection** — with very large element counts, chunking means the first ~250 elements render immediately while the rest are still processing; this is intentional (avoids UI freeze) but the visual could be improved with a progress indicator

---

## Session Timeline

| Time | Event |
|------|-------|
| 02:41 | Session started — model: DeepSeek Reasoner |
| 02:43 | Audit launched: memory leak on category selection, cloned repo, analyzed main.ts |
| 02:50 | Audit complete: 4 findings, 3 improvements proposed, TOE validation confirmed (raw Three.js) |
| 02:52 | Spawned subagent to implement improvements |
| 02:55 | Subagent completed — files created but with broken imports |
| 02:56 | Fixed: useClashSelection.ts (wrong import path, THREE namespace missing), ClashResultsUI.ts (bad re-export), types.ts (missing types), loader.ts (Vector API bug), test-loader.ts (removed obsolete fields) |
| 03:00 | Build passes — committed: InstancedMesh + state machine + chunking |
| 07:26 | Boss tested: performance improved, but IfcFlowFitting still lagged on first select |
| 07:28 | Root cause: getElementBBox face-scanning on first access (O(n·faces) per element) |
| 07:30 | Fix 1: LoadedModelData.bboxByExpressId — pre-built map at load time, O(1) lookup |
| 07:32 | Fix 2: Run button wired to onPhaseChange() listener — auto-enables when phase → ready |
| 07:33 | Build passes — committed + pushed |
| 07:38 | Boss: performance good, run button fixed, but matrix blank on first run + no zoom on clash click |
| 07:40 | Fix 1: renderClashMatrix() called BEFORE window state vars set |
| 07:42 | Fix 2: highlightClashElements now animates camera to clash centroid |
| 07:43 | Build passes — committed + pushed |
| 07:57 | Boss confirmed working; session report + lessons learned documented |
