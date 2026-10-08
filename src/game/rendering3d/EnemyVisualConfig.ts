import type { EnemyType } from "../config/EnemyConfig";

export interface EnemyVisualDefinition {
  /** Decimated runtime GLB generated from the untouched source under 3D/. */
  assetPath: string;
  /** Previous working runtime asset, used if the optimized file cannot load. */
  fallbackAssetPath: string;
  /** Uniform model scale, based on the measured source GLB bounds. */
  scale: number;
  /** Presentation-only world-root lift for flying models. */
  yOffset: number;
  /** Per-model presentation correction after bounds normalization; Wraith intentionally hovers. */
  groundOffsetY: number;
  /** Applied below the world root so movement-facing rotation remains independent. */
  rotationY: number;
  /** HP bar position above the model, relative to the enemy world root. */
  hpBarOffsetY: number;
  /** Reject corrupted or unexpectedly transformed assets per archetype. */
  maxDimension: number;
  sourceDimensions: { width: number; height: number; depth: number };
}

/** Central source for paths and presentation transforms for enemy GLBs. */
export const ENEMY_VISUAL_CONFIG: Record<EnemyType, EnemyVisualDefinition> = {
  goblin: {
    assetPath: "/assets/models/enemies/optimized/goblin.glb",
    fallbackAssetPath: "/assets/models/enemies/goblin.glb",
    scale: 0.82, yOffset: 0, groundOffsetY: -0.12, rotationY: 0, hpBarOffsetY: 1.76, maxDimension: 3,
    sourceDimensions: { width: 1.7771, height: 1.8966, depth: 1.2408 },
  },
  goblinBrute: {
    assetPath: "/assets/models/enemies/optimized/goblin-brute.glb",
    fallbackAssetPath: "/assets/models/enemies/goblin-brute.glb",
    scale: 1.18, yOffset: 0, groundOffsetY: -0.02, rotationY: 0, hpBarOffsetY: 2.46, maxDimension: 4,
    sourceDimensions: { width: 1.5546, height: 1.8966, depth: 1.2712 },
  },
  goblinRider: {
    assetPath: "/assets/models/enemies/optimized/goblin-rider.glb",
    fallbackAssetPath: "/assets/models/enemies/goblin-rider.glb",
    scale: 1.9, yOffset: 1.15, groundOffsetY: 0, rotationY: 0, hpBarOffsetY: 2.62, maxDimension: 5,
    sourceDimensions: { width: 1.8769, height: 1.2759, depth: 1.8967 },
  },
  giantGoblin: {
    assetPath: "/assets/models/enemies/optimized/giant-goblin.glb",
    fallbackAssetPath: "/assets/models/enemies/giant-goblin.glb",
    scale: 1.18, yOffset: 0, groundOffsetY: 0, rotationY: 0, hpBarOffsetY: 2.45, maxDimension: 4,
    sourceDimensions: { width: 1.3279, height: 1.8980, depth: 1.0538 },
  },
  ghoul: {
    assetPath: "/assets/models/enemies/optimized/ghoul.glb",
    fallbackAssetPath: "/assets/models/enemies/ghoul.glb",
    scale: 1, yOffset: 0, groundOffsetY: -0.02, rotationY: 0, hpBarOffsetY: 2.02, maxDimension: 3,
    sourceDimensions: { width: 1.7361, height: 1.8797, depth: 1.2545 },
  },
  wraith: {
    assetPath: "/assets/models/enemies/optimized/wraith.glb",
    fallbackAssetPath: "/assets/models/enemies/wraith.glb",
    scale: 1.15, yOffset: 0, groundOffsetY: 0.15, rotationY: 0, hpBarOffsetY: 2.08, maxDimension: 3,
    sourceDimensions: { width: 1.7698, height: 1.5229, depth: 1.0969 },
  },
  undeadDragon: {
    assetPath: "/assets/models/enemies/optimized/undead-dragon.glb",
    fallbackAssetPath: "/assets/models/enemies/undead-dragon.glb",
    scale: 2.35, yOffset: 1.65, groundOffsetY: 0, rotationY: 0, hpBarOffsetY: 4.25, maxDimension: 5.5,
    sourceDimensions: { width: 1.7987, height: 1.3746, depth: 1.8359 },
  },
  skeletonKing: {
    assetPath: "/assets/models/enemies/optimized/skeleton-king.glb",
    fallbackAssetPath: "/assets/models/enemies/skeleton-king.glb",
    scale: 3.5, yOffset: 0, groundOffsetY: -0.02, rotationY: 0, hpBarOffsetY: 7.05, maxDimension: 7.2,
    sourceDimensions: { width: 1.4974, height: 1.8992, depth: 1.4621 },
  },
  skeletalCommander: {
    assetPath: "/assets/models/enemies/optimized/skeletal-commander.glb",
    fallbackAssetPath: "/assets/models/enemies/skeletal-commander.glb",
    scale: 2.35, yOffset: 2.0, groundOffsetY: 0, rotationY: 0, hpBarOffsetY: 5.8, maxDimension: 7,
    sourceDimensions: { width: 1.89965, height: 1.47563, depth: 1.44277 },
  },
};
