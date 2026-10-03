import { Cell, cellKey } from "../../core/types";

export class Grid {
  readonly blocked = new Set<string>();
  readonly terrain = new Set<string>();

  constructor(readonly width: number, readonly height: number) {}

  isInside(cell: Cell): boolean {
    return cell.x >= 0 && cell.y >= 0 && cell.x < this.width && cell.y < this.height;
  }

  isBlocked(cell: Cell): boolean { return this.blocked.has(cellKey(cell)); }
  isTerrain(cell: Cell): boolean { return this.terrain.has(cellKey(cell)); }
  isBuildable(cell: Cell): boolean { return this.isInside(cell) && !this.isTerrain(cell) && !this.isBlocked(cell); }
  setTerrain(cell: Cell, value: boolean): void {
    const key = cellKey(cell);
    if (value) { this.terrain.add(key); this.blocked.add(key); } else { this.terrain.delete(key); this.blocked.delete(key); }
  }

  /** Removes placed-tower blocking while retaining the static level terrain. */
  clearTowerBlocks(): void {
    this.blocked.clear();
    for (const key of this.terrain) this.blocked.add(key);
  }
  setBlocked(cell: Cell, value: boolean): void {
    const key = cellKey(cell);
    if (value) this.blocked.add(key); else this.blocked.delete(key);
  }

  neighbors(cell: Cell): Cell[] {
    return [{ x: cell.x + 1, y: cell.y }, { x: cell.x - 1, y: cell.y },
      { x: cell.x, y: cell.y + 1 }, { x: cell.x, y: cell.y - 1 }]
      .filter((next) => this.isInside(next) && !this.isBlocked(next));
  }
}
