/**
 * Compute axis-aligned bounding box from raw vertex positions.
 * @param positions - Float32Array of x,y,z vertex coordinates
 * @returns AABB with min/max corners as [x,y,z] tuples
 */
export function computeBBox(
  positions: Float32Array,
): { min: [number, number, number]; max: [number, number, number] } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

/**
 * Transform an AABB by a 4x4 flat column-major matrix and return the world-space AABB.
 * Handles the case where the transform may include non-uniform scaling by computing
 * the axis-aligned hull of all 8 transformed corners.
 */
export function transformBBox(
  bbox: { min: [number, number, number]; max: [number, number, number] },
  flatTransformation: number[],
): { min: [number, number, number]; max: [number, number, number] } {
  const m = flatTransformation;
  // Build 3x3 rotation/scale and translation
  const sx = m[0], sy = m[1], sz = m[2];
  const tx = m[3], ty = m[4], tz = m[5];
  const bx = m[6], by = m[7], bz = m[8];
  const cx = m[9], cy = m[10], cz = m[11];
  const dx = m[12], dy = m[13], dz = m[14];

  const { min: bmin, max: bmax } = bbox;

  // Compute all 8 corners of the AABB
  const corners: [number, number, number][] = [
    [bmin[0], bmin[1], bmin[2]],
    [bmax[0], bmin[1], bmin[2]],
    [bmin[0], bmax[1], bmin[2]],
    [bmax[0], bmax[1], bmin[2]],
    [bmin[0], bmin[1], bmax[2]],
    [bmax[0], bmin[1], bmax[2]],
    [bmin[0], bmax[1], bmax[2]],
    [bmax[0], bmax[1], bmax[2]],
  ];

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const [cx2, cy2, cz2] of corners) {
    // Apply 3x3 part then add translation
    const wx = sx * cx2 + tx * cy2 + bx * cz2 + dx;
    const wy = sy * cx2 + ty * cy2 + by * cz2 + dy;
    const wz = sz * cx2 + tz * cy2 + bz * cz2 + dz;
    if (wx < minX) minX = wx;
    if (wy < minY) minY = wy;
    if (wz < minZ) minZ = wz;
    if (wx > maxX) maxX = wx;
    if (wy > maxY) maxY = wy;
    if (wz > maxZ) maxZ = wz;
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}