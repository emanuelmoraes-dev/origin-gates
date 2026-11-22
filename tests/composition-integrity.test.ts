import { describe, expect, it } from 'vitest';
import { createEngine, parseReference, ReferenceResolutionError, type CompositionConfig, type CompositionDefinition, type DefinitionBatch, type NarrativeWorld, type ReferenceInput } from '../src/game';
import { compositionDefinitions, compositionEngine, compositionMap, compositionWorld } from './fixtures/compositions';
import { character, interactWith, mission } from './fixtures/actions';
import { createCompositionExample } from '../examples/compositions';

function code(body: () => unknown): string {
  try { body(); } catch (error) { expect(error).toBeInstanceOf(ReferenceResolutionError); return (error as ReferenceResolutionError).code; }
  throw new Error('Expected reference resolution failure');
}
function rejectWithoutEffects(world: NarrativeWorld, request: CompositionConfig, expected?: RegExp) {
  const before = world.inspect.list();
  const definitions = world.definitions;
  const next = Math.max(...before.map(s => Number(s.id.slice('entity_'.length)))) + 1;
  world.audit.clear();
  expect(() => world.instantiateComposition(request)).toThrow(expected);
  expect(world.inspect.list()).toEqual(before);
  expect(world.definitions).toBe(definitions);
  if (request.key === 'failed') expect(code(() => world.resolveReference('failed#self'))).toBe('aliasNotFound');
  expect(world.audit.records().filter(r => r.category === 'instance' && ['allocated', 'created'].includes(r.status))).toEqual([]);
  expect(world.audit.records().filter(r => r.status === 'subscribed')).toEqual([]);
  expect(world.audit.records().some(r => r.category === 'failure')).toBe(true);
  expect(world.createFaction('government').id).toBe(`entity_${String(next).padStart(6, '0')}`);
}
const simple = (): CompositionDefinition => ({ id: 'sample', characters: [{ key: 'a', definitionId: 'observer', position: { x: 0, y: 0 } }] });

describe('composition definition boundary', () => {
  it('registers compositions and all cross-referenced definitions in one batch', () => {
    const engine = createEngine();
    const { compositions, ...definitions } = compositionDefinitions;
    engine.registerDefinitions({ compositions, ...definitions });
    expect(engine.definitions.compositions.royalCourt.roles!.rei.initial).toBe('Arthur');
  });
  it('owns immutable composition data, rejects duplicates and isolates additive world registrations', () => {
    const engine = compositionEngine();
    const config = { map: compositionMap(), player: { definitionId: 'player', position: { x: 0, y: 23 } } };
    const a = engine.createWorld(config); const b = engine.createWorld(config);
    const definition = structuredClone(simple());
    a.registerDefinitions({ compositions: [definition] });
    (definition.characters![0].position as { x: number }).x = 999;
    expect(a.definitions.compositions.sample.characters![0].position.x).toBe(0);
    expect(Object.isFrozen(a.definitions.compositions.sample.characters![0].position)).toBe(true);
    expect(b.definitions.compositions.sample).toBeUndefined();
    expect(engine.definitions.compositions.sample).toBeUndefined();
    expect(a.inspect.list('composition')).toEqual([]); // registration is not instantiation
    expect(() => a.registerDefinitions({ compositions: [simple()] })).toThrow(/duplicate/);
    expect(() => b.instantiateComposition({ definitionId: 'sample', origin: { x: 5, y: 5 } })).toThrow(/Unknown composition/);
    expect(a.instantiateComposition({ definitionId: 'sample', origin: { x: 5, y: 5 } }).resolve('a').kind).toBe('character');
  });
  it.each([
    { ...simple(), id: '' },
    { ...simple(), compositions: [] },
    { ...simple(), loops: [] },
    { ...simple(), characters: [{ key: 'a', definitionId: 'absent', position: { x: 0, y: 0 } }] },
    { ...simple(), factions: [{ key: 'f', definitionId: 'absent' }] },
    { ...simple(), factions: [{ key: 'a', definitionId: 'government' }] },
    { ...simple(), characters: [{ key: 'self', definitionId: 'observer', position: { x: 0, y: 0 } }] },
    { ...simple(), characters: [{ key: 'bad#name', definitionId: 'observer', position: { x: 0, y: 0 } }] },
    { ...simple(), characters: [{ key: 'entity_000001', definitionId: 'observer', position: { x: 0, y: 0 } }] },
    { ...simple(), characters: [{ key: 'a', definitionId: 'observer', position: { x: 0.5, y: 0 } }] },
    { ...simple(), characters: [{ key: 'a', definitionId: 'observer', position: { x: 0, y: 0 }, faction: 'missing' }] },
    { ...simple(), characters: [{ key: 'a', definitionId: 'observer', position: { x: 0, y: 0 }, faction: 'self' }] },
    { ...simple(), parameters: { a: { kind: 'unknown' } } },
    { ...simple(), roles: { rei: { kind: 'character', initial: 'missing' } } },
    { ...simple(), roles: { rei: { kind: 'character', initial: { parameter: 'missing' } } } },
    { ...simple(), roles: { rei: { kind: 'faction', initial: 'a' } } },
    { ...simple(), roles: { rei: { kind: 'character', allowVacant: false } } },
    { ...simple(), relations: [{ definitionId: 'missing', source: 'a', target: 'a', intensity: 5 }] },
    { ...simple(), relations: [{ definitionId: 'gratitude', source: 'a', target: 'self', intensity: 5 }] },
    { ...simple(), relations: [{ definitionId: 'gratitude', source: 'a', target: '<missing>', intensity: 5 }] },
    { ...simple(), relations: [{ definitionId: 'gratitude', source: 'a', target: 'a', intensity: Infinity }] },
    { ...simple(), characters: [{ key: 'a', definitionId: 'governmentRepresentative', position: { x: 0, y: 0 } }] },
    { ...simple(), characters: [{ key: 'a', definitionId: 'observer', position: { x: 0, y: 0 }, interactions: [{ event: 'missing' }] }] },
  ])('rejects invalid composition definitions before publishing a batch: %j', definition => {
    const engine = compositionEngine(); const before = engine.definitions;
    expect(() => engine.registerDefinitions({ compositions: [definition], factions: [{ id: 'alsoNew', name: 'New' }] } as unknown as DefinitionBatch)).toThrow();
    expect(engine.definitions).toBe(before);
    expect(engine.definitions.factions.alsoNew).toBeUndefined();
  });
});

describe('contextual reference contract', () => {
  it.each(['', ' ', 'a#b#c', '#a', 'a#', '<>', '<rei', 'rei>', 'root#<rei>', 'root#entity_000001', 'entity_1', 'root#player ', '<a#b>'])('rejects invalid reference syntax: %j', input => {
    expect(code(() => parseReference(input))).toBe('invalidSyntax');
  });
  it.each([{}, { type: 'unknown', key: 'a' }, { type: 'instance', id: '' }, { type: 'symbol', key: 'a', extra: 1 }, { type: 'role', key: 'rei', scope: 'root' }])('rejects invalid structured reference syntax: %j', input => {
    expect(code(() => parseReference(input as ReferenceInput))).toBe('invalidSyntax');
  });
  it('distinguishes missing scope, alias, composition, symbol, role, occupant, kind and instance', () => {
    const world = compositionWorld(); const court = world.instantiateComposition({ definitionId: 'royalCourt', key: 'court', origin: { x: 5, y: 5 } });
    expect(code(() => world.resolveReference('Arthur'))).toBe('missingContext');
    expect(code(() => world.resolveReference('Arthur', { compositionId: 'missing' }))).toBe('compositionNotFound');
    expect(code(() => world.resolveReference('missing#Arthur'))).toBe('aliasNotFound');
    expect(code(() => world.resolveReference('toString#Arthur'))).toBe('aliasNotFound');
    expect(code(() => court.tryResolve('missing'))).toBe('symbolNotFound');
    expect(code(() => court.tryResolve('<missing>'))).toBe('roleNotFound');
    expect(code(() => court.resolve('<envoy>'))).toBe('roleVacant');
    expect(code(() => court.resolve('Arthur', 'faction'))).toBe('kindMismatch');
    expect(code(() => world.resolveReference('entity_999999'))).toBe('instanceNotFound');
    expect(code(() => world.resolveReference({ type: 'instance', id: '__proto__' }))).toBe('instanceNotFound');
    expect(code(() => court.resolve('player'))).toBe('symbolNotFound'); // root is never a fallback
    expect(world.tryResolveReference('court#<envoy>')).toBeUndefined();
  });
  it('supports named individual characters, factions and relations without requiring keys for others', () => {
    const world = compositionWorld(); const before = world.inspect.list().length;
    const character = world.createCharacter({ definitionId: 'observer', key: 'primordial', position: { x: 3, y: 3 } });
    const faction = world.createFaction('government', { key: 'guild' });
    const relation = world.createRelation({ definitionId: 'link', source: 'root#guild', target: 'root#primordial', intensity: 3, key: 'bond' });
    expect(world.inspect.list()).toHaveLength(before + 3);
    expect(world.resolveReference('root#primordial')).toEqual(character);
    expect(world.resolveReference('root#guild')).toEqual(faction);
    expect(world.resolveReference('root#bond')).toEqual(relation);
    const count = world.inspect.list().length;
    expect(() => world.createCharacter({ definitionId: 'observer', key: 'player', position: { x: 4, y: 4 } })).toThrow(/Duplicate root symbol/);
    expect(() => world.createFaction('government', { key: 'guild' })).toThrow(/Duplicate root symbol/);
    expect(world.inspect.list()).toHaveLength(count);
  });
  it('keeps root a resolution scope, with a stable player symbol even with a custom player key', () => {
    const world = compositionEngine().createWorld({ map: compositionMap(), player: { definitionId: 'player', key: 'hero', position: { x: 0, y: 23 } } });
    expect(world.resolveReference('root#hero')).toEqual(world.player);
    expect(world.resolveReference('root#player')).toEqual(world.player);
    expect(world.inspect.list()).toHaveLength(1);
  });
  it('checks roles before assignment and supports required roles', () => {
    const world = compositionWorld(); const court = world.instantiateComposition({ definitionId: 'royalCourt', origin: { x: 5, y: 5 } });
    const faction = world.createFaction('government'); const before = world.inspect.find(court.id);
    expect(code(() => world.assignRole({ compositionId: court.id, role: 'rei', instanceId: faction.id }))).toBe('kindMismatch');
    expect(code(() => world.assignRole({ compositionId: court.id, role: 'rei', instanceId: 'absent' }))).toBe('instanceNotFound');
    expect(code(() => world.assignRole({ compositionId: court.id, role: 'absent', instanceId: world.player.id }))).toBe('roleNotFound');
    expect(code(() => world.assignRole({ compositionId: 'absent', role: 'rei', instanceId: world.player.id }))).toBe('compositionNotFound');
    expect(() => world.assignRole({ compositionId: court.id, role: 'fixed', instanceId: null })).toThrow(/cannot be vacant/);
    expect(world.inspect.find(court.id)).toEqual(before);
  });
  it('resolves local bindings in an explicit caller context and captures only concrete external IDs', () => {
    const world = compositionWorld(); const family = world.instantiateComposition({ definitionId: 'family', key: 'family', origin: { x: 5, y: 5 } });
    const faction = world.createFaction('government');
    const army = world.instantiateComposition({ definitionId: 'army', origin: { x: 15, y: 15 }, context: { compositionId: family.id }, bindings: { commander: { type: 'symbol', key: 'prince' }, faction: { type: 'instance', id: faction.id } } });
    expect(army.resolve('<militaryCommander>')).toEqual(family.resolve('prince'));
  });
});

describe('preparation rejects foreseeable failures without narrative mutations', () => {
  it.each([
    { definitionId: 'absent', origin: { x: 5, y: 5 } },
    { definitionId: 'trainingCamp', origin: { x: 0.5, y: 5 } },
    { definitionId: 'trainingCamp', origin: { x: Infinity, y: 5 } },
    { definitionId: 'trainingCamp', origin: { x: -1, y: 5 } },
    { definitionId: 'trainingCamp', origin: { x: 40, y: 5 } },
    { definitionId: 'trainingCamp', origin: { x: 0, y: 23 } }, // player overlap
    { definitionId: 'army', origin: { x: 5, y: 5 } }, // missing bindings
    { definitionId: 'army', origin: { x: 5, y: 5 }, bindings: { commander: 'root#player', faction: 'root#player' } },
    { definitionId: 'army', origin: { x: 5, y: 5 }, bindings: { commander: 'missing#prince', faction: 'root#player' } },
    { definitionId: 'trainingCamp', origin: { x: 5, y: 5 }, bindings: { unknown: 'root#player' } },
    { definitionId: 'rivalCity', origin: { x: 32, y: 5 }, bindings: { player: 'root#player' } }, // characters fit, future spawn exceeds map
  ] as CompositionConfig[])('rejects invalid requests with no state or ID changes: %j', request => {
    rejectWithoutEffects(compositionWorld(), { ...request, key: 'failed' });
  });
  it.each(['root', 'bad#alias', 'entity_000100'])('rejects reserved/invalid aliases: %s', key => {
    rejectWithoutEffects(compositionWorld(), { definitionId: 'trainingCamp', key, origin: { x: 5, y: 5 } });
  });
  it('rejects a duplicate alias without redirecting the old scope or consuming IDs', () => {
    const world = compositionWorld(); const camp = world.instantiateComposition({ definitionId: 'trainingCamp', key: 'camp', origin: { x: 5, y: 5 } });
    rejectWithoutEffects(world, { definitionId: 'trainingCamp', key: 'camp', origin: { x: 10, y: 5 } }, /Duplicate composition alias/);
    expect(world.resolveReference('camp#guardian')).toEqual(camp.resolve('guardian'));
  });
  it('checks water for characters and for future spawns without changing individual creation rules', () => {
    const map = compositionMap().map(row => [...row]); map[5][5] = 'water'; map[5][10] = 'water';
    const world = compositionEngine().createWorld({ map, player: { definitionId: 'player', position: { x: 0, y: 23 } } });
    rejectWithoutEffects(world, { definitionId: 'trainingCamp', key: 'failed', origin: { x: 5, y: 5 } }, /land inside/);
    rejectWithoutEffects(world, { definitionId: 'rivalCity', key: 'failed', origin: { x: 2, y: 2 }, bindings: { player: 'root#player' } }, /land inside/);
    expect(world.createCharacter({ definitionId: 'observer', position: { x: 5, y: 5 } }).kind).toBe('character'); // preserved individual policy
  });
  it('checks existing and planned character overlap before any creation', () => {
    const world = compositionWorld(); world.createCharacter({ definitionId: 'observer', position: { x: 5, y: 5 } });
    rejectWithoutEffects(world, { definitionId: 'trainingCamp', key: 'failed', origin: { x: 5, y: 5 } }, /overlap/);
    world.registerDefinitions({ compositions: [{ id: 'overlap', characters: [...simple().characters!, { key: 'b', definitionId: 'observer', position: { x: 0, y: 0 } }] }] });
    rejectWithoutEffects(world, { definitionId: 'overlap', key: 'failed', origin: { x: 10, y: 10 } }, /overlap/);
  });
  it('validates duplicate relations among bindings against existing world relations', () => {
    const world = compositionWorld();
    world.registerDefinitions({ compositions: [{ id: 'externalLinks', factions: [{ key: 'newFaction', definitionId: 'government' }], characters: simple().characters,
      parameters: { a: { kind: 'character' }, b: { kind: 'character' } },
      relations: [{ definitionId: 'gratitude', source: { parameter: 'a' }, target: { parameter: 'b' }, intensity: 40 }] }] });
    const npc = world.createCharacter({ definitionId: 'observer', position: { x: 2, y: 2 } });
    world.createRelation({ definitionId: 'gratitude', sourceId: world.player.id, targetId: npc.id, intensity: 20 });
    rejectWithoutEffects(world, { definitionId: 'externalLinks', key: 'failed', origin: { x: 5, y: 5 }, bindings: { a: world.player.id, b: npc.id } }, /Duplicate directional relation/);
  });
  it('rejects duplicate internal relations and cyclic relation dependencies in preparation', () => {
    const world = compositionWorld();
    world.registerDefinitions({ compositions: [
      { ...simple(), id: 'duplicateLinks', relations: [1, 2].map(intensity => ({ definitionId: 'gratitude', source: 'a', target: 'a', intensity })) },
      { ...simple(), id: 'cycle', relations: [{ key: 'r', definitionId: 'link', source: 'a', target: 'r', intensity: 1 }] },
    ] });
    rejectWithoutEffects(world, { definitionId: 'duplicateLinks', key: 'failed', origin: { x: 5, y: 5 } }, /Duplicate/);
    rejectWithoutEffects(world, { definitionId: 'cycle', key: 'failed', origin: { x: 5, y: 5 } }, /Cyclic/);
  });
  it('validates contextual initial roles and leaves no reactive subscriptions after a late failure', () => {
    const world = compositionWorld();
    const victim = world.createCharacter({ definitionId: 'victim', position: { x: 1, y: 23 } });
    world.registerDefinitions({ compositions: [{ ...simple(), id: 'lateFailure',
      parameters: { victim: { kind: 'character' } },
      relations: [{ definitionId: 'friendship', source: 'a', target: { parameter: 'victim' }, intensity: 90 }],
      roles: { missing: { kind: 'character', initial: 'missing#person' } },
    }] });
    rejectWithoutEffects(world, { definitionId: 'lateFailure', key: 'failed', origin: { x: 5, y: 5 }, bindings: { victim: victim.id } }, /alias not found/);
    world.audit.clear();
    interactWith(world, victim.id, 0.75);
    expect(world.audit.records().filter(r => r.category === 'reaction')).toEqual([]);
  });
  it('rejects missing/incorrect runtime role targets and initial role cycles', () => {
    const world = compositionWorld();
    const faction = world.createFaction('government', { key: 'guild' });
    world.registerDefinitions({ compositions: [
      { id: 'wrongRole', roles: { rei: { kind: 'character', initial: 'root#guild' } } },
      { id: 'cyclicRoles', roles: { a: { kind: 'character', initial: '<b>' }, b: { kind: 'character', initial: '<a>' } } },
      { id: 'missingRole', roles: { rei: { kind: 'character', initial: { type: 'instance', id: 'missing' } } } },
    ] });
    expect(faction.kind).toBe('faction');
    for (const definitionId of ['wrongRole', 'cyclicRoles', 'missingRole']) rejectWithoutEffects(world, { definitionId, key: 'failed', origin: { x: 5, y: 5 } });
  });
  it('does not resolve concrete external IDs by predicting future member IDs', () => {
    const world = compositionWorld();
    world.registerDefinitions({ compositions: [{ ...simple(), roles: { rei: { kind: 'character', initial: { type: 'instance', id: 'entity_000003' } } } }] });
    // The forecast character would receive 000003, but it does not exist yet.
    rejectWithoutEffects(world, { definitionId: 'sample', key: 'failed', origin: { x: 5, y: 5 } }, /Instance not found/);
  });
  it('checks mission availability and runtime relation endpoint categories before creating factions', () => {
    const world = compositionEngine().createWorld({ map: compositionMap(), player: { definitionId: 'player', position: { x: 0, y: 23 } }, missions: [] });
    rejectWithoutEffects(world, { definitionId: 'rivalCity', key: 'failed', origin: { x: 2, y: 2 }, bindings: { player: world.player.id } }, /not enabled/);
    const faction = world.createFaction('government', { key: 'guild' });
    world.registerDefinitions({ compositions: [{ ...simple(), id: 'badEndpoint', relations: [{ definitionId: 'gratitude', source: 'a', target: 'root#guild', intensity: 1 }] }] });
    rejectWithoutEffects(world, { definitionId: 'badEndpoint', key: 'failed', origin: { x: 5, y: 5 } }, /Invalid relation participant/);
    expect(world.resolveReference('root#guild')).toEqual(faction);
  });
  it('does not reserve future spawn tiles or silently change the legacy spawn occupancy policy', () => {
    const world = compositionWorld(); const blocker = world.createCharacter({ definitionId: 'observer', position: { x: 10, y: 5 } });
    const city = world.instantiateComposition({ definitionId: 'rivalCity', origin: { x: 2, y: 2 }, bindings: { player: world.player.id } });
    expect(interactWith(world, city.resolve('official').id).executed).toBe(true);
    const target = mission(world.inspect.list('mission')[0]).targetId;
    expect(character(world, target).position).toEqual(character(world, blocker.id).position);
  });
  it('keeps character-only reaction participants checked even when a relation can connect compositions', () => {
    const world = compositionWorld(); const camp = world.instantiateComposition({ definitionId: 'trainingCamp', origin: { x: 5, y: 5 } });
    world.registerDefinitions({
      reactions: [{ id: 'characterOnly', on: 'attackAttempted', when: [{ type: 'alive', entity: 'relation.source' }], operations: [] }],
      relations: [{ id: 'compositionObserver', name: 'Observador estrutural', sourceKinds: ['composition'], targetKinds: ['character'], unique: true, reactions: ['characterOnly'] }],
    });
    world.createRelation({ definitionId: 'compositionObserver', sourceId: camp.id, targetId: camp.resolve('guardian').id, intensity: 1 });
    expect(() => interactWith(world, camp.resolve('guardian').id, 0.75)).toThrow(/Invalid character reference/);
  });
});

describe('forward references, isolation and executable example', () => {
  it('supports later relation endpoints and forward roles with deterministic creation order', () => {
    const world = compositionWorld();
    world.registerDefinitions({ compositions: [{ ...simple(), roles: { first: { kind: 'character', initial: '<second>' }, second: { kind: 'character', initial: 'a' }, bond: { kind: 'relation', initial: 'early' } },
      relations: [
        { key: 'early', definitionId: 'link', source: 'later', target: 'self', intensity: 1 },
        { key: 'later', definitionId: 'link', source: 'a', target: 'self', intensity: 1 },
      ],
    }] });
    const camp = world.instantiateComposition({ definitionId: 'sample', origin: { x: 5, y: 5 } });
    expect(camp.resolve('<first>')).toEqual(camp.resolve('a'));
    expect(camp.resolve('<bond>')).toEqual(camp.resolve('early'));
    expect(world.inspect.find(camp.resolve('early').id)!.properties).toMatchObject({ sourceId: camp.resolve('later').id, targetId: camp.id });
    expect(camp.resolve('early').id > camp.resolve('later').id).toBe(true);
    const resolution = world.audit.records().find(r => r.category === 'reference' && r.status === 'resolved' && (r.data as { reference?: string }).reference === 'later')!;
    expect(resolution.instanceIds).toEqual([camp.resolve('later').id]);
  });
  it('isolates aliases, roles, symbols and root across worlds', () => {
    const engine = compositionEngine(); const config = { map: compositionMap(), player: { definitionId: 'player', position: { x: 0, y: 23 } } };
    const a = engine.createWorld(config); const b = engine.createWorld(config);
    const ca = a.instantiateComposition({ definitionId: 'royalCourt', key: 'court', origin: { x: 5, y: 5 } });
    const cb = b.instantiateComposition({ definitionId: 'royalCourt', key: 'court', origin: { x: 10, y: 5 } });
    a.assignRole({ compositionId: ca.id, role: 'rei', instanceId: ca.resolve('Edward').id });
    expect(b.resolveReference('court#<rei>')).toEqual(cb.resolve('Arthur'));
    a.createCharacter({ definitionId: 'observer', key: 'onlyA', position: { x: 10, y: 10 } });
    expect(code(() => b.resolveReference('root#onlyA'))).toBe('symbolNotFound');
  });
  it('runs the complete public composition example', () => {
    const { world, a, b, gratitude, originalKing, currentKing } = createCompositionExample();
    expect(a.resolve('Arthur')).toEqual(originalKing);
    expect(a.resolve('<rei>')).toEqual(currentKing);
    expect(b.resolve('<rei>').id).not.toBe(currentKing.id);
    expect(world.inspect.find(gratitude.id)!.properties).toMatchObject({ targetId: originalKing.id });
    expect(world.inspect.list('character')).toHaveLength(5);
  });
  it('owns the origin and resolved bindings without exposing live maps in its handle', () => {
    const world = compositionWorld(); const origin = { x: 5, y: 5 }; const bindings = { player: 'root#player' };
    const camp = world.instantiateComposition({ definitionId: 'rivalCity', origin, bindings });
    origin.x = 999; bindings.player = 'missing';
    expect(world.inspect.find(camp.id)!.properties).toMatchObject({ origin: { x: 5, y: 5 }, bindings: { player: world.player.id } });
    expect(Object.keys(camp).sort()).toEqual(['definitionId', 'id', 'kind', 'resolve', 'tryResolve']);
  });
});
