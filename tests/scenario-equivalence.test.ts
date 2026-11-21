import { expect, it } from 'vitest';
import { createWorld, interact, react } from '../src/content/originGates';
import { createInspector } from '../src/game/inspection';
import { movePlayer, resolve } from '../src/game/state';
import type { AuditRecord } from '../src/game';
import { programmaticWorld } from './fixtures/programmatic';
import { exerciseRivals, exerciseTraining, type Driver } from './fixtures/actions';

it.each(['training', 'rivals', 'social'] as const)('JSON adapter and independent TypeScript proof are equivalent: %s', id => {
  const state = createWorld(id, { capacity: 10000 });
  const json: Driver = {
    player: state.player, map: state.map, inspect: createInspector(state),
    move: (actorId, dx, dy) => movePlayer(resolve(state, actorId, 'character'), dx, dy, state.map, state.entities, state.audit!.scope()),
    interact: request => interact(state, resolve(state, request.targetId, 'character'), request.random),
    react: () => react(state, undefined, undefined, () => 0),
  };
  const ts = programmaticWorld(id);
  expect(json.inspect.list()).toEqual(ts.inspect.list());
  const run = (w: Driver) => id === 'training' ? exerciseTraining(w) : id === 'rivals' ? exerciseRivals(w) : [w.interact({ actorId: w.player.id, targetId: w.inspect.list('character')[1].id, random: () => 0.75 }), w.interact({ actorId: w.player.id, targetId: w.inspect.list('character')[1].id, random: () => 0 })];
  expect(run(ts)).toEqual(run(json));
  expect(ts.inspect.list()).toEqual(json.inspect.list());
  const outcomes = (records: readonly AuditRecord[]) => records.filter(r => r.category === 'outcome' && r.status === 'selected').map(r => r.data);
  expect(outcomes(ts.audit.records())).toEqual(outcomes(state.audit!.records()));
});
