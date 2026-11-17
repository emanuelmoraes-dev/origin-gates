import player from '../data/objects/player.json';
import enemy from '../data/objects/enemy.json';
import socialObjects from '../data/objects/social.json';
import missions from '../data/missions.json';
import factionDefinitions from '../data/factions.json';
import scenarios from '../data/scenarios.json';
import attack from '../data/events/attack.json';
import socialEvents from '../data/events/social.json';
import { executeEvent, matches, type EventDefinition, type EventResult } from './events';
import { createEntity, createIdentityStore, identity, isAdjacent, resolve, type EntitySpawn, type EntityState, type FactionState, type GameState, type MissionDefinition, type MissionState, type ObjectDefinition } from './state';
import { selectInteraction } from './interactions';

export { scenarios };
export const events = { attack, ...socialEvents } as Record<string, EventDefinition>;
export function createWorld(scenarioId: string): GameState {
  const scenario = scenarios.find(item => item.id === scenarioId);
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
  const objectDefinitions = { player, enemy, ...socialObjects } as Readonly<Record<string, ObjectDefinition>>;
  const missionDefinitions = missions.filter(mission => scenario.missions.some(id => id === mission.id));
  const store = createIdentityStore();
  const playerInstance = createEntity(player, scenario.player, store);
  const world: GameState = {
    ...store, scenario: scenarioId, player: playerInstance,
    entities: [], relations: {},
    get missions() { return Object.values(this.instances).filter((item): item is MissionState => item.kind === 'mission'); },
    get factions() { return Object.values(this.instances).filter((item): item is FactionState => item.kind === 'faction'); },
    missionDefinitions: missionDefinitions as MissionDefinition[], objectDefinitions,
  };
  const factions = new Map<string, string>();
  for (const config of scenario.factions) {
    const definition = factionDefinitions.find(item => item.id === config.definition);
    if (!definition || factions.has(config.definition)) throw new Error(`Invalid faction definition: ${config.definition}`);
    const faction: FactionState = { ...identity(world, definition.id), kind: 'faction', name: definition.name };
    world.instances[faction.id] = faction;
    world.relations[faction.id] = config.relation;
    factions.set(config.definition, faction.id);
  }
  const factionRef = (id: string) => {
    const instanceId = factions.get(id);
    if (!instanceId) throw new Error(`Unknown scenario faction: ${id}`);
    return instanceId;
  };
  world.entities = scenario.entities.map((item: EntitySpawn) => {
    const definition = objectDefinitions[item.object as keyof typeof objectDefinitions];
    const entity = createEntity(definition, item.position, world, item.interactions);
    if (item.faction) entity.factionId = factionRef(item.faction);
    if (definition.offer) {
      const { opponent, ...offer } = definition.offer;
      if (!missionDefinitions.some(item => item.id === offer.mission)) throw new Error(`Unknown offer mission: ${offer.mission}`);
      entity.offer = { ...offer, spawn: { ...offer.spawn }, opponentId: factionRef(opponent) };
    }
    return entity;
  });
  return world;
}

// Reactions depend on world state, never on the identifier of the last event.
export function react(world: GameState, definitions = events): EventResult[] {
  const results: EventResult[] = [];
  for (const mission of world.missions) {
    const definition = world.missionDefinitions.find(item => item.id === mission.definitionId);
    if (!definition) throw new Error(`Unknown mission definition: ${mission.definitionId}`);
    const target = resolve(world, mission.contractorId, 'character');
    const actor = resolve(world, mission.executorId, 'character');
    resolve(world, mission.targetId, 'character');
    if (!target.offer) throw new Error('Missing contractor offer');
    for (const id of definition.reactions) {
      const event = definitions[id];
      if (!event) throw new Error(`Unknown reaction event: ${id}`);
      const context = { world, contractorId: target.id, offer: target.offer, missionId: mission.id };
      if ((event.when ?? []).every(condition => matches(condition, actor, target, context))) {
        const result = executeEvent(event, actor, target, Math.random, context);
        if (result.executed) results.push(result);
      }
    }
  }
  return results;
}

export function interact(world: GameState, target: EntityState, random = Math.random, definitions = events): EventResult {
  const selected = selectInteraction(world, target, definitions);
  if (!selected) return { executed: false, reason: 'noApplicableEvent', message: 'Nenhuma interação disponível.' };
  return executeEvent(selected.event, world.player, target, random, selected.context);
}

export function adjacentEntities(world: GameState): EntityState[] {
  return world.entities.filter(entity => entity.hp > 0 && isAdjacent(world.player, entity));
}
