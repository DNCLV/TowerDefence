import type { DefenderType } from "./DefenderConfig";
import { WORLD_UNITS_PER_CELL } from "../../core/GameConstants";

export type TowerSpecializationId = "stormcaller" | "frostweaver" | "royal-champion" | "dawn-paladin" | "spellblade" | "warcaster"
  | "dragon-slayer" | "ranger" | "storm-regent" | "war-sovereign";
export interface TowerSpecializationConfig {
  id: TowerSpecializationId;
  defenderType: DefenderType;
  name: string;
  role: string;
  description: string;
  level3Stats: { damage: number; range?: number; fireRate: number };
  chain?: { targetCount: 2; damageRatios: readonly [number, number]; rangeCells: number; everyNthAttack?: number };
  slow?: { multiplier: number; durationSeconds: number };
  /** Optional L3-only multipliers. Damage type and resistances still come from the defender. */
  targetDamageMultipliers?: { air: number; ground: number };
  prioritizeAir?: boolean;
  mark?: { damageMultiplier: number; durationSeconds: number };
  bonusDamageClasses?: readonly ("tank" | "boss")[];
  bonusDamageMultiplier?: number;
  meleeDamageMultiplier?: number;
  splashRatio?: number;
  splashMode?: "melee" | "ranged" | "any";
  visualKey: string;
  visualColor: string;
}

/** The only source of truth for L3 specialization identity, branch stats and mechanics. */
export const TOWER_SPECIALIZATIONS: Record<TowerSpecializationId, TowerSpecializationConfig> = {
  stormcaller: {
    id: "stormcaller", defenderType: "blue-wizard", name: "Stormcaller", role: "Multi-target / Anti-swarm",
    description: "Chains each hit to two nearby enemies for 45% and 25% damage.",
    level3Stats: { damage: 115, range: 135, fireRate: 1.42 },
    chain: { targetCount: 2, damageRatios: [0.45, 0.25], rangeCells: 2.5 }, visualKey: "stormcaller", visualColor: "#60ccff",
  },
  frostweaver: {
    id: "frostweaver", defenderType: "blue-wizard", name: "Frostweaver", role: "Control / Maze support",
    description: "Deals 110 damage at 1.05 attacks/sec and slows hit enemies by 25% for 1.5 seconds.",
    level3Stats: { damage: 110, range: 135, fireRate: 1.05 }, slow: { multiplier: 0.75, durationSeconds: 1.5 }, visualKey: "frostweaver", visualColor: "#c9f2ff",
  },
  "royal-champion": {
    id: "royal-champion", defenderType: "holy-knight", name: "Royal Champion", role: "Tank / Boss killer",
    description: "Deals 30% extra damage to tank and boss enemies. Ground-only adjacent melee.",
    level3Stats: { damage: 320, fireRate: 1.05 }, bonusDamageClasses: ["tank", "boss"], bonusDamageMultiplier: 1.3, visualKey: "royal-champion", visualColor: "#f4c85f",
  },
  "dawn-paladin": {
    id: "dawn-paladin", defenderType: "holy-knight", name: "Dawn Paladin", role: "Anti-swarm melee",
    description: "Attacks faster and cleaves up to two nearby ground enemies for 40% damage.",
    level3Stats: { damage: 230, fireRate: 1.4 }, splashRatio: 0.4, splashMode: "melee", visualKey: "dawn-paladin", visualColor: "#fff0a3",
  },
  spellblade: {
    id: "spellblade", defenderType: "battlemage", name: "Spellblade", role: "Close-range specialist",
    description: "Melee hits use a 1.60× damage multiplier and 60% splash; ranged fallback is unchanged.",
    level3Stats: { damage: 290, range: 3.6 * WORLD_UNITS_PER_CELL, fireRate: 1.1 }, meleeDamageMultiplier: 1.6, splashRatio: 0.6, splashMode: "melee", visualKey: "spellblade", visualColor: "#ba83ff",
  },
  warcaster: {
    id: "warcaster", defenderType: "battlemage", name: "Warcaster", role: "Ranged AoE specialist",
    description: "Extends range to 4.2 tiles and adds 60% ranged splash; melee remains 1.35×.",
    level3Stats: { damage: 290, range: 4.2 * WORLD_UNITS_PER_CELL, fireRate: 1.1 }, splashRatio: 0.6, splashMode: "ranged", visualKey: "warcaster", visualColor: "#f397ff",
  },
  "dragon-slayer": {
    id: "dragon-slayer", defenderType: "green-archer", name: "Dragon Slayer", role: "Anti-Air Specialist",
    description: "Prioritizes flying enemies and deals 5× damage to air; ground damage stays close to the old L3 baseline.",
    level3Stats: { damage: 78, range: 5 * WORLD_UNITS_PER_CELL, fireRate: 1.55 },
    targetDamageMultipliers: { air: 5, ground: 0.4 }, prioritizeAir: true,
    visualKey: "dragon-slayer", visualColor: "#79e5d0",
  },
  ranger: {
    id: "ranger", defenderType: "green-archer", name: "Ranger", role: "Rapid Generalist",
    description: "Fires 25% faster with balanced ground and air damage. Hits Mark targets for 10% more Archer damage for 3 seconds; refreshes, never stacks.",
    level3Stats: { damage: 55, range: 5 * WORLD_UNITS_PER_CELL, fireRate: 2.25 },
    targetDamageMultipliers: { air: 1.4, ground: 1 }, mark: { damageMultiplier: 1.1, durationSeconds: 3 },
    visualKey: "ranger", visualColor: "#8ddd72",
  },
  "storm-regent": {
    id: "storm-regent", defenderType: "sovereign", name: "Storm Regent", role: "Lightning Pressure",
    description: "Every 3rd attack chains lightning to up to 2 nearby enemies for 40% and 20% damage.",
    level3Stats: { damage: 360, range: 4.5 * WORLD_UNITS_PER_CELL, fireRate: 1.8 },
    chain: { targetCount: 2, damageRatios: [0.4, 0.2], rangeCells: 2.5, everyNthAttack: 3 },
    visualKey: "storm-regent", visualColor: "#80b9ff",
  },
  "war-sovereign": {
    id: "war-sovereign", defenderType: "sovereign", name: "War Sovereign", role: "Elite Executioner",
    description: "Deals 30% more damage to tank and boss enemies before their physical or magic resistance is applied.",
    level3Stats: { damage: 360, range: 4.5 * WORLD_UNITS_PER_CELL, fireRate: 1.8 },
    bonusDamageClasses: ["tank", "boss"], bonusDamageMultiplier: 1.3,
    visualKey: "war-sovereign", visualColor: "#e8b358",
  },
};

export const SPECIALIZATIONS_BY_DEFENDER: Partial<Record<DefenderType, readonly TowerSpecializationId[]>> = {
  "blue-wizard": ["stormcaller", "frostweaver"],
  "holy-knight": ["royal-champion", "dawn-paladin"],
  battlemage: ["spellblade", "warcaster"],
  "green-archer": ["dragon-slayer", "ranger"],
  sovereign: ["storm-regent", "war-sovereign"],
};

export function getSpecialization(id: TowerSpecializationId | undefined): TowerSpecializationConfig | undefined {
  return id ? TOWER_SPECIALIZATIONS[id] : undefined;
}
