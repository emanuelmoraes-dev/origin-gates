import { isAdjacent, type EntityState } from './state';

type Condition = 'actorAlive' | 'targetAlive' | 'adjacent';
type Operation = { type: 'damage'; amount: number };
export interface Feedback { color: string; durationMs: number; message: string }
export interface EventDefinition {
  id: string;
  conditions: readonly Condition[];
  outcomes: readonly {
    id: string;
    weight: number;
    operations: readonly Operation[];
    feedback: Feedback;
  }[];
}
export type EventResult =
  | { executed: false; reason: Condition }
  | { executed: true; eventId: string; outcomeId: string; damage: number; targetHp: number; killed: boolean; feedback: Feedback };

const conditions: Record<Condition, (actor: EntityState, target: EntityState) => boolean> = {
  actorAlive: actor => actor.hp > 0,
  targetAlive: (_actor, target) => target.hp > 0,
  adjacent: isAdjacent,
};
const operations: Record<Operation['type'], (target: EntityState, operation: Operation) => void> = {
  damage: (target, operation) => { target.hp = Math.max(0, target.hp - Math.max(0, operation.amount)); },
};

// No rendering dependency. Inject randomness for reproducible tests.
export function executeEvent(event: EventDefinition, actor: EntityState, target: EntityState, random: () => number = Math.random): EventResult {
  for (const condition of event.conditions) {
    if (!conditions[condition](actor, target)) return { executed: false, reason: condition };
  }
  const total = event.outcomes.reduce((sum, outcome) => sum + outcome.weight, 0);
  if (!event.outcomes.length || event.outcomes.some(outcome => !Number.isFinite(outcome.weight) || outcome.weight <= 0)) {
    throw new Error(`Invalid outcomes for event ${event.id}`);
  }
  let roll = random() * total;
  const outcome = event.outcomes.find(candidate => (roll -= candidate.weight) < 0) ?? event.outcomes[event.outcomes.length - 1];
  const before = target.hp;
  for (const operation of outcome.operations) operations[operation.type](target, operation);
  return {
    executed: true, eventId: event.id, outcomeId: outcome.id,
    damage: before - target.hp, targetHp: target.hp, killed: target.hp === 0,
    feedback: { ...outcome.feedback },
  };
}
