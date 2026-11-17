import { describe, expect, it } from 'vitest';
import attackJson from '../src/data/events/attack.json';
import playerJson from '../src/data/objects/player.json';
import enemyJson from '../src/data/objects/enemy.json';
import { executeEvent, type EventDefinition } from '../src/game/events';
import { createEntity, createIdentityStore, movePlayer, worldMap } from '../src/game/state';

const attack = attackJson as EventDefinition;
function setup() {
  const store = createIdentityStore();
  return { player: createEntity(playerJson, { x: 4, y: 5 }, store), enemy: createEntity(enemyJson, { x: 5, y: 5 }, store) };
}

describe('JSON event interpreter (without Phaser)', () => {
  it('hits for 10 damage and returns red feedback', () => {
    const { player, enemy } = setup();
    expect(executeEvent(attack, player, enemy, () => 0)).toMatchObject({ executed: true, outcomeId: 'hit', damage: 10, targetHp: 90, killed: false, feedback: { color: '#ef5350', durationMs: 500 } });
    expect(enemy.hp).toBe(90);
  });
  it.each([0.5, 0.999999])('dodges at random value %s without damage', roll => {
    const { player, enemy } = setup();
    expect(executeEvent(attack, player, enemy, () => roll)).toMatchObject({ executed: true, outcomeId: 'dodge', damage: 0, feedback: { color: '#ffffff' } });
    expect(enemy.hp).toBe(100);
  });
  it('uses the hit half of the probability interval', () => {
    const { player, enemy } = setup();
    expect(executeEvent(attack, player, enemy, () => 0.499999)).toMatchObject({ outcomeId: 'hit' });
  });
  it('kills after ten hits and rejects further attacks', () => {
    const { player, enemy } = setup();
    for (let i = 0; i < 9; i++) executeEvent(attack, player, enemy, () => 0);
    expect(executeEvent(attack, player, enemy, () => 0)).toMatchObject({ killed: true, targetHp: 0 });
    expect(executeEvent(attack, player, enemy)).toEqual({ executed: false, reason: 'targetAlive' });
  });
  it('clamps damage at zero HP', () => {
    const { player, enemy } = setup();
    enemy.hp = 3;
    expect(executeEvent(attack, player, enemy, () => 0)).toMatchObject({ damage: 3, targetHp: 0, killed: true });
  });
  it.each([{ x: 3, y: 5 }, { x: 4, y: 4 }])('rejects distant and diagonal targets from %o', position => {
    const { player, enemy } = setup();
    player.position = position;
    expect(executeEvent(attack, player, enemy, () => { throw new Error('Should not roll'); })).toEqual({ executed: false, reason: 'adjacent' });
    expect(enemy.hp).toBe(100);
  });
  it('rejects a dead actor', () => {
    const { player, enemy } = setup();
    player.hp = 0;
    expect(executeEvent(attack, player, enemy)).toEqual({ executed: false, reason: 'actorAlive' });
  });
  it('keeps definitions and event JSON unchanged and instances independent', () => {
    const original = JSON.stringify({ playerJson, enemyJson, attackJson });
    const { player, enemy } = setup();
    executeEvent(attack, player, enemy, () => 0);
    expect(JSON.stringify({ playerJson, enemyJson, attackJson })).toBe(original);
    expect(setup().enemy.hp).toBe(100);
  });
});

describe('map movement', () => {
  it('moves on land, blocks a living NPC and allows its tile after death', () => {
    const { player, enemy } = setup();
    expect(movePlayer(player, 1, 0, worldMap, [enemy])).toBe(false);
    expect(movePlayer(player, -1, 0, worldMap, [enemy])).toBe(true);
    expect(player.position).toEqual({ x: 3, y: 5 });
    movePlayer(player, 1, 0, worldMap, [enemy]);
    enemy.hp = 0;
    expect(movePlayer(player, 1, 0, worldMap, [enemy])).toBe(true);
  });
  it('blocks water, boundaries and diagonal movement', () => {
    const player = createEntity(playerJson, { x: 0, y: 0 }, createIdentityStore());
    expect(movePlayer(player, -1, 0, worldMap, [])).toBe(false);
    expect(movePlayer(player, 0, -1, worldMap, [])).toBe(false);
    expect(movePlayer(player, 1, 1, worldMap, [])).toBe(false);
    player.position = { x: 5, y: 0 };
    expect(movePlayer(player, 1, 0, worldMap, [])).toBe(false);
    player.position = { x: 9, y: 9 };
    expect(movePlayer(player, 1, 0, worldMap, [])).toBe(false);
    expect(movePlayer(player, 0, 1, worldMap, [])).toBe(false);
  });
});
