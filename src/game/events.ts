import { createEntity, identity, isAdjacent, pendingMission, resolve, type EntityState, type GameState, type MissionOffer, type MissionState, type MissionStatus } from './state';

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
  | { executed: false; reason: BasicCondition | 'compare' | 'missionStatus' | 'noActiveMission' | 'noApplicableEvent'; message?: string }
  | { executed: true; eventId: string; outcomeId: string; damage: number; targetHp: number; killed: boolean; feedback: Feedback };

export interface EventContext { world: GameState; contractorId: string; offer: MissionOffer; missionId?: string }
function requireContext(context?: EventContext): EventContext {
  if (!context) throw new Error('This rule requires world and mission context');
  return context;
}
export function contextMission(context: EventContext): MissionState | undefined {
  if (!context.missionId) return undefined;
  const mission = resolve(context.world, context.missionId, 'mission');
  if (mission.contractorId !== context.contractorId) throw new Error('Mission contractor mismatch');
  return mission;
}
function factionId(context: EventContext, role: 'faction' | 'opponent'): string {
  const mission = contextMission(context);
  const contractor = resolve(context.world, context.contractorId, 'character');
  const id = role === 'faction' ? contractor.factionId : mission?.opponentId ?? context.offer.opponentId;
  if (!id) throw new Error('Missing faction reference');
  return resolve(context.world, id, 'faction').id;
}
function read(value: Value, actor: EntityState, context?: EventContext): number {
  if (typeof value === 'number') return value;
  if (value.source === 'attribute') return actor.attributes[value.key] ?? 0;
  const ctx = requireContext(context);
  if (value.source === 'relation') {
    const relation = ctx.world.relations[factionId(ctx, value.faction)];
    if (relation === undefined) throw new Error('Missing player relation');
    return relation;
  }
  const mission = contextMission(ctx);
  if (!mission) throw new Error('Missing mission instance');
  return resolve(ctx.world, mission.targetId, 'character').hp;
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
  const ctx = requireContext(context);
  const mission = contextMission(ctx);
  if (condition.type === 'missionStatus') return condition.statuses.includes(mission?.status ?? 'available');
  return !pendingMission(ctx.world, actor.id, ctx.contractorId);
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
  const ctx = requireContext(context);
  const { world } = ctx;
  switch (operation.type) {
    case 'relation': {
      const faction = factionId(ctx, operation.faction);
      world.relations[faction] = Math.max(operation.min, Math.min(operation.max, read({ source: 'relation', faction: operation.faction }, actor, ctx) + operation.amount));
      break;
    }
    case 'missionStatus': {
      const mission = contextMission(ctx);
      if (!mission || operation.status === 'available') throw new Error('Invalid mission status operation');
      mission.status = operation.status;
      break;
    }
    case 'spawnTarget': {
      if (pendingMission(world, actor.id, ctx.contractorId)) throw new Error('Mission already pending for contractor');
      const definition = world.missionDefinitions.find(item => item.id === ctx.offer.mission);
      const targetDefinition = world.objectDefinitions[ctx.offer.target];
      if (!definition || !targetDefinition) throw new Error('Unknown mission or target definition');
      resolve(world, actor.id, 'character');
      const opponentId = factionId(ctx, 'opponent');
      factionId(ctx, 'faction');
      const entity = createEntity(targetDefinition, ctx.offer.spawn, world);
      entity.factionId = opponentId;
      const mission: MissionState = {
        ...identity(world, definition.id), kind: 'mission', status: definition.initialStatus,
        executorId: actor.id, contractorId: ctx.contractorId, targetId: entity.id,
        opponentId, name: ctx.offer.name,
      };
      world.instances[mission.id] = mission;
      ctx.missionId = mission.id;
      world.entities.push(entity);
      break;
    }
  }
}

// No rendering dependency. Inject randomness for reproducible tests.
export function executeEvent(event: EventDefinition, actor: EntityState, target: EntityState, random: () => number = Math.random, context?: EventContext): EventResult {
  if (context) {
    resolve(context.world, context.contractorId, 'character');
    if (resolve(context.world, actor.id, 'character') !== actor) throw new Error('Actor is not the registered instance');
    if (target.id !== context.contractorId || resolve(context.world, target.id, 'character') !== target) throw new Error('Interaction contractor mismatch');
    const mission = contextMission(context);
    if (mission) {
      if (mission.executorId !== actor.id) throw new Error('Mission executor mismatch');
      resolve(context.world, mission.targetId, 'character');
      resolve(context.world, mission.opponentId, 'faction');
    }
  }
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
