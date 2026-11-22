import { expect, it } from 'vitest';
import { createWorld, scenarios } from '../src/content/originGates';
import compositions from '../src/data/compositions.json';
import events from '../src/data/events/social.json';
import attack from '../src/data/events/attack.json';
import playerDefinition from '../src/data/objects/player.json';
import enemyDefinition from '../src/data/objects/enemy.json';
import socialDefinitions from '../src/data/objects/social.json';
import observerDefinitions from '../src/data/objects/reactivity.json';
import relationDefinitions from '../src/data/relations.json';
import reactionDefinitions from '../src/data/reactions.json';
import missionDefinitions from '../src/data/missions.json';
import factionDefinitions from '../src/data/factions.json';
import { approach, defeat, interactWith } from './fixtures/actions';
const contentSnapshot = () => JSON.stringify({ scenarios, compositions, events, attack, playerDefinition, enemyDefinition, socialDefinitions, observerDefinitions, relationDefinitions, reactionDefinitions, missionDefinitions, factionDefinitions });

it('loads every production composition, retaining initial characters, positions and structural provenance', () => {
  expect(scenarios.map(s => s.id)).toEqual(['training', 'rivals', 'social']);
  for (const scenario of scenarios) {
    const world = createWorld(scenario.id);
    const composition = world.inspect.list('composition')[0];
    expect(composition.definitionId).toBe(scenario.compositions[0].definitionId);
    expect(world.query.characters().map(c => c.position)).toEqual([scenario.player.position, ...(compositions.find(c => c.id === composition.definitionId)!.characters.map(c => ({ x: c.position.x + scenario.compositions[0].origin.x, y: c.position.y + scenario.compositions[0].origin.y })))]);
    expect(world.query.characters().filter(c => c.id !== world.player.id).every(c => c.createdByCompositionId === composition.id)).toBe(true);
    expect(world.query.factions().every(c => c.createdByCompositionId === composition.id)).toBe(true);
    expect(world.query.relations().every(c => c.createdByCompositionId === composition.id)).toBe(true);
  }
});
it('production training retains movement, blocking, probability, feedback, death and dead-tile traversal', () => {
  const world = createWorld('training'); const guardian = world.resolveReference('training#guardian');
  expect(world.query.character(world.player.id)!.position).toEqual({ x: 2, y: 5 });
  expect(world.query.character(guardian.id)).toMatchObject({ hp: 100, color: '#f39b38', position: { x: 5, y: 5 } });
  approach(world, guardian.id);
  expect(world.move(world.player.id, 1, 0)).toBe(false);
  expect(interactWith(world, guardian.id, 0.5)).toMatchObject({ outcomeId: 'dodge', damage: 0, feedback: { color: '#ffffff', durationMs: 500 } });
  expect(interactWith(world, guardian.id, 0.499999)).toMatchObject({ outcomeId: 'hit', damage: 10, feedback: { color: '#ef5350', durationMs: 500 } });
  defeat(world, guardian.id);
  expect(world.query.character(guardian.id)!.alive).toBe(false);
  expect(world.query.adjacent(world.player.id)).toEqual([]);
  const player = world.query.character(world.player.id)!.position;
  const target = world.query.character(guardian.id)!.position;
  expect(world.move(world.player.id, target.x - player.x, target.y - player.y)).toBe(true);
  expect(world.interact({ actorId: world.player.id, targetId: guardian.id })).toMatchObject({ executed: false, reason: 'targetAlive' });
});
it('production rival missions repeat, reward, clamp reputation and retain the reputation refusal', () => {
  const before = contentSnapshot();
  const world = createWorld('rivals');
  const rep = world.resolveReference('rivals#governmentRepresentative');
  const resistance = world.resolveReference('rivals#resistanceRepresentative');
  const targets: string[] = [];
  for (let i = 0; i < 3; i++) {
    expect(interactWith(world, rep.id).executed).toBe(true);
    const mission = world.query.missions({ contractorId: rep.id, pending: true })[0];
    targets.push(mission.targetId);
    expect(world.query.character(mission.targetId)!.position).toEqual({ x: 8, y: 3 });
    expect(interactWith(world, rep.id)).toMatchObject({ executed: false, reason: 'missionStatus' });
    defeat(world, mission.targetId);
    expect(interactWith(world, rep.id).executed).toBe(true);
  }
  expect(new Set(targets).size).toBe(3);
  expect(world.query.relations({ definitionId: 'reputation' }).map(r => r.intensity)).toEqual([100, 5]);
  expect(world.query.character(world.player.id)!.attributes.damage).toBe(35);
  expect(interactWith(world, resistance.id)).toMatchObject({ executed: false, reason: 'compare', message: 'Missão recusada: relação com a facção abaixo de 20.' });
  expect(world.query.missions()).toHaveLength(3);
  expect(world.query.missions({ pending: true })).toEqual([]);
  expect(contentSnapshot()).toBe(before);
});
it.each([0, 0.5])('production social retains one admitted fact, directional relations and only A hostility: %s', roll => {
  const world = createWorld('social'); const victim = world.resolveReference('social#victim'); world.audit.clear();
  const result = world.interact({ actorId: world.player.id, targetId: victim.id, random: () => roll });
  expect(result).toMatchObject({ executed: true, facts: [{ type: 'attackAttempted', actorId: world.player.id, targetId: victim.id }] });
  expect(world.query.character(victim.id)!.hp).toBe(roll === 0 ? 90 : 100);
  expect(['A', 'B', 'C', 'D', 'E'].map(key => world.query.character(world.resolveReference('social#' + key).id)!.references.hostileTo)).toEqual([world.player.id, undefined, undefined, undefined, undefined]);
  expect(world.query.relations({ definitionId: 'friendship' }).map(r => r.intensity)).toEqual([90, 20, 90, 90]);
  expect(world.query.relations({ sourceId: world.resolveReference('social#E').id })).toEqual([]);
  expect(world.query.relations({ targetId: world.resolveReference('social#E').id })[0].sourceId).toBe(victim.id);
  expect(world.audit.records().filter(r => r.category === 'fact' && r.status === 'emitted')).toHaveLength(1);
  expect(world.audit.records().filter(r => r.category === 'fact' && r.status === 'consumed')).toHaveLength(1);
  expect(createWorld('social').query.characters().every(c => c.references.hostileTo === undefined)).toBe(true);
});
