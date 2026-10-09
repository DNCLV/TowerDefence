# TowerDefence — Multiplayer Direction

Use this when working on 2/3/4-player architecture.

## Phase strategy
Phase 1:
- deterministic/local gameplay support
- player state
- tower ownership
- build zones
- multi-goal maps/pathfinding
- separate gold/shared lives

Later:
- real networking
- lobby/matchmaking
- synchronization/authority transport

Do not add networking transport unless explicitly requested.

## Player state
Prefer:
- `players: PlayerState[]`
- stable `playerId`
- `ownerPlayerId` on towers

Avoid hardcoding exactly two players in data structures.

## Shared team state
Typically shared:
- lives
- wave
- pause/speed
- Auto Run
- victory/defeat
- campaign/free-play state
- enemies
- affix milestones

## Per-player state
Typically separate:
- gold
- faction
- owned towers
- build-zone permissions

## Tower ownership
Owner may:
- upgrade
- sell
- specialize
- change tower-specific settings

Gameplay logic must validate ownership, not only the UI.

## Build zones
For 2-player Twin Bastion:
- P1 private zone
- P2 private zone
- shared center

P1 can build in P1 + shared.
P2 can build in P2 + shared.

## Goals/pathfinding
Multiple goals must be gameplay-authoritative.

Each spawn may have a preferred goal, but enemies may choose another valid goal when it becomes meaningfully shorter.

Avoid route oscillation with a small bias/hysteresis if needed.

Build validation must ensure each active spawn retains at least one valid route to an allowed goal.

## Economy
Separate gold pools.

Reward distribution should be centralized/configurable.

Selling returns gold to tower owner.

## Future networking boundary
Gameplay mutations should map cleanly to validated actions such as:
- place tower
- upgrade
- sell
- specialize
- set priority
- start wave
- transfer gold (future)

Do not make Babylon/DOM authoritative.
