import { Cell } from "../../core/types";
import { WORLD_UNITS_PER_CELL } from "../../core/GameConstants";

export interface Enemy {
  id: number;
  hp: number;
  maxHp: number;
  reward: number;
  /** Speed in grid-cell units per second (90 logical world units per second). */
  speed: number;
  /** Current position in grid-cell coordinates, centered on the route. */
  x: number;
  y: number;
  currentPathIndex: number;
  alive: boolean;
}

export function createEnemy(id: number, spawn: Cell): Enemy {
  return { id, hp: 100, maxHp: 100, reward: 2, speed: 90 / WORLD_UNITS_PER_CELL, x: spawn.x, y: spawn.y, currentPathIndex: 0, alive: true };
}
