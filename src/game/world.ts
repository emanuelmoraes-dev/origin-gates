import player from '../data/objects/player.json';
import enemy from '../data/objects/enemy.json';
import socialObjects from '../data/objects/social.json';
import reactivityObjects from '../data/objects/reactivity.json';
import relationData from '../data/relations.json';
import reactionData from '../data/reactions.json';
import missions from '../data/missions.json';
import factionDefinitions from '../data/factions.json';
import scenarioData from '../data/scenarios.json';
import attack from '../data/events/attack.json';
import socialEvents from '../data/events/social.json';
import { executeEvent, matches, type EventContext, type EventDefinition, type EventResult, type ReactionDefinition } from './events';
import { createEntity, createIdentityStore, createRelation, identity, isAdjacent, registerInstance, resolve, type EntitySpawn, type EntityState, type FactionState, type GameState, type MissionDefinition, type MissionState, type ObjectDefinition, type Position, type RelationDefinition, type RelationSpawn, type RelationState } from './state';
import { AuditLog, audited, auditSource, mutation, note, type AuditOptions, type AuditScope } from './audit';
import { selectInteraction } from './interactions';
import { dispatchFacts } from './reactions';

interface ScenarioDefinition {
  id: string; name: string; player: Position; entities: EntitySpawn[];
  missions: string[]; factions: { definition: string }[];
  relations?: RelationSpawn[];
}
export const scenarios: readonly ScenarioDefinition[] = scenarioData;
export const events = { attack, ...socialEvents } as Record<string, EventDefinition>;
export function createWorld(scenarioId: string, options: AuditOptions | AuditLog = {}): GameState {
  const audit = options instanceof AuditLog ? options : new AuditLog(options);
  return audited(audit, { category: 'world', data: { scenarioId } }, current => {
  const scenario = scenarios.find(item => item.id === scenarioId);
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
  const objectDefinitions = { player, enemy, ...socialObjects, ...reactivityObjects } as Readonly<Record<string, ObjectDefinition>>;
  const missionDefinitions = missions.filter(mission => scenario.missions.some(id => id === mission.id));
  const store = createIdentityStore(audit);
  const playerInstance = createEntity(player, scenario.player, store, undefined, current);
  const world: GameState = {
    ...store, scenario: scenarioId, player: playerInstance,
    entities: [],
    get missions() { return Object.values(this.instances).filter((item): item is MissionState => item.kind === 'mission'); },
    get factions() { return Object.values(this.instances).filter((item): item is FactionState => item.kind === 'faction'); },
    get relationInstances() { return Object.values(this.instances).filter((item): item is RelationState => item.kind === 'relation'); },
    relationDefinitions: relationData as Readonly<Record<string, RelationDefinition>>, reactionDefinitions: reactionData as Record<string, ReactionDefinition>,
    factSubscriptions: {}, processedFacts: new WeakSet(),
    missionDefinitions: missionDefinitions as MissionDefinition[], objectDefinitions,
  };
  Object.defineProperty(world, 'audit', { value: audit, enumerable: false });
  const factions = new Map<string, string>();
  for (const config of scenario.factions) {
    const definition = factionDefinitions.find(item => item.id === config.definition);
    if (!definition || factions.has(config.definition)) throw new Error(`Invalid faction definition: ${config.definition}`);
    const faction: FactionState = { ...identity(world, definition.id, current), kind: 'faction', name: definition.name };
    registerInstance(world, faction, current);
    factions.set(config.definition, faction.id);
  }
  const factionRef = (id: string) => {
    const instanceId = factions.get(id);
    if (!instanceId) throw new Error(`Unknown scenario faction: ${id}`);
    return instanceId;
  };
  const symbols = new Map<string, string>([['player', world.player.id]]);
  for (const [key, id] of factions) {
    if (symbols.has(key)) throw new Error(`Duplicate scenario symbol: ${key}`);
    symbols.set(key, id);
  }
  world.entities = scenario.entities.map((item: EntitySpawn) => {
    const definition = objectDefinitions[item.object as keyof typeof objectDefinitions];
    const entity = createEntity(definition, item.position, world, item.interactions, current);
    entity.label = item.label;
    mutation(current, entity, 'label', undefined, entity.label, 'initialConfiguration');
    if (item.key) {
      if (symbols.has(item.key)) throw new Error(`Duplicate scenario symbol: ${item.key}`);
      symbols.set(item.key, entity.id);
    }
    if (item.faction) {
      entity.factionId = factionRef(item.faction);
      mutation(current, entity, 'factionId', undefined, entity.factionId, 'initialConfiguration');
    }
    if (definition.offer) {
      const { opponent, ...offer } = definition.offer;
      if (!missionDefinitions.some(item => item.id === offer.mission)) throw new Error(`Unknown offer mission: ${offer.mission}`);
      entity.offer = { ...offer, spawn: { ...offer.spawn }, opponentId: factionRef(opponent) };
      mutation(current, entity, 'offer', undefined, entity.offer, 'initialConfiguration');
    }
    return entity;
  });
  const symbolRef = (key: string) => {
    const id = symbols.get(key);
    if (!id) throw new Error(`Unknown scenario symbol: ${key}`);
    return id;
  };
  for (const config of scenario.relations ?? []) {
    createRelation(world, config.definition, symbolRef(config.source), symbolRef(config.target), config.intensity, current);
  }
  note(current, { category: 'world', status: 'configured', instanceIds: world.entities.map(entity => entity.id), data: { auxiliary: 'mapCharacters', playerId: world.player.id } });
  return world;
  });
}

// Reactions depend on world state, never on the identifier of the last event.
export function react(world: GameState, definitions = events, scope?: AuditScope): EventResult[] {
  return audited(auditSource(world, scope), { category: 'legacy', data: { source: 'missionPolling' } }, current => {
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
        const result = executeEvent(event, actor, target, Math.random, context, missionScope);
        if (result.executed) results.push(result);
      } else {
        note(missionScope, { category: 'reaction', status: 'rejected', instanceIds: [mission.id], definitionIds: [event.id] });
      }
    }
    });
  }
  return results;
  });
}

export function interact(world: GameState, target: EntityState, random = Math.random, definitions = events, scope?: AuditScope): EventResult {
  return audited(auditSource(world, scope), { category: 'interaction', instanceIds: [world.player.id, target.id] }, current => {
  const selected = selectInteraction(world, target, definitions, current);
  if (!selected) {
    note(current, { category: 'interaction', status: 'rejected', instanceIds: [world.player.id, target.id], data: { reason: 'noApplicableEvent' } });
    return { executed: false, reason: 'noApplicableEvent', message: 'Nenhuma interação disponível.' };
  }
  const result = executeCommand(world, selected.event, world.player, target, random, selected.context, current);
  world.audit?.remember(result, current);
  return result;
  }, result => result.executed ? 'accepted' : 'rejected');
}

// Commands may come from any registered character. The UI is one caller.
export function executeCommand(world: GameState, event: EventDefinition, actor: EntityState, target: EntityState, random = Math.random, context?: EventContext, scope?: AuditScope): EventResult {
  return audited(auditSource(world, scope), { category: 'command', instanceIds: [actor.id, target.id], definitionIds: [event.id], data: { stage: 'requested' } }, current => {
  if (resolve(world, actor.id, 'character') !== actor || resolve(world, target.id, 'character') !== target) throw new Error('Unregistered command participant');
  if (context && context.world !== world) throw new Error('Command context belongs to another world');
  const result = executeEvent(event, actor, target, random, context, current);
  if (result.executed) dispatchFacts(world, result.facts, world.reactionDefinitions, current);
  world.audit?.remember(result, current);
  return result;
  }, result => result.executed ? 'accepted' : 'rejected');
}

export function adjacentEntities(world: GameState): EntityState[] {
  return world.entities.filter(entity => entity.hp > 0 && isAdjacent(world.player, entity));
}
