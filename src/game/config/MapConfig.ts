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

/** Fixed, intentionally large battlefields with broad player-built maze fields. */
export const MAPS: Record<MapId, MapDefinition> = {
  "single-spawn": {
    id: "single-spawn", name: "Open Field", subtitle: "1 Spawn · Open sandbox", description: "A clear snowfield. Build the entire maze yourself.",
    width: 40, height: 80,
    layout: {
      castle: castleEndpoint("shared-castle", { x: 20, y: 79 }, "south"),
      activeSpawns: [endpoint("spawn-north", { x: 20, y: 0 }, "north")],
    },
    ...withTerrain(),
    startingGold: 70, enemyCountMultiplier: 1,
    previewPaths: ["M50 4 L50 96"],
    previewObstaclePaths: [],
    previewSpawnXs: [50], previewSpawnColors: ["#ff6b66"], previewGoalX: 50,
  },
  "two-spawns": {
    id: "two-spawns", name: "Split Advance", subtitle: "2 Spawns · Late merge", description: "Two open fronts stay apart until the final quarter.",
    width: 56, height: 100,
    layout: {
      castle: castleEndpoint("shared-castle", { x: 28, y: 99 }, "south"),
      activeSpawns: [
        endpoint("spawn-north-west", { x: 14, y: 0 }, "north"),
        endpoint("spawn-north-east", { x: 41, y: 0 }, "north"),
      ],
    },
    ...withTerrain(
      // The full-width ridge prevents any cross-map shortcut until y=75 (75% of map length).
      rectangle("central-split-ridge", 27, 0, 2, 75),
    ),
    startingGold: 110, enemyCountMultiplier: 1.5,
    finalLaneTarget: { x: 28, y: 75 },
    previewPaths: [
      "M25 4 L25 78 Q25 83 50 83 L50 96",
      "M75 4 L75 78 Q75 83 50 83 L50 96",
    ],
    previewObstaclePaths: ["M47 4 L47 77 L53 77 L53 4Z"],
    previewSpawnXs: [25, 75], previewSpawnColors: ["#ff6b66", "#69c5ff"], previewGoalX: 50,
  },
  "three-spawns": {
    id: "three-spawns", name: "Triple Convergence", subtitle: "3 Spawns · Three fronts to one", description: "Three open approaches become two broad fronts, then one shared goal lane.",
    width: 70, height: 120,
    layout: {
      castle: castleEndpoint("shared-castle", { x: 35, y: 119 }, "south"),
      activeSpawns: [
        endpoint("spawn-north-west", { x: 11, y: 0 }, "north"),
        endpoint("spawn-north", { x: 35, y: 0 }, "north"),
        endpoint("spawn-north-east", { x: 58, y: 0 }, "north"),
      ],
    },
    ...withTerrain(
      // Three broad early fields. The west divider ends at 35% height, joining left + center.
      rectangle("west-center-divider", 23, 0, 2, 43),
      // This divider keeps the joined west front and right front separate until the two gates.
      rectangle("center-east-divider", 46, 0, 2, 102),
      // Lower mountain shelves guide each broad front toward its own opening without narrowing
      // the build fields; each can still be routed around above its northern end.
      rectangle("west-lower-funnel", 20, 58, 2, 44),
      rectangle("east-lower-funnel", 56, 58, 2, 44),
      // A continuous snowy shelf blocks bypassing around the convergence. Four-cell openings
      // at x=25..28 and x=50..53 feed the single shared final field below.
      rectangle("convergence-west-shelf", 0, 102, 25, 4),
      rectangle("convergence-center-shelf", 29, 102, 21, 4),
      rectangle("convergence-east-shelf", 54, 102, 16, 4),
    ),
    startingGold: 150, enemyCountMultiplier: 2,
    convergenceOpenings: [{ x: 26, y: 103 }, { x: 51, y: 103 }],
    finalLaneTarget: { x: 35, y: 112 },
    previewPaths: [
      "M16 4 L16 34 Q16 39 31 44 L37 83 L50 89 L50 96",
      "M50 4 L50 38 L37 83 L50 89 L50 96",
      "M83 4 L83 79 L74 83 L50 89 L50 96",
    ],
    previewObstaclePaths: [
      "M31 4 L31 38 L34 38 L34 4Z",
      "M65 4 L65 82 L68 82 L68 4Z",
      "M28 49 L30 49 L30 84 L28 84Z",
      "M80 49 L82 49 L82 84 L80 84Z",
      "M0 85 L36 85 L36 89 L0 89Z",
      "M42 85 L71 85 L71 89 L42 89Z",
      "M77 85 L100 85 L100 89 L77 89Z",
    ],
    previewSpawnXs: [16, 50, 83], previewSpawnColors: ["#ff6b66", "#69aaff", "#69df9c"], previewGoalX: 50,
  },
};

export const MAP_CHOICES = Object.values(MAPS);
