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
  clusters: readonly ("forest" | "rocks" | "camp")[];
}

export const ENVIRONMENT_THEMES: readonly EnvironmentTheme[] = [
  {
    id: "frozen-forest", label: "Frozen Forest",
    playableGround: new Color3(0.63, 0.73, 0.79), outskirtsGround: new Color3(0.28, 0.4, 0.47),
    fogColor: new Color3(0.68, 0.78, 0.84), ambientTint: new Color3(0.76, 0.86, 0.94),
    spawnAccent: new Color3(1, 0.08, 0.04), exitAccent: new Color3(0.2, 0.5, 1),
    treeAssets: ["nature-pine-1", "nature-pine-3", "nature-pine-5"],
    rockAssets: ["nature-rock-2", "nature-rock-3"], propAssets: ["nature-flowering-bush"],
    treeCount: 10, rockCount: 6, propCount: 2,
    clusters: ["forest", "rocks", "camp", "forest", "rocks", "forest", "camp", "rocks", "forest", "rocks", "forest", "camp"],
  },
  {
    id: "winter-highlands", label: "Winter Highlands",
    playableGround: new Color3(0.61, 0.68, 0.71), outskirtsGround: new Color3(0.21, 0.27, 0.29),
    fogColor: new Color3(0.49, 0.57, 0.61), ambientTint: new Color3(0.66, 0.72, 0.75),
    spawnAccent: new Color3(1, 0.12, 0.035), exitAccent: new Color3(0.28, 0.58, 1),
    treeAssets: ["nature-pine-5"],
    rockAssets: ["nature-rock-1", "nature-rock-2", "nature-rock-3"], propAssets: ["nature-mushroom"],
    treeCount: 5, rockCount: 10, propCount: 3,
    clusters: ["rocks", "forest", "rocks", "camp", "rocks", "forest", "camp", "rocks", "forest", "rocks", "forest", "camp"],
  },
  {
    id: "fantasy-forest", label: "Fantasy Forest",
    playableGround: new Color3(0.62, 0.71, 0.66), outskirtsGround: new Color3(0.23, 0.34, 0.27),
    fogColor: new Color3(0.5, 0.61, 0.54), ambientTint: new Color3(0.86, 0.82, 0.67),
    spawnAccent: new Color3(0.94, 0.12, 0.04), exitAccent: new Color3(0.24, 0.56, 0.92),
    treeAssets: ["nature-pine-1", "nature-pine-3", "nature-pine-5"],
    rockAssets: ["nature-rock-1", "nature-rock-3"], propAssets: ["nature-flowering-bush", "nature-mushroom"],
    treeCount: 11, rockCount: 5, propCount: 6,
    clusters: ["forest", "forest", "camp", "forest", "rocks", "forest", "camp", "rocks", "forest", "rocks", "forest", "camp"],
  },
];

/** A logged presentation seed makes a run reproducible without entering gameplay state. */
export function themeForRun(seed: number): EnvironmentTheme {
  return ENVIRONMENT_THEMES[Math.abs(seed) % ENVIRONMENT_THEMES.length];
}
