// Service-unit fixtures: the existing literal proof content, never production JSON.
// Consumer/production integration is tested separately in the game workspace.
import { DefinitionRegistry } from '../../src/definitions.js';
import { createWorldState } from '../../src/construction.js';
import { createCharacterInstance, createFactionInstance } from '../../src/instances.js';
import { createRelation } from '../../src/state.js';
import { AuditLog, audited, type AuditOptions } from '../../src/audit.js';
import { literalDefinitions, populateTestWorld, suppliedMap } from './programmatic.js';

export { adjacentEntities, executeCommand, interact, react } from '../../src/world.js';
export const worldMap = suppliedMap;
const registry = new DefinitionRegistry();
registry.register(literalDefinitions);
export const events = registry.catalog().events;
export const playerJson = registry.catalog().characters.player;
export const enemyJson = registry.catalog().characters.enemy;
export const attackJson = events.attack;
export const scenarios = ['training', 'rivals', 'social'].map(id => ({ id }));
export function createWorld(id: string, options: AuditOptions | AuditLog = {}) {
  const audit = options instanceof AuditLog ? options : new AuditLog(options);
  return audited(audit, { category: 'world', data: { fixture: id } }, scope => {
    if (!scenarios.some(s => s.id === id)) throw new Error(`Unknown scenario: ${id}`);
    const world = createWorldState(registry, { scenarioId: id, map: suppliedMap, player: { definitionId: 'player', position: { x: id === 'social' ? 3 : 2, y: 5 } }, missions: id === 'rivals' ? ['eliminateTarget'] : [], audit }, scope);
    populateTestWorld({
      player: world.player,
      createCharacter: config => createCharacterInstance(world, config, scope),
      createFaction: definitionId => createFactionInstance(world, definitionId, scope),
      createRelation: config => {
        if (!('sourceId' in config)) throw new Error('Unit fixture expects concrete endpoints');
        return createRelation(world, config.definitionId, config.sourceId, config.targetId, config.intensity, scope);
      },
    }, id);
    return world;
  });
}
