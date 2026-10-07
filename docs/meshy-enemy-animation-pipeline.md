# Meshy enemy animation pipeline

The standard Goblin uses the Meshy Bloodfang Marauder's own `Casual_Walk` export. Its 28-joint Mixamo-style rig, skinned mesh, UVs, and material are retained. Do not substitute the Quaternius skeleton or clips from another model.

For future custom mobs:

1. Generate the model and rig it in Meshy.
2. Generate Idle, Walk, Attack, Hit, and Death clips on that same rig.
3. Export each clip as `withSkin` GLB and verify identical joint names and hierarchy.
4. Keep an untouched source copy in `3D/`; generate a size-limited runtime GLB under `public/assets/`.
5. Register only the needed runtime clips and transforms in `EnemyAnimationConfig.ts`.
6. Add the runtime asset to `scripts/runtime-asset-manifest.json` and to the progressive wave preload only when that enemy is relevant.
7. Keep a static optimized model as load/rig-validation fallback and verify independent Babylon `AssetContainer` instances and cleanup.

The current animation source includes a single animated mesh, so the sword is part of its skinned mesh rather than a separate rigid hand attachment. Some sword deformation is expected and is not currently corrected.

For a future multi-clip runtime, prefer one shared mesh/material/skin plus a single combined GLB containing all clips, if the Meshy exports can be safely merged without changing their skeleton. Otherwise, retain one compact animation-only source per clip and load/merge their tracks onto the one cached model rig; do not ship five full copies of the mesh and textures. Verify this pipeline and Babylon skeleton cloning before adopting it for gameplay.
