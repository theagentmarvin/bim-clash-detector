import type { Clash, ClashType, IfcElement } from '../core/types.js';

/**
 * Severity level for clash ranking.
 */
export type SeverityLevel = 'critical' | 'major' | 'minor' | 'info';

/**
 * Severity score config for volume-based scoring.
 */
export interface SeverityConfig {
  /** Volume threshold in m³ above which clash is critical */
  criticalVolumeThreshold: number;
  /** Volume threshold in m³ above which clash is major */
  majorVolumeThreshold: number;
  /** Volume threshold in m³ above which clash is minor */
  minorVolumeThreshold: number;
}

/**
 * Calculates severity scores for clash results.
 * Uses overlap volume as the primary factor.
 */
export class SeverityCalculator {
  private config: SeverityConfig;

  constructor(config?: Partial<SeverityConfig>) {
    this.config = {
      criticalVolumeThreshold: 0.1, // 100+ liters → critical
      majorVolumeThreshold: 0.01,    // 10+ liters → major
      minorVolumeThreshold: 0.001,   // 1+ liter → minor
      ...config,
    };
  }

  /**
   * Calculate numeric severity score (0-100) for a clash.
   * Higher = more severe.
   */
  calculateScore(
    overlapVolume: number,
    clashType: ClashType,
    elemA: IfcElement,
    elemB: IfcElement,
  ): number {
    // Base score from clash type
    let baseScore = 50;
    switch (clashType) {
      case 'HARD': baseScore = 80; break;
      case 'CLEARANCE': baseScore = 60; break;
      case 'SOFT': baseScore = 40; break;
    }

    // Volume-based adjustment
    const volScore = this.scoreFromVolume(overlapVolume);

    // Type penalty: structural elements in clash = higher severity
    const structuralPenalty = this.structuralPenalty(elemA, elemB);

    const rawScore = baseScore * 0.4 + volScore * 0.5 + structuralPenalty * 0.1;

    // Clamp to 0-100
    return Math.min(100, Math.max(0, rawScore));
  }

  /**
   * Convert volume to a 0-50 score component.
   */
  private scoreFromVolume(volume: number): number {
    if (volume >= this.config.criticalVolumeThreshold) return 50;
    if (volume >= this.config.majorVolumeThreshold) return 35;
    if (volume >= this.config.minorVolumeThreshold) return 20;
    return 5;
  }

  /**
   * Structural elements (walls, slabs, columns, beams) add penalty.
   */
  private structuralPenalty(a: IfcElement, b: IfcElement): number {
    const structuralTypes = ['WALL', 'SLAB', 'COLUMN', 'BEAM', 'FOUNDATION', 'FOOTING'];
    let count = 0;
    if (structuralTypes.some(t => a.type.toUpperCase().includes(t))) count++;
    if (structuralTypes.some(t => b.type.toUpperCase().includes(t))) count++;
    return count * 10; // max 20
  }

  /**
   * Get severity level label from numeric score.
   */
  getSeverityLevel(score: number): SeverityLevel {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'major';
    if (score >= 30) return 'minor';
    return 'info';
  }

  /**
   * Rank clashes by severity score descending.
   */
  rankClashes(clashes: Clash[]): Clash[] {
    return [...clashes].sort((a, b) => b.severity - a.severity);
  }
}

/**
 * Format severity score for display.
 */
export function formatSeverity(score: number): string {
  return `${Math.round(score)}/100`;
}

/**
 * Get color class for severity level.
 */
export function severityColor(level: SeverityLevel): string {
  switch (level) {
    case 'critical': return '#ef4444'; // red
    case 'major': return '#f97316';    // orange
    case 'minor': return '#eab308';    // yellow
    case 'info': return '#6b7280';     // gray
    default: return '#6b7280';
  }
}