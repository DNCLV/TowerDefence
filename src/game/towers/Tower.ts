import type { Cell } from "../../core/types";
import { WORLD_UNITS_PER_CELL } from "../../core/GameConstants";
import { DEFENDER_CONFIG, SELL_REFUND_RATE, getDefenderLevelStats, getDefenderTotalInvestment } from "../config/DefenderConfig";
import type { DefenderLevelStats, DefenderRangeMode, DefenderType } from "../config/DefenderConfig";
import type { Enemy } from "../enemies/Enemy";
import type { TowerSpecializationId } from "../config/SpecializationConfig";
import { getSpecialization, TOWER_SPECIALIZATIONS } from "../config/SpecializationConfig";
import { FORMATION_BY_ID } from "../config/FormationConfig";
import type { FormationId } from "../config/FormationConfig";
import type { DamageType } from "../config/EnemyAffixConfig";

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
  specializationId?: TowerSpecializationId;
  /** Counts attacks after specialization for deterministic periodic mechanics such as Storm Regent. */
  specializationAttackCounter: number;
  formationId?: FormationId;
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
    ...getTowerLevelStats(1, type), cooldownRemaining: 0, specializationAttackCounter: 0,
    combatStats: { kills: 0, damageDone: 0 },
  };
}

export function upgradeTower(tower: Tower, specializationId?: TowerSpecializationId): void {
  const stats = getTowerLevelStats(tower.level + 1, tower.type);
  tower.level = stats.level;
  tower.damage = stats.damage;
  tower.range = stats.range;
  tower.rangeMode = DEFENDER_CONFIG[tower.type].rangeMode;
  tower.fireRate = stats.fireRate;
  if (stats.level === 3) {
    tower.specializationId = specializationId;
    tower.specializationAttackCounter = 0;
    const specialization = getSpecialization(specializationId);
    if (specialization && specialization.defenderType === tower.type) {
      tower.damage = specialization.level3Stats.damage;
      tower.range = specialization.level3Stats.range ?? tower.range;
      tower.fireRate = specialization.level3Stats.fireRate;
    }
  }
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
  if (tower.type === "holy-knight") return "melee";
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
  const specialization = getSpecialization(tower.specializationId);
  let damage = profile.damage;
  if (specialization?.bonusDamageClasses?.some((combatClass) => combatClass === enemy.combatClass)) damage *= specialization.bonusDamageMultiplier ?? 1;
  const formation = tower.formationId ? FORMATION_BY_ID[tower.formationId] : undefined;
  if (formation?.damageMultiplier) damage *= formation.damageMultiplier;
  if (formation?.rangedDamageMultiplier) damage *= formation.rangedDamageMultiplier;
  return { mode, damage: Math.round(damage), fireRate: profile.fireRate * (formation?.attackSpeedMultiplier ?? 1) };
}

export function getTowerAttackProfile(tower: Tower, enemy: Enemy): TowerAttackProfile {
  if (tower.type === "sovereign") return getSovereignProfile(tower, enemy);
  const mode = getTowerAttackMode(tower, enemy);
  const formation = tower.formationId ? FORMATION_BY_ID[tower.formationId] : undefined;
  let damage = getTowerDamageAgainstEnemy(tower, enemy, mode);
  const specialization = getSpecialization(tower.specializationId);
  if (specialization?.bonusDamageClasses?.some((combatClass) => combatClass === enemy.combatClass)) damage *= specialization.bonusDamageMultiplier ?? 1;
  if (formation?.damageMultiplier) damage *= formation.damageMultiplier;
  if (formation?.rangedDamageMultiplier && mode !== "melee") damage *= formation.rangedDamageMultiplier;
  const fireRate = tower.fireRate * (formation?.attackSpeedMultiplier ?? 1);
  return { mode, damage: Math.round(damage), fireRate };
}

/** Returns rounded per-hit damage after defender-specific target/mode modifiers. */
export function getTowerDamageAgainstEnemy(tower: Tower, enemy: Enemy, mode = getTowerAttackMode(tower, enemy)): number {
  if (tower.type === "sovereign") return getSovereignProfile(tower, enemy).damage;
  const config = DEFENDER_CONFIG[tower.type];
  const targetMultiplier = enemy.movementType === "flying"
    ? (config.airDamageMultiplier ?? 1)
    : (config.groundDamageMultiplier ?? 1);
  const specialization = getSpecialization(tower.specializationId);
  const modeMultiplier = mode === "melee" ? (specialization?.meleeDamageMultiplier ?? config.meleeDamageMultiplier ?? 1) : 1;
  const branchMultiplier = specialization?.targetDamageMultipliers
    ? enemy.movementType === "flying" ? specialization.targetDamageMultipliers.air : specialization.targetDamageMultipliers.ground
    : targetMultiplier;
  const markMultiplier = tower.type === "green-archer" && enemy.archerMarkSecondsRemaining > 0
    ? (TOWER_SPECIALIZATIONS.ranger.mark?.damageMultiplier ?? 1)
    : 1;
  return Math.round(tower.damage * branchMultiplier * modeMultiplier * markMultiplier);
}

export function getTowerSplashRatio(tower: Tower, mode: TowerAttackMode): number {
  const specialization = getSpecialization(tower.specializationId);
  if (specialization?.splashRatio !== undefined) {
    if (specialization.splashMode === "melee" && mode !== "melee") return DEFENDER_CONFIG[tower.type].splashDamageRatios?.[tower.level] ?? 0;
    if (specialization.splashMode === "ranged" && mode === "melee") return DEFENDER_CONFIG[tower.type].splashDamageRatios?.[tower.level] ?? 0;
    return specialization.splashRatio;
  }
  return DEFENDER_CONFIG[tower.type].splashDamageRatios?.[tower.level] ?? 0;
}

export function getTowerSplashRadiusMultiplier(tower: Tower): number {
  return tower.formationId ? FORMATION_BY_ID[tower.formationId].splashRadiusMultiplier ?? 1 : 1;
}

export function getTowerDamageType(tower: Tower, mode: TowerAttackMode = "ranged"): DamageType {
  if (tower.type === "blue-wizard") return "magic";
  if (tower.type === "holy-knight" || tower.type === "green-archer") return "physical";
  if (tower.type === "battlemage") return mode === "melee" ? "physical" : "magic";
  // Sovereign's anti-air bolts are arcane; its rapid/heavy attacks are physical.
  return mode === "anti-air" ? "magic" : "physical";
}

/** Config-driven air/ground capability check, kept in the portable game core. */
export function canTowerTargetEnemy(tower: Tower, enemy: Enemy): boolean {
  const targetClass = enemy.movementType === "flying" ? "air" : "ground";
  return DEFENDER_CONFIG[tower.type].targetTypes.includes(targetClass);
}
