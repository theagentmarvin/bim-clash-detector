/**
 * src/core/state.ts — Shared application state for Clash Curator
 *
 * Centralizes state used across multiple modules to avoid circular imports.
 * Exported as a singleton; modules import state directly from here.
 */

import * as THREE from 'three';
import type { LoadedModelData, ClashSettings } from './types';
import type { Clash } from './types';

// ─── App State ───────────────────────────────────────────────────────────

export const state = {
  structure: null as LoadedModelData | null,
  mep: null as LoadedModelData | null,
  scene: null as unknown as THREE.Scene,
  camera: null as unknown as THREE.PerspectiveCamera,
  renderer: null as unknown as THREE.WebGLRenderer,
  controls: null as unknown as import('three/examples/jsm/controls/OrbitControls.js').OrbitControls,
  highlightMesh: null as THREE.Mesh | null,
  clashResults: null as Clash[] | null,
  clashMatrixData: null as { rowTypes: string[]; colTypes: string[]; matrix: number[][]; maxCount: number } | null,
  settings: {
    selectionA: [] as string[],
    selectionB: [] as string[],
    clashType: 'HARD' as ClashSettings['clashType'],
    tolerance: 10,  // mm
  } as ClashSettings,
};
