import { applyOperations, matches, type Fact, type ReactionDefinition } from './events.js';
import { resolve, type GameState } from './state.js';
import { audited, auditSource, note, type AuditScope } from './audit.js';

// One synchronous pass; reactions cannot emit further facts. Subscriptions are
// indexed by type, with relation instances as the only source in this MVP.
export function dispatchFacts(world: GameState, facts: readonly Fact[], definitions: Readonly<Record<string, ReactionDefinition>> = world.reactionDefinitions, scope?: AuditScope): number {
  let applied = 0;
  for (const fact of facts) {
    auditSource(world, scope);
    const cause = world.audit?.causeOf(fact) ?? scope;
    audited(cause ?? world.audit, { category: 'dispatch', instanceIds: [fact.actorId, fact.targetId], data: fact }, current => {
    if (world.processedFacts.has(fact)) {
      note(current, { category: 'dispatch', status: 'skipped', data: { reason: 'alreadyProcessed' } });
      return;
    }
    const actor = resolve(world, fact.actorId, 'character');
    const target = resolve(world, fact.targetId, 'character');
    world.processedFacts.add(fact);
    note(current, { category: 'fact', status: 'consumed', instanceIds: [actor.id, target.id], data: { fact, auxiliary: 'processedFacts' } });
    const visited = new Set<string>();
    for (const subscription of world.factSubscriptions[fact.type] ?? []) {
      const key = JSON.stringify([subscription.relationId, subscription.ruleId]);
      if (visited.has(key)) continue;
      visited.add(key);
      const rule = definitions[subscription.ruleId];
      if (!rule) throw new Error(`Unknown reaction rule: ${subscription.ruleId}`);
      if (rule.on !== fact.type) continue;
      audited(current, { category: 'reaction', instanceIds: [subscription.relationId, actor.id, target.id], definitionIds: [rule.id], data: { source: 'relationRule' } }, ruleScope => {
      const relation = resolve(world, subscription.relationId, 'relation');
      note(ruleScope, { category: 'reaction', status: 'considered', instanceIds: [relation.id, relation.sourceId, relation.targetId, actor.id, target.id], definitionIds: [rule.id, relation.definitionId], data: { sourceId: relation.sourceId, targetId: relation.targetId } });
      const context = { world, fact, relationId: subscription.relationId };
      if (rule.when.every(condition => matches(condition, actor, target, undefined, context, ruleScope))) {
        note(ruleScope, { category: 'reaction', status: 'accepted', definitionIds: [rule.id], instanceIds: [subscription.relationId] });
        applyOperations(rule.operations, actor, target, undefined, context, ruleScope);
        applied++;
        return true;
      }
      return false;
      }, accepted => accepted ? 'applied' : 'rejected');
    }
    });
  }
  return applied;
}
