# TowerDefence — Codex Rules

Read this file before making changes.

## Core architecture
- `GameState` and platform-neutral TypeScript gameplay systems are authoritative.
- Babylon.js is presentation only.
- UI is presentation/input only and must not become gameplay authority.
- Do not duplicate gameplay/pathfinding logic inside rendering code.
- Prefer config/data-driven changes over scattered hardcoded logic.
- Preserve existing solo behavior unless the task explicitly changes it.

## Scope discipline
- Make the smallest change that satisfies the task.
- Start with the files directly involved in the feature.
- Do not perform a broad repo audit unless the focused files show it is necessary.
- Do not redesign unrelated systems.
- Do not rebalance unrelated units/enemies/waves.
- Do not change map geometry/pathfinding unless explicitly requested.
- Do not silently improve values outside task scope.

## Portability / future app rule
All new code, UI, environment work, rendering changes, assets, and systems must remain as portable as possible for a future mobile/native app version.

Requirements:
- Do not rely on hardcoded local filesystem paths.
- Do not rely on Windows-specific paths or behavior.
- Do not introduce desktop-only assumptions.
- Do not make gameplay state depend on Babylon rendering.
- Keep gameplay/config data centralized and platform-neutral.
- Keep runtime assets inside the production asset pipeline / manifest.
- Do not reference source-only folders at runtime.
- Avoid unnecessary heavy dependencies for visual-only features.
- Avoid browser-only hacks that would be difficult to support in a future app wrapper.
- UI must remain touch-friendly and responsive.
- Respect safe areas and small/mobile screens.
- Avoid fragile absolute pixel positioning where responsive layout can be used instead.
- Environment decoration must remain visual-only and must not change collision/pathfinding/gameplay geometry.
- Static scenery should be cacheable, reusable and efficient.
- Avoid excessive dynamic lights, per-frame DOM work, and unnecessary runtime allocations.
- New systems must not assume direct access to the local development filesystem.

Preferred architecture:

Gameplay / balance / state
→ platform-neutral TypeScript systems/config

Rendering
→ Babylon presentation layer

UI
→ responsive presentation/input layer

Assets
→ production runtime manifest / packaged app assets

If a proposed implementation would create significant future portability problems, use the cleaner portable approach and report the tradeoff.

## Source vs runtime assets
Source folders such as:
- `3D/`
- `Background/`

are source material only.

Runtime must use packaged/optimized production assets through the existing runtime asset pipeline/manifest.

Never hardcode local machine paths.

## Rendering/performance
- Reuse cached model templates.
- Do not reload/parse the same GLB per tower/enemy/prop.
- Prefer instances/thin instances/clones for repeated static scenery when safe.
- Reuse materials.
- Freeze static world matrices where safe.
- Avoid unnecessary realtime shadow casters.
- Do not add per-frame work for static environment decoration.
- Preserve the existing production pruning/manifest strategy.

## Gameplay safety
Unless explicitly requested, do not change:
- tower/enemy stats
- wave compositions
- starting gold
- HP scaling
- faction mechanics
- pathfinding rules
- blocked/buildable cells
- spawn/goal positions
- minimap gameplay data
- campaign progression

## Git / working tree
- Respect existing uncommitted work.
- Do not revert unrelated changes.
- Do not rewrite user work to make tests pass.
- If the task begins from a WIP state, continue from the current tree rather than restarting from scratch.

## Reporting
Keep the final report concise:
- what changed
- files changed
- tests run/results
- blockers or unresolved items

Do not repeat the entire task specification back to the user.

## Browser verification:
- Attempt focused browser/Chrome verification at most once.
- If Windows sandbox blocks Chrome/DevTools startup with the known environment error, do not retry the same capture.
- Report browser verification as environment-blocked and continue with available static/build/test verification.
- Do not spend tokens repeatedly retrying known sandbox failures.

## Map rollout rule:
- For new visual, environment, camera, UI-preview, or map-specific changes, implement and verify on the 1-Spawn / Open Field map first.
- Do not automatically apply or test the same change on 2-Spawn / Split Advance or 3-Spawn / Triple Convergence.
- Only expand to additional maps after explicit user approval.
- Preserve shared architecture so later rollout is easy, but keep the first implementation scoped to 1-Spawn.
