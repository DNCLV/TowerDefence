import type { Cell } from "../../core/types";
import type { PerimeterSide, RunLayout } from "../map/RunLayout";

export type MapId = "single-spawn" | "two-spawns" | "three-spawns";

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
  /** Optional route choices; each selected cell is a controlled opening in the terrain. */
  midLaneTargets?: Cell[];
  /** Named openings that connect map-specific ground fronts into the shared final field. */
  convergenceOpenings?: Cell[];
  /** Shared route waypoint after map-specific convergence. */
  finalLaneTarget?: Cell;
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

/** Fixed battlefields sized for portrait play, with broad player-built maze fields. */
export const MAPS: Record<MapId, MapDefinition> = {
  "single-spawn": {
    id: "single-spawn", name: "Open Field", subtitle: "1 Spawn · Open sandbox", description: "A clear snowfield. Build the entire maze yourself.",
    width: 28, height: 54,
    layout: {
      castle: castleEndpoint("shared-castle", { x: 14, y: 53 }, "south"),
      activeSpawns: [endpoint("spawn-north", { x: 14, y: 0 }, "north")],
    },
    ...withTerrain(
      rectangle("left-mountain", 0, 9, 5, 36),
      rectangle("right-mountain", 23, 9, 5, 36),
    ),
    startingGold: 70, enemyCountMultiplier: 1,
  },
  "two-spawns": {
    id: "two-spawns", name: "Split Advance", subtitle: "2 Spawns · Late merge", description: "Two open fronts stay apart until the final quarter.",
    width: 38, height: 68,
    layout: {
      castle: castleEndpoint("shared-castle", { x: 19, y: 67 }, "south"),
      activeSpawns: [
        endpoint("spawn-north-west", { x: 9, y: 0 }, "north"),
        endpoint("spawn-north-east", { x: 28, y: 0 }, "north"),
      ],
    },
    ...withTerrain(
      // Outer cliffs frame the two open lanes and join the lower funnel masses.
      formation("left-side-funnel-mountain",
        rectangle("left-side-cliff", 0, 0, 4, 51),
        rectangle("lower-left-funnel", 0, 55, 11, 9),
      ),
      formation("right-side-funnel-mountain",
        rectangle("right-side-cliff", 34, 0, 4, 51),
        rectangle("lower-right-funnel", 27, 55, 11, 9),
      ),
      // The ridge and lower funnel masses are separated by eight completely open rows.
      rectangle("central-split-ridge", 16, 0, 6, 47),
    ),
    startingGold: 110, enemyCountMultiplier: 1.5,
    finalLaneTarget: { x: 19, y: 51 },
  },
  "three-spawns": {
    id: "three-spawns", name: "Triple Convergence", subtitle: "3 Spawns · Three fronts to one", description: "Three open approaches become two broad fronts, then one shared goal lane.",
    width: 72, height: 110,
    layout: {
      castle: castleEndpoint("shared-castle", { x: 36, y: 109 }, "south"),
      activeSpawns: [
        endpoint("spawn-north-west", { x: 13, y: 0 }, "north"),
        endpoint("spawn-north", { x: 36, y: 0 }, "north"),
        endpoint("spawn-north-east", { x: 58, y: 0 }, "north"),
      ],
    },
    ...withTerrain(
      // Seven exact rectangles make three broad 16-cell upper lanes and continuous outer edges.
      rectangle("left-outer-wall", 0, 0, 5, 110),
      rectangle("right-outer-wall", 67, 0, 5, 110),
      rectangle("left-upper-divider", 21, 0, 7, 35),
      rectangle("right-upper-divider", 44, 0, 7, 35),
      // 38 cells = 61% of the 62-cell interior, leaving 12-cell routes on both sides.
      rectangle("center-horizontal-plateau", 17, 50, 38, 18),
      // Broad lower plateaus connect to the outer walls while preserving a 16-cell final gap.
      rectangle("lower-left-plateau", 0, 88, 28, 14),
      rectangle("lower-right-plateau", 44, 88, 28, 14),
    ),
    startingGold: 150, enemyCountMultiplier: 2,
    midLaneTargets: [{ x: 16, y: 76 }, { x: 55, y: 76 }],
    convergenceOpenings: [{ x: 16, y: 76 }, { x: 55, y: 76 }],
    finalLaneTarget: { x: 36, y: 105 },
  },
};

export const MAP_CHOICES = Object.values(MAPS);
