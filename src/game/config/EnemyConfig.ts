export type EnemyType = "goblin" | "goblinBrute" | "goblinRider" | "giantGoblin" | "ghoul" | "wraith" | "undeadDragon" | "skeletonKing" | "skeletalCommander";
export type EnemyMovementType = "ground" | "flying";
export type EnemyCombatClass = "fodder" | "tank" | "boss";

export interface EnemyTypeConfig {
  id: EnemyType;
  name: string;
  hp: number;
  speedMultiplier: number;
  goldReward: number;
  livesDamage: number;
  movementType: EnemyMovementType;
  combatClass: EnemyCombatClass;
  threatWeight: number;
  boss?: boolean;
}

/** All archetype stats live here. Speed multipliers use one shared world-speed base. */
export const ENEMY_BASE_SPEED_WORLD_PER_SECOND = 90;

export const ENEMY_CONFIG: Record<EnemyType, EnemyTypeConfig> = {
  goblin: { id: "goblin", name: "Goblin", hp: 150, speedMultiplier: 1.05, goldReward: 1, livesDamage: 1, movementType: "ground", combatClass: "fodder", threatWeight: 1 },
  goblinBrute: { id: "goblinBrute", name: "Goblin Brute", hp: 550, speedMultiplier: 0.72, goldReward: 3, livesDamage: 1, movementType: "ground", combatClass: "tank", threatWeight: 4 },
  goblinRider: { id: "goblinRider", name: "Goblin Rider", hp: 160, speedMultiplier: 1.2, goldReward: 2, livesDamage: 1, movementType: "flying", combatClass: "fodder", threatWeight: 3 },
  giantGoblin: { id: "giantGoblin", name: "Giant Goblin", hp: 3000, speedMultiplier: 0.42, goldReward: 10, livesDamage: 3, movementType: "ground", combatClass: "tank", threatWeight: 18 },
  ghoul: { id: "ghoul", name: "Ghoul", hp: 450, speedMultiplier: 0.95, goldReward: 3, livesDamage: 1, movementType: "ground", combatClass: "fodder", threatWeight: 3 },
  wraith: { id: "wraith", name: "Wraith", hp: 700, speedMultiplier: 1.6, goldReward: 5, livesDamage: 1, movementType: "ground", combatClass: "fodder", threatWeight: 7 },
  undeadDragon: { id: "undeadDragon", name: "Undead Dragon", hp: 480, speedMultiplier: 0.9, goldReward: 5, livesDamage: 2, movementType: "flying", combatClass: "tank", threatWeight: 6 },
  skeletonKing: { id: "skeletonKing", name: "Skeleton King", hp: 12000, speedMultiplier: 0.22, goldReward: 75, livesDamage: 10, movementType: "ground", combatClass: "boss", threatWeight: 0, boss: true },
  skeletalCommander: { id: "skeletalCommander", name: "Skeletal Commander", hp: 1400, speedMultiplier: 1, goldReward: 12, livesDamage: 4, movementType: "flying", combatClass: "boss", threatWeight: 14, boss: true },
};
