import { describe, expect, it } from 'vitest';
import { applyOperations, executeEvent, matches } from '../src/events.js';
import { dispatchFacts } from '../src/reactions.js';
import { addRelationDelta, createEntity, createRelation, findRelation, getRelationIntensity, requireRelation, resolve, setRelationIntensity, type GameState, type RelationDefinition } from '../src/state.js';
import { createWorld, events, interact } from './fixtures/internal-world.js';

function friendship(world: GameState) { return world.relationInstances.find(r => r.definitionId === 'friendship')!; }
function reputation(world: GameState, index = 0) { return requireRelation(world, 'reputation', world.factions[index].id, world.player.id); }
function snapshot(world: GameState) {
  return JSON.stringify({ instances: world.instances, nextId: world.nextId, subscriptions: world.factSubscriptions });
}
function define(world: GameState, definition: RelationDefinition) {
  world.relationDefinitions = { ...world.relationDefinitions, [definition.id]: definition };
}

describe('unified directional relations', () => {
  it('represents each faction evaluation as a concrete faction -> player relation', () => {
    const world = createWorld('rivals');
    expect(world).not.toHaveProperty('relations');
    expect(world.relationInstances).toHaveLength(2);
    const ids = new Set<string>();
    for (const [index, faction] of world.factions.entries()) {
      const relation = reputation(world, index);
      expect(relation.definitionId).toBe('reputation');
      expect(relation.sourceId).toBe(faction.id);
      expect(relation.targetId).toBe(world.player.id);
      expect(getRelationIntensity(world, relation.id)).toBe(50);
      expect(resolve(world, relation.id, 'relation')).toBe(relation);
      ids.add(relation.id);
      expect(faction).not.toHaveProperty('hp');
      expect(faction).not.toHaveProperty('position');
      expect(faction).not.toHaveProperty('attributes');
    }
    expect(ids.size).toBe(2);
  });

  it.each(['reputation', 'friendship'] as const)('enforces endpoint categories for %s without partial changes', type => {
    const world = createWorld('rivals');
    const [character] = world.entities;
    const faction = world.factions[0];
    const invalidPairs = type === 'reputation'
      ? [[world.player.id, faction.id], [character.id, world.player.id], [faction.id, faction.id]]
      : [[faction.id, character.id], [character.id, faction.id]];
    const before = snapshot(world);
    for (const [source, target] of invalidPairs) expect(() => createRelation(world, type, source, target, 50)).toThrow('Invalid relation participant');
    expect(snapshot(world)).toBe(before);
  });

  it.each(['reputation', 'friendship'] as const)('rejects duplicate %s before changing IDs, records, or subscriptions', type => {
    const world = createWorld(type === 'reputation' ? 'rivals' : 'social');
    const relation = type === 'reputation' ? reputation(world) : friendship(world);
    const before = snapshot(world);
    expect(() => createRelation(world, type, relation.sourceId, relation.targetId, 42)).toThrow('Duplicate directional relation');
    expect(snapshot(world)).toBe(before);
  });

  it('allows inverse friendship independently without creating it automatically', () => {
    const world = createWorld('social');
    const forward = friendship(world);
    expect(findRelation(world, 'friendship', forward.targetId, forward.sourceId)).toBeUndefined();
    const reverse = createRelation(world, 'friendship', forward.targetId, forward.sourceId, 20);
    expect(reverse.id).not.toBe(forward.id);
    addRelationDelta(world, reverse.id, 5);
    expect(getRelationIntensity(world, reverse.id)).toBe(25);
    expect(getRelationIntensity(world, forward.id)).toBe(90);
  });

  it('allows different relation types between the same concrete participants', () => {
    const world = createWorld('social');
    const first = friendship(world);
    define(world, { ...world.relationDefinitions.friendship, id: 'protection', name: 'proteção', reactions: [] });
    const second = createRelation(world, 'protection', first.sourceId, first.targetId, 7);
    expect(requireRelation(world, 'friendship', first.sourceId, first.targetId)).toBe(first);
    expect(requireRelation(world, 'protection', first.sourceId, first.targetId)).toBe(second);
    addRelationDelta(world, second.id, 3);
    expect(first.intensity).toBe(90);
    expect(second.intensity).toBe(10);
  });

  it('does not impose uniqueness on types whose explicit policy allows multiple instances', () => {
    const world = createWorld('social');
    const first = friendship(world);
    define(world, { ...world.relationDefinitions.friendship, id: 'testMultiple', unique: false, reactions: [] });
    const a = createRelation(world, 'testMultiple', first.sourceId, first.targetId, 1);
    const b = createRelation(world, 'testMultiple', first.sourceId, first.targetId, 2);
    expect(a.id).not.toBe(b.id);
    expect(() => findRelation(world, 'testMultiple', first.sourceId, first.targetId)).toThrow('Ambiguous relation');
    addRelationDelta(world, b.id, 5);
    expect(a.intensity).toBe(1);
    expect(b.intensity).toBe(7);
  });

  it('distinguishes absence from zero; optional and required lookups never create relations', () => {
    const world = createWorld('rivals');
    const source = world.factions[0].id;
    const other = world.entities[0];
    const before = snapshot(world);
    expect(findRelation(world, 'reputation', source, other.id)).toBeUndefined();
    expect(() => requireRelation(world, 'reputation', source, other.id)).toThrow('Missing relation');
    expect(snapshot(world)).toBe(before);
    const zero = createRelation(world, 'reputation', source, other.id, 0);
    expect(findRelation(world, 'reputation', source, other.id)).toBe(zero);
    expect(getRelationIntensity(world, zero.id)).toBe(0);
    expect(reputation(world).intensity).toBe(50);
  });

  it('missing required reputation refuses execution with an integrity error rather than assuming zero', () => {
    const world = createWorld('rivals');
    const relation = reputation(world);
    delete world.instances[relation.id]; // Simulate damaged external state.
    const rep = world.entities[0];
    world.player.position = { x: rep.position.x, y: rep.position.y - 1 };
    const before = snapshot(world);
    expect(() => interact(world, rep)).toThrow('Missing relation');
    expect(snapshot(world)).toBe(before);
    expect(world.missions).toHaveLength(0);
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite creation, assignment and deltas (%s)', invalid => {
    const world = createWorld('rivals');
    const r = reputation(world);
    const before = snapshot(world);
    expect(() => createRelation(world, 'reputation', r.sourceId, world.entities[0].id, invalid)).toThrow('Non-finite');
    expect(() => setRelationIntensity(world, r.id, invalid)).toThrow('Non-finite');
    expect(() => addRelationDelta(world, r.id, invalid)).toThrow('Non-finite');
    expect(snapshot(world)).toBe(before);
  });

  it('applies reputational limits to creation, assignments and deltas through one definition', () => {
    const world = createWorld('rivals');
    const a = reputation(world);
    const b = reputation(world, 1);
    addRelationDelta(world, a.id, 20);
    addRelationDelta(world, b.id, -15);
    expect([a.intensity, b.intensity]).toEqual([70, 35]);
    addRelationDelta(world, a.id, 1000);
    addRelationDelta(world, b.id, -1000);
    expect([a.intensity, b.intensity]).toEqual([100, 0]);
    setRelationIntensity(world, a.id, -7);
    setRelationIntensity(world, b.id, 107);
    expect([a.intensity, b.intensity]).toEqual([0, 100]);
    const created = createRelation(world, 'reputation', a.sourceId, world.entities[0].id, 200);
    expect(created.intensity).toBe(100);
  });

  it('reads bounds from data and leaves friendship unbounded while rejecting overflow', () => {
    const world = createWorld('social');
    const r = friendship(world);
    setRelationIntensity(world, r.id, -20);
    addRelationDelta(world, r.id, 500);
    expect(r.intensity).toBe(480);
    define(world, { ...world.relationDefinitions.friendship, intensity: { min: 10, max: 30 } });
    setRelationIntensity(world, r.id, 0);
    expect(r.intensity).toBe(10);
    addRelationDelta(world, r.id, 100);
    expect(r.intensity).toBe(30);
    define(world, { ...world.relationDefinitions.friendship, intensity: undefined });
    setRelationIntensity(world, r.id, Number.MAX_VALUE);
    expect(() => addRelationDelta(world, r.id, Number.MAX_VALUE)).toThrow('Non-finite');
    expect(r.intensity).toBe(Number.MAX_VALUE);
  });

  it('does not register partial state when bounds or reaction declarations are invalid', () => {
    const world = createWorld('social');
    const r = friendship(world);
    for (const modification of [{ intensity: { min: 10, max: 0 } }, { reactions: ['missing'] }]) {
      define(world, { ...world.relationDefinitions.friendship, id: 'invalid', ...modification });
      const before = snapshot(world);
      expect(() => createRelation(world, 'invalid', r.sourceId, r.targetId, 20)).toThrow();
      expect(snapshot(world)).toBe(before);
    }
  });

  it('rejects dangling endpoint references on lookup, read and mutation', () => {
    const world = createWorld('rivals');
    const r = reputation(world);
    delete world.instances[r.sourceId];
    expect(() => findRelation(world, 'reputation', r.sourceId, r.targetId)).toThrow('Invalid relation participant');
    expect(() => getRelationIntensity(world, r.id)).toThrow('Invalid relation participant');
    expect(() => setRelationIntensity(world, r.id, 30)).toThrow('Invalid relation participant');
    expect(() => addRelationDelta(world, r.id, 20)).toThrow('Invalid relation participant');
    expect(r.intensity).toBe(50);
  });

  it('preserves reactive subscriptions and the original A-only response after rejecting a duplicate', () => {
    const world = createWorld('social');
    const r = friendship(world);
    expect(() => createRelation(world, 'friendship', r.sourceId, r.targetId, 90)).toThrow('Duplicate');
    expect(world.factSubscriptions.attackAttempted).toHaveLength(4);
    for (const subscription of world.factSubscriptions.attackAttempted) expect(resolve(world, subscription.relationId, 'relation')).toBeDefined();
    expect(interact(world, world.entities[0], () => 0.5).executed).toBe(true);
    expect(world.entities.filter(c => c.references.hostileTo).map(c => c.label)).toEqual(['A']);
  });

  it('character-specific reactive conditions and operations still reject faction endpoints', () => {
    const world = createWorld('rivals');
    const r = reputation(world);
    const target = world.player;
    const context = { world, relationId: r.id, fact: { type: 'test', actorId: target.id, targetId: target.id } };
    expect(() => matches({ type: 'alive', entity: 'relation.source' }, target, target, undefined, context)).toThrow('Invalid character reference');
    expect(() => applyOperations([{ type: 'setReference', entity: 'relation.source', key: 'hostileTo', value: 'actor' }], target, target, undefined, context)).toThrow('Invalid character reference');
    expect(world.factions[0]).not.toHaveProperty('references');
    expect(dispatchFacts(world, [context.fact])).toBe(0);
  });

  it('keeps legacy mission relation operations as adapters to the shared mutation mechanism', () => {
    const world = createWorld('rivals');
    const rep = world.entities[0];
    const context = { world, contractorId: rep.id, offer: rep.offer! };
    const event = { ...events.accept, when: [], conditions: [], outcomes: [{ id: 'test', weight: 1, feedback: { color: '#ffffff', durationMs: 0, message: 'test' }, operations: [{ type: 'relation' as const, faction: 'faction' as const, amount: -1000 }] }] };
    executeEvent(event, world.player, rep, () => 0, context);
    expect(reputation(world).intensity).toBe(0);
    expect(reputation(world, 1).intensity).toBe(50);
    expect(world.factSubscriptions).toEqual({});
  });
});
