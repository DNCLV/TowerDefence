import type { DefenderType } from "./DefenderConfig";

export type FactionId = "arcane-kingdom" | "ancient-grove";

export interface FactionDefinition {
  id: FactionId;
  name: string;
  tagline: string;
  description: string;
  /** Units available to a player who selects this faction. */
  units: readonly DefenderType[];
}

/** Faction catalogue. Keep faction-owned unit lists here, not in setup UI. */
export const FACTIONS: Record<FactionId, FactionDefinition> = {
  "arcane-kingdom": {
    id: "arcane-kingdom",
    name: "Royal Guard",
    tagline: "Balanced & Versatile",
    description: "VETERAN CORPS · Towers grow stronger through combat experience. A balanced faction combining disciplined warriors with powerful arcane magic.",
    units: ["blue-wizard", "holy-knight", "green-archer", "battlemage", "sovereign", "holy-emperor"],
  },
  "ancient-grove": {
    id: "ancient-grove",
    name: "Ancient Grove",
    tagline: "Nature Magic, Control & Synergy",
    description: "LIVING MAZE · Nature magic, thorns, DoTs and slows reward strong positioning. Grove defenders control clustered ground enemies and combine auras to extend that pressure into the air.",
    units: ["treant", "thorn-owl", "druid", "seer", "bark-titan", "thorn-dancer"],
  },
};

export const FACTION_CHOICES: readonly FactionDefinition[] = Object.values(FACTIONS);

export function getFaction(id: FactionId): FactionDefinition {
  return FACTIONS[id];
}
