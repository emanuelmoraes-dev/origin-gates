export interface Position { x: number; y: number }
export interface ObjectDefinition {
  readonly id: string;
  readonly name: string;
  readonly maxHp: number;
  readonly color: string;
  readonly damage?: number;
  readonly attackable?: boolean;
}
export interface EntityState {
  readonly definition: ObjectDefinition;
  position: Position;
  hp: number;
  attributes: Record<string, number>;
}
export type Tile = 'land' | 'water';
export type WorldMap = readonly (readonly Tile[])[];
export type MissionStatus = 'available' | 'active' | 'ready' | 'completed';
export interface MissionDefinition {
  id: string; name: string; faction: string; opponent: string;
  representative: string; target: string; spawn: Position; interactions: string[];
}
export interface MissionState { status: MissionStatus; target?: EntityState }
export interface GameState {
  scenario: string;
  player: EntityState;
  entities: EntityState[];
  relations: Record<string, number>;
  missions: Record<string, MissionState>;
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

export function createEntity(definition: ObjectDefinition, position: Position): EntityState {
  return { definition, position: { ...position }, hp: definition.maxHp, attributes: { damage: definition.damage ?? 10 } };
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
