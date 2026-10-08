import type { FactionId } from "./FactionConfig";

export type VeteranRank = 0 | 1 | 2 | 3;

export interface VeteranTierConfig {
  rank: VeteranRank;
  label: string;
  requiredDamage: number;
  damageBonus: number;
  attackSpeedBonus: number;
}

/** Each tier adds to the previous tier; getVeteranProgress resolves the active cumulative total. */
export const VETERAN_TIERS: readonly VeteranTierConfig[] = [
  { rank: 1, label: "Veteran I", requiredDamage: 40_000, damageBonus: 0.05, attackSpeedBonus: 0 },
  { rank: 2, label: "Veteran II", requiredDamage: 150_000, damageBonus: 0, attackSpeedBonus: 0.05 },
  { rank: 3, label: "Veteran III", requiredDamage: 350_000, damageBonus: 0.08, attackSpeedBonus: 0.05 },
];

export const FACTION_BONUS_CONFIG = {
  royalGuardId: "arcane-kingdom" as FactionId,
  ancientGroveId: "ancient-grove" as FactionId,
  livingMaze: {
    influenceRangeCells: 1,
    exposureStages: [
      { seconds: 0, slowMultiplier: 0.92 },
      { seconds: 2, slowMultiplier: 0.86 },
      { seconds: 4, slowMultiplier: 0.80 },
    ],
    maxSlow: 0.20,
    bossResistanceMultiplier: 1,
  },
  thornRot: {
    stackIntervalSeconds: 1,
    outsideGraceSeconds: 4,
    maxStacks: { 1: 5, 2: 5, 3: 6 },
    damagePerStackPerSecond: { 1: 5, 2: 7, 3: 10 },
    deepRootsBonusAtMax: 0.15,
  },
  sunbrand: {
    maxStacks: 4,
    graceSeconds: 4,
    decayIntervalSeconds: 1,
    damagePerStackPerSecond: 18,
    solarDetonationDamage: 180,
  },
} as const;

