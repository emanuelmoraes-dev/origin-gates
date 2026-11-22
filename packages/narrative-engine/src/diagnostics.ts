import type { AuditLog, AuditRecord } from './audit.js';
import { createInspector, type InstanceSnapshot } from './inspection.js';
import type { GameState } from './state.js';

export interface DiagnosticExport {
  readonly schemaVersion: 1;
  readonly scenarioId: string;
  readonly worldId: string | null;
  readonly exportedAt: string;
  readonly audit: {
    readonly stats: ReturnType<AuditLog['stats']> | null;
    readonly records: readonly AuditRecord[];
  };
  readonly instances: readonly InstanceSnapshot[];
}

/** Full retained history, intentionally independent of presentation filters. */
export function createDiagnosticExport(world: GameState, now = new Date()): DiagnosticExport {
  return Object.freeze({
    schemaVersion: 1,
    scenarioId: world.scenario,
    worldId: world.audit?.worldId ?? null,
    exportedAt: now.toISOString(),
    audit: Object.freeze({ stats: world.audit?.stats() ?? null, records: world.audit?.records() ?? Object.freeze([]) }),
    instances: createInspector(world).list(),
  });
}


