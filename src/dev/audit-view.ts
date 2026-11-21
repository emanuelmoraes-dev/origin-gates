import type { AuditCategory, AuditRecord } from '../game/audit';

export interface AuditFilter {
  category?: AuditCategory | '';
  instanceQuery?: string;
  traceQuery?: string;
  instanceMode?: 'trace' | 'direct';
}

/** Trace membership is a query result; original instanceIds are never extended. */
export function filterAuditRecords(records: readonly AuditRecord[], filter: AuditFilter): readonly AuditRecord[] {
  const instance = filter.instanceQuery?.trim() ?? '';
  const trace = filter.traceQuery?.trim() ?? '';
  const directMatch = (record: AuditRecord) => record.instanceIds.some(id => id.includes(instance));
  const relatedTraces = new Set(instance ? records.filter(directMatch).map(record => record.traceId) : []);
  return [...records].sort((a, b) => a.sequence - b.sequence).filter(record =>
    (!filter.category || record.category === filter.category)
    && (!trace || record.traceId === trace)
    && (!instance || (filter.instanceMode === 'direct' ? directMatch(record) : relatedTraces.has(record.traceId))));
}

export type CausalIssue = 'missingParent' | 'crossTraceParent' | 'cycle' | 'duplicateId';
export interface CausalNode {
  readonly record: AuditRecord;
  readonly children: CausalNode[];
  readonly context: boolean;
  issue?: CausalIssue;
}
export interface CausalTrace { readonly traceId: string; readonly roots: CausalNode[]; readonly firstSequence: number }
export interface CausalTree {
  readonly traces: readonly CausalTrace[];
  readonly issues: readonly { id: string; parentId?: string; reason: CausalIssue }[];
}

/** One node per record, including start/point/end. Invalid edges are displayed,
 * never followed indefinitely or replaced with chronological guesses. */
export function buildCausalTree(records: readonly AuditRecord[], matchingIds?: ReadonlySet<string>): CausalTree {
  const ordered = [...records].sort((a, b) => a.sequence - b.sequence);
  const nodes: CausalNode[] = [];
  const byId = new Map<string, CausalNode>();
  for (const record of ordered) {
    const node: CausalNode = { record, children: [], context: matchingIds ? !matchingIds.has(record.id) : false };
    if (byId.has(record.id)) node.issue = 'duplicateId';
    else byId.set(record.id, node);
    nodes.push(node);
  }
  const parents = new Map<CausalNode, CausalNode>();
  for (const node of nodes) {
    if (node.issue || !node.record.parentId) continue;
    const parent = byId.get(node.record.parentId);
    if (!parent) node.issue = 'missingParent';
    else if (parent.record.traceId !== node.record.traceId || parent.record.worldId !== node.record.worldId) node.issue = 'crossTraceParent';
    else parents.set(node, parent);
  }
  // Iterative walk keeps deep valid chains and malformed cycles bounded.
  const done = new Set<CausalNode>();
  for (const node of nodes) {
    const path: CausalNode[] = [];
    const positions = new Map<CausalNode, number>();
    let current: CausalNode | undefined = node;
    while (current && !done.has(current)) {
      const cycleStart = positions.get(current);
      if (cycleStart !== undefined) {
        const root = path.slice(cycleStart).reduce((first, item) => item.record.sequence < first.record.sequence ? item : first);
        root.issue = 'cycle';
        parents.delete(root);
        break;
      }
      positions.set(current, path.length);
      path.push(current);
      current = parents.get(current);
    }
    for (const item of path) done.add(item);
  }
  const groups = new Map<string, CausalTrace>();
  for (const node of nodes) {
    let group = groups.get(node.record.traceId);
    if (!group) {
      group = { traceId: node.record.traceId, roots: [], firstSequence: node.record.sequence };
      groups.set(node.record.traceId, group);
    }
    const parent = parents.get(node);
    if (parent) parent.children.push(node);
    else group.roots.push(node);
  }
  const issues = nodes.filter(node => node.issue).map(node => ({ id: node.record.id, parentId: node.record.parentId, reason: node.issue! }));
  if (matchingIds) {
    // Retain matching records plus their actual ancestors, not siblings or
    // invented parents. Postorder pruning is iterative for long histories.
    const keep = new Set<CausalNode>();
    for (const group of groups.values()) {
      const stack = group.roots.map(node => ({ node, visited: false }));
      while (stack.length) {
        const { node, visited } = stack.pop()!;
        if (!visited) {
          stack.push({ node, visited: true });
          for (const child of node.children) stack.push({ node: child, visited: false });
        } else {
          const children = node.children.filter(child => keep.has(child));
          node.children.splice(0, node.children.length, ...children);
          if (!node.context || children.length) keep.add(node);
        }
      }
      const roots = group.roots.filter(node => keep.has(node));
      group.roots.splice(0, group.roots.length, ...roots);
    }
  }
  return { traces: [...groups.values()].filter(group => group.roots.length), issues };
}
