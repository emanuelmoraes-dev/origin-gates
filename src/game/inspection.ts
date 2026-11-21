import { snapshot, type AuditValue } from './audit';
import type { IdentityStore, WorldInstance } from './state';

export interface InstanceSnapshot {
  readonly id: string; readonly definitionId: string; readonly kind: WorldInstance['kind'];
  readonly properties: AuditValue;
}
export function inspectInstance(instance: WorldInstance): InstanceSnapshot {
  const { id, definitionId, kind, ...fields } = instance;
  // A model is not current instance state. Do not expose its live reference.
  if ('definition' in fields) delete (fields as Partial<typeof fields>).definition;
  return Object.freeze({ id, definitionId, kind, properties: snapshot(fields) });
}
export function createInspector(store: IdentityStore) {
  return Object.freeze({
    list: (kind?: WorldInstance['kind']): readonly InstanceSnapshot[] => Object.freeze(Object.values(store.instances).filter(instance => !kind || instance.kind === kind).map(inspectInstance)),
    find: (id: string): InstanceSnapshot | undefined => Object.hasOwn(store.instances, id) ? inspectInstance(store.instances[id]) : undefined,
  });
}
