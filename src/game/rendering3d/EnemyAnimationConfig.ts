import type { EnemyType } from "../config/EnemyConfig";

export type EnemyAnimationState = "idle" | "moving" | "attacking" | "dying";

export interface EnemyAnimationDefinition {
  /** Runtime FBX/GLB which includes both the replacement model and its own rig. */
  assetPath: string;
  /** Exact source clip suffixes verified by the Animated Monster Pack audit. */
  clips: Partial<Record<EnemyAnimationState, string>>;
  /** FBX exports use centimeters; this normalizes them before the shared world scale. */
  modelScale: number;
  rotationY: number;
  groundOffsetY: number;
  hpBarOffsetY: number;
  maxDimension: number;
  /** Translation channels on these bones are presentation root motion and are ignored. */
  ignoreRootMotionTargets: readonly string[];
  minPlaybackSpeed: number;
  maxPlaybackSpeed: number;
}

/** Only enemies with a fully audited replacement asset are listed here. */
export const ENEMY_ANIMATION_CONFIG: Partial<Record<EnemyType, EnemyAnimationDefinition>> = {
  // One skinned Bloodfang mesh. Casual_Walk is the only imported clip; Hips
  // translation is neutralized so Babylon follows GameState's cell position.
  goblin: {
    assetPath: "/assets/models/enemies/optimized/goblin-meshy-casual-walk.glb",
    clips: { moving: "Casual_Walk" },
    // Source bounds are ~0.7 tall; this matches the optimized static Goblin after
    // the shared 1.5 visual scale (0.7 * 2.22 ~= 1.8966 * 0.82).
    modelScale: 2.22,
    rotationY: 0,
    groundOffsetY: 0,
    hpBarOffsetY: 1.76,
    maxDimension: 2.75,
    ignoreRootMotionTargets: ["target_character", "mixamorig:Hips"],
    minPlaybackSpeed: 0.6,
    maxPlaybackSpeed: 1.6,
  },
};
