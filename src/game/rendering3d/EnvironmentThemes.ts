import { Color3 } from "@babylonjs/core";
import type { FactionId } from "../config/FactionConfig";
import type { EnvironmentAssetKey } from "./EnvironmentAssetLibrary";

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
    playableGround: new Color3(0.45, 0.67, 0.30), outskirtsGround: new Color3(0.22, 0.43, 0.18),
    fogColor: new Color3(0.58, 0.70, 0.57), ambientTint: new Color3(0.78, 0.90, 0.70),
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
