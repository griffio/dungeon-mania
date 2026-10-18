import { TILE } from './dungeon.js';

// Where each member ends a group move (PLAN.md 3.2, 7.5). The party follows the leader's path
// like a snake: the leader at the goal, the next member one tile back along the path, and so on,
// with the old line behind the leader filling in if the path is short. That makes single file in
// corridors automatic. When the leader stops in a room, the party closes up into the 2x2 block of
// the marching-order widget instead: front-left, front-right, back-left, back-right.
//   path: the leader's tiles, start to goal. chain: members' tiles in marching order (chain[0] is
//   the leader's start). ok(i): is tile i a good place to stop (explored, not a pit or doorway).
// Returns the target tile for each position in the marching order.
export function groupTargets(d, path, chain, ok = () => true) {
  const seq = [];
  const add = (i) => { if (!seq.includes(i)) seq.push(i); };
  for (let k = path.length - 1; k >= 0; k--) add(path[k]);
  for (let k = 1; k < chain.length; k++) add(chain[k]);
  // followers stop where ok() allows (not down a pit or in a doorway) if there are enough such
  // tiles along the line; the leader always stops at the goal
  const good = seq.filter((i, k) => k === 0 || ok(i));
  const snake = (good.length >= chain.length ? good : seq).slice(0, chain.length);
  const block = path.length > 1 && blockTargets(d, path, chain.length, ok);
  return block || snake;
}

// The 2x2 block behind the leader, facing the way it last stepped, if the room has space.
function blockTargets(d, path, n, ok) {
  const goal = path[path.length - 1], room = d.roomOf(goal);
  if (!room || room.passage) return null;
  const [gx, gy] = d.xy(goal), [px, py] = d.xy(path[path.length - 2]);
  // the last step, made axis-aligned (a diagonal counts as its east-west part)
  let fx = Math.sign(gx - px), fy = Math.sign(gy - py);
  if (fx && fy) fy = 0;
  const free = (x, y) => {
    if (!d.inside(x, y)) return -1;
    const i = d.idx(x, y);
    return TILE[d.t[i]].walk && !TILE[d.t[i]].door && d.roomOf(i) === room && ok(i) ? i : -1;
  };
  // try the leader's right first, then its left
  for (const side of [1, -1]) {
    const sx = -fy * side, sy = fx * side;
    const slots = [[gx, gy], [gx + sx, gy + sy], [gx - fx, gy - fy], [gx - fx + sx, gy - fy + sy]].slice(0, n).map(([x, y]) => free(x, y));
    if (slots.every((i) => i >= 0)) return slots;
  }
  return null;
}
