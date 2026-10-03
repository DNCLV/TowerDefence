/** Every first-pass balance lever lives here for quick playtest iteration. */
export const BALANCE = {
  startingGoldBySpawnCount: {
    1: 70,
    2: 70,
    3: 90,
    4: 115,
    5: 140,
  },
  startingLives: 10,
  towerLevelVisuals: {
    1: { color: 0x6d597a },
    2: { color: 0x277da1 },
    3: { color: 0xf4a261 },
  },
} as const;
