import * as THREE from 'three';

/**
 * src/hooks/useClashSelection.ts — Selection State Machine
 *
 * Formalises the Selection A / B lifecycle using a reducer pattern.
 * Owns the AbortController so that a new selection immediately cancels any
 * in-flight prior highlight operation.
 *
 * This is a vanilla TypeScript singleton (no React) — useClashSelection() returns
 * the same instance on every call.
 *
 * Exposes isReady so the run button binds directly to it instead of manual
 * updateRunButton() calls.
 */

import type { Clash, ClashPhase, ClashSelectionState, ClashAction } from '../core/types';
import { state } from '../core/state';
import type { LoadedModelData } from '../core/types';
import { highlightWithInstancing, clearAllInstancedHighlights } from '../geometry/instanced-highlight';

// ─── Reducer ─────────────────────────────────────────────────────────────────

function selectionReducer(
  s: ClashSelectionState,
  a: ClashAction,
): ClashSelectionState {
  switch (a.type) {
    case 'MODELS_LOADED':
      return { ...s, phase: 'loaded' };

    case 'SELECTION_A_CHANGE':
      return {
        ...s,
        selectionA: a.types,
        phase: a.types.length > 0 ? 'highlighting_A' : 'loaded',
        abortController: new AbortController(),
        error: null,
      };

    case 'HIGHLIGHT_A_COMPLETE':
      return {
        ...s,
        phase: s.selectionB.length > 0 ? 'ready' : 'loaded',
      };

    case 'SELECTION_B_CHANGE':
      return {
        ...s,
        selectionB: a.types,
        phase: a.types.length > 0 ? 'highlighting_B' : 'loaded',
        abortController: new AbortController(),
        error: null,
      };

    case 'HIGHLIGHT_B_COMPLETE':
      return { ...s, phase: 'ready' };

    case 'RUN_DETECTION':
      return { ...s, phase: 'detecting', abortController: null };

    case 'DETECTION_COMPLETE':
      return { ...s, phase: 'results' };

    case 'DETECTION_ERROR':
      return { ...s, phase: 'results', error: a.error };

    case 'RESET':
      return { ...s, phase: 'idle', selectionA: [], selectionB: [], abortController: null, error: null };

    default:
      return s;
  }
}

const initial: ClashSelectionState = {
  phase: 'idle',
  selectionA: [],
  selectionB: [],
  abortController: null,
  error: null,
};

// ─── Material Restore ─────────────────────────────────────────────────────────

/**
 * Stored original material properties per model mesh.
 * Replaces the unbounded originalMaterialsRef Map from main.ts.
 */
const origMaterials = new WeakMap<THREE.Mesh, { color: THREE.Color; opacity: number; transparent: boolean }>();

function storeOrig(mat: THREE.MeshStandardMaterial, mesh: THREE.Mesh): void {
  if (origMaterials.has(mesh)) return;
  origMaterials.set(mesh, { color: mat.color.clone(), opacity: mat.opacity, transparent: mat.transparent });
}

function restoreMesh(mesh: THREE.Mesh): void {
  const orig = origMaterials.get(mesh);
  if (!orig) return;
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.color.copy(orig.color);
  mat.opacity = orig.opacity;
  mat.transparent = orig.transparent;
  mat.needsUpdate = true;
  origMaterials.delete(mesh);
}

// ─── Clash Highlight ──────────────────────────────────────────────────────────

export function highlightClashElements(clash: Clash): void {
  clearAllInstancedHighlights();

  const elemA = clash.elementA;
  const elemB = clash.elementB;

  const modelDataA: LoadedModelData | null = elemA.modelType === 'structure' ? state.structure : state.mep;
  const modelDataB: LoadedModelData | null = elemB.modelType === 'structure' ? state.structure : state.mep;

  if (modelDataA) {
    storeOrig(modelDataA.mesh.material as THREE.MeshStandardMaterial, modelDataA.mesh);
    dimMesh(modelDataA.mesh);
    highlightWithInstancing(modelDataA, [elemA.expressID], 0x3b82f6);
  }

  if (modelDataB && elemB.expressID !== elemA.expressID) {
    storeOrig(modelDataB.mesh.material as THREE.MeshStandardMaterial, modelDataB.mesh);
    dimMesh(modelDataB.mesh);
    highlightWithInstancing(modelDataB, [elemB.expressID], 0xf97316);
  }

  // ── Zoom to clash centroid ───────────────────────────────────────────────
  const [cx, cy, cz] = clash.centroid;
  const cam = state.camera;
  const controls = state.controls;

  // Animate camera toward the clash: position offset from centroid
  const offset = new THREE.Vector3(cx, cy, cz);
  const dir = offset.clone().normalize();
  const distance = Math.max(...[
    Math.abs(clash.elementA.bbox ? clash.elementA.bbox.max[0] - clash.elementA.bbox.min[0] : 2),
    Math.abs(clash.elementA.bbox ? clash.elementA.bbox.max[1] - clash.elementA.bbox.min[1] : 2),
    Math.abs(clash.elementA.bbox ? clash.elementA.bbox.max[2] - clash.elementA.bbox.min[2] : 2),
    Math.abs(clash.elementB.bbox ? clash.elementB.bbox.max[0] - clash.elementB.bbox.min[0] : 2),
    Math.abs(clash.elementB.bbox ? clash.elementB.bbox.max[1] - clash.elementB.bbox.min[1] : 2),
    Math.abs(clash.elementB.bbox ? clash.elementB.bbox.max[2] - clash.elementB.bbox.min[2] : 2),
  ]) * 2.5;

  const target = new THREE.Vector3(cx, cy, cz);
  const camPos = target.clone().add(dir.multiplyScalar(distance));

  cam.position.copy(camPos);
  controls.target.copy(target);
  controls.update();
}

function dimMesh(mesh: THREE.Mesh): void {
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.color.set(0x333333);
  mat.transparent = true;
  mat.opacity = 0.4;
  mat.needsUpdate = true;
}

// ─── Singleton Manager ─────────────────────────────────────────────────────────

class SelectionManager {
  private _state: ClashSelectionState = { ...initial };
  private _isReady = false;
  /** Phase-change listeners */
  private _listeners: Array<(s: ClashSelectionState) => void> = [];

  get state(): ClashSelectionState {
    return this._state;
  }

  get isReady(): boolean {
    return this._isReady;
  }

  onPhaseChange(fn: (s: ClashSelectionState) => void): () => void {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter(l => l !== fn);
    };
  }

  private notify(): void {
    this._isReady = this._state.phase === 'ready';
    for (const l of this._listeners) l(this._state);
  }

  private dispatch(a: ClashAction): void {
    this._state = selectionReducer(this._state, a);
    this.notify();
  }

  /**
   * Async. Yields between abort and highlight so cancellation is immediate.
   */
  async setSelectionA(types: string[]): Promise<void> {
    this._state.abortController?.abort();
    const ctrl = new AbortController();
    this._state = { ...this._state, abortController: ctrl };

    this.dispatch({ type: 'SELECTION_A_CHANGE', types });
    await new Promise(r => setTimeout(r, 0)); // yield

    if (ctrl.signal.aborted) return;

    const modelData = state.structure;
    await this._runHighlight(types, modelData, 0x3b82f6, ctrl.signal);
    if (!ctrl.signal.aborted) this.dispatch({ type: 'HIGHLIGHT_A_COMPLETE' });
  }

  async setSelectionB(types: string[]): Promise<void> {
    this._state.abortController?.abort();
    const ctrl = new AbortController();
    this._state = { ...this._state, abortController: ctrl };

    this.dispatch({ type: 'SELECTION_B_CHANGE', types });
    await new Promise(r => setTimeout(r, 0));

    if (ctrl.signal.aborted) return;

    const modelData = state.mep;
    await this._runHighlight(types, modelData, 0xf97316, ctrl.signal);
    if (!ctrl.signal.aborted) this.dispatch({ type: 'HIGHLIGHT_B_COMPLETE' });
  }

  private async _runHighlight(
    types: string[],
    modelData: LoadedModelData | null,
    colorHex: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (!modelData || types.length === 0) {
      clearAllInstancedHighlights();
      return;
    }

    const matching = modelData.elements.filter(el => types.includes(el.type));
    if (matching.length === 0 || signal.aborted) return;

    storeOrig(modelData.mesh.material as THREE.MeshStandardMaterial, modelData.mesh);
    dimMesh(modelData.mesh);

    const CHUNK = 250;
    const ids = matching.map(el => el.expressID);

    for (let i = 0; i < ids.length; i += CHUNK) {
      if (signal.aborted) return;
      const chunk = ids.slice(i, i + CHUNK);
      highlightWithInstancing(modelData, chunk, colorHex);
      await new Promise(r => setTimeout(r, 0)); // yield to main thread
    }
  }

  clearHighlights(): void {
    clearAllInstancedHighlights();
    for (const data of [state.structure, state.mep]) {
      if (data) restoreMesh(data.mesh);
    }
  }

  dispatchModelsLoaded(): void {
    this.dispatch({ type: 'MODELS_LOADED' });
  }

  dispatchDetectionComplete(): void {
    this.dispatch({ type: 'DETECTION_COMPLETE' });
  }

  dispatchDetectionError(error: string): void {
    this.dispatch({ type: 'DETECTION_ERROR', error });
  }

  dispatchRunDetection(): void {
    this.dispatch({ type: 'RUN_DETECTION' });
  }

  reset(): void {
    this._state.abortController?.abort();
    this.clearHighlights();
    this._state = { ...initial };
    this.notify();
  }
}

/** Singleton — one state machine per app session */
export const selectionManager = new SelectionManager();

/**
 * Module-level convenience alias matching the hook interface.
 * Consumers can call setSelectionA / setSelectionB directly on this object.
 */
export const useClashSelection = () => selectionManager;
