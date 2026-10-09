import { Cell } from "../../core/types";

export type PerimeterSide = "north" | "south" | "west" | "east";

/** `cell` is retained for legacy callers; pathfinding uses the explicit entry cell. */
export interface RunSpawn { id: string; cell: Cell; gateCell: Cell; entryCell: Cell; side: PerimeterSide; }
/** `cell` is retained for legacy callers; pathfinding uses the explicit approach cell. */
export interface RunCastle { id: string; cell: Cell; gateCell: Cell; approachCell: Cell; side: PerimeterSide; }
export interface RunGoal extends RunCastle {}
export interface RunSpawnGoalPolicy {
  preferredGoalId: string;
  allowedGoalIds: string[];
  /** Relative lane pressure. Wave queues are apportioned deterministically by weight. */
  weight: number;
}
export interface RunLayout {
  /** Primary goal alias retained so existing solo integrations stay source-compatible. */
  castle: RunGoal;
  goals?: RunGoal[];
  activeSpawns: Array<RunSpawn & Partial<RunSpawnGoalPolicy>>;
}
