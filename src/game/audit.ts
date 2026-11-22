export type AuditValue = null | boolean | number | string | readonly AuditValue[] | { readonly [key: string]: AuditValue };
export type AuditCategory = 'composition' | 'role' | 'reference' | 'definition' | 'world' | 'instance' | 'interaction' | 'command' | 'selection' | 'condition' | 'outcome' | 'operation' | 'mutation' | 'fact' | 'dispatch' | 'reaction' | 'legacy' | 'movement' | 'failure';
export interface AuditRecord {
  readonly id: string; readonly sequence: number; readonly worldId: string;
  readonly traceId: string; readonly parentId?: string;
  readonly category: AuditCategory; readonly phase: 'start' | 'end' | 'point';
  readonly status: string; readonly instanceIds: readonly string[]; readonly definitionIds: readonly string[];
  readonly data: AuditValue;
}
export interface AuditInput {
  category: AuditCategory; phase?: AuditRecord['phase']; status?: string;
  instanceIds?: readonly string[]; definitionIds?: readonly string[]; data?: unknown;
}
export interface AuditScope { readonly log: AuditLog; readonly traceId: string; readonly parentId?: string; readonly operation?: string }
export interface AuditOptions { enabled?: boolean; capacity?: number }
let nextWorld = 1; // Diagnostic namespace only; never consumes an entity ID.
function errorMessage(error: unknown): string {
  try { return error instanceof Error ? String(error.message) : String(error); }
  catch { return 'Error whose message could not be read'; }
}

/** Detached, serializable and recursively frozen. Never pass whole worlds here. */
export function snapshot(value: unknown, seen = new WeakSet<object>()): AuditValue {
  if (value === undefined) return Object.freeze({ $undefined: true });
  if (typeof value === 'number') return Number.isFinite(value) ? value : Object.freeze({ $number: String(value) });
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return Object.freeze({ $unsupported: typeof value });
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  const copy: AuditValue = Array.isArray(value)
    ? value.map(item => snapshot(item, seen))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, seen)]));
  seen.delete(value);
  return Object.freeze(copy);
}

export class AuditLog {
  readonly worldId = `world_${nextWorld++}`;
  readonly enabled: boolean;
  readonly capacity: number;
  private buffer: AuditRecord[] = [];
  private head = 0;
  private sequence = 0;
  private traces = 0;
  private discarded = 0;
  private observerErrors = 0;
  private lastObserverError: string | undefined;
  private listeners = new Set<{ callback: (record: AuditRecord) => void }>();
  private causes = new WeakMap<object, AuditScope>();

  constructor(options: AuditOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.capacity = options.capacity ?? 1000;
    if (!Number.isInteger(this.capacity) || this.capacity < 1) throw new Error('Audit capacity must be a positive integer');
  }
  scope(): AuditScope | undefined {
    return this.enabled ? Object.freeze({ log: this, traceId: `${this.worldId}:trace:${++this.traces}` }) : undefined;
  }
  record(input: AuditInput, scope?: AuditScope): AuditRecord | undefined {
    if (!this.enabled) return undefined;
    if (scope && scope.log !== this) throw new Error('Audit scope belongs to another world');
    const trace = scope ?? this.scope()!;
    const sequence = ++this.sequence;
    const record: AuditRecord = Object.freeze({
      id: `${this.worldId}:audit:${sequence}`, sequence, worldId: this.worldId,
      traceId: trace.traceId, parentId: trace.parentId,
      category: input.category, phase: input.phase ?? 'point', status: input.status ?? 'completed',
      instanceIds: Object.freeze([...(input.instanceIds ?? [])]), definitionIds: Object.freeze([...(input.definitionIds ?? [])]),
      data: snapshot(input.data ?? null),
    });
    if (this.buffer.length < this.capacity) this.buffer.push(record);
    else { this.buffer[this.head] = record; this.head = (this.head + 1) % this.capacity; this.discarded++; }
    const listeners = [...this.listeners];
    if (listeners.length) queueMicrotask(() => {
      for (const listener of listeners) {
        if (!this.listeners.has(listener)) continue;
        try {
          const returned = listener.callback(record) as unknown;
          if (returned && (typeof returned === 'object' || typeof returned === 'function')) void Promise.resolve(returned).catch(error => this.consumerError(error));
        } catch (error) { this.consumerError(error); }
      }
    });
    return record;
  }
  private consumerError(error: unknown) {
    this.observerErrors++;
    this.lastObserverError = errorMessage(error);
  }
  records(): readonly AuditRecord[] { return Object.freeze([...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)]); }
  stats() { return Object.freeze({ worldId: this.worldId, enabled: this.enabled, capacity: this.capacity, retained: this.buffer.length, discarded: this.discarded, sequence: this.sequence, observerErrors: this.observerErrors, lastObserverError: this.lastObserverError }); }
  clear() { this.buffer = []; this.head = 0; this.discarded = 0; }
  subscribe(callback: (record: AuditRecord) => void): () => void {
    const subscription = { callback };
    this.listeners.add(subscription);
    return () => { this.listeners.delete(subscription); };
  }
  remember(cause: object, scope?: AuditScope) { if (scope?.log === this) this.causes.set(cause, scope); }
  causeOf(cause: object): AuditScope | undefined { return this.causes.get(cause); }
}

export function auditScope(source?: AuditLog | AuditScope): AuditScope | undefined {
  return source instanceof AuditLog ? source.scope() : source;
}
export function auditSource(owner: { readonly audit?: AuditLog }, scope?: AuditScope): AuditLog | AuditScope | undefined {
  if (scope && owner.audit && scope.log !== owner.audit) {
    const error = new Error('Audit scope belongs to another world');
    owner.audit.record({ category: 'failure', status: 'failed', data: { source: 'auditContext', message: error.message, stateReverted: false } });
    throw error;
  }
  return scope ?? owner.audit;
}
export function note(scope: AuditScope | undefined, input: AuditInput): AuditScope | undefined {
  const record = scope?.log.record(input, scope);
  return record && scope ? Object.freeze({ ...scope, parentId: record.id }) : undefined;
}
export function mutation(scope: AuditScope | undefined, instance: { id: string; definitionId: string }, property: string, before: unknown, after: unknown, operation: string) {
  note(scope, { category: 'mutation', status: Object.is(before, after) ? 'unchanged' : 'applied', instanceIds: [instance.id], definitionIds: [instance.definitionId], data: { property, before, after, operation: scope?.operation ?? operation } });
}
export function audited<T>(source: AuditLog | AuditScope | undefined, input: AuditInput, body: (scope?: AuditScope) => T, status: (value: T) => string = () => 'completed'): T {
  const scope = note(auditScope(source), { ...input, phase: 'start', status: 'started' });
  try {
    const result = body(scope);
    note(scope, { ...input, phase: 'end', status: status(result) });
    return result;
  } catch (error) {
    note(scope, { category: 'failure', status: 'failed', instanceIds: input.instanceIds, definitionIds: input.definitionIds, data: { source: input.category, message: errorMessage(error), stateReverted: false } });
    note(scope, { ...input, phase: 'end', status: 'failed' });
    throw error;
  }
}
