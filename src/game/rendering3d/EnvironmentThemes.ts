import { Color3 } from "@babylonjs/core";
import type { FactionId } from "../config/FactionConfig";
import type { EnvironmentAssetKey } from "./EnvironmentAssetLibrary";

/** Shared Forest presentation palette: bright clearing, varied foliage, earthy scatter. */
export const FOREST_PALETTE = {
  playableGround: new Color3(0.82, 0.94, 0.76),
  outskirtsGround: new Color3(0.31, 0.48, 0.25),
  floorHex: "#86b85e",
  foliageTint: new Color3(0.78, 0.88, 0.68),
  /** Clearly distinct but cohesive per-instance tones; hardware instancing stays intact. */
  foliageVariations: [
    new Color3(0.58, 0.76, 0.52),
    new Color3(0.76, 0.92, 0.62),
    new Color3(0.96, 1.00, 0.72),
    new Color3(0.68, 0.82, 0.72),
  ],
  dirtPatchColors: ["rgba(112,72,39,0.40)", "rgba(151,103,54,0.34)", "rgba(88,61,39,0.29)", "rgba(178,132,72,0.26)"],
  scatteredDirtPatchCount: 92,
} as const;

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
    fogColor: new Color3(0.70, 0.82, 0.68), ambientTint: new Color3(0.90, 0.98, 0.82),
    spawnAccent: new Color3(0.80, 0.24, 0.14), exitAccent: new Color3(0.92, 0.73, 0.26),
    treeAssets: ["forest-tree", "forest-tree-high"],
    rockAssets: ["forest-rocks-low", "forest-rocks-high", "forest-stones"],
    propAssets: ["forest-plant", "forest-patch-grass", "forest-patch-dirt"],
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
