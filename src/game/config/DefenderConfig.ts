/** Shared economy and all combat stats for player-built defenders. */
import { WORLD_UNITS_PER_CELL } from "../../core/GameConstants";

export type DefenderType = "blue-wizard" | "holy-knight" | "green-archer" | "battlemage" | "sovereign" | "holy-emperor"
  | "treant" | "thorn-owl" | "druid" | "seer" | "bark-titan" | "thorn-dancer";
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
  /** A semantic range capability; never represented by a huge fake radius. */
  supportsMapWideTargeting?: boolean;
  airDamageMultiplier?: number;
  groundDamageMultiplier?: number;
  meleeDamageMultiplier?: number;
  splashDamageRatios?: readonly number[];
  splashLabel?: string;
  /** Per-level splash radius in grid cells. Unspecified defenders keep the 1.5-cell default. */
  splashRadiusTiles?: readonly number[];
  /** Hits every valid enemy in the tower's own range instead of one primary target. */
  radialAttack?: boolean;
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
  "holy-emperor": {
    id: "holy-emperor",
    name: "Holy Emperor",
    rangeMode: "circular",
    targetTypes: ["ground", "air"],
    supportsMapWideTargeting: true,
    buildCost: 300,
    roleLabel: "Ultimate Defender",
    specializationLabel: "Map-wide · Ground + Air",
    splashLabel: "Divine Splash",
    splashDamageRatios: [0, 0, 0, 0.65],
    splashRadiusTiles: [0, 0, 0, 1.75],
    // Range is intentionally not a gameplay radius; supportsMapWideTargeting is authoritative.
    levels: [
      { level: 1, damage: 450, range: 0, fireRate: 0.85, upgradeCost: null },
      { level: 2, damage: 700, range: 0, fireRate: 1.00, upgradeCost: 400 },
      { level: 3, damage: 950, range: 0, fireRate: 1.25, upgradeCost: 500 },
    ],
  },
  "treant": {
    id: "treant", name: "Treant", rangeMode: "circular", targetTypes: ["ground"], buildCost: 7,
    roleLabel: "Ground Control / Thorn Rot", specializationLabel: "Thorn Rot · Ground only",
    levels: [
      { level: 1, damage: 18, range: 2.5 * WORLD_UNITS_PER_CELL, fireRate: 1, upgradeCost: null },
      { level: 2, damage: 32, range: 2.5 * WORLD_UNITS_PER_CELL, fireRate: 1.05, upgradeCost: 15 },
      { level: 3, damage: 52, range: 2.5 * WORLD_UNITS_PER_CELL, fireRate: 1.15, upgradeCost: 25 },
    ],
  },
  "thorn-owl": {
    id: "thorn-owl", name: "Thorn Owl", rangeMode: "circular", targetTypes: ["air"], buildCost: 15,
    roleLabel: "Anti-Air Specialist", specializationLabel: "Air only · Needlewing or Elderwing",
    levels: [
      { level: 1, damage: 24, range: 5.5 * WORLD_UNITS_PER_CELL, fireRate: 1.3, upgradeCost: null },
      { level: 2, damage: 38, range: 6 * WORLD_UNITS_PER_CELL, fireRate: 1.4, upgradeCost: 25 },
      { level: 3, damage: 82, range: 8 * WORLD_UNITS_PER_CELL, fireRate: 1.7, upgradeCost: 125 },
    ],
  },
  "druid": {
    id: "druid", name: "Druid", rangeMode: "adjacent8", targetTypes: ["ground"], buildCost: 55,
    roleLabel: "Melee / Grove Hunter", specializationLabel: "Ground only · Dire Wolf or Elder Bear",
    levels: [
      { level: 1, damage: 60, range: 1, fireRate: 1.05, upgradeCost: null },
      { level: 2, damage: 100, range: 1, fireRate: 1.15, upgradeCost: 70 },
      { level: 3, damage: 310, range: 1, fireRate: 0.8, upgradeCost: 110 },
    ],
  },
  "seer": {
    id: "seer", name: "Seer", rangeMode: "circular", targetTypes: ["ground", "air"], buildCost: 75,
    roleLabel: "Arcane / Hybrid", specializationLabel: "Ground + Air · Moon or Sun",
    levels: [
      { level: 1, damage: 65, range: 4.8 * WORLD_UNITS_PER_CELL, fireRate: 0.85, upgradeCost: null },
      { level: 2, damage: 110, range: 5.2 * WORLD_UNITS_PER_CELL, fireRate: 0.95, upgradeCost: 100 },
      { level: 3, damage: 95, range: 5.5 * WORLD_UNITS_PER_CELL, fireRate: 1.1, upgradeCost: 150 },
    ],
  },
  "bark-titan": {
    id: "bark-titan", name: "Bark Titan", rangeMode: "adjacent8", targetTypes: ["ground"], buildCost: 150,
    roleLabel: "Heavy 360° Melee AoE", specializationLabel: "Ground only · Stonebark or Heartwood",
    radialAttack: true,
    levels: [
      { level: 1, damage: 520, range: 1, fireRate: 0.5, upgradeCost: null },
      { level: 2, damage: 850, range: 1, fireRate: 0.5, upgradeCost: 200 },
      { level: 3, damage: 1_250, range: 1, fireRate: 0.5, upgradeCost: 350 },
    ],
  },
  "thorn-dancer": {
    id: "thorn-dancer", name: "Thorn Dancer", rangeMode: "circular", targetTypes: ["ground", "air"], buildCost: 300,
    roleLabel: "Ranged Aura Support", specializationLabel: "Verdant Resonance · Blight or Winterthorn",
    levels: [
      { level: 1, damage: 120, range: 5.5 * WORLD_UNITS_PER_CELL, fireRate: 1.1, upgradeCost: null },
      { level: 2, damage: 210, range: 5.8 * WORLD_UNITS_PER_CELL, fireRate: 1.15, upgradeCost: 300 },
      { level: 3, damage: 280, range: 6 * WORLD_UNITS_PER_CELL, fireRate: 1.2, upgradeCost: 500 },
    ],
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
