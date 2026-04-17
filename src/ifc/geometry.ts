import * as THREE from 'three';

/**
 * Convert interleaved web-ifc vertex data to THREE.BufferGeometry.
 * Vertex layout: [posX, posY, posZ, normX, normY, normZ] — stride 6.
 * @param vertexData - Float32Array from GetVertexArray
 * @param indexData - Uint32Array from GetIndexArray
 * @returns THREE.BufferGeometry with position + normal attributes
 */
export function ifcGeometryToBuffer(
  vertexData: Float32Array,
  indexData: Uint32Array,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertCount = vertexData.length / 6;
  const posFloats = new Float32Array(vertCount * 3);
  const normFloats = new Float32Array(vertCount * 3);

  for (let i = 0; i < vertCount; i++) {
    const srcIdx = i * 6;
    posFloats[i * 3] = vertexData[srcIdx];
    posFloats[i * 3 + 1] = vertexData[srcIdx + 1];
    posFloats[i * 3 + 2] = vertexData[srcIdx + 2];
    normFloats[i * 3] = vertexData[srcIdx + 3];
    normFloats[i * 3 + 1] = vertexData[srcIdx + 4];
    normFloats[i * 3 + 2] = vertexData[srcIdx + 5];
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(posFloats, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normFloats, 3));
  geometry.setIndex(new THREE.BufferAttribute(indexData, 1));
  return geometry;
}

/**
 * Merge multiple BufferGeometry pieces for a single IFC element.
 * Updates indices to account for vertex offset accumulation.
 */
export function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of geometries) {
    totalVerts += g.getAttribute('position').count;
    totalIndices += g.index!.count;
  }

  const pos = new Float32Array(totalVerts * 3);
  const norm = new Float32Array(totalVerts * 3);
  const idx = new Uint32Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;

  for (const g of geometries) {
    const gPos = g.getAttribute('position') as THREE.BufferAttribute;
    const gNorm = g.getAttribute('normal') as THREE.BufferAttribute;
    const gIdx = g.index!;

    pos.set(gPos.array as Float32Array, vOffset * 3);
    norm.set(gNorm.array as Float32Array, vOffset * 3);

    const idxArr = gIdx.array as Uint32Array;
    for (let i = 0; i < idxArr.length; i++) {
      idx[iOffset + i] = idxArr[i] + vOffset;
    }

    vOffset += gPos.count;
    iOffset += idxArr.length;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  merged.setIndex(new THREE.BufferAttribute(idx, 1));
  return merged;
}

/**
 * Apply a flatTransformation array (16-element, column-major) to a BufferGeometry.
 * Operates in-place on position + normal attributes.
 */
export function applyTransform(
  geometry: THREE.BufferGeometry,
  flatTransformation: number[],
): void {
  const matrix = new THREE.Matrix4().fromArray(flatTransformation);
  geometry.applyMatrix4(matrix);
}