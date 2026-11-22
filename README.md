# Sokoban Solver — Rooms, Solved Optimally

[![make.fun bounty](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/tomoyasu-muse/sokoban-solver-20261121-entry/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/tomoyasu-muse/sokoban-solver-20261121-entry/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)

An entry in the
[make.fun bounty "Build the best Sokoban solver, 21 November 2026"](https://make.fun/bounty/sokoban-solver-01-run-20261121).

## Idea

The levels in this contest are generated as a one-square-wide
hallway with independent rooms opening off it, and a level's
push optimum is the sum of its rooms' optima. This solver uses
that structure instead of searching the whole board:

1. Remove the player's hallway row; the remaining floor splits
   into rooms (connected components).
2. Solve each room with a push-based A* search whose heuristic
   is a minimum-cost box–goal matching over true floor
   distances. The heuristic never overestimates, so each room's
   solution uses the fewest possible pushes.
3. Dead squares and 2×2 freeze blocks prune the search, and the
   player walks the hallway between room doors.

On the kit's practice set the solver scores the maximum
1,000,000 (every instance solved in the optimal number of
pushes), against the house baseline's 200,000.

## Run it

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22, no dependencies) reads each instance's
`level.txt` from the input directory and writes `solution.txt`
(the player's moves in LURD) to the output directory.

## License

MIT — see [LICENSE](LICENSE).
