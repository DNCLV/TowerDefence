import Phaser from "phaser";
import { Cell, cellKey } from "../../core/types";
import { GameState, PlacementResult } from "../GameState";
import { getTowerLevelStats } from "../towers/Tower";
import { DEFENDER_CONFIG } from "../config/DefenderConfig";
import { WORLD_UNITS_PER_CELL } from "../../core/GameConstants";
import { BALANCE } from "../config/BalanceConfig";
import { THEME } from "../config/ThemeConfig";

const CELL_SIZE = 26;
const GRID_X = 24;
const GRID_Y = 120;

export class GameScene extends Phaser.Scene {
  private readonly gameState = new GameState();
  private board!: Phaser.GameObjects.Graphics;
  private entities!: Phaser.GameObjects.Graphics;
  private overview!: Phaser.GameObjects.Graphics;
  private goldText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private enemiesText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private waveButton!: Phaser.GameObjects.Rectangle;
  private autoRunButton!: Phaser.GameObjects.Rectangle;
  private autoRunLabel!: Phaser.GameObjects.Text;
  private gameOverText!: Phaser.GameObjects.Text;
  private tryAgainButton!: Phaser.GameObjects.Rectangle;
  private tryAgainLabel!: Phaser.GameObjects.Text;
  private upgradeButton!: Phaser.GameObjects.Rectangle;
  private upgradeButtonLabel!: Phaser.GameObjects.Text;
  private towerPanelText!: Phaser.GameObjects.Text;
  private towerPanelBackground!: Phaser.GameObjects.Rectangle;
  private selectedTowerId?: number;
  private hoveredCell?: Cell;
  private rejectedCell?: Cell;
  private rejectionRemaining = 0;
  private attackEffects: Array<{ from: Cell; targetX: number; targetY: number; remaining: number }> = [];
  private dragLast?: { x: number; y: number };
  private isPanning = false;

  constructor() { super("game"); }

  create(): void {
    this.cameras.main.setBackgroundColor("#0d151c");
    this.board = this.add.graphics();
    this.entities = this.add.graphics();
    this.overview = this.add.graphics().setScrollFactor(0);
    this.add.rectangle(180, 43, 352, 86, THEME.hud.panel, 0.96).setStrokeStyle(2, THEME.hud.edge);
    this.goldText = this.add.text(18, 18, "", { fontFamily: "Georgia", fontSize: "22px", color: "#e0b84d", fontStyle: "bold" });
    this.livesText = this.add.text(185, 18, "", { fontFamily: "Georgia", fontSize: "22px", color: "#e68a8a", fontStyle: "bold" });
    this.waveText = this.add.text(18, 47, "", { fontFamily: "Arial", fontSize: "18px", color: "#a8dadc", fontStyle: "bold" });
    this.enemiesText = this.add.text(185, 47, "", { fontFamily: "Arial", fontSize: "18px", color: "#f4a261", fontStyle: "bold" });
    this.statusText = this.add.text(18, 76, "Tap et felt for at bygge et Basic Tower (10 gold).", { fontFamily: "Arial", fontSize: "14px", color: "#cbd5e1", wordWrap: { width: 250 } });
    this.createWaveButton();
    this.createAutoRunButton();
    this.createTowerPanel();
    this.gameOverText = this.add.text(180, 300, "GAME OVER", { fontFamily: "Arial", fontSize: "30px", color: "#ff6b6b", fontStyle: "bold", stroke: "#10151d", strokeThickness: 5 }).setOrigin(0.5).setVisible(false);
    this.tryAgainButton = this.add.rectangle(180, 540, 160, 42, 0x457b9d).setStrokeStyle(2, 0xa8dadc).setInteractive({ useHandCursor: true }).setVisible(false);
    this.tryAgainLabel = this.add.text(180, 540, "TRY AGAIN", { fontFamily: "Arial", fontSize: "17px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5).setVisible(false);
    this.tryAgainButton.on("pointerdown", () => this.tryAgain());
    this.cameras.main.setBounds(0, 0, GRID_X * 2 + this.gameState.grid.width * CELL_SIZE, GRID_Y * 2 + this.gameState.grid.height * CELL_SIZE);
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => { this.dragLast = { x: pointer.x, y: pointer.y }; this.isPanning = false; });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => { if (!this.isPanning) this.onTap(pointer); this.dragLast = undefined; });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown && this.dragLast) {
        const dx = pointer.x - this.dragLast.x; const dy = pointer.y - this.dragLast.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) { this.isPanning = true; this.cameras.main.scrollX -= dx; this.cameras.main.scrollY -= dy; }
        this.dragLast = { x: pointer.x, y: pointer.y };
      }
      this.hoveredCell = this.toGridCell(pointer.worldX, pointer.worldY);
    });
    for (const child of this.children.list) {
      if (child !== this.board && child !== this.entities && child !== this.overview && "setScrollFactor" in child) {
        (child as Phaser.GameObjects.GameObject & { setScrollFactor: (x: number, y?: number) => unknown }).setScrollFactor(0);
      }
    }
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
    const y = 610;
    this.waveButton = this.add.rectangle(180, y, 250, 48, THEME.hud.metal)
      .setStrokeStyle(2, THEME.hud.edge)
      .setInteractive({ useHandCursor: true });
    this.add.text(180, y, "START WAVE", { fontFamily: "Arial", fontSize: "18px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5);
    this.waveButton.on("pointerdown", () => {
      if (this.gameState.startWave()) this.statusText.setText("Wave i gang - byg igen nar alle enemies er vaek.");
    });
  }

  private createAutoRunButton(): void {
    this.autoRunButton = this.add.rectangle(303, 88, 105, 26, THEME.hud.metal).setStrokeStyle(1, THEME.hud.edge).setInteractive({ useHandCursor: true });
    this.autoRunLabel = this.add.text(303, 88, "", { fontFamily: "Arial", fontSize: "11px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5);
    this.autoRunButton.on("pointerdown", () => {
      this.gameState.toggleAutoRun();
      this.statusText.setText(this.gameState.autoRun ? "Auto Run enabled." : "Auto Run disabled.");
    });
  }

  private createTowerPanel(): void {
    this.towerPanelBackground = this.add.rectangle(180, 530, 320, 98, 0x18232f, 0.95).setStrokeStyle(1, 0x52667a);
    this.towerPanelText = this.add.text(32, 490, "", { fontFamily: "Arial", fontSize: "14px", color: "#e2e8f0", lineSpacing: 3 });
    this.upgradeButton = this.add.rectangle(267, 545, 110, 34, 0x457b9d).setStrokeStyle(1, 0xa8dadc).setInteractive({ useHandCursor: true });
    this.upgradeButtonLabel = this.add.text(267, 545, "UPGRADE", { fontFamily: "Arial", fontSize: "14px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5);
    this.upgradeButton.on("pointerdown", () => this.onUpgrade());
    this.setTowerPanelVisible(false);
  }

  private onTap(pointer: Phaser.Input.Pointer): void {
    const cell = this.toGridCell(pointer.worldX, pointer.worldY);
    if (!cell) return;
    const tower = this.gameState.towerAt(cell);
    if (tower && !this.gameState.gameOver) {
      this.selectedTowerId = tower.id;
      this.statusText.setText("Basic Tower selected.");
      return;
    }
    this.selectedTowerId = undefined;
    const result = this.gameState.placeBasicTower(cell);
    this.hoveredCell = cell;
    if (result !== "placed") {
      this.rejectedCell = cell;
      this.rejectionRemaining = 0.5;
    }
    this.showPlacementResult(result);
  }

  private onUpgrade(): void {
    if (this.selectedTowerId === undefined) return;
    const result = this.gameState.upgradeBasicTower(this.selectedTowerId);
    const messages = {
      upgraded: "Tower upgraded.",
      "not-enough-gold": "Not enough gold to upgrade.",
      "max-level": "Tower is already max level.",
      "game-over": "Game over.",
      "tower-not-found": "Tower is no longer available.",
    } as const;
    this.statusText.setText(messages[result]);
  }

  /** Clears Phaser-only transient state, then delegates all gameplay reset to GameState. */
  private tryAgain(): void {
    this.gameState.resetGame("try-again");
    this.selectedTowerId = undefined;
    this.hoveredCell = undefined;
    this.rejectedCell = undefined;
    this.rejectionRemaining = 0;
    this.attackEffects = [];
    this.statusText.setText("New run. Build towers or start a wave.");
    this.redraw();
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
      "enemy-occupied": "Kan ikke bygge oven pa en enemy.",
      "blocks-path": "Afvist: enemies skal stadig kunne nå exit.",
      "game-over": "Game over.",
    };
    this.statusText.setText(messages[result]);
  }

  private toScreen(cell: Cell): { x: number; y: number } {
    return { x: GRID_X + cell.x * CELL_SIZE + CELL_SIZE / 2, y: GRID_Y + cell.y * CELL_SIZE + CELL_SIZE / 2 };
  }

  private redraw(): void {
    const { grid, layout, spawnPaths, towers, enemies } = this.gameState;
    this.board.clear(); this.entities.clear();
    for (let y = 0; y < grid.height; y += 1) for (let x = 0; x < grid.width; x += 1) {
      const cell = { x, y };
      const isSpawn = layout.activeSpawns.some((spawn) => cellKey(spawn.cell) === cellKey(cell));
      const tileX = GRID_X + x * CELL_SIZE; const tileY = GRID_Y + y * CELL_SIZE;
      const color = grid.isTerrain(cell) ? THEME.snow.cliff : (x + y) % 2 === 0 ? THEME.snow.base : THEME.snow.alternate;
      this.board.fillStyle(color).fillRect(tileX, tileY, CELL_SIZE, CELL_SIZE);
      this.board.lineStyle(1, THEME.snow.grid, 0.26).strokeRect(tileX, tileY, CELL_SIZE, CELL_SIZE);
      if (grid.isTerrain(cell)) {
        this.board.fillStyle(0x1e2e39, 0.35).fillRect(tileX + 2, tileY + 8, CELL_SIZE - 4, CELL_SIZE - 3);
        this.board.fillStyle(THEME.snow.ice, 0.45).fillTriangle(tileX + 2, tileY + 10, tileX + CELL_SIZE - 2, tileY + 10, tileX + CELL_SIZE / 2, tileY + 2);
      }
    }
    this.board.lineStyle(4, THEME.path, 0.72);
    for (const route of spawnPaths.values()) for (let index = 1; index < route.length; index += 1) {
      const from = this.toScreen(route[index - 1]); const to = this.toScreen(route[index]);
      this.board.lineBetween(from.x, from.y, to.x, to.y);
    }
    this.drawFactionStructures(layout.activeSpawns[0].cell, layout.castle.cell);
    this.drawPlacementPreview();
    this.drawSelectedTowerRange();
    for (const tower of towers) {
      const p = this.toScreen(tower.cell);
      this.entities.fillStyle(0x162027, 0.4).fillEllipse(p.x + 4, p.y + 11, 25, 9);
      this.entities.fillStyle(THEME.tower.stone).fillRoundedRect(p.x - 12, p.y - 10, 24, 22, 3);
      this.entities.fillStyle(BALANCE.towerLevelVisuals[tower.level as 1 | 2 | 3].color).fillTriangle(p.x - 14, p.y - 9, p.x + 14, p.y - 9, p.x, p.y - 18);
      this.entities.fillStyle(THEME.tower.window).fillRect(p.x - 3, p.y, 6, 7);
    }
    for (const enemy of enemies) {
      const { x, y } = this.toScreen(enemy);
      const next = enemy.path[enemy.currentPathIndex + 1];
      const angle = next ? Math.atan2(next.y - enemy.y, next.x - enemy.x) : 0;
      const weaponX = x + Math.cos(angle) * 10; const weaponY = y + Math.sin(angle) * 10;
      this.entities.fillStyle(THEME.goblin.shadow, 0.45).fillEllipse(x, y + 8, 19, 8);
      this.entities.fillStyle(THEME.goblin.outline).fillCircle(x, y, 9);
      this.entities.fillStyle(THEME.goblin.leather).fillEllipse(x, y + 2, 13, 15);
      this.entities.fillStyle(THEME.goblin.skin).fillCircle(x - Math.cos(angle) * 2, y - Math.sin(angle) * 3, 6);
      this.entities.fillStyle(THEME.goblin.skinLight).fillCircle(x - Math.cos(angle) * 4, y - Math.sin(angle) * 5, 3);
      this.entities.fillStyle(THEME.goblin.eye).fillCircle(x + Math.cos(angle) * 2, y + Math.sin(angle) * 1, 1.5);
      this.entities.lineStyle(2, THEME.goblin.metal, 1).lineBetween(x + Math.cos(angle) * 5, y + Math.sin(angle) * 5, weaponX, weaponY);
      this.entities.fillStyle(THEME.goblin.metal).fillCircle(weaponX, weaponY, 3);
      this.entities.fillStyle(0x1b1b1b).fillRect(x - 11, y - 17, 22, 4);
      this.entities.fillStyle(0x70e000).fillRect(x - 11, y - 17, 22 * (enemy.hp / enemy.maxHp), 4);
    }
    this.drawAttackEffects();
    this.goldText.setText(`Gold: ${this.gameState.gold}`);
    this.livesText.setText(`Lives: ${this.gameState.lives}`);
    this.waveText.setText(`Wave: ${this.gameState.currentWave}`);
    this.enemiesText.setText(`Enemies: ${this.gameState.enemiesRemaining}`);
    this.waveButton.setAlpha(this.gameState.waveActive || this.gameState.lives <= 0 ? 0.45 : 1);
    this.autoRunLabel.setText(`AUTO: ${this.gameState.autoRun ? "ON" : "OFF"}`);
    this.gameOverText.setVisible(this.gameState.gameOver);
    this.tryAgainButton.setVisible(this.gameState.gameOver);
    this.tryAgainLabel.setVisible(this.gameState.gameOver);
    if (this.gameState.gameOver) this.statusText.setText("Game over. No more waves can start.");
    this.updateTowerPanel();
    this.drawOverview();
  }

  private drawOverview(): void {
    const width = 88; const height = 58; const x = 258; const y = 112;
    const camera = this.cameras.main;
    const worldWidth = this.gameState.grid.width * CELL_SIZE;
    const worldHeight = this.gameState.grid.height * CELL_SIZE;
    this.overview.clear().fillStyle(0x14202b, 0.9).fillRect(x, y, width, height).lineStyle(1, 0xa8dadc, 0.8).strokeRect(x, y, width, height);
    const scaleX = width / worldWidth; const scaleY = height / worldHeight;
    const spawn = this.gameState.layout.activeSpawns[0].cell; const castle = this.gameState.layout.castle.cell;
    this.overview.fillStyle(0xff5a5f).fillCircle(x + spawn.x * CELL_SIZE * scaleX, y + spawn.y * CELL_SIZE * scaleY, 3);
    this.overview.fillStyle(0x4cc9f0).fillCircle(x + castle.x * CELL_SIZE * scaleX, y + castle.y * CELL_SIZE * scaleY, 3);
    for (const tower of this.gameState.towers) {
      const color = tower.level === 3 ? 0xe0b84d : tower.level === 2 ? 0x4cc9f0 : 0xa8c4d1;
      this.overview.fillStyle(color).fillRect(x + tower.cell.x * CELL_SIZE * scaleX - 1, y + tower.cell.y * CELL_SIZE * scaleY - 1, 3, 3);
    }
    this.overview.fillStyle(0xff5a5f);
    for (const enemy of this.gameState.enemies) this.overview.fillCircle(x + enemy.x * CELL_SIZE * scaleX, y + enemy.y * CELL_SIZE * scaleY, 1.5);
    this.overview.lineStyle(1, 0xffffff, 0.8).strokeRect(x + camera.scrollX * scaleX, y + camera.scrollY * scaleY, camera.width * scaleX, camera.height * scaleY);
  }

  private drawFactionStructures(spawn: Cell, castle: Cell): void {
    const portal = this.toScreen(spawn);
    this.board.fillStyle(0x111820, 0.45).fillEllipse(portal.x + 6, portal.y + 12, 35, 13);
    this.board.fillStyle(THEME.spawn.glow, 0.3).fillCircle(portal.x, portal.y, 22);
    this.board.fillStyle(THEME.spawn.dark).fillCircle(portal.x, portal.y, 13);
    this.board.lineStyle(3, THEME.spawn.core, 0.9).strokeCircle(portal.x, portal.y, 11);
    this.board.fillStyle(THEME.spawn.core, 0.85).fillCircle(portal.x, portal.y, 5);
    const keep = this.toScreen(castle);
    this.board.fillStyle(0x111820, 0.45).fillEllipse(keep.x + 7, keep.y + 14, 42, 15);
    this.board.fillStyle(THEME.castle.dark).fillRect(keep.x - 14, keep.y - 11, 28, 23);
    this.board.fillStyle(THEME.castle.stone).fillRect(keep.x - 10, keep.y - 16, 20, 28);
    this.board.fillStyle(THEME.castle.banner).fillTriangle(keep.x - 10, keep.y - 16, keep.x, keep.y - 24, keep.x + 10, keep.y - 16);
    this.board.fillStyle(0xffffff, 0.75).fillRect(keep.x - 3, keep.y + 2, 6, 8);
  }

  private drawSelectedTowerRange(): void {
    const tower = this.gameState.towers.find((candidate) => candidate.id === this.selectedTowerId);
    if (!tower || this.gameState.gameOver) return;
    const p = this.toScreen(tower.cell);
    if (tower.rangeMode === "adjacent8") {
      this.board.fillStyle(0xe8bd62, 0.18);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx !== 0 || dy !== 0) {
            const cell = this.toScreen({ x: tower.cell.x + dx, y: tower.cell.y + dy });
            this.board.fillRect(cell.x - CELL_SIZE / 2 + 1, cell.y - CELL_SIZE / 2 + 1, CELL_SIZE - 2, CELL_SIZE - 2);
          }
        }
      }
      this.board.lineStyle(2, 0xffffff, 0.8).strokeRect(p.x - 14, p.y - 14, 28, 28);
      return;
    }
    this.board.lineStyle(1, 0xa8dadc, 0.55).fillStyle(0x457b9d, 0.12)
      .fillCircle(p.x, p.y, (tower.range / WORLD_UNITS_PER_CELL) * CELL_SIZE)
      .strokeCircle(p.x, p.y, (tower.range / WORLD_UNITS_PER_CELL) * CELL_SIZE);
    this.board.lineStyle(2, 0xffffff, 0.8).strokeRect(p.x - 14, p.y - 14, 28, 28);
  }

  private updateTowerPanel(): void {
    const tower = this.gameState.towers.find((candidate) => candidate.id === this.selectedTowerId);
    if (!tower || this.gameState.gameOver) {
      this.setTowerPanelVisible(false);
      return;
    }
    const next = getTowerLevelStats(tower.level + 1, tower.type);
    const upgrade = next.level === tower.level + 1 && next.upgradeCost !== null ? `${next.upgradeCost} gold` : "MAX LEVEL";
    const range = tower.rangeMode === "adjacent8" ? "1 Tile" : `${(tower.range / WORLD_UNITS_PER_CELL).toFixed(1)} Tiles`;
    this.towerPanelText.setText(`${DEFENDER_CONFIG[tower.type].name}  |  Level ${tower.level}\nDamage: ${tower.damage}   Range: ${range}\nFire rate: ${tower.fireRate.toFixed(2)}/s   Upgrade: ${upgrade}\nKills: ${tower.combatStats.kills}   Damage Done: ${tower.combatStats.damageDone.toLocaleString("en-US")}`);
    this.upgradeButtonLabel.setText(upgrade === "MAX LEVEL" ? "MAX LEVEL" : "UPGRADE");
    this.setTowerPanelVisible(true, upgrade !== "MAX LEVEL" && this.gameState.gold >= (next.upgradeCost ?? 0));
  }

  private setTowerPanelVisible(visible: boolean, upgradeEnabled = false): void {
    this.towerPanelBackground.setVisible(visible);
    this.towerPanelText.setVisible(visible);
    this.upgradeButton.setVisible(visible).setAlpha(upgradeEnabled ? 1 : 0.45);
    this.upgradeButtonLabel.setVisible(visible);
    this.upgradeButton.disableInteractive();
    if (visible && upgradeEnabled) this.upgradeButton.setInteractive({ useHandCursor: true });
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
    this.board.lineStyle(2, color, alpha).strokeRect(GRID_X + this.hoveredCell.x * CELL_SIZE + 3, GRID_Y + this.hoveredCell.y * CELL_SIZE + 3, CELL_SIZE - 6, CELL_SIZE - 6);
    if (isAllowed) {
      this.board.fillStyle(0x80ed99, 0.2).fillRect(GRID_X + this.hoveredCell.x * CELL_SIZE + 3, GRID_Y + this.hoveredCell.y * CELL_SIZE + 3, CELL_SIZE - 6, CELL_SIZE - 6);
    }
  }
}
