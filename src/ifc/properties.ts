/**
 * IFC property extraction and level mapping.
 * Uses getWebIfcModule() from ./web-ifc.ts for type constants.
 */

import type { IfcAPI } from 'web-ifc';
import { getWebIfcModule } from './web-ifc';

/**
 * Extract element-level IFC properties from IfcRelDefinesByProperties.
 * Returns a map of expressID → property record.
 *
 * Handles both IfcPropertySet (HasProperties) and IfcElementQuantity (Quantities).
 */
export function extractProperties(
  api: IfcAPI,
  modelId: number,
): {
  propsMap: Map<number, Record<string, string | number | boolean>>;
  propertyCatalog: Record<string, (string | number)[]>;
} {
  const propsMap = new Map<number, Record<string, string | number | boolean>>();
  const propertyValueMap = new Map<string, Set<string | number>>();

  // Get IFC type constants from the web-ifc module
  const IFCRELDEFINESBYPROPERTIES = (api as unknown as { IFCRELDEFINESBYPROPERTIES: number }).IFCRELDEFINESBYPROPERTIES;

  const relPropIds = api.GetLineIDsWithType(modelId, IFCRELDEFINESBYPROPERTIES);
  for (let i = 0; i < relPropIds.size(); i++) {
    try {
      const rel = api.GetLine(modelId, relPropIds.get(i));
      const psetRef = rel.RelatingPropertyDefinition;
      const psetId = typeof psetRef === 'object' && psetRef?.value !== undefined
        ? psetRef.value
        : psetRef as number;
      const pset = api.GetLine(modelId, psetId);
      const psetName = pset.Name?.value ?? pset.Name ?? '';

      // IfcElementQuantity: extract AreaValue / VolumeValue from Quantities
      const quantities = pset.Quantities ?? [];
      for (const qtyRef of quantities) {
        const qtyId = typeof qtyRef === 'object' && qtyRef?.value !== undefined
          ? qtyRef.value
          : qtyRef as number;
        const qty = api.GetLine(modelId, qtyId);
        const qtyName = qty.Name?.value ?? qty.Name ?? '';

        let numValue: number | undefined;
        if ((qtyName === 'GrossArea' || qtyName === 'NetArea') && qty.AreaValue != null) {
          const raw = qty.AreaValue;
          numValue = typeof raw === 'number' ? raw : parseFloat(raw._representationValue ?? raw);
        } else if ((qtyName === 'GrossVolume' || qtyName === 'NetVolume') && qty.VolumeValue != null) {
          const raw = qty.VolumeValue;
          numValue = typeof raw === 'number' ? raw : parseFloat(raw._representationValue ?? raw);
        }

        if (numValue !== undefined && !isNaN(numValue)) {
          trackValue(qtyName, numValue, propertyValueMap);
          assignToElements(rel, propsMap, qtyName, numValue);
        }
      }

      // IfcPropertySet: extract NominalValue from HasProperties
      const hasProps = pset.HasProperties ?? [];
      for (const propRef of hasProps) {
        const propId = typeof propRef === 'object' && propRef?.value !== undefined
          ? propRef.value
          : propRef as number;
        const prop = api.GetLine(modelId, propId);
        const propName = prop.Name?.value ?? prop.Name ?? '';
        if (!propName) continue;

        const rawValue = prop.NominalValue?.value ?? prop.NominalValue;
        let propValue: string | number | boolean = rawValue as string | number | boolean;
        if (typeof rawValue === 'string') {
          const parsed = parseFloat(rawValue);
          propValue = isNaN(parsed) ? rawValue : parsed;
        }

        const qualifiedName = psetName ? psetName + '.' + propName : propName;
        trackValue(qualifiedName, propValue as string | number, propertyValueMap);
        if (qualifiedName !== propName) {
          trackValue(propName, propValue as string | number, propertyValueMap);
        }
        assignToElements(rel, propsMap, qualifiedName, propValue);
        assignToElements(rel, propsMap, propName, propValue);
      }
    } catch {
      // Skip malformed property relations
    }
  }

  // Build catalog
  const propertyCatalog: Record<string, (string | number)[]> = {};
  for (const [propName, values] of propertyValueMap) {
    propertyCatalog[propName] = Array.from(values).sort((a, b) =>
      typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
    );
  }

  return { propsMap, propertyCatalog };
}

function trackValue(
  propName: string,
  value: string | number,
  map: Map<string, Set<string | number>>,
): void {
  if (!map.has(propName)) map.set(propName, new Set());
  map.get(propName)!.add(value);
}

function assignToElements(
  rel: any,
  propsMap: Map<number, Record<string, string | number | boolean>>,
  propName: string,
  propValue: string | number | boolean,
): void {
  const elemObjs = rel.RelatedObjects ?? [];
  for (const elemRef of elemObjs) {
    const elemId = typeof elemRef === 'object' && elemRef?.value !== undefined
      ? elemRef.value
      : elemRef as number;
    const entry = propsMap.get(elemId) ?? {};
    entry[propName] = propValue;
    propsMap.set(elemId, entry);
  }
}

/**
 * Extract element → storey mapping via IfcRelContainedInSpatialStructure.
 * Returns map of expressID → level name.
 */
export async function extractLevels(
  api: IfcAPI,
  modelId: number,
): Promise<Map<number, string>> {
  const WEBIFC = await getWebIfcModule();
  const elementToLevel = new Map<number, string>();

  // Get IfcBuildingStorey IDs → names
  const storeyIds = api.GetLineIDsWithType(modelId, WEBIFC.IFCBUILDINGSTOREY);
  const storeyNames = new Map<number, string>();

  for (let i = 0; i < storeyIds.size(); i++) {
    const storeyId = storeyIds.get(i);
    const storey = api.GetLine(modelId, storeyId);
    const name = storey.Name?.value ?? storey.Name ?? `Level ${storeyId}`;
    storeyNames.set(storeyId, name);
  }

  // Map elements to storeys via IfcRelContainedInSpatialStructure
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
      elementToLevel.set(elemId, levelName);
    }
  }

  return elementToLevel;
}

/** Returns sorted unique level names from an element→level map */
export function uniqueLevels(levelMap: Map<number, string>): string[] {
  const set = new Set<string>();
  for (const lvl of levelMap.values()) set.add(lvl);
  return Array.from(set).sort();
}
