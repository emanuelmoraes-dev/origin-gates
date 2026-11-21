import { expect, it } from 'vitest';
import { createExample } from '../examples/programmatic-world';

it('runs the documented minimal and additive API example', () => {
  const { world, other, relation } = createExample();
  expect(world.inspect.list()).toHaveLength(3);
  expect(world.inspect.find(relation.id)!.properties).toMatchObject({ sourceId: world.player.id, targetId: other.id, intensity: 90 });
  expect(world.audit.records().some(r => r.category === 'definition' && r.status === 'registered')).toBe(true);
});
