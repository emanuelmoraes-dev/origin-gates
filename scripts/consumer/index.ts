import { createEngine, type CharacterView } from '@origin-gates/narrative-engine';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const engine = createEngine();
engine.registerDefinitions({
  characters: [
    { id: 'traveler', name: 'Viajante', maxHp: 100, color: '#ffff00' },
    { id: 'sentinel', name: 'Sentinela', maxHp: 100, color: '#ff9900', interactions: [{ event: 'strike' }] },
  ],
  events: [{ id: 'strike', conditions: ['actorAlive', 'targetAlive', 'adjacent'], outcomes: [{
    id: 'hit', weight: 1, operations: [{ type: 'damage', amount: 10 }], feedback: { color: '#ff0000', durationMs: 500, message: 'Acerto' },
  }] }],
  compositions: [{ id: 'camp', characters: [{ key: 'guard', definitionId: 'sentinel', position: { x: 0, y: 0 } }] }],
});
const world = engine.createWorld({ map: [['land', 'land']], player: { definitionId: 'traveler', position: { x: 0, y: 0 } } });
const camp = world.instantiateComposition({ definitionId: 'camp', key: 'camp', origin: { x: 1, y: 0 } });
const guard = camp.resolve('guard');
assert(world.resolveReference('camp#guard').id === guard.id, 'Public contextual resolution failed');
assert(world.interact({ actorId: world.player.id, targetId: guard.id, random: () => 0 }).executed, 'Public interaction failed');
const character: CharacterView = world.query.character(guard.id)!;
assert(character.hp === 90 && Object.isFrozen(character.position), 'Public query failed');
assert(world.inspect.list('composition').length === 1, 'Public inspection failed');
assert(world.diagnostics().instances.length === 3, 'Public export failed');
// This uncalled function verifies readonly declarations against the packed d.ts.
function readonlyContract(view: CharacterView) {
  // @ts-expect-error A consumer cannot mutate a query result.
  view.hp = 1;
}
void readonlyContract;
let blocked = false;
try {
  // @ts-expect-error Package exports intentionally forbid deep imports.
  await import('@origin-gates/narrative-engine/dist/state.js');
} catch (error) { blocked = (error as { code?: string }).code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'; }
assert(blocked, 'Deep imports must be blocked by the installed package');
