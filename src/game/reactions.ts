import { applyOperations, matches, type Fact, type ReactionDefinition } from './events';
import { resolve, type GameState } from './state';

// One synchronous pass; reactions cannot emit further facts. Subscriptions are
// indexed by type, with relation instances as the only source in this MVP.
export function dispatchFacts(world: GameState, facts: readonly Fact[], definitions: Readonly<Record<string, ReactionDefinition>> = world.reactionDefinitions): number {
  let applied = 0;
  for (const fact of facts) {
    if (world.processedFacts.has(fact)) continue;
    const actor = resolve(world, fact.actorId, 'character');
    const target = resolve(world, fact.targetId, 'character');
    world.processedFacts.add(fact);
    const visited = new Set<string>();
    for (const subscription of world.factSubscriptions[fact.type] ?? []) {
      const key = JSON.stringify([subscription.relationId, subscription.ruleId]);
      if (visited.has(key)) continue;
      visited.add(key);
      const rule = definitions[subscription.ruleId];
      if (!rule) throw new Error(`Unknown reaction rule: ${subscription.ruleId}`);
      if (rule.on !== fact.type) continue;
      resolve(world, subscription.relationId, 'relation');
      const context = { world, fact, relationId: subscription.relationId };
      if (rule.when.every(condition => matches(condition, actor, target, undefined, context))) {
        applyOperations(rule.operations, actor, target, undefined, context);
        applied++;
      }
    }
  }
  return applied;
}
