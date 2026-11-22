import { audited, auditSource, mutation, note, type AuditScope } from './audit';
import { ownData, validateInteractions, validateOffer, validatePosition } from './definitions';
import { createEntity, identity, registerInstance, resolve, type EntityState, type FactionState, type GameState, type InstanceLookup, type InteractionBinding, type MissionOffer, type Position } from './state';
import { bindRootSymbol, validateRootKey } from './references';

export interface CharacterConfig {
  definitionId: string;
  /** Optional stable symbol in root, for individual creation only. */
  key?: string;
  position: Position;
  label?: string;
  factionId?: string;
  interactions?: readonly InteractionBinding[];
  offer?: MissionOffer;
}

/** Pure validation shared by individual creation and composition preparation. */
export function prepareCharacter(world: Pick<GameState, 'objectDefinitions' | 'rootSymbols' | 'definitions' | 'missionDefinitions'> & InstanceLookup, config: CharacterConfig) {
  const owned = ownData(config);
  const definition = world.objectDefinitions[owned.definitionId];
  if (!definition) throw new Error(`Unknown character definition: ${owned.definitionId}`);
  validateRootKey(world, owned.key);
  validatePosition(owned.position);
  if (owned.label !== undefined && typeof owned.label !== 'string') throw new Error('Invalid character label');
  if (owned.factionId !== undefined) resolve(world, owned.factionId, 'faction');
  if (owned.interactions !== undefined) validateInteractions(owned.interactions, world.definitions.catalog());
  if (definition.offer && !owned.offer) throw new Error('Offer requires a concrete opponentId');
  if (owned.offer) {
    validateOffer(owned.offer, world.definitions.catalog(), true);
    resolve(world, owned.offer.opponentId, 'faction');
    if (!world.missionDefinitions.some(d => d.id === owned.offer!.mission)) throw new Error('Mission is not enabled in this world');
  }
  return { definition, owned };
}
/** Shared by the public API, the JSON adapter and spawnTarget. */
export function createCharacterInstance(world: GameState, config: CharacterConfig, scope?: AuditScope, onMap = true, createdByCompositionId?: string): EntityState {
  return audited(auditSource(world, scope), { category: 'operation', definitionIds: [config.definitionId], data: { type: 'createCharacter', config } }, current => {
    const { definition, owned } = prepareCharacter(world, config);
    const entity = createEntity(definition, owned.position, world, owned.interactions, current, createdByCompositionId);
    entity.label = owned.label;
    mutation(current, entity, 'label', undefined, entity.label, 'initialConfiguration');
    if (owned.factionId !== undefined) {
      entity.factionId = owned.factionId;
      mutation(current, entity, 'factionId', undefined, entity.factionId, 'initialConfiguration');
    }
    if (owned.offer) {
      entity.offer = owned.offer;
      mutation(current, entity, 'offer', undefined, entity.offer, 'initialConfiguration');
    }
    if (onMap) {
      world.entities.push(entity);
      note(current, { category: 'world', status: 'configured', instanceIds: [entity.id], data: { auxiliary: 'mapCharacterAdded' } });
    }
    if (owned.key !== undefined) bindRootSymbol(world, owned.key, entity.id, current);
    return entity;
  });
}

export function createFactionInstance(world: GameState, definitionId: string, scope?: AuditScope, createdByCompositionId?: string, key?: string): FactionState {
  return audited(auditSource(world, scope), { category: 'operation', definitionIds: [definitionId], data: { type: 'createFaction' } }, current => {
    const definition = world.factionDefinitions[definitionId];
    if (!definition) throw new Error(`Unknown faction definition: ${definitionId}`);
    validateRootKey(world, key);
    const faction: FactionState = { ...identity(world, definition.id, current, createdByCompositionId), kind: 'faction', name: definition.name };
    registerInstance(world, faction, current);
    if (key !== undefined) bindRootSymbol(world, key, faction.id, current);
    return faction;
  });
}
