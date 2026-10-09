# TowerDefence — Compact Codex Prompt Template

Use this template for most tasks.

```text
Read and follow:
- CODEX_RULES.md
- docs/<only the relevant guide(s)>

TASK
<1–3 concise sentences>

CHANGE
- exact requested change
- exact values/behavior
- preserve existing architecture

DO NOT CHANGE
- only the important exclusions

LIKELY FILES
- <known file>
- <known file>
- <focused test>

VERIFY
- npx tsc --noEmit
- <1–2 relevant tests>
- git diff --check
- npm run build only if assets/runtime/build are affected

REPORT
- what changed
- files
- tests
- blockers
```

## Example — tiny balance change

```text
Read CODEX_RULES.md and docs/CODEX_BALANCE.md.

TASK
Buff Thorn Owl L1 only.

CHANGE
- damage 22 -> 24
- APS 1.25 -> 1.30
- range stays 5.5
- cost stays 15g

DO NOT CHANGE
- L2/L3
- waves/enemies
- other Ancient Grove units

LIKELY FILES
- src/game/config/DefenderConfig.ts
- focused Ancient Grove test

VERIFY
- npx tsc --noEmit
- relevant Ancient Grove test
- git diff --check

REPORT
- old/new values
- files
- tests
```

## Example — model integration

```text
Read CODEX_RULES.md and docs/CODEX_ASSET_PIPELINE.md.

TASK
Use the dedicated Bark Titan and Thorn Dancer GLBs instead of Treant/Seer reuse.

CHANGE
- find actual files under /3D
- add runtime copies
- update manifest/preload/mapping
- no runtime /3D paths
- Bark Titan visually larger than Treant
- Thorn Dancer ~ Seer/Wizard scale

DO NOT CHANGE
- gameplay/stats
- multiplayer
- maps/pathfinding

VERIFY
- npx tsc --noEmit
- npm run test:content-assets
- npm run build
- git diff --check

REPORT
- source GLBs
- runtime mappings
- scale
- size impact
- tests
```

## Example — Forest polish

```text
Read CODEX_RULES.md, docs/CODEX_ASSET_PIPELINE.md and docs/CODEX_UI_MOBILE.md.

TASK
Darken Forest foliage/grass and replace road-like dirt with scattered dirt patches.

CHANGE
- trees darker than grass
- grass darker than current
- dirt scattered/non-linear
- preserve readable grid

DO NOT CHANGE
- map geometry
- pathfinding
- gameplay

VERIFY
- npx tsc --noEmit
- npm run build
- git diff --check

REPORT
- color/tint changes
- dirt strategy
- files
- tests
```
