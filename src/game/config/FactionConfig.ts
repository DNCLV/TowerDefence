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
    units: ["blue-wizard", "holy-knight", "green-archer", "battlemage", "sovereign"],
  },
  "ancient-grove": {
    id: "ancient-grove",
    name: "Ancient Grove",
    tagline: "Control & Sustained Exposure",
    description: "LIVING MAZE · Long Grove-controlled paths progressively slow ground enemies. The faction relies on control and sustained exposure rather than high raw damage.",
    units: ["blue-wizard", "holy-knight", "green-archer", "battlemage", "sovereign"],
  },
};

export const FACTION_CHOICES: readonly FactionDefinition[] = Object.values(FACTIONS);

export function getFaction(id: FactionId): FactionDefinition {
  return FACTIONS[id];
}
