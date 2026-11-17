import { matches, type EventContext, type EventDefinition } from './events';
import { pendingMission, resolve, type EntityState, type GameState, type InteractionBinding } from './state';

// The only context adapter currently needed. Association is explicit, never
// inferred from the target's role, faction, or a mission's representative.
function resolveContext(world: GameState, target: EntityState, binding: InteractionBinding): EventContext | undefined {
  if (!binding.context) return undefined;
  resolve(world, target.id, 'character');
  if (!target.offer) throw new Error('Missing interaction offer');
  if (!world.missionDefinitions.some(item => item.id === target.offer!.mission)) throw new Error(`Unknown interaction mission: ${target.offer.mission}`);
  const mission = pendingMission(world, world.player.id, target.id);
  return { world, contractorId: target.id, offer: target.offer, missionId: mission?.id };
}

export interface SelectedInteraction { event: EventDefinition; context?: EventContext }

// First applicable binding wins. Validation belongs to executeEvent, so a
// selected event's refusal must not fall through to another candidate.
export function selectInteraction(world: GameState, target: EntityState, definitions: Readonly<Record<string, EventDefinition>>): SelectedInteraction | undefined {
  if (resolve(world, target.id, 'character') !== target) throw new Error('Target is not the registered instance');
  for (const binding of target.interactions ?? target.definition.interactions ?? []) {
    const event = definitions[binding.event];
    if (!event) throw new Error(`Unknown interaction event: ${binding.event}`);
    const context = resolveContext(world, target, binding);
    if ((event.when ?? []).every(condition => matches(condition, world.player, target, context))) {
      return { event, context };
    }
  }
  return undefined;
}
