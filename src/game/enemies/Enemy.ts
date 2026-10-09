import type { Cell } from "../../core/types";
import { WORLD_UNITS_PER_CELL } from "../../core/GameConstants";
import { ENEMY_BASE_SPEED_WORLD_PER_SECOND, ENEMY_CONFIG } from "../config/EnemyConfig";
import { ENEMY_HP_TIER_WAVE_COUNT, getConfiguredEnemyHpMultiplier } from "../config/EnemyHpScalingConfig";
import type { EnemyCombatClass, EnemyMovementType, EnemyType } from "../config/EnemyConfig";
import type { EnemyAffix } from "../config/EnemyAffixConfig";

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
  /** Stable destination choice used for multi-goal rerouting hysteresis. */
  targetGoalId?: string;
  preferredGoalId?: string;
  /** Goal restrictions inherited from the spawn lane and retained across repaths. */
  allowedGoalIds?: string[];
  alive: boolean;
  affixes: EnemyAffix[];
  shield: number;
  maxShield: number;
  slowMultiplier: number;
  slowSecondsRemaining: number;
  /** Continuous exposure time in Ancient Grove's influenced path cells. */
  livingMazeExposureSeconds: number;
  /** Ancient Grove's independent status tracks; timers are game-state data, never visual data. */
  thornRotStacks: number;
  thornRotStackTimer: number;
  thornRotOutsideSeconds: number;
  thornRotSourceLevel: number;
  thornRotDamageRemainder: number;
  sunbrandStacks: number;
  sunbrandGraceSecondsRemaining: number;
  sunbrandDecayTimer: number;
  sunbrandDamageRemainder: number;
  /** Ranger mark duration; it refreshes to a fixed duration and never stacks. */
  archerMarkSecondsRemaining: number;
  regenDelayRemaining: number;
}

export function applyArcherMark(enemy: Enemy, durationSeconds: number): void {
  enemy.archerMarkSecondsRemaining = Math.max(0, durationSeconds);
}

export function updateEnemySpecialStatuses(enemy: Enemy, deltaSeconds: number): void {
  enemy.archerMarkSecondsRemaining = Math.max(0, enemy.archerMarkSecondsRemaining - deltaSeconds);
}

/** HP tier 0 is waves 1–10; multipliers are defined in EnemyHpScalingConfig. */
export function getEnemyHpTier(wave: number): number {
  return Math.floor((wave - 1) / ENEMY_HP_TIER_WAVE_COUNT);
}

export function getEnemyHpMultiplier(wave: number): number {
  return getConfiguredEnemyHpMultiplier(getEnemyHpTier(wave));
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
    path: path.map((cell) => ({ ...cell })), alive: true, affixes: [], shield: 0, maxShield: 0,
    slowMultiplier: 1, slowSecondsRemaining: 0, livingMazeExposureSeconds: 0,
    thornRotStacks: 0, thornRotStackTimer: 0, thornRotOutsideSeconds: 0, thornRotSourceLevel: 0, thornRotDamageRemainder: 0,
    sunbrandStacks: 0, sunbrandGraceSecondsRemaining: 0, sunbrandDecayTimer: 0, sunbrandDamageRemainder: 0,
    archerMarkSecondsRemaining: 0, regenDelayRemaining: 0,
  };
}
