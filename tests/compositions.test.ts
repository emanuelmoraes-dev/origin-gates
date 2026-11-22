import { describe, expect, it } from 'vitest';
import { parseReference, ReferenceResolutionError, type CompositionHandle, type NarrativeWorld } from '../src/game';
import { compositionWorld } from './fixtures/compositions';
import { character, defeat, interactWith, mission } from './fixtures/actions';

const city = (world: NarrativeWorld, key: string, x: number) => world.instantiateComposition({ definitionId: 'rivalCity', key, origin: { x, y: 2 }, bindings: { player: 'root#player' } });
const score = (world: NarrativeWorld, camp: CompositionHandle, key: string) => (world.inspect.find(camp.resolve(key).id)!.properties as { intensity: number }).intensity;

describe('compositions built exclusively through the public API', () => {
  it('A: creates two independent training camps, resolves coordinates and executes hit/dodge/death', () => {
    const world = compositionWorld();
    const a = world.instantiateComposition({ definitionId: 'trainingCamp', key: 'campA', origin: { x: 5, y: 5 } });
    const b = world.instantiateComposition({ definitionId: 'trainingCamp', key: 'campB', origin: { x: 12, y: 5 } });
    const guardian = a.resolve('guardian');
    expect(a.id).not.toBe(b.id); expect(guardian.id).not.toBe(b.resolve('guardian').id);
    expect(character(world, guardian.id).position).toEqual({ x: 5, y: 5 });
    expect(world.inspect.find(guardian.id)!.properties).toMatchObject({ createdByCompositionId: a.id });
    expect(interactWith(world, guardian.id, 0.75)).toMatchObject({ outcomeId: 'dodge', damage: 0 });
    expect(interactWith(world, guardian.id, 0)).toMatchObject({ outcomeId: 'hit', damage: 10, targetHp: 90 });
    expect(character(world, b.resolve('guardian').id).hp).toBe(100);
    defeat(world, guardian.id);
    expect(a.resolve('guardian').id).toBe(guardian.id); // death cannot redirect the historical symbol
    expect(world.inspect.list('composition')).toHaveLength(2);
    expect(world.inspect.list('character')).toHaveLength(3); // player was not recreated
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(world.inspect.find(a.id)!.properties)).toBe(true);
  });
  it('B: two cities preserve local factions, offers, spawns, simultaneous/repeated missions and rewards', () => {
    const world = compositionWorld(); const a = city(world, 'cityA', 2); const b = city(world, 'cityB', 22);
    const aOfficial = a.resolve('official'); const bOfficial = b.resolve('official');
    expect(world.inspect.list('faction')).toHaveLength(4);
    expect(new Set(world.inspect.list().map(s => s.id)).size).toBe(world.inspect.list().length);
    expect(a.resolve('government').id).not.toBe(b.resolve('government').id);
    expect(character(world, aOfficial.id).position).toEqual({ x: 5, y: 4 });
    expect(character(world, bOfficial.id).position).toEqual({ x: 25, y: 4 });
    expect(world.inspect.find(aOfficial.id)!.properties).toMatchObject({ factionId: a.resolve('government').id, offer: { opponentId: a.resolve('resistance').id, spawn: { x: 10, y: 5 } } });
    expect(world.inspect.find(bOfficial.id)!.properties).toMatchObject({ factionId: b.resolve('government').id, offer: { opponentId: b.resolve('resistance').id, spawn: { x: 30, y: 5 } } });
    expect(interactWith(world, aOfficial.id).executed).toBe(true);
    expect(interactWith(world, bOfficial.id).executed).toBe(true);
    const [aMission, bMission] = world.inspect.list('mission').map(mission);
    expect(character(world, aMission.targetId).position).toEqual({ x: 10, y: 5 });
    expect(character(world, bMission.targetId).position).toEqual({ x: 30, y: 5 });
    // Replacing a role changes neither the contractor nor the existing target.
    world.assignRole({ compositionId: a.id, role: 'representative', instanceId: a.resolve('rebel').id });
    expect(mission(world.inspect.list('mission')[0])).toEqual(aMission);
    defeat(world, aMission.targetId);
    expect(interactWith(world, aOfficial.id)).toMatchObject({ outcomeId: 'completed' });
    expect([score(world, a, 'governmentReputation'), score(world, a, 'resistanceReputation')]).toEqual([70, 35]);
    expect([score(world, b, 'governmentReputation'), score(world, b, 'resistanceReputation')]).toEqual([50, 50]);
    expect(character(world, world.player.id).attributes.damage).toBe(15);
    expect(mission(world.inspect.list('mission')[1]).status).toBe('active');
    expect(interactWith(world, aOfficial.id).executed).toBe(true);
    const repeat = mission(world.inspect.list('mission')[2]);
    expect(repeat.targetId).not.toBe(aMission.targetId);
    expect(character(world, repeat.targetId).position).toEqual({ x: 10, y: 5 });
    expect(world.inspect.find(repeat.targetId)!.properties).not.toHaveProperty('createdByCompositionId'); // no inferred origin for future operations
    defeat(world, bMission.targetId);
    expect(interactWith(world, bOfficial.id).executed).toBe(true);
    expect([score(world, a, 'governmentReputation'), score(world, b, 'governmentReputation')]).toEqual([70, 70]);
    expect(character(world, world.player.id).attributes.damage).toBe(20);
    const link = world.createRelation({ definitionId: 'link', source: 'cityA#government', target: 'cityB#government', intensity: 30 });
    expect(link.kind).toBe('relation');
  });
  it.each([0, 0.75])('C: social subscriptions remain independent for homonymous symbols (roll %s)', roll => {
    const world = compositionWorld();
    const a = world.instantiateComposition({ definitionId: 'socialGroup', key: 'groupA', origin: { x: 4, y: 5 } });
    const b = world.instantiateComposition({ definitionId: 'socialGroup', key: 'groupB', origin: { x: 24, y: 5 } });
    expect(interactWith(world, a.resolve('victim').id, roll)).toMatchObject({ facts: [{ type: 'attackAttempted' }] });
    expect(['A', 'B', 'C', 'D', 'E'].map(key => character(world, a.resolve(key).id).references.hostileTo)).toEqual([world.player.id, undefined, undefined, undefined, undefined]);
    expect(['A', 'B', 'C', 'D', 'E'].map(key => character(world, b.resolve(key).id).references.hostileTo)).toEqual(Array(5).fill(undefined));
    expect(world.audit.records().filter(r => r.category === 'reaction' && r.status === 'applied')).toHaveLength(1);
    interactWith(world, b.resolve('victim').id, roll);
    expect(character(world, b.resolve('A').id).references.hostileTo).toBe(world.player.id);
    expect(world.audit.records().filter(r => r.status === 'subscribed')).toHaveLength(8);
  });
  it('D/F: succession changes the role but preserves symbols, identity, origin and concrete relations', () => {
    const world = compositionWorld();
    const court = world.instantiateComposition({ definitionId: 'royalCourt', key: 'olimpo', origin: { x: 5, y: 5 } });
    const arthur = court.resolve('Arthur'); const edward = court.resolve('Edward');
    expect(court.resolve('<rei>')).toEqual(arthur);
    expect(world.resolveReference('olimpo#<rei>')).toEqual(world.resolveReference({ type: 'role', scope: 'olimpo', key: 'rei' }));
    expect(world.resolveReference('olimpo#Arthur')).toEqual(world.resolveReference({ type: 'symbol', scope: 'olimpo', key: 'Arthur' }));
    expect(world.resolveReference(arthur.id)).toEqual(world.resolveReference({ type: 'instance', id: arthur.id }));
    expect(court.resolve({ type: 'symbol', key: 'Arthur' })).toEqual(arthur);
    expect(court.resolve({ type: 'role', key: 'rei' })).toEqual(arthur);
    expect(world.resolveReference('root#player')).toEqual(world.resolveReference({ type: 'symbol', scope: 'root', key: 'player' }));
    const gratitude = world.inspect.find(court.resolve('gratitude').id)!;
    world.assignRole({ compositionId: court.id, role: 'rei', instanceId: edward.id });
    expect(court.resolve('<rei>')).toEqual(edward);
    expect(court.resolve('Arthur')).toEqual(arthur);
    expect(world.inspect.find(gratitude.id)).toEqual(gratitude);
    expect(gratitude.properties).toMatchObject({ targetId: arthur.id, createdByCompositionId: court.id });
    expect(world.inspect.find(court.resolve('membership').id)!.properties).toMatchObject({ sourceId: edward.id, targetId: court.id });
    world.assignRole({ compositionId: court.id, role: 'rei', instanceId: null });
    expect(court.tryResolve('<rei>')).toBeUndefined();
    expect(() => court.resolve('<rei>')).toThrowError(ReferenceResolutionError);
    expect(court.tryResolve('<envoy>')).toBeUndefined();
    expect(world.inspect.find(arthur.id)!.properties).toMatchObject({ createdByCompositionId: court.id });
    const change = world.audit.records().find(r => r.category === 'mutation' && (r.data as { property?: string; after?: string }).property === 'roles.rei' && (r.data as { after?: string }).after === edward.id)!;
    expect(change.data).toMatchObject({ before: arthur.id, after: edward.id });
  });
  it('E: external bindings capture a prince without moving, duplicating or transferring origin', () => {
    const world = compositionWorld();
    const court = world.instantiateComposition({ definitionId: 'family', key: 'family', origin: { x: 5, y: 5 } });
    const prince = court.resolve('prince'); const before = world.inspect.find(prince.id);
    const faction = world.createFaction('government', { key: 'government' });
    const army = world.instantiateComposition({ definitionId: 'army', key: 'army', origin: { x: 15, y: 15 }, bindings: { commander: 'family#prince', faction: faction.id } });
    expect(army.resolve('<militaryCommander>')).toEqual(prince);
    expect(world.inspect.find(prince.id)).toEqual(before);
    expect(world.inspect.list('character')).toHaveLength(3); // player, prince, soldier
    expect(world.inspect.find(army.id)!.properties).toMatchObject({ bindings: { commander: prince.id, faction: faction.id } });
    expect(world.inspect.find(army.resolve('gratitude').id)!.properties).toMatchObject({ sourceId: army.resolve('soldier').id, targetId: prince.id, createdByCompositionId: army.id });
    expect(world.resolveReference('root#government')).toEqual(faction);
    expect(() => army.resolve('prince')).toThrowError(ReferenceResolutionError); // no implicit symbol for the external participant
  });
  it('captures a binding and relation to a role once, while later role queries remain dynamic', () => {
    const world = compositionWorld(); const court = world.instantiateComposition({ definitionId: 'royalCourt', key: 'court', origin: { x: 5, y: 5 } });
    const faction = world.createFaction('government');
    const army = world.instantiateComposition({ definitionId: 'army', origin: { x: 15, y: 15 }, bindings: { commander: 'court#<rei>', faction: faction.id } });
    const original = army.resolve('<militaryCommander>');
    const relation = world.createRelation({ definitionId: 'gratitude', source: 'root#player', target: 'court#<rei>', intensity: 10 });
    world.assignRole({ compositionId: court.id, role: 'rei', instanceId: court.resolve('Edward').id });
    expect(army.resolve('<militaryCommander>')).toEqual(original);
    expect(world.inspect.find(relation.id)!.properties).toMatchObject({ targetId: original.id });
    expect(court.resolve('<rei>').id).not.toBe(original.id);
  });
  it('audits construction under one causal chain and exports detached composition state', () => {
    const world = compositionWorld(); world.audit.clear();
    const court = world.instantiateComposition({ definitionId: 'royalCourt', key: 'court', origin: { x: 5, y: 5 } });
    const records = world.audit.records();
    expect(new Set(records.map(r => r.traceId)).size).toBe(1);
    const ids = new Set(records.map(r => r.id));
    expect(records.every(r => !r.parentId || ids.has(r.parentId))).toBe(true);
    for (const category of ['composition', 'reference', 'instance', 'operation', 'role', 'mutation']) expect(records.some(r => r.category === category)).toBe(true);
    const creation = records.find(r => r.category === 'instance' && r.status === 'created' && r.instanceIds.includes(court.resolve('Arthur').id))!;
    expect(creation.data).toMatchObject({ properties: { createdByCompositionId: court.id } });
    expect(records.some(r => r.category === 'composition' && r.status === 'validated')).toBe(true);
    const diagnostic = world.diagnostics();
    expect(JSON.parse(JSON.stringify(diagnostic)).instances.find((s: { id: string }) => s.id === court.id).properties.roles.rei).toBe(court.resolve('Arthur').id);
    world.assignRole({ compositionId: court.id, role: 'rei', instanceId: court.resolve('Edward').id });
    expect(diagnostic.instances.find(s => s.id === court.id)!.properties).toMatchObject({ roles: { rei: court.resolve('Arthur').id } });
    world.audit.clear(); court.resolve('Arthur'); court.tryResolve('<envoy>');
    expect(world.audit.records()).toEqual([]); // pure resolution is silent
  });
  it.each(['trainingCamp', 'rivalCity', 'socialGroup', 'royalCourt'] as const)('preserves %s behavior with audit enabled/disabled', definitionId => {
    const worlds = [compositionWorld(), compositionWorld(false)];
    const results = worlds.map(world => {
      const camp = world.instantiateComposition({ definitionId, key: 'sample', origin: { x: 5, y: 5 }, ...(definitionId === 'rivalCity' ? { bindings: { player: 'root#player' } } : {}) });
      if (definitionId === 'royalCourt') world.assignRole({ compositionId: camp.id, role: 'rei', instanceId: camp.resolve('Edward').id });
      else if (definitionId === 'rivalCity') interactWith(world, camp.resolve('official').id);
      else interactWith(world, camp.resolve(definitionId === 'trainingCamp' ? 'guardian' : 'victim').id, 0.75);
      return world.inspect.list();
    });
    expect(results[0]).toEqual(results[1]);
    expect(worlds[1].audit.records()).toEqual([]);
  });
  it('keeps symbols and definition coordinates stable after movement', () => {
    const world = compositionWorld(); const camp = world.instantiateComposition({ definitionId: 'trainingCamp', origin: { x: 5, y: 5 } });
    const original = camp.resolve('guardian');
    expect(world.move(original.id, 1, 0)).toBe(true);
    expect(camp.resolve('guardian')).toEqual(original);
    expect(world.inspect.find(original.id)!.properties).toMatchObject({ createdByCompositionId: camp.id, position: { x: 6, y: 5 } });
    expect(world.definitions.compositions.trainingCamp.characters![0].position).toEqual({ x: 0, y: 0 });
    expect(parseReference('court#<rei>')).toEqual({ type: 'role', scope: 'court', key: 'rei' });
  });
});
