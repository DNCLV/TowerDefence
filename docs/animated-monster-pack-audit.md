# Quaternius Animated Monster Pack: audit and POC

Audited local source: `Quaternius/Animated Monster Pack by @Quaternius/`.
The pack has FBX, Blend and OBJ folders. FBX was imported in Babylon.js to inspect actual skeletons, clips, material references and mesh bounds; OBJ has no skeletal animation. The FBX materials are inline flat materials (zero texture files required).

| Model | FBX source size | Bones | Triangles | Clips (duration) | Root translation |
|---|---:|---:|---:|---|---|
| Bat | 747,708 B | 29 | 1,046 | Attack 0.875s; Attack2 1.250s; Death 1.208s; Flying 1.250s; Hit 1.250s | Present on `BodyRoot`; ignore for gameplay position |
| Dragon | 874,204 B | 34 | 1,344 | Attack 0.875s; Attack2 1.667s; Death 1.208s; Flying 1.667s; Hit 1.667s | Present on `BodyRoot`; ignore for gameplay position |
| Skeleton | 433,820 B | 18 | 1,810 | Attack 0.933s; Death 0.367s; Idle 2.667s; Running 1.000s; Spawn 2.900s | No root-position tracks |
| Slime | 338,940 B | 17 | 1,440 | Attack 0.625s; Death 0.417s; Idle 2.500s; Walk 0.833s | No root-position tracks |

Companion source sizes (Blend / OBJ): Bat 1,100,628 / 71,259 B; Dragon 1,081,144 / 91,651 B; Skeleton 923,896 / 84,394 B; Slime 796,040 / 61,234 B. No Goblin model exists in this pack.

## Compatibility and selection

- The pack contains no Goblin rig or Goblin animation. Goblin and Goblin Brute remain on existing visuals.
- Skeleton King is the one implemented POC: a direct whole-model replacement with the pack's Skeleton mesh and its own rig, not retargeting. The current static Skeleton King GLB is the fallback. It is a noticeably simpler low-poly appearance than the existing model.
- The 18-bone Skeleton hierarchy is a compact humanoid (`SkeletonArmature`, `Hips`, torso, neck/head and limb branches), not a demonstrated name/hierarchy match for another game's humanoid skeleton. No retarget is used.
- Dragon is a possible future whole-model replacement for Undead Dragon, with Flying/Attack/Hit/Death clips, but its BodyRoot position tracks must be stripped/isolated and visual scale/flight behavior reviewed first.
- Bat has flight/combat clips but is only a bat, not the Goblin Rider and not a compatible rider replacement. Slime has no current roster match.
- Recommended future Goblin strategy: acquire an actually animated Goblin model with locomotion/attack/death, or plan a deliberate rig-retarget workflow. Do not apply these mismatched rigs to existing Goblin GLBs.

## Implemented presentation-only POC

`Skeleton.fbx` (433,820 bytes, about 0.41 MiB) is included in the runtime enemy asset group. It is loaded on demand through Babylon's FBX loader only when Skeleton King enters the progressive preload window. The visual uses independent cloned skeletons and animation groups; scale is 0.01 for the FBX centimetre units, with a measured 5.0-unit height. GameState still owns all position, HP, speed, attack, death and wave outcomes. Idle/Running/Attack/Death are presentation states; movement playback rate follows the current speed multiplier. Root position channels are ignored. The old optimized Skeleton King GLB remains a fallback.

Animation groups unused by the configured states (Spawn) are pruned per instance. Active clips do not restart each frame. Idle, Running and Death currently play from visual state; Attack is mapped but the current enemy AI has no attack action to trigger it. A dying visual is separated from GameState, plays its death clip, then is disposed; no more than 12 corpse visuals can be retained. Reset/dispose removes all enemy visuals and clips. `?enemyAnimationDebug=1` enables state transition and browser-test hooks.

## Verification

Browser stress test via `npm run test:enemy-animation` (Vite at `http://127.0.0.1:5174/`, headless Chrome/SwiftShader):

- 1 enemy: Idle → Running; one Running transition; Idle root stays fixed; slow/Swift playback measured at 0.55× / 1.10×; Death clip finishes and the corpse is disposed.
- 25 / 50 / 100 concurrent Skeleton visuals: respectively 25 / 50 / 100 skeletons and 100 / 200 / 400 retained animation groups (four configured groups per instance; exactly one group active per enemy). Mesh count 320 / 395 / 545; measured heap 96 / 118 / 133 MB.
- Headless SwiftShader measured only 2–3 FPS at these loads (baseline 3 FPS). This environment is software-rendered and is not evidence of physical-phone FPS; a real-device performance check remains necessary before using high counts as a mobile target.
- Portrait viewports 360×800 and 390×844 have no horizontal overflow.
- The new runtime FBX adds 433,820 bytes to the production asset allowlist. No texture sidecars are needed. No gameplay, balance, waves, pathfinding, camera or UI layout was changed for this POC.
