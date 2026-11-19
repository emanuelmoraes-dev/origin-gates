import { createEntity, identity, isAdjacent, pendingMission, resolve, type EntityState, type GameState, type MissionOffer, type MissionState, type MissionStatus } from './state';

type BasicCondition = 'actorAlive' | 'targetAlive' | 'adjacent' | 'targetAttackable';
export type CharacterRef = 'actor' | 'target' | 'relation.source' | 'relation.target';
type Value = number | { source: 'attribute'; key: string } | { source: 'relation'; faction: 'faction' | 'opponent' } | { source: 'missionTargetHp' }
  | { source: 'relationIntensity' } | { source: 'distance'; from: CharacterRef; to: CharacterRef };
export interface Fact { readonly type: string; readonly actorId: string; readonly targetId: string }
export interface ReactionContext { world: GameState; fact: Fact; relationId: string }
export interface ReactionDefinition { id: string; on: string; when: readonly Condition[]; operations: readonly Operation[] }
export type Condition = BasicCondition
  | { type: 'compare'; left: Value; operator: 'gte' | 'lte'; right: Value; message?: string }
  | { type: 'missionStatus'; statuses: MissionStatus[]; message?: string }
  | { type: 'sameInstance'; left: CharacterRef; right: CharacterRef; message?: string }
  | { type: 'alive'; entity: CharacterRef; message?: string }
  | { type: 'noActiveMission'; message?: string };
export type Operation =
  | { type: 'damage'; amount: Value }
  | { type: 'relation'; faction: 'faction' | 'opponent'; amount: number; min: number; max: number }
  | { type: 'attributeReward'; key: string; value: Value; bands: { min: number; max: number; amount: number }[]; max: number }
  | { type: 'missionStatus'; status: MissionStatus }
  | { type: 'setReference'; entity: CharacterRef; key: string; value: CharacterRef }
  | { type: 'spawnTarget' };
export interface Feedback { color: string; durationMs: number; message: string }
export interface EventDefinition {
  id: string;
  when?: readonly Condition[];
  emits?: readonly { type: string }[];
  conditions: readonly Condition[];
  outcomes: readonly {
    id: string;
    weight: number;
    operations: readonly Operation[];
    feedback: Feedback;
  }[];
}
export type EventResult =
  | { executed: false; reason: BasicCondition | 'compare' | 'missionStatus' | 'noActiveMission' | 'noApplicableEvent' | 'alive' | 'sameInstance'; message?: string }
  | { executed: true; eventId: string; outcomeId: string; damage: number; targetHp: number; killed: boolean; feedback: Feedback; facts: readonly Fact[] };

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
function requireReaction(reaction?: ReactionContext): ReactionContext {
  if (!reaction) throw new Error('This rule requires reaction context');
  return reaction;
}
function character(ref: CharacterRef, actor: EntityState, target: EntityState, reaction?: ReactionContext): EntityState {
  if (ref === 'actor') return actor;
  if (ref === 'target') return target;
  if (ref !== 'relation.source' && ref !== 'relation.target') throw new Error(`Unknown character reference: ${ref}`);
  const ctx = requireReaction(reaction);
  const relation = resolve(ctx.world, ctx.relationId, 'relation');
  return resolve(ctx.world, ref === 'relation.source' ? relation.sourceId : relation.targetId, 'character');
}
function read(value: Value, actor: EntityState, target: EntityState, context?: EventContext, reaction?: ReactionContext): number {
  if (typeof value === 'number') return value;
  if (value.source === 'attribute') return actor.attributes[value.key] ?? 0;
  if (value.source === 'relationIntensity') {
    const ctx = requireReaction(reaction);
    return resolve(ctx.world, ctx.relationId, 'relation').intensity;
  }
  if (value.source === 'distance') {
    const a = character(value.from, actor, target, reaction).position;
    const b = character(value.to, actor, target, reaction).position;
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }
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
export function matches(condition: Condition, actor: EntityState, target: EntityState, context?: EventContext, reaction?: ReactionContext): boolean {
  if (typeof condition === 'string') {
    switch (condition) {
      case 'actorAlive': return actor.hp > 0;
      case 'targetAlive': return target.hp > 0;
      case 'adjacent': return isAdjacent(actor, target);
      case 'targetAttackable': return target.definition.attackable !== false;
    }
  }
  if (condition.type === 'compare') {
    const left = read(condition.left, actor, target, context, reaction);
    const right = read(condition.right, actor, target, context, reaction);
    return condition.operator === 'gte' ? left >= right : left <= right;
  }
  if (condition.type === 'sameInstance') return character(condition.left, actor, target, reaction).id === character(condition.right, actor, target, reaction).id;
  if (condition.type === 'alive') return character(condition.entity, actor, target, reaction).hp > 0;
  const ctx = requireContext(context);
  const mission = contextMission(ctx);
  if (condition.type === 'missionStatus') return condition.statuses.includes(mission?.status ?? 'available');
  return !pendingMission(ctx.world, actor.id, ctx.contractorId);
}
function apply(operation: Operation, actor: EntityState, target: EntityState, context?: EventContext, reaction?: ReactionContext) {
  if (operation.type === 'setReference') {
    const entity = character(operation.entity, actor, target, reaction);
    entity.references[operation.key] = character(operation.value, actor, target, reaction).id;
    return;
  }
  if (operation.type === 'damage') {
    target.hp = Math.max(0, target.hp - Math.max(0, read(operation.amount, actor, target, context, reaction)));
    return;
  }
  if (operation.type === 'attributeReward') {
    const value = read(operation.value, actor, target, context, reaction);
    const reward = operation.bands.find(band => value >= band.min && value <= band.max)?.amount ?? 0;
    actor.attributes[operation.key] = Math.min(operation.max, (actor.attributes[operation.key] ?? 0) + reward);
    return;
  }
  const ctx = requireContext(context);
  const { world } = ctx;
  switch (operation.type) {
    case 'relation': {
      const faction = factionId(ctx, operation.faction);
      world.relations[faction] = Math.max(operation.min, Math.min(operation.max, read({ source: 'relation', faction: operation.faction }, actor, target, ctx) + operation.amount));
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

export function applyOperations(operations: readonly Operation[], actor: EntityState, target: EntityState, context?: EventContext, reaction?: ReactionContext) {
  for (const operation of operations) apply(operation, actor, target, context, reaction);
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
  applyOperations(outcome.operations, actor, target, context);
  return {
    executed: true, eventId: event.id, outcomeId: outcome.id,
    damage: before - target.hp, targetHp: target.hp, killed: before > 0 && target.hp === 0,
    feedback: { ...outcome.feedback },
    facts: [...new Set((event.emits ?? []).map(emission => emission.type))].map(type => ({ type, actorId: actor.id, targetId: target.id })),
  };
}
