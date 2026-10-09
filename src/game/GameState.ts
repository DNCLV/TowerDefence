import { Cell, cellKey, sameCell } from "../core/types";
import { WORLD_UNITS_PER_CELL } from "../core/GameConstants";
import { Enemy, applyArcherMark, createEnemy, getEnemyHpForWave, getEnemyHpMultiplier, getEnemyHpTier, updateEnemySpecialStatuses } from "./enemies/Enemy";
import { Grid } from "./grid/Grid";
import { findPath, findPathThrough, findPathToAnyGoal } from "./pathfinding/Pathfinder";
import { Tower, TowerAttackMode, canTowerTargetEnemy, createBasicTower, getTowerAttackProfile, getTowerDamageType, getTowerLevelStats, getTowerSellRefund, getTowerSplashRadiusMultiplier, getTowerSplashRadiusTiles, getTowerSplashRatio, getTowerSplashRatioForTarget, getTowerSplashTargetLimit, isTowerInRange, isTowerAdjacent8, isEnemyWithinTowerCellRadius, upgradeTower } from "./towers/Tower";
import { DEFENDER_CONFIG, DefenderType } from "./config/DefenderConfig";
import { LEVEL_1 } from "./config/Level1";
import { BALANCE } from "./config/BalanceConfig";
import { RunLayout, RunSpawn } from "./map/RunLayout";
import { MAPS, MapDefinition, MapId, PlayerId } from "./config/MapConfig";
import { FactionDefinition, getFaction } from "./config/FactionConfig";
import { ENEMY_CONFIG, EnemyType } from "./config/EnemyConfig";
import { ENEMY_THREAT_WEIGHT, MAX_ACTIVE_WAVE_ENEMIES, countWaveComposition, createWaveSpawnQueue, getWaveComposition, getWaveGoldReward } from "./config/WaveConfig";
import { SPECIALIZATIONS_BY_DEFENDER, TOWER_SPECIALIZATIONS } from "./config/SpecializationConfig";
import type { TowerSpecializationId } from "./config/SpecializationConfig";
import { FORMATION_BY_ID, resolveFormation } from "./config/FormationConfig";
import { EnemyAffixSystem, applyEnemySlow, getCommanderAuraMultiplier, getEnemyDamageMultiplier, getEnemySpeedMultiplier, updateEnemyAffixes, createRunSeed } from "./enemies/EnemyAffixSystem";
import type { AffixMilestoneWarning, DamageType } from "./config/EnemyAffixConfig";
import { FactionBonusSystem } from "./FactionBonusSystem";
import { AncientGroveStatusSystem, getSunbrandDamage, getSunbrandTargetPriority, getThornRotDamage } from "./AncientGroveStatusSystem";
import { FACTION_BONUS_CONFIG } from "./config/FactionBonusConfig";
import { CURRENT_CAMPAIGN_FINAL_WAVE } from "./config/CampaignProgressionConfig";
import { MULTIPLAYER_CONFIG } from "./config/MultiplayerConfig";
import type { PlayerState } from "./PlayerState";
import { getVerdantResonanceProfile } from "./config/AncientGroveUnitConfig";

export type PlacementResult = "placed" | "not-enough-gold" | "invalid-cell" | "forbidden-zone" | "invalid-player" | "enemy-occupied" | "blocks-path" | "game-over";
export type UpgradeResult = "upgraded" | "specialization-required" | "invalid-specialization" | "not-enough-gold" | "max-level" | "game-over" | "tower-not-found" | "not-owner" | "invalid-player";
export type SellResult = { refund: number } | "game-over" | "tower-not-found" | "not-owner" | "invalid-player";
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
  effectKind: "primary" | "splash" | "chain" | "cleave" | "radial" | "shockwave";
  specializationId?: TowerSpecializationId;
  damageType: DamageType;
  sourceX: number;
  sourceY: number;
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
  readonly grid: Grid;
  readonly map: MapDefinition;
  readonly players: PlayerState[];
  activePlayerId: PlayerId;
  get activePlayer(): PlayerState { return this.players.find((player) => player.playerId === this.activePlayerId) ?? this.players[0]; }
  get faction(): FactionDefinition { return getFaction(this.activePlayer.factionId); }
  get factionId(): FactionDefinition["id"] { return this.activePlayer.factionId; }
  get availableUnits(): readonly DefenderType[] { return this.faction.units; }
  get isMultiplayer(): boolean { return this.players.length > 1; }
  layout!: RunLayout;
  readonly spawnPaths = new Map<string, Cell[]>();
  private readonly spawnPathVariants = new Map<string, Cell[][]>();
  private readonly spawnVariantCursors = new Map<string, number>();
  get spawn(): Cell { return this.layout.activeSpawns[0].entryCell; }
  get exit(): Cell { return this.layout.castle.approachCell; }
  get goals() { return this.layout.goals ?? [this.layout.castle]; }
  path: Cell[];
  get gold(): number { return this.activePlayer.gold; }
  set gold(value: number) { this.activePlayer.gold = value; }
  lives: number = BALANCE.startingLives;
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
  affixWarning?: AffixMilestoneWarning;
  /** Set after the authored finale until the player explicitly enters Free Play. */
  campaignVictoryPending = false;
  freePlay = false;
  readonly affixSystem: EnemyAffixSystem;
  readonly factionBonuses: FactionBonusSystem;
  private readonly ancientGroveStatuses = new AncientGroveStatusSystem();
  gameOver = false;
  private nextTowerId = 1;
  private nextEnemyId = 1;
  private toSpawn = 0;
  private spawnTimer = 0;
  private spawnQueue: EnemyType[] = [];
  private spawnQueueCursor = 0;
  /** Each active spawn receives its own balanced copy of the wave queue. */
  private readonly spawnQueuesBySpawn = new Map<string, EnemyType[]>();
  private readonly spawnQueueCursorsBySpawn = new Map<string, number>();
  private spawnRoundRobinCursor = 0;
  private wavesStarted = 0;
  private waveEnemyCount = 0;
  private waveEnemyComposition: Record<EnemyType, number> = { goblin: 0, goblinBrute: 0, goblinRider: 0, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 0, skeletonKing: 0, skeletalCommander: 0 };
  private waveSpawnInterval = 0.65;
  private waveGoldAtStart = 0;
  private enemiesKilled = 0;
  private enemiesLeaked = 0;
  private resetCount = 0;
  private hpTierWarningSecondsRemaining = 0;
  private affixWarningSecondsRemaining = 0;

  constructor(map: MapDefinition | MapId = "single-spawn", factionSelection: FactionDefinition["id"] | readonly FactionDefinition["id"][] = "arcane-kingdom", affixSeed = createRunSeed()) {
    this.map = typeof map === "string" ? MAPS[map] : map;
    const requestedFactions = Array.isArray(factionSelection) ? factionSelection : [factionSelection];
    const slots = this.map.multiplayer?.playerSlots ?? [{ playerId: "player-1" as PlayerId, playerIndex: 0, buildZoneIds: [] }];
    this.players = slots.map((slot, index) => ({
      ...slot,
      gold: this.map.multiplayer?.startingGoldPerPlayer ?? this.map.startingGold,
      factionId: requestedFactions[index] ?? requestedFactions[0] ?? "arcane-kingdom",
      ownedTowerIds: [],
    }));
    this.activePlayerId = this.players[0].playerId;
    this.factionBonuses = new FactionBonusSystem(this.players.some((player) => player.factionId === FACTION_BONUS_CONFIG.ancientGroveId)
      ? FACTION_BONUS_CONFIG.ancientGroveId : this.players[0].factionId);
    this.grid = new Grid(this.map.width, this.map.height);
    this.affixSystem = new EnemyAffixSystem(affixSeed);
    [
      ...this.map.terrain,
      ...this.map.layout.activeSpawns.map((spawn) => spawn.gateCell),
      ...(this.map.layout.goals ?? [this.map.layout.castle]).map((goal) => goal.gateCell),
    ].forEach((cell) => this.grid.setTerrain(cell, true));
    this.layout = this.copyMapLayout();
    this.path = [];
    this.refreshSpawnPaths();
    this.refreshLivingMazeInfluence();
    this.lives = this.map.multiplayer?.teamStartingLives ?? BALANCE.startingLives;
    this.logLayout();
  }

  setActivePlayer(playerId: PlayerId): boolean {
    if (!this.players.some((player) => player.playerId === playerId)) return false;
    this.activePlayerId = playerId;
    return true;
  }

  getPlayer(playerId: PlayerId = this.activePlayerId): PlayerState | undefined {
    return this.players.find((player) => player.playerId === playerId);
  }

  getTowerFactionId(tower: Pick<Tower, "ownerPlayerId">): FactionDefinition["id"] {
    return this.getPlayer(tower.ownerPlayerId)?.factionId ?? this.players[0].factionId;
  }

  canPlayerBuildAt(playerId: PlayerId, cell: Cell): boolean {
    if (!this.map.multiplayer) return playerId === this.players[0].playerId;
    const player = this.getPlayer(playerId);
    if (!player) return false;
    return this.map.multiplayer.buildZones.some((zone) => player.buildZoneIds.includes(zone.id)
      && cell.x >= zone.x && cell.x < zone.x + zone.width && cell.y >= zone.y && cell.y < zone.y + zone.height);
  }

  /** Checks a proposed build without changing economy, grid, or tower state. */
  canPlaceBasicTower(cell: Cell, type: DefenderType = "blue-wizard", playerId: PlayerId = this.activePlayerId): PlacementResult {
    if (this.gameOver) return "game-over";
    const player = this.getPlayer(playerId);
    if (!player) return "invalid-player";
    if (!getFaction(player.factionId).units.includes(type)) return "invalid-cell";
    if (!this.canPlayerBuildAt(playerId, cell)) return "forbidden-zone";
    if (!this.grid.isBuildable(cell) || this.layout.activeSpawns.some((spawn) => sameCell(cell, spawn.entryCell)) || this.goals.some((goal) => sameCell(cell, goal.approachCell))) return "invalid-cell";
    if (this.enemies.some((enemy) => enemy.alive && sameCell(this.enemyCurrentCell(enemy), cell))) return "enemy-occupied";
    if (player.gold < DEFENDER_CONFIG[type].buildCost) return "not-enough-gold";

    this.grid.setBlocked(cell, true);
    const pathExists = this.layout.activeSpawns.every((spawn) => this.groundRoute(spawn.entryCell, spawn) !== null)
      && this.enemies.every((enemy) => !enemy.alive || enemy.movementType === "flying" || this.shortestRouteForEnemy(enemy, false) !== null);
    this.grid.setBlocked(cell, false);
    return pathExists ? "placed" : "blocks-path";
  }

  upgradeBasicTower(towerId: number, specializationId?: TowerSpecializationId, playerId: PlayerId = this.activePlayerId): UpgradeResult {
    if (this.gameOver) return "game-over";
    const tower = this.towers.find((candidate) => candidate.id === towerId);
    if (!tower) return "tower-not-found";
    const player = this.getPlayer(playerId);
    if (!player) return "invalid-player";
    if (tower.ownerPlayerId !== playerId) return "not-owner";
    const next = getTowerLevelStats(tower.level + 1, tower.type);
    if (next.level === tower.level) return "max-level";
    if (next.level !== tower.level + 1 || next.upgradeCost === null) return "max-level";
    const choices = SPECIALIZATIONS_BY_DEFENDER[tower.type];
    if (next.level === 3 && choices) {
      if (!specializationId) return "specialization-required";
      if (!choices.includes(specializationId) || TOWER_SPECIALIZATIONS[specializationId].defenderType !== tower.type) return "invalid-specialization";
    }
    if (player.gold < next.upgradeCost) return "not-enough-gold";
    player.gold -= next.upgradeCost;
    upgradeTower(tower, specializationId);
    this.refreshFormations();
    return "upgraded";
  }

  sellTower(towerId: number, playerId: PlayerId = this.activePlayerId): SellResult {
    if (this.gameOver) return "game-over";
    const index = this.towers.findIndex((candidate) => candidate.id === towerId);
    if (index < 0) return "tower-not-found";
    const player = this.getPlayer(playerId);
    if (!player) return "invalid-player";
    if (this.towers[index].ownerPlayerId !== playerId) return "not-owner";
    const [tower] = this.towers.splice(index, 1);
    const refund = getTowerSellRefund(tower);
    player.gold += refund;
    player.ownedTowerIds = player.ownedTowerIds.filter((id) => id !== tower.id);
    this.grid.setBlocked(tower.cell, false);
    this.refreshFormations();
    this.refreshSpawnPaths();
    this.refreshLivingMazeInfluence();
    if (this.waveActive) {
      this.wavePath = this.path.map((cell) => ({ ...cell }));
      this.repathActiveEnemies();
    }
    return { refund };
  }

  placeBasicTower(cell: Cell, type: DefenderType = "blue-wizard", playerId: PlayerId = this.activePlayerId): PlacementResult {
    const validation = this.canPlaceBasicTower(cell, type, playerId);
    if (validation !== "placed") return validation;
    this.grid.setBlocked(cell, true);
    const newPath = this.groundRoute(this.spawn, this.layout.activeSpawns[0]);
    // The path was validated above. This guard keeps state safe if Grid changes later.
    if (!newPath) { this.grid.setBlocked(cell, false); return "blocks-path"; }
    const player = this.getPlayer(playerId)!;
    player.gold -= DEFENDER_CONFIG[type].buildCost;
    this.path = newPath;
    this.refreshSpawnPaths();
    if (this.waveActive) {
      this.wavePath = this.path.map((pathCell) => ({ ...pathCell }));
      this.repathActiveEnemies();
    }
    const tower = createBasicTower(this.nextTowerId++, cell, type, playerId);
    this.towers.push(tower);
    player.ownedTowerIds.push(tower.id);
    this.refreshFormations();
    this.refreshLivingMazeInfluence();
    return "placed";
  }

  startWave(): boolean {
    if (this.waveActive || this.lives <= 0 || this.gameOver || this.path.length === 0 || this.hpTierWarning || this.affixWarning || this.campaignVictoryPending) return false;
    this.currentWave = this.wavesStarted + 1;
    this.wavesStarted += 1;
    this.waveActive = true;
    this.affixWarning = this.affixSystem.rollMilestone(this.currentWave);
    this.affixWarningSecondsRemaining = this.affixWarning ? 5 : 0;
    const baseComposition = getWaveComposition(this.currentWave);
    const composition = {
      ...baseComposition,
      entries: baseComposition.entries.map((entry) => ({
        ...entry,
        count: Math.max(1, Math.round(entry.count * this.map.enemyCountMultiplier)),
      })),
      totalThreat: baseComposition.entries.reduce((total, entry) => total
        + Math.max(1, Math.round(entry.count * this.map.enemyCountMultiplier)) * ENEMY_THREAT_WEIGHT[entry.type], 0),
    };
    this.spawnQueue = createWaveSpawnQueue(composition);
    this.spawnQueueCursor = 0;
    this.buildSpawnQueuesBySpawn();
    this.spawnRoundRobinCursor = 0;
    this.spawnVariantCursors.clear();
    this.toSpawn = this.spawnQueue.length;
    this.spawnTimer = 0;
    const multiplayerScaling = this.playerCountScaling();
    this.waveSpawnInterval = (composition.spawnInterval ?? 0.65) * multiplayerScaling.spawnPacingMultiplier;
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
      activeEnemyCap: MAX_ACTIVE_WAVE_ENEMIES * this.layout.activeSpawns.length,
      enemyTypes: ENEMY_CONFIG,
    });
    this.waveGoldAtStart = this.totalTeamGold();
    this.enemiesKilled = 0;
    this.enemiesLeaked = 0;
    return true;
  }

  toggleAutoRun(): void {
    if (this.gameOver) return;
    this.autoRun = !this.autoRun;
  }

  continueFreePlay(): boolean {
    if (!this.campaignVictoryPending) return false;
    this.campaignVictoryPending = false;
    this.freePlay = true;
    return true;
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
    this.layout = this.copyMapLayout();
    this.path = [];
    this.spawnPaths.clear();
    this.refreshSpawnPaths();
    this.refreshLivingMazeInfluence();
    for (const player of this.players) {
      player.gold = this.map.multiplayer?.startingGoldPerPlayer ?? this.map.startingGold;
      player.ownedTowerIds = [];
    }
    this.activePlayerId = this.players[0].playerId;
    this.lives = this.map.multiplayer?.teamStartingLives ?? BALANCE.startingLives;
    this.towers = [];
    this.enemies = [];
    this.attackEvents.length = 0;
    this.wavePath = [];
    this.waveActive = false;
    this.currentWave = 1;
    this.autoRun = false;
    this.campaignVictoryPending = false;
    this.freePlay = false;
    this.hpTierWarning = undefined;
    this.hpTierWarningSecondsRemaining = 0;
    this.affixWarning = undefined;
    this.affixWarningSecondsRemaining = 0;
    this.affixSystem.reset();
    this.gameOver = false;
    this.nextTowerId = 1;
    this.nextEnemyId = 1;
    this.toSpawn = 0;
    this.spawnTimer = 0;
    this.spawnQueue = [];
    this.spawnQueueCursor = 0;
    this.spawnQueuesBySpawn.clear();
    this.spawnQueueCursorsBySpawn.clear();
    this.spawnRoundRobinCursor = 0;
    this.spawnVariantCursors.clear();
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
    if (this.affixWarning) {
      this.affixWarningSecondsRemaining = Math.max(0, this.affixWarningSecondsRemaining - realDeltaSeconds);
      if (this.affixWarningSecondsRemaining === 0) this.affixWarning = undefined;
    }
    if (!this.waveActive) {
      return;
    }
    this.attackEvents.length = 0;
    if (!this.affixWarning) this.spawnTimer -= deltaSeconds;
    const activeEnemyCap = MAX_ACTIVE_WAVE_ENEMIES * this.layout.activeSpawns.length;
    if (!this.affixWarning && this.toSpawn > 0 && this.spawnTimer <= 0 && this.enemies.length < activeEnemyCap) {
      let spawnedThisTick = 0;
      const spawnCount = this.layout.activeSpawns.length;
      for (let offset = 0; offset < spawnCount; offset += 1) {
        if (this.toSpawn <= 0 || this.enemies.length >= activeEnemyCap) break;
        const spawn = this.layout.activeSpawns[(this.spawnRoundRobinCursor + offset) % spawnCount];
        const spawnQueue = this.spawnQueuesBySpawn.get(spawn.id);
        const queue = spawnQueue ?? this.spawnQueue;
        const queueCursor = spawnQueue ? (this.spawnQueueCursorsBySpawn.get(spawn.id) ?? 0) : this.spawnQueueCursor;
        const type = queue[queueCursor];
        if (!type) continue;
        // Multi-front queues run concurrently. Hold Commander finishers until every other lane is drained.
        if (type === "skeletalCommander" && this.hasPendingNonCommanderSpawns()) continue;
        const isFlying = ENEMY_CONFIG[type].movementType === "flying";
        const groundRoute = isFlying ? null : this.nextSpawnRoute(spawn);
        if (!isFlying && !groundRoute) continue;
        if (spawnQueue) this.spawnQueueCursorsBySpawn.set(spawn.id, queueCursor + 1);
        else this.spawnQueueCursor += 1;
        const destination = isFlying ? this.selectFlyingGoal(spawn) : this.goalForPath(groundRoute!);
        const route = isFlying ? [{ ...spawn.entryCell }, { ...destination.approachCell }] : groundRoute!;
        const enemy = createEnemy(this.nextEnemyId++, type, route, this.currentWave);
        const hpMultiplier = this.playerCountScaling().enemyHpMultiplier;
        if (hpMultiplier !== 1) {
          enemy.maxHp = Math.round(enemy.maxHp * hpMultiplier);
          enemy.hp = enemy.maxHp;
        }
        enemy.preferredGoalId = spawn.preferredGoalId ?? this.layout.castle.id;
        enemy.allowedGoalIds = spawn.allowedGoalIds ? [...spawn.allowedGoalIds] : undefined;
        enemy.targetGoalId = destination.id;
        this.affixSystem.assign(enemy, this.currentWave);
        this.enemies.push(enemy);
        this.toSpawn -= 1;
        spawnedThisTick += 1;
      }
      if (spawnedThisTick > 0) {
        this.spawnRoundRobinCursor = (this.spawnRoundRobinCursor + spawnedThisTick) % spawnCount;
        this.spawnTimer = this.waveSpawnInterval;
      }
    }
    const survivors: Enemy[] = [];
    for (const enemy of this.enemies) {
      updateEnemyAffixes(enemy, deltaSeconds);
      updateEnemySpecialStatuses(enemy, deltaSeconds);
      const resonance = this.getVerdantResonanceAt(enemy);
      const allowsFlying = enemy.movementType === "flying" && resonance.enablesGroundEffectsAgainstFlying;
      const occupiedCell = this.enemyCurrentCell(enemy);
      this.factionBonuses.updateLivingMazeExposure(enemy, deltaSeconds, allowsFlying, occupiedCell);
      const routeCell = enemy.path[enemy.currentPathIndex];
      const treantLevel = this.factionBonuses.getTreantLevelAt(allowsFlying ? occupiedCell : (routeCell ?? occupiedCell), this.towers, allowsFlying);
      if (this.players.some((player) => player.factionId === FACTION_BONUS_CONFIG.ancientGroveId)) {
        this.ancientGroveStatuses.updateEnemy(enemy, deltaSeconds, treantLevel, allowsFlying);
      }
      this.moveEnemy(enemy, deltaSeconds, getCommanderAuraMultiplier(enemy, this.enemies)
        * getEnemySpeedMultiplier(enemy)
        * this.factionBonuses.getLivingMazeSlowMultiplier(enemy, resonance.slowStrengthMultiplier, allowsFlying));
    }
    this.applyAncientGroveDamage(deltaSeconds);
    this.updateTowers(deltaSeconds);
    for (const enemy of this.enemies) {
      if (!enemy.alive) { this.ancientGroveStatuses.clearEnemy(enemy); continue; }
      if (enemy.hp <= 0) {
        enemy.alive = false;
        this.ancientGroveStatuses.clearEnemy(enemy);
        continue;
      }
      survivors.push(enemy);
    }
    this.enemies = survivors;
    if (this.lives <= 0) {
      console.info("GAME OVER - waiting for TRY AGAIN", {
        wave: this.currentWave,
        lives: 0,
        gold: this.totalTeamGold(),
      });
      this.gameOver = true;
      this.autoRun = false;
      this.waveActive = false;
      this.toSpawn = 0;
      for (const enemy of this.enemies) this.ancientGroveStatuses.clearEnemy(enemy);
      this.enemies = [];
    } else if (this.toSpawn === 0 && this.enemies.length === 0) {
      this.completeWave();
    }
  }

  /** Moves along the current route using only delta time and grid coordinates. */
  private moveEnemy(enemy: Enemy, deltaSeconds: number, speedMultiplier = 1): void {
    let distanceLeft = enemy.speed * speedMultiplier * deltaSeconds;
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
      if (DEFENDER_CONFIG[tower.type].radialAttack) {
        this.updateRadialTower(tower);
        continue;
      }
      const target = this.findTowerTarget(tower);
      if (!target) continue;
      const towerFactionId = this.getTowerFactionId(tower);
      const profile = getTowerAttackProfile(tower, target, towerFactionId);
      const primaryDamage = profile.damage;
      tower.cooldownRemaining = 1 / profile.fireRate;
      const primaryDamageType = getTowerDamageType(tower, profile.mode);
      this.applyTowerDamage(tower, target, primaryDamage, profile.mode, false, "primary", primaryDamageType, tower.cell.x, tower.cell.y, profile.physicalResistancePenetration ?? 0);

      const specialization = tower.specializationId ? TOWER_SPECIALIZATIONS[tower.specializationId] : undefined;
      if (specialization?.slow) applyEnemySlow(target, specialization.slow.multiplier, specialization.slow.durationSeconds);
      if (specialization?.mark && target.alive) applyArcherMark(target, specialization.mark.durationSeconds);
      const chain = specialization?.chain;
      const chainTriggered = chain !== undefined
        && (!chain.everyNthAttack || (tower.specializationAttackCounter + 1) % chain.everyNthAttack === 0);
      if (chain?.everyNthAttack) tower.specializationAttackCounter += 1;
      if (chain && chainTriggered) {
        let previous = target;
        const hitIds = new Set([target.id]);
        for (let index = 0; index < chain.targetCount; index += 1) {
          const candidate = this.findChainTarget(tower, previous, hitIds, chain.rangeCells);
          if (!candidate) break;
          hitIds.add(candidate.id);
          const sourceX = previous.x, sourceY = previous.y;
          const chainedProfile = getTowerAttackProfile(tower, candidate, towerFactionId);
          const chainDamage = Math.round(chainedProfile.damage * chain.damageRatios[index]);
          this.applyTowerDamage(tower, candidate, chainDamage, chainedProfile.mode, false, "chain", getTowerDamageType(tower, chainedProfile.mode), sourceX, sourceY);
          previous = candidate;
        }
        continue;
      }

      const splashRatio = getTowerSplashRatio(tower, profile.mode);
      if (splashRatio <= 0) continue;
      const splashDamage = Math.round(primaryDamage * splashRatio);
      if (splashDamage <= 0) continue;
      const targetCellX = Math.round(target.x);
      const targetCellY = Math.round(target.y);
      // Snapshot the candidates so each secondary is damaged once and never re-targeted recursively.
      const isCleave = tower.specializationId === "dawn-paladin";
      const radiusCells = getTowerSplashRadiusTiles(tower) * getTowerSplashRadiusMultiplier(tower);
      const secondaryTargets = this.enemies.filter((enemy) => enemy !== target && enemy.alive && enemy.hp > 0
        && canTowerTargetEnemy(tower, enemy)
        && Math.hypot(enemy.x - target.x, enemy.y - target.y) <= radiusCells
        && (!isCleave || isTowerAdjacent8(tower, enemy)))
        .sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y));
      const selectedSecondaries = isCleave ? secondaryTargets.slice(0, 2) : secondaryTargets;
      const configuredLimit = getTowerSplashTargetLimit(tower);
      const targetLimit = configuredLimit ?? selectedSecondaries.length;
      for (let index = 0; index < Math.min(targetLimit, selectedSecondaries.length); index += 1) {
        const secondary = selectedSecondaries[index];
        const ratio = getTowerSplashRatioForTarget(tower, profile.mode, index, target.livingMazeExposureSeconds);
        const damageForTarget = Math.round(primaryDamage * ratio);
        if (damageForTarget <= 0) continue;
        this.applyTowerDamage(tower, secondary, damageForTarget, profile.mode, true, isCleave ? "cleave" : "splash", primaryDamageType, target.x, target.y, profile.physicalResistancePenetration ?? 0);
      }
    }
  }

  /** Bark Titan attacks originate at the tower and hit every valid enemy in its grid-ring range. */
  private updateRadialTower(tower: Tower): void {
    const targets = this.enemies.filter((enemy) => enemy.alive && enemy.hp > 0
      && canTowerTargetEnemy(tower, enemy) && isTowerInRange(tower, enemy));
    if (targets.length === 0) return;
    targets.sort((a, b) => this.remainingDistanceToExit(a) - this.remainingDistanceToExit(b) || a.id - b.id);
    const towerFactionId = this.getTowerFactionId(tower);
    const firstProfile = getTowerAttackProfile(tower, targets[0], towerFactionId);
    tower.cooldownRemaining = 1 / firstProfile.fireRate;
    for (const enemy of targets) {
      const profile = getTowerAttackProfile(tower, enemy, towerFactionId);
      this.applyTowerDamage(tower, enemy, profile.damage, profile.mode, true, "radial",
        getTowerDamageType(tower, profile.mode), tower.cell.x, tower.cell.y, profile.physicalResistancePenetration ?? 0);
    }

    const specialization = tower.specializationId ? TOWER_SPECIALIZATIONS[tower.specializationId] : undefined;
    const shockwave = specialization?.shockwave;
    if (!shockwave) return;
    tower.specializationAttackCounter += 1;
    if (tower.specializationAttackCounter % shockwave.everyNthAttack !== 0) return;
    const shockwaveTargets = this.enemies.filter((enemy) => enemy.alive && enemy.hp > 0
      && canTowerTargetEnemy(tower, enemy)
      && isEnemyWithinTowerCellRadius(tower, enemy, shockwave.rangeCells))
      .sort((a, b) => a.id - b.id);
    for (const enemy of shockwaveTargets) {
      const profile = getTowerAttackProfile(tower, enemy, towerFactionId);
      this.applyTowerDamage(tower, enemy, Math.round(profile.damage * shockwave.damageRatio), profile.mode, true, "shockwave",
        getTowerDamageType(tower, profile.mode), tower.cell.x, tower.cell.y, profile.physicalResistancePenetration ?? 0);
    }
  }

  /** Ancient Grove damage-over-time is resolved in simulation, never in the Babylon renderer. */
  private applyAncientGroveDamage(deltaSeconds: number): void {
    if (!this.players.some((player) => player.factionId === FACTION_BONUS_CONFIG.ancientGroveId) || deltaSeconds <= 0) return;
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.hp <= 0) continue;
      const resonance = this.getVerdantResonanceAt(enemy);
      const thornDps = getThornRotDamage(enemy, enemy.thornRotSourceLevel) * resonance.dotDamageMultiplier;
      if (thornDps > 0) {
        const accumulated = enemy.thornRotDamageRemainder + thornDps * deltaSeconds;
        const damage = Math.floor(accumulated);
        enemy.thornRotDamageRemainder = accumulated - damage;
        if (damage > 0) {
          const source = this.towers.find((tower) => tower.type === "treant" && tower.level === enemy.thornRotSourceLevel);
          this.applyStatusDamage(enemy, damage, "physical", source);
        }
      }
      if (!enemy.alive || enemy.hp <= 0) continue;
      const sunDps = getSunbrandDamage(enemy) * resonance.dotDamageMultiplier;
      if (sunDps > 0) {
        const accumulated = enemy.sunbrandDamageRemainder + sunDps * deltaSeconds;
        const damage = Math.floor(accumulated);
        enemy.sunbrandDamageRemainder = accumulated - damage;
        if (damage > 0) this.applyStatusDamage(enemy, damage, "magic");
      }
    }
  }

  private applyStatusDamage(enemy: Enemy, damage: number, damageType: DamageType, sourceTower?: Tower): void {
    const resistedDamage = Math.max(0, Math.round(damage * getEnemyDamageMultiplier(enemy, damageType)));
    const shieldDamage = Math.min(enemy.shield, resistedDamage);
    enemy.shield -= shieldDamage;
    const hpBefore = enemy.hp;
    enemy.hp = Math.max(0, hpBefore - (resistedDamage - shieldDamage));
    const effectiveDamage = shieldDamage + hpBefore - enemy.hp;
    enemy.regenDelayRemaining = 1;
    if (sourceTower) sourceTower.combatStats.damageDone += effectiveDamage;
    if (hpBefore > 0 && enemy.hp <= 0) {
      enemy.alive = false;
      this.ancientGroveStatuses.clearEnemy(enemy);
      if (sourceTower) sourceTower.combatStats.kills += 1;
      this.distributeReward(getWaveGoldReward(enemy.reward, this.currentWave));
      this.enemiesKilled += 1;
    }
  }

  private applyTowerDamage(tower: Tower, enemy: Enemy, damage: number, attackMode: TowerAttackMode, isSplash: boolean, effectKind: TowerAttackEvent["effectKind"], damageType: DamageType, sourceX: number, sourceY: number, resistancePenetration = 0): void {
    let totalDamage = damage;
    if (tower.type === "seer" && tower.specializationId === "sun-seer" && this.getTowerFactionId(tower) === FACTION_BONUS_CONFIG.ancientGroveId) {
      const detonates = this.ancientGroveStatuses.applySunbrandHit(enemy);
      if (detonates) totalDamage += FACTION_BONUS_CONFIG.sunbrand.solarDetonationDamage;
    }
    const resistedDamage = Math.max(0, Math.round(totalDamage * getEnemyDamageMultiplier(enemy, damageType, resistancePenetration)));
    const shieldDamage = Math.min(enemy.shield, resistedDamage);
    enemy.shield -= shieldDamage;
    const remainingDamage = resistedDamage - shieldDamage;
    const hpBefore = enemy.hp;
    enemy.hp = Math.max(0, hpBefore - remainingDamage);
    const effectiveDamage = shieldDamage + hpBefore - enemy.hp;
    enemy.regenDelayRemaining = 1;
    tower.combatStats.damageDone += effectiveDamage;
    const enemyDied = hpBefore > 0 && enemy.hp <= 0;
    this.attackEvents.push({
      towerId: tower.id, defenderType: tower.type, towerCell: { ...tower.cell },
      targetEnemyId: enemy.id, targetX: enemy.x, targetY: enemy.y,
      damageDealt: effectiveDamage, enemyDied, attackMode, isSplash, effectKind, specializationId: tower.specializationId, damageType, sourceX, sourceY,
    });
    if (!enemyDied) return;
    tower.combatStats.kills += 1;
    enemy.alive = false;
    this.ancientGroveStatuses.clearEnemy(enemy);
    this.distributeReward(getWaveGoldReward(enemy.reward, this.currentWave));
    this.enemiesKilled += 1;
  }

  private findTowerTarget(tower: Tower, excludeIds: ReadonlySet<number> = new Set(), from?: { x: number; y: number }, maxDistance?: number): Enemy | undefined {
    const inRange = this.enemies.filter((enemy) => enemy.alive && enemy.hp > 0 && !excludeIds.has(enemy.id)
      && canTowerTargetEnemy(tower, enemy) && isTowerInRange(tower, enemy));
    const candidates = from && maxDistance !== undefined
      ? inRange.filter((enemy) => Math.hypot(enemy.x - from.x, enemy.y - from.y) <= maxDistance)
      : inRange;
    return candidates.sort((a, b) => {
      // Archers are the dedicated anti-air tower: prefer flying targets
      // whenever one is available in range.
      if (tower.type === "green-archer" && tower.specializationId !== "ranger" && a.movementType !== b.movementType) {
        return a.movementType === "flying" ? -1 : 1;
      }
      if (tower.type === "seer" && tower.specializationId === "sun-seer") {
        const statusDifference = getSunbrandTargetPriority(a.sunbrandStacks) - getSunbrandTargetPriority(b.sunbrandStacks);
        if (statusDifference !== 0) return statusDifference;
      }
      const remainingDifference = this.remainingDistanceToExit(a) - this.remainingDistanceToExit(b);
      // Different spawns have different route lengths, so raw path-index is not comparable.
      if (Math.abs(remainingDifference) > 0.05) return remainingDifference;
      const hpDifference = a.hp - b.hp;
      return hpDifference !== 0 ? hpDifference : this.distanceToTower(tower, a) - this.distanceToTower(tower, b);
    })[0];
  }

  private findChainTarget(tower: Tower, previous: Enemy, hitIds: ReadonlySet<number>, rangeCells: number): Enemy | undefined {
    return this.findTowerTarget(tower, hitIds, previous, rangeCells);
  }

  private refreshFormations(): void {
    for (const tower of this.towers) tower.formationId = resolveFormation(tower, this.towers)?.id;
  }

  private refreshLivingMazeInfluence(): void {
    const groveTowers = this.towers.filter((tower) => this.getTowerFactionId(tower) === FACTION_BONUS_CONFIG.ancientGroveId);
    this.factionBonuses.rebuildLivingMazeInfluence(groveTowers, [...this.spawnPaths.values()]);
  }

  private distanceToTower(tower: Tower, enemy: Enemy): number {
    return Math.hypot(enemy.x - tower.cell.x, enemy.y - tower.cell.y) * WORLD_UNITS_PER_CELL;
  }

  /** Strongest overlapping Verdant Resonance value wins per axis; identical auras never stack. */
  private getVerdantResonanceAt(enemy: Pick<Enemy, "x" | "y">): {
    dotDamageMultiplier: number;
    slowStrengthMultiplier: number;
    enablesGroundEffectsAgainstFlying: boolean;
  } {
    let dotDamageMultiplier = 1;
    let slowStrengthMultiplier = 1;
    let enablesGroundEffectsAgainstFlying = false;
    for (const tower of this.towers) {
      if (tower.type !== "thorn-dancer" || this.getTowerFactionId(tower) !== FACTION_BONUS_CONFIG.ancientGroveId) continue;
      const profile = getVerdantResonanceProfile(tower.specializationId);
      if (Math.hypot(enemy.x - tower.cell.x, enemy.y - tower.cell.y) > profile.radiusCells) continue;
      dotDamageMultiplier = Math.max(dotDamageMultiplier, profile.dotDamageMultiplier);
      slowStrengthMultiplier = Math.max(slowStrengthMultiplier, profile.slowStrengthMultiplier);
      enablesGroundEffectsAgainstFlying = true;
    }
    return { dotDamageMultiplier, slowStrengthMultiplier, enablesGroundEffectsAgainstFlying };
  }

  /** Remaining route distance in grid units, calculated from the enemy's current live path. */
  private remainingDistanceToExit(enemy: Enemy): number {
    const nextIndex = enemy.currentPathIndex + 1;
    const next = enemy.path[nextIndex];
    if (!next) {
      const current = enemy.path[enemy.currentPathIndex];
      return current ? Math.hypot(enemy.x - current.x, enemy.y - current.y) : Number.POSITIVE_INFINITY;
    }
    let remaining = Math.hypot(next.x - enemy.x, next.y - enemy.y);
    for (let index = nextIndex; index < enemy.path.length - 1; index += 1) {
      const from = enemy.path[index];
      const to = enemy.path[index + 1];
      remaining += Math.hypot(to.x - from.x, to.y - from.y);
    }
    return remaining;
  }

  private enemyCurrentCell(enemy: Enemy): Cell {
    return { x: Math.round(enemy.x), y: Math.round(enemy.y) };
  }

  /** Follow the current segment to either reachable end, then take the shortest route. */
  private shortestRouteForEnemy(enemy: Enemy, commitGoal = true): Cell[] | null {
    const current = enemy.path[Math.max(0, enemy.currentPathIndex)];
    const next = enemy.path[enemy.currentPathIndex + 1];
    let best: Cell[] | null = null;
    let bestGoalId = enemy.targetGoalId;
    let bestDistance = Number.POSITIVE_INFINITY;
    const allowedGoalIds = new Set(enemy.allowedGoalIds ?? this.goals.map((goal) => goal.id));
    const allowedGoals = this.goals.filter((goal) => allowedGoalIds.has(goal.id));
    for (const anchor of [current, next]) {
      if (!anchor || this.grid.isBlocked(anchor)) continue;
      const resolved = findPathToAnyGoal(this.grid, anchor, allowedGoals.map((goal) => ({ id: goal.id, cell: goal.approachCell })),
        enemy.preferredGoalId, enemy.targetGoalId, MULTIPLAYER_CONFIG.goalSwitchMinimumSavings);
      if (!resolved) continue;
      const distance = Math.hypot(anchor.x - enemy.x, anchor.y - enemy.y) + resolved.path.length - 1;
      if (distance < bestDistance) {
        best = resolved.path;
        bestGoalId = resolved.goalId;
        bestDistance = distance;
      }
    }
    if (commitGoal && bestGoalId) enemy.targetGoalId = bestGoalId;
    return best;
  }

  /** Keeps enemy world coordinates intact while replacing only their remaining route. */
  private repathActiveEnemies(): void {
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.movementType === "flying") continue;
      const route = this.shortestRouteForEnemy(enemy);
      if (!route) {
        console.warn("Could not repath active enemy", enemy.id, this.enemyCurrentCell(enemy));
        continue;
      }
      enemy.path = route;
      // A mob between cell centers must reach its chosen anchor before the next step.
      enemy.currentPathIndex = enemy.x === route[0].x && enemy.y === route[0].y ? 0 : -1;
    }
  }

  private refreshSpawnPaths(): void {
    this.spawnPaths.clear();
    this.spawnPathVariants.clear();
    for (const spawn of this.layout.activeSpawns) {
      const routes = this.spawnRoutes(spawn);
      if (routes.length > 0) {
        this.spawnPathVariants.set(spawn.id, routes);
        this.spawnPaths.set(spawn.id, routes[0]);
      }
    }
    this.path = this.spawnPaths.get(this.layout.activeSpawns[0].id) ?? [];
  }

  private nextSpawnRoute(spawn: RunLayout["activeSpawns"][number]): Cell[] | null {
    const routes = this.spawnPathVariants.get(spawn.id) ?? [];
    if (routes.length === 0) return this.groundRoute(spawn.entryCell, spawn);
    const cursor = this.spawnVariantCursors.get(spawn.id) ?? 0;
    this.spawnVariantCursors.set(spawn.id, (cursor + 1) % routes.length);
    return routes[cursor % routes.length];
  }

  private spawnRoutes(spawn: RunLayout["activeSpawns"][number]): Cell[][] {
    if (this.map.id === "three-spawns" && spawn.id === "spawn-north") {
      const left = findPathThrough(this.grid, spawn.entryCell, [
        { x: 9, y: 29 }, { x: 9, y: 41 }, { x: 17, y: 52 }, this.exit,
      ]);
      const right = findPathThrough(this.grid, spawn.entryCell, [
        { x: 33, y: 29 }, { x: 33, y: 41 }, { x: 25, y: 52 }, this.exit,
      ]);
      return [left, right].filter((route): route is Cell[] => route !== null);
    }
    const route = this.groundRoute(spawn.entryCell, spawn);
    return route ? [route] : [];
  }

  /** Land mobs resolve among all allowed goals; a preferred lane wins near-ties. */
  private groundRoute(start: Cell, spawn?: RunLayout["activeSpawns"][number]): Cell[] | null {
    const allowedIds = new Set(spawn?.allowedGoalIds ?? this.goals.map((goal) => goal.id));
    return findPathToAnyGoal(this.grid, start,
      this.goals.filter((goal) => allowedIds.has(goal.id)).map((goal) => ({ id: goal.id, cell: goal.approachCell })),
      spawn?.preferredGoalId ?? this.layout.castle.id, undefined, MULTIPLAYER_CONFIG.goalSwitchMinimumSavings)?.path ?? null;
  }

  /** Public deterministic route query used by tests and future command validation. */
  routeForSpawn(spawnId: string): { goalId: string; path: Cell[] } | null {
    const spawn = this.layout.activeSpawns.find((candidate) => candidate.id === spawnId);
    if (!spawn) return null;
    const path = this.groundRoute(spawn.entryCell, spawn);
    return path ? { goalId: this.goalForPath(path).id, path } : null;
  }

  private goalForPath(path: readonly Cell[]) {
    const last = path[path.length - 1];
    return this.goals.find((goal) => sameCell(goal.approachCell, last)) ?? this.layout.castle;
  }

  private selectFlyingGoal(spawn: RunLayout["activeSpawns"][number]) {
    const allowedIds = new Set(spawn.allowedGoalIds ?? this.goals.map((goal) => goal.id));
    const candidates = this.goals.filter((goal) => allowedIds.has(goal.id)).sort((a, b) => {
      const distanceA = Math.abs(a.approachCell.x - spawn.entryCell.x) + Math.abs(a.approachCell.y - spawn.entryCell.y);
      const distanceB = Math.abs(b.approachCell.x - spawn.entryCell.x) + Math.abs(b.approachCell.y - spawn.entryCell.y);
      return distanceA - distanceB || a.id.localeCompare(b.id);
    });
    const shortest = candidates[0] ?? this.layout.castle;
    const preferred = candidates.find((goal) => goal.id === spawn.preferredGoalId);
    if (!preferred) return shortest;
    const preferredDistance = Math.abs(preferred.approachCell.x - spawn.entryCell.x) + Math.abs(preferred.approachCell.y - spawn.entryCell.y);
    const shortestDistance = Math.abs(shortest.approachCell.x - spawn.entryCell.x) + Math.abs(shortest.approachCell.y - spawn.entryCell.y);
    return preferredDistance - shortestDistance >= MULTIPLAYER_CONFIG.goalSwitchMinimumSavings ? shortest : preferred;
  }

  /** Distributes the same mixed wave queue across all active fronts. */
  private buildSpawnQueuesBySpawn(): void {
    this.spawnQueuesBySpawn.clear();
    this.spawnQueueCursorsBySpawn.clear();
    const spawns = this.layout.activeSpawns;
    spawns.forEach((spawn) => this.spawnQueuesBySpawn.set(spawn.id, []));
    const assigned = new Map(spawns.map((spawn) => [spawn.id, 0]));
    this.spawnQueue.forEach((type) => {
      const spawn = [...spawns].sort((a, b) => {
        const aRatio = (assigned.get(a.id) ?? 0) / Math.max(0.0001, a.weight ?? 1);
        const bRatio = (assigned.get(b.id) ?? 0) / Math.max(0.0001, b.weight ?? 1);
        return aRatio - bRatio || a.id.localeCompare(b.id);
      })[0];
      this.spawnQueuesBySpawn.get(spawn.id)?.push(type);
      assigned.set(spawn.id, (assigned.get(spawn.id) ?? 0) + 1);
    });
  }

  private hasPendingNonCommanderSpawns(): boolean {
    for (const [spawnId, queue] of this.spawnQueuesBySpawn) {
      const cursor = this.spawnQueueCursorsBySpawn.get(spawnId) ?? 0;
      for (let index = cursor; index < queue.length; index += 1) {
        if (queue[index] !== "skeletalCommander") return true;
      }
    }
    return false;
  }

  private logLayout(): void {
    console.log("Run layout", { castle: this.layout.castle.id, goalCount: this.goals.length, activeSpawnCount: this.layout.activeSpawns.length,
      startingGold: this.players.map((player) => ({ playerId: player.playerId, gold: player.gold })), activeSpawns: this.layout.activeSpawns.map((spawn) => spawn.id) });
  }

  private copyMapLayout(): RunLayout {
    return {
      castle: {
        ...this.map.layout.castle,
        cell: { ...this.map.layout.castle.cell }, gateCell: { ...this.map.layout.castle.gateCell },
        approachCell: { ...this.map.layout.castle.approachCell },
      },
      goals: (this.map.layout.goals ?? [this.map.layout.castle]).map((goal) => ({
        ...goal, cell: { ...goal.cell }, gateCell: { ...goal.gateCell }, approachCell: { ...goal.approachCell },
      })),
      activeSpawns: this.map.layout.activeSpawns.map((spawn) => ({
        ...spawn, cell: { ...spawn.cell }, gateCell: { ...spawn.gateCell }, entryCell: { ...spawn.entryCell },
        allowedGoalIds: spawn.allowedGoalIds ? [...spawn.allowedGoalIds] : undefined,
      })),
    };
  }

  private completeWave(): void {
    this.waveActive = false;
    const telemetry: WaveTelemetry = {
      wave: this.currentWave, enemies: this.waveEnemyCount, composition: { ...this.waveEnemyComposition },
      goldEarned: this.totalTeamGold() - this.waveGoldAtStart,
      goldAvailable: this.totalTeamGold(), lives: this.lives, enemiesKilled: this.enemiesKilled, enemiesLeaked: this.enemiesLeaked,
      towerLevels: this.towers.reduce((counts, tower) => {
        counts[`l${tower.level}` as "l1" | "l2" | "l3"] += 1;
        return counts;
      }, { l1: 0, l2: 0, l3: 0 }),
    };
    console.log("Wave complete", telemetry);
    if (this.currentWave === CURRENT_CAMPAIGN_FINAL_WAVE && !this.freePlay) {
      this.autoRun = false;
      this.campaignVictoryPending = true;
      return;
    }
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

  private totalTeamGold(): number { return this.players.reduce((total, player) => total + player.gold, 0); }

  private playerCountScaling() {
    return MULTIPLAYER_CONFIG.playerCountScaling[this.players.length]
      ?? MULTIPLAYER_CONFIG.playerCountScaling[1];
  }

  private distributeReward(reward: number): void {
    const scaledReward = Math.max(0, Math.round(reward * this.playerCountScaling().rewardMultiplier));
    const base = Math.floor(scaledReward / this.players.length);
    let remainder = scaledReward - base * this.players.length;
    for (const player of [...this.players].sort((a, b) => a.playerIndex - b.playerIndex)) {
      player.gold += base + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
    }
  }
}
