import { Cell, cellKey } from "../../core/types";

export class Grid {
  readonly blocked = new Set<string>();

  constructor(readonly width: number, readonly height: number) {}

  isInside(cell: Cell): boolean {
    return cell.x >= 0 && cell.y >= 0 && cell.x < this.width && cell.y < this.height;
  }

  isBlocked(cell: Cell): boolean { return this.blocked.has(cellKey(cell)); }
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
