import { Cell } from "../../core/types";

/** Static data only: later levels can implement the same small shape. */
export const LEVEL_1 = {
  width: 12,
  height: 14,
  spawn: { x: 0, y: 7 },
  exit: { x: 11, y: 7 },
  terrain: [
    { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 3 },
    { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 8, y: 6 },
    { x: 4, y: 10 }, { x: 5, y: 10 }, { x: 5, y: 11 },
  ] satisfies Cell[],
} as const;

export interface SpawnPointDefinition { id: string; cell: Cell; }
export interface CastlePointDefinition { id: string; cell: Cell; }

export const SPAWN_CANDIDATES: SpawnPointDefinition[] = [
  { id: "spawn_nw", cell: { x: 0, y: 1 } },
  { id: "spawn_n", cell: { x: 4, y: 0 } },
  { id: "spawn_ne", cell: { x: 10, y: 0 } },
  { id: "spawn_w", cell: { x: 0, y: 12 } },
  { id: "spawn_e", cell: { x: 11, y: 12 } },
];

export const CASTLE_CANDIDATES: CastlePointDefinition[] = [
  { id: "castle_sw", cell: { x: 2, y: 13 } },
  { id: "castle_s", cell: { x: 6, y: 13 } },
  { id: "castle_se", cell: { x: 10, y: 13 } },
  { id: "castle_w", cell: { x: 0, y: 7 } },
  { id: "castle_e", cell: { x: 11, y: 7 } },
];
