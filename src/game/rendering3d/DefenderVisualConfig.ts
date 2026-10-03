import type { DefenderType } from "../config/DefenderConfig";

export interface DefenderVisualDefinition {
  displayName: string;
  debugLabel: string;
  assetPath: string;
  fallbackAssetPath?: string;
  /** Explicit per-model scale, tuned from that model's measured GLB bounds. */
  modelScale: number;
  rotationY: number;
  primitiveFallback: "wizard" | "knight" | "green-archer" | "battlemage" | "sovereign";
}

/** One canonical visual mapping for every currently playable defender ID. */
export const DEFENDER_VISUAL_CONFIG: Record<DefenderType, DefenderVisualDefinition> = {
  "blue-wizard": {
    displayName: "Blue Wizard", debugLabel: "WIZARD",
    assetPath: "/assets/models/defenders/blue-wizard.glb",
    modelScale: 1.13 * 0.75, rotationY: 0, primitiveFallback: "wizard",
  },
  "holy-knight": {
    displayName: "Holy Knight", debugLabel: "KNIGHT",
    assetPath: "/assets/models/defenders/holy-knight.glb",
    modelScale: 1.13 * 0.75, rotationY: 0, primitiveFallback: "knight",
  },
  "green-archer": {
    displayName: "Green Archer", debugLabel: "ARCHER",
    assetPath: "/assets/models/defenders/optimized/green-archer.glb",
    fallbackAssetPath: "/assets/models/defenders/green-archer.glb",
    // Optimized GLB bounds: 0.985 × 1.897 × 0.841. Keep its footprint below one tile.
    modelScale: 0.75, rotationY: 0, primitiveFallback: "green-archer",
  },
  battlemage: {
    displayName: "Battlemage", debugLabel: "BATTLEMAGE",
    assetPath: "/assets/models/defenders/optimized/battlemage.glb",
    fallbackAssetPath: "/assets/models/defenders/battlemage.glb",
    // Bounds: 1.440 × 1.898 × 1.520; scale is reduced to keep the wide silhouette in-cell.
    modelScale: 0.55, rotationY: 0, primitiveFallback: "battlemage",
  },
  sovereign: {
    displayName: "Sovereign", debugLabel: "SOVEREIGN",
    assetPath: "/assets/models/defenders/optimized/sovereign.glb",
    fallbackAssetPath: "/assets/models/defenders/sovereign.glb",
    // Source bounds: 1.27869 × 1.89875 × 1.1247; reduced to fit a defender cell.
    modelScale: 0.62, rotationY: 0, primitiveFallback: "sovereign",
  },
};
