import { Cell, cellKey, sameCell } from "../core/types";
import { WORLD_UNITS_PER_CELL } from "../core/GameConstants";
import { Enemy, createEnemy, getEnemyHpForWave, getEnemyHpMultiplier, getEnemyHpTier } from "./enemies/Enemy";
import { Grid } from "./grid/Grid";
import { findPath } from "./pathfinding/Pathfinder";
import { Tower, TowerAttackMode, canTowerTargetEnemy, createBasicTower, getTowerAttackProfile, getTowerLevelStats, getTowerSellRefund, getTowerSplashRatio, isTowerInRange, upgradeTower } from "./towers/Tower";
import { DEFENDER_CONFIG, DefenderType } from "./config/DefenderConfig";
import { LEVEL_1 } from "./config/Level1";
import { BALANCE } from "./config/BalanceConfig";
import { CLASSIC_WINTERMAUL } from "./config/ClassicWintermaul";
import { generateRunLayout } from "./map/LayoutGenerator";
import { RunLayout } from "./map/RunLayout";
import { ENEMY_CONFIG, EnemyType } from "./config/EnemyConfig";
import { ENEMY_THREAT_WEIGHT, MAX_ACTIVE_WAVE_ENEMIES, countWaveComposition, createWaveSpawnQueue, getWaveComposition, getWaveGoldReward } from "./config/WaveConfig";

export type PlacementResult = "placed" | "not-enough-gold" | "invalid-cell" | "enemy-occupied" | "blocks-path" | "game-over";
export type UpgradeResult = "upgraded" | "not-enough-gold" | "max-level" | "game-over" | "tower-not-found";
export type SellResult = { refund: number } | "game-over" | "tower-not-found";
export type ResetReason = "try-again";
export interface HPTierWarning {
  completedWave: number;
  nextWave: number;
  nextMultiplier: number;
}
export interface TowerAttackEvent {
  towerId: number;
  defenderType: DefenderType;
  towerCell: Cell;
  targetEnemyId: number;
  targetX: number;
  targetY: number;
  damageDealt: number;
  enemyDied: boolean;
  attackMode: TowerAttackMode;
  isSplash: boolean;
}
export interface WaveTelemetry {
  wave: number;
  enemies: number;
  composition: Record<EnemyType, number>;
  goldEarned: number;
  goldAvailable: number;
  lives: number;
  enemiesKilled: number;
  enemiesLeaked: number;
  towerLevels: { l1: number; l2: number; l3: number };
}

/** The complete gameplay model. It contains no Phaser imports or rendering concepts. */
export class GameState {
  readonly grid = new Grid(CLASSIC_WINTERMAUL.width, CLASSIC_WINTERMAUL.height);
  layout!: RunLayout;
  readonly spawnPaths = new Map<string, Cell[]>();
  get spawn(): Cell { return this.layout.activeSpawns[0].entryCell; }
  get exit(): Cell { return this.layout.castle.approachCell; }
  path: Cell[];
  gold = 0;
  lives = BALANCE.startingLives;
  towers: Tower[] = [];
  enemies: Enemy[] = [];
  /** Presentation can consume these after each update; combat does not depend on them. */
  readonly attackEvents: TowerAttackEvent[] = [];
  /** Default route for new spawns; refreshed when a tower changes topology. */
  wavePath: Cell[] = [];
  waveActive = false;
  currentWave = 1;
  autoRun = false;
  hpTierWarning?: HPTierWarning;
  gameOver = false;
  private nextTowerId = 1;
  private nextEnemyId = 1;
  private toSpawn = 0;
  private spawnTimer = 0;
  private spawnQueue: EnemyType[] = [];
  private spawnQueueCursor = 0;
  private wavesStarted = 0;
  private waveEnemyCount = 0;
  private waveEnemyComposition: Record<EnemyType, number> = { goblin: 0, goblinBrute: 0, goblinRider: 0, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 0, skeletonKing: 0, skeletalCommander: 0 };
  private waveSpawnInterval = 0.65;
  private waveGoldAtStart = 0;
  private enemiesKilled = 0;
  private enemiesLeaked = 0;
  private resetCount = 0;
  private hpTierWarningSecondsRemaining = 0;

  constructor() {
    CLASSIC_WINTERMAUL.terrain.forEach((cell) => this.grid.setTerrain(cell, true));
    this.layout = generateRunLayout(this.grid);
    this.path = [];
    this.refreshSpawnPaths();
    this.gold = this.startingGoldForLayout();
    this.logLayout();
  }

  /** Checks a proposed build without changing economy, grid, or tower state. */
  canPlaceBasicTower(cell: Cell, type: DefenderType = "blue-wizard"): PlacementResult {
    if (this.gameOver) return "game-over";
    if (!this.grid.isBuildable(cell) || this.layout.activeSpawns.some((spawn) => sameCell(cell, spawn.entryCell)) || sameCell(cell, this.exit)) return "invalid-cell";
    if (this.enemies.some((enemy) => enemy.alive && sameCell(this.enemyCurrentCell(enemy), cell))) return "enemy-occupied";
    if (this.gold < DEFENDER_CONFIG[type].buildCost) return "not-enough-gold";

    this.grid.setBlocked(cell, true);
    const pathExists = this.layout.activeSpawns.every((spawn) => findPath(this.grid, spawn.entryCell, this.exit) !== null)
      && this.enemies.every((enemy) => !enemy.alive || enemy.movementType === "flying" || findPath(this.grid, this.enemyCurrentCell(enemy), this.exit) !== null);
    this.grid.setBlocked(cell, false);
    return pathExists ? "placed" : "blocks-path";
  }

  upgradeBasicTower(towerId: number): UpgradeResult {
    if (this.gameOver) return "game-over";
    const tower = this.towers.find((candidate) => candidate.id === towerId);
    if (!tower) return "tower-not-found";
    const next = getTowerLevelStats(tower.level + 1, tower.type);
    if (next.level === tower.level) return "max-level";
    if (next.level !== tower.level + 1 || next.upgradeCost === null) return "max-level";
    if (this.gold < next.upgradeCost) return "not-enough-gold";
    this.gold -= next.upgradeCost;
    upgradeTower(tower);
    return "upgraded";
  }

  sellTower(towerId: number): SellResult {
    if (this.gameOver) return "game-over";
    const index = this.towers.findIndex((candidate) => candidate.id === towerId);
    if (index < 0) return "tower-not-found";
    const [tower] = this.towers.splice(index, 1);
    const refund = getTowerSellRefund(tower);
    this.gold += refund;
    this.grid.setBlocked(tower.cell, false);
    this.refreshSpawnPaths();
    if (this.waveActive) {
      this.wavePath = this.path.map((cell) => ({ ...cell }));
      this.repathActiveEnemies();
    }
    return { refund };
  }

  placeBasicTower(cell: Cell, type: DefenderType = "blue-wizard"): PlacementResult {
    const validation = this.canPlaceBasicTower(cell, type);
    if (validation !== "placed") return validation;
    this.grid.setBlocked(cell, true);
    const newPath = findPath(this.grid, this.spawn, this.exit);
    // The path was validated above. This guard keeps state safe if Grid changes later.
    if (!newPath) { this.grid.setBlocked(cell, false); return "blocks-path"; }
    this.gold -= DEFENDER_CONFIG[type].buildCost;
    this.path = newPath;
    this.refreshSpawnPaths();
    if (this.waveActive) {
      this.wavePath = this.path.map((pathCell) => ({ ...pathCell }));
      this.repathActiveEnemies();
    }
    this.towers.push(createBasicTower(this.nextTowerId++, cell, type));
    return "placed";
  }

  startWave(): boolean {
    if (this.waveActive || this.lives <= 0 || this.gameOver || this.path.length === 0 || this.hpTierWarning) return false;
    this.currentWave = this.wavesStarted + 1;
    this.wavesStarted += 1;
    this.waveActive = true;
    const composition = getWaveComposition(this.currentWave);
    this.spawnQueue = createWaveSpawnQueue(composition);
    this.spawnQueueCursor = 0;
    this.toSpawn = this.spawnQueue.length;
    this.spawnTimer = 0;
    this.waveSpawnInterval = composition.spawnInterval ?? 0.65;
    this.refreshSpawnPaths();
    this.wavePath = this.path.map((cell) => ({ ...cell }));
    this.waveEnemyComposition = countWaveComposition(composition);
    this.waveEnemyCount = this.toSpawn;
    const threatBreakdown = Object.fromEntries(Object.entries(this.waveEnemyComposition).map(([type, count]) => [
      type,
      { count, threat: count * ENEMY_THREAT_WEIGHT[type as EnemyType] },
    ]));
    const hpByType = Object.fromEntries(Object.keys(ENEMY_CONFIG).map((type) => [
      type,
      getEnemyHpForWave(type as EnemyType, this.currentWave),
    ]));
    const totalWaveHp = Object.entries(this.waveEnemyComposition).reduce((total, [type, count]) => (
      total + count * hpByType[type as EnemyType]
    ), 0);
    console.info("Wave composition", {
      wave: this.currentWave,
      hpTier: getEnemyHpTier(this.currentWave),
      hpMultiplier: getEnemyHpMultiplier(this.currentWave),
      enemyHp: hpByType,
      totalWaveHp,
      ...this.waveEnemyComposition,
      total: this.toSpawn,
      threatBudget: composition.threatBudget ?? null,
      threatBreakdown,
      totalThreat: composition.totalThreat,
      spawnInterval: Number(this.waveSpawnInterval.toFixed(3)),
      rewardMultiplier: composition.rewardMultiplier,
      activeEnemyCap: MAX_ACTIVE_WAVE_ENEMIES,
      enemyTypes: ENEMY_CONFIG,
    });
    this.waveGoldAtStart = this.gold;
    this.enemiesKilled = 0;
    this.enemiesLeaked = 0;
    return true;
  }

  toggleAutoRun(): void {
    if (this.gameOver) return;
    this.autoRun = !this.autoRun;
  }

  /** Resets only portable gameplay state; Phaser visuals are reset by the scene. */
  resetGame(reason: ResetReason): void {
    console.info("RESET GAME", {
      reason,
      wave: this.currentWave,
      lives: this.lives,
      gold: this.gold,
      resetCount: this.resetCount + 1,
    });
    this.resetCount += 1;
    this.grid.clearTowerBlocks();
    this.layout = generateRunLayout(this.grid);
    this.path = [];
    this.spawnPaths.clear();
    this.refreshSpawnPaths();
    this.gold = this.startingGoldForLayout();
    this.lives = BALANCE.startingLives;
    this.towers = [];
    this.enemies = [];
    this.attackEvents.length = 0;
    this.wavePath = [];
    this.waveActive = false;
    this.currentWave = 1;
    this.autoRun = false;
    this.hpTierWarning = undefined;
    this.hpTierWarningSecondsRemaining = 0;
    this.gameOver = false;
    this.nextTowerId = 1;
    this.nextEnemyId = 1;
    this.toSpawn = 0;
    this.spawnTimer = 0;
    this.spawnQueue = [];
    this.spawnQueueCursor = 0;
    this.wavesStarted = 0;
    this.waveEnemyCount = 0;
    this.waveEnemyComposition = { goblin: 0, goblinBrute: 0, goblinRider: 0, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 0, skeletonKing: 0, skeletalCommander: 0 };
    this.waveSpawnInterval = 0.65;
    this.waveGoldAtStart = 0;
    this.enemiesKilled = 0;
    this.enemiesLeaked = 0;
    this.logLayout();
  }

  /** Active enemies plus those still waiting to spawn in this wave. */
  get enemiesRemaining(): number { return this.enemies.length + this.toSpawn; }

  update(deltaSeconds: number, realDeltaSeconds = deltaSeconds): void {
    if (this.gameOver) return;
    if (this.hpTierWarning) {
      this.hpTierWarningSecondsRemaining = Math.max(0, this.hpTierWarningSecondsRemaining - realDeltaSeconds);
      if (this.hpTierWarningSecondsRemaining === 0) {
        this.hpTierWarning = undefined;
        if (this.autoRun && !this.gameOver) this.startWave();
      }
    }
    if (!this.waveActive) {
      return;
    }
    this.attackEvents.length = 0;
    this.spawnTimer -= deltaSeconds;
    if (this.toSpawn > 0 && this.spawnTimer <= 0 && this.enemies.length < MAX_ACTIVE_WAVE_ENEMIES) {
      for (const spawn of this.layout.activeSpawns) {
        if (this.toSpawn <= 0 || this.enemies.length >= MAX_ACTIVE_WAVE_ENEMIES) break;
        const type = this.spawnQueue[this.spawnQueueCursor];
        if (!type) break;
        const isFlying = ENEMY_CONFIG[type].movementType === "flying";
        const groundRoute = this.spawnPaths.get(spawn.id);
        if (!isFlying && !groundRoute) continue;
        this.spawnQueueCursor += 1;
        const route = isFlying
          ? [{ ...spawn.entryCell }, { ...this.exit }]
          : groundRoute!;
        const enemy = createEnemy(this.nextEnemyId++, type, route, this.currentWave);
        this.enemies.push(enemy);
        this.toSpawn -= 1;
      }
      this.spawnTimer = this.waveSpawnInterval;
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
    if (this.lives <= 0) {
      console.info("GAME OVER - waiting for TRY AGAIN", {
        wave: this.currentWave,
        lives: 0,
        gold: this.gold,
      });
      this.gameOver = true;
      this.autoRun = false;
      this.waveActive = false;
      this.toSpawn = 0;
      this.enemies = [];
    } else if (this.toSpawn === 0 && this.enemies.length === 0) {
      this.completeWave();
    }
  }

  /** Moves through the immutable wave route using only delta time and grid coordinates. */
  private moveEnemy(enemy: Enemy, deltaSeconds: number): void {
    let distanceLeft = enemy.speed * deltaSeconds;
    while (distanceLeft > 0 && enemy.alive) {
      const nextIndex = enemy.currentPathIndex + 1;
      if (nextIndex >= enemy.path.length) {
        enemy.alive = false;
        this.lives -= enemy.livesDamage;
        this.enemiesLeaked += 1;
        return;
      }
      const target = enemy.path[nextIndex];
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
      const profile = getTowerAttackProfile(tower, target);
      const primaryDamage = profile.damage;
      tower.cooldownRemaining = 1 / profile.fireRate;
      this.applyTowerDamage(tower, target, primaryDamage, profile.mode, false);

      const splashRatio = getTowerSplashRatio(tower);
      if (splashRatio <= 0) continue;
      const splashDamage = Math.round(primaryDamage * splashRatio);
      if (splashDamage <= 0) continue;
      const targetCellX = Math.round(target.x);
      const targetCellY = Math.round(target.y);
      // Snapshot the candidates so each secondary is damaged once and never re-targeted recursively.
      const secondaryTargets = this.enemies.filter((enemy) => enemy !== target && enemy.alive && enemy.hp > 0
        && Math.max(Math.abs(Math.round(enemy.x) - targetCellX), Math.abs(Math.round(enemy.y) - targetCellY)) === 1);
      for (const secondary of secondaryTargets) {
        this.applyTowerDamage(tower, secondary, splashDamage, "ranged", true);
      }
    }
  }

  private applyTowerDamage(tower: Tower, enemy: Enemy, damage: number, attackMode: TowerAttackMode, isSplash: boolean): void {
    const hpBefore = enemy.hp;
    enemy.hp = Math.max(0, hpBefore - damage);
    const effectiveDamage = hpBefore - enemy.hp;
    tower.combatStats.damageDone += effectiveDamage;
    const enemyDied = hpBefore > 0 && enemy.hp <= 0;
    this.attackEvents.push({
      towerId: tower.id, defenderType: tower.type, towerCell: { ...tower.cell },
      targetEnemyId: enemy.id, targetX: enemy.x, targetY: enemy.y,
      damageDealt: effectiveDamage, enemyDied, attackMode, isSplash,
    });
    if (!enemyDied) return;
    tower.combatStats.kills += 1;
    enemy.alive = false;
    this.gold += getWaveGoldReward(enemy.reward, this.currentWave);
    this.enemiesKilled += 1;
  }

  private findTowerTarget(tower: Tower): Enemy | undefined {
    const inRange = this.enemies.filter((enemy) => enemy.alive && enemy.hp > 0
      && canTowerTargetEnemy(tower, enemy) && isTowerInRange(tower, enemy));
    return inRange.sort((a, b) => {
      const remainingDifference = this.remainingDistanceToExit(a) - this.remainingDistanceToExit(b);
      // Different spawns have different route lengths, so raw path-index is not comparable.
      if (Math.abs(remainingDifference) > 0.05) return remainingDifference;
      const hpDifference = a.hp - b.hp;
      return hpDifference !== 0 ? hpDifference : this.distanceToTower(tower, a) - this.distanceToTower(tower, b);
    })[0];
  }

  private distanceToTower(tower: Tower, enemy: Enemy): number {
    return Math.hypot(enemy.x - tower.cell.x, enemy.y - tower.cell.y) * WORLD_UNITS_PER_CELL;
  }

  /** Remaining route distance in grid units, calculated from the enemy's current live path. */
  private remainingDistanceToExit(enemy: Enemy): number {
    const current = enemy.path[enemy.currentPathIndex];
    const next = enemy.path[enemy.currentPathIndex + 1];
    if (!current) return Number.POSITIVE_INFINITY;
    if (!next) return Math.hypot(enemy.x - current.x, enemy.y - current.y);
    let remaining = Math.hypot(next.x - enemy.x, next.y - enemy.y);
    for (let index = enemy.currentPathIndex + 1; index < enemy.path.length - 1; index += 1) {
      const from = enemy.path[index];
      const to = enemy.path[index + 1];
      remaining += Math.hypot(to.x - from.x, to.y - from.y);
    }
    return remaining;
  }

  private enemyCurrentCell(enemy: Enemy): Cell {
    return { x: Math.round(enemy.x), y: Math.round(enemy.y) };
  }

  /** Keeps enemy world coordinates intact while replacing only their remaining route. */
  private repathActiveEnemies(): void {
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.movementType === "flying") continue;
      const start = this.enemyCurrentCell(enemy);
      const route = findPath(this.grid, start, this.exit);
      if (!route) {
        console.warn("Could not repath active enemy", enemy.id, start);
        continue;
      }
      enemy.path = route;
      enemy.currentPathIndex = 0;
    }
  }

  private refreshSpawnPaths(): void {
    this.spawnPaths.clear();
    for (const spawn of this.layout.activeSpawns) {
      const route = findPath(this.grid, spawn.entryCell, this.exit);
      if (route) this.spawnPaths.set(spawn.id, route);
    }
    this.path = this.spawnPaths.get(this.layout.activeSpawns[0].id) ?? [];
  }

  private logLayout(): void {
    console.log("Run layout", { castle: this.layout.castle.id, activeSpawnCount: this.layout.activeSpawns.length, startingGold: this.gold, activeSpawns: this.layout.activeSpawns.map((spawn) => spawn.id) });
  }

  private startingGoldForLayout(): number {
    return BALANCE.startingGoldBySpawnCount[this.layout.activeSpawns.length as 1 | 2 | 3 | 4 | 5] ?? 70;
  }

  private completeWave(): void {
    this.waveActive = false;
    const telemetry: WaveTelemetry = {
      wave: this.currentWave, enemies: this.waveEnemyCount, composition: { ...this.waveEnemyComposition },
      goldEarned: this.gold - this.waveGoldAtStart,
      goldAvailable: this.gold, lives: this.lives, enemiesKilled: this.enemiesKilled, enemiesLeaked: this.enemiesLeaked,
      towerLevels: this.towers.reduce((counts, tower) => {
        counts[`l${tower.level}` as "l1" | "l2" | "l3"] += 1;
        return counts;
      }, { l1: 0, l2: 0, l3: 0 }),
    };
    console.log("Wave complete", telemetry);
    if (this.currentWave % 10 === 0) {
      this.hpTierWarning = {
        completedWave: this.currentWave,
        nextWave: this.currentWave + 1,
        nextMultiplier: getEnemyHpMultiplier(this.currentWave + 1),
      };
      this.hpTierWarningSecondsRemaining = 3;
      return;
    }
    // Outside tier warnings, Auto Run starts the next wave immediately as before.
    if (this.autoRun && !this.gameOver) this.startWave();
  }

  towerAt(cell: Cell): Tower | undefined { return this.towers.find((tower) => cellKey(tower.cell) === cellKey(cell)); }
}
