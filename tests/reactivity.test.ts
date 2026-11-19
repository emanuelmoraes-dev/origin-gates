import { describe, expect, it } from 'vitest';
import { executeEvent, type Fact, type ReactionDefinition } from '../src/game/events';
import { dispatchFacts } from '../src/game/reactions';
import { createEntity, createRelation, resolve, worldMap } from '../src/game/state';
import { createWorld, events, executeCommand, interact, scenarios } from '../src/game/world';

function setup() {
  const world = createWorld('social');
  const [victim, a, b, c, d, e] = world.entities;
  return { world, victim, a, b, c, d, e, relation: world.socialRelations[0] };
}
function fact(actorId: string, targetId: string, type = 'attackAttempted'): Fact { return { type, actorId, targetId }; }

describe('declarative fact production', () => {
  it.each([0, 0.5])('emits exactly one attackAttempted on admitted hit/dodge (roll %s)', roll => {
    const { world, victim } = setup();
    const result = executeEvent(events.attack, world.player, victim, () => roll);
    expect(result).toMatchObject({ executed: true, outcomeId: roll === 0 ? 'hit' : 'dodge', facts: [fact(world.player.id, victim.id)] });
    if (!result.executed) throw new Error('Expected admitted attack');
    expect(result.facts).toHaveLength(1);
    expect(victim.hp).toBe(roll === 0 ? 90 : 100);
  });
  it.each(['distance', 'deadTarget', 'deadActor', 'nonAttackable'] as const)('refused %s command emits nothing', reason => {
    const { world, victim, a } = setup();
    if (reason === 'distance') world.player.position = { x: 0, y: 9 };
    if (reason === 'deadTarget') victim.hp = 0;
    if (reason === 'deadActor') world.player.hp = 0;
    if (reason === 'nonAttackable') victim.interactions = [{ event: 'attack' }];
    const command = reason === 'nonAttackable' ? a : victim;
    if (reason === 'nonAttackable') world.player.position = { x: a.position.x, y: a.position.y - 1 };
    const result = executeCommand(world, events.attack, world.player, command, () => 0);
    expect(result.executed).toBe(false);
    expect(result).not.toHaveProperty('facts');
    expect(a.references).toEqual({});
  });
  it('interprets emits for any event identifier and any registered actor', () => {
    const { world, victim, a, c } = setup();
    c.position = { x: victim.position.x - 1, y: victim.position.y };
    const renamed = { ...events.attack, id: 'arbitraryCommand' };
    const result = executeCommand(world, renamed, c, victim, () => 0.5);
    expect(result).toMatchObject({ executed: true, eventId: 'arbitraryCommand', facts: [fact(c.id, victim.id)] });
    expect(a.references.hostileTo).toBe(c.id);
    expect(a.references.hostileTo).not.toBe(world.player.id);
  });
  it('does not infer emissions from an event ID and deduplicates declared types', () => {
    const { world, victim, a } = setup();
    const withoutEmission = { ...events.attack, emits: [] };
    const result = executeCommand(world, withoutEmission, world.player, victim, () => 0);
    expect(result).toMatchObject({ facts: [] });
    expect(a.references).toEqual({});
    const repeatedDeclaration = { ...events.attack, emits: [{ type: 'attackAttempted' }, { type: 'attackAttempted' }] };
    const admitted = executeEvent(repeatedDeclaration, world.player, victim, () => 0);
    if (!admitted.executed) throw new Error('Expected admitted attack');
    expect(admitted.facts).toHaveLength(1);
  });
});

describe('directional relation instances', () => {
  it('registers unique identities and valid endpoints without character-only fields', () => {
    const { world } = setup();
    expect(world.socialRelations).toHaveLength(4);
    const ids = Object.values(world.instances).map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of world.socialRelations) {
      expect(resolve(world, r.id, 'relation')).toBe(r);
      expect(resolve(world, r.sourceId, 'character')).toBeDefined();
      expect(resolve(world, r.targetId, 'character')).toBeDefined();
      expect(r).not.toHaveProperty('position');
      expect(r).not.toHaveProperty('hp');
    }
  });
  it('does not create an inverse relation and does not duplicate intensity on characters', () => {
    const { world, victim, a, relation } = setup();
    expect(relation.sourceId).toBe(a.id);
    expect(relation.targetId).toBe(victim.id);
    expect(world.socialRelations.some(r => r.sourceId === victim.id && r.targetId === a.id)).toBe(false);
    expect(a).not.toHaveProperty('intensity');
    const other = world.socialRelations[1];
    relation.intensity = 0;
    expect(other.intensity).toBe(20);
  });
  it('rejects invalid endpoints and definitions without registering partial relations', () => {
    const { world, victim } = setup();
    const count = Object.keys(world.instances).length;
    expect(() => createRelation(world, 'friendship', 'missing', victim.id, 90)).toThrow('Invalid character reference');
    expect(() => createRelation(world, 'unknown', world.player.id, victim.id, 90)).toThrow('Invalid relation definition');
    expect(() => createRelation(world, 'friendship', world.player.id, victim.id, NaN)).toThrow();
    expect(Object.keys(world.instances)).toHaveLength(count);
  });
});

describe('fact-driven reactions without missions', () => {
  it.each([0, 0.5])('only A becomes hostile in scenario 03 after roll %s', roll => {
    const { world, victim, a, b, c, d, e } = setup();
    expect(world.missions).toHaveLength(0);
    expect(interact(world, victim, () => roll).executed).toBe(true);
    expect(a.references.hostileTo).toBe(world.player.id);
    for (const observer of [b, c, d, e]) expect(observer.references).toEqual({});
    expect(world.relations).toEqual({});
    expect(world.missions).toHaveLength(0);
  });
  it.each([[69, false], [70, true], [71, true]])('uses inclusive intensity threshold (%s)', (intensity, reacts) => {
    const { world, victim, a, relation } = setup();
    relation.intensity = intensity;
    interact(world, victim, () => 0.5);
    expect(a.references.hostileTo === world.player.id).toBe(reacts);
  });
  it.each([[3, true], [4, false]])('uses inclusive Manhattan perception range (%s)', (distance, reacts) => {
    const { world, victim, a } = setup();
    a.position = { x: victim.position.x, y: victim.position.y - distance };
    interact(world, victim, () => 0.5);
    expect(a.references.hostileTo === world.player.id).toBe(reacts);
  });
  it('uses both horizontal and vertical distance, not a diagonal shortcut', () => {
    const { world, victim, a } = setup();
    a.position = { x: victim.position.x + 2, y: victim.position.y + 2 };
    interact(world, victim, () => 0.5);
    expect(a.references).toEqual({});
  });
  it('does not react through a dead relation source', () => {
    const { world, victim, a } = setup();
    a.hp = 0;
    interact(world, victim, () => 0.5);
    expect(a.references).toEqual({});
  });
  it('keeps absent and inverse relations neutral', () => {
    const { world, victim, c, e } = setup();
    expect(world.socialRelations.some(r => r.sourceId === c.id)).toBe(false);
    expect(world.socialRelations.some(r => r.sourceId === e.id && r.targetId === victim.id)).toBe(false);
    expect(world.socialRelations.some(r => r.sourceId === victim.id && r.targetId === e.id)).toBe(true);
    interact(world, victim, () => 0.5);
    expect(c.references).toEqual({});
    expect(e.references).toEqual({});
  });
  it('does not confuse a different target of the same definition with the configured victim', () => {
    const { world, victim, a } = setup();
    const other = createEntity(victim.definition, { x: 2, y: 5 }, world);
    expect(other.definitionId).toBe(victim.definitionId);
    expect(executeCommand(world, events.attack, world.player, other, () => 0.5).executed).toBe(true);
    expect(a.references).toEqual({});
  });
  it('supports multiple relation instances with one rule and shared NPC definitions', () => {
    const { world, victim, a, b } = setup();
    expect(a.definitionId).toBe(b.definitionId);
    world.socialRelations[1].intensity = 90;
    interact(world, victim, () => 0.5);
    expect(a.references.hostileTo).toBe(world.player.id);
    expect(b.references.hostileTo).toBe(world.player.id);
  });
  it('can dispatch facts directly without an interaction and only considers interested rule types', () => {
    const { world, victim, a } = setup();
    expect(dispatchFacts(world, [fact(world.player.id, victim.id, 'unrelatedFact')])).toBe(0);
    expect(a.references).toEqual({});
    expect(dispatchFacts(world, [fact(world.player.id, victim.id)])).toBe(1);
    expect(a.references.hostileTo).toBe(world.player.id);
  });
  it('does not replay the same fact object or duplicate a rule subscription', () => {
    const { world, victim } = setup();
    const definitions = structuredClone(world.reactionDefinitions);
    definitions.respondToAggression.operations = [{ type: 'damage', amount: 1 }];
    const subscriptions = world.factSubscriptions.attackAttempted;
    subscriptions.push(subscriptions[0]);
    const occurrence = fact(world.player.id, victim.id);
    expect(dispatchFacts(world, [occurrence, occurrence], definitions)).toBe(1);
    expect(victim.hp).toBe(99);
    expect(dispatchFacts(world, [occurrence], definitions)).toBe(0);
    expect(victim.hp).toBe(99);
  });
  it('repeated attacks produce distinct occurrences but keep hostility idempotent', () => {
    const { world, victim, a, b, c, d, e } = setup();
    const first = interact(world, victim, () => 0.5);
    const second = interact(world, victim, () => 0.5);
    if (!first.executed || !second.executed) throw new Error('Expected admitted attacks');
    expect(first.facts[0]).not.toBe(second.facts[0]);
    expect(a.references).toEqual({ hostileTo: world.player.id });
    expect(victim.hp).toBe(100);
    for (const observer of [b, c, d, e]) expect(observer.references).toEqual({});
    expect(world.socialRelations.map(r => r.intensity)).toEqual([90, 20, 90, 90]);
  });
  it('a lethal admitted attack still emits its fact and a refused subsequent attack does not', () => {
    const { world, victim, a } = setup();
    victim.hp = 1;
    expect(interact(world, victim, () => 0)).toMatchObject({ killed: true, facts: [fact(world.player.id, victim.id)] });
    expect(a.references.hostileTo).toBe(world.player.id);
    expect(interact(world, victim)).toMatchObject({ executed: false, reason: 'targetAlive' });
  });
});

describe('reaction data configuration and isolation', () => {
  function setLimit(definitions: Record<string, ReactionDefinition>, source: 'relationIntensity' | 'distance', value: number) {
    const condition = definitions.respondToAggression.when.find(c => typeof c !== 'string' && c.type === 'compare' && typeof c.left === 'object' && c.left.source === source);
    if (typeof condition !== 'object' || condition.type !== 'compare') throw new Error('Missing configured condition');
    condition.right = value;
  }
  it('changes intensity threshold through rule data alone', () => {
    const { world, victim, a, b } = setup();
    const definitions = structuredClone(world.reactionDefinitions);
    setLimit(definitions, 'relationIntensity', 20);
    dispatchFacts(world, [fact(world.player.id, victim.id)], definitions);
    expect(a.references.hostileTo).toBe(world.player.id);
    expect(b.references.hostileTo).toBe(world.player.id);
  });
  it('changes range through rule data alone', () => {
    const { world, victim, d } = setup();
    const definitions = structuredClone(world.reactionDefinitions);
    setLimit(definitions, 'distance', 9);
    dispatchFacts(world, [fact(world.player.id, victim.id)], definitions);
    expect(d.references.hostileTo).toBe(world.player.id);
  });
  it('does not specialize on a relation type or on the name of its reference slot', () => {
    const { world, victim, c } = setup();
    world.relationDefinitions = { ...world.relationDefinitions, alliance: { id: 'alliance', name: 'aliança', reactions: ['respondToAggression'] } };
    createRelation(world, 'alliance', c.id, victim.id, 90);
    const definitions = structuredClone(world.reactionDefinitions);
    definitions.respondToAggression.operations = [{ type: 'setReference', entity: 'relation.source', key: 'observedActor', value: 'actor' }];
    dispatchFacts(world, [fact(world.player.id, victim.id)], definitions);
    expect(c.references).toEqual({ observedActor: world.player.id });
  });
  it('fresh scenarios isolate relations, intensities, deduplication and hostility without mutating definitions', () => {
    const { world, victim, a } = setup();
    const snapshot = JSON.stringify({ scenarios, objects: world.objectDefinitions, relations: world.relationDefinitions, rules: world.reactionDefinitions, events });
    interact(world, victim, () => 0.5);
    expect(a.references.hostileTo).toBe(world.player.id);
    const fresh = createWorld('social');
    expect(fresh.entities.every(e => !e.references.hostileTo)).toBe(true);
    expect(fresh.socialRelations.map(r => r.intensity)).toEqual([90, 20, 90, 90]);
    for (const scenario of ['training', 'rivals']) {
      const other = createWorld(scenario);
      expect(other.socialRelations).toHaveLength(0);
      expect(other.factSubscriptions).toEqual({});
      expect(other.entities.every(e => !e.references.hostileTo)).toBe(true);
    }
    expect(JSON.stringify({ scenarios, objects: world.objectDefinitions, relations: world.relationDefinitions, rules: world.reactionDefinitions, events })).toBe(snapshot);
  });
  it('places seven characters on distinct accessible tiles of the unchanged map', () => {
    const { world } = setup();
    const characters = [world.player, ...world.entities];
    expect(characters).toHaveLength(7);
    expect(new Set(characters.map(c => `${c.position.x},${c.position.y}`)).size).toBe(7);
    expect(characters.every(c => worldMap[c.position.y]?.[c.position.x] === 'land')).toBe(true);
  });
});
