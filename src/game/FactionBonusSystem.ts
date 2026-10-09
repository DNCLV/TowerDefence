import { cellKey, Cell } from "../core/types";
import type { FactionId } from "./config/FactionConfig";
import { FACTION_BONUS_CONFIG, VeteranRank, VETERAN_TIERS } from "./config/FactionBonusConfig";
import type { Tower } from "./towers/Tower";
import type { Enemy } from "./enemies/Enemy";

export interface VeteranProgress {
  rank: VeteranRank;
  label: string;
  damage: number;
  next?: { rank: VeteranRank; label: string; requiredDamage: number };
  damageBonus: number;
  attackSpeedBonus: number;
  damageMultiplier: number;
  attackSpeedMultiplier: number;
}

export function getVeteranRank(damage: number): VeteranRank {
  let rank: VeteranRank = 0;
  for (const tier of VETERAN_TIERS) {
    if (damage >= tier.requiredDamage) rank = tier.rank;
  }
  return rank;
}

export function getVeteranProgress(factionId: FactionId, tower: Pick<Tower, "combatStats">): VeteranProgress {
  const damage = tower.combatStats.damageDone;
  const rank = factionId === FACTION_BONUS_CONFIG.royalGuardId ? getVeteranRank(damage) : 0;
  const tier = VETERAN_TIERS[rank - 1];
  const next = VETERAN_TIERS[rank];
  let damageBonus = 0;
  let attackSpeedBonus = 0;
  for (const candidate of VETERAN_TIERS) {
    if (candidate.rank > rank) break;
    damageBonus += candidate.damageBonus;
    attackSpeedBonus += candidate.attackSpeedBonus;
  }
  return {
    rank,
    label: tier?.label ?? "Veteran",
    damage,
    next: next ? { rank: next.rank, label: next.label, requiredDamage: next.requiredDamage } : undefined,
    damageBonus,
    attackSpeedBonus,
    damageMultiplier: 1 + damageBonus,
    attackSpeedMultiplier: 1 + attackSpeedBonus,
  };
}

export function getVeteranDamageMultiplier(factionId: FactionId, tower: Pick<Tower, "combatStats">): number {
  return getVeteranProgress(factionId, tower).damageMultiplier;
}

export function getVeteranAttackSpeedMultiplier(factionId: FactionId, tower: Pick<Tower, "combatStats">): number {
  return getVeteranProgress(factionId, tower).attackSpeedMultiplier;
}

/** Owns the event-driven Living Maze influence cache and lightweight enemy exposure state. */
export class FactionBonusSystem {
  private readonly influencedPathCells = new Set<string>();
  private readonly treantInfluencedPathCells = new Set<string>();

  constructor(readonly factionId: FactionId) {}

  rebuildLivingMazeInfluence(towers: readonly Pick<Tower, "cell" | "type">[], paths: readonly Cell[][]): void {
    this.influencedPathCells.clear();
    this.treantInfluencedPathCells.clear();
    if (this.factionId !== FACTION_BONUS_CONFIG.ancientGroveId) return;
    const groveTowers = towers;
    const treants = towers.filter((tower) => tower.type === "treant");
    for (const path of paths) {
      for (const cell of path) {
        if (groveTowers.some((tower) => Math.max(Math.abs(tower.cell.x - cell.x), Math.abs(tower.cell.y - cell.y))
          <= FACTION_BONUS_CONFIG.livingMaze.influenceRangeCells)) {
          this.influencedPathCells.add(cellKey(cell));
        }
        if (treants.some((tower) => Math.max(Math.abs(tower.cell.x - cell.x), Math.abs(tower.cell.y - cell.y))
          <= FACTION_BONUS_CONFIG.livingMaze.influenceRangeCells)) this.treantInfluencedPathCells.add(cellKey(cell));
      }
    }
  }

  isLivingMazeInfluenced(cell: Cell): boolean {
    return this.influencedPathCells.has(cellKey(cell));
  }

  isTreantInfluenced(cell: Cell): boolean { return this.treantInfluencedPathCells.has(cellKey(cell)); }

  getTreantLevelAt(cell: Cell, towers: readonly Pick<Tower, "cell" | "type" | "level">[], includeOffPathCell = false): number {
    if (this.factionId !== FACTION_BONUS_CONFIG.ancientGroveId || (!includeOffPathCell && !this.isTreantInfluenced(cell))) return 0;
    return towers.reduce((highest, tower) => tower.type === "treant"
      && Math.max(Math.abs(tower.cell.x - cell.x), Math.abs(tower.cell.y - cell.y)) <= FACTION_BONUS_CONFIG.livingMaze.influenceRangeCells
      ? Math.max(highest, tower.level) : highest, 0);
  }

  getLivingMazeInfluencedCells(): Cell[] {
    return [...this.influencedPathCells].map((key) => {
      const [x, y] = key.split(",").map(Number);
      return { x, y };
    });
  }

  updateLivingMazeExposure(enemy: Enemy, deltaSeconds: number, allowFlying = false, currentCell?: Cell): void {
    if (this.factionId !== FACTION_BONUS_CONFIG.ancientGroveId || (enemy.movementType !== "ground" && !allowFlying)) {
      enemy.livingMazeExposureSeconds = 0;
      return;
    }
    const occupiedCell = currentCell ?? enemy.path[enemy.currentPathIndex];
    if (!occupiedCell || !this.isLivingMazeInfluenced(occupiedCell)) {
      enemy.livingMazeExposureSeconds = 0;
      return;
    }
    enemy.livingMazeExposureSeconds += Math.max(0, deltaSeconds);
  }

  getLivingMazeSlowMultiplier(enemy: Pick<Enemy, "movementType" | "combatClass" | "livingMazeExposureSeconds">,
    slowStrengthMultiplier = 1, allowFlying = false): number {
    if (this.factionId !== FACTION_BONUS_CONFIG.ancientGroveId || (enemy.movementType !== "ground" && !allowFlying)) return 1;
    const stage = [...FACTION_BONUS_CONFIG.livingMaze.exposureStages].reverse()
      .find((candidate) => enemy.livingMazeExposureSeconds >= candidate.seconds);
    if (!stage) return 1;
    const rawSlow = 1 - stage.slowMultiplier;
    const bossFactor = enemy.combatClass === "boss" ? FACTION_BONUS_CONFIG.livingMaze.bossResistanceMultiplier : 1;
    return 1 - Math.min(FACTION_BONUS_CONFIG.livingMaze.maxSlow * slowStrengthMultiplier,
      rawSlow * bossFactor * slowStrengthMultiplier);
  }
}

