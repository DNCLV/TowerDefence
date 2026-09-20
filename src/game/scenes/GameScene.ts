import Phaser from "phaser";
import { Cell, cellKey } from "../../core/types";
import { GameState, PlacementResult } from "../GameState";

const CELL_SIZE = 36;
const GRID_X = 18;
const GRID_Y = 138;

export class GameScene extends Phaser.Scene {
  private readonly gameState = new GameState();
  private board!: Phaser.GameObjects.Graphics;
  private entities!: Phaser.GameObjects.Graphics;
  private goldText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private enemiesText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private waveButton!: Phaser.GameObjects.Container;
  private hoveredCell?: Cell;
  private rejectedCell?: Cell;
  private rejectionRemaining = 0;
  private attackEffects: Array<{ from: Cell; targetX: number; targetY: number; remaining: number }> = [];

  constructor() { super("game"); }

  create(): void {
    this.cameras.main.setBackgroundColor("#10151d");
    this.board = this.add.graphics();
    this.entities = this.add.graphics();
    this.goldText = this.add.text(18, 18, "", { fontFamily: "Arial", fontSize: "22px", color: "#ffd166", fontStyle: "bold" });
    this.livesText = this.add.text(185, 18, "", { fontFamily: "Arial", fontSize: "22px", color: "#ff6b6b", fontStyle: "bold" });
    this.waveText = this.add.text(18, 47, "", { fontFamily: "Arial", fontSize: "18px", color: "#a8dadc", fontStyle: "bold" });
    this.enemiesText = this.add.text(185, 47, "", { fontFamily: "Arial", fontSize: "18px", color: "#f4a261", fontStyle: "bold" });
    this.statusText = this.add.text(18, 76, "Tap et felt for at bygge et Basic Tower (10 gold).", { fontFamily: "Arial", fontSize: "14px", color: "#cbd5e1", wordWrap: { width: 330 } });
    this.createWaveButton();
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => this.onTap(pointer));
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      this.hoveredCell = this.toGridCell(pointer.x, pointer.y);
    });
    this.redraw();
  }

  update(_: number, delta: number): void {
    this.gameState.update(delta / 1000);
    for (const hit of this.gameState.attackEvents.splice(0)) {
      this.attackEffects.push({ from: hit.towerCell, targetX: hit.targetX, targetY: hit.targetY, remaining: 0.08 });
    }
    this.attackEffects = this.attackEffects
      .map((effect) => ({ ...effect, remaining: effect.remaining - delta / 1000 }))
      .filter((effect) => effect.remaining > 0);
    this.rejectionRemaining = Math.max(0, this.rejectionRemaining - delta / 1000);
    if (this.rejectionRemaining === 0) this.rejectedCell = undefined;
    this.redraw();
  }

  private createWaveButton(): void {
    const y = GRID_Y + this.gameState.grid.height * CELL_SIZE + 22;
    const background = this.add.rectangle(180, y, 250, 48, 0x2d6a4f).setStrokeStyle(2, 0x95d5b2);
    const label = this.add.text(180, y, "START WAVE", { fontFamily: "Arial", fontSize: "18px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5);
    this.waveButton = this.add.container(0, 0, [background, label]).setSize(250, 48).setInteractive({ useHandCursor: true });
    this.waveButton.on("pointerdown", () => {
      if (this.gameState.startWave()) this.statusText.setText("Wave i gang - byg igen nar alle enemies er vaek.");
    });
  }

  private onTap(pointer: Phaser.Input.Pointer): void {
    const cell = this.toGridCell(pointer.x, pointer.y);
    if (!cell) return;
    const result = this.gameState.placeBasicTower(cell);
    this.hoveredCell = cell;
    if (result !== "placed") {
      this.rejectedCell = cell;
      this.rejectionRemaining = 0.5;
    }
    this.showPlacementResult(result);
  }

  private toGridCell(screenX: number, screenY: number): Cell | undefined {
    const cell = { x: Math.floor((screenX - GRID_X) / CELL_SIZE), y: Math.floor((screenY - GRID_Y) / CELL_SIZE) };
    return this.gameState.grid.isInside(cell) ? cell : undefined;
  }

  private showPlacementResult(result: PlacementResult): void {
    const messages: Record<PlacementResult, string> = {
      placed: "Tower bygget. Stien er opdateret.",
      "not-enough-gold": "Ikke nok gold.",
      "invalid-cell": "Du kan ikke bygge på dette felt.",
      "blocks-path": "Afvist: enemies skal stadig kunne nå exit.",
      "wave-active": "Vent på at den nuværende wave er færdig.",
    };
    this.statusText.setText(messages[result]);
  }

  private toScreen(cell: Cell): { x: number; y: number } {
    return { x: GRID_X + cell.x * CELL_SIZE + CELL_SIZE / 2, y: GRID_Y + cell.y * CELL_SIZE + CELL_SIZE / 2 };
  }

  private redraw(): void {
    const { grid, spawn, exit, path, towers, enemies } = this.gameState;
    this.board.clear(); this.entities.clear();
    for (let y = 0; y < grid.height; y += 1) for (let x = 0; x < grid.width; x += 1) {
      const cell = { x, y };
      const color = cellKey(cell) === cellKey(spawn) ? 0x3a86ff : cellKey(cell) === cellKey(exit) ? 0xef476f : 0x263241;
      this.board.fillStyle(color).fillRect(GRID_X + x * CELL_SIZE + 1, GRID_Y + y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
    }
    this.board.lineStyle(5, 0x8ecae6, 0.65);
    for (let index = 1; index < path.length; index += 1) {
      const from = this.toScreen(path[index - 1]); const to = this.toScreen(path[index]);
      this.board.lineBetween(from.x, from.y, to.x, to.y);
    }
    this.drawPlacementPreview();
    for (const tower of towers) {
      const p = this.toScreen(tower.cell);
      this.entities.fillStyle(0x6d597a).fillRoundedRect(p.x - 13, p.y - 13, 26, 26, 5);
      this.entities.fillStyle(0xf1fa8c).fillCircle(p.x, p.y, 6);
    }
    for (const enemy of enemies) {
      const { x, y } = this.toScreen(enemy);
      this.entities.fillStyle(0xf4a261).fillCircle(x, y, 10);
      this.entities.fillStyle(0x1b1b1b).fillRect(x - 11, y - 17, 22, 4);
      this.entities.fillStyle(0x70e000).fillRect(x - 11, y - 17, 22 * (enemy.hp / enemy.maxHp), 4);
    }
    this.drawAttackEffects();
    this.goldText.setText(`Gold: ${this.gameState.gold}`);
    this.livesText.setText(`Lives: ${this.gameState.lives}`);
    this.waveText.setText(`Wave: ${this.gameState.currentWave}`);
    this.enemiesText.setText(`Enemies: ${this.gameState.enemiesRemaining}`);
    this.waveButton.setAlpha(this.gameState.waveActive || this.gameState.lives <= 0 ? 0.45 : 1);
  }

  /** A short Phaser-only flash. Damage has already been resolved in GameState. */
  private drawAttackEffects(): void {
    for (const effect of this.attackEffects) {
      const from = this.toScreen(effect.from);
      const to = this.toScreen({ x: effect.targetX, y: effect.targetY });
      this.entities.lineStyle(2, 0xfff3b0, Math.min(1, effect.remaining / 0.08));
      this.entities.lineBetween(from.x, from.y, to.x, to.y);
    }
  }

  /** Phaser-only preview. GameState validates the candidate without mutating it. */
  private drawPlacementPreview(): void {
    if (!this.hoveredCell) return;
    const result = this.gameState.canPlaceBasicTower(this.hoveredCell);
    const isAllowed = result === "placed";
    const isRejected = this.rejectedCell && cellKey(this.rejectedCell) === cellKey(this.hoveredCell) && this.rejectionRemaining > 0;
    const color = isRejected || !isAllowed ? 0xef476f : 0x80ed99;
    const alpha = isRejected ? 0.75 : 0.32;
    this.board.lineStyle(2, color, alpha).strokeRect(
      GRID_X + this.hoveredCell.x * CELL_SIZE + 3,
      GRID_Y + this.hoveredCell.y * CELL_SIZE + 3,
      CELL_SIZE - 6,
      CELL_SIZE - 6,
    );
    if (isAllowed) {
      const p = this.toScreen(this.hoveredCell);
      this.board.fillStyle(0x80ed99, 0.2).fillRoundedRect(p.x - 12, p.y - 12, 24, 24, 4);
    }
  }
}
