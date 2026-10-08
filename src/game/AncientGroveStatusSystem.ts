import { FACTION_BONUS_CONFIG } from "./config/FactionBonusConfig";
import type { Enemy } from "./enemies/Enemy";

/** Portable Ancient Grove status timers. All values are simulation seconds. */
export class AncientGroveStatusSystem {
  updateEnemy(enemy: Enemy, deltaSeconds: number, treantLevel: number): void {
    const dt = Math.max(0, deltaSeconds);
    this.updateThornRot(enemy, dt, enemy.movementType === "ground" ? treantLevel : 0);
    this.updateSunbrand(enemy, dt);
  }

  applySunbrandHit(enemy: Enemy): boolean {
    const config = FACTION_BONUS_CONFIG.sunbrand;
    const detonates = enemy.sunbrandStacks >= config.maxStacks;
    enemy.sunbrandStacks = Math.min(config.maxStacks, enemy.sunbrandStacks + 1);
    enemy.sunbrandGraceSecondsRemaining = config.graceSeconds;
    enemy.sunbrandDecayTimer = 0;
    return detonates;
  }

  clearEnemy(enemy: Enemy): void {
    enemy.thornRotStacks = 0;
    enemy.thornRotStackTimer = 0;
    enemy.thornRotOutsideSeconds = 0;
    enemy.thornRotSourceLevel = 0;
    enemy.thornRotDamageRemainder = 0;
    enemy.sunbrandStacks = 0;
    enemy.sunbrandGraceSecondsRemaining = 0;
    enemy.sunbrandDecayTimer = 0;
    enemy.sunbrandDamageRemainder = 0;
  }

  private updateThornRot(enemy: Enemy, dt: number, treantLevel: number): void {
    const config = FACTION_BONUS_CONFIG.thornRot;
    if (treantLevel > 0) {
      enemy.thornRotSourceLevel = treantLevel;
      enemy.thornRotOutsideSeconds = 0;
      if (enemy.thornRotStacks < config.maxStacks[treantLevel as 1 | 2 | 3]) {
        enemy.thornRotStackTimer += dt;
        while (enemy.thornRotStackTimer >= config.stackIntervalSeconds
          && enemy.thornRotStacks < config.maxStacks[treantLevel as 1 | 2 | 3]) {
          enemy.thornRotStackTimer -= config.stackIntervalSeconds;
          enemy.thornRotStacks += 1;
        }
      } else enemy.thornRotStackTimer = 0;
      return;
    }
    enemy.thornRotStackTimer = 0;
    if (enemy.thornRotStacks <= 0) { enemy.thornRotOutsideSeconds = 0; return; }
    enemy.thornRotOutsideSeconds += dt;
    if (enemy.thornRotOutsideSeconds >= config.outsideGraceSeconds) {
      enemy.thornRotStacks = 0;
      enemy.thornRotOutsideSeconds = 0;
      enemy.thornRotSourceLevel = 0;
    }
  }

  private updateSunbrand(enemy: Enemy, dt: number): void {
    const config = FACTION_BONUS_CONFIG.sunbrand;
    if (enemy.sunbrandStacks <= 0 || dt <= 0) return;
    let decayTime = dt;
    if (enemy.sunbrandGraceSecondsRemaining > 0) {
      const graceUsed = Math.min(decayTime, enemy.sunbrandGraceSecondsRemaining);
      enemy.sunbrandGraceSecondsRemaining -= graceUsed;
      decayTime -= graceUsed;
    }
    if (decayTime <= 0) return;
    enemy.sunbrandDecayTimer += decayTime;
    while (enemy.sunbrandDecayTimer >= config.decayIntervalSeconds && enemy.sunbrandStacks > 0) {
      enemy.sunbrandDecayTimer -= config.decayIntervalSeconds;
      enemy.sunbrandStacks -= 1;
    }
    if (enemy.sunbrandStacks === 0) {
      enemy.sunbrandGraceSecondsRemaining = 0;
      enemy.sunbrandDecayTimer = 0;
    }
  }
}

export function getThornRotDamage(enemy: Pick<Enemy, "thornRotStacks">, treantLevel: number): number {
  if (treantLevel < 1 || enemy.thornRotStacks < 1) return 0;
  const config = FACTION_BONUS_CONFIG.thornRot;
  return enemy.thornRotStacks * config.damagePerStackPerSecond[treantLevel as 1 | 2 | 3];
}

export function getSunbrandDamage(enemy: Pick<Enemy, "sunbrandStacks">): number {
  return enemy.sunbrandStacks * FACTION_BONUS_CONFIG.sunbrand.damagePerStackPerSecond;
}

/** Lower numbers are acquired first: restore 3 stacks, then seed/maintain 0/2/1, then detonate at 4. */
export function getSunbrandTargetPriority(stacks: number): number {
  return ({ 3: 0, 0: 1, 2: 2, 1: 3, 4: 4 } as Record<number, number>)[stacks] ?? 5;
}
