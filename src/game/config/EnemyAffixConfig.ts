import type { EnemyCombatClass, EnemyType } from "./EnemyConfig";

export type DamageType = "physical" | "magic";
export type EnemyAffixId = "armored" | "arcane-ward" | "swift" | "fortified" | "regenerator" | "shielded" | "commander" | "frenzied";
export type AffixTier = 1 | 2 | 3;
export interface EnemyAffixConfig {
  id: EnemyAffixId;
  name: string;
  description: string;
  values: Readonly<Record<AffixTier, number>>;
  color: string;
}

export const AFFIXES: Record<EnemyAffixId, EnemyAffixConfig> = {
  armored: { id: "armored", name: "Armored", description: "Resists physical damage", values: { 1: 0.15, 2: 0.25, 3: 0.35 }, color: "#aeb8c3" },
  "arcane-ward": { id: "arcane-ward", name: "Arcane Ward", description: "Resists magic damage", values: { 1: 0.15, 2: 0.25, 3: 0.35 }, color: "#9c7bff" },
  swift: { id: "swift", name: "Swift", description: "Moves faster", values: { 1: 0.10, 2: 0.18, 3: 0.25 }, color: "#f6db62" },
  fortified: { id: "fortified", name: "Fortified", description: "Extra maximum health", values: { 1: 0.20, 2: 0.35, 3: 0.50 }, color: "#ee8355" },
  regenerator: { id: "regenerator", name: "Regenerator", description: "Restores health over time", values: { 1: 0.005, 2: 0.01, 3: 0.015 }, color: "#78d66d" },
  shielded: { id: "shielded", name: "Shielded", description: "Has a damage-absorbing shield", values: { 1: 0.15, 2: 0.25, 3: 0.35 }, color: "#66d8ff" },
  commander: { id: "commander", name: "Commander", description: "Speeds nearby enemies", values: { 1: 0.08, 2: 0.12, 3: 0.18 }, color: "#f4c861" },
  frenzied: { id: "frenzied", name: "Frenzied", description: "Moves faster below 35% health", values: { 1: 0.10, 2: 0.20, 3: 0.30 }, color: "#f25c5c" },
};

export const AFFIX_IDS = Object.keys(AFFIXES) as EnemyAffixId[];
export const AFFIX_MILESTONES = { 15: 1, 30: 2, 45: 3 } as const;
export const AFFIX_ELIGIBILITY = {
  excludedTypes: [] as readonly EnemyType[],
  eligibleCombatClasses: ["fodder", "tank", "boss"] as readonly EnemyCombatClass[],
  commanderAuraRadiusCells: 4,
  tier1Chance: 0.225,
  tier2Chance: 0.30,
  tier2DoubleChance: 0.08,
  tier3Chance: 0.40,
  tier3DoubleChance: 0.15,
};

export type EnemyAffix = { id: EnemyAffixId; tier: AffixTier };
export interface AffixMilestoneWarning { tier: AffixTier; wave: number; title: string; affixes: EnemyAffixId[]; }
