import type { Cell } from "../../core/types";
import type { PerimeterSide, RunLayout } from "../map/RunLayout";

export type MapId = "single-spawn" | "two-spawns" | "three-spawns" | "twin-bastion";

export type PlayerId = `player-${number}`;
export interface PlayerSlotDefinition {
  playerId: PlayerId;
  playerIndex: number;
  buildZoneIds: string[];
}
export interface BuildZoneDefinition {
  id: string;
  kind: "private" | "shared";
  ownerPlayerId?: PlayerId;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface MultiplayerMapConfig {
  minPlayers: number;
  maxPlayers: number;
  playerSlots: PlayerSlotDefinition[];
  buildZones: BuildZoneDefinition[];
  startingGoldPerPlayer: number;
  teamStartingLives: number;
}

export interface TerrainRegion {
  id: string;
  cells: Cell[];
}

export interface MapDefinition {
  id: MapId;
  name: string;
  subtitle: string;
  description: string;
  width: number;
  height: number;
  layout: RunLayout;
  /** Cell-level collision/build mask. This remains the gameplay source of truth. */
  terrain: Cell[];
  /** Grouping used only to render one inexpensive cliff formation per region. */
  terrainRegions: TerrainRegion[];
  startingGold: number;
  enemyCountMultiplier: number;
  multiplayer?: MultiplayerMapConfig;
}

const endpoint = (id: string, cell: Cell, side: PerimeterSide) => {
  const entryCell = side === "west" ? { x: cell.x + 1, y: cell.y }
    : side === "east" ? { x: cell.x - 1, y: cell.y }
      : side === "north" ? { x: cell.x, y: cell.y + 1 }
        : { x: cell.x, y: cell.y - 1 };
  return { id, cell: entryCell, gateCell: cell, entryCell, side };
};

const castleEndpoint = (id: string, cell: Cell, side: PerimeterSide) => {
  const gate = endpoint(id, cell, side);
  return { id, cell: gate.entryCell, gateCell: gate.gateCell, approachCell: gate.entryCell, side };
};

const rectangle = (id: string, x: number, y: number, width: number, height: number): TerrainRegion => ({
  id,
  cells: Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, column) => ({ x: x + column, y: y + row }))).flat(),
});

/** Joins adjoining rectangle parts into one terrain formation/plateau. */
const formation = (id: string, ...parts: TerrainRegion[]): TerrainRegion => ({
  id,
  cells: [...new Map(parts.flatMap((part) => part.cells).map((cell) => [`${cell.x},${cell.y}`, cell])).values()],
});

const withTerrain = (...terrainRegions: TerrainRegion[]) => ({
  terrainRegions,
  terrain: [...new Map(terrainRegions.flatMap((region) => region.cells)
    .map((cell) => [`${cell.x},${cell.y}`, cell])).values()],
});

/** Compact battlefields: each axis is about 60% of the original size. */
export const MAPS: Record<MapId, MapDefinition> = {
  "single-spawn": {
    id: "single-spawn", name: "Open Field", subtitle: "1 Spawn · Open sandbox", description: "A clear snowfield. Build the entire maze yourself.",
    width: 17, height: 32,
    layout: {
      castle: castleEndpoint("shared-castle", { x: 8, y: 31 }, "south"),
      activeSpawns: [endpoint("spawn-north", { x: 8, y: 0 }, "north")],
    },
    ...withTerrain(
      // Narrow the central build corridor by two cells from each side.
      rectangle("left-mountain", 0, 5, 5, 22),
      rectangle("right-mountain", 12, 5, 5, 22),
    ),
    startingGold: 100, enemyCountMultiplier: 1,
  },
  "two-spawns": {
    id: "two-spawns", name: "Split Advance", subtitle: "2 Spawns · Late merge", description: "Two open fronts stay apart until the final quarter.",
    width: 23, height: 41,
    layout: {
      castle: castleEndpoint("shared-castle", { x: 11, y: 40 }, "south"),
      activeSpawns: [
        endpoint("spawn-north-west", { x: 6, y: 0 }, "north"),
        endpoint("spawn-north-east", { x: 17, y: 0 }, "north"),
      ],
    },
    ...withTerrain(
      // Outer cliffs frame the two lanes and join the lower funnel masses.
      formation("left-side-funnel-mountain",
        rectangle("left-side-cliff", 0, 0, 3, 31),
        rectangle("lower-left-funnel", 0, 33, 7, 6),
      ),
      formation("right-side-funnel-mountain",
        rectangle("right-side-cliff", 20, 0, 3, 31),
        rectangle("lower-right-funnel", 16, 33, 7, 6),
      ),
      rectangle("central-split-ridge", 10, 0, 3, 29),
    ),
    startingGold: 135, enemyCountMultiplier: 1.5,
  },
  "three-spawns": {
    id: "three-spawns", name: "Triple Convergence", subtitle: "3 Spawns · Three fronts to one", description: "Three open approaches become two broad fronts, then one shared goal lane.",
    width: 43, height: 66,
    layout: {
      castle: castleEndpoint("shared-castle", { x: 21, y: 65 }, "south"),
      activeSpawns: [
        endpoint("spawn-north-west", { x: 8, y: 0 }, "north"),
        endpoint("spawn-north", { x: 21, y: 0 }, "north"),
        endpoint("spawn-north-east", { x: 35, y: 0 }, "north"),
      ],
    },
    ...withTerrain(
      // Three upper lanes, a central plateau, then two routes into the final gap.
      rectangle("left-outer-wall", 0, 0, 3, 66),
      rectangle("right-outer-wall", 40, 0, 3, 66),
      rectangle("left-upper-divider", 13, 0, 4, 21),
      rectangle("right-upper-divider", 26, 0, 4, 21),
      rectangle("center-horizontal-plateau", 10, 30, 23, 11),
      rectangle("lower-left-plateau", 0, 53, 17, 8),
      rectangle("lower-right-plateau", 26, 53, 17, 8),
    ),
    startingGold: 150, enemyCountMultiplier: 2,
  },
  "twin-bastion": {
    id: "twin-bastion", name: "Twin Bastion", subtitle: "2 Players · Shared center", description: "Two defenders hold private fronts and one contested central killzone.",
    width: 77, height: 80,
    layout: {
      castle: castleEndpoint("goal-a", { x: 18, y: 79 }, "south"),
      goals: [
        castleEndpoint("goal-a", { x: 18, y: 79 }, "south"),
        castleEndpoint("goal-b", { x: 58, y: 79 }, "south"),
      ],
      activeSpawns: [
        { ...endpoint("spawn-a", { x: 18, y: 0 }, "north"), preferredGoalId: "goal-a", allowedGoalIds: ["goal-a", "goal-b"], weight: 1 },
        { ...endpoint("spawn-b", { x: 58, y: 0 }, "north"), preferredGoalId: "goal-b", allowedGoalIds: ["goal-a", "goal-b"], weight: 1 },
      ],
    },
    ...withTerrain(
      rectangle("left-forest-wall", 0, 5, 4, 68),
      rectangle("right-forest-wall", 73, 5, 4, 68),
      rectangle("upper-central-ridge", 35, 0, 7, 31),
      formation("left-bastion-ridge",
        rectangle("left-inner-ridge", 25, 19, 6, 18),
        rectangle("left-cross-ridge", 19, 32, 12, 5),
      ),
      formation("right-bastion-ridge",
        rectangle("right-inner-ridge", 46, 19, 6, 18),
        rectangle("right-cross-ridge", 46, 32, 12, 5),
      ),
      rectangle("shared-center-island", 36, 52, 5, 10),
      rectangle("lower-left-shoulder", 4, 64, 10, 8),
      rectangle("lower-right-shoulder", 63, 64, 10, 8),
    ),
    startingGold: 80,
    enemyCountMultiplier: 1.5,
    multiplayer: {
      minPlayers: 2,
      maxPlayers: 2,
      startingGoldPerPlayer: 80,
      teamStartingLives: 20,
      playerSlots: [
        { playerId: "player-1", playerIndex: 0, buildZoneIds: ["p1-private", "shared-center"] },
        { playerId: "player-2", playerIndex: 1, buildZoneIds: ["p2-private", "shared-center"] },
      ],
      buildZones: [
        { id: "p1-private", kind: "private", ownerPlayerId: "player-1", x: 4, y: 1, width: 24, height: 78 },
        { id: "p2-private", kind: "private", ownerPlayerId: "player-2", x: 49, y: 1, width: 24, height: 78 },
        { id: "shared-center", kind: "shared", x: 27, y: 43, width: 23, height: 36 },
      ],
    },
  },
};

export const MAP_CHOICES = Object.values(MAPS);
