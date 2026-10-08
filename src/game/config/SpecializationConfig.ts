import type { DefenderType } from "./DefenderConfig";
import { WORLD_UNITS_PER_CELL } from "../../core/GameConstants";

export type TowerSpecializationId = "stormcaller" | "frostweaver" | "royal-champion" | "dawn-paladin" | "spellblade" | "warcaster"
  | "dragon-slayer" | "ranger" | "storm-regent" | "war-sovereign"
  | "needlewing-owl" | "elderwing" | "dire-wolf" | "elder-bear" | "moon-seer" | "sun-seer";
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
  /** Per-secondary ratios for limited multi-target attacks. */
  splashRatios?: readonly number[];
  splashTargetLimit?: number;
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
  "needlewing-owl": {
    id: "needlewing-owl", defenderType: "thorn-owl", name: "Needlewing Owl", role: "Flying tank / boss killer",
    description: "90 damage at 2.10 attacks/sec, 7.5 tiles. Ignores 40% of physical resistance and deals 25% extra damage to flying tanks and bosses.",
    level3Stats: { damage: 90, range: 7.5 * WORLD_UNITS_PER_CELL, fireRate: 2.1 },
    bonusDamageClasses: ["tank", "boss"], bonusDamageMultiplier: 1.25, visualKey: "needlewing-owl", visualColor: "#a9d875",
  },
  elderwing: {
    id: "elderwing", defenderType: "thorn-owl", name: "Elderwing", role: "Flying swarm",
    description: "70 damage at 1.50 attacks/sec, 8 tiles. Thorn Volley hits up to two additional flying enemies for 70% and 45% damage.",
    level3Stats: { damage: 70, range: 8 * WORLD_UNITS_PER_CELL, fireRate: 1.5 },
    splashRatios: [0.7, 0.45], splashTargetLimit: 2, visualKey: "elderwing", visualColor: "#7fc99c",
  },
  "dire-wolf": {
    id: "dire-wolf", defenderType: "druid", name: "Dire Wolf", role: "Single-target tank / boss killer",
    description: "95 damage at 2.50 attacks/sec. Ignores 50% of physical resistance, deals 30% extra damage to tanks and bosses, and gains 15% attack speed at 4+ seconds of Living Maze exposure.",
    level3Stats: { damage: 95, fireRate: 2.5 },
    bonusDamageClasses: ["tank", "boss"], bonusDamageMultiplier: 1.3, visualKey: "dire-wolf", visualColor: "#8ba75d",
  },
  "elder-bear": {
    id: "elder-bear", defenderType: "druid", name: "Elder Bear", role: "Slow cleave / pack thinner",
    description: "310 damage at 0.80 attacks/sec. Great Swipe hits up to three additional nearby ground enemies for 55% damage, increasing to 70% at 4+ seconds of exposure.",
    level3Stats: { damage: 310, fireRate: 0.8 },
    splashRatio: 0.55, splashMode: "melee", splashTargetLimit: 3, visualKey: "elder-bear", visualColor: "#b48955",
  },
  "moon-seer": {
    id: "moon-seer", defenderType: "seer", name: "Moon Seer", role: "Ramping single target",
    description: "260 magic damage at 1.15 attacks/sec, 5.5 tiles. Repeated hits on the same target ramp damage by 0%, 10%, 20%, then 35%; changing target resets the ramp.",
    level3Stats: { damage: 260, range: 5.5 * WORLD_UNITS_PER_CELL, fireRate: 1.15 },
    visualKey: "moon-seer", visualColor: "#9c98e8",
  },
  "sun-seer": {
    id: "sun-seer", defenderType: "seer", name: "Sun Seer", role: "Hybrid / Sunbrand DoT",
    description: "95 magic damage at 1.10 attacks/sec, 5.5 tiles. Hits one nearby secondary for 60%; hits apply Sunbrand, and a hit on a 4-stack target detonates for 180 magic damage.",
    level3Stats: { damage: 95, range: 5.5 * WORLD_UNITS_PER_CELL, fireRate: 1.1 },
    splashRatio: 0.6, splashTargetLimit: 1, visualKey: "sun-seer", visualColor: "#f1c867",
  },
};

export const SPECIALIZATIONS_BY_DEFENDER: Partial<Record<DefenderType, readonly TowerSpecializationId[]>> = {
  "blue-wizard": ["stormcaller", "frostweaver"],
  "holy-knight": ["royal-champion", "dawn-paladin"],
  battlemage: ["spellblade", "warcaster"],
  "green-archer": ["dragon-slayer", "ranger"],
  sovereign: ["storm-regent", "war-sovereign"],
  "thorn-owl": ["needlewing-owl", "elderwing"],
  druid: ["dire-wolf", "elder-bear"],
  seer: ["moon-seer", "sun-seer"],
};

export function getSpecialization(id: TowerSpecializationId | undefined): TowerSpecializationConfig | undefined {
  return id ? TOWER_SPECIALIZATIONS[id] : undefined;
}
