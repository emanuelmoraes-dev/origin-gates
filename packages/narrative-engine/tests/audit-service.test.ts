import { describe, expect, it } from 'vitest';
import { AuditLog, audited, note, snapshot, type AuditRecord } from '../src/audit.js';
import { createInspector } from '../src/inspection.js';
import { createIdentityStore, type EntityState, type FactionState, type MissionState, type RelationState } from '../src/state.js';

async function flushObservers() {
  // Delivery runs in one microtask; rejected async callbacks are handled in
  // another. No timers or narrative execution are needed for service tests.
  await Promise.resolve();
  await Promise.resolve();
}

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}

describe('audit service', () => {
  it('isolates hostile thrown objects and rejected thenables without starving other consumers', async () => {
    const log = new AuditLog();
    let healthy = 0;
    log.subscribe(() => { throw { toString() { throw new Error('cannot stringify'); } }; });
    log.subscribe(() => ({ then(_resolve: unknown, reject: (error: Error) => void) { reject(new Error('thenable failure')); } }));
    log.subscribe(() => { healthy++; });
    log.record({ category: 'world' });
    await flushObservers();
    await flushObservers();
    expect(healthy).toBe(1);
    expect(log.stats().observerErrors).toBe(2);
    expect(log.stats().lastObserverError).toBe('thenable failure');
  });

  it('does not deliver an old record to a new subscription reusing the same callback', async () => {
    const log = new AuditLog();
    const received: number[] = [];
    const callback = (record: AuditRecord) => { received.push(record.sequence); };
    const unsubscribe = log.subscribe(callback);
    log.record({ category: 'world' });
    unsubscribe();
    log.subscribe(callback);
    log.record({ category: 'world' });
    await flushObservers();
    expect(received).toEqual([2]);
  });

  it('retains chronological records in a bounded buffer and keeps occurrence sequence after clearing', () => {
    const log = new AuditLog({ capacity: 3 });
    const scope = log.scope();
    for (let value = 1; value <= 5; value++) log.record({ category: 'world', data: { value } }, scope);
    const retained = log.records();
    expect(retained.map(record => record.sequence)).toEqual([3, 4, 5]);
    expect(new Set(retained.map(record => record.id)).size).toBe(3);
    expect(log.stats()).toMatchObject({ retained: 3, discarded: 2, capacity: 3, sequence: 5 });
    expect(Object.isFrozen(retained)).toBe(true);
    log.clear();
    expect(log.records()).toEqual([]);
    expect(log.stats()).toMatchObject({ retained: 0, discarded: 0, sequence: 5 });
    const next = log.record({ category: 'world' });
    expect(next?.sequence).toBe(6);
    expect(retained.map(record => record.sequence)).toEqual([3, 4, 5]);
  });

  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid history capacity %s', capacity => {
    expect(() => new AuditLog({ capacity })).toThrow('positive integer');
  });

  it('keeps world namespaces, traces, buffers and subscriptions independent', async () => {
    const a = new AuditLog();
    const b = new AuditLog();
    const received: AuditRecord[] = [];
    a.subscribe(record => { received.push(record); });
    const scope = a.scope()!;
    const first = a.record({ category: 'world' }, scope)!;
    const second = b.record({ category: 'world' })!;
    expect(a.worldId).not.toBe(b.worldId);
    expect(first.id).not.toBe(second.id);
    expect(first.traceId).not.toBe(second.traceId);
    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(1);
    expect(() => b.record({ category: 'command' }, scope)).toThrow('another world');
    await flushObservers();
    expect(received).toEqual([first]);
    expect(b.records()).toEqual([second]);
    a.clear();
    expect(b.records()).toEqual([second]);
  });

  it('distributes all new records asynchronously even when retention discards or clears them', async () => {
    const log = new AuditLog({ capacity: 1 });
    const received: number[] = [];
    log.subscribe(record => { received.push(record.sequence); });
    log.record({ category: 'world' });
    log.record({ category: 'world' });
    expect(received).toEqual([]);
    expect(log.records().map(record => record.sequence)).toEqual([2]);
    log.clear();
    await flushObservers();
    expect(received).toEqual([1, 2]);
    expect(log.records()).toEqual([]);
  });

  it('unsubscribes before queued delivery and does not replay history to new subscribers', async () => {
    const log = new AuditLog();
    const received: number[] = [];
    log.record({ category: 'world' });
    const unsubscribe = log.subscribe(record => { received.push(record.sequence); });
    log.record({ category: 'world' });
    unsubscribe();
    unsubscribe();
    await flushObservers();
    expect(received).toEqual([]);
    const cancel = log.subscribe(record => { received.push(record.sequence); });
    log.record({ category: 'world' });
    await flushObservers();
    expect(received).toEqual([3]);
    cancel();
    log.record({ category: 'world' });
    await flushObservers();
    expect(received).toEqual([3]);
  });

  it('isolates sync and async consumer failures while preserving other observers and the audited result', async () => {
    const log = new AuditLog();
    const received: string[] = [];
    log.subscribe(() => { throw new Error('sync panel failure'); });
    log.subscribe(async () => { throw new Error('async panel failure'); });
    log.subscribe(record => { received.push(record.status); });
    let bodyCalls = 0;
    const result = audited(log, { category: 'command' }, () => { bodyCalls++; return 17; });
    expect(result).toBe(17);
    expect(bodyCalls).toBe(1);
    expect(received).toEqual([]);
    await flushObservers();
    expect(received).toEqual(['started', 'completed']);
    expect(log.stats().observerErrors).toBe(4);
    expect(log.stats().lastObserverError).toBe('async panel failure');
    expect(log.records().some(record => record.category === 'failure')).toBe(false);
  });

  it('captures detached immutable payloads, participant arrays, undefined and non-finite values', () => {
    const log = new AuditLog();
    const instanceIds = ['entity_000001'];
    const definitionIds = ['person'];
    const original = { nested: { intensity: 50 }, values: [1, undefined], missing: undefined, infinite: Infinity };
    const record = log.record({ category: 'mutation', instanceIds, definitionIds, data: original })!;
    original.nested.intensity = 70;
    original.values[0] = 99;
    instanceIds.push('entity_000002');
    definitionIds[0] = 'other';
    expect(record.data).toEqual({ nested: { intensity: 50 }, values: [1, { $undefined: true }], missing: { $undefined: true }, infinite: { $number: 'Infinity' } });
    expect(record.instanceIds).toEqual(['entity_000001']);
    expect(record.definitionIds).toEqual(['person']);
    expectDeeplyFrozen(record);
    expect(() => { (record.data as { nested: { intensity: number } }).nested.intensity = 0; }).toThrow();
    expect(JSON.parse(JSON.stringify(record)).data.nested.intensity).toBe(50);
  });

  it('provides serializable frozen snapshots for cycles, repeated objects and undefined roots', () => {
    const child = { value: 4 };
    const cycle: { self?: unknown; a: typeof child; b: typeof child } = { a: child, b: child };
    cycle.self = cycle;
    const captured = snapshot(cycle);
    expect(captured).toEqual({ a: { value: 4 }, b: { value: 4 }, self: '[Circular]' });
    expectDeeplyFrozen(captured);
    expectDeeplyFrozen(snapshot(undefined));
    expect(() => JSON.stringify(captured)).not.toThrow();
    child.value = 99;
    expect(captured).toEqual({ a: { value: 4 }, b: { value: 4 }, self: '[Circular]' });
  });

  it('preserves parent occurrence IDs and one trace through nested scopes without reexecuting bodies', () => {
    const log = new AuditLog();
    const root = log.scope()!;
    let operations = 0;
    const result = audited(root, { category: 'command', instanceIds: ['entity_000001'] }, commandScope => {
      note(commandScope, { category: 'selection', definitionIds: ['attack'] });
      return audited(commandScope, { category: 'operation' }, operationScope => {
        operations++;
        note(operationScope, { category: 'mutation', data: { before: 100, after: 90 } });
        return true;
      });
    }, accepted => accepted ? 'accepted' : 'refused');
    expect(result).toBe(true);
    expect(operations).toBe(1);
    const records = log.records();
    expect(records.map(record => [record.category, record.phase])).toEqual([
      ['command', 'start'], ['selection', 'point'], ['operation', 'start'],
      ['mutation', 'point'], ['operation', 'end'], ['command', 'end'],
    ]);
    expect(records.every(record => record.traceId === root.traceId)).toBe(true);
    expect(records[1].parentId).toBe(records[0].id);
    expect(records[2].parentId).toBe(records[0].id);
    expect(records[3].parentId).toBe(records[2].id);
    expect(records[4].parentId).toBe(records[2].id);
    expect(records[5].parentId).toBe(records[0].id);
    expect(records[5].status).toBe('accepted');
    expect(records[0].id).not.toBe('entity_000001');
  });

  it('records failure and preserves the original thrown object and already-applied work', () => {
    const log = new AuditLog();
    const failure = new Error('operation failed');
    let hp = 100;
    let caught: unknown;
    try {
      audited(log, { category: 'command' }, scope => {
        const before = hp;
        hp = 90;
        note(scope, { category: 'mutation', data: { property: 'hp', before, after: hp } });
        throw failure;
      });
    } catch (error) { caught = error; }
    expect(caught).toBe(failure);
    expect(hp).toBe(90);
    expect(log.records().map(record => record.category)).toEqual(['command', 'mutation', 'failure', 'command']);
    expect(log.records()[2]).toMatchObject({ status: 'failed', data: { source: 'command', message: failure.message, stateReverted: false } });
    expect(log.records()[3]).toMatchObject({ phase: 'end', status: 'failed' });
    try {
      audited(undefined, { category: 'operation' }, () => { throw failure; });
    } catch (error) { expect(error).toBe(failure); }
  });

  it('disabled auditing preserves body results without storage or consumer calls', async () => {
    const log = new AuditLog({ enabled: false });
    let received = 0;
    log.subscribe(() => { received++; });
    expect(log.scope()).toBeUndefined();
    expect(log.record({ category: 'world' })).toBeUndefined();
    expect(audited(log, { category: 'command' }, scope => {
      expect(scope).toBeUndefined();
      return 42;
    })).toBe(42);
    await flushObservers();
    expect(log.records()).toEqual([]);
    expect(log.stats()).toMatchObject({ enabled: false, sequence: 0, retained: 0 });
    expect(received).toBe(0);
  });
});

describe('read-only instance inspection', () => {
  function setup() {
    const store = createIdentityStore();
    const character: EntityState = {
      id: 'entity_000001', definitionId: 'person', kind: 'character',
      definition: { id: 'person', name: 'Pessoa', maxHp: 100, color: '#ffffff' },
      hp: 100, position: { x: 2, y: 3 }, attributes: { damage: 10 }, references: { hostileTo: 'entity_000002' },
    };
    const faction: FactionState = { id: 'entity_000002', definitionId: 'group', kind: 'faction', name: 'Grupo' };
    const relation: RelationState = { id: 'entity_000003', definitionId: 'reputation', kind: 'relation', sourceId: faction.id, targetId: character.id, intensity: 50 };
    const mission: MissionState = { id: 'entity_000004', definitionId: 'eliminateTarget', kind: 'mission', executorId: character.id, contractorId: character.id, targetId: character.id, opponentId: faction.id, name: 'Teste', status: 'active' };
    for (const instance of [character, faction, relation, mission]) store.instances[instance.id] = instance;
    return { store, character, faction, relation, mission, inspector: createInspector(store) };
  }

  it('lists and filters kinds and exposes concrete references, definitions and state without model objects', () => {
    const { store, character, faction, relation, mission, inspector } = setup();
    const before = JSON.stringify(store);
    expect(inspector.list()).toHaveLength(4);
    expect(inspector.list('character').map(item => item.id)).toEqual([character.id]);
    expect(inspector.list('faction').map(item => item.id)).toEqual([faction.id]);
    expect(inspector.find(character.id)).toMatchObject({ id: character.id, definitionId: 'person', properties: { hp: 100, references: { hostileTo: faction.id } } });
    expect(inspector.find(character.id)?.properties).not.toHaveProperty('definition');
    expect(inspector.find(relation.id)).toMatchObject({ definitionId: 'reputation', properties: { sourceId: faction.id, targetId: character.id, intensity: 50 } });
    expect(inspector.find(mission.id)).toMatchObject({ properties: { executorId: character.id, status: 'active' } });
    expect(inspector.find('missing')).toBeUndefined();
    expect(inspector.find('toString')).toBeUndefined();
    expect(JSON.stringify(store)).toBe(before);
  });

  it('returns frozen detached snapshots while later queries reflect current canonical state', () => {
    const { character, relation, mission, inspector } = setup();
    const list = inspector.list();
    const oldCharacter = inspector.find(character.id)!;
    const oldRelation = inspector.find(relation.id)!;
    const oldMission = inspector.find(mission.id)!;
    expectDeeplyFrozen(list);
    expectDeeplyFrozen(oldCharacter);
    expect(() => { (oldCharacter.properties as { position: { x: number } }).position.x = 99; }).toThrow();
    expect(character.position.x).toBe(2);
    character.hp = 80;
    character.position.x = 4;
    character.references.hostileTo = character.id;
    relation.intensity = 70;
    mission.status = 'ready';
    expect(oldCharacter.properties).toMatchObject({ hp: 100, position: { x: 2 }, references: { hostileTo: 'entity_000002' } });
    expect(oldRelation.properties).toMatchObject({ intensity: 50 });
    expect(oldMission.properties).toMatchObject({ status: 'active' });
    expect(inspector.find(character.id)?.properties).toMatchObject({ hp: 80, position: { x: 4 }, references: { hostileTo: character.id } });
    expect(inspector.find(relation.id)?.properties).toMatchObject({ intensity: 70 });
    expect(inspector.find(mission.id)?.properties).toMatchObject({ status: 'ready' });
    expect(() => JSON.stringify(list)).not.toThrow();
  });
});
