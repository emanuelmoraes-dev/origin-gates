import { createEngine } from '@origin-gates/narrative-engine';

/** Complete public example, run by tests/composition-integrity.test.ts. */
export function createCompositionExample() {
  const engine = createEngine();
  engine.registerDefinitions({
    characters: [{ id: 'citizen', name: 'Cidadão', maxHp: 100, color: '#ffffff' }],
    relations: [{ id: 'gratitude', name: 'Gratidão', sourceKinds: ['character'], targetKinds: ['character'], unique: true, reactions: [] }],
    compositions: [{
      id: 'court',
      characters: [
        { key: 'Arthur', definitionId: 'citizen', position: { x: 0, y: 0 } },
        { key: 'Edward', definitionId: 'citizen', position: { x: 1, y: 0 } },
      ],
      roles: { rei: { kind: 'character', initial: 'Arthur' }, envoy: { kind: 'character' } },
    }],
  });
  const world = engine.createWorld({
    map: Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => 'land' as const)),
    player: { definitionId: 'citizen', position: { x: 0, y: 0 } },
  });
  const a = world.instantiateComposition({ definitionId: 'court', key: 'courtA', origin: { x: 5, y: 5 } });
  const b = world.instantiateComposition({ definitionId: 'court', key: 'courtB', origin: { x: 10, y: 5 } });
  const originalKing = a.resolve('<rei>');
  const gratitude = world.createRelation({ definitionId: 'gratitude', source: 'root#player', target: 'courtA#<rei>', intensity: 80 });
  world.assignRole({ compositionId: a.id, role: 'rei', instanceId: a.resolve('Edward').id });
  // Dynamic role resolution changes; the historical symbol and gratitude do not.
  const currentKing = world.resolveReference({ type: 'role', scope: 'courtA', key: 'rei' });
  return { world, a, b, gratitude, originalKing, currentKing };
}
