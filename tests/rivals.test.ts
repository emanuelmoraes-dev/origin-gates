import { describe, expect, it } from 'vitest';
import { executeEvent } from '../src/game/events';
import { adjacentEntities, createWorld, events, interact, react, scenarios } from '../src/game/world';
import { movePlayer, worldMap, type GameState } from '../src/game/state';

function setup(index = 0) {
  const world = createWorld('rivals');
  const mission = world.missionDefinitions[index];
  const rep = world.entities.find(entity => entity.definition.id === mission.representative)!;
  world.player.position = { x: rep.position.x, y: rep.position.y - 1 };
  return { world, mission, rep, state: world.missions[mission.id] };
}
function finish(world: GameState, index = 0) {
  const mission = world.missionDefinitions[index];
  const target = world.missions[mission.id].target!;
  world.player.position = { x: target.position.x - 1, y: target.position.y };
  while (target.hp > 0) interact(world, target, () => 0);
  react(world);
  const rep = world.entities.find(entity => entity.definition.id === mission.representative)!;
  world.player.position = { x: rep.position.x, y: rep.position.y - 1 };
  return rep;
}

describe('declarative rival missions', () => {
  it.each([0, 1])('accepts either faction mission (%s) and spawns only its target', index => {
    const { world, mission, rep, state } = setup(index);
    expect(world.entities).toHaveLength(2);
    expect(interact(world, rep).executed).toBe(true);
    expect(state.status).toBe('active');
    expect(state.target?.hp).toBe(100);
    expect(state.target?.position).toEqual(mission.spawn);
    expect(world.entities).toHaveLength(3);
  });
  it.each([0, 1])('refuses below 20 and accepts exactly 20 (%s)', index => {
    const { world, mission, rep, state } = setup(index);
    world.relations[mission.faction] = 19;
    expect(interact(world, rep)).toMatchObject({ executed: false, reason: 'compare' });
    expect(state.status).toBe('available');
    expect(state.target).toBeUndefined();
    world.relations[mission.faction] = 20;
    expect(interact(world, rep).executed).toBe(true);
  });
  it('does not complete or reward while target is alive', () => {
    const { world, rep, state } = setup();
    interact(world, rep);
    expect(react(world)).toEqual([]);
    expect(interact(world, rep)).toMatchObject({ executed: false, reason: 'missionStatus' });
    expect(state.status).toBe('active');
    expect(world.player.attributes.damage).toBe(10);
    expect(world.relations).toEqual({ government: 50, resistance: 50 });
  });
  it.each([0, 1])('updates both relations and uses the post-update reward (%s)', index => {
    const { world, mission, rep, state } = setup(index);
    interact(world, rep);
    finish(world, index);
    expect(state.status).toBe('ready');
    expect(interact(world, rep).executed).toBe(true);
    expect(world.relations[mission.faction]).toBe(70);
    expect(world.relations[mission.opponent]).toBe(35);
    expect(world.player.attributes.damage).toBe(15);
    expect(state.status).toBe('completed');
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
    const { world, mission, rep, state } = setup();
    const definitions = structuredClone(events);
    // Isolate reward boundaries, retaining the delivery conditions and interpreter.
    definitions.deliver.outcomes[0].operations = definitions.deliver.outcomes[0].operations.filter(op => op.type !== 'relation');
    interact(world, rep);
    finish(world);
    world.relations[mission.faction] = relation;
    expect(interact(world, rep, () => 0, definitions).executed).toBe(true);
    expect(world.player.attributes.damage).toBe(10 + bonus);
    expect(state.status).toBe('completed');
  });
  it('guards duplicate rewards, repeats with a fresh target and restores its HP', () => {
    const { world, mission, rep, state } = setup();
    interact(world, rep);
    const oldTarget = state.target!;
    finish(world);
    interact(world, rep);
    const damage = world.player.attributes.damage;
    const context = { world, mission };
    expect(executeEvent(events.deliver, world.player, rep, () => 0, context).executed).toBe(false);
    expect(world.player.attributes.damage).toBe(damage);
    interact(world, rep);
    expect(state.status).toBe('active');
    expect(state.target).not.toBe(oldTarget);
    expect(state.target?.hp).toBe(100);
    expect(oldTarget.hp).toBe(0);
    expect(world.entities).not.toContain(oldTarget);
    expect(world.entities).toHaveLength(3);
  });
  it.each(['active', 'ready'] as const)('blocks a second mission while first is %s', status => {
    const { world, rep, state } = setup();
    interact(world, rep);
    state.status = status;
    const other = world.entities[1];
    world.player.position = { x: other.position.x, y: other.position.y - 1 };
    expect(interact(world, other)).toMatchObject({ executed: false, reason: 'noActiveMission' });
    expect(world.entities).toHaveLength(3);
  });
  it('uses current damage, preserves dodge and rejects dead targets and representatives', () => {
    const { world, rep, state } = setup();
    expect(executeEvent(events.attack, world.player, rep, () => 0)).toMatchObject({ executed: false, reason: 'targetAttackable' });
    interact(world, rep);
    const target = state.target!;
    world.player.position = { x: target.position.x - 1, y: target.position.y };
    world.player.attributes.damage = 35;
    expect(interact(world, target, () => 0)).toMatchObject({ damage: 35, targetHp: 65 });
    expect(interact(world, target, () => 0.5)).toMatchObject({ damage: 0, targetHp: 65 });
    target.hp = 0;
    expect(interact(world, target)).toMatchObject({ executed: false, reason: 'targetAlive' });
  });
  it('reacts to state even when death came from an unrelated source', () => {
    const { world, rep, state } = setup();
    interact(world, rep);
    state.target!.hp = 0;
    expect(react(world)).toHaveLength(1);
    expect(state.status).toBe('ready');
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
    expect(world.relations.resistance).toBe(5);
    const other = world.entities[1];
    world.player.position = { x: other.position.x, y: other.position.y - 1 };
    expect(interact(world, other)).toMatchObject({ executed: false, reason: 'compare' });
    expect(createWorld('rivals').relations).toEqual({ government: 50, resistance: 50 });
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
