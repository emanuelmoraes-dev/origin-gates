import { describe, expect, it, vi } from 'vitest';
import { AuditLog, type AuditRecord } from '../src/game/audit';
import { applyOperations, executeEvent, type EventDefinition } from '../src/game/events';
import { createInspector } from '../src/game/inspection';
import { dispatchFacts } from '../src/game/reactions';
import { addRelationDelta, createEntity, createIdentityStore, createRelation, movePlayer, requireRelation, resolve, setRelationIntensity, worldMap, type GameState } from '../src/game/state';
import { createWorld, events, executeCommand, interact, react } from '../src/game/world';

const data = (record: AuditRecord) => (record.data ?? {}) as Record<string, unknown>;
const records = (world: GameState) => world.audit!.records();
const mutations = (world: GameState, property: string) => records(world).filter(r => r.category === 'mutation' && data(r).property === property);
function ancestors(record: AuditRecord, history: readonly AuditRecord[]): AuditRecord[] {
  const found: AuditRecord[] = [];
  while (record.parentId) {
    const parent = history.find(item => item.id === record.parentId);
    if (!parent || found.includes(parent)) throw new Error('Missing or cyclic causal parent');
    found.push(parent);
    record = parent;
  }
  return found;
}
function approach(world: GameState, id: string) {
  const entity = resolve(world, id, 'character');
  world.player.position = { x: entity.position.x, y: entity.position.y - 1 }; // Fixture setup, outside audited APIs.
}

describe('engine audit coverage and fidelity', () => {
  it('captures every initial registered kind and post-registration configuration, without consuming entity IDs', () => {
    const world = createWorld('rivals');
    const creations = records(world).filter(r => r.category === 'instance' && r.status === 'created');
    expect(creations.map(r => r.instanceIds[0]).sort()).toEqual(Object.keys(world.instances).sort());
    expect(creations).toHaveLength(7);
    expect(new Set(creations.map(r => data(r).kind))).toEqual(new Set(['character', 'faction', 'relation']));
    expect(mutations(world, 'factionId')).toHaveLength(2);
    expect(mutations(world, 'offer')).toHaveLength(2);
    expect(world.nextId).toBe(8);
    for (const record of records(world)) expect(record.instanceIds).not.toContain(record.id);
    expect(records(world).every((r, index, all) => index === 0 || r.sequence > all[index - 1].sequence)).toBe(true);
  });

  it.each([0, 0.5])('links command, genuine decisions, fact and all four considered social rules (roll %s)', roll => {
    const world = createWorld('social', { capacity: 2000 });
    const [victim, a, b, c, d] = world.entities;
    world.audit!.clear();
    const rng = vi.fn(() => roll);
    const result = interact(world, victim, rng);
    expect(result.executed).toBe(true);
    expect(rng).toHaveBeenCalledTimes(1);
    const history = records(world);
    expect(new Set(history.map(r => r.traceId)).size).toBe(1);
    const selected = history.find(r => r.category === 'selection' && r.status === 'selected')!;
    const outcome = history.find(r => r.category === 'outcome')!;
    const emission = history.find(r => r.category === 'fact' && r.status === 'emitted')!;
    const change = mutations(world, 'references.hostileTo')[0];
    expect(data(outcome)).toMatchObject({ sample: roll, total: 2, outcomeId: roll === 0 ? 'hit' : 'dodge' });
    expect(selected.sequence).toBeLessThan(outcome.sequence);
    expect(outcome.sequence).toBeLessThan(emission.sequence);
    expect(emission.sequence).toBeLessThan(change.sequence);
    expect(change.instanceIds).toEqual([a.id]);
    expect(data(change)).toMatchObject({ before: { $undefined: true }, after: world.player.id, operation: 'setReference' });
    const parents = ancestors(change, history);
    expect(parents.map(r => r.category)).toEqual(expect.arrayContaining(['operation', 'reaction', 'dispatch', 'fact', 'command', 'interaction']));
    expect(parents).toContain(emission);
    const considered = history.filter(r => r.category === 'reaction' && r.status === 'considered');
    expect(considered).toHaveLength(4);
    expect(considered.some(r => r.instanceIds.includes(c.id))).toBe(false);
    expect(considered.some(r => r.instanceIds.includes(b.id))).toBe(true);
    expect(considered.some(r => r.instanceIds.includes(d.id))).toBe(true);
    expect(history.filter(r => r.category === 'reaction' && r.phase === 'end').map(r => r.status)).toEqual(['applied', 'rejected', 'rejected', 'rejected']);
    expect(history.some(r => r.category === 'condition' && data(r).left === 20 && data(r).right === 70)).toBe(true);
    expect(history.some(r => r.category === 'condition' && data(r).left === 9 && data(r).right === 3)).toBe(true);
    expect(mutations(world, 'hp')).toHaveLength(roll === 0 ? 1 : 0);
  });

  it('records the actual repeated when checks without adding further evaluations or RNG', () => {
    const world = createWorld('training');
    world.player.position = { x: 4, y: 5 };
    const event: EventDefinition = { ...events.attack, when: ['actorAlive'] };
    let reads = 0;
    Object.defineProperty(world.player, 'hp', { get() { reads++; return 100; } });
    world.audit!.clear();
    const rng = vi.fn(() => 0.5);
    interact(world, world.entities[0], rng, { ...events, attack: event });
    expect(reads).toBe(3); // Selection when, execution when, existing actorAlive condition.
    expect(rng).toHaveBeenCalledTimes(1);
    expect(records(world).filter(r => r.category === 'condition' && r.phase === 'start')).toHaveLength(6);
  });

  it('audits refusals without operations, facts, RNG, or a fake technical failure', () => {
    const world = createWorld('training');
    world.audit!.clear();
    const rng = vi.fn(() => 0);
    expect(interact(world, world.entities[0], rng)).toMatchObject({ executed: false, reason: 'adjacent' });
    expect(rng).not.toHaveBeenCalled();
    expect(records(world).some(r => r.category === 'command' && r.status === 'rejected' && data(r).reason === 'adjacent')).toBe(true);
    expect(records(world).some(r => ['fact', 'operation', 'mutation', 'failure', 'outcome'].includes(r.category))).toBe(false);
    const empty = createWorld('social');
    empty.audit!.clear();
    expect(interact(empty, empty.entities[1])).toMatchObject({ executed: false, reason: 'noApplicableEvent' });
    expect(records(empty).some(r => data(r).reason === 'noApplicableEvent')).toBe(true);
  });

  it('preserves earlier mutations when a later operation throws, recording failure without claiming rollback', () => {
    const world = createWorld('training');
    const target = world.entities[0];
    approach(world, target.id);
    const event: EventDefinition = { ...events.attack, outcomes: [{ ...events.attack.outcomes[0], operations: [{ type: 'damage', amount: 10 }, { type: 'missionStatus', status: 'ready' }] }] };
    world.audit!.clear();
    expect(() => executeCommand(world, event, world.player, target, () => 0)).toThrow('requires world and mission context');
    expect(target.hp).toBe(90);
    expect(mutations(world, 'hp')[0]).toMatchObject({ data: { before: 100, after: 90, operation: 'damage' } });
    expect(records(world).filter(r => r.category === 'failure').every(r => data(r).stateReverted === false)).toBe(true);
    expect(records(world).some(r => r.category === 'fact')).toBe(false);
  });

  it('keeps partial reaction state and the original consumed-fact behavior after failure', () => {
    const world = createWorld('social');
    const definitions = structuredClone(world.reactionDefinitions);
    definitions.respondToAggression.operations = [...definitions.respondToAggression.operations, { type: 'missionStatus', status: 'ready' }];
    const occurrence = { type: 'attackAttempted', actorId: world.player.id, targetId: world.entities[0].id };
    world.audit!.clear();
    expect(() => dispatchFacts(world, [occurrence], definitions)).toThrow('requires world and mission context');
    expect(world.entities[1].references.hostileTo).toBe(world.player.id);
    expect(mutations(world, 'references.hostileTo')).toHaveLength(1);
    expect(records(world).some(r => r.category === 'failure')).toBe(true);
    expect(dispatchFacts(world, [occurrence], definitions)).toBe(0);
    expect(records(world).some(r => r.category === 'dispatch' && r.status === 'skipped')).toBe(true);
  });

  it('instruments mission creation, legacy status, reputation and capped reward through the same explicit trace', () => {
    const world = createWorld('rivals', { capacity: 4000 });
    const rep = world.entities[0];
    approach(world, rep.id);
    interact(world, rep);
    const mission = world.missions[0];
    const target = resolve(world, mission.targetId, 'character');
    expect(records(world).some(r => r.category === 'instance' && r.status === 'created' && r.instanceIds[0] === mission.id && data(r).kind === 'mission')).toBe(true);
    expect(records(world).some(r => r.category === 'instance' && r.status === 'created' && r.instanceIds[0] === target.id)).toBe(true);
    approach(world, target.id);
    target.hp = 10;
    world.audit!.clear();
    const attack = interact(world, target, () => 0);
    const cause = world.audit!.causeOf(attack)!;
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0.3);
    try { expect(react(world, events, cause)).toHaveLength(1); expect(rng).toHaveBeenCalledTimes(1); }
    finally { rng.mockRestore(); }
    expect(mission.status).toBe('ready');
    const statusChange = mutations(world, 'status')[0];
    expect(statusChange.traceId).toBe(cause.traceId);
    expect(data(statusChange)).toMatchObject({ before: 'active', after: 'ready' });
    expect(ancestors(statusChange, records(world)).some(r => r.category === 'legacy')).toBe(true);
    react(world);
    const last = records(world).at(-1)!;
    expect(last.traceId).not.toBe(cause.traceId);
    approach(world, rep.id);
    world.audit!.clear();
    interact(world, rep);
    expect(mutations(world, 'intensity').map(r => [data(r).before, data(r).after])).toEqual([[50, 70], [50, 35]]);
    expect(mutations(world, 'attributes.damage')[0]).toMatchObject({ data: { before: 10, after: 15, operation: 'attributeReward' } });
    expect(mutations(world, 'status')[0]).toMatchObject({ data: { before: 'ready', after: 'completed' } });
  });

  it('audits direct factories, movement, operations and relation helpers with detached before/after data', () => {
    const world = createWorld('rivals');
    world.audit!.clear();
    const relation = requireRelation(world, 'reputation', world.factions[0].id, world.player.id);
    setRelationIntensity(world, relation.id, 60);
    addRelationDelta(world, relation.id, 10);
    const first = mutations(world, 'intensity')[0];
    expect(data(first)).toMatchObject({ before: 50, after: 60 });
    expect(data(mutations(world, 'intensity')[1])).toMatchObject({ before: 60, after: 70 });
    expect(data(first)).toMatchObject({ before: 50, after: 60 });
    movePlayer(world.player, -1, 0, worldMap, world.entities, world.audit!.scope());
    expect(mutations(world, 'position')[0]).toMatchObject({ data: { before: { x: 2, y: 5 }, after: { x: 1, y: 5 } } });
    const count = mutations(world, 'position').length;
    movePlayer(world.player, 0, 0, worldMap, world.entities, world.audit!.scope());
    expect(mutations(world, 'position')).toHaveLength(count);
    applyOperations([{ type: 'damage', amount: 3 }], world.player, world.entities[0], undefined, undefined, world.audit!.scope());
    expect(mutations(world, 'hp')[0]).toMatchObject({ data: { before: 100, after: 97 } });
    const store = createIdentityStore();
    const character = createEntity(world.player.definition, { x: 0, y: 0 }, store);
    expect(store.audit!.records().some(r => r.status === 'created' && r.instanceIds.includes(character.id))).toBe(true);
    const isolatedLog = new AuditLog();
    expect(() => setRelationIntensity(world, relation.id, 99, isolatedLog.scope())).toThrow('another world');
    expect(relation.intensity).toBe(70);
  });

  it('reports technical failures of direct creation/mutation and failed world assembly without fake creations', () => {
    const world = createWorld('social');
    const relation = world.relationInstances[0];
    const beforeId = world.nextId;
    world.audit!.clear();
    expect(() => createRelation(world, 'friendship', relation.sourceId, relation.targetId, 90)).toThrow('Duplicate');
    expect(() => setRelationIntensity(world, relation.id, NaN)).toThrow('Non-finite');
    expect(world.nextId).toBe(beforeId);
    expect(records(world).filter(r => r.status === 'created')).toEqual([]);
    expect(records(world).filter(r => r.category === 'failure')).toHaveLength(2);
    const log = new AuditLog();
    expect(() => createWorld('not-a-scenario', log)).toThrow('Unknown scenario');
    expect(log.records().some(r => r.category === 'failure')).toBe(true);
  });

  it.each(['training', 'rivals', 'social'])('preserves IDs, canonical results and RNG with audit on/off in %s', scenario => {
    function run(enabled: boolean) {
      const world = createWorld(scenario, { enabled, capacity: 10000 });
      const rng = vi.fn(() => 0);
      const target = world.entities[0];
      approach(world, target.id);
      const first = interact(world, target, rng);
      if (scenario === 'rivals') {
        const other = world.entities[1];
        approach(world, other.id);
        interact(world, other, rng);
        const missionTarget = resolve(world, world.missions[0].targetId, 'character');
        approach(world, missionTarget.id);
        for (let i = 0; i < 10; i++) interact(world, missionTarget, rng);
        const spy = vi.spyOn(Math, 'random').mockReturnValue(0.25);
        try { react(world); } finally { spy.mockRestore(); }
        approach(world, target.id);
        interact(world, target, rng);
        interact(world, target, rng); // Repeat: creates a fresh mission and target.
      }
      return { state: createInspector(world).list(), nextId: world.nextId, first, rngCalls: rng.mock.calls.length, log: world.audit! };
    }
    const on = run(true);
    const off = run(false);
    expect(on.state).toEqual(off.state);
    expect(on.first).toEqual(off.first);
    expect(on.nextId).toBe(off.nextId);
    expect(on.rngCalls).toBe(off.rngCalls);
    expect(on.log.records().length).toBeGreaterThan(0);
    expect(off.log.records()).toEqual([]);
    expect(on.log.worldId).not.toBe(off.log.worldId);
    const ids = new Set(on.state.map(item => item.id));
    expect(on.log.records().every(r => !ids.has(r.id))).toBe(true);
  });
});
