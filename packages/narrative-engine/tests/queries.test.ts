import { describe, expect, it, vi } from 'vitest';
import { createEngine } from '@origin-gates/narrative-engine';
import { programmaticWorld } from './fixtures/programmatic.js';
import { defeat, interactWith, mission } from './fixtures/actions.js';

function setup(audit = true) {
  const engine = createEngine();
  engine.registerDefinitions({
    characters: [{ id: 'citizen', name: 'Cidadão', maxHp: 100, color: '#ffffff', interactions: [{ event: 'attack' }] }],
    factions: [{ id: 'guild', name: 'Guilda' }],
    relations: [{ id: 'trust', name: 'Confiança', sourceKinds: ['faction'], targetKinds: ['character'], unique: true, reactions: [] }],
    events: [{ id: 'attack', conditions: ['actorAlive', 'targetAlive', 'adjacent'], outcomes: [{ id: 'hit', weight: 1, operations: [{ type: 'damage', amount: 50 }], feedback: { color: '#ff0000', durationMs: 500, message: 'Acerto' } }] }],
  });
  const world = engine.createWorld({ map: [['land', 'land', 'land'], ['land', 'land', 'land']], player: { definitionId: 'citizen', position: { x: 0, y: 0 } }, audit: { enabled: audit } });
  const a = world.createCharacter({ definitionId: 'citizen', label: 'A', position: { x: 1, y: 0 } });
  const b = world.createCharacter({ definitionId: 'citizen', label: 'B', position: { x: 0, y: 1 } });
  const faction = world.createFaction('guild');
  const relation = world.createRelation({ definitionId: 'trust', sourceId: faction.id, targetId: a.id, intensity: 42 });
  return { world, a, b, faction, relation };
}
describe('public narrative queries, independent of diagnostic inspection', () => {
  it('returns typed current characters in creation order, including player and dead characters', () => {
    const { world, a, b } = setup();
    expect(world.query.characters().map(c => c.id)).toEqual([world.player.id, a.id, b.id]);
    expect(world.query.character(a.id)).toMatchObject({ kind: 'character', definitionId: 'citizen', name: 'Cidadão', label: 'A', color: '#ffffff', hp: 100, maxHp: 100, alive: true, attributes: { damage: 10 } });
  });
  it('distinguishes absence, invalid IDs and incompatible categories', () => {
    const { world, faction } = setup();
    expect(world.query.character('absent')).toBeUndefined();
    expect(world.query.character('__proto__')).toBeUndefined();
    expect(() => world.query.character('')).toThrow();
    expect(() => world.query.character(faction.id)).toThrow(/Invalid character reference/);
    expect(() => world.query.adjacent('absent')).toThrow();
    expect(() => world.query.adjacent(faction.id)).toThrow();
    expect(() => world.query.missions({ executorId: faction.id })).toThrow();
    expect(world.query.missions({ executorId: 'absent' })).toEqual([]);
  });
  it('shares adjacency and movement rules, retaining deterministic target order', () => {
    const { world, a, b } = setup();
    expect(world.query.adjacent(world.player.id).map(c => c.id)).toEqual([a.id, b.id]);
    expect(world.move(world.player.id, 1, 0)).toBe(false);
    expect(world.move(a.id, 1, 0)).toBe(true);
    expect(world.query.adjacent(world.player.id).map(c => c.id)).toEqual([b.id]);
    expect(world.query.character(a.id)!.position).toEqual({ x: 2, y: 0 });
  });
  it('updates HP/alive after damage and excludes dead neighbors without deleting their queries', () => {
    const { world, a, b } = setup();
    const old = world.query.character(a.id)!;
    expect(world.interact({ actorId: world.player.id, random: () => 0 })).toMatchObject({ targetHp: 50 }); // first adjacent
    expect(world.query.character(a.id)!.hp).toBe(50);
    world.interact({ actorId: world.player.id, targetId: a.id, random: () => 0 });
    expect(world.query.character(a.id)).toMatchObject({ hp: 0, alive: false });
    expect(world.query.adjacent(world.player.id).map(c => c.id)).toEqual([b.id]);
    expect(world.move(world.player.id, 1, 0)).toBe(true);
    expect(old.hp).toBe(100);
  });
  it('rejects no-adjacent interactions through the public command path without RNG or invented facts', () => {
    const { world, a, b } = setup();
    world.move(a.id, 1, 0); world.move(b.id, 1, 0);
    const random = vi.fn(() => 0); world.audit.clear();
    expect(world.interact({ actorId: world.player.id, random })).toMatchObject({ executed: false, reason: 'noApplicableEvent' });
    expect(random).not.toHaveBeenCalled();
    expect(world.audit.records().some(r => r.category === 'interaction' && r.status === 'rejected')).toBe(true);
    expect(world.audit.records().some(r => ['fact', 'mutation', 'outcome', 'failure'].includes(r.category))).toBe(false);
  });
  it('filters relations by definition, source, target and either participant', () => {
    const { world, a, b, faction, relation } = setup();
    expect(world.query.factions()).toEqual([expect.objectContaining({ id: faction.id, name: 'Guilda' })]);
    expect(world.query.relations({ definitionId: 'trust', sourceId: faction.id, targetId: a.id })).toEqual([expect.objectContaining({ id: relation.id, name: 'Confiança', intensity: 42 })]);
    expect(world.query.relations({ participantId: a.id })).toHaveLength(1);
    expect(world.query.relations({ participantId: faction.id })).toHaveLength(1);
    expect(world.query.relations({ participantId: b.id })).toEqual([]);
    expect(world.query.relations({ sourceId: 'absent' })).toEqual([]);
    expect(world.query.relations({ definitionId: 'absent' })).toEqual([]);
  });
  it('returns deeply frozen detached data without an audit encoding or live arrays', () => {
    const { world, a } = setup(); const characters = world.query.characters(); const view = characters[1];
    expect(Object.isFrozen(characters)).toBe(true); expect(Object.isFrozen(view.position)).toBe(true);
    expect(Object.isFrozen(view.attributes)).toBe(true); expect(Object.isFrozen(view.references)).toBe(true);
    expect(Reflect.set(view, 'hp', 0)).toBe(false); expect(Reflect.set(view.position, 'x', 999)).toBe(false);
    expect(view.offer).toBeUndefined();
    expect(world.query.character(a.id)!.hp).toBe(100);
    expect(world.query.characters()).not.toBe(characters);
  });
  it('reads and filters missions, updates pending state, reputation, rewards and immutable offers', () => {
    const world = programmaticWorld('rivals');
    const rep = world.query.characters().find(c => c.definitionId === 'governmentRepresentative')!;
    const before = world.query.relations(); const offer = rep.offer!;
    expect(Object.isFrozen(offer.spawn)).toBe(true);
    expect(world.query.missions()).toEqual([]);
    interactWith(world, rep.id);
    const active = world.query.missions({ executorId: world.player.id, contractorId: rep.id, pending: true });
    expect(active).toHaveLength(1); expect(active[0].status).toBe('active');
    expect(world.query.missions({ pending: false })).toEqual([]);
    defeat(world, active[0].targetId);
    expect(world.query.missions({ pending: true })[0].status).toBe('ready');
    interactWith(world, rep.id);
    expect(world.query.missions({ pending: true })).toEqual([]);
    expect(world.query.missions({ pending: false })[0].status).toBe('completed');
    expect(world.query.relations().map(r => r.intensity)).toEqual([70, 35]);
    expect(before.map(r => r.intensity)).toEqual([50, 50]);
    expect(world.query.character(world.player.id)!.attributes.damage).toBe(15);
    expect(active[0].status).toBe('active');
    expect(world.query.missions({ contractorId: 'absent' })).toEqual([]);
  });
  it('isolates queries between worlds and produces no diagnostic activity', () => {
    const a = setup(); const b = setup();
    a.world.interact({ actorId: a.world.player.id, targetId: a.a.id, random: () => 0 });
    expect(b.world.query.character(b.a.id)!.hp).toBe(100);
    a.world.audit.clear();
    a.world.query.characters(); a.world.query.adjacent(a.world.player.id); a.world.query.factions(); a.world.query.relations(); a.world.query.missions();
    expect(a.world.audit.records()).toEqual([]);
  });
  it('has the same current-state results with audit enabled or disabled', () => {
    const run = (audit: boolean) => { const { world, a } = setup(audit); world.interact({ actorId: world.player.id, targetId: a.id, random: () => 0 }); return { characters: world.query.characters(), relations: world.query.relations(), missions: world.query.missions() }; };
    expect(run(true)).toEqual(run(false));
  });
});
