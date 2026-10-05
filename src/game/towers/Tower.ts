import type { Cell } from "../../core/types";
import { WORLD_UNITS_PER_CELL } from "../../core/GameConstants";
import { DEFENDER_CONFIG, SELL_REFUND_RATE, getDefenderLevelStats, getDefenderTotalInvestment } from "../config/DefenderConfig";
import type { DefenderLevelStats, DefenderRangeMode, DefenderType } from "../config/DefenderConfig";
import type { Enemy } from "../enemies/Enemy";

export interface Tower {
  id: number;
  type: DefenderType;
  cell: Cell;
  rangeMode: DefenderRangeMode;
  /** World units for circular mode, Chebyshev tile radius for adjacent8. */
  range: number;
  damage: number;
  fireRate: number;
  cooldownRemaining: number;
  level: number;
  /** Lifetime combat totals for this tower identity; upgrades do not reset them. */
  combatStats: TowerCombatStats;
}

export interface TowerCombatStats {
  kills: number;
  damageDone: number;
}

export type TowerAttackMode = "melee" | "ranged" | "anti-air" | "rapid" | "heavy";
export interface TowerAttackProfile { mode: TowerAttackMode; damage: number; fireRate: number; }

/** Compatibility names used by the original Wizard-only test scene. */
export const BASIC_TOWER_COST = DEFENDER_CONFIG["blue-wizard"].buildCost;
export const BASIC_TOWER_LEVELS = DEFENDER_CONFIG["blue-wizard"].levels;

export type TowerLevelStats = DefenderLevelStats;
export const getTowerLevelStats = (level: number, type: DefenderType = "blue-wizard"): TowerLevelStats => getDefenderLevelStats(type, level);

export function createBasicTower(id: number, cell: Cell, type: DefenderType = "blue-wizard"): Tower {
  return {
    id, type, cell, rangeMode: DEFENDER_CONFIG[type].rangeMode,
    ...getTowerLevelStats(1, type), cooldownRemaining: 0,
    combatStats: { kills: 0, damageDone: 0 },
  };
}

export function upgradeTower(tower: Tower): void {
  const stats = getTowerLevelStats(tower.level + 1, tower.type);
  tower.level = stats.level;
  tower.damage = stats.damage;
  tower.range = stats.range;
  tower.rangeMode = DEFENDER_CONFIG[tower.type].rangeMode;
  tower.fireRate = stats.fireRate;
}

/** Total gold spent to build this tower and reach the requested level. */
export function getTotalTowerInvestment(level: number, type: DefenderType = "blue-wizard"): number {
  return getDefenderTotalInvestment(level, type);
}

/** Sell refund is based on configured lifetime investment; combat telemetry is not transferred. */
export function getTowerSellRefund(tower: Pick<Tower, "level" | "type">): number {
  return Math.floor(getTotalTowerInvestment(tower.level, tower.type) * SELL_REFUND_RATE);
}

/** fireRate is attacks per second, so DPS is damage per hit times attacks per second. */
export function getTowerDps(stats: Pick<Tower, "damage" | "fireRate">): number {
  return stats.damage * stats.fireRate;
}

/**
 * Adjacent melee covers the continuous world-space footprint of the eight
 * neighboring cells. Enemy x/y and tower cells are in tile-center units, so
 * 1.5 includes the full adjacent tiles without reaching a two-away cell.
 */
const ADJACENT8_HALF_EXTENT_CELLS = 1.5;

export function isTowerInRange(tower: Tower, enemy: Enemy): boolean {
  if (tower.rangeMode === "adjacent8") {
    const dx = Math.abs(enemy.x - tower.cell.x);
    const dy = Math.abs(enemy.y - tower.cell.y);
    return Math.max(dx, dy) <= ADJACENT8_HALF_EXTENT_CELLS
      && (dx > 0.5 || dy > 0.5);
  }
  return Math.hypot(enemy.x - tower.cell.x, enemy.y - tower.cell.y) * WORLD_UNITS_PER_CELL <= tower.range;
}

/** Adjacent-cell check used by the Battlemage's automatic melee mode. */
export function isTowerAdjacent8(tower: Tower, enemy: Enemy): boolean {
  const dx = Math.abs(enemy.x - tower.cell.x);
  const dy = Math.abs(enemy.y - tower.cell.y);
  return Math.max(dx, dy) <= ADJACENT8_HALF_EXTENT_CELLS && (dx > 0.5 || dy > 0.5);
}

export function getTowerAttackMode(tower: Tower, enemy: Enemy): TowerAttackMode {
  if (tower.type === "sovereign") return getSovereignProfile(tower, enemy).mode;
  return tower.type === "battlemage" && enemy.movementType === "ground" && isTowerAdjacent8(tower, enemy)
    ? "melee"
    : "ranged";
}

/** Selects the Sovereign profile at attack time; no profile owns separate cooldown state. */
function getSovereignProfile(tower: Tower, enemy: Enemy): TowerAttackProfile {
  const config = DEFENDER_CONFIG.sovereign;
  const selectedMode = enemy.movementType === "flying" ? "antiAir" : enemy.combatClass === "fodder" ? "rapid" : "heavy";
  const profile = config.attackProfiles![selectedMode][tower.level - 1];
  const mode: TowerAttackMode = selectedMode === "antiAir" ? "anti-air" : selectedMode;
  return { mode, damage: profile.damage, fireRate: profile.fireRate };
}

export function getTowerAttackProfile(tower: Tower, enemy: Enemy): TowerAttackProfile {
  if (tower.type === "sovereign") return getSovereignProfile(tower, enemy);
  const mode = getTowerAttackMode(tower, enemy);
  return { mode, damage: getTowerDamageAgainstEnemy(tower, enemy, mode), fireRate: tower.fireRate };
}

/** Returns rounded per-hit damage after defender-specific target/mode modifiers. */
export function getTowerDamageAgainstEnemy(tower: Tower, enemy: Enemy, mode = getTowerAttackMode(tower, enemy)): number {
  if (tower.type === "sovereign") return getSovereignProfile(tower, enemy).damage;
  const config = DEFENDER_CONFIG[tower.type];
  const targetMultiplier = enemy.movementType === "flying"
    ? (config.airDamageMultiplier ?? 1)
    : (config.groundDamageMultiplier ?? 1);
  const modeMultiplier = mode === "melee" ? (config.meleeDamageMultiplier ?? 1) : 1;
  return Math.round(tower.damage * targetMultiplier * modeMultiplier);
}

export function getTowerSplashRatio(tower: Tower): number {
  return DEFENDER_CONFIG[tower.type].splashDamageRatios?.[tower.level] ?? 0;
}

/** Config-driven air/ground capability check, kept in the portable game core. */
export function canTowerTargetEnemy(tower: Tower, enemy: Enemy): boolean {
  const targetClass = enemy.movementType === "flying" ? "air" : "ground";
  return DEFENDER_CONFIG[tower.type].targetTypes.includes(targetClass);
}
