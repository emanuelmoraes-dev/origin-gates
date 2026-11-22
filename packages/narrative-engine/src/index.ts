/** Public, content-independent entry point. Other game modules are internals. */
import { DefinitionRegistry, ownData, type DefinitionBatch } from './definitions.js';
import { createWorldState, registerDefinitions, type WorldConfig } from './construction.js';
import { createCharacterInstance, createFactionInstance, type CharacterConfig } from './instances.js';
import { createRelation, movePlayer, resolve, type GameState, type WorldInstance } from './state.js';
import { executeCommand, interact, react } from './world.js';
import { resolveContext } from './interactions.js';
import { createInspector } from './inspection.js';
import { createDiagnosticExport } from './diagnostics.js';
import type { EventResult } from './events.js';
import { audited, note } from './audit.js';
import { adjacentCharacters, createQueries, type NarrativeQueries } from './queries.js';
import { assignRole, instantiateComposition, type RoleAssignment } from './compositions.js';
import { bindRootSymbol, requireReference, resolveReference, validateRootKey, type ReferenceInput, type ResolutionContext } from './references.js';
import type { CompositionConfig } from './composition-types.js';

export type { DefinitionBatch, DefinitionCatalog, FactionDefinition } from './definitions.js';
export type { WorldConfig } from './construction.js';
export type { CharacterConfig } from './instances.js';
export type { ObjectDefinition, RelationDefinition, MissionDefinition, MissionOffer, InteractionBinding, Position, Tile, WorldMap } from './state.js';
export type { EventDefinition, ReactionDefinition, Condition, Operation, Fact, EventResult } from './events.js';
export type { InstanceSnapshot } from './inspection.js';
export type { DiagnosticExport } from './diagnostics.js';
export { AuditLog } from './audit.js';
export type { AuditOptions, AuditRecord, AuditCategory, AuditValue } from './audit.js';
export type { CharacterView, FactionView, MissionView, RelationView, RelationFilter, MissionFilter, NarrativeQueries, ReadonlyData } from './queries.js';
export type { CompositionDefinition, CompositionOffer, CompositionReference, CompositionConfig } from './composition-types.js';
export type { NarrativeReference, ReferenceInput, ResolutionContext, ResolutionErrorCode } from './references.js';
export { parseReference, ReferenceResolutionError } from './references.js';
export type { RoleAssignment } from './compositions.js';

export interface InstanceHandle { readonly id: string; readonly definitionId: string; readonly kind: WorldInstance['kind'] }
export interface CompositionHandle extends InstanceHandle {
  readonly kind: 'composition';
  resolve(reference: ReferenceInput, kind?: InstanceHandle['kind']): InstanceHandle;
  tryResolve(reference: ReferenceInput, kind?: InstanceHandle['kind']): InstanceHandle | undefined;
}
export type RelationConfig = { definitionId: string; intensity: number; key?: string } & (
  | { sourceId: string; targetId: string }
  | { source: ReferenceInput; target: ReferenceInput; context?: ResolutionContext }
);
const handle = ({ id, definitionId, kind }: InstanceHandle): InstanceHandle => Object.freeze({ id, definitionId, kind });
export interface InteractionRequest { actorId: string; targetId?: string; random?: () => number }
export interface CommandRequest extends InteractionRequest {
  targetId: string;
  eventId: string;
  /** Explicit existing offer adapter; no implicit context for direct commands. */
  context?: { offer: 'target'; missionId?: string };
}

export class NarrativeWorld {
  #state: GameState;
  readonly query: NarrativeQueries;
  constructor(definitions: DefinitionRegistry, config: WorldConfig) { this.#state = createWorldState(definitions, config); this.query = createQueries(this.#state); }
  get player(): InstanceHandle { return handle(this.#state.player); }
  get map() { return this.#state.map; }
  get audit() { return this.#state.audit!; }
  get inspect() { return createInspector(this.#state); }
  get definitions() { return this.#state.definitions.catalog(); }
  registerDefinitions(batch: DefinitionBatch): void { registerDefinitions(this.#state, batch); }
  createCharacter(config: CharacterConfig): InstanceHandle { return handle(createCharacterInstance(this.#state, config)); }
  createFaction(definitionId: string, options: { key?: string } = {}): InstanceHandle { return handle(createFactionInstance(this.#state, definitionId, undefined, undefined, options.key)); }
  createRelation(config: RelationConfig): InstanceHandle {
    const s = this.#state;
    return audited(s.audit, { category: 'operation', definitionIds: [config.definitionId], data: { type: 'createRelation', source: 'publicApi', config } }, scope => {
      validateRootKey(s, config.key);
      const contextual = 'source' in config && 'target' in config && !('sourceId' in config) && !('targetId' in config);
      const concrete = 'sourceId' in config && 'targetId' in config && !('source' in config) && !('target' in config);
      if (!contextual && !concrete) throw new Error('Choose concrete IDs or contextual relation references');
      const sourceId = 'source' in config ? requireReference(s, config.source, config.context, scope).id : config.sourceId;
      const targetId = 'target' in config ? requireReference(s, config.target, config.context, scope).id : config.targetId;
      const relation = createRelation(s, config.definitionId, sourceId, targetId, config.intensity, scope);
      if (config.key !== undefined) bindRootSymbol(s, config.key, relation.id, scope);
      return handle(relation);
    });
  }
  instantiateComposition(config: CompositionConfig): CompositionHandle {
    const composition = instantiateComposition(this.#state, config);
    return Object.freeze({ ...handle(composition), kind: 'composition' as const,
      resolve: (reference: ReferenceInput, kind?: InstanceHandle['kind']) => this.resolveReference(reference, { compositionId: composition.id, kind }),
      tryResolve: (reference: ReferenceInput, kind?: InstanceHandle['kind']) => this.tryResolveReference(reference, { compositionId: composition.id, kind }),
    });
  }
  resolveReference(reference: ReferenceInput, context?: ResolutionContext): InstanceHandle { return handle(requireReference(this.#state, reference, context)); }
  tryResolveReference(reference: ReferenceInput, context?: ResolutionContext): InstanceHandle | undefined {
    const instance = resolveReference(this.#state, reference, context);
    return instance ? handle(instance) : undefined;
  }
  assignRole(request: RoleAssignment): void { assignRole(this.#state, request); }
  move(actorId: string, dx: number, dy: number): boolean {
    const state = this.#state;
    return movePlayer(resolve(state, actorId, 'character'), dx, dy, state.map, [state.player, ...state.entities].filter(e => e.id !== actorId), state.audit?.scope());
  }
  #result(result: EventResult): EventResult {
    const copy = ownData(result);
    this.audit.remember(copy, this.audit.causeOf(result));
    return copy;
  }
  interact(request: InteractionRequest): EventResult {
    const s = this.#state;
    return s.definitions.executing(() => audited(s.audit, { category: 'interaction', instanceIds: [request.actorId, ...(request.targetId === undefined ? [] : [request.targetId])], data: { source: 'publicApi' } }, scope => {
      const actor = resolve(s, request.actorId, 'character');
      const target = request.targetId === undefined ? adjacentCharacters(s, actor.id)[0] : resolve(s, request.targetId, 'character');
      if (!target) {
        note(scope, { category: 'interaction', status: 'rejected', instanceIds: [actor.id], data: { reason: 'noAdjacentCharacter' } });
        return this.#result({ executed: false, reason: 'noApplicableEvent', message: 'Nenhum personagem adjacente.' });
      }
      return this.#result(interact(s, target, request.random, s.eventDefinitions, scope, actor));
    }, result => result.executed ? 'accepted' : 'rejected'));
  }
  command(request: CommandRequest): EventResult {
    const s = this.#state;
    return s.definitions.executing(() => audited(s.audit, { category: 'command', instanceIds: [request.actorId, request.targetId], definitionIds: [request.eventId], data: { source: 'publicApi' } }, scope => {
      const event = s.eventDefinitions[request.eventId];
      if (!event) throw new Error(`Unknown event: ${request.eventId}`);
      const actor = resolve(s, request.actorId, 'character');
      const target = resolve(s, request.targetId, 'character');
      const context = request.context ? resolveContext(s, actor, target, { event: event.id, context: { offer: request.context.offer } }) : undefined;
      if (context && request.context?.missionId) context.missionId = request.context.missionId;
      return this.#result(executeCommand(s, event, actor, target, request.random, context, scope));
    }, result => result.executed ? 'accepted' : 'rejected'));
  }
  react(options: { cause?: EventResult; random?: () => number } = {}): readonly EventResult[] {
    const s = this.#state;
    return s.definitions.executing(() => Object.freeze(react(s, s.eventDefinitions, options.cause ? this.audit.causeOf(options.cause) : undefined, options.random).map(result => this.#result(result))));
  }
  diagnostics(now?: Date) { return createDiagnosticExport(this.#state, now); }
}

export function createEngine() {
  const definitions = new DefinitionRegistry();
  return Object.freeze({
    registerDefinitions: (batch: DefinitionBatch): void => definitions.register(batch),
    get definitions() { return definitions.catalog(); },
    createWorld: (config: WorldConfig): NarrativeWorld => new NarrativeWorld(definitions, config),
  });
}
