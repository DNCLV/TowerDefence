import type { Cell } from "../../core/types";
import type { GameState } from "../GameState";
import type { MapDefinition } from "../config/MapConfig";

export interface MinimapCameraView {
  x: number;
  y: number;
  width: number;
  height: number;
}

const UPDATE_INTERVAL_MS = 80;
const MAP_INSET_PX = 4;

/** Small, display-only canvas overview. It reads state but never mutates gameplay. */
export class MinimapRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly staticLayer: HTMLCanvasElement;
  private readonly resizeObserver: ResizeObserver;
  private latestState?: GameState;
  private latestCameraView?: MinimapCameraView;
  private lastDrawAt = Number.NEGATIVE_INFINITY;
  private disposed = false;

  constructor(
    private readonly panel: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly map: MapDefinition,
  ) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("2D canvas is unavailable for the minimap.");
    this.context = context;
    canvas.style.aspectRatio = `${map.width} / ${map.height}`;
    panel.dataset.mapId = map.id;
    panel.dataset.mapDimensions = `${map.width}x${map.height}`;
    panel.dataset.terrainCells = String(map.terrain.length);
    panel.dataset.spawnCount = String(map.layout.activeSpawns.length);
    panel.dataset.goalCell = `${map.layout.castle.gateCell.x},${map.layout.castle.gateCell.y}`;

    this.staticLayer = document.createElement("canvas");
    this.staticLayer.width = map.width * 4;
    this.staticLayer.height = map.height * 4;
    this.drawStaticLayer();

    this.resizeObserver = new ResizeObserver(() => this.draw(true));
    this.resizeObserver.observe(canvas);
  }

  /** Called from the normal renderer sync; internal throttling keeps it near 12.5 Hz. */
  update(state: GameState, cameraView: MinimapCameraView, nowMs = performance.now()): void {
    this.latestState = state;
    this.latestCameraView = cameraView;
    if (nowMs - this.lastDrawAt < UPDATE_INTERVAL_MS) return;
    this.draw(false, nowMs);
  }

  /** Force an immediate refresh after in-memory reset or resize. */
  refresh(state: GameState, cameraView: MinimapCameraView): void {
    this.latestState = state;
    this.latestCameraView = cameraView;
    this.draw(true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.latestState = undefined;
    this.latestCameraView = undefined;
    this.canvas.width = 1;
    this.canvas.height = 1;
    delete this.panel.dataset.towerCount;
    delete this.panel.dataset.enemyCount;
  }

  private draw(force: boolean, nowMs = performance.now()): void {
    if (this.disposed) return;
    const state = this.latestState;
    if (!state) return;
    if (!force && nowMs - this.lastDrawAt < UPDATE_INTERVAL_MS) return;

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }

    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.context.clearRect(0, 0, rect.width, rect.height);
    const mapRect = {
      x: MAP_INSET_PX,
      y: MAP_INSET_PX,
      width: Math.max(1, rect.width - MAP_INSET_PX * 2),
      height: Math.max(1, rect.height - MAP_INSET_PX * 2),
    };
    this.context.drawImage(this.staticLayer, mapRect.x, mapRect.y, mapRect.width, mapRect.height);
    this.context.save();
    this.context.beginPath();
    this.context.rect(mapRect.x, mapRect.y, mapRect.width, mapRect.height);
    this.context.clip();

    const minCellSize = Math.min(mapRect.width / this.map.width, mapRect.height / this.map.height);
    const towerRadius = Math.max(1.15, Math.min(2.8, minCellSize * 0.38));
    this.context.fillStyle = "#55e69b";
    for (const tower of state.towers) {
      this.drawDot(this.cellToCanvas(tower.cell, mapRect), towerRadius);
    }

    const activeEnemies = state.enemies.filter((enemy) => enemy.alive);
    this.context.fillStyle = "#ff5159";
    for (const enemy of activeEnemies) {
      this.drawDot(this.cellToCanvas({ x: enemy.x, y: enemy.y }, mapRect), Math.max(1.35, towerRadius * 0.78));
    }

    if (this.latestCameraView) this.drawCameraView(this.latestCameraView, mapRect);
    this.context.restore();

    this.panel.dataset.towerCount = String(state.towers.length);
    this.panel.dataset.enemyCount = String(activeEnemies.length);
    this.canvas.setAttribute("aria-label", `Map overview: ${state.towers.length} towers, ${activeEnemies.length} active enemies`);
    this.lastDrawAt = nowMs;
  }

  private drawStaticLayer(): void {
    const context = this.staticLayer.getContext("2d");
    if (!context) return;
    const cellWidth = this.staticLayer.width / this.map.width;
    const cellHeight = this.staticLayer.height / this.map.height;
    context.fillStyle = "#d5e2e5";
    context.fillRect(0, 0, this.staticLayer.width, this.staticLayer.height);

    // Very soft cell lines make tower spacing legible without turning the minimap noisy.
    context.strokeStyle = "rgba(45, 73, 84, 0.12)";
    context.lineWidth = 0.6;
    context.beginPath();
    for (let x = 1; x < this.map.width; x += 1) {
      context.moveTo(x * cellWidth, 0);
      context.lineTo(x * cellWidth, this.staticLayer.height);
    }
    for (let y = 1; y < this.map.height; y += 1) {
      context.moveTo(0, y * cellHeight);
      context.lineTo(this.staticLayer.width, y * cellHeight);
    }
    context.stroke();

    context.fillStyle = "#63757d";
    for (const cell of this.map.terrain) {
      context.fillRect(cell.x * cellWidth, cell.y * cellHeight, cellWidth, cellHeight);
    }
    context.fillStyle = "rgba(232, 246, 247, 0.28)";
    for (const cell of this.map.terrain) {
      context.fillRect(cell.x * cellWidth, cell.y * cellHeight, cellWidth, Math.max(1, cellHeight * 0.16));
    }

    const marker = (cell: Cell, color: string, radius: number): void => {
      context.beginPath();
      context.arc((cell.x + 0.5) * cellWidth, (cell.y + 0.5) * cellHeight, radius, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
      context.strokeStyle = "rgba(12, 24, 32, 0.78)";
      context.lineWidth = Math.max(1, radius * 0.28);
      context.stroke();
    };
    for (const spawn of this.map.layout.activeSpawns) marker(spawn.gateCell, "#55b9ff", Math.min(cellWidth, cellHeight) * 0.72);
    marker(this.map.layout.castle.gateCell, "#f5d16f", Math.min(cellWidth, cellHeight) * 0.82);

    context.strokeStyle = "rgba(231, 246, 250, 0.9)";
    context.lineWidth = Math.max(2, cellWidth * 0.14);
    context.strokeRect(context.lineWidth / 2, context.lineWidth / 2,
      this.staticLayer.width - context.lineWidth, this.staticLayer.height - context.lineWidth);
  }

  private drawDot(point: { x: number; y: number }, radius: number): void {
    this.context.beginPath();
    this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    this.context.fill();
    this.context.strokeStyle = "rgba(4, 15, 20, 0.9)";
    this.context.lineWidth = 0.8;
    this.context.stroke();
  }

  private drawCameraView(view: MinimapCameraView, mapRect: { x: number; y: number; width: number; height: number }): void {
    const x = mapRect.x + view.x / this.map.width * mapRect.width;
    const y = mapRect.y + view.y / this.map.height * mapRect.height;
    const width = view.width / this.map.width * mapRect.width;
    const height = view.height / this.map.height * mapRect.height;
    this.context.strokeStyle = "rgba(255, 255, 255, 0.92)";
    this.context.lineWidth = 1.2;
    this.context.setLineDash([3, 2]);
    this.context.strokeRect(x, y, width, height);
    this.context.setLineDash([]);
  }

  private cellToCanvas(cell: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
    return {
      x: rect.x + (cell.x + 0.5) / this.map.width * rect.width,
      y: rect.y + (cell.y + 0.5) / this.map.height * rect.height,
    };
  }
}
