/**
 * IFC Loader — web-ifc direct. One merged BufferGeometry per IFC file.
 *
 * DISPLAY: ONE THREE.Mesh per model (fast rendering, one draw call)
 * DETECTION: Per-element AABB data (for clash detection, no extra meshes)
 * SELECTION: Face → expressID lookup (via userData on each triangle)
 */

import * as THREE from 'three';
import * as WEBIFC from 'web-ifc';
import type { LoadedModel, IfcElement } from '../core/types';

const WASM_PATH = 'https://unpkg.com/web-ifc@0.0.74/';

/** Singleton IfcAPI */
let _api: WEBIFC.IfcAPI | null = null;
let _wasmReady = false;
let _initPromise: Promise<WEBIFC.IfcAPI> | null = null;

async function getApi(): Promise<WEBIFC.IfcAPI> {
  if (_api && _wasmReady) return _api;
  if (_initPromise) return _initPromise;
  // Auto-initialize if not done yet
  return initIfc();
}

/** Initialize web-ifc WASM. Call once at app startup. */
export async function initIfc(): Promise<WEBIFC.IfcAPI> {
  if (_api && _wasmReady) return _api;
  _api = new WEBIFC.IfcAPI();
  _api.SetWasmPath(WASM_PATH, true);
  await _api.Init();
  _wasmReady = true;
  console.log('[ifc-loader] web-ifc WASM initialized');
  return _api;
}

/**
 * Load an IFC file and return ONE merged BufferGeometry + element data.
 *
 * The returned result contains:
 * - mergedGeometry: a single BufferGeometry with all elements merged
 * - expressIDLookup: faceIndex → expressID mapping (for raycasting)
 * - elements: per-element metadata (for clash detection + UI)
 * - levels: unique building level names
 * - categories: unique IFC type names
 */
export async function loadIfc(
  ifcBuffer: Uint8Array,
  modelId: number,
): Promise<{
  mergedGeometry: THREE.BufferGeometry;
  expressIDLookup: Int32Array;
  elements: IfcElement[];
  levels: string[];
  categories: string[];
}> {
  const api = await getApi();

  const id = api.OpenModel(ifcBuffer, {
    COORDINATE_TO_ORIGIN: true,
    CIRCLE_SEGMENTS: 6,
  });

  console.log(`[ifc-loader] Model ${modelId} opened as id=${id}`);

  // ─── Extract IFC metadata ────────────────────────────────────────

  // Levels
  const elementToLevel = buildLevelMap(api, id);
  const levelSet = new Set<string>();
  for (const level of elementToLevel.values()) levelSet.add(level);
  const levels = Array.from(levelSet).sort();

  // Properties
  const elementToProps = buildPropertyMap(api, id);

  // ─── Stream geometry and collect data ────────────────────────────

  const allPositions: number[] = [];
  const allNormals: number[] = [];
  const allIndices: number[] = [];
  const expressIDPerFace: number[] = [];
  const elements: IfcElement[] = [];
  const categorySet = new Set<string>();
  let vertexOffset = 0;
  let totalTriangles = 0;

  // Shared material — all elements get the same gray Lambert material
  const material = new THREE.MeshLambertMaterial({
    color: new THREE.Color(0.6, 0.62, 0.65),
    flatShading: true,
  });

  api.StreamAllMeshes(id, (mesh: WEBIFC.FlatMesh) => {
    const expressID = mesh.expressID;
    const placedGeos = mesh.geometries;

    // Element metadata
    const line = api.GetLine(id, expressID);
    const typeName = api.GetNameFromTypeCode(line.type) ?? 'Unknown';
    const elemName = line.Name?.value ?? line.Name ?? '';
    const elemGuid = line.GlobalId?.value ?? line.GlobalId ?? '';
    const level = elementToLevel.get(expressID) ?? 'Unknown';

    categorySet.add(typeName);

    // Process each geometry piece for this element
    for (let i = 0; i < placedGeos.size(); i++) {
      const pg = placedGeos.get(i);
      const geom = api.GetGeometry(id, pg.geometryExpressID);
      const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize()) as Float32Array;
      const indices = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize()) as Uint32Array;

      // Transform vertices
      const transform = new THREE.Matrix4().fromArray(pg.flatTransformation);
      const vertCount = verts.length / 6;

      for (let v = 0; v < vertCount; v++) {
        const srcIdx = v * 6;
        const pos = new THREE.Vector3(
          verts[srcIdx],
          verts[srcIdx + 1],
          verts[srcIdx + 2],
        );
        pos.applyMatrix4(transform);

        allPositions.push(pos.x, pos.y, pos.z);
        allNormals.push(verts[srcIdx + 3], verts[srcIdx + 4], verts[srcIdx + 5]);
      }

      // Add indices (offset by current vertex count)
      const triangleCount = indices.length / 3;
      for (let t = 0; t < triangleCount; t++) {
        // Push 3 indices with offset
        allIndices.push(
          indices[t * 3] + vertexOffset,
          indices[t * 3 + 1] + vertexOffset,
          indices[t * 3 + 2] + vertexOffset,
        );
        // Map each face to its expressID
        expressIDPerFace.push(expressID);
      }

      totalTriangles += triangleCount;
      vertexOffset += vertCount;

      // Free WASM memory
      // @ts-ignore — delete() not in TS declarations
      geom.delete();
    }

    // BBox from the merged vertex data
    const elemBBox = computeBBoxFromPlacedGeos(api, id, placedGeos);

    elements.push({
      expressID,
      guid: elemGuid,
      type: typeName,
      name: elemName,
      level,
      bbox: elemBBox,
    });
  });

  console.log(
    `[ifc-loader] Model ${modelId}: ${elements.length} elements, ` +
    `${totalTriangles.toLocaleString()} triangles, ${levels.length} levels`,
  );

  // ─── Build merged BufferGeometry ─────────────────────────────────

  const posArray = new Float32Array(allPositions);
  const normArray = new Float32Array(allNormals);
  const idxArray = new Uint32Array(allIndices);
  const expressIDArray = new Int32Array(expressIDPerFace);

  const mergedGeometry = new THREE.BufferGeometry();
  mergedGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
  mergedGeometry.setAttribute('normal', new THREE.BufferAttribute(normArray, 3));
  mergedGeometry.setIndex(new THREE.BufferAttribute(idxArray, 1));
  mergedGeometry.computeVertexNormals();

  return {
    mergedGeometry,
    expressIDLookup: expressIDArray,
    elements,
    levels,
    categories: Array.from(categorySet).sort(),
  };
}

// ─── Level mapping ──────────────────────────────────────────────────

function buildLevelMap(api: WEBIFC.IfcAPI, modelId: number): Map<number, string> {
  const map = new Map<number, string>();
  const storeyNames = new Map<number, string>();

  const storeyIds = api.GetLineIDsWithType(modelId, WEBIFC.IFCBUILDINGSTOREY);
  for (let i = 0; i < storeyIds.size(); i++) {
    const storey = api.GetLine(modelId, storeyIds.get(i));
    const name = storey.Name?.value ?? storey.Name ?? `Level ${storeyIds.get(i)}`;
    storeyNames.set(storeyIds.get(i), name);
  }

  const relIds = api.GetLineIDsWithType(modelId, WEBIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
  for (let i = 0; i < relIds.size(); i++) {
    const rel = api.GetLine(modelId, relIds.get(i));
    const storeyHandle = rel.RelatingStructure;
    const storeyId = typeof storeyHandle === 'object' && storeyHandle?.value !== undefined
      ? storeyHandle.value
      : storeyHandle as number;
    const levelName = storeyNames.get(storeyId) ?? 'Unknown';

    const relatedElements = rel.RelatedElements ?? [];
    for (const elemRef of relatedElements) {
      const elemId = typeof elemRef === 'object' && elemRef?.value !== undefined
        ? elemRef.value
        : elemRef as number;
      map.set(elemId, levelName);
    }
  }
  return map;
}

// ─── Property mapping ──────────────────────────────────────────────

function buildPropertyMap(api: WEBIFC.IfcAPI, modelId: number): Map<number, Record<string, any>> {
  const map = new Map<number, Record<string, any>>();
  const relPropIds = api.GetLineIDsWithType(modelId, WEBIFC.IFCRELDEFINESBYPROPERTIES);
  for (let i = 0; i < relPropIds.size(); i++) {
    try {
      const rel = api.GetLine(modelId, relPropIds.get(i));
      const psetRef = rel.RelatingPropertyDefinition;
      const psetId = typeof psetRef === 'object' && psetRef?.value !== undefined
        ? psetRef.value
        : psetRef as number;
      const pset = api.GetLine(modelId, psetId);
      const psetName = pset.Name?.value ?? pset.Name ?? '';

      const hasProps = pset.HasProperties ?? [];
      for (const propRef of hasProps) {
        const propId = typeof propRef === 'object' && propRef?.value !== undefined
          ? propRef.value
          : propRef as number;
        const prop = api.GetLine(modelId, propId);
        const propName = prop.Name?.value ?? prop.Name ?? '';
        if (!propName) continue;

        const rawValue = prop.NominalValue?.value ?? prop.NominalValue;
        let propValue = rawValue as any;
        if (typeof rawValue === 'string') {
          const parsed = parseFloat(rawValue);
          propValue = isNaN(parsed) ? rawValue : parsed;
        }

        const elemObjs = rel.RelatedObjects ?? [];
        for (const elemRef of elemObjs) {
          const elemId = typeof elemRef === 'object' && elemRef?.value !== undefined
            ? elemRef.value
            : elemRef as number;
          if (!map.has(elemId)) map.set(elemId, {});
          map.get(elemId)![psetName ? psetName + '.' + propName : propName] = propValue;
        }
      }
    } catch {}
  }
  return map;
}

// ─── BBox computation ─────────────────────────────────────────────

function computeBBoxFromPlacedGeos(
  api: WEBIFC.IfcAPI,
  modelId: number,
  placedGeos: WEBIFC.Vector<WEBIFC.PlacedGeometry>,
): { min: [number, number, number]; max: [number, number, number] } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const transform = new THREE.Matrix4();

  for (let i = 0; i < placedGeos.size(); i++) {
    const pg = placedGeos.get(i);
    const geom = api.GetGeometry(modelId, pg.geometryExpressID);
    const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize()) as Float32Array;
    transform.fromArray(pg.flatTransformation);

    for (let j = 0; j < verts.length; j += 6) {
      const v = new THREE.Vector3(verts[j], verts[j + 1], verts[j + 2]);
      v.applyMatrix4(transform);
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
      if (v.z > maxZ) maxZ = v.z;
    }

    // @ts-ignore
    geom.delete();
  }

  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

// ─── Convenience ──────────────────────────────────────────────────

export async function loadIfcFromFile(file: File, modelId: number) {
  const buffer = await file.arrayBuffer();
  return loadIfc(new Uint8Array(buffer), modelId);
}

export async function loadIfcFromUrl(url: string, modelId: number) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch IFC: ${response.status}`);
  const buffer = await response.arrayBuffer();
  return loadIfc(new Uint8Array(buffer), modelId);
}
