import { describe, expect, it } from 'vitest';
import { executeEvent } from '../src/game/events';
import { adjacentEntities, createWorld, events, interact, react, scenarios } from '../src/game/world';
import { movePlayer, resolve, worldMap, type GameState } from '../src/game/state';

function setup(index = 0) {
  const world = createWorld('rivals');
  const rep = world.entities[index];
  const mission = { ...rep.offer!, faction: rep.factionId!, opponent: rep.offer!.opponentId };
  world.player.position = { x: rep.position.x, y: rep.position.y - 1 };
  const current = () => world.missions.filter(item => item.contractorId === rep.id).at(-1)!;
  return { world, mission, rep, current };
}
function finish(world: GameState, index = 0) {
  const rep = world.entities[index];
  const mission = world.missions.filter(item => item.contractorId === rep.id).at(-1)!;
  const target = resolve(world, mission.targetId, 'character');
  world.player.position = { x: target.position.x - 1, y: target.position.y };
  for (let i = 0; target.hp > 0 && i < 100; i++) interact(world, target, () => 0);
  expect(target.hp).toBe(0);
  react(world);
  world.player.position = { x: rep.position.x, y: rep.position.y - 1 };
  return rep;
}

describe('declarative rival missions', () => {
  it.each([0, 1])('accepts either faction mission (%s) and spawns only its target', index => {
    const { world, mission, rep, current } = setup(index);
    expect(world.entities).toHaveLength(2);
    expect(interact(world, rep).executed).toBe(true);
    expect(current().status).toBe('active');
    expect(resolve(world, current().targetId, 'character').hp).toBe(100);
    expect(resolve(world, current().targetId, 'character').position).toEqual(mission.spawn);
    expect(world.entities).toHaveLength(3);
  });
  it.each([0, 1])('refuses below 20 and accepts exactly 20 (%s)', index => {
    const { world, mission, rep, current } = setup(index);
    world.relations[mission.faction] = 19;
    expect(interact(world, rep)).toMatchObject({ executed: false, reason: 'compare' });
    expect(world.missions).toHaveLength(0);
    world.relations[mission.faction] = 20;
    expect(interact(world, rep).executed).toBe(true);
  });
  it('does not complete or reward while target is alive', () => {
    const { world, rep, current } = setup();
    interact(world, rep);
    expect(react(world)).toEqual([]);
    expect(interact(world, rep)).toMatchObject({ executed: false, reason: 'missionStatus' });
    expect(current().status).toBe('active');
    expect(world.player.attributes.damage).toBe(10);
    expect(Object.values(world.relations)).toEqual([50, 50]);
  });
  it.each([0, 1])('updates both relations and uses the post-update reward (%s)', index => {
    const { world, mission, rep, current } = setup(index);
    interact(world, rep);
    finish(world, index);
    expect(current().status).toBe('ready');
    expect(interact(world, rep).executed).toBe(true);
    expect(world.relations[mission.faction]).toBe(70);
    expect(world.relations[mission.opponent]).toBe(35);
    expect(world.player.attributes.damage).toBe(15);
    expect(current().status).toBe('completed');
  });
  it('clamps relations and accumulated damage', () => {
    const { world, mission, rep } = setup();
    world.relations[mission.faction] = 95;
    world.relations[mission.opponent] = 5;
    world.player.attributes.damage = 49;
    interact(world, rep);
    finish(world);
    interact(world, rep);
    expect(world.relations[mission.faction]).toBe(100);
    expect(world.relations[mission.opponent]).toBe(0);
    expect(world.player.attributes.damage).toBe(50);
  });
  it.each([[0, 1], [29, 1], [30, 3], [59, 3], [60, 5], [79, 5], [80, 10], [100, 10]])('evaluates reward band for relation %s', (relation, bonus) => {
    const { world, mission, rep, current } = setup();
    const definitions = structuredClone(events);
    // Isolate reward boundaries, retaining the delivery conditions and interpreter.
    definitions.deliver.outcomes[0].operations = definitions.deliver.outcomes[0].operations.filter(op => op.type !== 'relation');
    interact(world, rep);
    finish(world);
    world.relations[mission.faction] = relation;
    expect(interact(world, rep, () => 0, definitions).executed).toBe(true);
    expect(world.player.attributes.damage).toBe(10 + bonus);
    expect(current().status).toBe('completed');
  });
  it('guards duplicate rewards, repeats with a fresh target and restores its HP', () => {
    const { world, mission, rep, current } = setup();
    interact(world, rep);
    const oldTarget = resolve(world, current().targetId, 'character');
    finish(world);
    interact(world, rep);
    const damage = world.player.attributes.damage;
    const context = { world, contractorId: rep.id, offer: rep.offer!, missionId: current().id };
    expect(executeEvent(events.deliver, world.player, rep, () => 0, context).executed).toBe(false);
    expect(world.player.attributes.damage).toBe(damage);
    interact(world, rep);
    expect(current().status).toBe('active');
    expect(resolve(world, current().targetId, 'character')).not.toBe(oldTarget);
    expect(resolve(world, current().targetId, 'character').hp).toBe(100);
    expect(oldTarget.hp).toBe(0);
    expect(world.entities).toContain(oldTarget);
    expect(world.missions).toHaveLength(2);
    expect(world.entities).toHaveLength(4);
  });
  it.each(['active', 'ready'] as const)('allows the other representative while first is %s', status => {
    const { world, rep, current } = setup();
    interact(world, rep);
    current().status = status;
    const other = world.entities[1];
    world.player.position = { x: other.position.x, y: other.position.y - 1 };
    expect(interact(world, other).executed).toBe(true);
    expect(world.missions).toHaveLength(2);
    expect(world.entities).toHaveLength(4);
  });
  it('uses current damage, preserves dodge and rejects dead targets and representatives', () => {
    const { world, rep, current } = setup();
    expect(executeEvent(events.attack, world.player, rep, () => 0)).toMatchObject({ executed: false, reason: 'targetAttackable' });
    interact(world, rep);
    const target = resolve(world, current().targetId, 'character');
    world.player.position = { x: target.position.x - 1, y: target.position.y };
    world.player.attributes.damage = 35;
    expect(interact(world, target, () => 0)).toMatchObject({ damage: 35, targetHp: 65 });
    expect(interact(world, target, () => 0.5)).toMatchObject({ damage: 0, targetHp: 65 });
    target.hp = 0;
    expect(interact(world, target)).toMatchObject({ executed: false, reason: 'targetAlive' });
  });
  it('reacts to state even when death came from an unrelated source', () => {
    const { world, rep, current } = setup();
    interact(world, rep);
    resolve(world, current().targetId, 'character').hp = 0;
    expect(react(world)).toHaveLength(1);
    expect(current().status).toBe('ready');
    expect(react(world)).toEqual([]);
  });
  it('changes thresholds, relation amounts, reward bands and caps through definitions', () => {
    const { world, mission, rep } = setup();
    const definitions = structuredClone(events);
    const threshold = definitions.accept.conditions.find(c => typeof c !== 'string' && c.type === 'compare');
    if (typeof threshold === 'object' && threshold.type === 'compare') threshold.right = 60;
    expect(interact(world, rep, () => 0, definitions).executed).toBe(false);
    world.relations[mission.faction] = 60;
    expect(interact(world, rep, () => 0, definitions).executed).toBe(true);
    finish(world);
    for (const operation of definitions.deliver.outcomes[0].operations) {
      if (operation.type === 'relation') operation.amount = operation.faction === 'faction' ? 7 : -4;
      if (operation.type === 'attributeReward') {
        operation.bands = [{ min: 0, max: 100, amount: 9 }];
        operation.max = 17;
      }
    }
    interact(world, rep, () => 0, definitions);
    expect(world.relations[mission.faction]).toBe(67);
    expect(world.relations[mission.opponent]).toBe(46);
    expect(world.player.attributes.damage).toBe(17);
  });
  it('repeated choices block the opposing faction until reset; definitions remain unchanged', () => {
    const snapshot = JSON.stringify({ events, scenarios });
    const { world, rep } = setup();
    for (let i = 0; i < 3; i++) {
      interact(world, rep);
      finish(world);
      interact(world, rep);
    }
    expect(world.relations[world.factions[1].id]).toBe(5);
    const other = world.entities[1];
    world.player.position = { x: other.position.x, y: other.position.y - 1 };
    expect(interact(world, other)).toMatchObject({ executed: false, reason: 'compare' });
    expect(Object.values(createWorld('rivals').relations)).toEqual([50, 50]);
    expect(createWorld('rivals').player.attributes.damage).toBe(10);
    expect(createWorld('rivals').entities).toHaveLength(2);
    expect(JSON.stringify({ events, scenarios })).toBe(snapshot);
  });
  it('preserves the original training scenario and collision rules', () => {
    const world = createWorld('training');
    expect(world.entities).toHaveLength(1);
    expect(world.missionDefinitions).toHaveLength(0);
    world.player.position = { x: 4, y: 5 };
    expect(movePlayer(world.player, 1, 0, worldMap, world.entities)).toBe(false);
    expect(adjacentEntities(world)).toEqual(world.entities);
    expect(interact(world, world.entities[0], () => 0)).toMatchObject({ damage: 10, targetHp: 90 });
  });
});
