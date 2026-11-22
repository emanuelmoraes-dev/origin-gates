import type { DiagnosticExport } from '@origin-gates/narrative-engine';

/** Game-specific download name; the engine only supplies diagnostic data. */
export function diagnosticFilename(diagnostic: DiagnosticExport): string {
  const safe = (value: string) => value.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 60) || 'unknown';
  return `origin-gates-${safe(diagnostic.scenarioId)}-${safe(diagnostic.worldId ?? 'unknown')}-${safe(diagnostic.exportedAt)}.json`;
}
