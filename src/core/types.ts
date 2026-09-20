/** Framework-free coordinates used by all game systems. */
export interface Cell { x: number; y: number; }

export const sameCell = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;
export const cellKey = (cell: Cell): string => `${cell.x},${cell.y}`;
