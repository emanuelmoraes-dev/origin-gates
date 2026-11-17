import { matches, type EventContext, type EventDefinition } from './events';
import type { EntityState, GameState, InteractionBinding } from './state';

// The only context adapter currently needed. Association is explicit, never
// inferred from the target's role, faction, or a mission's representative.
function resolveContext(world: GameState, binding: InteractionBinding): EventContext | undefined {
  if (!binding.context) return undefined;
  const mission = world.missionDefinitions.find(item => item.id === binding.context!.mission);
  if (!mission || !world.missions[mission.id]) throw new Error(`Unknown interaction mission: ${binding.context.mission}`);
  return { world, mission };
}

export interface SelectedInteraction { event: EventDefinition; context?: EventContext }

// First applicable binding wins. Validation belongs to executeEvent, so a
// selected event's refusal must not fall through to another candidate.
export function selectInteraction(world: GameState, target: EntityState, definitions: Readonly<Record<string, EventDefinition>>): SelectedInteraction | undefined {
  for (const binding of target.interactions ?? target.definition.interactions ?? []) {
    const event = definitions[binding.event];
    if (!event) throw new Error(`Unknown interaction event: ${binding.event}`);
    const context = resolveContext(world, binding);
    if ((event.when ?? []).every(condition => matches(condition, world.player, target, context))) {
      return { event, context };
    }
  }
  return undefined;
}
