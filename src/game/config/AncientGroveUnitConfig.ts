import type { TowerSpecializationId } from "./SpecializationConfig";

export interface VerdantResonanceProfile {
  radiusCells: number;
  dotDamageMultiplier: number;
  slowStrengthMultiplier: number;
  enablesGroundEffectsAgainstFlying: true;
}

const BASE_VERDANT_RESONANCE: VerdantResonanceProfile = {
  radiusCells: 4.5,
  dotDamageMultiplier: 1.2,
  slowStrengthMultiplier: 1.25,
  enablesGroundEffectsAgainstFlying: true,
};

/** Central tuning for Thorn Dancer's aura. Overlapping copies use the strongest value per bonus. */
export const VERDANT_RESONANCE_CONFIG = {
  base: BASE_VERDANT_RESONANCE,
  specializations: {
    "blight-dancer": { ...BASE_VERDANT_RESONANCE, dotDamageMultiplier: 1.4, slowStrengthMultiplier: 1.15 },
    "winterthorn-dancer": { ...BASE_VERDANT_RESONANCE, dotDamageMultiplier: 1.15, slowStrengthMultiplier: 1.4 },
  } satisfies Partial<Record<TowerSpecializationId, VerdantResonanceProfile>>,
} as const;

export function getVerdantResonanceProfile(specializationId?: TowerSpecializationId): VerdantResonanceProfile {
  return specializationId && specializationId in VERDANT_RESONANCE_CONFIG.specializations
    ? VERDANT_RESONANCE_CONFIG.specializations[specializationId as keyof typeof VERDANT_RESONANCE_CONFIG.specializations]
    : VERDANT_RESONANCE_CONFIG.base;
}
