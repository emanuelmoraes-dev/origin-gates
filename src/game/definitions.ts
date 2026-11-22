import type { EventDefinition, ReactionDefinition } from './events';
import type { InteractionBinding, MissionDefinition, ObjectDefinition, RelationDefinition } from './state';
import { audited, note, type AuditLog, type AuditScope } from './audit';
import type { CompositionDefinition } from './composition-types';
import { parseReference, validateName, type ReferenceInput } from './references';
import { instanceKinds, type WorldInstance } from './state';

export interface FactionDefinition { readonly id: string; readonly name: string }
export interface DefinitionBatch {
  characters?: readonly ObjectDefinition[];
  factions?: readonly FactionDefinition[];
  relations?: readonly RelationDefinition[];
  events?: readonly EventDefinition[];
  reactions?: readonly ReactionDefinition[];
  missions?: readonly MissionDefinition[];
  compositions?: readonly CompositionDefinition[];
}
export interface DefinitionCatalog {
  readonly characters: Readonly<Record<string, ObjectDefinition>>;
  readonly factions: Readonly<Record<string, FactionDefinition>>;
  readonly relations: Readonly<Record<string, RelationDefinition>>;
  readonly events: Readonly<Record<string, EventDefinition>>;
  readonly reactions: Readonly<Record<string, ReactionDefinition>>;
  readonly missions: Readonly<Record<string, MissionDefinition>>;
  readonly compositions: Readonly<Record<string, CompositionDefinition>>;
}
type Data = Record<string, unknown>;
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Invalid definitions: ${message}`); }
function object(value: unknown): Data { check(value && typeof value === 'object' && !Array.isArray(value), 'expected object'); return value as Data; }
function list(value: unknown): unknown[] { check(Array.isArray(value), 'expected array'); return value; }
function text(value: unknown): asserts value is string { check(typeof value === 'string' && value.trim().length > 0, 'expected nonempty string'); }
function number(value: unknown): asserts value is number { check(typeof value === 'number' && Number.isFinite(value), 'expected finite number'); }
function member(value: unknown, values: readonly string[]) { check(typeof value === 'string' && values.includes(value), `unknown value: ${String(value)}`); }
function ref(map: object, id: unknown) { text(id); check(Object.hasOwn(map, id), `missing reference: ${id}`); }
function boolean(value: unknown) { check(typeof value === 'boolean', 'expected boolean'); }
function range(min: unknown, max: unknown) { number(min); number(max); check(min <= max, 'reversed bounds'); }
const roles = ['faction', 'opponent'];
const participants = ['actor', 'target', 'relation.source', 'relation.target'];
const statuses = ['available', 'active', 'ready', 'completed'];

/** Definition ownership is deliberately stricter than audit snapshots: no
 * callbacks, cycles, class instances or non-finite configuration values. */
export function ownData<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || value === undefined) return value;
  if (typeof value === 'number') { number(value); return value; }
  check(typeof value === 'object', 'content must be plain data');
  check(!seen.has(value), 'cyclic content');
  check(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'content must be plain objects');
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) check(!descriptor.get && !descriptor.set, 'content cannot have accessors');
  seen.add(value);
  const copy = Array.isArray(value) ? value.map(item => ownData(item, seen)) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, ownData(item, seen)]));
  seen.delete(value);
  return Object.freeze(copy) as T;
}
export function validatePosition(value: unknown): void {
  const p = object(value); number(p.x); number(p.y); check(Number.isInteger(p.x) && Number.isInteger(p.y), 'position must use integer tiles');
}
function valueRule(raw: unknown, catalog: DefinitionCatalog): void {
  if (typeof raw === 'number') { number(raw); return; }
  const v = object(raw);
  switch (v.source) {
    case 'attribute': text(v.key); return;
    case 'relation': member(v.faction, roles); ref(catalog.relations, 'reputation'); return;
    case 'missionTargetHp': case 'relationIntensity': return;
    case 'distance': member(v.from, participants); member(v.to, participants); return;
    default: throw new Error(`Invalid definitions: unknown value source ${String(v.source)}`);
  }
}
function conditionRule(raw: unknown, catalog: DefinitionCatalog): void {
  if (typeof raw === 'string') { member(raw, ['actorAlive', 'targetAlive', 'adjacent', 'targetAttackable']); return; }
  const c = object(raw);
  if (c.message !== undefined) text(c.message);
  switch (c.type) {
    case 'compare': valueRule(c.left, catalog); member(c.operator, ['gte', 'lte']); valueRule(c.right, catalog); return;
    case 'missionStatus': for (const status of list(c.statuses)) member(status, statuses); return;
    case 'sameInstance': member(c.left, participants); member(c.right, participants); return;
    case 'alive': member(c.entity, participants); return;
    case 'noActiveMission': return;
    default: throw new Error(`Invalid definitions: unknown condition ${String(c.type)}`);
  }
}
function operationRule(raw: unknown, catalog: DefinitionCatalog): void {
  const op = object(raw);
  switch (op.type) {
    case 'damage': valueRule(op.amount, catalog); return;
    case 'relation': member(op.faction, roles); number(op.amount); ref(catalog.relations, 'reputation'); return;
    case 'attributeReward':
      text(op.key); number(op.max); valueRule(op.value, catalog);
      for (const rawBand of list(op.bands)) { const band = object(rawBand); range(band.min, band.max); number(band.amount); }
      return;
    case 'missionStatus': member(op.status, statuses.filter(s => s !== 'available')); return;
    case 'setReference': member(op.entity, participants); text(op.key); member(op.value, participants); return;
    case 'spawnTarget': return;
    default: throw new Error(`Invalid definitions: unknown operation ${String(op.type)}`);
  }
}
export function validateInteractions(raw: unknown, catalog: DefinitionCatalog): asserts raw is readonly InteractionBinding[] {
  for (const item of list(raw)) {
    const binding = object(item); ref(catalog.events, binding.event);
    if (binding.context !== undefined) member(object(binding.context).offer, ['target']);
  }
}
function offerContent(raw: unknown, catalog: DefinitionCatalog): Data {
  const offer = object(raw);
  ref(catalog.missions, offer.mission); ref(catalog.characters, offer.target); text(offer.name); validatePosition(offer.spawn);
  return offer;
}
export function validateOffer(raw: unknown, catalog: DefinitionCatalog, concrete: boolean): void {
  const offer = offerContent(raw, catalog);
  if (concrete) text(offer.opponentId);
  else ref(catalog.factions, offer.opponent);
}
function validateComposition(definition: CompositionDefinition, catalog: DefinitionCatalog): void {
  for (const key of Object.keys(definition)) check(['id', 'characters', 'factions', 'relations', 'parameters', 'roles'].includes(key), `unknown composition field: ${key}`);
  const parameters = object(definition.parameters ?? {});
  const roles = object(definition.roles ?? {});
  const symbols = new Map<string, WorldInstance['kind']>([['self', 'composition']]);
  for (const [key, raw] of Object.entries(parameters)) { validateName(key); member(object(raw).kind, instanceKinds); }
  for (const [key, raw] of Object.entries(roles)) {
    validateName(key); const role = object(raw); member(role.kind, instanceKinds);
    if (role.allowVacant !== undefined) boolean(role.allowVacant);
    check(role.allowVacant !== false || role.initial !== undefined, `role ${key} requires an initial occupant`);
  }
  for (const [category, kind] of [['factions', 'faction'], ['characters', 'character'], ['relations', 'relation']] as const) {
    for (const raw of list(definition[category] ?? [])) {
      const item = object(raw);
      if (category === 'relations' && item.key === undefined) continue;
      validateName(item.key); check(!symbols.has(item.key), `duplicate composition symbol: ${item.key}`);
      symbols.set(item.key, kind);
    }
  }
  const referenceKind = (raw: unknown): WorldInstance['kind'] | undefined => {
    if (raw && typeof raw === 'object' && Object.hasOwn(raw, 'parameter')) {
      const parameter = object(raw); check(Object.keys(parameter).length === 1, 'invalid parameter reference');
      validateName(parameter.parameter); ref(parameters, parameter.parameter);
      return object(parameters[parameter.parameter]).kind as WorldInstance['kind'];
    }
    const reference = parseReference(raw as ReferenceInput);
    if (reference.type === 'instance' || reference.scope !== undefined) return undefined; // Contextual, not a definition lookup.
    if (reference.type === 'symbol') { check(symbols.has(reference.key), `missing local symbol: ${reference.key}`); return symbols.get(reference.key); }
    ref(roles, reference.key); return object(roles[reference.key]).kind as WorldInstance['kind'];
  };
  const compatible = (raw: unknown, kinds: readonly string[]) => {
    const kind = referenceKind(raw); if (kind !== undefined) check(kinds.includes(kind), `incompatible composition reference category: ${kind}`);
  };
  for (const item of definition.factions ?? []) ref(catalog.factions, item.definitionId);
  for (const item of definition.characters ?? []) {
    ref(catalog.characters, item.definitionId); validatePosition(item.position);
    if (item.label !== undefined) check(typeof item.label === 'string', 'invalid label');
    if (item.interactions !== undefined) validateInteractions(item.interactions, catalog);
    if (item.faction !== undefined) compatible(item.faction, ['faction']);
    check(!catalog.characters[item.definitionId].offer || item.offer !== undefined, 'composition member requires an explicit local offer');
    if (item.offer !== undefined) { const offer = offerContent(item.offer, catalog); compatible(offer.opponent, ['faction']); }
  }
  for (const item of definition.relations ?? []) {
    ref(catalog.relations, item.definitionId); number(item.intensity);
    const relation = catalog.relations[item.definitionId];
    compatible(item.source, relation.sourceKinds); compatible(item.target, relation.targetKinds);
  }
  for (const raw of Object.values(roles)) {
    const role = object(raw); if (role.initial !== undefined) compatible(role.initial, [role.kind as string]);
  }
}
function validate(catalog: DefinitionCatalog) {
  for (const definition of Object.values(catalog.characters)) {
    text(definition.name); number(definition.maxHp); check(definition.maxHp > 0, 'maxHp must be positive');
    check(/^#[0-9a-f]{6}$/i.test(definition.color), 'color must be #RRGGBB');
    if (definition.damage !== undefined) number(definition.damage);
    if (definition.attackable !== undefined) boolean(definition.attackable);
    if (definition.interactions !== undefined) validateInteractions(definition.interactions, catalog);
    if (definition.offer !== undefined) validateOffer(definition.offer, catalog, false);
  }
  for (const definition of Object.values(catalog.factions)) text(definition.name);
  for (const definition of Object.values(catalog.relations)) {
    text(definition.name); boolean(definition.unique);
    for (const raw of [definition.sourceKinds, definition.targetKinds]) {
      const kinds = list(raw); check(kinds.length, 'empty relation categories');
      for (const kind of kinds) member(kind, instanceKinds);
    }
    if (definition.intensity !== undefined) range(definition.intensity.min, definition.intensity.max);
    for (const id of list(definition.reactions)) ref(catalog.reactions, id);
  }
  for (const definition of Object.values(catalog.events)) {
    for (const c of list(definition.when ?? [])) conditionRule(c, catalog);
    for (const c of list(definition.conditions)) conditionRule(c, catalog);
    for (const raw of list(definition.emits ?? [])) text(object(raw).type);
    const outcomes = list(definition.outcomes); check(outcomes.length, 'empty outcomes');
    let total = 0;
    for (const raw of outcomes) {
      const outcome = object(raw); text(outcome.id); number(outcome.weight); check(outcome.weight > 0, 'weight must be positive'); total += outcome.weight;
      for (const op of list(outcome.operations)) operationRule(op, catalog);
      const feedback = object(outcome.feedback); text(feedback.color); text(feedback.message); number(feedback.durationMs); check(feedback.durationMs >= 0, 'negative feedback duration');
    }
    check(Number.isFinite(total), 'non-finite total weight');
  }
  for (const definition of Object.values(catalog.reactions)) {
    text(definition.on);
    for (const c of list(definition.when)) conditionRule(c, catalog);
    for (const op of list(definition.operations)) operationRule(op, catalog);
  }
  for (const definition of Object.values(catalog.missions)) {
    text(definition.name); member(definition.initialStatus, ['active']);
    for (const id of list(definition.reactions)) ref(catalog.events, id);
  }
  for (const definition of Object.values(catalog.compositions)) validateComposition(definition, catalog);
}
const categories = ['characters', 'factions', 'relations', 'events', 'reactions', 'missions', 'compositions'] as const;
function empty(): DefinitionCatalog { return Object.freeze(Object.fromEntries(categories.map(category => [category, Object.freeze(Object.create(null))])) as unknown as DefinitionCatalog); }

export class DefinitionRegistry {
  #catalog = empty();
  #executing = 0;
  catalog(): DefinitionCatalog { return this.#catalog; }
  fork(): DefinitionRegistry { const fork = new DefinitionRegistry(); fork.#catalog = this.#catalog; return fork; }
  executing<T>(body: () => T): T {
    this.#executing++;
    try { return body(); } finally { this.#executing--; }
  }
  register(batch: DefinitionBatch, source?: AuditLog | AuditScope): void {
    audited(source, { category: 'definition', data: { action: 'register' } }, scope => {
      check(this.#executing === 0, 'registration is only allowed between narrative executions');
      const owned = ownData(object(batch));
      for (const key of Object.keys(owned)) check((categories as readonly string[]).includes(key), `unknown category ${key}`);
      const candidate = Object.fromEntries(categories.map(category => [category, Object.assign(Object.create(null), this.#catalog[category])])) as unknown as DefinitionCatalog;
      const ids: string[] = [];
      for (const category of categories) for (const raw of list(owned[category] ?? [])) {
        const definition = object(raw); text(definition.id);
        const map = candidate[category] as Record<string, unknown>;
        check(!Object.hasOwn(map, definition.id), `duplicate ${category} ID ${definition.id}`);
        map[definition.id] = definition; ids.push(definition.id);
      }
      validate(candidate); // Full candidate, including forward references, before commit.
      for (const category of categories) Object.freeze(candidate[category]);
      this.#catalog = Object.freeze(candidate);
      note(scope, { category: 'definition', status: 'registered', definitionIds: ids, data: { categories: Object.keys(owned) } });
    });
  }
}
