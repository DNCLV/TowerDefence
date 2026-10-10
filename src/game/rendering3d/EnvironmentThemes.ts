import { Color3 } from "@babylonjs/core";
import type { FactionId } from "../config/FactionConfig";
import type { EnvironmentAssetKey } from "./EnvironmentAssetLibrary";

/** Shared Forest presentation palette: bright clearing, varied foliage, earthy scatter. */
export const FOREST_PALETTE = {
  playableGround: new Color3(0.98, 0.98, 0.91),
  outskirtsGround: new Color3(0.25, 0.34, 0.21),
  floorHex: "#99aa75",
  foliageTint: new Color3(0.76, 0.82, 0.64),
  /** Clearly distinct but cohesive per-instance tones; hardware instancing stays intact. */
  foliageVariations: [
    new Color3(0.48, 0.64, 0.41),
    new Color3(0.65, 0.77, 0.50),
    new Color3(0.78, 0.84, 0.55),
    new Color3(0.55, 0.70, 0.57),
  ],
  /** Darker background crowns create depth without adding unique materials or meshes. */
  depthFoliageVariations: [
    new Color3(0.34, 0.49, 0.30),
    new Color3(0.40, 0.56, 0.34),
    new Color3(0.48, 0.61, 0.38),
    new Color3(0.37, 0.53, 0.43),
  ],
  dirtPatchColors: ["rgba(112,76,44,0.36)", "rgba(151,104,56,0.32)", "rgba(92,67,45,0.28)", "rgba(181,139,79,0.27)"],
  scatteredDirtPatchCount: 88,
} as const;

/** Curated low-cost Nature Kit additions used by the Forest composer and future scenic variants. */
export const FOREST_SCENIC_ASSETS = {
  alternateTrees: ["forest-quaternius-common-tree", "forest-quaternius-pine"],
  shrubs: ["forest-quaternius-bush", "forest-quaternius-flower-bush"],
  boulders: ["forest-quaternius-rock-1", "forest-quaternius-rock-2", "forest-quaternius-rock-3"],
  terrainHelpers: ["forest-rocks-ramp", "forest-stones", "forest-patch-dirt"],
  entryStructures: ["forest-bridge"],
} as const satisfies Record<string, readonly EnvironmentAssetKey[]>;

export interface EnvironmentTheme {
  id: string;
  label: string;
  style: "castle" | "forest";
  playableGround: Color3;
  outskirtsGround: Color3;
  fogColor: Color3;
  ambientTint: Color3;
  spawnAccent: Color3;
  exitAccent: Color3;
  treeAssets: readonly EnvironmentAssetKey[];
  rockAssets: readonly EnvironmentAssetKey[];
  propAssets: readonly EnvironmentAssetKey[];
  treeCount: number;
  rockCount: number;
  propCount: number;
  clusters: readonly ("forest" | "rocks" | "camp" | "village" | "outpost" | "storage")[];
}

export const ENVIRONMENT_THEMES: readonly EnvironmentTheme[] = [
  {
    id: "royal-guard-stronghold", label: "Royal Guard Stronghold",
    style: "castle",
    playableGround: new Color3(0.69, 0.65, 0.55), outskirtsGround: new Color3(0.52, 0.68, 0.39),
    fogColor: new Color3(0.72, 0.76, 0.75), ambientTint: new Color3(0.91, 0.87, 0.77),
    spawnAccent: new Color3(0.72, 0.17, 0.12), exitAccent: new Color3(0.76, 0.65, 0.30),
    treeAssets: ["castle-tree", "castle-tree-large"],
    rockAssets: ["castle-rock", "castle-rock-large"], propAssets: ["castle-flag"],
    treeCount: 12, rockCount: 30, propCount: 18,
    // Deliberately spread buildings and support scenes around every side of the arena.
    clusters: ["village", "forest", "camp", "storage", "outpost", "storage",
      "outpost", "forest", "storage", "camp", "outpost", "village", "storage", "camp",
      "storage", "forest", "outpost", "village", "camp", "village"],
  },
  {
    id: "ancient-grove-forest", label: "Ancient Grove Forest",
    style: "forest",
    playableGround: FOREST_PALETTE.playableGround, outskirtsGround: FOREST_PALETTE.outskirtsGround,
    fogColor: new Color3(0.63, 0.72, 0.66), ambientTint: new Color3(0.95, 0.93, 0.82),
    spawnAccent: new Color3(0.80, 0.24, 0.14), exitAccent: new Color3(0.92, 0.73, 0.26),
    treeAssets: ["forest-tree", "forest-tree-high", ...FOREST_SCENIC_ASSETS.alternateTrees],
    rockAssets: ["forest-rocks-low", "forest-rocks-high", "forest-stones", ...FOREST_SCENIC_ASSETS.boulders],
    propAssets: ["forest-plant", "forest-patch-grass", "forest-patch-dirt", ...FOREST_SCENIC_ASSETS.shrubs],
    treeCount: 360, rockCount: 96, propCount: 120,
    clusters: ["forest", "rocks", "forest", "forest", "rocks", "forest"],
  },
];

/** A logged presentation seed makes a run reproducible without entering gameplay state. */
export function themeForRun(seed: number, factionId: FactionId = "arcane-kingdom"): EnvironmentTheme {
  const style = factionId === "ancient-grove" ? "forest" : "castle";
  const choices = ENVIRONMENT_THEMES.filter((theme) => theme.style === style);
  return choices[Math.abs(seed) % choices.length];
}
