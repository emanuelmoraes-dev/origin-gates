import player from '../data/objects/player.json';
import enemy from '../data/objects/enemy.json';
import socialObjects from '../data/objects/social.json';
import reactivityObjects from '../data/objects/reactivity.json';
import relations from '../data/relations.json';
import reactions from '../data/reactions.json';
import missions from '../data/missions.json';
import factions from '../data/factions.json';
import scenarioData from '../data/scenarios.json';
import attack from '../data/events/attack.json';
import socialEvents from '../data/events/social.json';
import { DefinitionRegistry, type DefinitionBatch } from '../game/definitions';
import { createWorldState } from '../game/construction';
import { createCharacterInstance, createFactionInstance } from '../game/instances';
import { createRelation, type InteractionBinding, type Position } from '../game/state';
import { AuditLog, audited, note, type AuditOptions } from '../game/audit';
import { worldMap } from './map';

export { adjacentEntities, executeCommand, interact, react } from '../game/world';
interface EntitySpawn { object: string; position: Position; interactions?: readonly InteractionBinding[]; faction?: string; key?: string; label?: string }
interface RelationSpawn { definition: string; source: string; target: string; intensity: number }
interface ScenarioDefinition {
  id: string; name: string; player: Position; entities: EntitySpawn[];
  missions: string[]; factions: { definition: string }[]; relations?: RelationSpawn[];
}
const definitions = new DefinitionRegistry();
definitions.register({
  characters: [player, enemy, ...Object.values(socialObjects), ...Object.values(reactivityObjects)],
  factions, relations: Object.values(relations), reactions: Object.values(reactions),
  missions, events: [attack, ...Object.values(socialEvents)],
} as DefinitionBatch);
export const scenarios: readonly ScenarioDefinition[] = scenarioData;
export const events = definitions.catalog().events;

/** Symbolic aliases belong to this content adapter, never to the engine. */
export function createWorld(scenarioId: string, options: AuditOptions | AuditLog = {}) {
  const audit = options instanceof AuditLog ? options : new AuditLog(options);
  return audited(audit, { category: 'world', data: { scenarioId, source: 'originGatesAdapter' } }, scope => {
    const scenario = scenarios.find(item => item.id === scenarioId);
    if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
    const world = createWorldState(definitions, { scenarioId, map: worldMap, player: { definitionId: 'player', position: scenario.player }, missions: scenario.missions, audit }, scope);
    const symbols = new Map<string, string>([['player', world.player.id]]);
    const setSymbol = (key: string, id: string) => {
      if (symbols.has(key)) throw new Error(`Duplicate scenario symbol: ${key}`);
      symbols.set(key, id);
    };
    const symbol = (key: string) => {
      const id = symbols.get(key);
      if (!id) throw new Error(`Unknown scenario symbol: ${key}`);
      return id;
    };
    for (const config of scenario.factions) setSymbol(config.definition, createFactionInstance(world, config.definition, scope).id);
    for (const item of scenario.entities) {
      const definition = world.objectDefinitions[item.object];
      if (!definition) throw new Error(`Unknown character definition: ${item.object}`);
      const offer = definition.offer;
      const entity = createCharacterInstance(world, {
        definitionId: item.object, position: item.position, interactions: item.interactions, label: item.label,
        factionId: item.faction ? symbol(item.faction) : undefined,
        offer: offer ? { mission: offer.mission, name: offer.name, target: offer.target, spawn: offer.spawn, opponentId: symbol(offer.opponent) } : undefined,
      }, scope);
      if (item.key) setSymbol(item.key, entity.id);
    }
    for (const config of scenario.relations ?? []) createRelation(world, config.definition, symbol(config.source), symbol(config.target), config.intensity, scope);
    note(scope, { category: 'world', status: 'configured', instanceIds: world.entities.map(e => e.id), data: { auxiliary: 'mapCharacters', playerId: world.player.id } });
    return world;
  });
}
