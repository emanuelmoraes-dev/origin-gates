import { createEngine, type AuditOptions, type CharacterConfig, type CompositionConfig, type DefinitionBatch } from '@origin-gates/narrative-engine';
import player from '../data/objects/player.json';
import enemy from '../data/objects/enemy.json';
import socialObjects from '../data/objects/social.json';
import reactivityObjects from '../data/objects/reactivity.json';
import relations from '../data/relations.json';
import reactions from '../data/reactions.json';
import missions from '../data/missions.json';
import factions from '../data/factions.json';
import scenarioData from '../data/scenarios.json';
import compositions from '../data/compositions.json';
import attack from '../data/events/attack.json';
import socialEvents from '../data/events/social.json';
import { worldMap } from './map';

interface ScenarioDefinition {
  id: string; name: string; player: CharacterConfig;
  missions: string[]; compositions: CompositionConfig[];
}
const engine = createEngine();
engine.registerDefinitions({
  characters: [player, enemy, ...Object.values(socialObjects), ...Object.values(reactivityObjects)],
  factions, relations: Object.values(relations), reactions: Object.values(reactions),
  missions, events: [attack, ...Object.values(socialEvents)], compositions,
} as DefinitionBatch);
export const scenarios: readonly ScenarioDefinition[] = scenarioData;

/** File organization belongs to the game; contextual resolution belongs to the engine. */
export function createWorld(scenarioId: string, audit: AuditOptions = {}) {
  const scenario = scenarios.find(item => item.id === scenarioId);
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
  const world = engine.createWorld({ scenarioId, map: worldMap, player: scenario.player, missions: scenario.missions, audit });
  for (const composition of scenario.compositions) world.instantiateComposition(composition);
  return world;
}
