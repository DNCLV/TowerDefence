/** Ten-wave HP multipliers through wave 50; later tiers retain exponential doubling. */
export const ENEMY_HP_TIER_MULTIPLIERS = [1, 2, 4, 8, 12] as const;

export const ENEMY_HP_TIER_WAVE_COUNT = 10;

/** Preserve the former 2^tier progression from wave 51 onward (32x, 64x, ...). */
export function getConfiguredEnemyHpMultiplier(tier: number): number {
  return ENEMY_HP_TIER_MULTIPLIERS[tier] ?? Math.pow(2, tier);
}
