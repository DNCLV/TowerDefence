/** Shared economy and all combat stats for player-built defenders. */
import { WORLD_UNITS_PER_CELL } from "../../core/GameConstants";

export type DefenderType = "blue-wizard" | "holy-knight" | "green-archer" | "battlemage" | "sovereign";
export type DefenderRangeMode = "circular" | "adjacent8" | "hybrid";
export type SovereignAttackMode = "antiAir" | "rapid" | "heavy";

export interface DefenderLevelStats {
  level: number;
  damage: number;
  /** World units for circular range, tile count for adjacent8. */
  range: number;
  fireRate: number;
  upgradeCost: number | null;
}

export interface DefenderDefinition {
  id: DefenderType;
  name: string;
  rangeMode: DefenderRangeMode;
  /** Movement classes this defender can damage. "air" maps to flying enemies. */
  targetTypes: readonly ("ground" | "air")[];
  buildCost: number;
  levels: readonly DefenderLevelStats[];
  roleLabel?: string;
  specializationLabel?: string;
  airDamageMultiplier?: number;
  groundDamageMultiplier?: number;
  meleeDamageMultiplier?: number;
  splashDamageRatios?: readonly number[];
  /** Per-level, target-dependent stats for the Sovereign's single-target modes. */
  attackProfiles?: Record<SovereignAttackMode, readonly Pick<DefenderLevelStats, "damage" | "fireRate">[]>;
}

export const DEFENDER_ECONOMY = {
  buildCost: 10,
  upgradeCosts: { 2: 20, 3: 45 },
} as const;

export const SELL_REFUND_RATE = 0.70;

/** The only source of truth for defender identity, range mode, and level stats. */
export const DEFENDER_CONFIG: Record<DefenderType, DefenderDefinition> = {
  "blue-wizard": {
    id: "blue-wizard",
    name: "Blue Wizard",
    rangeMode: "circular",
    targetTypes: ["ground", "air"],
    buildCost: DEFENDER_ECONOMY.buildCost,
    levels: [
      { level: 1, damage: 25, range: 110, fireRate: 1, upgradeCost: null },
      { level: 2, damage: 65, range: 120, fireRate: 1.15, upgradeCost: DEFENDER_ECONOMY.upgradeCosts[2] },
      { level: 3, damage: 150, range: 135, fireRate: 1.25, upgradeCost: DEFENDER_ECONOMY.upgradeCosts[3] },
    ],
  },
  "holy-knight": {
    id: "holy-knight",
    name: "Holy Knight",
    rangeMode: "adjacent8",
    targetTypes: ["ground"],
    buildCost: DEFENDER_ECONOMY.buildCost,
    levels: [
      { level: 1, damage: 55, range: 1, fireRate: 0.9, upgradeCost: null },
      { level: 2, damage: 140, range: 1, fireRate: 1.05, upgradeCost: DEFENDER_ECONOMY.upgradeCosts[2] },
      { level: 3, damage: 320, range: 1, fireRate: 1.15, upgradeCost: DEFENDER_ECONOMY.upgradeCosts[3] },
    ],
  },
  "green-archer": {
    id: "green-archer",
    name: "Green Archer",
    rangeMode: "circular",
    targetTypes: ["ground", "air"],
    buildCost: 20,
    roleLabel: "Anti-Air Specialist",
    specializationLabel: "Anti-Air · 4× flying damage · reduced ground damage",
    airDamageMultiplier: 4,
    groundDamageMultiplier: 0.5,
    levels: [
      { level: 1, damage: 12, range: 5 * WORLD_UNITS_PER_CELL, fireRate: 1.5, upgradeCost: null },
      { level: 2, damage: 28, range: 5 * WORLD_UNITS_PER_CELL, fireRate: 1.65, upgradeCost: 35 },
      { level: 3, damage: 65, range: 5 * WORLD_UNITS_PER_CELL, fireRate: 1.8, upgradeCost: 70 },
    ],
  },
  battlemage: {
    id: "battlemage",
    name: "Battlemage",
    rangeMode: "hybrid",
    targetTypes: ["ground", "air"],
    buildCost: 35,
    roleLabel: "Hybrid / Splash",
    specializationLabel: "Hybrid / Splash",
    meleeDamageMultiplier: 1.35,
    splashDamageRatios: [0, 0.35, 0.40, 0.50],
    levels: [
      { level: 1, damage: 50, range: 3.6 * WORLD_UNITS_PER_CELL, fireRate: 1, upgradeCost: null },
      { level: 2, damage: 125, range: 3.6 * WORLD_UNITS_PER_CELL, fireRate: 1.05, upgradeCost: 65 },
      { level: 3, damage: 290, range: 3.6 * WORLD_UNITS_PER_CELL, fireRate: 1.1, upgradeCost: 120 },
    ],
  },
  sovereign: {
    id: "sovereign", name: "Sovereign", rangeMode: "circular", targetTypes: ["ground", "air"],
    buildCost: 100, roleLabel: "Adaptive / Ultimate", specializationLabel: "Adaptive attacks: Anti-Air · Rapid · Heavy",
    levels: [
      { level: 1, damage: 75, range: 4.5 * WORLD_UNITS_PER_CELL, fireRate: 1.5, upgradeCost: null },
      { level: 2, damage: 170, range: 4.5 * WORLD_UNITS_PER_CELL, fireRate: 1.65, upgradeCost: 125 },
      { level: 3, damage: 360, range: 4.5 * WORLD_UNITS_PER_CELL, fireRate: 1.8, upgradeCost: 200 },
    ],
    attackProfiles: {
      antiAir: [{ damage: 75, fireRate: 1.5 }, { damage: 170, fireRate: 1.65 }, { damage: 360, fireRate: 1.8 }],
      rapid: [{ damage: 45, fireRate: 2.2 }, { damage: 105, fireRate: 2.4 }, { damage: 225, fireRate: 2.6 }],
      heavy: [{ damage: 180, fireRate: 0.55 }, { damage: 430, fireRate: 0.6 }, { damage: 950, fireRate: 0.65 }],
    },
  },
};

export function getDefenderLevelStats(type: DefenderType, level: number): DefenderLevelStats {
  const levels = DEFENDER_CONFIG[type].levels;
  return levels.find((stats) => stats.level === level) ?? levels[0];
}

export function getDefenderTotalInvestment(level: number, type: DefenderType): number {
  return DEFENDER_CONFIG[type].buildCost + DEFENDER_CONFIG[type].levels
    .filter((stats) => stats.level > 1 && stats.level <= level)
    .reduce((total, stats) => total + (stats.upgradeCost ?? 0), 0);
}
