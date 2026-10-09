# TowerDefence — Architecture Notes for Codex

Use this only when the task touches gameplay architecture or renderer boundaries.

## Core project stack
- Vite
- TypeScript
- Babylon.js
- `GameState` is gameplay authority
- Babylon is presentation only

## Important gameplay/config files
Commonly relevant:
- `src/game/GameState.ts`
- `src/game/config/MapConfig.ts`
- `src/game/config/DefenderConfig.ts`
- `src/game/config/FactionConfig.ts`
- `src/game/config/WaveConfig.ts`
- `src/game/config/SpecializationConfig.ts`
- `src/game/config/FormationConfig.ts`
- `src/game/config/EnemyAffixConfig.ts`
- `src/game/config/FactionBonusConfig.ts`
- `src/game/FactionBonusSystem.ts`
- `src/game/enemies/EnemyAffixSystem.ts`

## Rendering files
Commonly relevant:
- `src/game/rendering3d/BabylonGameRenderer.ts`
- `src/game/rendering3d/TerrainCliffRenderer.ts`
- `src/game/rendering3d/EnvironmentAssetLibrary.ts`
- `src/game/rendering3d/EnvironmentThemes.ts`
- `src/game/rendering3d/VisualConfig.ts`
- `src/game/rendering3d/CombatEffects3D.ts`

Use the actual repo structure if files have moved.

## State ownership
Gameplay state belongs in platform-neutral systems/config.

Examples that must remain gameplay-authoritative:
- gold
- lives
- tower ownership
- tower stats
- status effects
- pathfinding
- build validation
- wave state
- enemy state
- campaign/free-play state
- multiplayer player state

Babylon may cache presentation state but must not decide outcomes.

## Pathfinding
- Existing grid/pathfinding logic is authoritative.
- Do not duplicate BFS/pathfinding in rendering.
- Recompute routes only when needed, not every frame.
- Environment decoration must never create gameplay collision/pathfinding rules unless explicitly requested.

## Maps
Existing solo gameplay layouts are considered stable unless explicitly requested.

Visual themes should be presentation layers over gameplay geometry, not duplicate gameplay logic.

## Multiplayer direction
Multiplayer gameplay state must remain data-driven and future-ready for 2/3/4 players.

Prefer:
- `players: PlayerState[]`
- `playerId`
- `ownerPlayerId`

Avoid hardcoded `player1Gold`, `player2Gold` style fields.

Networking should later synchronize validated gameplay actions/state around `GameState`, not Babylon or DOM state.
