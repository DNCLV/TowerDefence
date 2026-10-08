/** Ten-wave campaign HP multipliers through the current finale. */
export const ENEMY_HP_TIER_MULTIPLIERS = [1, 2, 4, 8, 12] as const;

export const ENEMY_HP_TIER_WAVE_COUNT = 10;

/** Free Play grows linearly by four points per ten-wave tier. */
export function getConfiguredEnemyHpMultiplier(tier: number): number {
  if (tier < ENEMY_HP_TIER_MULTIPLIERS.length) return ENEMY_HP_TIER_MULTIPLIERS[tier];
  return ENEMY_HP_TIER_MULTIPLIERS[ENEMY_HP_TIER_MULTIPLIERS.length - 1] + (tier - ENEMY_HP_TIER_MULTIPLIERS.length + 1) * 4;
}
