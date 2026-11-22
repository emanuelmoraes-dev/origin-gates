import { expect, it } from 'vitest';
import type { AuditRecord, NarrativeWorld } from '@origin-gates/narrative-engine';
import { createWorld } from '../src/content/originGates';
import { programmaticWorld } from './fixtures/programmatic';
import { exerciseRivals, exerciseTraining, type Driver } from './fixtures/actions';

// Composition creation legitimately adds IDs and provenance. Normalize concrete
// references by the registration order of corresponding non-composition instances.
function semantics(world: NarrativeWorld, value: unknown = world.inspect.list()) {
  const instances = world.inspect.list().filter(s => s.kind !== 'composition');
  const ids = new Map(instances.map((s, i) => [s.id, `instance_${i}`]));
  const normalize = (data: unknown): unknown => {
    if (typeof data === 'string') return ids.get(data) ?? data;
    if (Array.isArray(data)) return data.filter(item => !(item && typeof item === 'object' && 'kind' in item && item.kind === 'composition')).map(normalize);
    if (data && typeof data === 'object') return Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'createdByCompositionId').map(([key, item]) => [key, normalize(item)]));
    return data;
  };
  return normalize(value);
}
it.each(['training', 'rivals', 'social'] as const)('production composition and independent TypeScript proof are equivalent: %s', id => {
  const json = createWorld(id, { capacity: 10000 });
  const ts = programmaticWorld(id);
  const compositions = json.inspect.list('composition');
  expect(compositions).toHaveLength(1);
  for (const s of json.inspect.list().filter(s => s.kind !== 'composition' && s.id !== json.player.id)) {
    expect(s.properties).toMatchObject({ createdByCompositionId: compositions[0].id });
  }
  expect(semantics(json)).toEqual(semantics(ts));
  const run = (w: Driver) => id === 'training' ? exerciseTraining(w) : id === 'rivals' ? exerciseRivals(w) : [w.interact({ actorId: w.player.id, targetId: w.inspect.list('character')[1].id, random: () => 0.75 }), w.interact({ actorId: w.player.id, targetId: w.inspect.list('character')[1].id, random: () => 0 })];
  const tsResults = run(ts);
  const jsonResults = run(json);
  expect(semantics(ts, tsResults)).toEqual(semantics(json, jsonResults));
  expect(semantics(ts)).toEqual(semantics(json));
  const outcomes = (records: readonly AuditRecord[]) => records.filter(r => r.category === 'outcome' && r.status === 'selected').map(r => r.data);
  expect(outcomes(ts.audit.records())).toEqual(outcomes(json.audit.records()));
});
