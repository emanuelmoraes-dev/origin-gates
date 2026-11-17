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
export type WorldInstance = EntityState | MissionState | FactionState;
export interface IdentityStore { nextId: number; instances: Record<string, WorldInstance> }
export function createIdentityStore(): IdentityStore { return { nextId: 1, instances: {} }; }
export function identity(store: IdentityStore, definitionId: string): Identity {
  return { id: `entity_${String(store.nextId++).padStart(6, '0')}`, definitionId };
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
  relations: Record<string, number>;
  readonly missions: readonly MissionState[];
  readonly factions: readonly FactionState[];
  missionDefinitions: readonly MissionDefinition[];
  objectDefinitions: Readonly<Record<string, ObjectDefinition>>;
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

export function createEntity(definition: ObjectDefinition, position: Position, store: IdentityStore, interactions?: readonly InteractionBinding[]): EntityState {
  if (!definition) throw new Error('Unknown character definition');
  const entity: EntityState = { ...identity(store, definition.id), kind: 'character', definition, position: { ...position }, hp: definition.maxHp, attributes: { damage: definition.damage ?? 10 }, interactions };
  store.instances[entity.id] = entity;
  return entity;
}

export function pendingMission(world: GameState, executorId: string, contractorId: string): MissionState | undefined {
  return world.missions.find(mission => mission.executorId === executorId && mission.contractorId === contractorId && (mission.status === 'active' || mission.status === 'ready'));
}

export function isAdjacent(a: EntityState, b: EntityState): boolean {
  return Math.abs(a.position.x - b.position.x) + Math.abs(a.position.y - b.position.y) === 1;
}

export function movePlayer(player: EntityState, dx: number, dy: number, map: WorldMap, occupants: readonly EntityState[]): boolean {
  if (player.hp <= 0 || Math.abs(dx) + Math.abs(dy) !== 1) return false;
  const x = player.position.x + dx;
  const y = player.position.y + dy;
  if (map[y]?.[x] !== 'land') return false;
  if (occupants.some(entity => entity.hp > 0 && entity.position.x === x && entity.position.y === y)) return false;
  player.position = { x, y };
  return true;
}
