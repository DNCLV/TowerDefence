/** Presentation-only presets. Gameplay state and simulation never read these values. */
export interface RenderingQualityPreset {
  antialias: boolean;
  hardwareScalingLevel: number;
  shadowMapSize: number;
  environmentShadows: boolean;
  particleMultiplier: number;
  vegetationDensityMultiplier: number;
}

export const RENDERING_QUALITY_PRESETS: Record<"low" | "medium" | "high", RenderingQualityPreset> = {
  low: {
    antialias: false,
    hardwareScalingLevel: 1.5,
    shadowMapSize: 512,
    environmentShadows: false,
    particleMultiplier: 0.65,
    vegetationDensityMultiplier: 0.72,
  },
  medium: {
    antialias: true,
    hardwareScalingLevel: 1,
    shadowMapSize: 1024,
    environmentShadows: false,
    particleMultiplier: 1,
    vegetationDensityMultiplier: 1,
  },
  high: {
    antialias: true,
    hardwareScalingLevel: 1,
    shadowMapSize: 2048,
    environmentShadows: true,
    particleMultiplier: 1,
    vegetationDensityMultiplier: 1,
  },
};

// Keep the current visual output. A future native wrapper can select a preset
// from device capability data without touching GameState or map configuration.
export const ACTIVE_RENDERING_QUALITY = RENDERING_QUALITY_PRESETS.medium;
