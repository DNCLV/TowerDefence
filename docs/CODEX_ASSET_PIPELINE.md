# TowerDefence — Asset Pipeline Rules

Use this when the task touches GLB, textures, portraits, Castle/Forest assets, or production size.

## Source folders
Examples:
- `3D/`
- `Background/Kenney Castle/`
- `Background/Forest/`

These are source locations only. Do not reference them at runtime.

## Required flow
Source asset
→ inspect
→ optimize/copy if needed
→ runtime asset location
→ runtime manifest
→ cached runtime loading

## Runtime rules
- Only package assets actually used.
- Do not ship whole source packs.
- Do not duplicate identical assets unnecessarily.
- Do not delete/overwrite original source files unless explicitly requested.
- Preserve current production pruning behavior.

## GLB mapping
When integrating a new model:
1. Find the actual file; do not invent filenames.
2. Map by canonical gameplay/unit ID.
3. Normalize visual scale from runtime bounds if raw export scale differs.
4. Verify rotation, pivot, grounding/hover height.
5. Keep gameplay footprint unchanged unless explicitly requested.
6. Reuse model cache/template.
7. Update preload only when needed.
8. Update runtime manifest.
9. Verify production build retains the asset.

## Fallbacks
Fallback visuals are safety mechanisms only.

If the intended model exists and loads successfully, it must be the normal visual.

Do not treat reuse of another unit model as final when a dedicated GLB exists.

## Performance
For repeated static assets:
- prefer thin instances / hardware instances / clones where safe
- share materials
- freeze static world matrices
- limit dynamic shadows

For animated units:
- preserve independent skeleton/animation state where required
- still reuse loaded templates/assets

## Texture guidance
Audit first. Do not blindly downscale everything.

Typical stylized targets:
- small props: 256–512
- normal assets: 512–1024
- 2048 only when justified
- 4096 exceptional

## Production reporting
For asset changes, report:
- source asset(s) found
- runtime mapping
- scale/rotation/offset if relevant
- size impact
- manifest change
- tests
