import { describe, expect, it } from 'vitest';
import type { EventResult } from '@origin-gates/narrative-engine';
import { programmaticWorld } from './fixtures/programmatic.js';
import { approach, character, exerciseRivals, exerciseTraining, interactWith, mission } from './fixtures/actions.js';

describe('public TypeScript scenarios without content or Phaser', () => {
  it('training selects attack, moves, dodges, damages, kills and audits causally', () => {
    const world = programmaticWorld('training');
    const results = exerciseTraining(world);
    expect(results).toMatchObject([{ executed: true, outcomeId: 'dodge', damage: 0 }, { executed: true, outcomeId: 'hit', damage: 10 }, { executed: false, reason: 'targetAlive' }]);
    const records = world.audit.records();
    for (const category of ['world', 'definition', 'instance', 'movement', 'interaction', 'command', 'outcome', 'mutation', 'fact', 'dispatch']) expect(records.some(r => r.category === category)).toBe(true);
    const damage = records.find(r => r.category === 'mutation' && (r.data as { property?: string }).property === 'hp')!;
    expect(damage.parentId).toBeTruthy();
    expect(records.some(r => r.id === damage.parentId && r.traceId === damage.traceId)).toBe(true);
    const exported = world.diagnostics();
    expect(JSON.parse(JSON.stringify(exported)).instances).toHaveLength(2);
    expect(Object.isFrozen(exported.instances[0].properties)).toBe(true);
  });
  it('rivals builds concrete offers, simultaneous missions, rewards and a fresh repeated target', () => {
    const world = programmaticWorld('rivals');
    const results = exerciseRivals(world);
    expect(results.map(r => r.executed)).toEqual([true, true, false, true, true, true]);
    expect(results[2]).toMatchObject({ reason: 'missionStatus' });
    const missions = world.inspect.list('mission').map(mission);
    expect(missions.map(m => m.status)).toEqual(['completed', 'completed', 'active']);
    expect(new Set(missions.map(m => m.targetId)).size).toBe(3);
    expect(character(world, missions[2].targetId).hp).toBe(100);
    expect(character(world, world.player.id).attributes.damage).toBe(18); // rewards 5 at 70, then 3 at 55
    expect(world.inspect.list('relation').map(s => (s.properties as { intensity: number }).intensity)).toEqual([55, 55]);
  });
  it.each([0, 0.75])('social dispatches declared facts after roll %s and only A reacts', roll => {
    const world = programmaticWorld('social');
    const victim = world.inspect.list('character').find(s => s.definitionId === 'victim')!;
    const result = world.interact({ actorId: world.player.id, targetId: victim.id, random: () => roll });
    expect(result).toMatchObject({ executed: true, facts: [{ type: 'attackAttempted', actorId: world.player.id, targetId: victim.id }] });
    const observers = world.inspect.list('character').filter(s => s.definitionId === 'observer');
    expect(observers.map(s => character(world, s.id).references.hostileTo)).toEqual([world.player.id, undefined, undefined, undefined, undefined]);
    const hostile = world.audit.records().find(r => r.category === 'mutation' && (r.data as { property?: string }).property === 'references.hostileTo')!;
    let ancestor = hostile;
    const categories: string[] = [];
    while (ancestor) { categories.push(ancestor.category); ancestor = world.audit.records().find(r => r.id === ancestor.parentId)!; }
    expect(categories).toContain('fact');
    expect(categories).toContain('command');
  });
  it('uses the concrete non-player actor in interaction selection, facts and social reactions', () => {
    const world = programmaticWorld('social');
    const actor = world.createCharacter({ definitionId: 'player', position: { x: 4, y: 6 } });
    const victim = world.inspect.list('character').find(s => s.definitionId === 'victim')!;
    expect(world.interact({ actorId: actor.id, targetId: victim.id, random: () => 0.75 })).toMatchObject({ executed: true, facts: [{ actorId: actor.id, targetId: victim.id }] });
    const a = world.inspect.list('character').find(s => character(world, s.id).label === 'A')!;
    expect(character(world, a.id).references.hostileTo).toBe(actor.id);
  });
  it('prevents registration inside legacy reaction execution and preserves the cause through public results', () => {
    const world = programmaticWorld('rivals');
    const representative = world.inspect.list('character').find(s => s.definitionId === 'governmentRepresentative')!;
    interactWith(world, representative.id);
    const targetId = mission(world.inspect.list('mission')[0]).targetId;
    approach(world, targetId);
    let cause: EventResult | undefined;
    for (let i = 0; i < 10; i++) cause = world.interact({ actorId: world.player.id, targetId, random: () => 0 });
    expect(() => world.react({ cause, random: () => { world.registerDefinitions({ factions: [{ id: 'forbidden', name: 'Forbidden' }] }); return 0; } })).toThrow(/between narrative executions/);
    expect(world.definitions.factions.forbidden).toBeUndefined();
    const causeScope = world.audit.causeOf(cause!);
    expect(causeScope).toBeDefined();
    world.react({ cause, random: () => 0 });
    expect(mission(world.inspect.list('mission')[0]).status).toBe('ready');
    const legacy = world.audit.records().filter(r => r.category === 'legacy' && r.phase === 'start').at(-1)!;
    expect(legacy.traceId).toBe(causeScope!.traceId);
    expect(legacy.parentId).toBe(causeScope!.parentId);
    world.registerDefinitions({ factions: [{ id: 'after', name: 'After' }] });
  });
  it.each(['training', 'rivals', 'social'] as const)('audit enabled/disabled preserves %s state and results', id => {
    const enabled = programmaticWorld(id);
    const disabled = programmaticWorld(id, false);
    const run = (w: typeof enabled) => id === 'training' ? exerciseTraining(w) : id === 'rivals' ? exerciseRivals(w) : [w.interact({ actorId: w.player.id, targetId: w.inspect.list('character')[1].id, random: () => 0.75 })];
    expect(run(enabled)).toEqual(run(disabled));
    expect(enabled.inspect.list()).toEqual(disabled.inspect.list());
    expect(disabled.audit.records()).toEqual([]);
  });
});
