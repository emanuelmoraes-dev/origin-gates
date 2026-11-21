import type { WorldMap } from '../game/state';

// Source of the map can change without changing movement or rendering.
export const worldMap: WorldMap = [
  'LLLLLLWWLL',
  'LLLLLLWWLL',
  'LLLLLLWLLL',
  'LLWWLLLLLL',
  'LLWWLLLLLL',
  'LLLLLLLLLL',
  'LLLLLLWWLL',
  'LWLLLLWWLL',
  'LWWLLLLLLL',
  'LLLLLLLLLL',
].map(row => [...row].map(tile => tile === 'L' ? 'land' : 'water'));
