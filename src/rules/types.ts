import type { ClashRule, ClashRuleset, ClashType, IfcElement } from '../core/types';

export type { ClashRule, ClashRuleset, ClashType, IfcElement };

// Validation result type
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Rule application options
export interface RuleApplicationOptions {
  /** Whether to include disabled rules */
  includeDisabled?: boolean;
  /** Whether to validate rules before applying them */
  validateBeforeApply?: boolean;
}

// Rule matching result
export interface RuleMatchResult {
  rule: ClashRule;
  elementsA: IfcElement[];
  elementsB: IfcElement[];
}