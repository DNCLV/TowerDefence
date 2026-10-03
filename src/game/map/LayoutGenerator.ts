import { Grid } from "../grid/Grid";
import { findPath } from "../pathfinding/Pathfinder";
import { CASTLE_CANDIDATES, SPAWN_CANDIDATES } from "../config/Level1";
import { RunLayout } from "./RunLayout";
import { PerimeterSide, RunCastle, RunSpawn } from "./RunLayout";
import { CLASSIC_WINTERMAUL } from "../config/ClassicWintermaul";

const MIN_PATH_DISTANCE = 10;
const MAX_REROLLS = 20;

/** Pure map-start generation. A seedable random callback can be supplied later. */
export function generateRunLayout(grid: Grid, random: () => number = Math.random): RunLayout {
  // Current standard map is classic Wintermaul: one fixed left-to-right lane.
  if (grid.width === CLASSIC_WINTERMAUL.width && grid.height === CLASSIC_WINTERMAUL.height) {
    return {
      castle: { id: "castle_classic", cell: { ...CLASSIC_WINTERMAUL.exitApproach }, gateCell: { ...CLASSIC_WINTERMAUL.exitGate }, approachCell: { ...CLASSIC_WINTERMAUL.exitApproach }, side: "east" },
      activeSpawns: [{ id: "spawn_classic", cell: { ...CLASSIC_WINTERMAUL.spawnEntry }, gateCell: { ...CLASSIC_WINTERMAUL.spawnGate }, entryCell: { ...CLASSIC_WINTERMAUL.spawnEntry }, side: "west" }],
    };
  }
  for (let attempt = 0; attempt < MAX_REROLLS; attempt += 1) {
    const castle = CASTLE_CANDIDATES[Math.floor(random() * CASTLE_CANDIDATES.length)];
    const eligible = SPAWN_CANDIDATES.filter((spawn) => {
      const path = findPath(grid, insideGate(spawn.cell, sideFor(spawn.cell, grid)), insideGate(castle.cell, sideFor(castle.cell, grid)));
      return path !== null && path.length - 1 >= MIN_PATH_DISTANCE;
    });
    if (eligible.length < 2) continue;
    const wanted = 2 + Math.floor(random() * 4);
    const shuffled = [...eligible].sort(() => random() - 0.5);
    return { castle: asCastleGate(castle.id, castle.cell, grid), activeSpawns: shuffled.slice(0, Math.min(wanted, eligible.length)).map((spawn) => asSpawnGate(spawn.id, spawn.cell, grid)) };
  }
  // The fixed map has valid combinations; this defensive fallback avoids an infinite retry loop.
  const castle = CASTLE_CANDIDATES[0];
  return { castle: asCastleGate(castle.id, castle.cell, grid), activeSpawns: SPAWN_CANDIDATES.slice(0, 2).map((spawn) => asSpawnGate(spawn.id, spawn.cell, grid)) };
}

function sideFor(cell: { x: number; y: number }, grid: Grid): PerimeterSide {
  if (cell.x === 0) return "west";
  if (cell.x === grid.width - 1) return "east";
  if (cell.y === 0) return "north";
  return "south";
}

function insideGate(cell: { x: number; y: number }, side: PerimeterSide): { x: number; y: number } {
  if (side === "west") return { x: cell.x + 1, y: cell.y };
  if (side === "east") return { x: cell.x - 1, y: cell.y };
  if (side === "north") return { x: cell.x, y: cell.y + 1 };
  return { x: cell.x, y: cell.y - 1 };
}

function asSpawnGate(id: string, gateCell: { x: number; y: number }, grid: Grid): RunSpawn {
  const side = sideFor(gateCell, grid); const entryCell = insideGate(gateCell, side);
  return { id, cell: entryCell, gateCell: { ...gateCell }, entryCell, side };
}

function asCastleGate(id: string, gateCell: { x: number; y: number }, grid: Grid): RunCastle {
  const side = sideFor(gateCell, grid); const approachCell = insideGate(gateCell, side);
  return { id, cell: approachCell, gateCell: { ...gateCell }, approachCell, side };
}
