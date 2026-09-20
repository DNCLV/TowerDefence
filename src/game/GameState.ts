import { Cell, cellKey, sameCell } from "../core/types";
import { WORLD_UNITS_PER_CELL } from "../core/GameConstants";
import { Enemy, createEnemy } from "./enemies/Enemy";
import { Grid } from "./grid/Grid";
import { findPath } from "./pathfinding/Pathfinder";
import { BASIC_TOWER_COST, Tower, createBasicTower } from "./towers/Tower";

export type PlacementResult = "placed" | "not-enough-gold" | "invalid-cell" | "blocks-path" | "wave-active";
export interface TowerAttackEvent {
  towerCell: Cell;
  targetX: number;
  targetY: number;
}

/** The complete gameplay model. It contains no Phaser imports or rendering concepts. */
export class GameState {
  readonly grid = new Grid(10, 12);
  readonly spawn: Cell = { x: 0, y: 6 };
  readonly exit: Cell = { x: 9, y: 6 };
  path: Cell[];
  gold = 100;
  lives = 10;
  towers: Tower[] = [];
  enemies: Enemy[] = [];
  /** Presentation can consume these after each update; combat does not depend on them. */
  readonly attackEvents: TowerAttackEvent[] = [];
  /** Route frozen at wave start. Building is locked until it has finished. */
  wavePath: Cell[] = [];
  waveActive = false;
  currentWave = 1;
  private nextTowerId = 1;
  private nextEnemyId = 1;
  private toSpawn = 0;
  private spawnTimer = 0;
  private wavesStarted = 0;

  constructor() {
    this.path = findPath(this.grid, this.spawn, this.exit) ?? [];
  }

  /** Checks a proposed build without changing economy, grid, or tower state. */
  canPlaceBasicTower(cell: Cell): PlacementResult {
    if (this.waveActive) return "wave-active";
    if (!this.grid.isInside(cell) || this.grid.isBlocked(cell) || sameCell(cell, this.spawn) || sameCell(cell, this.exit)) return "invalid-cell";
    if (this.gold < BASIC_TOWER_COST) return "not-enough-gold";

    this.grid.setBlocked(cell, true);
    const pathExists = findPath(this.grid, this.spawn, this.exit) !== null;
    this.grid.setBlocked(cell, false);
    return pathExists ? "placed" : "blocks-path";
  }

  placeBasicTower(cell: Cell): PlacementResult {
    const validation = this.canPlaceBasicTower(cell);
    if (validation !== "placed") return validation;
    this.grid.setBlocked(cell, true);
    const newPath = findPath(this.grid, this.spawn, this.exit);
    // The path was validated above. This guard keeps state safe if Grid changes later.
    if (!newPath) { this.grid.setBlocked(cell, false); return "blocks-path"; }
    this.gold -= BASIC_TOWER_COST;
    this.path = newPath;
    this.towers.push(createBasicTower(this.nextTowerId++, cell));
    return "placed";
  }

  startWave(): boolean {
    if (this.waveActive || this.lives <= 0) return false;
    this.currentWave = this.wavesStarted + 1;
    this.wavesStarted += 1;
    this.waveActive = true;
    this.toSpawn = 10;
    this.spawnTimer = 0;
    this.wavePath = this.path.map((cell) => ({ ...cell }));
    return true;
  }

  /** Active enemies plus those still waiting to spawn in this wave. */
  get enemiesRemaining(): number { return this.enemies.length + this.toSpawn; }

  update(deltaSeconds: number): void {
    if (!this.waveActive) return;
    this.attackEvents.length = 0;
    this.spawnTimer -= deltaSeconds;
    if (this.toSpawn > 0 && this.spawnTimer <= 0) {
      this.enemies.push(createEnemy(this.nextEnemyId++, this.wavePath[0]));
      this.toSpawn -= 1;
      this.spawnTimer = 0.65;
    }
    const survivors: Enemy[] = [];
    for (const enemy of this.enemies) {
      this.moveEnemy(enemy, deltaSeconds);
    }
    this.updateTowers(deltaSeconds);
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      if (enemy.hp <= 0) {
        enemy.alive = false;
        continue;
      }
      survivors.push(enemy);
    }
    this.enemies = survivors;
    if (this.toSpawn === 0 && this.enemies.length === 0) this.waveActive = false;
  }

  /** Moves through the immutable wave route using only delta time and grid coordinates. */
  private moveEnemy(enemy: Enemy, deltaSeconds: number): void {
    let distanceLeft = enemy.speed * deltaSeconds;
    while (distanceLeft > 0 && enemy.alive) {
      const nextIndex = enemy.currentPathIndex + 1;
      if (nextIndex >= this.wavePath.length) {
        enemy.alive = false;
        this.lives -= 1;
        return;
      }
      const target = this.wavePath[nextIndex];
      const dx = target.x - enemy.x;
      const dy = target.y - enemy.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= distanceLeft) {
        enemy.x = target.x;
        enemy.y = target.y;
        enemy.currentPathIndex = nextIndex;
        distanceLeft -= distance;
      } else {
        enemy.x += (dx / distance) * distanceLeft;
        enemy.y += (dy / distance) * distanceLeft;
        distanceLeft = 0;
      }
    }
  }

  /** Pure combat logic: all distance, targeting, cooldown and damage calculations live here. */
  private updateTowers(deltaSeconds: number): void {
    for (const tower of this.towers) {
      tower.cooldownRemaining = Math.max(0, tower.cooldownRemaining - deltaSeconds);
      if (tower.cooldownRemaining > 0) continue;
      const target = this.findTowerTarget(tower);
      if (!target) continue;
      target.hp -= tower.damage;
      tower.cooldownRemaining = 1 / tower.fireRate;
      this.attackEvents.push({ towerCell: { ...tower.cell }, targetX: target.x, targetY: target.y });
      if (target.hp <= 0) {
        target.alive = false;
        this.gold += target.reward;
      }
    }
  }

  private findTowerTarget(tower: Tower): Enemy | undefined {
    const inRange = this.enemies.filter((enemy) => enemy.alive && enemy.hp > 0 && this.distanceToTower(tower, enemy) <= tower.range);
    return inRange.sort((a, b) => {
      const progressDifference = this.enemyProgress(b) - this.enemyProgress(a);
      return Math.abs(progressDifference) > 0.001 ? progressDifference : this.distanceToTower(tower, a) - this.distanceToTower(tower, b);
    })[0];
  }

  private distanceToTower(tower: Tower, enemy: Enemy): number {
    return Math.hypot(enemy.x - tower.cell.x, enemy.y - tower.cell.y) * WORLD_UNITS_PER_CELL;
  }

  private enemyProgress(enemy: Enemy): number {
    const current = this.wavePath[enemy.currentPathIndex];
    const next = this.wavePath[enemy.currentPathIndex + 1];
    if (!current || !next) return enemy.currentPathIndex;
    const segmentLength = Math.hypot(next.x - current.x, next.y - current.y);
    const travelled = Math.hypot(enemy.x - current.x, enemy.y - current.y);
    return enemy.currentPathIndex + travelled / segmentLength;
  }

  towerAt(cell: Cell): Tower | undefined { return this.towers.find((tower) => cellKey(tower.cell) === cellKey(cell)); }
}
