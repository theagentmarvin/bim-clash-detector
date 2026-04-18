/**
 * main.ts — Clash Curator
 *
 * web-ifc direct loading. ONE merged BufferGeometry per model.
 * Per-element selection via subset highlighting (one draw call base + one highlight).
 *
 * Navisworks-style workflow:
 * 1. Selection A → pick IFC types from Structure model
 * 2. Selection B → pick IFC types from MEP model
 * 3. Run Detection → A vs B only
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { initIfc, loadIfcFromFile, loadIfc } from './ifc/loader';
import type { Clash, IfcElement, ModelType, LoadedModelData, ClashSettings } from './core/types';
import { state } from './core/state';
import { selectionManager, highlightClashElements } from './hooks/useClashSelection';
import { highlightWithInstancing, clearAllInstancedHighlights } from './geometry/instanced-highlight';
import { runClashDetection, filterElementsByTypes } from './rules/engine';
import { renderClashMatrix } from './components/ClashMatrix';
import { renderClashResults } from './components/ClashResultsUI';

// ─── BBox Lookup Helper ───────────────────────────────────────────────────────────

/**
 * Build a fast expressID → bbox lookup from pre-computed element bbox data.
 * This avoids the O(n·faces) face-scan that getElementBBox does on first access.
 */
function buildBboxLookup(elements: IfcElement[]): Map<number, { min: [number, number, number]; max: [number, number, number] }> {
  const map = new Map<number, { min: [number, number, number]; max: [number, number, number] }>();
  for (const el of elements) {
    if (el.bbox) map.set(el.expressID, el.bbox);
  }
  return map;
}

// ─── Click Selection (InstancedMesh) ─────────────────────────────────────────────
// highlightClashElements and clearAllInstancedHighlights are imported from hooks/geometry modules.
// Click-selection uses InstancedMesh — one draw call regardless of element count.

function selectElement(
  modelData: LoadedModelData,
  expressID: number,
): void {
  clearAllInstancedHighlights();
  highlightWithInstancing(modelData, [expressID], 0x3b82f6);
  console.log('[selection] expressID:', expressID);
}

// ─── Viewer ───────────────────────────────────────────────────────────────

function initViewer(): void {
  const container = document.getElementById('viewer')!;

  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0x0a0e19);

  state.camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.1,
    10000,
  );
  state.camera.position.set(10, 10, 10);

  state.renderer = new THREE.WebGLRenderer({ antialias: true });
  state.renderer.setSize(container.clientWidth, container.clientHeight);
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(state.renderer.domElement);

  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;
  state.controls.dampingFactor = 0.05;

  // Lighting
  state.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(10, 20, 10);
  state.scene.add(dir);
  state.scene.add(new THREE.AmbientLight(0xffffff, 0.3));

  // Grid + axes
  state.scene.add(new THREE.GridHelper(50, 50, 0x333333, 0x222222));
  state.scene.add(new THREE.AxesHelper(5));

  // Resize
  window.addEventListener('resize', () => {
    const c = document.getElementById('viewer')!;
    state.camera.aspect = c.clientWidth / c.clientHeight;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(c.clientWidth, c.clientHeight);
  });

  // Click selection
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  container.addEventListener('click', (e) => {
    const rect = container.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, state.camera);

    // Check all loaded models
    for (const data of [state.structure, state.mep]) {
      if (!data) continue;
      const hit = raycaster.intersectObject(data.mesh, false);
      if (hit.length > 0) {
        const faceIndex = hit[0].faceIndex ?? -1;
        if (faceIndex >= 0 && faceIndex < data.expressIDLookup.length) {
          const expressID = data.expressIDLookup[faceIndex];
          selectElement(data, expressID);
          return;
        }
      }
    }

    // Click on empty space — deselect
    clearAllInstancedHighlights();
  });

  // Render loop
  function animate(): void {
    requestAnimationFrame(animate);
    state.controls.update();
    state.renderer.render(state.scene, state.camera);
  }
  animate();
}

// ─── IFC Loading ────────────────────────────────────────────────────────

async function handleFileSelect(input: HTMLInputElement, type: 'structure' | 'mep'): Promise<void> {
  const file = input.files?.[0];
  if (!file) return;

  showLoading(`Loading ${type.toUpperCase()} IFC…`);

  try {
    const result = await loadIfcFromFile(file, type === 'structure' ? 1 : 2);

    // Create ONE mesh from merged geometry
    const material = new THREE.MeshLambertMaterial({
      color: new THREE.Color(0.6, 0.62, 0.65),
      flatShading: true,
    });

    const mesh = new THREE.Mesh(result.mergedGeometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    state.scene.add(mesh);

    const data: LoadedModelData = {
      mesh,
      expressIDLookup: result.expressIDLookup,
      elementCount: result.elements.length,
      levels: result.levels,
      categories: result.categories,
      elements: result.elements,
      bboxByExpressId: buildBboxLookup(result.elements),
    };

    if (type === 'structure') {
      state.structure = data;
    } else {
      state.mep = data;
    }

    // Fit camera
    fitCameraToModels();

    // Notify selection state machine that models are loaded
    selectionManager.dispatchModelsLoaded();

    // Update UI
    updateClashRulesPanel();
    updateUI();
    hideLoading();

    console.log(`[clash-curator] Loaded ${type}: ${result.elements.length} elements, ${result.levels.length} levels`);
  } catch (err) {
    console.error('[clash-curator] IFC load error:', err);
    hideLoading();
    alert('Error loading IFC: ' + (err as Error).message);
  }
}

function fitCameraToModels(): void {
  const box = new THREE.Box3();
  for (const child of state.scene.children) {
    if (child instanceof THREE.Mesh) box.expandByObject(child);
  }

  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    state.camera.position.set(
      center.x + maxDim * 1.5,
      center.y + maxDim * 1.5,
      center.z + maxDim * 1.5,
    );
    state.camera.lookAt(center);
    state.controls.target.copy(center);
    state.controls.update();
  }
}

// ─── Clash Rules Panel ─────────────────────────────────────────────────

/**
 * Returns all unique IFC types from Structure + MEP models.
 */
function getAllCategories(): string[] {
  const cats = new Set<string>([
    ...(state.structure?.categories ?? []),
    ...(state.mep?.categories ?? []),
  ]);
  return Array.from(cats).sort();
}

function updateClashRulesPanel(): void {
  const panel = document.getElementById('clashRulesPanel');
  if (!panel) return;

  const hasModels = state.structure !== null || state.mep !== null;
  panel.style.display = hasModels ? 'block' : 'none';

  // Force panel visible and scroll sidebar to top when models load
  if (hasModels) {
    panel.hidden = false;
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.scrollTop = 0;
  }

  const selASelect = document.getElementById('selectionASelect') as HTMLSelectElement;
  const selBSelect = document.getElementById('selectionBSelect') as HTMLSelectElement;

  // Get all categories for dropdowns
  const allCats = getAllCategories();

  // Populate Selection A dropdown (from structure categories)
  const structCats = state.structure?.categories ?? [];
  selASelect.innerHTML = '<option value="">— Select types —</option>';
  for (const cat of allCats) {
    const selected = state.settings.selectionA.includes(cat);
    selASelect.innerHTML += `<option value="${cat}" ${selected ? 'selected' : ''}>${cat}</option>`;
  }

  // Populate Selection B dropdown (from MEP categories)
  const mepCats = state.mep?.categories ?? [];
  selBSelect.innerHTML = '<option value="">— Select types —</option>';
  for (const cat of allCats) {
    const selected = state.settings.selectionB.includes(cat);
    selBSelect.innerHTML += `<option value="${cat}" ${selected ? 'selected' : ''}>${cat}</option>`;
  }

  // Update element counts for each selection
  updateSelectionCounts();

  // Update run button state
  updateRunButton();
}

function updateSelectionCounts(): void {
  const selACount = document.getElementById('selectionACount');
  const selBCount = document.getElementById('selectionBCount');

  // Filter structure elements by Selection A types
  const groupA = filterElementsByTypes(
    state.structure?.elements ?? [],
    state.settings.selectionA,
  );

  // Filter MEP elements by Selection B types
  const groupB = filterElementsByTypes(
    state.mep?.elements ?? [],
    state.settings.selectionB,
  );

  if (selACount) {
    selACount.textContent = state.settings.selectionA.length > 0
      ? `A: ${groupA.length} elements`
      : 'A: — elements';
  }

  if (selBCount) {
    selBCount.textContent = state.settings.selectionB.length > 0
      ? `B: ${groupB.length} elements`
      : 'B: — elements';
  }
}

function updateRunButton(): void {
  const btn = document.getElementById('runDetectionBtn') as HTMLButtonElement;
  const warning = document.getElementById('noRulesWarning');
  const isReady = selectionManager.isReady;

  if (btn) {
    btn.disabled = !isReady;
  }

  if (warning) {
    if (!isReady) {
      warning.style.display = 'block';
      warning.textContent = 'Select at least one type for both Selection A and B';
    } else {
      warning.style.display = 'none';
    }
  }
}

function onSelectionAChange(multiSelect: HTMLSelectElement): void {
  const selected = Array.from(multiSelect.selectedOptions)
    .map(opt => opt.value)
    .filter(v => v !== '');
  state.settings.selectionA = selected;
  updateSelectionCounts();
  // Delegate to selection state machine — handles AbortController + chunking
  selectionManager.setSelectionA(selected);
  updateRunButton();
}

function onSelectionBChange(multiSelect: HTMLSelectElement): void {
  const selected = Array.from(multiSelect.selectedOptions)
    .map(opt => opt.value)
    .filter(v => v !== '');
  state.settings.selectionB = selected;
  updateSelectionCounts();
  selectionManager.setSelectionB(selected);
  updateRunButton();
}

function onClashTypeChange(select: HTMLSelectElement): void {
  state.settings.clashType = select.value as ClashSettings['clashType'];
}

function onToleranceChange(input: HTMLInputElement): void {
  state.settings.tolerance = parseFloat(input.value) || 10;
}

// ─── Clash Detection ─────────────────────────────────────────────────────

function runDetection(): void {
  if (!state.structure || !state.mep) {
    alert('Load both Structure and MEP models first!');
    return;
  }

  const { selectionA, selectionB } = state.settings;

  if (!selectionA.length || !selectionB.length) {
    alert('Set Clash Rules first: select types for both Selection A and B.');
    return;
  }

  showLoading('Running clash detection…');
  selectionManager.dispatchRunDetection();

  // Defer to next frame so the loading overlay renders first
  setTimeout(() => {
    try {
      // ── Filter: Structure elements by Selection A types ──
      const groupA = filterElementsByTypes(state.structure!.elements, selectionA);
      // ── Filter: MEP elements by Selection B types ──
      const groupB = filterElementsByTypes(state.mep!.elements, selectionB);

      // Tag elements with their source model type for highlight targeting
      for (const el of groupA) el.modelType = 'structure';
      for (const el of groupB) el.modelType = 'mep';

      console.log(`[clash-detect] Selection A: ${groupA.length} elements (${selectionA.join(', ')})`);
      console.log(`[clash-detect] Selection B: ${groupB.length} elements (${selectionB.join(', ')})`);

      // Tolerance in mm → convert to metres for detection
      const toleranceM = state.settings.tolerance / 1000;

      const clashes = runClashDetection(groupA, groupB, null, {
        maxResults: 500,
        tolerance: toleranceM,
      });

      state.clashResults = clashes;

      console.log(`[clash-detect] Found ${clashes.length} clashes`);

      // Update results UI
      const resultsSection = document.getElementById('resultsSection')!;
      resultsSection.style.display = 'block';

      document.getElementById('clashCount')!.textContent = String(clashes.length);

      const hardCount = clashes.filter(c => c.type === 'HARD').length;
      const softCount = clashes.filter(c => c.type === 'SOFT').length;
      const clearanceCount = clashes.filter(c => c.type === 'CLEARANCE').length;

      document.getElementById('hardCount')!.textContent = String(hardCount);
      document.getElementById('softCount')!.textContent = String(softCount);
      document.getElementById('clearanceCount')!.textContent = String(clearanceCount);

      // Render grouped clash list items (no volume)
      renderClashResults(clashes);

      // Render clash matrix
      renderClashMatrix();

      // Expose state for matrix component reads
      (window as any).__clashResults = clashes;
      (window as any).__structureElements = state.structure?.elements ?? [];
      (window as any).__mepElements = state.mep?.elements ?? [];

      hideLoading();
      selectionManager.dispatchDetectionComplete();
    } catch (err) {
      console.error('[clash-detect] Error:', err);
      hideLoading();
      selectionManager.dispatchDetectionError((err as Error).message);
      alert('Clash detection failed: ' + (err as Error).message);
    }
  }, 50);
}

// renderClashResults is imported from ./components/ClashResultsUI

// ─── UI ──────────────────────────────────────────────────────────────

function updateUI(): void {
  const hasStr = state.structure !== null;
  const hasMep = state.mep !== null;
  const hasAny = hasStr || hasMep;

  document.getElementById('emptyState')!.style.display = hasAny ? 'none' : 'flex';
  document.getElementById('statsSection')!.style.display = hasAny ? 'block' : 'none';

  if (hasStr) {
    document.getElementById('structureSection')!.style.display = 'block';
    document.getElementById('structureMeta')!.textContent = `${state.structure!.elementCount} elements`;
  }
  if (hasMep) {
    document.getElementById('mepSection')!.style.display = 'block';
    document.getElementById('mepMeta')!.textContent = `${state.mep!.elementCount} elements`;
  }

  const totalEls = (state.structure?.elementCount || 0) + (state.mep?.elementCount || 0);
  document.getElementById('totalElements')!.textContent = String(totalEls);
  document.getElementById('totalTriangles')!.textContent = '—';

  const allLevels = [...new Set([
    ...(state.structure?.levels || []),
    ...(state.mep?.levels || []),
  ])].sort();

  document.getElementById('totalLevels')!.textContent = String(allLevels.length);
  document.getElementById('totalCategories')!.textContent = String(
    new Set([...(state.structure?.categories || []), ...(state.mep?.categories || [])]).size
  );

  if (allLevels.length > 0) {
    document.getElementById('levelsSection')!.style.display = 'block';
    document.getElementById('levelsList')!.innerHTML = allLevels
      .map(l => `<span class="level-chip">${l}</span>`).join('');
  }

  // Populate clash rules panel after models load
  updateClashRulesPanel();

  // Show matrix panel when models are loaded
  const matrixPanel = document.getElementById('matrixPanel');
  if (matrixPanel && (state.structure !== null || state.mep !== null)) {
    matrixPanel.style.display = 'block';
  }
}

function showLoading(text: string): void {
  document.getElementById('loadingText')!.textContent = text;
  document.getElementById('loadingOverlay')!.classList.add('visible');
}

function hideLoading(): void {
  document.getElementById('loadingOverlay')!.classList.remove('visible');
}

function setupDragDrop(): void {
  for (const { id, type } of [
    { id: 'structureDrop', type: 'structure' as const },
    { id: 'mepDrop', type: 'mep' as const },
  ]) {
    const el = document.getElementById(id)!;
    el.addEventListener('dragover', (e: DragEvent) => { e.preventDefault(); el.classList.add('dragover'); });
    el.addEventListener('dragleave', () => el.classList.remove('dragover'));
    el.addEventListener('drop', (e: DragEvent) => {
      e.preventDefault();
      el.classList.remove('dragover');
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      const input = document.getElementById(type + 'Input') as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      handleFileSelect(input, type);
    });
  }
}

// ─── Window handlers ────────────────────────────────────────────────

(window as any).handleFileSelect = handleFileSelect;
(window as any).resetView = () => {
  selectionManager.clearHighlights();
  fitCameraToModels();
};
(window as any).toggleSidebar = () => document.getElementById('sidebar')!.classList.toggle('collapsed');
(window as any).toggleTheme = () => {};
(window as any).toggleMatrixPanel = () => {
  const content = document.getElementById('matrixPanelContent');
  const icon = document.getElementById('matrixToggleIcon');
  if (content) {
    const isHidden = content.style.display === 'none';
    content.style.display = isHidden ? '' : 'none';
    if (icon) icon.textContent = isHidden ? '▾' : '▸';
  }
};
(window as any).runDetection = runDetection;
(window as any).onSelectionAChange = onSelectionAChange;
(window as any).onSelectionBChange = onSelectionBChange;
(window as any).onClashTypeChange = onClashTypeChange;
(window as any).onToleranceChange = onToleranceChange;

// ─── Init ─────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  console.log('[clash-curator] Initializing…');

  // Suppress web-ifc BRep triangulation errors (harmless, just noisy)
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const msg = args[0]?.toString() || '';
    if (msg.includes('[WEB-IFC][error][TriangulateBounds()]')) {
      return; // Suppress BRep errors
    }
    originalError.apply(console, args);
  };

  initViewer();
  await initIfc();
  setupDragDrop();

  // Auto-load sample IFC files on startup
  await loadSampleIfcFiles();

  // Show matrix panel when models are loaded
  const matrixPanel = document.getElementById('matrixPanel');
  if (matrixPanel && (state.structure !== null || state.mep !== null)) {
    matrixPanel.style.display = 'block';
  }

  // Set up selection change handlers
  const selASelect = document.getElementById('selectionASelect') as HTMLSelectElement;
  const selBSelect = document.getElementById('selectionBSelect') as HTMLSelectElement;
  const clashTypeSelect = document.getElementById('clashTypeSelect') as HTMLSelectElement;
  const toleranceInput = document.getElementById('toleranceInput') as HTMLInputElement;

  selASelect?.addEventListener('change', () => onSelectionAChange(selASelect));
  selBSelect?.addEventListener('change', () => onSelectionBChange(selBSelect));
  clashTypeSelect?.addEventListener('change', () => onClashTypeChange(clashTypeSelect));
  toleranceInput?.addEventListener('input', () => onToleranceChange(toleranceInput));

  // Auto-update run button whenever selection phase changes
  // (handles async setSelectionA/setSelectionB completion)
  selectionManager.onPhaseChange(() => updateRunButton());
  updateRunButton(); // initial state

  console.log('[clash-curator] Ready. Load Structure + MEP IFC files.');
}

// ─── Auto-load sample files ──────────────────────────────────────────

async function loadSampleIfcFiles(): Promise<void> {
  try {
    // Load Structure
    console.log('[clash-curator] Loading Structure: STRUCTURAL_VDC.ifc');

    const structureResponse = await fetch('/STRUCTURAL_VDC.ifc');
    if (!structureResponse.ok) throw new Error(`Failed to fetch Structure: ${structureResponse.status}`);

    const structureBuffer = await structureResponse.arrayBuffer();
    const structureResult = await loadIfc(new Uint8Array(structureBuffer), 1);

    const structureMaterial = new THREE.MeshLambertMaterial({
      color: new THREE.Color(0.6, 0.62, 0.65),
      flatShading: true,
    });

    const structureMesh = new THREE.Mesh(structureResult.mergedGeometry, structureMaterial);
    structureMesh.castShadow = true;
    structureMesh.receiveShadow = true;
    state.scene.add(structureMesh);

    state.structure = {
      mesh: structureMesh,
      expressIDLookup: structureResult.expressIDLookup,
      elementCount: structureResult.elements.length,
      levels: structureResult.levels,
      categories: structureResult.categories,
      elements: structureResult.elements,
      bboxByExpressId: buildBboxLookup(structureResult.elements),
    };

    console.log(`[clash-curator] Loaded Structure: ${structureResult.elements.length} elements`);

    // Load MEP
    console.log('[clash-curator] Loading MEP: MECHANICAL.ifc');

    const mepResponse = await fetch('/MECHANICAL.ifc');
    if (!mepResponse.ok) throw new Error(`Failed to fetch MEP: ${mepResponse.status}`);

    const mepBuffer = await mepResponse.arrayBuffer();
    const mepResult = await loadIfc(new Uint8Array(mepBuffer), 2);

    const mepMaterial = new THREE.MeshLambertMaterial({
      color: new THREE.Color(0.7, 0.75, 0.8),
      flatShading: true,
    });

    const mepMesh = new THREE.Mesh(mepResult.mergedGeometry, mepMaterial);
    mepMesh.castShadow = true;
    mepMesh.receiveShadow = true;
    state.scene.add(mepMesh);

    state.mep = {
      mesh: mepMesh,
      expressIDLookup: mepResult.expressIDLookup,
      elementCount: mepResult.elements.length,
      levels: mepResult.levels,
      categories: mepResult.categories,
      elements: mepResult.elements,
      bboxByExpressId: buildBboxLookup(mepResult.elements),
    };

    console.log(`[clash-curator] Loaded MEP: ${mepResult.elements.length} elements`);

    // Fit camera to both models
    fitCameraToModels();

    // Update UI
    updateClashRulesPanel();
    updateUI();

  } catch (err) {
    console.error('[clash-curator] Failed to load sample IFC files:', err);
    // Continue without samples - user can still drag & drop
  }
}

init().catch(console.error);
