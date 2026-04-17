/**
 * main.ts — Clash Curator
 *
 * web-ifc direct loading. ONE merged BufferGeometry per model.
 * Per-element selection via subset highlighting (one draw call base + one highlight).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { initIfc, loadIfcFromFile } from './ifc/loader';

// ─── State ────────────────────────────────────────────────────────────────

interface LoadedModelData {
  mesh: THREE.Mesh;
  expressIDLookup: Int32Array;
  elementCount: number;
  levels: string[];
  categories: string[];
}

const state = {
  structure: null as LoadedModelData | null,
  mep: null as LoadedModelData | null,
  scene: null as THREE.Scene,
  camera: null as THREE.PerspectiveCamera,
  renderer: null as THREE.WebGLRenderer,
  controls: null as OrbitControls,
  highlightMesh: null as THREE.Mesh | null,
};

// ─── Subset Highlighting ─────────────────────────────────────────────────
// Creates a subset geometry containing ONLY the faces of the selected element.
// Shares vertex buffers with base mesh but has its own index buffer.

function createSubset(
  baseGeometry: THREE.BufferGeometry,
  expressIDLookup: Int32Array,
  targetExpressID: number,
): THREE.BufferGeometry | null {
  // Collect face indices where expressID matches
  const faceIndices: number[] = [];
  for (let i = 0; i < expressIDLookup.length; i++) {
    if (expressIDLookup[i] === targetExpressID) faceIndices.push(i);
  }

  if (faceIndices.length === 0) return null;

  // Build new index buffer referencing the same vertices
  const baseIndex = baseGeometry.index!;
  const newIndices = new Uint32Array(faceIndices.length * 3);

  for (let i = 0; i < faceIndices.length; i++) {
    const face = faceIndices[i];
    const idx = face * 3;
    newIndices[i * 3] = baseIndex.getX(idx);
    newIndices[i * 3 + 1] = baseIndex.getX(idx + 1);
    newIndices[i * 3 + 2] = baseIndex.getX(idx + 2);
  }

  const subsetGeo = new THREE.BufferGeometry();
  subsetGeo.setAttribute('position', baseGeometry.attributes.position);
  subsetGeo.setAttribute('normal', baseGeometry.attributes.normal);
  subsetGeo.setIndex(new THREE.BufferAttribute(newIndices, 1));

  return subsetGeo;
}

function selectElement(
  model: LoadedModelData,
  expressID: number,
): void {
  clearHighlight();

  const subsetGeo = createSubset(model.mesh.geometry, model.expressIDLookup, expressID);
  if (!subsetGeo) return;

  const highlightMaterial = new THREE.MeshLambertMaterial({
    color: new THREE.Color(0x3b82f6),
    flatShading: true,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthTest: true,
  });

  const highlightMesh = new THREE.Mesh(subsetGeo, highlightMaterial);
  state.scene.add(highlightMesh);
  state.highlightMesh = highlightMesh;

  // Log element info
  console.log('[selection] expressID:', expressID);
}

function clearHighlight(): void {
  if (state.highlightMesh) {
    state.scene.remove(state.highlightMesh);
    state.highlightMesh.geometry.dispose();
    (state.highlightMesh.material as THREE.Material).dispose();
    state.highlightMesh = null;
  }
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
        const faceIndex = hit[0].faceIndex;
        if (faceIndex !== undefined && faceIndex < data.expressIDLookup.length) {
          const expressID = data.expressIDLookup[faceIndex];
          selectElement(data, expressID);
          return;
        }
      }
    }

    // Click on empty space — deselect
    clearHighlight();
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
    };

    if (type === 'structure') {
      state.structure = data;
    } else {
      state.mep = data;
    }

    // Fit camera
    fitCameraToModels();

    // Update UI
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
}

function showLoading(text: string): void {
  document.getElementById('loadingText')!.textContent = text;
  document.getElementById('loadingOverlay')!.classList.add('visible');
}

function hideLoading(): void {
  document.getElementById('loadingOverlay')!.classList.remove('visible');
}

// ─── Drag & Drop ─────────────────────────────────────────────────────

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
(window as any).resetView = () => fitCameraToModels();
(window as any).toggleSidebar = () => document.getElementById('sidebar')!.classList.toggle('collapsed');
(window as any).toggleTheme = () => {};

// ─── Init ─────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  console.log('[clash-curator] Initializing…');
  
  // Suppress web-ifc BRep triangulation errors (harmless, just noisy)
  const originalError = console.error;
  console.error = (...args) => {
    const msg = args[0]?.toString() || '';
    if (msg.includes('[WEB-IFC][error][TriangulateBounds()]')) {
      return; // Suppress BRep errors
    }
    originalError.apply(console, args);
  };
  
  initViewer();
  await initIfc();
  setupDragDrop();

  document.getElementById('structureInput')!.addEventListener('change', function (this: HTMLInputElement) {
    handleFileSelect(this, 'structure');
  });
  document.getElementById('mepInput')!.addEventListener('change', function (this: HTMLInputElement) {
    handleFileSelect(this, 'mep');
  });

  console.log('[clash-curator] Ready. Load Structure + MEP IFC files.');
}

init().catch(console.error);
