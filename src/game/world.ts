import { executeEvent, matches, type EventContext, type EventDefinition, type EventResult } from './events';
import { isAdjacent, resolve, type EntityState, type GameState } from './state';
import { audited, auditSource, note, type AuditScope } from './audit';
import { selectInteraction } from './interactions';
import { dispatchFacts } from './reactions';
// Reactions depend on world state, never on the identifier of the last event.
export function react(world: GameState, definitions = world.eventDefinitions, scope?: AuditScope, random = Math.random): EventResult[] {
  return world.definitions.executing(() => audited(auditSource(world, scope), { category: 'legacy', data: { source: 'missionPolling' } }, current => {
  const results: EventResult[] = [];
  for (const mission of world.missions) {
    audited(current, { category: 'reaction', instanceIds: [mission.id], definitionIds: [mission.definitionId], data: { source: 'legacyMission' } }, missionScope => {
    const definition = world.missionDefinitions.find(item => item.id === mission.definitionId);
    if (!definition) throw new Error(`Unknown mission definition: ${mission.definitionId}`);
    const target = resolve(world, mission.contractorId, 'character');
    const actor = resolve(world, mission.executorId, 'character');
    resolve(world, mission.targetId, 'character');
    if (!target.offer) throw new Error('Missing contractor offer');
    for (const id of definition.reactions) {
      const event = definitions[id];
      if (!event) throw new Error(`Unknown reaction event: ${id}`);
      const context = { world, contractorId: target.id, offer: target.offer, missionId: mission.id };
      note(missionScope, { category: 'reaction', status: 'considered', definitionIds: [event.id], instanceIds: [mission.id] });
      if ((event.when ?? []).every(condition => matches(condition, actor, target, context, undefined, missionScope))) {
        const result = executeEvent(event, actor, target, random, context, missionScope);
        if (result.executed) results.push(result);
      } else {
        note(missionScope, { category: 'reaction', status: 'rejected', instanceIds: [mission.id], definitionIds: [event.id] });
      }
    }
    });
  }
  return results;
  }));
}

export function interact(world: GameState, target: EntityState, random = Math.random, definitions = world.eventDefinitions, scope?: AuditScope, actor = world.player): EventResult {
  return world.definitions.executing(() => audited(auditSource(world, scope), { category: 'interaction', instanceIds: [actor.id, target.id] }, current => {
  const selected = selectInteraction(world, target, definitions, current, actor);
  if (!selected) {
    note(current, { category: 'interaction', status: 'rejected', instanceIds: [actor.id, target.id], data: { reason: 'noApplicableEvent' } });
    return { executed: false, reason: 'noApplicableEvent', message: 'Nenhuma interação disponível.' };
  }
  const result = executeCommand(world, selected.event, actor, target, random, selected.context, current);
  world.audit?.remember(result, current);
  return result;
  }, result => result.executed ? 'accepted' : 'rejected'));
}

// Commands may come from any registered character. The UI is one caller.
export function executeCommand(world: GameState, event: EventDefinition, actor: EntityState, target: EntityState, random = Math.random, context?: EventContext, scope?: AuditScope): EventResult {
  return world.definitions.executing(() => audited(auditSource(world, scope), { category: 'command', instanceIds: [actor.id, target.id], definitionIds: [event.id], data: { stage: 'requested' } }, current => {
  if (resolve(world, actor.id, 'character') !== actor || resolve(world, target.id, 'character') !== target) throw new Error('Unregistered command participant');
  if (context && context.world !== world) throw new Error('Command context belongs to another world');
  const result = executeEvent(event, actor, target, random, context, current);
  if (result.executed) dispatchFacts(world, result.facts, world.reactionDefinitions, current);
  world.audit?.remember(result, current);
  return result;
  }, result => result.executed ? 'accepted' : 'rejected'));
}

export function adjacentEntities(world: GameState): EntityState[] {
  return world.entities.filter(entity => entity.hp > 0 && isAdjacent(world.player, entity));
}
