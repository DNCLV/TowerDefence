import { Cell } from "../../core/types";

export interface Tower {
  id: number;
  cell: Cell;
  range: number;
  damage: number;
  fireRate: number;
  cooldownRemaining: number;
}

/** Keep all first-tower balancing values together. Range is in logical world units. */
export const BASIC_TOWER_STATS = {
  cost: 10,
  range: 110,
  damage: 25,
  fireRate: 1,
} as const;

export const BASIC_TOWER_COST = BASIC_TOWER_STATS.cost;

export function createBasicTower(id: number, cell: Cell): Tower {
  return { id, cell, ...BASIC_TOWER_STATS, cooldownRemaining: 0 };
}
