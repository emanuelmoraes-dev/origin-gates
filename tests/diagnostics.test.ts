import { describe, expect, it } from 'vitest';
import type { AuditRecord } from '../src/game/audit';
import { createInspector } from '../src/game/inspection';
import { createWorld, interact } from '../src/game/world';
import { buildCausalTree, filterAuditRecords, type CausalNode, type CausalTree } from '../src/dev/audit-view';
import { createDiagnosticExport, diagnosticFilename } from '../src/dev/diagnostics';

const now = new Date('2026-11-21T15:00:00.000Z');
function record(id: string, sequence: number, patch: Partial<AuditRecord> = {}): AuditRecord {
  return Object.freeze({ id, sequence, worldId: 'world-test', traceId: 'trace-1', category: 'command', phase: 'point', status: 'completed', instanceIds: Object.freeze([]), definitionIds: Object.freeze([]), data: null, ...patch });
}
function flattened(tree: CausalTree): CausalNode[] {
  const nodes: CausalNode[] = [];
  const stack = tree.traces.flatMap(t => t.roots).reverse();
  while (stack.length) { const node = stack.pop()!; nodes.push(node); stack.push(...node.children.slice().reverse()); }
  return nodes;
}

describe('diagnostic export schema 1', () => {
  it('exports the entire retained log, exact identities, causal links and detached current instances', () => {
    const world = createWorld('social');
    const result = interact(world, world.entities[0], () => 0.5);
    expect(result.executed).toBe(true);
    const stateBefore = createInspector(world).list();
    const statsBefore = world.audit!.stats();
    const historyBefore = world.audit!.records();
    const selected = filterAuditRecords(historyBefore, { category: 'mutation', instanceQuery: world.entities[1].id });
    expect(selected.length).toBeLessThan(historyBefore.length);
    const exported = createDiagnosticExport(world, now);
    expect(exported).toMatchObject({ schemaVersion: 1, scenarioId: 'social', worldId: world.audit!.worldId, exportedAt: now.toISOString() });
    expect(exported.audit.records).toEqual(historyBefore);
    expect(exported.audit.stats).toEqual(statsBefore);
    expect(exported.instances).toEqual(stateBefore);
    expect(exported.audit.records.map(r => r.sequence)).toEqual([...exported.audit.records.map(r => r.sequence)].sort((a, b) => a - b));
    expect(exported.audit.records.some(r => r.category === 'mutation' && r.instanceIds.includes(world.entities[1].id))).toBe(true);
    const roundtrip = JSON.parse(JSON.stringify(exported));
    expect(roundtrip).toEqual(JSON.parse(JSON.stringify({ ...exported, audit: { stats: statsBefore, records: historyBefore } })));
    expect(Object.keys(roundtrip.audit).sort()).toEqual(['records', 'stats']);
    expect(JSON.stringify(exported)).not.toMatch(/"(listeners|causes|processedFacts|factSubscriptions|buffer)":/);
    expect(createInspector(world).list()).toEqual(stateBefore);
    expect(world.audit!.stats()).toEqual(statsBefore);
    expect(world.audit!.records()).toEqual(historyBefore);
    world.entities[1].references.hostileTo = 'external-change';
    expect(exported.instances.find(i => i.id === world.entities[1].id)?.properties).toMatchObject({ references: { hostileTo: world.player.id } });
    expect(() => { (exported.instances[0].properties as { hp: number }).hp = -1; }).toThrow();
  });

  it('exports empty retained history without clearing or resetting the valid world', () => {
    const world = createWorld('training');
    world.audit!.clear();
    const before = createInspector(world).list();
    const nextId = world.nextId;
    const sequence = world.audit!.stats().sequence;
    const exported = createDiagnosticExport(world, now);
    expect(exported.audit.records).toEqual([]);
    expect(exported.audit.stats).toMatchObject({ sequence, retained: 0 });
    expect(exported.instances).toEqual(before);
    expect(world.nextId).toBe(nextId);
  });

  it('includes truncation statistics and unchanged missing-parent references', () => {
    const world = createWorld('social', { capacity: 3 });
    interact(world, world.entities[0], () => 0.5);
    const exported = createDiagnosticExport(world, now);
    expect(exported.audit.stats!.discarded).toBeGreaterThan(0);
    expect(exported.audit.records).toHaveLength(3);
    expect(exported.audit.records).toEqual(world.audit!.records());
    expect(buildCausalTree(exported.audit.records).issues.some(i => i.reason === 'missingParent')).toBe(true);
  });

  it('supports explicitly disabled audit without changing the subsystem default', () => {
    const world = createWorld('social', { enabled: false });
    const result = interact(world, world.entities[0], () => 0.5);
    expect(result.executed).toBe(true);
    expect(world.entities[1].references.hostileTo).toBe(world.player.id);
    const exported = createDiagnosticExport(world, now);
    expect(exported.audit.stats).toMatchObject({ enabled: false, retained: 0, sequence: 0 });
    expect(exported.audit.records).toEqual([]);
    expect(exported.instances).toHaveLength(Object.keys(world.instances).length);
    expect(createWorld('training').audit!.stats().enabled).toBe(true);
  });

  it('creates a portable filename identifying project, scenario, world and export', () => {
    const exported = createDiagnosticExport(createWorld('training'), now);
    const filename = diagnosticFilename(exported);
    expect(filename).toContain('origin-gates-training-');
    expect(filename).toContain(exported.worldId);
    expect(filename.endsWith('.json')).toBe(true);
    const hostile = diagnosticFilename({ ...exported, scenarioId: '../bad:<name>/\\\u0000' + 'x'.repeat(300) });
    expect(hostile).not.toMatch(/[<>:"/\\|?*\u0000]/);
    expect(hostile.length).toBeLessThan(255);
  });
});

describe('faithful causal tree construction', () => {
  it('uses explicit parentId, orders roots and siblings by sequence and preserves every phase/ID', () => {
    const root = record('root', 1, { phase: 'start' });
    const end = record('end', 5, { parentId: 'root', phase: 'end' });
    const independent = record('independent', 3); // Same trace does not imply a parent.
    const child = record('child', 2, { parentId: 'root' });
    const grandchild = record('grandchild', 4, { parentId: 'child' });
    const input = [end, grandchild, independent, child, root];
    const before = JSON.stringify(input);
    const tree = buildCausalTree(input);
    expect(tree.traces[0].roots.map(n => n.record.id)).toEqual(['root', 'independent']);
    expect(tree.traces[0].roots[0].children.map(n => n.record.id)).toEqual(['child', 'end']);
    expect(tree.traces[0].roots[0].children[0].children[0].record).toBe(grandchild);
    expect(new Set(flattened(tree).map(n => n.record.id))).toEqual(new Set(input.map(r => r.id)));
    expect(flattened(tree).find(n => n.record.id === 'end')!.record.phase).toBe('end');
    expect(tree.issues).toEqual([]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('groups independent traces by first retained sequence, without chronological or participant inference', () => {
    const a = record('a', 5, { traceId: 'trace-a', instanceIds: ['same-participant'] });
    const b = record('b', 1, { traceId: 'trace-b', instanceIds: ['same-participant'] });
    const c = record('c', 6, { traceId: 'trace-a', parentId: 'a' });
    const tree = buildCausalTree([a, c, b]);
    expect(tree.traces.map(t => t.traceId)).toEqual(['trace-b', 'trace-a']);
    expect(tree.traces[1].roots[0].children[0].record.id).toBe('c');
    expect(tree.traces[0].roots[0].children).toEqual([]);
  });

  it('keeps records with missing parents as labeled partial roots, even after truncation', () => {
    const child = record('retained', 90, { parentId: 'evicted-parent' });
    const end = record('end', 91, { parentId: 'retained', phase: 'end' });
    const tree = buildCausalTree([end, child]);
    expect(tree.traces[0].roots).toHaveLength(1);
    expect(tree.traces[0].roots[0]).toMatchObject({ issue: 'missingParent', record: child });
    expect(tree.traces[0].roots[0].children[0].record).toBe(end);
    expect(child.parentId).toBe('evicted-parent');
  });

  it('does not attach a record to a parent in another trace or world', () => {
    const parent = record('parent', 1);
    const wrongTrace = record('other', 2, { parentId: 'parent', traceId: 'trace-other' });
    const wrongWorld = record('foreign', 3, { parentId: 'parent', worldId: 'foreign-world' });
    const tree = buildCausalTree([parent, wrongTrace, wrongWorld]);
    expect(flattened(tree)).toHaveLength(3);
    expect(tree.issues.map(i => i.reason)).toEqual(['crossTraceParent', 'crossTraceParent']);
    expect(tree.traces[0].roots[0].children).toEqual([]);
  });

  it('breaks self-cycles and longer cycles only in the view without losing records', () => {
    const input = [record('self', 1, { parentId: 'self' }), record('a', 2, { parentId: 'b' }), record('b', 3, { parentId: 'a' }), record('leaf', 4, { parentId: 'b' })];
    const tree = buildCausalTree(input);
    expect(flattened(tree)).toHaveLength(4);
    expect(tree.issues.filter(i => i.reason === 'cycle')).toHaveLength(2);
    expect(input[1].parentId).toBe('b');
    expect(JSON.stringify(tree).length).toBeGreaterThan(0);
  });

  it('keeps duplicate IDs visible and marks unexpected ambiguity', () => {
    const tree = buildCausalTree([record('a', 1), record('a', 2)]);
    expect(flattened(tree)).toHaveLength(2);
    expect(tree.issues[0].reason).toBe('duplicateId');
  });

  it('handles empty and cleared history without retaining stale nodes', () => {
    expect(buildCausalTree([])).toEqual({ traces: [], issues: [] });
    const world = createWorld('training');
    const old = buildCausalTree(world.audit!.records());
    expect(old.traces.length).toBeGreaterThan(0);
    world.audit!.clear();
    expect(buildCausalTree(world.audit!.records())).toEqual({ traces: [], issues: [] });
    expect(old.traces.length).toBeGreaterThan(0);
  });

  it('can process a deep chain without recursive traversal overflow', () => {
    const input = Array.from({ length: 3000 }, (_, i) => record(String(i), i + 1, { parentId: i ? String(i - 1) : undefined }));
    expect(flattened(buildCausalTree(input, new Set(['2999'])))).toHaveLength(3000);
  });
});

describe('contextual queries without invented participants', () => {
  const input = [
    record('root', 1, { instanceIds: ['entity-1'], phase: 'start' }),
    record('operation', 2, { parentId: 'root', category: 'operation' }),
    record('outcome', 3, { parentId: 'root', category: 'outcome' }),
    record('mutation', 4, { parentId: 'operation', category: 'mutation' }),
    record('other-trace', 5, { traceId: 'trace-10', instanceIds: ['entity-2'] }),
  ];

  it('finds an instance-related trace including outcomes without direct participants', () => {
    const found = filterAuditRecords(input, { instanceQuery: 'entity-1' });
    expect(found.map(r => r.id)).toEqual(['root', 'operation', 'outcome', 'mutation']);
    expect(input[2].instanceIds).toEqual([]);
    expect(filterAuditRecords(input, { instanceQuery: 'entity-1', category: 'outcome' }).map(r => r.id)).toEqual(['outcome']);
  });

  it('offers direct participation mode and an exact trace filter', () => {
    expect(filterAuditRecords(input, { instanceQuery: 'entity-1', instanceMode: 'direct' }).map(r => r.id)).toEqual(['root']);
    expect(filterAuditRecords(input, { traceQuery: 'trace-1' }).map(r => r.id)).not.toContain('other-trace');
    expect(filterAuditRecords(input, { traceQuery: 'trace-10' }).map(r => r.id)).toEqual(['other-trace']);
    expect(filterAuditRecords(input, { instanceQuery: 'missing' })).toEqual([]);
  });

  it('keeps only matching nodes and their explicit ancestors in the filtered tree', () => {
    const matches = filterAuditRecords(input, { category: 'mutation', instanceQuery: 'entity-1' });
    const tree = buildCausalTree(input, new Set(matches.map(r => r.id)));
    expect(flattened(tree).map(n => [n.record.id, n.context])).toEqual([['root', true], ['operation', true], ['mutation', false]]);
    expect(tree.issues).toEqual([]);
    expect(buildCausalTree(input, new Set()).traces).toEqual([]);
  });

  it('keeps original selected records accessible across both data views and honest after eviction', () => {
    const selectedId = 'mutation';
    const linear = filterAuditRecords(input, {});
    const tree = buildCausalTree(input);
    expect(linear.find(r => r.id === selectedId)).toBe(flattened(tree).find(n => n.record.id === selectedId)?.record);
    const truncated = input.filter(r => r.id !== selectedId);
    expect(filterAuditRecords(truncated, {}).find(r => r.id === selectedId)).toBeUndefined();
    expect(flattened(buildCausalTree(truncated)).find(n => n.record.id === selectedId)).toBeUndefined();
  });
});
