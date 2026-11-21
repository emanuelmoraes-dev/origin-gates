import { createEngine } from '../src/game';

/** Executed by tests/examples.test.ts; no JSON or browser required. */
export function createExample() {
  const engine = createEngine();
  engine.registerDefinitions({ characters: [{ id: 'citizen', name: 'Cidadão', maxHp: 100, color: '#ffffff' }] });
  const world = engine.createWorld({
    map: [['land', 'land'], ['water', 'land']],
    player: { definitionId: 'citizen', position: { x: 0, y: 0 } },
    scenarioId: 'example',
  });
  const other = world.createCharacter({ definitionId: 'citizen', position: { x: 1, y: 0 } });

  // Between narrative executions: additive registration, no retroactive effect.
  world.registerDefinitions({ relations: [{
    id: 'religiousDevotion', name: 'Devoção', sourceKinds: ['character'],
    targetKinds: ['character'], unique: true, reactions: [],
  }] });
  const relation = world.createRelation({ definitionId: 'religiousDevotion', sourceId: world.player.id, targetId: other.id, intensity: 90 });
  return { world, other, relation };
}
