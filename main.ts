// Sokoban solver for sokoban-solver-01-run-20261121.
//
// Strategy: the generator builds every level as a one-square-wide
// hallway with independent rooms opening off it, and a level's
// push optimum is the sum of its rooms' optima. So this solver
// decomposes each level into rooms (the floor components left when
// the player's hallway row is removed), solves every room on its
// own with a push-based A* search, and concatenates the walks.
//
// The room search is push-optimal: its heuristic is a minimum-cost
// matching between boxes and goals over true floor distances
// (boxes ignored), which never overestimates, so the first goal
// state A* settles has the fewest possible pushes. Dead squares
// (squares a box can never leave towards any goal) and 2x2 freeze
// blocks prune the search. If decomposition ever fails, a
// whole-board push A* with the same machinery is the fallback.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const DIRS = [
  { dx: 0, dy: -1, ch: 'u' },
  { dx: 0, dy: 1, ch: 'd' },
  { dx: -1, dy: 0, ch: 'l' },
  { dx: 1, dy: 0, ch: 'r' },
];

interface Level {
  w: number;
  h: number;
  walls: Set<number>;
  goals: number[];
  boxes: number[];
  player: number;
}

function parseLevel(text: string): Level {
  const rows = text.replace(/\r/g, '').split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const walls = new Set<number>();
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x] ?? '#';
      const id = y * w + x;
      if (c === '#') walls.add(id);
      else {
        if (c === '.' || c === '*' || c === '+') goals.push(id);
        if (c === '$' || c === '*') boxes.push(id);
        if (c === '@' || c === '+') player = id;
      }
    }
  }
  return { w, h, walls, goals, boxes, player };
}

// BFS over floor squares (walls and boxes as obstacles); returns a
// map from square to the move string that walks the player there.
function walkPaths(
  lv: Level, floor: Set<number>, from: number, blocked: Set<number>,
): Map<number, string> {
  const out = new Map<number, string>();
  if (!floor.has(from)) return out;
  out.set(from, '');
  const queue = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const cx = cur % lv.w;
    const cy = Math.floor(cur / lv.w);
    for (const d of DIRS) {
      const nx = cx + d.dx;
      const ny = cy + d.dy;
      if (nx < 0 || ny < 0 || nx >= lv.w || ny >= lv.h) continue;
      const nid = ny * lv.w + nx;
      if (!floor.has(nid) || blocked.has(nid) || out.has(nid)) continue;
      out.set(nid, out.get(cur)! + d.ch);
      queue.push(nid);
    }
  }
  return out;
}

// All-pairs floor distances from every goal (boxes ignored), used
// both for the matching heuristic and for dead-square detection.
function goalDistances(lv: Level, floor: Set<number>): Map<number, number[]> {
  const dist = new Map<number, number[]>();
  lv.goals.forEach((g, gi) => {
    const dmap = new Map<number, number>();
    dmap.set(g, 0);
    const queue = [g];
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      const cx = cur % lv.w;
      const cy = Math.floor(cur / lv.w);
      for (const d of DIRS) {
        const nx = cx + d.dx;
        const ny = cy + d.dy;
        if (nx < 0 || ny < 0 || nx >= lv.w || ny >= lv.h) continue;
        const nid = ny * lv.w + nx;
        if (!floor.has(nid) || dmap.has(nid)) continue;
        dmap.set(nid, dmap.get(cur)! + 1);
        queue.push(nid);
      }
    }
    for (const [sq, dd] of dmap) {
      if (!dist.has(sq)) dist.set(sq, new Array(lv.goals.length).fill(Infinity));
      dist.get(sq)![gi] = dd;
    }
  });
  return dist;
}

// Minimum-cost matching of boxes to goals (brute force over
// permutations; rooms hold at most a handful of boxes).
function matchCost(boxes: number[], dist: Map<number, number[]>): number {
  const n = boxes.length;
  const goalIdx = [...Array(n).keys()];
  let best = Infinity;
  const perm = [...goalIdx];
  const visit = (k: number) => {
    if (k === n) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const row = dist.get(boxes[i]);
        const dd = row ? row[perm[i]] : Infinity;
        if (!isFinite(dd)) return;
        sum += dd;
      }
      if (sum < best) best = sum;
      return;
    }
    for (let i = k; i < n; i++) {
      [perm[k], perm[i]] = [perm[i], perm[k]];
      visit(k + 1);
      [perm[k], perm[i]] = [perm[i], perm[k]];
    }
  };
  visit(0);
  return best;
}

interface Node {
  f: number;
  g: number;
  boxes: number[]; // sorted
  player: number; // concrete player square after the last push
  moves: string; // full move string so far
}

class Heap {
  items: Node[] = [];
  push(n: Node) {
    const a = this.items;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): Node | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.items.length;
  }
}

// A box is frozen when it sits in a solid 2x2 of walls/boxes with
// at least one box of the block off its goal.
function hasFreezeBlock(lv: Level, boxSet: Set<number>, goalSet: Set<number>): boolean {
  for (const b of boxSet) {
    const bx = b % lv.w;
    const by = Math.floor(b / lv.w);
    for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as const) {
      const cells = [
        (by + oy) * lv.w + (bx + ox),
        (by + oy) * lv.w + (bx + ox + 1),
        (by + oy + 1) * lv.w + (bx + ox),
        (by + oy + 1) * lv.w + (bx + ox + 1),
      ];
      if (cells.every((c) => lv.walls.has(c) || boxSet.has(c))) {
        if (cells.some((c) => boxSet.has(c) && !goalSet.has(c))) return true;
      }
    }
  }
  return false;
}

// Push-optimal A* inside one region. `mustExitTo` (optional) is a
// square the player must be able to walk to in the final state;
// the returned moves then end with that walk.
function solveRegion(
  lv: Level,
  floor: Set<number>,
  startBoxes: number[],
  startPlayer: number,
  goals: number[],
  mustExitTo: number | null,
  nodeCap: number,
): string | null {
  const goalSet = new Set(goals);
  const sub: Level = { ...lv, goals };
  const dist = goalDistances(sub, floor);
  const dead = new Set<number>();
  for (const sq of floor) {
    if (goalSet.has(sq)) continue;
    const row = dist.get(sq);
    if (!row || row.every((d) => !isFinite(d))) dead.add(sq);
  }
  const start = [...startBoxes].sort((a, b) => a - b);
  const h0 = matchCost(start, dist);
  if (!isFinite(h0)) return null;
  const heap = new Heap();
  heap.push({ f: h0, g: 0, boxes: start, player: startPlayer, moves: '' });
  const seen = new Map<string, number>();
  let nodes = 0;
  while (heap.size) {
    const cur = heap.pop()!;
    if (++nodes > nodeCap) return null;
    const boxSet = new Set(cur.boxes);
    if (cur.boxes.every((b) => goalSet.has(b))) {
      if (mustExitTo === null) return cur.moves;
      const paths = walkPaths(lv, floor, cur.player, boxSet);
      const exit = paths.get(mustExitTo);
      if (exit !== undefined) return cur.moves + exit;
      continue;
    }
    // Normalise the player to the smallest square of its reachable
    // region so equivalent states merge.
    const reach = walkPaths(lv, floor, cur.player, boxSet);
    const regionKey = Math.min(...reach.keys());
    const key = cur.boxes.join(',') + '|' + regionKey;
    if ((seen.get(key) ?? Infinity) <= cur.g) continue;
    seen.set(key, cur.g);
    for (let bi = 0; bi < cur.boxes.length; bi++) {
      const b = cur.boxes[bi];
      const bx = b % lv.w;
      const by = Math.floor(b / lv.w);
      for (const d of DIRS) {
        const stand = (by - d.dy) * lv.w + (bx - d.dx);
        const dest = (by + d.dy) * lv.w + (bx + d.dx);
        if (!floor.has(dest) || boxSet.has(dest) || dead.has(dest)) continue;
        const walk = reach.get(stand);
        if (walk === undefined) continue;
        const next = [...cur.boxes];
        next[bi] = dest;
        next.sort((a, b2) => a - b2);
        const nextSet = new Set(next);
        if (hasFreezeBlock(lv, nextSet, goalSet)) continue;
        const hh = matchCost(next, dist);
        if (!isFinite(hh)) continue;
        heap.push({
          f: cur.g + 1 + hh,
          g: cur.g + 1,
          boxes: next,
          player: b,
          moves: cur.moves + walk + d.ch,
        });
      }
    }
  }
  return null;
}

function solveLevel(text: string): string {
  const lv = parseLevel(text);
  const floorAll = new Set<number>();
  for (let id = 0; id < lv.w * lv.h; id++) if (!lv.walls.has(id)) floorAll.add(id);
  const goalSet = new Set(lv.goals);
  if (lv.boxes.every((b) => goalSet.has(b))) return '';

  const hallwayRow = Math.floor(lv.player / lv.w);
  const inHallway = (id: number) => Math.floor(id / lv.w) === hallwayRow;

  // Floor components once the hallway row is removed: the rooms.
  const roomOf = new Map<number, number>();
  const rooms: { cells: Set<number>; boxes: number[]; goals: number[] }[] = [];
  for (const id of floorAll) {
    if (inHallway(id) || roomOf.has(id)) continue;
    const cells = new Set<number>();
    const queue = [id];
    roomOf.set(id, rooms.length);
    while (queue.length) {
      const cur = queue.pop()!;
      cells.add(cur);
      const cx = cur % lv.w;
      const cy = Math.floor(cur / lv.w);
      for (const d of DIRS) {
        const nx = cx + d.dx;
        const ny = cy + d.dy;
        if (nx < 0 || ny < 0 || nx >= lv.w || ny >= lv.h) continue;
        const nid = ny * lv.w + nx;
        if (!floorAll.has(nid) || inHallway(nid) || roomOf.has(nid)) continue;
        roomOf.set(nid, rooms.length);
        queue.push(nid);
      }
    }
    rooms.push({
      cells,
      boxes: lv.boxes.filter((b) => cells.has(b)),
      goals: lv.goals.filter((g) => cells.has(g)),
    });
  }

  const boxedRooms = rooms.filter((r) => r.boxes.length > 0);
  const covered = boxedRooms.reduce((s, r) => s + r.boxes.length, 0);
  if (boxedRooms.length > 0 && covered === lv.boxes.length) {
    // Solve room by room, walking the hallway between doors.
    let player = lv.player;
    let boxesNow = new Set(lv.boxes);
    let allMoves = '';
    let ok = true;
    for (const room of boxedRooms) {
      // Door squares: hallway squares touching this room.
      const doors = [...floorAll].filter(
        (id) => inHallway(id) && [...DIRS].some((d) => {
          const nx = (id % lv.w) + d.dx;
          const ny = Math.floor(id / lv.w) + d.dy;
          return room.cells.has(ny * lv.w + nx);
        }),
      );
      let solved = false;
      for (const door of doors) {
        const walkIn = walkPaths(lv, floorAll, player, boxesNow).get(door);
        if (walkIn === undefined) continue;
        const region = new Set([...room.cells, door]);
        const moves = solveRegion(lv, region, room.boxes, door, room.goals, door, 400000);
        if (moves === null) continue;
        allMoves += walkIn + moves;
        player = door;
        // The room's boxes now rest on its goals.
        boxesNow = new Set([...boxesNow].filter((b) => !room.cells.has(b) && b !== door));
        for (const g of room.goals) boxesNow.add(g);
        solved = true;
        break;
      }
      if (!solved) {
        ok = false;
        break;
      }
    }
    if (ok) return allMoves;
  }

  // Fallback: one push A* over the whole board.
  const whole = solveRegion(lv, floorAll, lv.boxes, lv.player, lv.goals, null, 1500000);
  return whole ?? '';
}

for (const id of readdirSync(I).sort()) {
  const moves = solveLevel(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
