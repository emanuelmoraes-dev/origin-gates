import { describe, expect, it, vi } from 'vitest';
import type { EventDefinition } from '../src/game/events';
import { selectInteraction } from '../src/game/interactions';
import { createEntity, type InteractionBinding, type ObjectDefinition } from '../src/game/state';
import { createWorld, events, interact } from '../src/game/world';

const feedback = { color: '#ffffff', durationMs: 0, message: 'ok' };
function event(id: string, damage = 1): EventDefinition {
  return { id, conditions: [], outcomes: [{ id: 'done', weight: 1, operations: [{ type: 'damage', amount: damage }], feedback }] };
}
function object(id: string, interactions?: readonly InteractionBinding[]): ObjectDefinition {
  return { id, name: id, maxHp: 100, color: '#ffffff', interactions };
}
function setup() {
  const world = createWorld('training');
  world.player.position = { x: 4, y: 5 };
  return world;
}

describe('data-driven interaction selection', () => {
  it('lets different objects offer different events through the same selector', () => {
    const world = setup();
    const definitions = { first: event('first', 2), second: event('second', 3) };
    const a = createEntity(object('a', [{ event: 'first' }]), { x: 5, y: 5 }, world);
    const b = createEntity(object('b', [{ event: 'second' }]), { x: 5, y: 5 }, world);
    expect(interact(world, a, () => 0, definitions)).toMatchObject({ eventId: 'first', damage: 2 });
    expect(interact(world, b, () => 0, definitions)).toMatchObject({ eventId: 'second', damage: 3 });
  });

  it('uses association order, independently of event registry order', () => {
    const world = setup();
    const definitions = { second: event('second'), first: event('first') };
    const target = createEntity(object('a', [{ event: 'first' }, { event: 'second' }]), { x: 5, y: 5 }, world);
    const random = vi.fn(() => 0);
    expect(selectInteraction(world, target, definitions)?.event.id).toBe('first');
    expect(target.hp).toBe(100); // Selection itself has no operations or RNG.
    expect(interact(world, target, random, definitions)).toMatchObject({ eventId: 'first' });
    expect(random).toHaveBeenCalledTimes(1);
    target.interactions = [{ event: 'second' }, { event: 'first' }];
    expect(interact(world, target, random, definitions)).toMatchObject({ eventId: 'second' });
  });

  it('changes behavior by editing only the object association data', () => {
    const world = setup();
    const definitions = { first: event('first', 2), second: event('second', 7) };
    const data = { ...object('a'), interactions: [{ event: 'first' }] };
    const before = createEntity(data, { x: 5, y: 5 }, world);
    expect(interact(world, before, () => 0, definitions)).toMatchObject({ eventId: 'first', damage: 2 });
    const edited = structuredClone(data);
    edited.interactions[0].event = 'second';
    expect(interact(world, createEntity(edited, { x: 5, y: 5 }, world), () => 0, definitions)).toMatchObject({ eventId: 'second', damage: 7 });
    expect(data.interactions[0].event).toBe('first');
  });

  it('allows instance overrides; an empty override disables inherited interactions', () => {
    const world = setup();
    const definition = object('a', [{ event: 'first' }]);
    const definitions = { first: event('first'), second: event('second') };
    const a = createEntity(definition, { x: 5, y: 5 }, world, [{ event: 'second' }]);
    const b = createEntity(definition, { x: 5, y: 5 }, world);
    const disabled = createEntity(definition, { x: 5, y: 5 }, world, []);
    expect(interact(world, a, () => 0, definitions)).toMatchObject({ eventId: 'second' });
    expect(interact(world, b, () => 0, definitions)).toMatchObject({ eventId: 'first' });
    expect(interact(world, disabled, () => 0, definitions)).toMatchObject({ executed: false, reason: 'noApplicableEvent' });
    expect(definition.interactions).toEqual([{ event: 'first' }]);
  });

  it('skips false when predicates, but never skips a selected event after validation refusal', () => {
    const world = setup();
    const hidden = event('hidden', 99);
    hidden.when = [{ type: 'compare', left: 0, operator: 'gte', right: 1 }];
    const refused = event('refused', 99);
    refused.conditions = [{ type: 'compare', left: 0, operator: 'gte', right: 1, message: 'Recusado.' }];
    const target = createEntity(object('a', [{ event: 'hidden' }, { event: 'refused' }, { event: 'attack' }]), { x: 5, y: 5 }, world);
    const definitions = { ...events, hidden, refused };
    const random = vi.fn(() => 0);
    const snapshot = JSON.stringify(world);
    expect(selectInteraction(world, target, definitions)?.event.id).toBe('refused');
    expect(interact(world, target, random, definitions)).toEqual({ executed: false, reason: 'compare', message: 'Recusado.' });
    expect(target.hp).toBe(100);
    expect(JSON.stringify(world)).toBe(snapshot);
    expect(random).not.toHaveBeenCalled();
  });

  it.each([undefined, [], [{ event: 'hidden' }]])('does not attack when no event applies (%j)', associations => {
    const world = setup();
    const hidden = event('hidden');
    hidden.when = [{ type: 'compare', left: 0, operator: 'gte', right: 1 }];
    const target = createEntity(object('a', associations), { x: 5, y: 5 }, world);
    const random = vi.fn(() => 0);
    expect(interact(world, target, random, { ...events, hidden })).toMatchObject({ executed: false, reason: 'noApplicableEvent' });
    expect(target.hp).toBe(100);
    expect(random).not.toHaveBeenCalled();
  });

  it('resolves explicit context without identifying the target as a mission representative', () => {
    const world = createWorld('rivals');
    const rep = world.entities[1];
    const target = createEntity(object('unrelated-object', [{ event: 'accept', context: { offer: 'target' } }]), { x: 3, y: 5 }, world);
    target.offer = rep.offer;
    target.factionId = rep.factionId;
    const selected = selectInteraction(world, target, events)!;
    expect(selected.context?.world).toBe(world);
    expect(selected.context?.contractorId).toBe(target.id);
    expect(interact(world, target, () => 0)).toMatchObject({ eventId: 'accept', executed: true });
    expect(world.missions[0].contractorId).toBe(target.id);
    expect(world.missions).toHaveLength(1);
    expect(target.hp).toBe(100);
  });

  it('passes the player and selected entity as actor and target without redirecting damage', () => {
    const world = setup();
    const target = createEntity(object('a', [{ event: 'attack' }]), { x: 5, y: 5 }, world);
    world.player.attributes.damage = 23;
    expect(interact(world, target, () => 0)).toMatchObject({ damage: 23, targetHp: 77 });
    expect(world.player.hp).toBe(100);
    expect(world.entities[0].hp).toBe(100);
  });

  it('reports invalid references instead of silently falling back to combat', () => {
    const world = setup();
    const target = createEntity(object('a', [{ event: 'missing' }]), { x: 5, y: 5 }, world);
    expect(() => interact(world, target)).toThrow('Unknown interaction event: missing');
    target.interactions = [{ event: 'attack', context: { offer: 'target' } }];
    target.offer = { mission: 'missing', target: 'enemy', opponentId: 'missing', name: 'test', spawn: { x: 0, y: 0 } };
    expect(() => interact(world, target)).toThrow('Unknown interaction mission: missing');
    expect(target.hp).toBe(100);
  });
});
