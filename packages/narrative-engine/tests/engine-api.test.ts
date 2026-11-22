import { describe, expect, it } from 'vitest';
import { createEngine, type DefinitionBatch, type EventDefinition, type RelationDefinition } from '@origin-gates/narrative-engine';
import { character } from './fixtures/actions.js';

const citizen = { id: 'citizen', name: 'Cidadão', maxHp: 100, color: '#ffffff' };
const signal: EventDefinition = { id: 'signal', conditions: ['actorAlive', 'targetAlive', 'adjacent'], emits: [{ type: 'attackAttempted' }], outcomes: [{ id: 'ok', weight: 1, operations: [], feedback: { color: '#ffffff', durationMs: 0, message: 'OK' } }] };
const link: RelationDefinition = { id: 'link', name: 'Ligação', sourceKinds: ['character'], targetKinds: ['character'], unique: true, reactions: ['notice'], intensity: { min: 0, max: 100 } };
const notice = { id: 'notice', on: 'attackAttempted', when: [{ type: 'sameInstance', left: 'relation.target', right: 'target' }], operations: [{ type: 'setReference', entity: 'relation.source', key: 'hostileTo', value: 'actor' }] } as const;
const base = (): DefinitionBatch => ({ characters: [{ ...citizen, interactions: [{ event: signal.id }] }], factions: [{ id: 'guild', name: 'Guilda' }], events: [structuredClone(signal)] });
function setup() {
  const engine = createEngine(); engine.registerDefinitions(base());
  const config = { map: [['land', 'land', 'water'], ['land', 'land', 'land']] as const, player: { definitionId: citizen.id, position: { x: 0, y: 0 } } };
  const world = engine.createWorld(config);
  const target = world.createCharacter({ definitionId: citizen.id, position: { x: 1, y: 0 }, label: 'Alvo' });
  return { engine, config, world, target };
}
describe('definition registration boundary', () => {
  it('registers forward and circular offer references together, with no required category order', () => {
    const engine = createEngine();
    engine.registerDefinitions({ characters: [{ ...citizen, offer: { mission: 'quest', name: 'Oferta', target: citizen.id, opponent: 'guild', spawn: { x: 1, y: 1 } }, interactions: [{ event: signal.id }] }], missions: [{ id: 'quest', name: 'Missão', initialStatus: 'active', reactions: [signal.id] }], factions: [{ id: 'guild', name: 'Guilda' }], events: [signal], relations: [link], reactions: [notice] });
    expect(engine.definitions.characters.citizen.offer!.target).toBe('citizen');
    expect(engine.definitions.relations.link.reactions).toEqual(['notice']);
  });
  it('owns deeply immutable copies instead of freezing or sharing caller data', () => {
    const interactions = [{ event: signal.id }];
    const batch = base(); batch.characters = [{ ...citizen, interactions }];
    const engine = createEngine(); engine.registerDefinitions(batch);
    interactions[0].event = 'missing'; // caller array remains mutable
    batch.events![0].outcomes[0].feedback.message = 'changed';
    expect(engine.definitions.characters.citizen.interactions![0].event).toBe('signal');
    expect(engine.definitions.events.signal.outcomes[0].feedback.message).toBe('OK');
    expect(Object.isFrozen(engine.definitions.events.signal.outcomes[0].feedback)).toBe(true);
    expect(() => { engine.definitions.events.signal.id = 'changed'; }).toThrow();
  });
  it('rejects any duplicate in a category, including identical definitions and duplicates within a batch', () => {
    const engine = createEngine(); engine.registerDefinitions({ characters: [citizen] });
    expect(() => engine.registerDefinitions({ characters: [citizen] })).toThrow(/duplicate/);
    expect(() => engine.registerDefinitions({ characters: [{ ...citizen, name: 'Other' }] })).toThrow(/duplicate/);
    expect(() => createEngine().registerDefinitions({ characters: [citizen, citizen] })).toThrow(/duplicate/);
  });
  it.each([
    { characters: [{ ...citizen, id: '' }] },
    { characters: [{ ...citizen, maxHp: 0 }] },
    { characters: [{ ...citizen, maxHp: Infinity }] },
    { characters: [{ ...citizen, color: 2 }] },
    { characters: [{ ...citizen, attackable: 'yes' }] },
    { characters: [{ ...citizen, interactions: [{ event: 'missing' }] }] },
    { characters: [{ ...citizen, offer: { mission: 'missing', target: 'missing', opponent: 'missing' } }] },
    { factions: [{ id: 'guild' }] },
    { relations: [{ ...link, sourceKinds: ['item'] }] },
    { relations: [{ ...link, intensity: { min: 100, max: 0 } }] },
    { relations: [link] }, // missing rule
    { events: [{ ...signal, conditions: ['unknown'] }] },
    { events: [{ ...signal, conditions: [{ type: 'compare', left: 1, operator: 'gt', right: 0 }] }] },
    { events: [{ ...signal, conditions: [{ type: 'compare', left: { source: 'unknown' }, operator: 'gte', right: 0 }] }] },
    { events: [{ ...signal, conditions: [{ type: 'alive', entity: 'player' }] }] },
    { events: [{ ...signal, outcomes: [] }] },
    { events: [{ ...signal, outcomes: [{ ...signal.outcomes[0], weight: 0 }] }] },
    { events: [{ ...signal, outcomes: [{ ...signal.outcomes[0], weight: NaN }] }] },
    { events: [{ ...signal, outcomes: [{ ...signal.outcomes[0], operations: [{ type: 'unknown' }] }] }] },
    { events: [{ ...signal, outcomes: [{ ...signal.outcomes[0], operations: [{ type: 'missionStatus', status: 'available' }] }] }] },
    { missions: [{ id: 'quest', name: 'Quest', initialStatus: 'ready', reactions: [] }] },
    { missions: [{ id: 'quest', name: 'Quest', initialStatus: 'active', reactions: ['missing'] }] },
    { reactions: [{ ...notice, on: '' }] },
    { unknown: [] },
  ])('rejects invalid external configuration atomically: %j', invalid => {
    const engine = createEngine(); engine.registerDefinitions({ characters: [citizen] });
    const before = engine.definitions;
    expect(() => engine.registerDefinitions({ ...invalid, factions: [{ id: 'new', name: 'New' }, ...('factions' in invalid ? invalid.factions ?? [] : [])] } as unknown as DefinitionBatch)).toThrow();
    expect(engine.definitions).toBe(before);
    expect(engine.definitions.factions.new).toBeUndefined();
  });
  it('rejects callbacks, cyclic data and non-plain objects at registration', () => {
    for (const extra of [() => true, new Date(), (() => { const c: { self?: unknown } = {}; c.self = c; return c; })()]) expect(() => createEngine().registerDefinitions({ characters: [{ ...citizen, extra }] } as unknown as DefinitionBatch)).toThrow();
    expect(() => createEngine().registerDefinitions({ characters: [{ ...citizen, get name() { return 'Getter'; } }] })).toThrow(/accessors/);
  });
});

describe('public world lifecycle', () => {
  it('uses new IDs, detached handles and integrated map occupancy for newly created characters', () => {
    const { world, target } = setup();
    const faction = world.createFaction('guild');
    expect(new Set(world.inspect.list().map(i => i.id)).size).toBe(3);
    expect(target.id).not.toBe(target.definitionId);
    expect(Object.isFrozen(target)).toBe(true);
    expect(world.move(world.player.id, 1, 0)).toBe(false);
    expect(world.move(target.id, 1, 0)).toBe(false); // water
    expect(world.move(world.player.id, -1, 0)).toBe(false);
    expect(world.move(world.player.id, 1, 1)).toBe(false);
    const npc = world.createCharacter({ definitionId: citizen.id, position: { x: 1, y: 1 }, factionId: faction.id, label: 'Outro', interactions: [] });
    expect(world.inspect.find(npc.id)!.properties).toMatchObject({ factionId: faction.id, label: 'Outro' });
    expect(world.interact({ actorId: target.id, targetId: npc.id })).toMatchObject({ reason: 'noApplicableEvent' });
    expect(world.command({ actorId: target.id, targetId: npc.id, eventId: signal.id, random: () => 0 }).executed).toBe(true);
  });
  it('validates concrete character references and config before allocating a new ID', () => {
    const { world } = setup(); const before = world.inspect.list();
    for (const config of [
      { definitionId: 'missing', position: { x: 1, y: 1 } },
      { definitionId: 'citizen', position: { x: 0.1, y: 1 } },
      { definitionId: 'citizen', position: { x: 1, y: 1 }, factionId: world.player.id },
      { definitionId: 'citizen', position: { x: 1, y: 1 }, interactions: [{ event: 'missing' }] },
    ]) expect(() => world.createCharacter(config)).toThrow();
    expect(world.inspect.list()).toEqual(before);
    expect(world.createFaction('guild').id).toBe('entity_000003');
  });
  it('isolates registries per engine and world, while allowing immutable sharing', () => {
    const { engine, config, world } = setup(); const other = engine.createWorld(config);
    expect(world.definitions.characters.citizen).toBe(other.definitions.characters.citizen);
    world.registerDefinitions({ factions: [{ id: 'onlyHere', name: 'Local' }] });
    expect(other.definitions.factions.onlyHere).toBeUndefined();
    expect(engine.definitions.factions.onlyHere).toBeUndefined();
    engine.registerDefinitions({ factions: [{ id: 'future', name: 'Future' }] });
    expect(world.definitions.factions.future).toBeUndefined();
    expect(engine.createWorld(config).definitions.factions.future).toBeTruthy();
    expect(createEngine().definitions.characters.citizen).toBeUndefined();
  });
  it('owns map, interactions and offer configurations, without returning live instance objects', () => {
    const engine = createEngine(); engine.registerDefinitions(base());
    const map = [['land', 'land']] as ('land' | 'water')[][];
    const world = engine.createWorld({ map, player: { definitionId: 'citizen', position: { x: 0, y: 0 } } });
    const interactions = [{ event: signal.id }]; const position = { x: 1, y: 0 };
    const npc = world.createCharacter({ definitionId: 'citizen', position, interactions });
    map[0][0] = 'water'; interactions[0].event = 'missing'; position.x = 99;
    expect(world.map[0][0]).toBe('land');
    const before = world.inspect.find(npc.id)!;
    expect(world.interact({ actorId: world.player.id, targetId: npc.id, random: () => 0 }).executed).toBe(true);
    expect(before.properties).toMatchObject({ position: { x: 1, y: 0 } });
    expect(Object.isFrozen(world.map[0])).toBe(true);
  });
  it('registers additive content without retroactive reactions, auto-instances or changing old rules', () => {
    const { world, target } = setup();
    world.command({ actorId: world.player.id, targetId: target.id, eventId: signal.id, random: () => 0 });
    const count = world.inspect.list().length;
    world.registerDefinitions({ reactions: [notice], relations: [link] });
    expect(world.inspect.list()).toHaveLength(count);
    expect(world.inspect.list('character').map(s => character(world, s.id).references)).toEqual([{}, {}]);
    const observer = world.createCharacter({ definitionId: 'citizen', position: { x: 0, y: 1 } });
    const relation = world.createRelation({ definitionId: link.id, sourceId: observer.id, targetId: target.id, intensity: 150 });
    expect(world.inspect.find(relation.id)!.properties).toMatchObject({ sourceId: observer.id, targetId: target.id, intensity: 100 }); // unchanged clamp semantics
    expect(character(world, observer.id).references).toEqual({});
    world.command({ actorId: world.player.id, targetId: target.id, eventId: signal.id, random: () => 0 });
    expect(character(world, observer.id).references.hostileTo).toBe(world.player.id);
    expect(world.audit.records().some(r => r.category === 'definition' && r.status === 'registered')).toBe(true);
    expect(world.audit.records().some(r => r.category === 'dispatch' && r.status === 'subscribed' && r.instanceIds.includes(relation.id))).toBe(true);
    const subscriptions = world.audit.records().filter(r => r.status === 'subscribed').length;
    world.registerDefinitions({ reactions: [{ ...notice, id: 'unused' }] });
    expect(world.audit.records().filter(r => r.status === 'subscribed')).toHaveLength(subscriptions);
    expect(world.inspect.list('relation')).toHaveLength(1);
  });
  it('rejects registration during a command, releases its guard on failure, and leaves valid additions possible', () => {
    const { world, target } = setup();
    const addition = { factions: [{ id: 'new', name: 'New' }] };
    expect(() => world.command({ actorId: world.player.id, targetId: target.id, eventId: signal.id, random: () => { world.registerDefinitions(addition); return 0; } })).toThrow(/between narrative executions/);
    expect(world.definitions.factions.new).toBeUndefined();
    expect(world.audit.records().some(r => r.category === 'failure')).toBe(true);
    world.registerDefinitions(addition);
    expect(world.createFaction('new').definitionId).toBe('new');
    expect(() => world.registerDefinitions(addition)).toThrow(/duplicate/);
  });
  it('rejects invalid or duplicate relation endpoints without extra instances or subscriptions', () => {
    const { world, target } = setup(); world.registerDefinitions({ relations: [link], reactions: [notice] });
    const faction = world.createFaction('guild');
    for (const sourceId of ['absent', faction.id]) expect(() => world.createRelation({ definitionId: link.id, sourceId, targetId: target.id, intensity: 90 })).toThrow();
    const relation = world.createRelation({ definitionId: link.id, sourceId: world.player.id, targetId: target.id, intensity: 90 });
    expect(() => world.createRelation({ definitionId: link.id, sourceId: world.player.id, targetId: target.id, intensity: 90 })).toThrow(/Duplicate/);
    expect(world.inspect.list('relation').map(s => s.id)).toEqual([relation.id]);
    world.command({ eventId: signal.id, actorId: target.id, targetId: world.player.id, random: () => 0 });
    expect(character(world, world.player.id).references).toEqual({}); // direction is preserved
  });
  it('keeps normal refusals as results and invalid definitions/participants as exceptions', () => {
    const { world, target } = setup();
    expect(world.command({ eventId: signal.id, actorId: world.player.id, targetId: world.player.id })).toMatchObject({ executed: false, reason: 'adjacent' });
    expect(() => world.command({ eventId: 'missing', actorId: world.player.id, targetId: target.id })).toThrow(/Unknown event/);
    expect(() => world.interact({ actorId: 'missing', targetId: target.id })).toThrow(/reference/);
    expect(world.audit.records().filter(r => r.category === 'fact')).toEqual([]);
    expect(world.audit.records().some(r => r.category === 'failure')).toBe(true);
  });
  it('keeps world snapshots and IDs unchanged when additive registration fails', () => {
    const { world } = setup(); const before = world.inspect.list(); const definitions = world.definitions;
    expect(() => world.registerDefinitions({ factions: [{ id: 'new', name: 'New' }], relations: [link] })).toThrow(/missing reference/);
    expect(world.inspect.list()).toEqual(before);
    expect(world.definitions).toBe(definitions);
    expect(world.createFaction('guild').id).toBe('entity_000003');
  });
  it.each([[], [[]], [['lava']], [['land'], ['land', 'land']]].map(map => ({ map })))('rejects an invalid supplied map: %j', ({ map }) => {
    const engine = createEngine(); engine.registerDefinitions({ characters: [citizen] });
    expect(() => engine.createWorld({ map: map as never, player: { definitionId: citizen.id, position: { x: 0, y: 0 } } })).toThrow(/map/);
  });
});
