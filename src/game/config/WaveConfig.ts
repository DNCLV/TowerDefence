import { ENEMY_CONFIG } from "./EnemyConfig";
import type { EnemyType } from "./EnemyConfig";

export interface WaveEntry {
  type: EnemyType;
  count: number;
}

export interface WaveComposition {
  wave: number;
  entries: WaveEntry[];
  spawnInterval?: number;
  /** Base threat assigned to the normal mix; Giants are an additional event threat. */
  threatBudget?: number;
  totalThreat: number;
  rewardMultiplier: number;
}

export const ENEMY_THREAT_WEIGHT: Record<EnemyType, number> = Object.fromEntries(
  Object.values(ENEMY_CONFIG).map(({ id, threatWeight }) => [id, threatWeight]),
) as Record<EnemyType, number>;

/** High-poly GLBs are staggered per active spawn so multi-front maps can flood fairly. */
export const MAX_ACTIVE_WAVE_ENEMIES = 16;

const FIXED_WAVES: Record<number, readonly WaveEntry[]> = {
  1: [{ type: "goblin", count: 12 }],
  2: [{ type: "goblin", count: 16 }],
  3: [{ type: "goblin", count: 14 }, { type: "goblinBrute", count: 2 }],
  4: [{ type: "goblin", count: 18 }, { type: "goblinBrute", count: 2 }],
  5: [{ type: "goblin", count: 14 }, { type: "goblinBrute", count: 4 }],
  6: [{ type: "goblin", count: 20 }, { type: "goblinBrute", count: 4 }],
  7: [{ type: "goblinRider", count: 12 }],
  8: [{ type: "goblin", count: 16 }, { type: "goblinBrute", count: 4 }, { type: "goblinRider", count: 2 }],
  9: [{ type: "goblin", count: 18 }, { type: "goblinBrute", count: 5 }, { type: "goblinRider", count: 3 }],
  10: [{ type: "goblin", count: 14 }, { type: "goblinBrute", count: 4 }, { type: "giantGoblin", count: 1 }],
  11: [{ type: "goblin", count: 22 }, { type: "goblinBrute", count: 5 }, { type: "goblinRider", count: 4 }],
  12: [{ type: "goblin", count: 18 }, { type: "goblinBrute", count: 7 }, { type: "goblinRider", count: 4 }],
  13: [{ type: "goblin", count: 24 }, { type: "goblinBrute", count: 6 }, { type: "goblinRider", count: 5 }],
  14: [{ type: "goblinRider", count: 18 }],
  15: [{ type: "goblin", count: 20 }, { type: "goblinBrute", count: 8 }, { type: "goblinRider", count: 5 }],
  16: [{ type: "goblin", count: 24 }, { type: "goblinBrute", count: 8 }, { type: "goblinRider", count: 6 }],
  17: [{ type: "goblin", count: 18 }, { type: "goblinBrute", count: 10 }, { type: "goblinRider", count: 7 }],
  18: [{ type: "goblin", count: 26 }, { type: "goblinBrute", count: 9 }, { type: "goblinRider", count: 8 }],
  19: [{ type: "goblin", count: 20 }, { type: "goblinBrute", count: 12 }, { type: "goblinRider", count: 8 }],
  20: [{ type: "goblin", count: 18 }, { type: "goblinBrute", count: 8 }, { type: "goblinRider", count: 4 }, { type: "giantGoblin", count: 2 }],
  25: [{ type: "goblin", count: 10 }, { type: "goblinBrute", count: 4 }, { type: "ghoul", count: 6 }, { type: "wraith", count: 3 }],
  26: [{ type: "goblin", count: 8 }, { type: "goblinBrute", count: 5 }, { type: "ghoul", count: 8 }, { type: "wraith", count: 4 }, { type: "goblinRider", count: 3 }],
  27: [{ type: "goblin", count: 6 }, { type: "goblinBrute", count: 4 }, { type: "ghoul", count: 10 }, { type: "wraith", count: 6 }],
};

const SPAWN_INTERVAL_MILESTONES = [
  { wave: 1, seconds: 0.50 },
  { wave: 30, seconds: 0.40 },
  { wave: 60, seconds: 0.32 },
  { wave: 100, seconds: 0.26 },
  { wave: 150, seconds: 0.22 },
] as const;
export const MIN_SPAWN_INTERVAL = 0.22;

export function getWaveSpawnInterval(wave: number): number {
  const target = Math.max(1, wave);
  for (let index = 1; index < SPAWN_INTERVAL_MILESTONES.length; index += 1) {
    const next = SPAWN_INTERVAL_MILESTONES[index];
    if (target <= next.wave) {
      const previous = SPAWN_INTERVAL_MILESTONES[index - 1];
      const progress = (target - previous.wave) / (next.wave - previous.wave);
      return Math.max(MIN_SPAWN_INTERVAL, previous.seconds + (next.seconds - previous.seconds) * progress);
    }
  }
  return MIN_SPAWN_INTERVAL;
}

export function getWaveThreatBudget(wave: number): number {
  return wave <= 20 ? 0 : 35 + (wave - 20) * 3.2;
}

export function getWaveRewardMultiplier(wave: number): number {
  if (wave <= 30) return 1;
  if (wave <= 60) return 0.75;
  if (wave <= 100) return 0.5;
  return 0.35;
}

/** Compresses the payout, not the archetype's base gold value. */
export function getWaveGoldReward(baseReward: number, wave: number): number {
  if (baseReward <= 0) return 0;
  return Math.max(1, Math.round(baseReward * getWaveRewardMultiplier(wave)));
}

function getThreatShares(wave: number): Record<EnemyType, number> {
  if (wave < 29) {
    // New archetypes are introduced by the fixed wave 25-27 set, then enter
    // generated mixes after the flying-focused wave 28.
    return { goblin: 0.5, goblinBrute: 0.35, goblinRider: 0.15, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 0, skeletonKing: 0, skeletalCommander: 0 };
  }
  let legacy: Pick<Record<EnemyType, number>, "goblin" | "goblinBrute" | "goblinRider">;
  let ghoul: number;
  let wraith: number;
  if (wave <= 40) {
    legacy = { goblin: 0.5, goblinBrute: 0.35, goblinRider: 0.15 };
    ghoul = 0.20;
    wraith = 0.075;
  } else if (wave <= 70) {
    legacy = { goblin: 0.35, goblinBrute: 0.45, goblinRider: 0.2 };
    ghoul = 0.25;
    wraith = 0.125;
  } else {
    legacy = wave <= 100
      ? { goblin: 0.25, goblinBrute: 0.5, goblinRider: 0.25 }
      : { goblin: 0.15, goblinBrute: 0.55, goblinRider: 0.3 };
    ghoul = 0.25;
    wraith = 0.175;
  }
  const legacyShare = 1 - ghoul - wraith;
  return {
    goblin: legacy.goblin * legacyShare,
    goblinBrute: legacy.goblinBrute * legacyShare,
    goblinRider: legacy.goblinRider * legacyShare,
    giantGoblin: 0,
    ghoul,
    wraith,
    undeadDragon: 0,
    skeletonKing: 0,
    skeletalCommander: 0,
  };
}

/** Converts target threat shares into deterministic, rounded unit counts. */
function createBudgetMix(wave: number, budget: number): WaveEntry[] {
  const shares = getThreatShares(wave);
  const entries: WaveEntry[] = [
    { type: "goblin", count: Math.round(budget * shares.goblin / ENEMY_THREAT_WEIGHT.goblin) },
    { type: "goblinBrute", count: Math.round(budget * shares.goblinBrute / ENEMY_THREAT_WEIGHT.goblinBrute) },
    { type: "goblinRider", count: Math.round(budget * shares.goblinRider / ENEMY_THREAT_WEIGHT.goblinRider) },
    { type: "ghoul", count: Math.round(budget * shares.ghoul / ENEMY_THREAT_WEIGHT.ghoul) },
    { type: "wraith", count: Math.round(budget * shares.wraith / ENEMY_THREAT_WEIGHT.wraith) },
  ];
  return entries.filter((entry) => entry.count > 0);
}

function flyingWaveRiderCount(wave: number): number {
  const flyingWave = wave / 7;
  if (flyingWave <= 2) return 12 + (flyingWave - 1) * 6;
  if (flyingWave <= 4) return 18 + (flyingWave - 2) * 8;
  return 34 + (flyingWave - 4) * 9;
}

function generatedComposition(wave: number): { entries: WaveEntry[]; threatBudget?: number } {
  // The milestone boss replaces the normal/Giant event wave entirely.
  if (wave === 50) return { entries: [{ type: "skeletonKing", count: 1 }] };

  const giantCount = wave % 10 === 0 ? wave / 10 : 0;
  if (wave % 7 === 0) {
    // Flying waves stay pure; at a 7/10 collision the Giant event stacks on top.
    if (wave >= 35) {
      const flyingWave = wave / 7;
      const riderCount = wave === 35 ? 20 : 24 + Math.max(0, flyingWave - 5) * 6;
      const dragonCount = 4 + Math.floor(Math.max(0, flyingWave - 5) / 2);
      const commanderCount = wave <= 49
        ? 1 + Math.floor((wave - 35) / 7)
        : 3 + Math.floor((wave - 49) / 14);
      return { entries: [
        { type: "goblinRider", count: Math.floor(riderCount) },
        { type: "undeadDragon", count: dragonCount },
        ...(commanderCount > 0 ? [{ type: "skeletalCommander" as const, count: commanderCount }] : []),
        ...(giantCount > 0 ? [{ type: "giantGoblin" as const, count: giantCount }] : []),
      ] };
    }
    return { entries: [
      { type: "goblinRider", count: flyingWaveRiderCount(wave) },
      ...(giantCount > 0 ? [{ type: "giantGoblin" as const, count: giantCount }] : []),
    ] };
  }

  // Normal compositions use a growing budget. On Giant waves this is the escort
  // budget; event Giants are then added without consuming escort pressure.
  const threatBudget = getWaveThreatBudget(wave);
  const dragonIntroduction = wave === 32 ? 2 : 0;
  const normalBudget = Math.max(0, threatBudget - dragonIntroduction * ENEMY_THREAT_WEIGHT.undeadDragon);
  return { entries: [
    ...createBudgetMix(wave, normalBudget),
    ...(dragonIntroduction > 0 ? [{ type: "undeadDragon" as const, count: dragonIntroduction }] : []),
    ...(giantCount > 0 ? [{ type: "giantGoblin" as const, count: giantCount }] : []),
  ], threatBudget };
}

export function getCompositionThreat(entries: readonly WaveEntry[]): number {
  return entries.reduce((total, entry) => total + entry.count * ENEMY_THREAT_WEIGHT[entry.type], 0);
}

export function getWaveComposition(wave: number): WaveComposition {
  if (!Number.isInteger(wave) || wave < 1) throw new RangeError("Wave number must be a positive integer.");
  const generated = FIXED_WAVES[wave] ? { entries: FIXED_WAVES[wave] } : generatedComposition(wave);
  const entries = generated.entries.map((entry) => ({ ...entry }));
  return {
    wave,
    entries,
    spawnInterval: getWaveSpawnInterval(wave),
    threatBudget: "threatBudget" in generated ? generated.threatBudget : undefined,
    totalThreat: getCompositionThreat(entries),
    rewardMultiplier: getWaveRewardMultiplier(wave),
  };
}

/** Interleave standard archetypes deterministically; giants arrive after the main mix for pacing. */
export function createWaveSpawnQueue(composition: WaveComposition): EnemyType[] {
  const regularEntries = composition.entries.filter((entry) => entry.type !== "giantGoblin");
  const giantCount = composition.entries.find((entry) => entry.type === "giantGoblin")?.count ?? 0;
  const queue: EnemyType[] = [];
  const counts = new Map(regularEntries.map((entry) => [entry.type, entry.count]));
  const maxCount = Math.max(0, ...regularEntries.map((entry) => entry.count));
  for (let round = 0; round < maxCount; round += 1) {
    for (const entry of regularEntries) {
      if (round < (counts.get(entry.type) ?? 0)) queue.push(entry.type);
    }
  }
  for (let index = 0; index < giantCount; index += 1) queue.push("giantGoblin");
  return queue;
}

export function countWaveComposition(composition: WaveComposition): Record<EnemyType, number> {
  return composition.entries.reduce((counts, entry) => {
    counts[entry.type] += entry.count;
    return counts;
    }, { goblin: 0, goblinBrute: 0, goblinRider: 0, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 0, skeletonKing: 0, skeletalCommander: 0 });
}
