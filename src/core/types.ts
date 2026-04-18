import * as THREE from 'three';

/**
 * Represents a single IFC element (wall, slab, door, etc.)
 * Used by the IFC geometry layer for clash detection.
 */
export type ModelType = 'structure' | 'mep';

export interface IfcElement {
  /** Unique IFC express ID (may collide across models — prefix with modelId for global uniqueness) */
  expressID: number;
  /** GlobalId from IFC (22-char GUID string) */
  guid: string;
  /** IFC type (e.g., 'IfcWall', 'IfcSlab') */
  type: string;
  /** Human-readable name from IFC Name attribute */
  name: string;
  /** Level/floor name this element belongs to */
  level?: string;
  /** Which model this element belongs to (set during detection pipeline) */
  modelType?: ModelType;
  /** Volume in cubic meters (extracted from IFC Quantities) */
  volume?: number;
  /** Area in square meters (extracted from IFC Quantities) */
  area?: number;
  /** IFC property key-value map (extracted from IfcRelDefinesByProperties) */
  properties?: Record<string, string | number | boolean>;
  /** Three.js mesh for rendering / spatial queries */
  mesh?: THREE.Mesh;
  /** Axis-aligned bounding box in world space */
  bbox?: { min: [number, number, number]; max: [number, number, number] };
}

/**
 * Result of loading a single IFC model.
 */
export interface LoadedModel {
  /** Numeric model ID from web-ifc */
  modelId: number;
  /** All extracted elements */
  elements: IfcElement[];
  /** Unique level names found (sorted) */
  levels: string[];
  /** Unique IFC types found (sorted) */
  categories: string[];
  /** Map of expressID → THREE.Mesh for spatial queries */
  meshMap: Map<number, THREE.Mesh>;
  /** Property catalog: propertyName → unique values */
  propertyCatalog: Record<string, (string | number)[]>;
}

// Clash Types
export type ClashType = 'HARD' | 'SOFT' | 'CLEARANCE';

// Clash Result
export interface Clash {
  id: string;
  type: ClashType;
  elementA: IfcElement;
  elementB: IfcElement;
  volume?: number;
  clearanceGap?: number;
  severity: number;
  centroid: [number, number, number];
  status: 'OPEN' | 'RESOLVED' | 'IGNORED';
}

// Clash Rule
export interface ClashRule {
  id: string;
  name: string;
  enabled: boolean;
  clashType: ClashType;
  tolerance?: number;
  clearanceDistance?: number;
  groupA: {
    ifcTypes: string[];
    excludeTypes?: string[];
    storey?: string | null;
  };
  groupB: {
    ifcTypes: string[];
    excludeTypes?: string[];
    storey?: string | null;
  };
}

// Clash Ruleset
export interface ClashRuleset {
  id: string;
  name: string;
  version: string;
  created: string;
  modified: string;
  rules: ClashRule[];
}

// Clash Detection Config
export interface ClashDetectionConfig {
  tolerance: number;
  enableCoplanarFix: boolean;
  maxClashCount: number;
}

// ─── Selection State Machine Types (useClashSelection hook) ───────────────────

export type ClashPhase =
  | 'idle'
  | 'loaded'
  | 'highlighting_A'
  | 'highlighting_B'
  | 'ready'
  | 'detecting'
  | 'results';

export interface ClashSelectionState {
  phase: ClashPhase;
  selectionA: string[];
  selectionB: string[];
  abortController: AbortController | null;
  error: string | null;
}

export type ClashAction =
  | { type: 'MODELS_LOADED' }
  | { type: 'SELECTION_A_CHANGE'; types: string[] }
  | { type: 'SELECTION_B_CHANGE'; types: string[] }
  | { type: 'HIGHLIGHT_A_COMPLETE' }
  | { type: 'HIGHLIGHT_B_COMPLETE' }
  | { type: 'RUN_DETECTION' }
  | { type: 'DETECTION_COMPLETE' }
  | { type: 'DETECTION_ERROR'; error: string }
  | { type: 'RESET' };

// ─── Clash Curator App Types ───────────────────────────────────────────────────

/**
 * In-memory representation of a loaded IFC model.
 * Used by the clash detection UI layer.
 */
export interface LoadedModelData {
  mesh: THREE.Mesh;
  expressIDLookup: Int32Array;
  elementCount: number;
  levels: string[];
  categories: string[];
  elements: IfcElement[];
}

export interface ClashSettings {
  selectionA: string[];
  selectionB: string[];
  clashType: 'HARD' | 'SOFT' | 'CLEARANCE';
  tolerance: number; // mm
}