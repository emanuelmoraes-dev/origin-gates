import type { Fact, ReactionDefinition } from './events';
import { AuditLog, audited, auditScope, auditSource, mutation, note, type AuditScope } from './audit';
import { inspectInstance } from './inspection';

export interface Position { x: number; y: number }
export interface InteractionBinding {
  readonly event: string;
  readonly context?: { readonly offer: 'target' };
}
export interface EntitySpawn {
  object: string;
  position: Position;
  interactions?: readonly InteractionBinding[];
  faction?: string;
  key?: string;
  label?: string;
}
export interface ObjectDefinition {
  readonly id: string;
  readonly name: string;
  readonly maxHp: number;
  readonly color: string;
  readonly damage?: number;
  readonly attackable?: boolean;
  readonly interactions?: readonly InteractionBinding[];
  readonly offer?: OfferDefinition;
}
export interface Identity { readonly id: string; readonly definitionId: string }
export interface OfferDefinition {
  readonly mission: string; readonly name: string; readonly target: string;
  readonly opponent: string; readonly spawn: Position;
}
export interface MissionOffer extends Omit<OfferDefinition, 'opponent'> { readonly opponentId: string }
export interface EntityState extends Identity {
  readonly kind: 'character';
  readonly definition: ObjectDefinition;
  position: Position;
  hp: number;
  attributes: Record<string, number>;
  interactions?: readonly InteractionBinding[];
  factionId?: string;
  offer?: MissionOffer;
  label?: string;
  references: Record<string, string>;
}
export type Tile = 'land' | 'water';
export type WorldMap = readonly (readonly Tile[])[];
export type MissionStatus = 'available' | 'active' | 'ready' | 'completed';
export interface MissionDefinition {
  readonly id: string; readonly name: string;
  readonly initialStatus: 'active'; readonly reactions: readonly string[];
}
export interface MissionState extends Identity {
  readonly kind: 'mission';
  readonly executorId: string; readonly contractorId: string;
  readonly targetId: string; readonly opponentId: string;
  readonly name: string;
  status: Exclude<MissionStatus, 'available'>;
}
export interface FactionState extends Identity { readonly kind: 'faction'; readonly name: string }
export interface RelationDefinition {
  readonly id: string; readonly name: string; readonly reactions: readonly string[];
  readonly sourceKinds: readonly WorldInstance['kind'][];
  readonly targetKinds: readonly WorldInstance['kind'][];
  readonly unique: boolean;
  readonly intensity?: { readonly min: number; readonly max: number };
}
export interface RelationState extends Identity {
  readonly kind: 'relation'; readonly sourceId: string; readonly targetId: string;
  intensity: number;
}
export interface RelationSpawn { definition: string; source: string; target: string; intensity: number }
export type WorldInstance = EntityState | MissionState | FactionState | RelationState;
export interface IdentityStore { nextId: number; instances: Record<string, WorldInstance>; readonly audit?: AuditLog }
export function createIdentityStore(audit = new AuditLog()): IdentityStore {
  return Object.defineProperty({ nextId: 1, instances: {} }, 'audit', { value: audit, enumerable: false });
}
export function registerInstance(store: IdentityStore, instance: WorldInstance, scope?: AuditScope): void {
  const current = auditScope(auditSource(store, scope));
  store.instances[instance.id] = instance;
  note(current, { category: 'instance', status: 'created', instanceIds: [instance.id], definitionIds: [instance.definitionId], data: inspectInstance(instance) });
}
export function identity(store: IdentityStore, definitionId: string, scope?: AuditScope): Identity {
  const source = auditSource(store, scope);
  const before = store.nextId;
  const result = { id: `entity_${String(store.nextId++).padStart(6, '0')}`, definitionId };
  note(auditScope(source), { category: 'instance', status: 'allocated', instanceIds: [result.id], definitionIds: [definitionId], data: { nextIdBefore: before, nextIdAfter: store.nextId } });
  return result;
}
export function resolve<K extends WorldInstance['kind']>(store: IdentityStore, id: string, kind: K): Extract<WorldInstance, { kind: K }> {
  const entity = store.instances[id];
  if (!entity || entity.kind !== kind) throw new Error(`Invalid ${kind} reference: ${id}`);
  return entity as Extract<WorldInstance, { kind: K }>;
}
export interface GameState extends IdentityStore {
  scenario: string;
  player: EntityState;
  entities: EntityState[];
  readonly missions: readonly MissionState[];
  readonly factions: readonly FactionState[];
  missionDefinitions: readonly MissionDefinition[];
  objectDefinitions: Readonly<Record<string, ObjectDefinition>>;
  readonly relationInstances: readonly RelationState[];
  relationDefinitions: Readonly<Record<string, RelationDefinition>>;
  reactionDefinitions: Readonly<Record<string, ReactionDefinition>>;
  factSubscriptions: Record<string, { relationId: string; ruleId: string }[]>;
  processedFacts: WeakSet<Fact>;
}

// Source of the map can change without changing movement or rendering.
export const worldMap: WorldMap = [
  'LLLLLLWWLL',
  'LLLLLLWWLL',
  'LLLLLLWLLL',
  'LLWWLLLLLL',
  'LLWWLLLLLL',
  'LLLLLLLLLL',
  'LLLLLLWWLL',
  'LWLLLLWWLL',
  'LWWLLLLLLL',
  'LLLLLLLLLL',
].map(row => [...row].map(tile => tile === 'L' ? 'land' : 'water'));

export function createEntity(definition: ObjectDefinition, position: Position, store: IdentityStore, interactions?: readonly InteractionBinding[], scope?: AuditScope): EntityState {
  return audited(auditSource(store, scope), { category: 'operation', definitionIds: definition ? [definition.id] : [], data: { type: 'createEntity' } }, current => {
  if (!definition) throw new Error('Unknown character definition');
  const entity: EntityState = { ...identity(store, definition.id, current), kind: 'character', definition, position: { ...position }, hp: definition.maxHp, attributes: { damage: definition.damage ?? 10 }, interactions, references: {} };
  registerInstance(store, entity, current);
  return entity;
  });
}

export function createRelation(world: GameState, definitionId: string, sourceId: string, targetId: string, intensity: number, scope?: AuditScope): RelationState {
  return audited(auditSource(world, scope), { category: 'operation', instanceIds: [sourceId, targetId], definitionIds: [definitionId], data: { type: 'createRelation', intensity } }, current => {
  const definition = validateRelationEndpoints(world, definitionId, sourceId, targetId);
  const value = normalizeIntensity(definition, intensity);
  if (definition.unique && world.relationInstances.some(r => r.definitionId === definitionId && r.sourceId === sourceId && r.targetId === targetId)) {
    throw new Error('Duplicate directional relation');
  }
  const rules = [...new Set(definition.reactions)].map(ruleId => {
    const rule = world.reactionDefinitions[ruleId];
    if (!rule) throw new Error(`Unknown reaction rule: ${ruleId}`);
    return { ruleId, on: rule.on };
  });
  const relation: RelationState = { ...identity(world, definition.id, current), kind: 'relation', sourceId, targetId, intensity: value };
  registerInstance(world, relation, current);
  for (const rule of rules) (world.factSubscriptions[rule.on] ??= []).push({ relationId: relation.id, ruleId: rule.ruleId });
  note(current, { category: 'dispatch', status: 'subscribed', instanceIds: [relation.id], data: { rules } });
  return relation;
  });
}

function validateRelationEndpoints(world: GameState, definitionId: string, sourceId: string, targetId: string): RelationDefinition {
  const definition = world.relationDefinitions[definitionId];
  if (!definition || definition.id !== definitionId || typeof definition.unique !== 'boolean' || !definition.sourceKinds?.length || !definition.targetKinds?.length) throw new Error('Invalid relation definition');
  for (const [id, kinds] of [[sourceId, definition.sourceKinds], [targetId, definition.targetKinds]] as const) {
    const instance = world.instances[id];
    if (!instance || instance.id !== id || !kinds.includes(instance.kind)) throw new Error(`Invalid relation participant: ${id}`);
  }
  return definition;
}

function normalizeIntensity(definition: RelationDefinition, value: number): number {
  if (!Number.isFinite(value)) throw new Error('Non-finite relation intensity');
  const bounds = definition.intensity;
  if (!bounds) return value;
  if (!Number.isFinite(bounds.min) || !Number.isFinite(bounds.max) || bounds.min > bounds.max) throw new Error('Invalid relation intensity bounds');
  return Math.max(bounds.min, Math.min(bounds.max, value));
}

export function findRelation(world: GameState, definitionId: string, sourceId: string, targetId: string): RelationState | undefined {
  validateRelationEndpoints(world, definitionId, sourceId, targetId);
  const matches = world.relationInstances.filter(r => r.definitionId === definitionId && r.sourceId === sourceId && r.targetId === targetId);
  if (matches.length > 1) throw new Error('Ambiguous relation; use an instance ID');
  return matches[0];
}

export function requireRelation(world: GameState, definitionId: string, sourceId: string, targetId: string): RelationState {
  const relation = findRelation(world, definitionId, sourceId, targetId);
  if (!relation) throw new Error(`Missing relation: ${definitionId} (${sourceId} -> ${targetId})`);
  return relation;
}

export function getRelationIntensity(world: GameState, relationId: string): number {
  const relation = resolve(world, relationId, 'relation');
  const definition = validateRelationEndpoints(world, relation.definitionId, relation.sourceId, relation.targetId);
  if (normalizeIntensity(definition, relation.intensity) !== relation.intensity) throw new Error('Relation intensity outside definition bounds');
  return relation.intensity;
}

export function setRelationIntensity(world: GameState, relationId: string, value: number, scope?: AuditScope): void {
  return audited(auditSource(world, scope), { category: 'operation', instanceIds: [relationId], data: { type: 'setRelationIntensity', value } }, current => {
  const relation = resolve(world, relationId, 'relation');
  const definition = validateRelationEndpoints(world, relation.definitionId, relation.sourceId, relation.targetId);
  const before = relation.intensity;
  relation.intensity = normalizeIntensity(definition, value);
  mutation(current, relation, 'intensity', before, relation.intensity, 'setRelationIntensity');
  });
}

export function addRelationDelta(world: GameState, relationId: string, delta: number, scope?: AuditScope): void {
  return audited(auditSource(world, scope), { category: 'operation', instanceIds: [relationId], data: { type: 'addRelationDelta', delta } }, current => {
  if (!Number.isFinite(delta)) throw new Error('Non-finite relation delta');
  setRelationIntensity(world, relationId, getRelationIntensity(world, relationId) + delta, current);
  });
}

export function pendingMission(world: GameState, executorId: string, contractorId: string): MissionState | undefined {
  return world.missions.find(mission => mission.executorId === executorId && mission.contractorId === contractorId && (mission.status === 'active' || mission.status === 'ready'));
}

export function isAdjacent(a: EntityState, b: EntityState): boolean {
  return Math.abs(a.position.x - b.position.x) + Math.abs(a.position.y - b.position.y) === 1;
}

export function movePlayer(player: EntityState, dx: number, dy: number, map: WorldMap, occupants: readonly EntityState[], scope?: AuditScope): boolean {
  return audited(scope, { category: 'movement', instanceIds: [player.id], data: { dx, dy } }, current => {
  if (player.hp <= 0 || Math.abs(dx) + Math.abs(dy) !== 1) return false;
  const x = player.position.x + dx;
  const y = player.position.y + dy;
  if (map[y]?.[x] !== 'land') return false;
  if (occupants.some(entity => entity.hp > 0 && entity.position.x === x && entity.position.y === y)) return false;
  const before = player.position;
  player.position = { x, y };
  mutation(current, player, 'position', before, player.position, 'movePlayer');
  return true;
  }, moved => moved ? 'accepted' : 'rejected');
}
