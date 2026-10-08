import { AFFIXES, AFFIX_ELIGIBILITY, AFFIX_IDS } from "../config/EnemyAffixConfig";
import type { AffixMilestoneWarning, AffixTier, DamageType, EnemyAffix, EnemyAffixId } from "../config/EnemyAffixConfig";
import type { Enemy } from "./Enemy";

const tierForWave = (wave: number): AffixTier => wave >= 45 ? 3 : wave >= 30 ? 2 : wave >= 15 ? 1 : 0 as AffixTier;
const tierLabel: Record<AffixTier, string> = { 1: "THE HORDE MUTATES", 2: "THE HORDE EVOLVES", 3: "THE HORDE ASCENDS" };

/** Run-scoped PRNG and rolled affix progression. Seeds can be supplied for deterministic tests. */
export class EnemyAffixSystem {
  private randomState: number;
  private readonly rolledByTier: Partial<Record<AffixTier, EnemyAffixId[]>> = {};

  constructor(seed = createRunSeed()) { this.randomState = seed >>> 0 || 1; }

  reset(seed = createRunSeed()): void {
    this.randomState = seed >>> 0 || 1;
    delete this.rolledByTier[1]; delete this.rolledByTier[2]; delete this.rolledByTier[3];
  }

  rollMilestone(wave: number): AffixMilestoneWarning | undefined {
    const tier = tierForWave(wave);
    if (!tier || wave !== tier * 15) return undefined;
    const alreadyRolled = Object.values(this.rolledByTier).flatMap((values) => values ?? []);
    const pool = AFFIX_IDS.filter((id) => !alreadyRolled.includes(id));
    const rolled: EnemyAffixId[] = [];
    while (rolled.length < 2 && pool.length > 0) rolled.push(pool.splice(this.randomIndex(pool.length), 1)[0]);
    this.rolledByTier[tier] = rolled;
    return { tier, wave, title: tierLabel[tier], affixes: [...rolled] };
  }

  assign(enemy: Enemy, wave: number): void {
    const tier = tierForWave(wave);
    if (!tier || !AFFIX_ELIGIBILITY.eligibleCombatClasses.includes(enemy.combatClass)
      || AFFIX_ELIGIBILITY.excludedTypes.includes(enemy.type)) return;
    const chance = tier === 1 ? AFFIX_ELIGIBILITY.tier1Chance : tier === 2 ? AFFIX_ELIGIBILITY.tier2Chance : AFFIX_ELIGIBILITY.tier3Chance;
    if (this.next() >= chance) return;
    const available = Object.values(this.rolledByTier).flatMap((values) => values ?? []);
    if (available.length === 0) return;
    const doubleChance = tier === 1 ? 0 : tier === 2 ? AFFIX_ELIGIBILITY.tier2DoubleChance : AFFIX_ELIGIBILITY.tier3DoubleChance;
    const count = Math.min(available.length, this.next() < doubleChance ? 2 : 1);
    const candidates = [...available];
    const affixes: EnemyAffix[] = [];
    for (let index = 0; index < count; index += 1) affixes.push({ id: candidates.splice(this.randomIndex(candidates.length), 1)[0], tier });
    applyEnemyAffixes(enemy, affixes);
  }

  getProgression(): Readonly<Partial<Record<AffixTier, readonly EnemyAffixId[]>>> {
    return { 1: this.rolledByTier[1], 2: this.rolledByTier[2], 3: this.rolledByTier[3] };
  }

  private randomIndex(length: number): number { return Math.floor(this.next() * length); }
  private next(): number {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 0x100000000;
  }
}

export function applyEnemyAffixes(enemy: Enemy, affixes: EnemyAffix[]): void {
  enemy.affixes = affixes;
  const fortified = affixes.find(({ id }) => id === "fortified");
  if (fortified) {
    const hpMultiplier = 1 + AFFIXES.fortified.values[fortified.tier];
    enemy.maxHp = Math.round(enemy.maxHp * hpMultiplier);
    enemy.hp = enemy.maxHp;
  }
  const shielded = affixes.find(({ id }) => id === "shielded");
  enemy.maxShield = shielded ? Math.round(enemy.maxHp * AFFIXES.shielded.values[shielded.tier]) : 0;
  enemy.shield = enemy.maxShield;
}

export function getEnemyDamageMultiplier(enemy: Enemy, damageType: DamageType, resistancePenetration = 0): number {
  const id = damageType === "physical" ? "armored" : "arcane-ward";
  const affix = enemy.affixes.find((candidate) => candidate.id === id);
  const resistance = affix ? AFFIXES[id].values[affix.tier] : 0;
  return 1 - resistance * (1 - Math.max(0, Math.min(1, resistancePenetration)));
}

export function applyEnemySlow(enemy: Enemy, multiplier: number, durationSeconds: number): void {
  enemy.slowMultiplier = Math.min(enemy.slowMultiplier, multiplier);
  enemy.slowSecondsRemaining = Math.max(enemy.slowSecondsRemaining, durationSeconds);
}

export function updateEnemyAffixes(enemy: Enemy, deltaSeconds: number): void {
  enemy.slowSecondsRemaining = Math.max(0, enemy.slowSecondsRemaining - deltaSeconds);
  if (enemy.slowSecondsRemaining === 0) enemy.slowMultiplier = 1;
  const regenDelayAtStart = enemy.regenDelayRemaining;
  enemy.regenDelayRemaining = Math.max(0, regenDelayAtStart - deltaSeconds);
  const regenerator = enemy.affixes.find(({ id }) => id === "regenerator");
  const regenSeconds = Math.max(0, deltaSeconds - regenDelayAtStart);
  if (regenerator && regenSeconds > 0 && enemy.hp > 0) {
    enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.maxHp * AFFIXES.regenerator.values[regenerator.tier] * regenSeconds);
  }
}

export function getCommanderAuraMultiplier(enemy: Enemy, nearbyEnemies: readonly Enemy[]): number {
  let bonus = 0;
  for (const commander of nearbyEnemies) {
    if (commander === enemy || !commander.alive) continue;
    const affix = commander.affixes.find(({ id }) => id === "commander");
    if (!affix) continue;
    if (Math.hypot(commander.x - enemy.x, commander.y - enemy.y) <= AFFIX_ELIGIBILITY.commanderAuraRadiusCells) {
      bonus = Math.max(bonus, AFFIXES.commander.values[affix.tier]);
    }
  }
  return 1 + bonus;
}

export function getEnemySpeedMultiplier(enemy: Enemy): number {
  let multiplier = enemy.slowMultiplier;
  const swift = enemy.affixes.find(({ id }) => id === "swift");
  if (swift) multiplier *= 1 + AFFIXES.swift.values[swift.tier];
  const frenzied = enemy.affixes.find(({ id }) => id === "frenzied");
  if (frenzied && enemy.hp / enemy.maxHp < 0.35) multiplier *= 1 + AFFIXES.frenzied.values[frenzied.tier];
  return multiplier;
}

export function createRunSeed(): number {
  return ((Math.random() * 0xffffffff) ^ Date.now()) >>> 0 || 1;
}
