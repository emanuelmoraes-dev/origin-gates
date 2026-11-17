import player from '../data/objects/player.json';
import enemy from '../data/objects/enemy.json';
import socialObjects from '../data/objects/social.json';
import missions from '../data/missions.json';
import scenarios from '../data/scenarios.json';
import attack from '../data/events/attack.json';
import socialEvents from '../data/events/social.json';
import { executeEvent, matches, type EventDefinition, type EventResult } from './events';
import { createEntity, isAdjacent, type EntitySpawn, type EntityState, type GameState } from './state';
import { selectInteraction } from './interactions';

export { scenarios };
export const events = { attack, ...socialEvents } as Record<string, EventDefinition>;
export function createWorld(scenarioId: string): GameState {
  const scenario = scenarios.find(item => item.id === scenarioId);
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
  const objectDefinitions = { player, enemy, ...socialObjects };
  const missionDefinitions = missions.filter(mission => scenario.missions.some(id => id === mission.id));
  return {
    scenario: scenarioId, player: createEntity(player, scenario.player),
    entities: scenario.entities.map((item: EntitySpawn) => createEntity(objectDefinitions[item.object as keyof typeof objectDefinitions], item.position, item.interactions)),
    relations: { ...scenario.relations } as Record<string, number>,
    missions: Object.fromEntries(missionDefinitions.map(mission => [mission.id, { status: 'available' }])),
    missionDefinitions, objectDefinitions,
  };
}

// Reactions depend on world state, never on the identifier of the last event.
export function react(world: GameState, definitions = events): EventResult[] {
  const results: EventResult[] = [];
  const scenario = scenarios.find(item => item.id === world.scenario)!;
  for (const mission of world.missionDefinitions) {
    const target = world.entities.find(entity => entity.definition.id === mission.representative)!;
    for (const id of scenario.reactions) {
      const event = definitions[id];
      const context = { world, mission };
      if ((event.when ?? []).every(condition => matches(condition, world.player, target, context))) {
        const result = executeEvent(event, world.player, target, Math.random, context);
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
