import { createEntity, isAdjacent, type EntityState, type GameState, type MissionDefinition, type MissionStatus } from './state';

type BasicCondition = 'actorAlive' | 'targetAlive' | 'adjacent' | 'targetAttackable';
type Value = number | { source: 'attribute'; key: string } | { source: 'relation'; faction: 'faction' | 'opponent' } | { source: 'missionTargetHp' };
export type Condition = BasicCondition
  | { type: 'compare'; left: Value; operator: 'gte' | 'lte'; right: Value; message?: string }
  | { type: 'missionStatus'; statuses: MissionStatus[]; message?: string }
  | { type: 'noActiveMission'; message?: string };
export type Operation =
  | { type: 'damage'; amount: Value }
  | { type: 'relation'; faction: 'faction' | 'opponent'; amount: number; min: number; max: number }
  | { type: 'attributeReward'; key: string; value: Value; bands: { min: number; max: number; amount: number }[]; max: number }
  | { type: 'missionStatus'; status: MissionStatus }
  | { type: 'spawnTarget' };
export interface Feedback { color: string; durationMs: number; message: string }
export interface EventDefinition {
  id: string;
  when?: readonly Condition[];
  conditions: readonly Condition[];
  outcomes: readonly {
    id: string;
    weight: number;
    operations: readonly Operation[];
    feedback: Feedback;
  }[];
}
export type EventResult =
  | { executed: false; reason: BasicCondition | 'compare' | 'missionStatus' | 'noActiveMission'; message?: string }
  | { executed: true; eventId: string; outcomeId: string; damage: number; targetHp: number; killed: boolean; feedback: Feedback };

export interface EventContext { world: GameState; mission: MissionDefinition }
function requireContext(context?: EventContext): EventContext {
  if (!context) throw new Error('This rule requires world and mission context');
  return context;
}
function read(value: Value, actor: EntityState, context?: EventContext): number {
  if (typeof value === 'number') return value;
  if (value.source === 'attribute') return actor.attributes[value.key] ?? 0;
  const { world, mission } = requireContext(context);
  if (value.source === 'relation') return world.relations[mission[value.faction]] ?? 0;
  return world.missions[mission.id].target?.hp ?? Infinity;
}
export function matches(condition: Condition, actor: EntityState, target: EntityState, context?: EventContext): boolean {
  if (typeof condition === 'string') {
    switch (condition) {
      case 'actorAlive': return actor.hp > 0;
      case 'targetAlive': return target.hp > 0;
      case 'adjacent': return isAdjacent(actor, target);
      case 'targetAttackable': return target.definition.attackable !== false;
    }
  }
  if (condition.type === 'compare') {
    const left = read(condition.left, actor, context);
    const right = read(condition.right, actor, context);
    return condition.operator === 'gte' ? left >= right : left <= right;
  }
  const { world, mission } = requireContext(context);
  if (condition.type === 'missionStatus') return condition.statuses.includes(world.missions[mission.id].status);
  return Object.values(world.missions).every(state => state.status !== 'active' && state.status !== 'ready');
}
function apply(operation: Operation, actor: EntityState, target: EntityState, context?: EventContext) {
  if (operation.type === 'damage') {
    target.hp = Math.max(0, target.hp - Math.max(0, read(operation.amount, actor, context)));
    return;
  }
  if (operation.type === 'attributeReward') {
    const value = read(operation.value, actor, context);
    const reward = operation.bands.find(band => value >= band.min && value <= band.max)?.amount ?? 0;
    actor.attributes[operation.key] = Math.min(operation.max, (actor.attributes[operation.key] ?? 0) + reward);
    return;
  }
  const { world, mission } = requireContext(context);
  switch (operation.type) {
    case 'relation': {
      const faction = mission[operation.faction];
      world.relations[faction] = Math.max(operation.min, Math.min(operation.max, (world.relations[faction] ?? 0) + operation.amount));
      break;
    }
    case 'missionStatus': world.missions[mission.id].status = operation.status; break;
    case 'spawnTarget': {
      const previous = world.missions[mission.id].target;
      world.entities = world.entities.filter(entity => entity !== previous);
      const entity = createEntity(world.objectDefinitions[mission.target], mission.spawn);
      world.missions[mission.id].target = entity;
      world.entities.push(entity);
      break;
    }
  }
}

// No rendering dependency. Inject randomness for reproducible tests.
export function executeEvent(event: EventDefinition, actor: EntityState, target: EntityState, random: () => number = Math.random, context?: EventContext): EventResult {
  for (const condition of [...(event.when ?? []), ...event.conditions]) {
    if (!matches(condition, actor, target, context)) {
      return typeof condition === 'string' ? { executed: false, reason: condition }
        : { executed: false, reason: condition.type, message: condition.message };
    }
  }
  const total = event.outcomes.reduce((sum, outcome) => sum + outcome.weight, 0);
  if (!event.outcomes.length || !Number.isFinite(total) || event.outcomes.some(outcome => !Number.isFinite(outcome.weight) || outcome.weight <= 0)) {
    throw new Error(`Invalid outcomes for event ${event.id}`);
  }
  let roll = random() * total;
  const outcome = event.outcomes.find(candidate => (roll -= candidate.weight) < 0) ?? event.outcomes[event.outcomes.length - 1];
  const before = target.hp;
  for (const operation of outcome.operations) apply(operation, actor, target, context);
  return {
    executed: true, eventId: event.id, outcomeId: outcome.id,
    damage: before - target.hp, targetHp: target.hp, killed: before > 0 && target.hp === 0,
    feedback: { ...outcome.feedback },
  };
}
