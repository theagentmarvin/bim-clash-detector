import type { ClashType } from '../core/types.js';

/**
 * Tolerance configuration for clash detection.
 * Supports per-IFC-type overrides for specialized tolerance values.
 */
export interface ToleranceConfig {
  /** Default tolerance in meters (default: 0.002m = 2mm) */
  default: number;
  /** Per-IFC-type tolerance overrides (in meters) */
  typeOverrides: Record<string, number>;
}

/**
 * ToleranceManager — provides tolerance values for clash detection.
 * Supports defaults and per-type overrides.
 */
export class ToleranceManager {
  private config: ToleranceConfig;

  constructor(config?: Partial<ToleranceConfig>) {
    this.config = {
      default: 0.002, // 2mm default
      typeOverrides: {},
      ...config,
    };
  }

  /**
   * Get tolerance for a given IFC type name.
   * Returns the type-specific override if available, otherwise the default.
   */
  getTolerance(ifcType: string): number {
    return this.config.typeOverrides[ifcType] ?? this.config.default;
  }

  /**
   * Get the default tolerance.
   */
  getDefaultTolerance(): number {
    return this.config.default;
  }

  /**
   * Get tolerance for a clash pair. Uses the maximum of both element types.
   */
  getPairTolerance(typeA: string, typeB: string): number {
    return Math.max(this.getTolerance(typeA), this.getTolerance(typeB));
  }

  /**
   * Set a type-specific tolerance override.
   */
  setTypeOverride(ifcType: string, tolerance: number): void {
    this.config.typeOverrides[ifcType] = tolerance;
  }

  /**
   * Set the default tolerance.
   */
  setDefault(tolerance: number): void {
    this.config.default = tolerance;
  }

  /**
   * Get the full config (for serialization/export).
   */
  getConfig(): ToleranceConfig {
    return { ...this.config };
  }

  /**
   * Clear all type overrides.
   */
  clearOverrides(): void {
    this.config.typeOverrides = {};
  }
}

// ─── Per-clash-type tolerance presets ──────────────────────────────────────

/**
 * Returns recommended default tolerance for a given clash type.
 * - HARD clash: tight tolerance (2mm) — elements physically overlap
 * - SOFT clash: moderate tolerance (5mm) — near-miss within tolerance
 * - CLEARANCE clash: larger tolerance — gap between elements below minimum
 */
export function getToleranceForClashType(clashType: ClashType): number {
  switch (clashType) {
    case 'HARD':
      return 0.002; // 2mm
    case 'SOFT':
      return 0.005; // 5mm
    case 'CLEARANCE':
      return 0.01; // 10mm
    default:
      return 0.002;
  }
}
