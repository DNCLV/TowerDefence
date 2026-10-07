import type { FactionId } from "./FactionConfig";

export type VeteranRank = 0 | 1 | 2 | 3;

export interface VeteranTierConfig {
  rank: VeteranRank;
  label: string;
  requiredKills: number;
  requiredDamage: number;
  damageMultiplier: number;
  attackSpeedMultiplier: number;
}

export const VETERAN_TIERS: readonly VeteranTierConfig[] = [
  { rank: 1, label: "Veteran I", requiredKills: 25, requiredDamage: 1_500, damageMultiplier: 1.05, attackSpeedMultiplier: 1 },
  { rank: 2, label: "Veteran II", requiredKills: 75, requiredDamage: 4_500, damageMultiplier: 1.05, attackSpeedMultiplier: 1.05 },
  { rank: 3, label: "Veteran III", requiredKills: 150, requiredDamage: 9_000, damageMultiplier: 1.08, attackSpeedMultiplier: 1.05 },
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
} as const;

