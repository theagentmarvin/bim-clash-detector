// IFC Geometry Layer — public API
export { loadIfc, loadIfcFromUrl, loadIfcFromFile } from './loader';
export { ifcGeometryToBuffer, mergeGeometries, applyTransform } from './geometry';
export { computeBBox, transformBBox } from './bbox';
export { extractProperties, extractLevels, uniqueLevels } from './properties';