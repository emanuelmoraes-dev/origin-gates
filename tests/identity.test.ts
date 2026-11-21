import { describe, expect, it } from 'vitest';
import { executeEvent } from '../src/game/events';
import { selectInteraction } from '../src/game/interactions';
import { createEntity, requireRelation, resolve, type EntityState, type GameState, type MissionState } from '../src/game/state';
import { createWorld, events, interact, react } from '../src/content/originGates';

function reputation(world: GameState, factionId: string) {
  return requireRelation(world, 'reputation', factionId, world.player.id);
}
function scores(world: GameState) { return world.factions.map(f => reputation(world, f.id).intensity); }
function approach(world: GameState, target: EntityState) {
  world.player.position = { x: target.position.x, y: target.position.y - 1 };
}
function accept(world: GameState, rep: EntityState): MissionState {
  approach(world, rep);
  expect(interact(world, rep).executed).toBe(true);
  return world.missions.at(-1)!;
}
function kill(world: GameState, mission: MissionState) {
  const target = resolve(world, mission.targetId, 'character');
  approach(world, target);
  for (let i = 0; target.hp > 0 && i < 100; i++) interact(world, target, () => 0);
  expect(target.hp).toBe(0);
  react(world);
}

describe('instance identity and concrete references', () => {
  it('creates independent characters with stable unique IDs from one definition', () => {
    const world = createWorld('training');
    const a = world.entities[0];
    const b = createEntity(a.definition, a.position, world);
    const ids = [world.player.id, a.id, b.id];
    expect(new Set(ids).size).toBe(3);
    expect(a.definitionId).toBe(b.definitionId);
    expect(a.definition).toBe(b.definition);
    a.hp = 12;
    a.position.x = 0;
    a.attributes.damage = 42;
    expect(b.hp).toBe(100);
    expect(b.position.x).toBe(5);
    expect(b.attributes.damage).toBe(10);
    expect(resolve(world, a.id, 'character')).toBe(a);
    expect(resolve(world, b.id, 'character')).toBe(b);
    expect([world.player.id, a.id, b.id]).toEqual(ids);
  });

  it('has faction identities without character-only fields and no pre-created missions', () => {
    const world = createWorld('rivals');
    expect(world.missions).toEqual([]);
    expect(world.missionDefinitions).toHaveLength(1);
    for (const [i, faction] of world.factions.entries()) {
      expect(resolve(world, faction.id, 'faction')).toBe(faction);
      expect(faction).not.toHaveProperty('hp');
      expect(faction).not.toHaveProperty('position');
      expect(reputation(world, faction.id).intensity).toBe(50);
      expect(world.entities[i].factionId).toBe(faction.id);
    }
    expect(new Set(Object.values(world.instances).map(item => item.id)).size).toBe(7);
  });

  it('instantiates the same mission definition with independent participants and same-definition NPC targets', () => {
    const world = createWorld('rivals');
    const [a, b] = world.entities;
    // Test data changes only the target template, keeping distinct spawn positions.
    b.offer = { ...b.offer!, target: a.offer!.target };
    const first = accept(world, a);
    const second = accept(world, b);
    expect(first.id).not.toBe(second.id);
    expect(first.definitionId).toBe(second.definitionId);
    expect(first.definitionId).toBe('eliminateTarget');
    expect(first.executorId).toBe(world.player.id);
    expect(second.executorId).toBe(world.player.id);
    expect(first.contractorId).toBe(a.id);
    expect(second.contractorId).toBe(b.id);
    const firstTarget = resolve(world, first.targetId, 'character');
    const secondTarget = resolve(world, second.targetId, 'character');
    expect(firstTarget.definitionId).toBe(secondTarget.definitionId);
    expect(firstTarget.id).not.toBe(secondTarget.id);
    expect(firstTarget.factionId).toBe(first.opponentId);
    expect(secondTarget.factionId).toBe(second.opponentId);
    expect(first).not.toHaveProperty('hp');
    expect(first).not.toHaveProperty('position');
    kill(world, second);
    expect(second.status).toBe('ready');
    expect(first.status).toBe('active');
    expect(firstTarget.hp).toBe(100);
    const firstSnapshot = JSON.stringify(first);
    approach(world, b);
    expect(interact(world, b).executed).toBe(true);
    expect(second.status).toBe('completed');
    expect(JSON.stringify(first)).toBe(firstSnapshot);
    expect(reputation(world, b.factionId!).intensity).toBe(70);
    expect(reputation(world, a.factionId!).intensity).toBe(35);
    expect(world.player.attributes.damage).toBe(15);
    const context = { world, offer: b.offer!, contractorId: b.id, missionId: second.id };
    expect(executeEvent(events.deliver, world.player, b, () => 0, context).executed).toBe(false);
    expect(world.player.attributes.damage).toBe(15);
    const third = accept(world, b);
    expect(third.id).not.toBe(second.id);
    expect(third.targetId).not.toBe(second.targetId);
    expect(resolve(world, third.targetId, 'character').hp).toBe(100);
    expect(resolve(world, second.targetId, 'character').hp).toBe(0);
    expect(resolve(world, second.id, 'mission').status).toBe('completed');
    expect(first.status).toBe('active');
    expect(world.missions).toHaveLength(3);
    expect(new Set(Object.values(world.instances).map(item => item.id)).size).toBe(Object.keys(world.instances).length);
  });

  it.each(['active', 'ready'] as const)('blocks another mission from the same contractor while %s', status => {
    const world = createWorld('rivals');
    const rep = world.entities[0];
    const mission = accept(world, rep);
    if (status === 'ready') kill(world, mission);
    approach(world, rep);
    const context = selectInteraction(world, rep, events)!.context!;
    // Even a direct attempt to execute acceptance cannot create duplicates.
    expect(executeEvent(events.accept, world.player, rep, () => 0, context).executed).toBe(false);
    expect(world.missions).toHaveLength(1);
    expect(world.entities).toHaveLength(3);
  });

  it('distinguishes contractors even when they share the same character definition', () => {
    const world = createWorld('rivals');
    const first = world.entities[0];
    const clone = createEntity(first.definition, { x: 4, y: 5 }, world);
    clone.factionId = first.factionId;
    clone.offer = { ...first.offer!, spawn: { x: 8, y: 8 } };
    world.entities.push(clone);
    const a = accept(world, first);
    const b = accept(world, clone);
    expect(a.contractorId).not.toBe(b.contractorId);
    expect(a.targetId).not.toBe(b.targetId);
    kill(world, a);
    expect(b.status).toBe('active');
  });

  it('rejects unknown IDs, definition IDs, wrong kinds, and dangling mission participants', () => {
    const world = createWorld('rivals');
    const rep = world.entities[0];
    const mission = accept(world, rep);
    expect(() => resolve(world, rep.definitionId, 'character')).toThrow('Invalid character reference');
    expect(() => resolve(world, 'missing', 'mission')).toThrow('Invalid mission reference');
    expect(() => resolve(world, world.factions[0].id, 'character')).toThrow('Invalid character reference');
    expect(() => interact(world, { ...rep, id: 'missing' })).toThrow('Invalid character reference');
    expect(() => interact(world, { ...rep })).toThrow('Target is not the registered instance');
    for (const field of ['targetId', 'contractorId', 'executorId'] as const) {
      world.instances[mission.id] = { ...mission, [field]: 'missing' };
      expect(() => react(world)).toThrow('Invalid character reference');
    }
    world.instances[mission.id] = mission;
    mission.status = 'ready';
    const context = { world, offer: rep.offer!, contractorId: rep.id, missionId: 'missing' };
    const before = JSON.stringify(world.relationInstances);
    expect(() => executeEvent(events.deliver, world.player, rep, () => 0, context)).toThrow('Invalid mission reference');
    expect(JSON.stringify(world.relationInstances)).toBe(before);
  });

  it('rejects delivery with the wrong contractor or executor before applying rewards', () => {
    const world = createWorld('rivals');
    const [rep, other] = world.entities;
    const mission = accept(world, rep);
    kill(world, mission);
    const context = { world, offer: rep.offer!, contractorId: other.id, missionId: mission.id };
    expect(() => executeEvent(events.deliver, world.player, other, () => 0, context)).toThrow('Mission contractor mismatch');
    context.contractorId = rep.id;
    expect(() => executeEvent(events.deliver, other, rep, () => 0, context)).toThrow('Mission executor mismatch');
    expect(scores(world)).toEqual([50, 50]);
  });

  it('preserves all original JSON definitions through concurrent missions and repetition', () => {
    const world = createWorld('rivals');
    const data = () => JSON.stringify({ objects: world.objectDefinitions, missions: world.missionDefinitions, events });
    const before = data();
    const [a, b] = world.entities;
    const m = accept(world, a);
    accept(world, b);
    kill(world, m);
    approach(world, a);
    interact(world, a);
    accept(world, a);
    expect(data()).toBe(before);
    const fresh = createWorld('rivals');
    expect(fresh.missions).toHaveLength(0);
    expect(scores(fresh)).toEqual([50, 50]);
    expect(fresh.player.attributes.damage).toBe(10);
  });
});
