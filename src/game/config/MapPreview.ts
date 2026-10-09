import type { Cell } from "../../core/types";
import type { MapDefinition } from "./MapConfig";

/** A non-overlapping rectangle, expressed in gameplay grid-cell units. */
export interface TerrainPreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapPreviewGeometry {
  width: number;
  height: number;
  terrain: TerrainPreviewRect[];
  spawns: Array<{ id: string; cell: Cell }>;
  goals: Array<{ id: string; cell: Cell }>;
  /** Primary goal alias retained for existing consumers. */
  goal: Cell;
}

/**
 * Compact a cell mask into exact, non-overlapping rectangles. The preview uses these
 * silhouettes instead of separately-authored route art, so blocked/open areas cannot drift.
 */
export function groupTerrainCells(cells: readonly Cell[]): TerrainPreviewRect[] {
  const rows = new Map<number, number[]>();
  for (const { x, y } of cells) {
    const row = rows.get(y) ?? [];
    row.push(x);
    rows.set(y, row);
  }

  const active = new Map<string, TerrainPreviewRect>();
  const completed: TerrainPreviewRect[] = [];
  const rowYs = [...rows.keys()].sort((a, b) => a - b);
  let previousY: number | undefined;

  for (const y of rowYs) {
    if (previousY !== undefined && y !== previousY + 1) {
      completed.push(...active.values());
      active.clear();
    }

    const xs = [...new Set(rows.get(y) ?? [])].sort((a, b) => a - b);
    const runs: Array<{ x: number; width: number }> = [];
    for (const x of xs) {
      const previous = runs[runs.length - 1];
      if (previous && previous.x + previous.width === x) previous.width += 1;
      else runs.push({ x, width: 1 });
    }

    const currentKeys = new Set(runs.map(({ x, width }) => `${x}:${width}`));
    for (const [key, rectangle] of active) {
      if (!currentKeys.has(key)) {
        completed.push(rectangle);
        active.delete(key);
      }
    }
    for (const run of runs) {
      const key = `${run.x}:${run.width}`;
      const rectangle = active.get(key);
      if (rectangle) rectangle.height += 1;
      else active.set(key, { ...run, y, height: 1 });
    }
    previousY = y;
  }

  completed.push(...active.values());
  return completed.sort((a, b) => a.y - b.y || a.x - b.x || a.width - b.width);
}

/** Preview coordinates and terrain are projected directly from gameplay map data. */
export function getMapPreviewGeometry(map: MapDefinition): MapPreviewGeometry {
  return {
    width: map.width,
    height: map.height,
    terrain: groupTerrainCells(map.terrain),
    spawns: map.layout.activeSpawns.map(({ id, gateCell }) => ({ id, cell: gateCell })),
    goals: (map.layout.goals ?? [map.layout.castle]).map(({ id, gateCell }) => ({ id, cell: gateCell })),
    goal: map.layout.castle.gateCell,
  };
}
