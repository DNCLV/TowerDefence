import type { DefenderType } from "../config/DefenderConfig";

export interface DefenderVisualDefinition {
  displayName: string;
  debugLabel: string;
  /** Optimized production GLB; configured for every 3D defender. */
  assetPath: string;
  fallbackAssetPath?: string;
  /** Vertical scale derived from the measured source GLB height. */
  modelScale: number;
  /** Per-defender presentation-only crowding adjustment, independent of gameplay geometry. */
  visualScaleMultiplier: number;
  /** Optional horizontal normalization to keep a model within one map cell. */
  modelScaleX?: number;
  modelScaleZ?: number;
  sourceBounds: { width: number; height: number; depth: number };
  targetVisualHeight: number;
  targetFootprint?: { width: number; depth: number };
  rotationY: number;
  /** Local height above the grounded tile; used by hovering defenders only. */
  hoverHeight?: number;
  primitiveFallback?: "wizard" | "knight" | "green-archer" | "battlemage" | "sovereign";
}

function normalizedVisual(
  sourceBounds: DefenderVisualDefinition["sourceBounds"],
  targetVisualHeight: number,
  targetFootprint?: { width: number; depth: number },
): Pick<DefenderVisualDefinition, "sourceBounds" | "targetVisualHeight" | "targetFootprint" | "modelScale" | "modelScaleX" | "modelScaleZ"> {
  return {
    sourceBounds,
    targetVisualHeight,
    targetFootprint,
    modelScale: targetVisualHeight / sourceBounds.height,
    modelScaleX: targetFootprint ? targetFootprint.width / sourceBounds.width : undefined,
    modelScaleZ: targetFootprint ? targetFootprint.depth / sourceBounds.depth : undefined,
  };
}

/** Measured bounds below are from the actual final runtime GLBs, in source model units. */
export const DEFENDER_VISUAL_CONFIG: Record<DefenderType, DefenderVisualDefinition> = {
  "blue-wizard": {
    displayName: "Blue Wizard", debugLabel: "WIZARD",
    assetPath: "/assets/models/defenders/optimized/blue-wizard.glb",
    fallbackAssetPath: "/assets/models/defenders/blue-wizard.glb",
    ...normalizedVisual({ width: 1.31395, height: 1.89845, depth: 1.08782 }, 1.89845 * (1.13 * 0.75)),
    visualScaleMultiplier: 0.9,
    rotationY: 0, primitiveFallback: "wizard",
  },
  "holy-knight": {
    displayName: "Holy Knight", debugLabel: "KNIGHT",
    assetPath: "/assets/models/defenders/optimized/holy-knight.glb",
    fallbackAssetPath: "/assets/models/defenders/holy-knight.glb",
    ...normalizedVisual({ width: 1.45042, height: 1.89834, depth: 1.10309 }, 1.89834 * (1.13 * 0.75)),
    visualScaleMultiplier: 0.85,
    rotationY: 0, primitiveFallback: "knight",
  },
  "green-archer": {
    displayName: "Green Archer", debugLabel: "ARCHER",
    assetPath: "/assets/models/defenders/optimized/green-archer.glb",
    fallbackAssetPath: "/assets/models/defenders/green-archer.glb",
    ...normalizedVisual({ width: 0.98466, height: 1.89733, depth: 0.84087 }, 1.518, { width: 0.8, depth: 0.8 }),
    visualScaleMultiplier: 0.95,
    rotationY: 0, primitiveFallback: "green-archer",
  },
  battlemage: {
    displayName: "Battlemage", debugLabel: "BATTLEMAGE",
    assetPath: "/assets/models/defenders/optimized/battlemage.glb",
    fallbackAssetPath: "/assets/models/defenders/battlemage.glb",
    ...normalizedVisual({ width: 1.44017, height: 1.89785, depth: 1.52045 }, 1.594, { width: 0.8, depth: 0.8 }),
    visualScaleMultiplier: 0.9,
    rotationY: 0, primitiveFallback: "battlemage",
  },
  sovereign: {
    displayName: "Sovereign", debugLabel: "SOVEREIGN",
    assetPath: "/assets/models/defenders/optimized/sovereign.glb",
    fallbackAssetPath: "/assets/models/defenders/sovereign.glb",
    ...normalizedVisual({ width: 1.27846, height: 1.89844, depth: 1.12448 }, 1.747, { width: 0.8, depth: 0.8 }),
    visualScaleMultiplier: 0.9,
    rotationY: 0, primitiveFallback: "sovereign",
  },
  "holy-emperor": {
    displayName: "Holy Emperor", debugLabel: "EMPEROR",
    assetPath: "/assets/models/defenders/optimized/holy-emperor.glb",
    fallbackAssetPath: "/assets/models/defenders/holy-emperor.glb",
    // Bounds include the source node transform; keep the wide model within one cell.
    ...normalizedVisual({ width: 2.04697, height: 2.32384, depth: 1.46094 }, 1.9, { width: 0.72, depth: 0.72 }),
    visualScaleMultiplier: 0.9,
    rotationY: 0,
  },
  // Measured from the source GLBs in 3D/. Runtime uses only the optimized copies.
  treant: {
    displayName: "Treant", debugLabel: "TREANT",
    assetPath: "/assets/models/defenders/optimized/treant.glb",
    ...normalizedVisual({ width: 1.5544, height: 1.8933, depth: 0.7753 }, 1.61, { width: 0.7, depth: 0.72 }),
    visualScaleMultiplier: 0.9, rotationY: 0,
  },
  "thorn-owl": {
    displayName: "Thorn Owl", debugLabel: "OWL",
    assetPath: "/assets/models/defenders/optimized/thorn-owl.glb",
    ...normalizedVisual({ width: 1.8970, height: 0.8131, depth: 0.7977 }, 0.54),
    visualScaleMultiplier: 0.9, rotationY: 0, hoverHeight: 0.33,
  },
  druid: {
    displayName: "Druid", debugLabel: "DRUID",
    assetPath: "/assets/models/defenders/optimized/druid.glb",
    ...normalizedVisual({ width: 1.4543, height: 1.8930, depth: 1.0878 }, 1.78, { width: 0.7, depth: 0.7 }),
    visualScaleMultiplier: 0.9, rotationY: 0,
  },
  seer: {
    displayName: "Seer", debugLabel: "SEER",
    assetPath: "/assets/models/defenders/optimized/seer.glb",
    ...normalizedVisual({ width: 1.3139, height: 1.8974, depth: 1.2935 }, 1.61, { width: 0.68, depth: 0.7 }),
    visualScaleMultiplier: 0.9, rotationY: 0,
  },
};
