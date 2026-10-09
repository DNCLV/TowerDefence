import type { FactionId } from "./config/FactionConfig";
import type { PlayerId } from "./config/MapConfig";

/** Portable authoritative player-slot state. It intentionally contains no UI or renderer objects. */
export interface PlayerState {
  playerId: PlayerId;
  playerIndex: number;
  gold: number;
  factionId: FactionId;
  ownedTowerIds: number[];
  buildZoneIds: string[];
}
