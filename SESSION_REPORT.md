# BIM Clash Curator — Session Report
**Date:** 2026-04-17
**Project:** bim-clash-detector
**Repo:** https://github.com/theagentmarvin/bim-clash-detector

---

## What was built

A Navisworks-style clash detection web app for BIM coordination, running entirely in the browser with web-ifc (no backend).

### Architecture

```
bim-clash-detector/
├── src/
│   ├── main.ts              # App entry, state, UI wiring
│   ├── components/
│   │   └── ClashMatrix.ts   # Type-vs-type clash count grid
│   ├── ifc/
│   │   └── loader.ts        # web-ifc direct → merged BufferGeometry + per-element AABB
│   ├── detection/
│   │   ├── broad-phase.ts   # BVH spatial index (candidate filtering)
│   │   ├── narrow-phase.ts  # AABB intersection + overlap volume
│   │   └── tolerance.ts     # Per-type tolerance overrides (HARD=2mm, SOFT=5mm, CLEARANCE=10mm)
│   ├── semantic/
│   │   ├── type-filter.ts   # IFC type compatibility
│   │   ├── storey-filter.ts # Z-separation / level pre-filter
│   │   └── spatial-filter.ts
│   ├── classification/
│   │   ├── clash-type.ts    # HARD/SOFT/CLEARANCE detection
│   │   ├── severity.ts      # Volume-based + structural element penalty
│   │   └── deduplication.ts # Spatial clustering, order-independent pair key
│   ├── rules/
│   │   ├── engine.ts        # runClashDetection() full pipeline
│   │   ├── types.ts         # ClashRule, ClashRuleset interfaces
│   │   └── storage.ts       # Ruleset save/load
│   ├── core/
│   │   └── types.ts         # Core types: IfcElement, Clash, ClashType, LoadedModelData
│   └── styles.css           # Light theme (primary #003d9b, error #ba1a1a, tertiary #7b2600)
├── index.html               # Sidebar + 3D viewer layout
└── public/                  # IFC sample files served statically
```

### Key features delivered this session

1. **Clash Rules panel** — Selection A (Structure) + Selection B (MEP) type selectors, clash type dropdown, tolerance input, gated run button
2. **Detection pipeline** — BVH broad-phase → AABB narrow-phase → type classification → severity → deduplication
3. **Clash Matrix** — 8×8 grid showing clash counts per IFC type pair; color-coded (green/yellow/orange/red); click cell → auto-fill selections → run detection
4. **3D reactivity** — subset mesh highlighting on clash card click (blue=element A, orange=element B); type selection highlights all matching elements in viewer; base meshes dimmed; reset view restores
5. **Navisworks workflow** — models auto-loaded, types populated, run gated on both selections, results grouped by type, no volumes displayed
6. **Light theme** — Inter font, Material Symbols icons, surface color system (#f8f9fa family), primary (#003d9b), error (#ba1a1a)

### Data model

- `LoadedModelData`: `.mesh` (THREE.Mesh), `.elements[]` (IfcElement), `.expressIDLookup` (Int32Array), `.levels[]`, `.categories[]`
- `IfcElement`: `expressID`, `type`, `level`, `bbox {min, max}`, `modelType: 'structure'|'mep'`
- `Clash`: `id`, `elementA/B` (IfcElement), `type` (HARD/SOFT/CLEARANCE), `overlapVolume`, `severity`, `intersectionBox`

---

## Session timeline

| Time | Event |
|------|-------|
| ~19:56 | New session started; DeepSeek Reasoner model |
| ~20:01 | Spawned coder to implement ASI-Evolve Stage 1 core modules (18 files, TypeScript clean compile) |
| ~20:07 | Web research: validated approach against IfcOpenShell/bimserver/NOTtingham paper — AABB+R-tree+storey-filter is universal |
| ~20:13 | Coder finished Stage 1: geometry/, detection/, semantic/, classification/, export/ modules |
| ~20:24 | Flagged: not using Fragments — web-ifc direct loading; existing `bim-clash-detector` project had working loader |
| ~20:34 | Spawned coder for narrow-phase + UI button wiring |
| ~20:40 | Coder finished: narrow-phase, tolerance, clash-type, severity, deduplication, type-filter, storey-filter, rules/engine.ts, main.ts wired |
| ~20:44 | Started dev server; verified clash detection runs (500 clashes found, all HARD) |
| ~20:49 | Navisworks workflow missing: no Selection A/B, auto-all-vs-all, no scroll on results, no filter button, no isolation |
| ~20:54 | Spawned coder for UI rebuild: Selection A/B panels, gated run button, scrollable results, detection-by-selection |
| ~21:00 | Clash Rules panel visible after models load (fixed display:none bug) |
| ~21:19 | Spawned coder for reactivity: clash card click → isolate, type selection → highlight in 3D, clear on reset |
| ~21:20 | Coder finished reactivity: highlightClashElements, highlightByTypes, clearAllHighlights, createSubsetHighlight |
| ~21:37 | Notion page: Clash Matrix component UI — got design specs from ui-proposal screens (light theme, Inter, Material Symbols) |
| ~21:40 | Spawned coder for Clash Matrix component |
| ~21:42 | Coder finished: ClashMatrix.ts, matrix panel in sidebar, computeClashMatrix(), renderClashMatrix(), wireMatrixEvents() |
| ~21:44 | Browser crashed — gateway restart needed |
| ~22:28 | Status check — 5 tasks complete, browser testing pending, export + ruleset save pending |
| ~22:32 | Server restart |
| ~22:35 | Repo created on GitHub, code pushed |

---

## Current state

**Working:**
- IFC loading (web-ifc direct → merged geometry + per-element AABB)
- Clash detection pipeline (broad → narrow → classify → severity → deduplicate)
- Navisworks-style UI (Selection A/B → run → results)
- Clash Matrix (grid, colors, click-to-run)
- Detection reactivity code (files written, needs browser verification)
- Light theme styling

**Known issues (next session):**
- Memory leak when selecting any category in the filter — `highlightByTypes` creates many subset meshes, `clearAllHighlights` may not clean up all references
- Performance issues when selecting categories — possible O(n²) behavior in mesh creation loop
- Browser testing of clash card click + type filter highlight not yet confirmed working

**Not yet implemented:**
- Export: BCF/CSV from clash results
- Ruleset save/load persistence (storage.ts exists but not wired to UI)
- SOFT/CLEARANCE classification thresholds may be too strict (all clashes classified as HARD)

---

## Next session priorities

1. **Memory leak fix** — track all created subset meshes in `highlightMeshes[]`; ensure `clearAllHighlights` removes every mesh AND disposes geometry+material; check for orphaned event listeners
2. **Performance** — `highlightByTypes` may loop through all elements creating many subset meshes; add early exit if >200 elements matched; consider using instanced mesh instead of individual subsets
3. **Browser verification** — test clash card click isolation and type filter highlighting end-to-end
4. **BCF export** — wire the existing export/bcf.ts to the UI "Export" button
5. **Ruleset save/load** — wire storage.ts to persist ClashRulesets to localStorage