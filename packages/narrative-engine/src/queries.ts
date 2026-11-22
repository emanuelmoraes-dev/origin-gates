import { ownData } from './definitions.js';
import { isAdjacent, isPendingMission, resolve, type EntityState, type FactionState, type GameState, type Identity, type MissionOffer, type MissionState, type RelationState } from './state.js';

export type ReadonlyData<T> = T extends object ? { readonly [K in keyof T]: ReadonlyData<T[K]> } : T;
export interface CharacterView extends Identity {
  readonly kind: 'character'; readonly name: string; readonly label?: string;
  readonly color: string; readonly maxHp: number; readonly hp: number; readonly alive: boolean;
  readonly position: Readonly<{ x: number; y: number }>;
  readonly attributes: Readonly<Record<string, number>>;
  readonly references: Readonly<Record<string, string>>;
  readonly factionId?: string; readonly offer?: ReadonlyData<MissionOffer>;
}
export type FactionView = ReadonlyData<FactionState>;
export type MissionView = ReadonlyData<MissionState>;
export type RelationView = ReadonlyData<RelationState & { name: string }>;
export interface RelationFilter { definitionId?: string; sourceId?: string; targetId?: string; participantId?: string }
export interface MissionFilter { executorId?: string; contractorId?: string; pending?: boolean }

function characterView(entity: EntityState): CharacterView {
  const { id, definitionId, createdByCompositionId, label, position, hp, attributes, references, factionId, offer, definition } = entity;
  return ownData({ id, definitionId, ...(createdByCompositionId === undefined ? {} : { createdByCompositionId }), kind: 'character' as const,
    name: definition.name, color: definition.color, maxHp: definition.maxHp, label, position, hp, alive: hp > 0, attributes, references, factionId, offer });
}
export function adjacentCharacters(world: GameState, actorId: string): EntityState[] {
  const actor = resolve(world, actorId, 'character');
  return Object.values(world.instances).filter((item): item is EntityState => item.kind === 'character' && item.hp > 0 && isAdjacent(actor, item));
}
/** Current-state reads only: no audit, diagnostic encoding or event replay. */
export function createQueries(world: GameState) {
  const characters = () => Object.values(world.instances).filter((item): item is EntityState => item.kind === 'character');
  return Object.freeze({
    characters: (): readonly CharacterView[] => Object.freeze(characters().map(characterView)),
    character: (id: string): CharacterView | undefined => {
      if (typeof id !== 'string' || !id) throw new Error('Invalid character ID');
      if (!Object.hasOwn(world.instances, id)) return undefined;
      return characterView(resolve(world, id, 'character'));
    },
    adjacent: (actorId: string): readonly CharacterView[] => Object.freeze(adjacentCharacters(world, actorId).map(characterView)),
    factions: (): readonly FactionView[] => ownData(world.factions),
    relations: (filter: RelationFilter = {}): readonly RelationView[] => ownData(world.relationInstances.filter(r =>
      (filter.definitionId === undefined || r.definitionId === filter.definitionId)
      && (filter.sourceId === undefined || r.sourceId === filter.sourceId)
      && (filter.targetId === undefined || r.targetId === filter.targetId)
      && (filter.participantId === undefined || r.sourceId === filter.participantId || r.targetId === filter.participantId)
    ).map(r => ({ ...r, name: world.relationDefinitions[r.definitionId].name }))),
    missions: (filter: MissionFilter = {}): readonly MissionView[] => {
      for (const id of [filter.executorId, filter.contractorId]) if (id !== undefined && Object.hasOwn(world.instances, id)) resolve(world, id, 'character');
      return ownData(world.missions.filter(m => (filter.executorId === undefined || m.executorId === filter.executorId)
        && (filter.contractorId === undefined || m.contractorId === filter.contractorId)
        && (filter.pending === undefined || isPendingMission(m) === filter.pending)));
    },
  });
}
export type NarrativeQueries = ReturnType<typeof createQueries>;
