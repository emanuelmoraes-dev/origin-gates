import { createEngine, type CompositionDefinition, type DefinitionBatch, type WorldMap } from '../../src/game';
import { literalDefinitions } from './programmatic';

export const trainingCamp: CompositionDefinition = {
  id: 'trainingCamp', characters: [{ key: 'guardian', definitionId: 'enemy', position: { x: 0, y: 0 } }],
};
export const rivalCity: CompositionDefinition = {
  id: 'rivalCity', parameters: { player: { kind: 'character' } },
  factions: [{ key: 'government', definitionId: 'government' }, { key: 'resistance', definitionId: 'resistance' }],
  characters: [
    { key: 'official', definitionId: 'governmentRepresentative', faction: 'government', position: { x: 3, y: 2 },
      offer: { mission: 'eliminateTarget', name: 'Eliminar alvo rebelde', target: 'resistanceTarget', opponent: 'resistance', spawn: { x: 8, y: 3 } } },
    { key: 'rebel', definitionId: 'resistanceRepresentative', faction: 'resistance', position: { x: 5, y: 2 },
      offer: { mission: 'eliminateTarget', name: 'Eliminar alvo governista', target: 'governmentTarget', opponent: 'government', spawn: { x: 8, y: 8 } } },
  ],
  roles: { representative: { kind: 'character', initial: 'official' } },
  relations: [
    { key: 'governmentReputation', definitionId: 'reputation', source: 'government', target: { parameter: 'player' }, intensity: 50 },
    { key: 'resistanceReputation', definitionId: 'reputation', source: 'resistance', target: { parameter: 'player' }, intensity: 50 },
  ],
};
export const socialGroup: CompositionDefinition = {
  id: 'socialGroup', characters: [
    { key: 'victim', definitionId: 'victim', label: 'Vítima', position: { x: 0, y: 0 } },
    { key: 'A', definitionId: 'observer', label: 'A', position: { x: 0, y: -1 } },
    { key: 'B', definitionId: 'observer', label: 'B', position: { x: 1, y: 0 } },
    { key: 'C', definitionId: 'observer', label: 'C', position: { x: -1, y: 1 } },
    { key: 'D', definitionId: 'observer', label: 'D', position: { x: -4, y: -5 } },
    { key: 'E', definitionId: 'observer', label: 'E', position: { x: 0, y: 2 } },
  ], relations: [
    { definitionId: 'friendship', source: 'A', target: 'victim', intensity: 90 },
    { definitionId: 'friendship', source: 'B', target: 'victim', intensity: 20 },
    { definitionId: 'friendship', source: 'D', target: 'victim', intensity: 90 },
    { definitionId: 'friendship', source: 'victim', target: 'E', intensity: 90 },
  ],
};
export const royalCourt: CompositionDefinition = {
  id: 'royalCourt',
  roles: { rei: { kind: 'character', initial: 'Arthur' }, envoy: { kind: 'character' }, fixed: { kind: 'character', initial: 'Arthur', allowVacant: false } },
  // Role and relation declarations intentionally precede their characters.
  relations: [
    { key: 'gratitude', definitionId: 'gratitude', source: 'benefactor', target: '<rei>', intensity: 80 },
    { key: 'membership', definitionId: 'membership', source: 'Edward', target: 'self', intensity: 1 },
  ],
  characters: [
    { key: 'Arthur', definitionId: 'observer', position: { x: 0, y: 0 } },
    { key: 'Edward', definitionId: 'observer', position: { x: 1, y: 0 } },
    { key: 'benefactor', definitionId: 'observer', position: { x: 0, y: 1 } },
  ],
};
export const family: CompositionDefinition = { id: 'family', characters: [{ key: 'prince', definitionId: 'observer', position: { x: 0, y: 0 } }] };
export const army: CompositionDefinition = {
  id: 'army', parameters: { commander: { kind: 'character' }, faction: { kind: 'faction' } },
  characters: [{ key: 'soldier', definitionId: 'observer', faction: { parameter: 'faction' }, position: { x: 0, y: 0 } }],
  roles: { militaryCommander: { kind: 'character', initial: { parameter: 'commander' } } },
  relations: [
    { key: 'gratitude', definitionId: 'gratitude', source: 'soldier', target: { parameter: 'commander' }, intensity: 50 },
    { key: 'membership', definitionId: 'membership', source: 'soldier', target: 'self', intensity: 1 },
  ],
};
export const compositionDefinitions: DefinitionBatch = {
  ...literalDefinitions,
  relations: [...literalDefinitions.relations!,
    { id: 'gratitude', name: 'Gratidão', sourceKinds: ['character'], targetKinds: ['character'], unique: true, reactions: [] },
    { id: 'membership', name: 'Pertencimento', sourceKinds: ['character'], targetKinds: ['composition'], unique: true, reactions: [] },
    { id: 'link', name: 'Vínculo', sourceKinds: ['character', 'faction', 'relation', 'composition'], targetKinds: ['character', 'faction', 'relation', 'composition'], unique: true, reactions: [] },
  ],
  compositions: [trainingCamp, rivalCity, socialGroup, royalCourt, family, army],
};
export const compositionMap = (): WorldMap => Array.from({ length: 24 }, () => Array.from({ length: 40 }, () => 'land' as const));
export function compositionEngine() { const engine = createEngine(); engine.registerDefinitions(compositionDefinitions); return engine; }
export function compositionWorld(audit = true) {
  return compositionEngine().createWorld({ map: compositionMap(), scenarioId: 'compositions', player: { definitionId: 'player', position: { x: 0, y: 23 } }, audit: { enabled: audit, capacity: 20000 } });
}
