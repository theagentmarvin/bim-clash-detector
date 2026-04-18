import type { ClashRule, ClashRuleset, IfcElement, Clash } from '../core/types.js';
import type { ValidationResult } from './types.js';
import { detectClashType } from '../classification/clash-type.js';
import { SeverityCalculator } from '../classification/severity.js';
import { ClashDeduplicator } from '../classification/deduplication.js';
import { broadPhaseDetection } from '../detection/broad-phase.js';
import { narrowPhaseDetection } from '../detection/narrow-phase.js';
import { typeMatches } from '../semantic/type-filter.js';

const DEFAULT_TOLERANCE = 0.002; // 2mm

/**
 * Filters elements by a list of IFC types.
 * Returns all elements if types is empty.
 */
function filterElementsByTypes(
  elements: IfcElement[],
  types: string[],
): IfcElement[] {
  if (!types.length) return elements;
  return elements.filter(el => typeMatches(el, types));
}

export { filterElementsByTypes };

/**
 * Validates a ClashRule configuration.
 */
export function validateRule(rule: ClashRule): ValidationResult {
  const errors: string[] = [];

  if (!rule.groupA?.ifcTypes?.length && !rule.groupB?.ifcTypes?.length) {
    errors.push('Rule must specify at least one of groupA or groupB IFC types');
  }

  if (rule.tolerance !== undefined && rule.tolerance < 0) {
    errors.push('Tolerance must be non-negative');
  }

  if (rule.clearanceDistance !== undefined && rule.clearanceDistance < 0) {
    errors.push('Clearance distance must be non-negative');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates an entire ClashRuleset.
 */
export function validateRuleset(ruleset: ClashRuleset): ValidationResult {
  const errors: string[] = [];

  if (!ruleset.name?.trim()) {
    errors.push('Ruleset must have a name');
  }

  if (!ruleset.rules?.length) {
    errors.push('Ruleset must contain at least one rule');
  }

  for (let i = 0; i < ruleset.rules.length; i++) {
    const result = validateRule(ruleset.rules[i]);
    for (const err of result.errors) {
      errors.push(`Rule ${i + 1}: ${err}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Applies a single ClashRule to filter element pairs.
 * Returns matched pairs that should be checked for clashes.
 */
export function applyRule(
  rule: ClashRule,
  elementsA: IfcElement[],
  elementsB: IfcElement[],
): Array<[IfcElement, IfcElement]> {
  const pairs: Array<[IfcElement, IfcElement]> = [];

  const groupATypes = rule.groupA?.ifcTypes ?? [];
  const groupBTypes = rule.groupB?.ifcTypes ?? [];

  for (const elemA of elementsA) {
    for (const elemB of elementsB) {
      if (elemA === elemB) continue;

      // Type matching: elemA must match groupA types, elemB must match groupB types
      const aMatches = !groupATypes.length || typeMatches(elemA, groupATypes);
      const bMatches = !groupBTypes.length || typeMatches(elemB, groupBTypes);

      if (aMatches && bMatches) {
        // Level filter
        const storey = rule.groupA?.storey ?? rule.groupB?.storey;
        if (storey) {
          if (elemA.level !== storey && elemB.level !== storey) continue;
        }

        pairs.push([elemA, elemB]);
      }
    }
  }

  return pairs;
}

/**
 * Runs the full clash detection pipeline:
 * 1. Broad-phase (BVH spatial index)
 * 2. Rule-based candidate filtering
 * 3. Narrow-phase (AABB intersection)
 * 4. Classification (hard/soft/clearance)
 * 5. Severity scoring
 * 6. Deduplication
 */
export function runClashDetection(
  structureElements: IfcElement[],
  mepElements: IfcElement[],
  ruleset?: ClashRuleset | null,
  options?: {
    tolerance?: number;
    maxResults?: number;
    minSeverity?: number;
  },
): Clash[] {
  const tolerance = options?.tolerance ?? DEFAULT_TOLERANCE;
  const maxResults = options?.maxResults ?? 1000;
  const minSeverity = options?.minSeverity ?? 0;

  // Broad-phase: get all candidate pairs via BVH
  const candidates = broadPhaseDetection(structureElements, mepElements, { useSpatialIndex: true });

  console.log(`[clash-detect] Broad-phase: ${candidates.length} candidates`);

  // Filter candidates by ruleset rules
  let filteredCandidates = candidates;

  if (ruleset?.rules?.length) {
    const enabledRules = ruleset.rules.filter(r => r.enabled !== false);
    const filteredPairs = new Set<string>();

    for (const rule of enabledRules) {
      const rulePairs = applyRule(rule, structureElements, mepElements);
      for (const [a, b] of rulePairs) {
        filteredPairs.add(`${a.expressID}:${b.expressID}`);
      }
    }

    if (filteredPairs.size < candidates.length) {
      console.log(`[clash-detect] Rule filter: ${filteredPairs.size} candidates match rules`);
      filteredCandidates = candidates.filter(([a, b]) =>
        filteredPairs.has(`${a.expressID}:${b.expressID}`)
      );
    }
  }

  // Narrow-phase: precise AABB intersection
  const narrowResults = narrowPhaseDetection(filteredCandidates, tolerance);

  console.log(`[clash-detect] Narrow-phase: ${narrowResults.length} actual clashes`);

  // Build element lookup maps
  const elemMap = new Map<number, IfcElement>();
  for (const el of structureElements) elemMap.set(el.expressID, el);
  for (const el of mepElements) elemMap.set(el.expressID, el);

  // Classify clashes
  const severityCalc = new SeverityCalculator();
  const clashes: Clash[] = [];

  for (const result of narrowResults) {
    const elemA = elemMap.get(result.elementA);
    const elemB = elemMap.get(result.elementB);
    if (!elemA || !elemB) continue;

    const clashType = detectClashType(elemA, elemB, result.overlapVolume);
    const severity = severityCalc.calculateScore(result.overlapVolume, clashType, elemA, elemB);

    const centroid: [number, number, number] = result.intersectionBox
      ? [
          (result.intersectionBox.min[0] + result.intersectionBox.max[0]) / 2,
          (result.intersectionBox.min[1] + result.intersectionBox.max[1]) / 2,
          (result.intersectionBox.min[2] + result.intersectionBox.max[2]) / 2,
        ]
      : [0, 0, 0];

    clashes.push({
      id: `clash-${result.elementA}-${result.elementB}`,
      type: clashType,
      elementA: elemA,
      elementB: elemB,
      volume: result.overlapVolume,
      centroid,
      severity,
      status: 'OPEN',
    });
  }

  // Rank and deduplicate
  const deduplicator = new ClashDeduplicator();
  const ranked = severityCalc.rankClashes(clashes);
  const deduplicated = deduplicator.deduplicate(ranked);

  // Apply filters
  let final = deduplicated;
  if (minSeverity > 0) {
    final = deduplicator.filterByMinSeverity(final, minSeverity);
  }
  final = deduplicator.limit(final, maxResults);

  console.log(`[clash-detect] Final: ${final.length} clashes (${ruleset?.name ?? 'no ruleset'})`);

  return final;
}

/**
 * Creates a default ClashRuleset for structural vs MEP detection.
 */
export function createDefaultRuleset(): ClashRuleset {
  return {
    id: 'default-structural-mep',
    name: 'Structural vs MEP',
    version: '1.0',
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    rules: [
      {
        id: 'structural-mep-default',
        name: 'Structural vs MEP',
        enabled: true,
        clashType: 'HARD',
        groupA: {
          ifcTypes: ['IfcWall', 'IfcSlab', 'IfcBeam', 'IfcColumn', 'IfcFooting', 'IfcFoundation'],
        },
        groupB: {
          ifcTypes: ['IfcDuct', 'IfcPipe', 'IfcCableTray', 'IfcConduit', 'IfcEquipment', 'IfcAirTerminal'],
        },
      },
    ],
  };
}