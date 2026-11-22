import { AuditLog, audited, note, type AuditOptions, type AuditScope } from './audit';
import { DefinitionRegistry, ownData } from './definitions';
import { createCharacterInstance, type CharacterConfig } from './instances';
import { bindRootSymbol } from './references';
import { createIdentityStore, type FactionState, type GameState, type IdentityStore, type MissionState, type RelationState, type WorldMap } from './state';

export interface WorldConfig {
  map: WorldMap;
  player: CharacterConfig;
  scenarioId?: string;
  audit?: AuditOptions | AuditLog;
  /** Content adapters can enable a subset; additions enable newly registered missions. */
  missions?: readonly string[];
}
export function syncDefinitions(world: GameState): void {
  const catalog = world.definitions.catalog();
  world.objectDefinitions = catalog.characters;
  world.factionDefinitions = catalog.factions;
  world.eventDefinitions = catalog.events;
  world.relationDefinitions = catalog.relations;
  world.reactionDefinitions = catalog.reactions;
}
export function registerDefinitions(world: GameState, batch: Parameters<DefinitionRegistry['register']>[0]): void {
  const old = world.definitions.catalog();
  world.definitions.register(batch, world.audit);
  syncDefinitions(world);
  world.missionDefinitions = [...world.missionDefinitions, ...Object.values(world.definitions.catalog().missions).filter(d => !Object.hasOwn(old.missions, d.id))];
}
export function createWorldState(definitions: DefinitionRegistry, config: WorldConfig, parent?: AuditScope): GameState {
  const audit = config.audit instanceof AuditLog ? config.audit : new AuditLog(config.audit);
  return audited(parent ?? audit, { category: 'world', data: { scenarioId: config.scenarioId ?? 'external' } }, current => {
    const map = ownData(config.map);
    if (!Array.isArray(map) || !map.length || !Array.isArray(map[0]) || !map[0].length || map.some(row => !Array.isArray(row) || row.length !== map[0].length || row.some(tile => tile !== 'land' && tile !== 'water'))) throw new Error('Invalid rectangular land/water map');
    const registry = definitions.fork();
    const catalog = registry.catalog();
    const enabled = config.missions ?? Object.keys(catalog.missions);
    for (const id of enabled) if (!Object.hasOwn(catalog.missions, id)) throw new Error(`Unknown mission: ${id}`);
    const world = {
      ...createIdentityStore(audit), scenario: config.scenarioId ?? 'external', map, definitions: registry,
      entities: [],
      rootSymbols: Object.create(null), compositionAliases: Object.create(null),
      get missions() { return Object.values((this as IdentityStore).instances).filter((item): item is MissionState => item.kind === 'mission'); },
      get factions() { return Object.values((this as IdentityStore).instances).filter((item): item is FactionState => item.kind === 'faction'); },
      get relationInstances() { return Object.values((this as IdentityStore).instances).filter((item): item is RelationState => item.kind === 'relation'); },
      missionDefinitions: enabled.map(id => catalog.missions[id]),
      objectDefinitions: catalog.characters, factionDefinitions: catalog.factions, eventDefinitions: catalog.events,
      relationDefinitions: catalog.relations, reactionDefinitions: catalog.reactions,
      factSubscriptions: Object.create(null), processedFacts: new WeakSet(),
    } as unknown as GameState;
    Object.defineProperty(world, 'audit', { value: audit, enumerable: false });
    note(current, { category: 'definition', status: 'attached', definitionIds: Object.values(catalog).flatMap(records => Object.keys(records)), data: { source: 'immutableRegistrySnapshot' } });
    world.player = createCharacterInstance(world, config.player, current, false);
    if (config.player.key !== 'player') bindRootSymbol(world, 'player', world.player.id, current);
    note(current, { category: 'world', status: 'configured', instanceIds: [world.player.id], data: { auxiliary: 'player', map } });
    return world;
  });
}
