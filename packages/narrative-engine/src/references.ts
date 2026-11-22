import { note, type AuditScope } from './audit.js';
import { instanceKinds, type CompositionState, type GameState, type InstanceIdentity, type InstanceLookup, type WorldInstance } from './state.js';

export type NarrativeReference =
  | { readonly type: 'instance'; readonly id: string }
  | { readonly type: 'symbol'; readonly scope?: string; readonly key: string }
  | { readonly type: 'role'; readonly scope?: string; readonly key: string };
export type ReferenceInput = string | NarrativeReference;
export interface ResolutionContext { readonly compositionId?: string; readonly kind?: WorldInstance['kind'] }
export type ResolutionErrorCode = 'invalidSyntax' | 'missingContext' | 'compositionNotFound' | 'aliasNotFound' | 'symbolNotFound' | 'roleNotFound' | 'roleVacant' | 'kindMismatch' | 'instanceNotFound';
export class ReferenceResolutionError extends Error {
  constructor(readonly code: ResolutionErrorCode, message: string) { super(message); this.name = 'ReferenceResolutionError'; }
}
const fail = (code: ResolutionErrorCode, message: string): never => { throw new ReferenceResolutionError(code, message); };
const identifier = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const concreteId = /^entity_[0-9]{6,}$/;
export function validateName(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !identifier.test(value) || /^entity_[0-9]+$/.test(value)) fail('invalidSyntax', `Invalid symbolic name: ${String(value)}`);
}
export function validateAlias(value: unknown): asserts value is string {
  validateName(value);
  if (value === 'root') fail('invalidSyntax', 'Reserved composition alias: root');
}
/** One grammar; IDs and symbols never compete through lookup fallbacks. */
export function parseReference(input: ReferenceInput): NarrativeReference {
  if (typeof input === 'string') {
    if (concreteId.test(input)) return Object.freeze({ type: 'instance', id: input });
    const parts = input.split('#');
    if (parts.length > 2) return fail('invalidSyntax', `Invalid reference: ${input}`);
    const scope = parts.length === 2 ? parts[0] : undefined;
    if (scope !== undefined) validateName(scope);
    const token = parts.at(-1)!;
    const role = token.startsWith('<') && token.endsWith('>');
    const key = role ? token.slice(1, -1) : token;
    validateName(key);
    if (scope === 'root' && role) return fail('invalidSyntax', 'Root has symbols, not roles');
    return Object.freeze({ type: role ? 'role' : 'symbol', ...(scope === undefined ? {} : { scope }), key });
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('invalidSyntax', 'Expected reference data');
  if (input.type === 'instance') {
    if (typeof input.id !== 'string' || !input.id || Object.keys(input).some(k => k !== 'type' && k !== 'id')) return fail('invalidSyntax', 'Invalid instance reference');
    return Object.freeze({ type: 'instance', id: input.id });
  }
  if (input.type !== 'symbol' && input.type !== 'role') return fail('invalidSyntax', 'Unknown reference type');
  if (Object.keys(input).some(k => !['type', 'scope', 'key'].includes(k))) return fail('invalidSyntax', 'Unknown reference field');
  validateName(input.key);
  if (input.scope !== undefined) validateName(input.scope);
  if (input.scope === 'root' && input.type === 'role') return fail('invalidSyntax', 'Root has symbols, not roles');
  return Object.freeze({ ...input });
}

export type ReferenceStore = Pick<GameState, 'rootSymbols' | 'compositionAliases'> & InstanceLookup;
export function compositionScope(store: ReferenceStore, id: string): CompositionState {
  const instance = store.instances[id];
  if (!instance || instance.kind !== 'composition' || !('symbols' in instance) || !('roles' in instance)) return fail('compositionNotFound', `Composition not found: ${id}`);
  return instance as CompositionState;
}
function referenceScope(store: ReferenceStore, scope: string | undefined, context: ResolutionContext): CompositionState | 'root' {
  if (scope === 'root') return 'root';
  if (scope !== undefined) {
    if (!Object.hasOwn(store.compositionAliases, scope)) return fail('aliasNotFound', `Composition alias not found: ${scope}`);
    const id = store.compositionAliases[scope];
    return compositionScope(store, id);
  }
  if (!context.compositionId) return fail('missingContext', 'Local references require compositionId');
  return compositionScope(store, context.compositionId);
}

/** The optional role reader is internal to preparation of forward role references. */
export function resolveReference(store: ReferenceStore, input: ReferenceInput, context: ResolutionContext = {}, scope?: AuditScope, readRole = (composition: CompositionState, key: string) => composition.roles[key]): InstanceIdentity | undefined {
  const reference = parseReference(input);
  if (context.kind !== undefined && !instanceKinds.includes(context.kind)) return fail('kindMismatch', 'Unknown expected instance kind');
  let id: string | null | undefined;
  if (reference.type === 'instance') id = reference.id;
  else {
    const owner = referenceScope(store, reference.scope, context);
    if (reference.type === 'symbol') {
      const symbols = owner === 'root' ? store.rootSymbols : owner.symbols;
      if (!Object.hasOwn(symbols, reference.key)) return fail('symbolNotFound', `Symbol not found: ${reference.key}`);
      id = symbols[reference.key];
    } else {
      if (owner === 'root' || !Object.hasOwn(owner.roles, reference.key)) return fail('roleNotFound', `Role not found: ${reference.key}`);
      id = readRole(owner, reference.key);
      if (id === null) {
        note(scope, { category: 'reference', status: 'vacant', instanceIds: [owner.id], data: { reference, context } });
        return undefined;
      }
    }
  }
  const instance = id && Object.hasOwn(store.instances, id) ? store.instances[id] : undefined;
  if (!instance) return fail('instanceNotFound', `Instance not found: ${String(id)}`);
  if (context.kind && instance.kind !== context.kind) return fail('kindMismatch', `Expected ${context.kind}, got ${instance.kind}: ${id}`);
  note(scope, { category: 'reference', status: 'resolved', instanceIds: [instance.id], data: { reference, context, kind: instance.kind } });
  return instance;
}
export function requireReference(store: ReferenceStore, input: ReferenceInput, context: ResolutionContext = {}, scope?: AuditScope): InstanceIdentity {
  return resolveReference(store, input, context, scope) ?? fail('roleVacant', `Role is vacant: ${JSON.stringify(input)}`);
}
export function validateRootKey(world: Pick<GameState, 'rootSymbols'>, key?: string): void {
  if (key === undefined) return;
  validateName(key);
  if (Object.hasOwn(world.rootSymbols, key)) throw new Error(`Duplicate root symbol: ${key}`);
}
export function bindRootSymbol(world: Pick<GameState, 'rootSymbols'>, key: string, id: string, scope?: AuditScope): void {
  validateRootKey(world, key);
  world.rootSymbols[key] = id;
  note(scope, { category: 'reference', status: 'bound', instanceIds: [id], data: { scope: 'root', key } });
}
