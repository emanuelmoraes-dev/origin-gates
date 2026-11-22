import { audited, auditSource, mutation, note, type AuditScope } from './audit';
import { ownData, validatePosition } from './definitions';
import { createCharacterInstance, createFactionInstance, prepareCharacter, type CharacterConfig } from './instances';
import { compositionScope, parseReference, ReferenceResolutionError, requireReference, resolveReference, validateAlias, type ReferenceInput, type ResolutionContext } from './references';
import { createRelation, identity, instanceIdAt, prepareRelation, registerInstance, type CompositionState, type GameState, type InstanceIdentity, type Position, type RelationState, type WorldInstance } from './state';
import type { CompositionConfig, CompositionReference } from './composition-types';

function spatialPosition(world: GameState, position: Position): void {
  validatePosition(position);
  if (world.map[position.y]?.[position.x] !== 'land') throw new Error(`Composition position must be land inside the map: ${position.x},${position.y}`);
}
function prepareComposition(world: GameState, config: CompositionConfig, scope?: AuditScope) {
  const request = ownData(config);
  const definition = world.definitions.catalog().compositions[request.definitionId];
  if (!definition) throw new Error(`Unknown composition definition: ${request.definitionId}`);
  validatePosition(request.origin);
  if (request.key !== undefined) {
    validateAlias(request.key);
    if (Object.hasOwn(world.compositionAliases, request.key)) throw new Error(`Duplicate composition alias: ${request.key}`);
  }
  const bindings: Record<string, string> = Object.create(null);
  for (const key of Object.keys(request.bindings ?? {})) if (!Object.hasOwn(definition.parameters ?? {}, key)) throw new Error(`Unknown binding: ${key}`);
  for (const [key, parameter] of Object.entries(definition.parameters ?? {})) {
    const binding = request.bindings?.[key];
    if (binding === undefined) throw new Error(`Missing binding: ${key}`);
    bindings[key] = requireReference(world, binding, { ...request.context, kind: parameter.kind }, scope).id;
  }
  // Forecast IDs without touching nextId. These lookup entries carry identity/kind
  // only; shared validators never execute operations against this prospective view.
  let nextId = world.nextId;
  const id = instanceIdAt(nextId++);
  const factions = (definition.factions ?? []).map(item => ({ ...item, id: instanceIdAt(nextId++), kind: 'faction' as const }));
  const characters = (definition.characters ?? []).map(item => ({ ...item, id: instanceIdAt(nextId++), kind: 'character' as const }));
  const relations = (definition.relations ?? []).map(item => ({ ...item, id: instanceIdAt(nextId++), kind: 'relation' as const }));
  const symbols: Record<string, string> = Object.create(null);
  symbols.self = id;
  for (const item of [...factions, ...characters, ...relations]) if (item.key !== undefined) symbols[item.key] = item.id;
  const roles: Record<string, string | null> = Object.fromEntries(Object.keys(definition.roles ?? {}).map(key => [key, null]));
  const composition: CompositionState = { id, definitionId: definition.id, kind: 'composition', origin: request.origin, key: request.key, symbols, bindings, roles };
  const instances: Record<string, InstanceIdentity> = { ...world.instances, [id]: composition };
  for (const item of [...factions, ...characters, ...relations]) instances[item.id] = { id: item.id, definitionId: item.definitionId, kind: item.kind };
  const plannedRelations = [...world.relationInstances];
  const prospective = { ...world, instances, relationInstances: plannedRelations, compositionAliases: { ...world.compositionAliases, ...(request.key === undefined ? {} : { [request.key]: id }) } };
  const resolvedRoles = new Set<string>();
  const resolvingRoles = new Set<string>();
  const resolutions: { reference: ReferenceInput; context: ResolutionContext; id?: string }[] = [];
  const readRole = (owner: CompositionState, key: string): string | null => {
    if (owner.id !== id || resolvedRoles.has(key)) return owner.roles[key];
    if (resolvingRoles.has(key)) throw new Error(`Cyclic initial roles: ${key}`);
    resolvingRoles.add(key);
    const role = definition.roles![key];
    roles[key] = role.initial === undefined ? null : lookup(role.initial, role.kind, role.allowVacant !== false)?.id ?? null;
    resolvingRoles.delete(key); resolvedRoles.add(key);
    return roles[key];
  };
  const lookup = (input: CompositionReference, kind?: WorldInstance['kind'], allowVacant = false): InstanceIdentity | undefined => {
    const reference = typeof input === 'object' && 'parameter' in input ? { type: 'instance' as const, id: bindings[input.parameter] } : input;
    const context = { compositionId: id, kind };
    note(scope, { category: 'reference', status: 'considered', data: { reference: input, context, stage: 'preparation' } });
    const parsed = parseReference(reference);
    const instance = resolveReference(parsed.type === 'instance' ? world : prospective, parsed, context, undefined, readRole);
    if (!instance && !allowVacant) throw new ReferenceResolutionError('roleVacant', 'Composition requires an occupied role');
    resolutions.push({ reference, context, id: instance?.id });
    return instance;
  };
  const translate = (local: Position) => {
    const position = { x: request.origin.x + local.x, y: request.origin.y + local.y };
    spatialPosition(world, position);
    return position;
  };
  const occupied = new Set([world.player, ...world.entities].filter(c => c.hp > 0).map(c => `${c.position.x},${c.position.y}`));
  const characterPlans = characters.map(item => {
    const position = translate(item.position);
    const tile = `${position.x},${position.y}`;
    if (occupied.has(tile)) throw new Error(`Composition character overlap: ${tile}`);
    occupied.add(tile);
    const config: CharacterConfig = {
      definitionId: item.definitionId, position, label: item.label, interactions: item.interactions,
      factionId: item.faction === undefined ? undefined : lookup(item.faction, 'faction')!.id,
      offer: item.offer === undefined ? undefined : {
        mission: item.offer.mission, name: item.offer.name, target: item.offer.target,
        opponentId: lookup(item.offer.opponent, 'faction')!.id, spawn: translate(item.offer.spawn),
      },
    };
    return { id: item.id, config: prepareCharacter(prospective, config).owned };
  });
  const relationPlans = relations.map(item => {
    const sourceId = lookup(item.source)!.id;
    const targetId = lookup(item.target)!.id;
    const { value } = prepareRelation(prospective, item.definitionId, sourceId, targetId, item.intensity);
    const plan: RelationState = { id: item.id, definitionId: item.definitionId, kind: 'relation', sourceId, targetId, intensity: value };
    plannedRelations.push(plan);
    return plan;
  });
  for (const key of Object.keys(roles)) readRole(composition, key);
  // Relations may refer to later relations. Establish dependencies first; cycles
  // cannot be confirmed through the existing endpoint-validating factory.
  const byId = new Map(relationPlans.map(item => [item.id, item]));
  const ordered: RelationState[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (item: RelationState) => {
    if (done.has(item.id)) return;
    if (visiting.has(item.id)) throw new Error('Cyclic composition relation dependencies');
    visiting.add(item.id);
    for (const endpoint of [item.sourceId, item.targetId]) if (byId.has(endpoint)) visit(byId.get(endpoint)!);
    visiting.delete(item.id); done.add(item.id); ordered.push(item);
  };
  relationPlans.forEach(visit);
  const remap = new Map(ordered.map((item, index) => [item.id, instanceIdAt(world.nextId + 1 + factions.length + characters.length + index)]));
  const finalId = (value: string) => remap.get(value) ?? value;
  for (const key of Object.keys(symbols)) symbols[key] = finalId(symbols[key]);
  for (const key of Object.keys(roles)) if (roles[key] !== null) roles[key] = finalId(roles[key]);
  const finalRelations = ordered.map(item => ({ ...item, id: finalId(item.id), sourceId: finalId(item.sourceId), targetId: finalId(item.targetId) }));
  // Only publish prospective resolution IDs after dependency ordering is final.
  // Allocation/creation records still occur exclusively during confirmation.
  for (const result of resolutions) note(scope, { category: 'reference', status: result.id === undefined ? 'vacant' : 'resolved', instanceIds: result.id === undefined ? [id] : [finalId(result.id)], data: { reference: result.reference, context: result.context, stage: 'preparation' } });
  note(scope, { category: 'composition', status: 'validated', definitionIds: [definition.id], data: { origin: request.origin, key: request.key, bindings, symbols, roles, stage: 'preparation' } });
  return { composition, factions, characters: characterPlans, relations: finalRelations };
}

export interface RoleAssignment { compositionId: string; role: string; instanceId: string | null }
export function assignRole(world: GameState, request: RoleAssignment, scope?: AuditScope): void {
  audited(auditSource(world, scope), { category: 'role', instanceIds: [request.compositionId], data: request }, current => {
    const composition = compositionScope(world, request.compositionId);
    const definition = world.definitions.catalog().compositions[composition.definitionId];
    if (!Object.hasOwn(definition.roles ?? {}, request.role)) throw new ReferenceResolutionError('roleNotFound', `Role not found: ${request.role}`);
    const role = definition.roles![request.role];
    if (request.instanceId === null) {
      if (role.allowVacant === false) throw new Error(`Role cannot be vacant: ${request.role}`);
    } else {
      requireReference(world, { type: 'instance', id: request.instanceId }, { kind: role.kind }, current);
    }
    const before = composition.roles[request.role];
    composition.roles[request.role] = request.instanceId;
    mutation(current, composition, `roles.${request.role}`, before, request.instanceId, 'assignRole');
  });
}

export function instantiateComposition(world: GameState, request: CompositionConfig): CompositionState {
  return world.definitions.executing(() => audited(world.audit, { category: 'composition', definitionIds: [request.definitionId], data: { action: 'instantiate', request, stage: 'preparation' } }, scope => {
    const plan = prepareComposition(world, request, scope);
    const assertId = (instance: WorldInstance, expected: string) => { if (instance.id !== expected) throw new Error('Composition identity plan changed during confirmation'); };
    const composition: CompositionState = { ...plan.composition, ...identity(world, plan.composition.definitionId, scope), origin: ownData(plan.composition.origin), symbols: ownData(plan.composition.symbols), bindings: ownData(plan.composition.bindings), roles: Object.fromEntries(Object.keys(plan.composition.roles).map(key => [key, null])) };
    assertId(composition, plan.composition.id);
    registerInstance(world, composition, scope);
    for (const item of plan.factions) assertId(createFactionInstance(world, item.definitionId, scope, composition.id), item.id);
    for (const item of plan.characters) assertId(createCharacterInstance(world, item.config, scope, true, composition.id), item.id);
    for (const item of plan.relations) assertId(createRelation(world, item.definitionId, item.sourceId, item.targetId, item.intensity, scope, composition.id), item.id);
    for (const [role, instanceId] of Object.entries(plan.composition.roles)) assignRole(world, { compositionId: composition.id, role, instanceId }, scope);
    if (composition.key !== undefined) {
      world.compositionAliases[composition.key] = composition.id;
      note(scope, { category: 'reference', status: 'bound', instanceIds: [composition.id], data: { alias: composition.key } });
    }
    note(scope, { category: 'composition', status: 'instantiated', instanceIds: [composition.id], definitionIds: [composition.definitionId], data: { symbols: composition.symbols, bindings: composition.bindings, roles: composition.roles } });
    return composition;
  }));
}
