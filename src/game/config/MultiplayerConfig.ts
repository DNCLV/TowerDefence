export interface MultiplayerScaling {
  enemyHpMultiplier: number;
  spawnPacingMultiplier: number;
  rewardMultiplier: number;
}

const PLAYER_COUNT_SCALING: Record<number, MultiplayerScaling> = {
  1: { enemyHpMultiplier: 1, spawnPacingMultiplier: 1, rewardMultiplier: 1 },
  2: { enemyHpMultiplier: 1, spawnPacingMultiplier: 1, rewardMultiplier: 1 },
};

/** Central Phase 1 tuning hooks; networking can later negotiate these values. */
export const MULTIPLAYER_CONFIG = {
  goalSwitchMinimumSavings: 4,
  rewardPolicy: "equal-split" as const,
  playerCountScaling: PLAYER_COUNT_SCALING,
} as const;
