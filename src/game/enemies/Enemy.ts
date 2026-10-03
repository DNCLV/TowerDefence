import type { Cell } from "../../core/types";
import { WORLD_UNITS_PER_CELL } from "../../core/GameConstants";
import { ENEMY_BASE_SPEED_WORLD_PER_SECOND, ENEMY_CONFIG } from "../config/EnemyConfig";
import type { EnemyCombatClass, EnemyMovementType, EnemyType } from "../config/EnemyConfig";

export interface Enemy {
  id: number;
  type: EnemyType;
  movementType: EnemyMovementType;
  combatClass: EnemyCombatClass;
  hp: number;
  maxHp: number;
  reward: number;
  livesDamage: number;
  /** Speed in grid-cell units per second (90 logical world units per second). */
  speed: number;
  /** Current position in grid-cell coordinates, centered on the route. */
  x: number;
  y: number;
  currentPathIndex: number;
  /** Personal route, replaced only when a tower changes map topology. */
  path: Cell[];
  alive: boolean;
}

/** HP tier 0 is waves 1–10; each new tier doubles enemy health. */
export function getEnemyHpTier(wave: number): number {
  return Math.floor((wave - 1) / 10);
}

export function getEnemyHpMultiplier(wave: number): number {
  return Math.pow(2, getEnemyHpTier(wave));
}

export function getEnemyHpForWave(type: EnemyType, wave: number): number {
  return Math.round(ENEMY_CONFIG[type].hp * getEnemyHpMultiplier(wave));
}

export function createEnemy(id: number, type: EnemyType, path: Cell[], wave = 1): Enemy {
  const spawn = path[0];
  const config = ENEMY_CONFIG[type];
  const maxHp = getEnemyHpForWave(type, wave);
  return {
    id, type, movementType: config.movementType, combatClass: config.combatClass, hp: maxHp, maxHp,
    reward: config.goldReward, livesDamage: config.livesDamage,
    speed: ENEMY_BASE_SPEED_WORLD_PER_SECOND * config.speedMultiplier / WORLD_UNITS_PER_CELL,
    x: spawn.x, y: spawn.y, currentPathIndex: 0,
    path: path.map((cell) => ({ ...cell })), alive: true,
  };
}
