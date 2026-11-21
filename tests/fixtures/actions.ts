import type { EventResult, InstanceSnapshot, NarrativeWorld, Position, WorldMap } from '../../src/game';

export interface Driver {
  player: { id: string };
  map: WorldMap;
  inspect: { list(kind?: InstanceSnapshot['kind']): readonly InstanceSnapshot[]; find(id: string): InstanceSnapshot | undefined };
  move(actorId: string, dx: number, dy: number): boolean;
  interact(request: { actorId: string; targetId: string; random: () => number }): EventResult;
  react(options?: { random?: () => number }): readonly EventResult[];
}
export interface CharacterProperties { position: Position; hp: number; attributes: Record<string, number>; references: Record<string, string>; label?: string }
export interface MissionProperties { executorId: string; contractorId: string; targetId: string; status: string }
export const character = (world: Pick<NarrativeWorld, 'inspect'>, id: string) => world.inspect.find(id)!.properties as unknown as CharacterProperties;
export const mission = (snapshot: InstanceSnapshot) => snapshot.properties as unknown as MissionProperties;

/** Exercise actual movement rather than teleporting or editing canonical state. */
export function approach(world: Driver, targetId: string): void {
  const start = character(world, world.player.id).position;
  const goal = character(world, targetId).position;
  const occupied = world.inspect.list('character').filter(s => s.id !== world.player.id && character(world, s.id).hp > 0).map(s => character(world, s.id).position);
  const queue: { p: Position; path: Position[] }[] = [{ p: start, path: [] }];
  const visited = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const { p, path } = queue[i];
    if (Math.abs(p.x - goal.x) + Math.abs(p.y - goal.y) === 1) {
      let current = start;
      for (const step of path) {
        if (!world.move(world.player.id, step.x - current.x, step.y - current.y)) throw new Error('Blocked proof path');
        current = step;
      }
      return;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: p.x + dx, y: p.y + dy };
      const key = `${next.x},${next.y}`;
      if (visited.has(key) || world.map[next.y]?.[next.x] !== 'land' || occupied.some(o => o.x === next.x && o.y === next.y)) continue;
      visited.add(key); queue.push({ p: next, path: [...path, next] });
    }
  }
  throw new Error('No proof path to target');
}
export function interactWith(world: Driver, targetId: string, roll = 0): EventResult {
  approach(world, targetId);
  return world.interact({ actorId: world.player.id, targetId, random: () => roll });
}
export function defeat(world: Driver, targetId: string): void {
  approach(world, targetId);
  for (let i = 0; character(world, targetId).hp > 0 && i < 100; i++) world.interact({ actorId: world.player.id, targetId, random: () => 0 });
  if (character(world, targetId).hp !== 0) throw new Error('Proof failed to defeat target');
  world.react({ random: () => 0 });
}
export function exerciseTraining(world: Driver): EventResult[] {
  const target = world.inspect.list('character').find(s => s.definitionId === 'enemy')!;
  const results = [interactWith(world, target.id, 0.75), interactWith(world, target.id, 0)];
  defeat(world, target.id);
  results.push(interactWith(world, target.id, 0));
  return results;
}
export function exerciseRivals(world: Driver): EventResult[] {
  const representatives = world.inspect.list('character').filter(s => s.definitionId.endsWith('Representative'));
  const results = representatives.map(rep => interactWith(world, rep.id));
  results.push(interactWith(world, representatives[0].id)); // valid selection, refused delivery
  const first = mission(world.inspect.list('mission')[0]);
  const second = mission(world.inspect.list('mission')[1]);
  defeat(world, first.targetId);
  results.push(interactWith(world, representatives[0].id));
  results.push(interactWith(world, representatives[0].id)); // repeat while other mission remains active
  defeat(world, second.targetId);
  results.push(interactWith(world, representatives[1].id));
  return results;
}
