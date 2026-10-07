import type { DefenderType } from "./DefenderConfig";

export type FormationId = "arcane-triad" | "holy-formation" | "arcane-vanguard" | "royal-escort" | "spell-battery";
export interface FormationRequirement { defenderType: DefenderType; count: number }
export interface FormationConfig {
  id: FormationId;
  name: string;
  description: string;
  centerTowerType: DefenderType;
  neighborRequirements: readonly FormationRequirement[];
  priority: number;
  damageMultiplier?: number;
  attackSpeedMultiplier?: number;
  rangedDamageMultiplier?: number;
  splashRadiusMultiplier?: number;
  visualKey: string;
  visualColor: string;
}

/** One highest-priority active pattern is selected per tower; bonuses never stack. */
export const FORMATIONS: readonly FormationConfig[] = [
  { id: "arcane-vanguard", name: "Arcane Vanguard", description: "+10% damage, +15% splash radius", centerTowerType: "battlemage", neighborRequirements: [{ defenderType: "blue-wizard", count: 1 }, { defenderType: "holy-knight", count: 1 }], priority: 100, damageMultiplier: 1.1, splashRadiusMultiplier: 1.15, visualKey: "arcane-vanguard", visualColor: "#9bcfff" },
  { id: "arcane-triad", name: "Arcane Triad", description: "+10% attack damage", centerTowerType: "blue-wizard", neighborRequirements: [{ defenderType: "blue-wizard", count: 2 }], priority: 90, damageMultiplier: 1.1, visualKey: "arcane-triad", visualColor: "#69cfff" },
  { id: "holy-formation", name: "Holy Formation", description: "+12% attack speed", centerTowerType: "holy-knight", neighborRequirements: [{ defenderType: "holy-knight", count: 2 }], priority: 90, attackSpeedMultiplier: 1.12, visualKey: "holy-formation", visualColor: "#f6d47c" },
  { id: "royal-escort", name: "Royal Escort", description: "+10% attack speed", centerTowerType: "blue-wizard", neighborRequirements: [{ defenderType: "holy-knight", count: 2 }], priority: 80, attackSpeedMultiplier: 1.1, visualKey: "royal-escort", visualColor: "#d7c3ff" },
  { id: "spell-battery", name: "Spell Battery", description: "+15% ranged damage only", centerTowerType: "battlemage", neighborRequirements: [{ defenderType: "blue-wizard", count: 2 }], priority: 80, rangedDamageMultiplier: 1.15, visualKey: "spell-battery", visualColor: "#8e80ff" },
];

export const FORMATION_BY_ID = Object.fromEntries(FORMATIONS.map((formation) => [formation.id, formation])) as Record<FormationId, FormationConfig>;

/** Pure adjacency evaluation over the eight neighboring logical cells. */
export function resolveFormation(center: { type: DefenderType; cell: { x: number; y: number } }, towers: readonly { type: DefenderType; cell: { x: number; y: number } }[]): FormationConfig | undefined {
  const neighbors = towers.filter((tower) => (tower.cell.x !== center.cell.x || tower.cell.y !== center.cell.y)
    && Math.max(Math.abs(tower.cell.x - center.cell.x), Math.abs(tower.cell.y - center.cell.y)) === 1);
  return FORMATIONS.filter((formation) => formation.centerTowerType === center.type
    && formation.neighborRequirements.every((requirement) => neighbors.filter((tower) => tower.type === requirement.defenderType).length >= requirement.count))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0];
}
