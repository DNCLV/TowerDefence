import { Color3 } from "@babylonjs/core";
import type { EnvironmentAssetKey } from "./EnvironmentAssetLibrary";

export interface EnvironmentTheme {
  id: string;
  label: string;
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
  clusters: readonly ("forest" | "rocks" | "camp" | "village")[];
}

export const ENVIRONMENT_THEMES: readonly EnvironmentTheme[] = [
  {
    id: "royal-guard-stronghold", label: "Royal Guard Stronghold",
    playableGround: new Color3(0.69, 0.65, 0.55), outskirtsGround: new Color3(0.38, 0.42, 0.32),
    fogColor: new Color3(0.72, 0.76, 0.75), ambientTint: new Color3(0.91, 0.87, 0.77),
    spawnAccent: new Color3(0.72, 0.17, 0.12), exitAccent: new Color3(0.76, 0.65, 0.30),
    treeAssets: ["castle-tree", "castle-tree-large"],
    rockAssets: ["castle-rock", "castle-rock-large"], propAssets: ["castle-flag"],
    treeCount: 8, rockCount: 5, propCount: 4,
    clusters: ["village", "forest", "camp", "rocks", "camp", "forest", "camp", "rocks", "forest", "camp", "forest", "village"],
  },
];

/** A logged presentation seed makes a run reproducible without entering gameplay state. */
export function themeForRun(seed: number): EnvironmentTheme {
  return ENVIRONMENT_THEMES[Math.abs(seed) % ENVIRONMENT_THEMES.length];
}
