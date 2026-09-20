import { Cell, cellKey, sameCell } from "../../core/types";
import { Grid } from "../grid/Grid";

/** Breadth-first search: predictable and ideal for a small, unweighted grid. */
export function findPath(grid: Grid, start: Cell, goal: Cell): Cell[] | null {
  const frontier: Cell[] = [start];
  const cameFrom = new Map<string, Cell | null>([[cellKey(start), null]]);

  for (let index = 0; index < frontier.length; index += 1) {
    const current = frontier[index];
    if (sameCell(current, goal)) {
      const path: Cell[] = [];
      for (let step: Cell | null = current; step; step = cameFrom.get(cellKey(step)) ?? null) path.push(step);
      return path.reverse();
    }
    for (const next of grid.neighbors(current)) {
      if (!cameFrom.has(cellKey(next))) {
        cameFrom.set(cellKey(next), current);
        frontier.push(next);
      }
    }
  }
  return null;
}
