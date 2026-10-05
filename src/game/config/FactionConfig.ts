import type { DefenderType } from "./DefenderConfig";

export type FactionId = "arcane-kingdom";

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
    name: "Arcane Kingdom",
    tagline: "Balanced & Versatile",
    description: "A balanced faction combining disciplined warriors with powerful arcane magic. Knights hold the frontline while Wizards and Battlemages control the battlefield from behind, making the faction adaptable to most situations without being overly specialized.",
    units: ["blue-wizard", "holy-knight", "green-archer", "battlemage", "sovereign"],
  },
};

export const FACTION_CHOICES: readonly FactionDefinition[] = Object.values(FACTIONS);

export function getFaction(id: FactionId): FactionDefinition {
  return FACTIONS[id];
}
