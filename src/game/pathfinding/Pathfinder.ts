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

/** Builds a route through required waypoints without duplicating joint cells. */
export function findPathThrough(grid: Grid, start: Cell, waypoints: readonly Cell[]): Cell[] | null {
  const route: Cell[] = [];
  let current = start;
  for (const waypoint of waypoints) {
    const segment = findPath(grid, current, waypoint);
    if (!segment) return null;
    route.push(...(route.length ? segment.slice(1) : segment));
    current = waypoint;
  }
  return route;
}

export interface GoalRouteCandidate { goalId: string; goal: Cell; path: Cell[]; }

/** Resolves a deterministic shortest reachable goal with bias against insignificant lane switching. */
export function findPathToAnyGoal(
  grid: Grid,
  start: Cell,
  goals: readonly { id: string; cell: Cell }[],
  preferredGoalId?: string,
  currentGoalId?: string,
  switchMinimumSavings = 0,
): GoalRouteCandidate | null {
  const routes = goals.map(({ id, cell }) => {
    const path = findPath(grid, start, cell);
    return path ? { goalId: id, goal: cell, path } : undefined;
  }).filter((candidate): candidate is GoalRouteCandidate => candidate !== undefined);
  if (routes.length === 0) return null;
  routes.sort((a, b) => a.path.length - b.path.length || a.goalId.localeCompare(b.goalId));
  const shortest = routes[0];
  const stableGoalId = currentGoalId ?? preferredGoalId;
  const stable = routes.find((candidate) => candidate.goalId === stableGoalId);
  if (!stable) return shortest;
  return stable.path.length - shortest.path.length >= switchMinimumSavings ? shortest : stable;
}
