import { Cell } from "../../core/types";

/** Large, deliberately open Wintermaul-style snow arena. */
export const CLASSIC_WINTERMAUL = {
  width: 48,
  height: 32,
  spawnGate: { x: 0, y: 16 } satisfies Cell,
  spawnEntry: { x: 1, y: 16 } satisfies Cell,
  exitGate: { x: 47, y: 16 } satisfies Cell,
  exitApproach: { x: 46, y: 16 } satisfies Cell,
  terrain: [
    { x: 0, y: 0 }, { x: 47, y: 0 }, { x: 0, y: 31 }, { x: 47, y: 31 },
    // The gate is environment art at the map edge, not a protected gameplay cell.
    // Keep only the exit gate cell non-buildable in the grid.
    { x: 47, y: 16 },
    { x: 6, y: 4 }, { x: 7, y: 4 }, { x: 40, y: 27 }, { x: 41, y: 27 },
  ] satisfies Cell[],
} as const;
