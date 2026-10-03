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
  /** Simplified portrait preview route/obstacle paths in a normalized 100×100 SVG viewBox. */
  previewPaths: string[];
  previewObstaclePaths: string[];
  previewSpawnXs: number[];
  previewSpawnColors: string[];
  previewGoalX: number;
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
    ...withTerrain(),
    startingGold: 70, enemyCountMultiplier: 1,
    previewPaths: ["M50 4 L50 96"],
    previewObstaclePaths: [],
    previewSpawnXs: [50], previewSpawnColors: ["#ff6b66"], previewGoalX: 50,
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
      // The full-width ridge prevents any cross-map shortcut until y=51 (75% of map length).
      rectangle("central-split-ridge", 18, 0, 2, 51),
    ),
    startingGold: 110, enemyCountMultiplier: 1.5,
    finalLaneTarget: { x: 19, y: 51 },
    previewPaths: [
      "M25 4 L25 78 Q25 83 50 83 L50 96",
      "M75 4 L75 78 Q75 83 50 83 L50 96",
    ],
    previewObstaclePaths: ["M47 4 L47 77 L53 77 L53 4Z"],
    previewSpawnXs: [25, 75], previewSpawnColors: ["#ff6b66", "#69c5ff"], previewGoalX: 50,
  },
  "three-spawns": {
    id: "three-spawns", name: "Triple Convergence", subtitle: "3 Spawns · Three fronts to one", description: "Three open approaches become two broad fronts, then one shared goal lane.",
    width: 48, height: 82,
    layout: {
      castle: castleEndpoint("shared-castle", { x: 24, y: 81 }, "south"),
      activeSpawns: [
        endpoint("spawn-north-west", { x: 7, y: 0 }, "north"),
        endpoint("spawn-north", { x: 24, y: 0 }, "north"),
        endpoint("spawn-north-east", { x: 40, y: 0 }, "north"),
      ],
    },
    ...withTerrain(
      // Three broad early fields. The west divider ends at row 28 (~35% of map height).
      rectangle("west-center-divider", 15, 0, 2, 29),
      // This divider keeps the joined west front and right front separate until the two gates.
      rectangle("center-east-divider", 31, 0, 2, 70),
      // Lower ridges guide the two fronts toward their own opening while retaining 6–14 cell
      // build areas on either side; their northern ends remain passable for route choice.
      rectangle("west-lower-funnel", 13, 40, 2, 30),
      rectangle("east-lower-funnel", 39, 40, 2, 30),
      // A continuous snowy shelf blocks bypassing around the convergence. Four-cell openings
      // at x=17..20 and x=34..37 feed the single shared final field below.
      rectangle("convergence-west-shelf", 0, 70, 17, 4),
      rectangle("convergence-center-shelf", 21, 70, 13, 4),
      rectangle("convergence-east-shelf", 38, 70, 10, 4),
    ),
    startingGold: 150, enemyCountMultiplier: 2,
    convergenceOpenings: [{ x: 18, y: 71 }, { x: 35, y: 71 }],
    finalLaneTarget: { x: 24, y: 77 },
    previewPaths: [
      "M16 4 L16 34 Q16 39 31 44 L37 83 L50 89 L50 96",
      "M50 4 L50 38 L37 83 L50 89 L50 96",
      "M83 4 L83 79 L74 83 L50 89 L50 96",
    ],
    previewObstaclePaths: [
      "M31 4 L31 38 L34 38 L34 4Z",
      "M65 4 L65 82 L68 82 L68 4Z",
      "M28 49 L30 49 L30 84 L28 84Z",
      "M81 49 L85 49 L85 84 L81 84Z",
      "M0 85 L36 85 L36 89 L0 89Z",
      "M42 85 L71 85 L71 89 L42 89Z",
      "M77 85 L100 85 L100 89 L77 89Z",
    ],
    previewSpawnXs: [15, 51, 85], previewSpawnColors: ["#ff6b66", "#69aaff", "#69df9c"], previewGoalX: 51,
  },
};

export const MAP_CHOICES = Object.values(MAPS);
