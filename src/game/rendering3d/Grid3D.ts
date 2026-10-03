import { Cell } from "../../core/types";

export const TILE_SIZE_3D = 1;

/** Converts framework-free grid coordinates to Babylon's horizontal X/Z plane. */
export function gridToWorld3D(cell: Cell): { x: number; z: number } {
  return { x: (cell.x + 0.5) * TILE_SIZE_3D, z: (cell.y + 0.5) * TILE_SIZE_3D };
}

export function worldToGrid3D(x: number, z: number): Cell {
  return { x: Math.floor(x / TILE_SIZE_3D), y: Math.floor(z / TILE_SIZE_3D) };
}
