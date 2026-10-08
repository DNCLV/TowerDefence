# Maze Defence PoC

En mobilorienteret Tower Defence-prototype inspireret af idéen i Warcraft 3 Wintermaul: towers er både våben og vægge, så spilleren former selv fjendernes maze.

## Start projektet

Kør følgende i projektmappen:

```bash
npm install
npm run dev
```

Åbn derefter den lokale Vite-adresse i en browser. Layoutet er lavet til portrait-format og skalerer til mobilskærmen.

## Struktur

- `src/game/grid/Grid.ts` — grid og blokerede felter.
- `src/game/pathfinding/Pathfinder.ts` — framework-uafhængig BFS-pathfinding.
- `src/game/towers/Tower.ts` og `src/game/enemies/Enemy.ts` — rene datamodeller.
- `src/game/GameState.ts` — economy, wave, movement, combat og placeringregler.
- `src/game/scenes/GameScene.ts` — Phaser-rendering, input og scene-livscyklus.
- `src/main.ts` — Vite/Phaser-opstart.

## Det der virker

- Level 1 bruger et 12×14 grid med spawn til venstre, exit til højre, faste terrain-islands og åbne build-zoner.
- Tap/click bygger Basic Towers for 10 gold, med 100 gold fra start.
- Tower-placering afvises, hvis den lukker den sidste gyldige rute.
- BFS-stien vises visuelt og opdateres efter hver gyldig placering.
- Hover eller drag over et felt viser en diskret gron/rod placement-preview. Et ugyldigt tap giver desuden en kort rod markering og forklarende tekst.
- Start Wave uses a deterministic composition queue: waves 1–20 are explicit, every 7th wave is Rider-focused, and every 10th wave adds Giants.
- Ground enemies follow the maze with delta-time movement and live repathing. Riders fly directly from spawn to goal and ignore maze blocking.
- UI viser wave og resterende enemies (inklusive dem, der endnu ikke er spawned). Bygning er låst under en aktiv wave.
- Basic Towers angriber automatisk med separat cooldown, 110 range, 25 damage og 1 angreb pr. sekund.
- Towers prioriterer den enemy, der er længst fremme på wave-ruten. Dræbte enemies giver 1 gold, og Phaser viser en kort hit-linje.
- Basic Towers har tre levels. Vælg et tower i build phase for at se stats/range og opgradere det med gold.
- Tower progression giver nu tydelige spikes: L1 25 damage/1.0 fire rate, L2 55/1.15 og L3 100/1.35. L1/L2/L3 er henholdsvis lilla, blå og guld på mappet.
- Enemy base HP, speed, rewards, and leak damage are defined in `src/game/config/EnemyConfig.ts`. Wave HP multipliers live in `src/game/config/EnemyHpScalingConfig.ts`: 1× / 2× / 4× / 8× / 12× through wave 50, then the prior doubling curve resumes at 32× for waves 51–60.
- `src/game/config/WaveConfig.ts` controls composition and gradually tightens spawn tempo. Wave composition and completion telemetry are logged once per wave.
- `AUTO: ON` starter næste wave straks efter completion og kan slås fra når som helst. Ved 0 lives stoppes combat og Auto Run.
- Game Over viser `TRY AGAIN`, som starter et helt nyt in-memory run uden browser-reload.
- Towers kan bygges, vælges og opgraderes under en aktiv wave. Kun topology-ændringer udløser repath.
- Hver enemy har sin egen rute. Ved en gyldig live-placement repathes aktive enemies fra deres aktuelle cell uden teleportering; der kan ikke bygges i en cell med en aktiv enemy.
- Spilleren vælger nu mellem tre faste maps før spillet starter. Hvert map har én fælles castle, sine egne spawns/terrain og en BFS-rute pr. spawn.

## Naturlige næste skridt

Tilføj flere tower- og enemy-typer, tower selling, bedre combat-feedback samt flere levels. Game-kernen er bevidst uden Phaser-imports, så den kan genbruges i en senere Unity/C#- eller C++-port.

## Current enemy and wave system

The current implementation supersedes the earlier single-enemy/scaling notes above:

- `src/game/config/EnemyConfig.ts` is the source of truth for Goblin, Goblin Brute, Goblin Rider, and Giant Goblin stats.
- `src/game/config/WaveConfig.ts` defines waves 1–20, deterministic interleaving, the recurring 7th-wave flying event, the 10th-wave Giant rule, and bounded composition growth after wave 20. HP does not scale by wave.
- Ground enemies use maze paths and live repathing. Riders use a direct spawn-to-goal route and are not repathed by tower placement.
- Defender target capabilities are configured in `DefenderConfig.ts`: Wizard hits ground and air; Holy Knight hits ground only.
- Enemy model paths, measured size tuning, ground contact, flight lift, HP-bar height, and per-archetype bounds guards live in `src/game/rendering3d/EnemyVisualConfig.ts`. Each GLB is cached once and cloned from its `AssetContainer`; failed loads use the sized primitive fallback.
- The four runtime GLBs are in `public/assets/models/enemies/`; their source files remain unchanged in `3D/`.
- Run the focused checks with `npm run test:enemy-waves`.

## Map selection

- Appen starter på en mobilvenlig **Choose Map**-skærm: **Open Field** (1 Spawn), **Split Advance** (2 Spawns) og **Triple Convergence** (3 Spawns).
- `src/game/config/MapConfig.ts` definerer de tre faste, nord→syd-kort, deres build-blocking terræn, startgold, enemy-count multiplier og map previews.
- Startværdierne er 70 / 110 / 150 gold og 1.0× / 1.5× / 2.0× enemy count. Enemy HP, speed, rewards og wave-typer ændres ikke af mapvalget.
- Alle tre kort er gjort cirka 40% kortere og smallere: 17×32, 23×41 og 43×66 celler. Spawns, castle, bjerge og ruteåbninger er flyttet med, så hvert kort bevarer sine 1, 2 eller 3 fronter.
- Triple Convergence har stadig tre adskilte topzoner, to ruter omkring det centrale bjerg og ét fælles målfelt. Ground paths bruger terrænet; flying enemies ignorerer det og fortsætter direkte mod castle.
- Waves fordeles rundevis over kortets spawns. Ground enemies tager altid den korteste åbne vej til castle; ved bygning eller salg af et tower vælger de en ny rute fra deres aktuelle bevægelsessegment. `npm run test:map-adjustments` og `npm run test:shortest-routes` kontrollerer kortmål, terræn og omruting.
- Det mindre, display-only minimap ligger nederst til venstre over Build Units. `src/game/minimap/MinimapRenderer.ts` tegner terræn på et statisk Canvas-lag og opdaterer tower-, enemy- og kameramarkører med cirka 12,5 Hz. Det nulstilles ved run-reset og fjernes ved retur til Map Select. Kameraet kan zoomes ud til radius 70.
- Choose Map er fortsat første skærm i production build. Den seneste Pages-mangel skyldtes en annulleret Actions-deploy, så Pages fortsat serverede en ældre artifact; Vite `/TowerDefence/`-base var allerede korrekt. Deploy-workflowet annullerer ikke længere en igangværende deploy ved et nyt push.

## Visual refinement

- `src/game/rendering3d/DefenderVisualConfig.ts` records measured runtime GLB bounds and derives per-axis display scales from target heights/footprints. Battlemage is normalized to Wizard height; Sovereign is about 9% taller; model ground offsets and the selected-unit marker continue to use measured runtime bounds.
- Choose Map is a CSS/SVG-only icy fantasy screen; map thumbnails use the map-config routes and spawn colors. 1 Spawn is preselected, cards carousel on narrow phones and display in three columns at wider widths, and Start uses a short fade before initializing the chosen map.
- This pass changes no gameplay stats, cost, map topology, wave configuration, or camera controls. Browser layout/model checks run through `npm run test:content-assets` with Vite available; core regressions remain `npm run test:enemy-waves`.

## Content + combat-role milestone

- New enemies: Undead Dragon is a heavy flying target (first appears in the mixed Wave 32; flying Waves 35+ mix Riders and Dragons). Wave 50 is reserved for one Skeleton King boss.
- New defenders are configured in `src/game/config/DefenderConfig.ts`: Green Archer specializes in flying targets; Battlemage switches melee/ranged automatically and deals adjacent-target splash.

## Ancient Grove gameplay foundation

- Ancient Grove has its own Treant (7g), Thorn Owl (15g), Druid (55g), and Seer (75g) roster with configured level costs/stats and two L3 branches each.
- Treant influence builds ground-only Thorn Rot at one stack per second; Sun Seer applies a separate four-second-grace/one-stack-per-second-decay Sunbrand. Both statuses and damage are resolved in the framework-independent game core.
- The faction's original Living Maze slow remains unchanged. Its source models are `3D/Treant.glb`, `3D/Thorn Owl.glb`, `3D/Druid.glb`, and `3D/Seer.glb`; optimized runtime copies are under `public/assets/models/defenders/optimized/` and share the existing Babylon defender template cache. L3 branches currently reuse their base unit's model because no separate branch GLBs exist in `3D/` (only `Bear.png`). Regenerate the four runtime copies with `powershell -ExecutionPolicy Bypass -File scripts/optimize-content-models.ps1 -Only 'Treant','Thorn Owl','Druid','Seer'`.
- Focused simulation coverage is included in `npm run test:gameplay-depth`.

## Ancient Grove Forest environment

- Ancient Grove uses a presentation-only Forest variant of all three existing maps; Royal Guard retains the Castle environment. `MapConfig.ts`, blocked/buildable cells, routes, economy, and combat are shared and unchanged.
- The clearing floor uses a baked grass/earth material with the existing subtle placement grid. Dense deterministic tree layers replace Castle walls, while spawn/goal gaps remain open and are framed with dirt patches and stones.
- Map-edge blocked masses continue the woodland inside the normal camera view. Natural rock ridges and low-poly Forest boulders follow existing blocked-cell regions without adding collision.
- The selected Kenney source assets are `tree`, `tree-high`, `rocks-low`, `rocks-high`, `rocks-ramp`, `stones`, `plant`, `patch-grass`, and `patch-dirt`. Packaged copies live in `public/assets/environment/forest/`; runtime code never references the source-only `Background/Forest/` path.
- Each GLB template loads once. Repeated static scene copies share source geometry/materials, receive no per-frame updates, freeze their world matrices, and only a sparse subset of the inner tree border is eligible for shadows. `?terrainArtDebug=1` exposes per-map Forest composition counts.
- Enemy HP bars are one dark-backed red health bar per enemy. Combat and damage/kill telemetry stay in framework-independent `GameState`/tower code.
- The four source GLBs are `3D/Undead Dragon.glb`, `3D/Skeleton King.glb`, `3D/Green Archer.glb`, and `3D/Battlemage.glb`. Optimized-first runtime models and unchanged source fallbacks are under `public/assets/models/{enemies,defenders}/`.
- Regenerate only these assets with `powershell -ExecutionPolicy Bypass -File scripts/optimize-content-models.ps1`. `npm run test:enemy-waves` covers core wave/combat behavior; `npm run test:content-assets` checks the browser asset/UI integration (requires the Vite dev server).

## Sovereign, Commander & ground contact

- Enemies now have independent movement (`ground`/`flying`) and combat role (`fodder`/`tank`/`boss`) tags.
- Wave 35 is a flying-only set of 20 Riders, 4 Dragons, and 1 Skeletal Commander; Commander count rises at waves 42 and 49, then more slowly. Wave 50 remains Skeleton King-only.
- Sovereign costs 100 gold, has 125/200 upgrades and 4.5-cell range. It selects Anti-Air for any flying target, Rapid for ground fodder, and Heavy for ground tanks/bosses at attack time. All modes share one cooldown and remain single-target.
- Defender/enemy balance and movement are unchanged aside from the new enemy/compositions. `EnemyVisualConfig.ts` carries individual ground offsets; Wraith's +0.15 lift is an intentional hover, and `?enemyGroundDebug=1` draws terrain contact rings. `?enemyVisualDebug=1&waveDebug=1` exposes a six-ground-enemy visual lineup.
- Source files are `3D/Skeletal Commander Flying.glb` and `3D/Soveign.glb` (the source spelling is retained). The optimization script creates optimized GLBs plus unoptimized runtime fallbacks, leaving source files untouched. Use `-Only 'Skeletal Commander Flying','Soveign'` to rebuild just this pair.
- Run core regression tests with `npm run test:enemy-waves`; browser integration via `npm run test:content-assets` with Vite running.

## Specializations, formations & enemy affixes

- Eligible Blue Wizard, Holy Knight and Battlemage towers must choose one of two L3 branches when upgrading. Branch data/stats/effects/colors live in `src/game/config/SpecializationConfig.ts`; the compact choice and selected-branch details are in the existing tower panel.
- `src/game/config/FormationConfig.ts` evaluates the eight neighboring cells. A tower receives only its highest-priority active formation, recalculated after build/sell/upgrade/reset. Rune rings and specialization rings are visual-only; Frostweaver's temporary slow also gets a subtle icy ground ring.
- `src/game/config/EnemyAffixConfig.ts` and `src/game/enemies/EnemyAffixSystem.ts` define run-seeded affixes unlocked at waves 15/30/45. Their warnings pause spawning for five seconds; the [i] Battlefield Info panel shows live HP scaling and the run's affix history. Resistance and shield damage are resolved through the canonical combat path.
- Formation members have a brighter, local color-coded ground rune with four compact marks; no long connector lines are rendered. Tower selection uses a separate cyan ring, shown only while a tower is selected. The Build Units tray starts in `SELECT`; placement auto-cancels back to it.
- Save/Load buttons are still placeholders in this project, so there is currently no save format to migrate. Affix progression resets with a new run; formation state is recomputed from towers.
- Run `npm run test:gameplay-depth` for specialization, formation, affix, damage and milestone-warning regression coverage; it is included in `npm run test:enemy-waves`.

## Build and GitHub Pages

- Development: `npm install`, then `npm run dev`.
- Production build: `npm run build` (TypeScript check + Vite build).
- GitHub Pages deploys automatically on pushes to `main`; run it manually from the Actions tab with `Deploy GitHub Pages` → `Run workflow`.
- Production assets use the `/TowerDefence/` base path. The expected URL is `https://<USERNAME>.github.io/TowerDefence/`.
- Runtime models, textures, and UI images are served from `public/assets/`. Raw source art packs are ignored by Git; the runtime copies remain included.
- The first setup may require selecting **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Performance and production assets

- Map Select is now the small first-load entry. It dynamically imports `BabylonGameRenderer` only after the player confirms a faction; production emits an ~81 KiB entry JS chunk and a separate ~7.3 MiB renderer/engine chunk. The browser downloads the renderer when entering the battlefield, not on the map screen.
- Enemy GLBs are cached per Babylon scene and requested only for the current/following four waves. Normal runs begin by loading Goblin + Goblin Brute (~2.5 MiB optimized GLBs); diagnostic URLs such as `?waveDebug=1` intentionally preload every enemy for lineup/asset audits. Repeated in-flight requests share one promise.
- Environment templates also share one in-flight load per key; repeated static environment instances freeze their world matrices after placement. Defender models remain preloaded before build controls unlock, avoiding placeholder defenders.
- The original Blue Wizard (267,572 triangles / 13.0 MiB) and Holy Knight (163,442 / 11.4 MiB) were the largest always-used defender meshes. Optimized runtime copies use 37,460 triangles / 1.40 MiB and 22,880 / 1.19 MiB respectively. Original high-resolution fallback GLBs remain in `public/` for development, but production uses safe lightweight fallbacks rather than downloading those originals if an optimized defender fails. Regenerate with `powershell -ExecutionPolicy Bypass -File scripts/optimize-content-models.ps1 -Only 'Blue Wizard','Holy Knight'`.
- `scripts/runtime-asset-manifest.json` is the production allowlist. The build follows external GLTF buffers/images, copies only the 42 required model/animation/environment/UI files into generated `dist/`, then checks for missing or leaked assets. Pruning never deletes files from `public/assets/`; `npm run test:performance-build` verifies that source preservation and production closure.
- Second asset-footprint pass: generated `dist/` fell from 458.65 MiB to 41.87 MiB (−416.78 MiB / −90.9%). The runtime manifest payload is 34.33 MiB: enemies 13.80 MiB, defenders 7.71 MiB, UAL animation 7.27 MiB, Ranger fallback model/textures 3.87 MiB, UI 1.36 MiB and Castle environment 0.33 MiB. `public/assets/` is now 459.34 MiB (down from 506.40 MiB); unchanged originals remain available. The full breakdown, SHA-256 duplicate groups, dimensions/alpha, model geometry and top-20 production files are in `scripts/asset-inventory-after.md` (JSON companion included).
- Seven large optimized unit GLBs (Sovereign, Battlemage, Skeletal Commander, Giant Goblin, Goblin Rider, Skeleton King, Undead Dragon) kept their simplified geometry and were resized from 2K to 1K embedded JPEG maps: 63.61 → 12.69 MiB total (−50.92 MiB). The 1K maps are appropriate for units occupying a small portion of a mobile viewport; their original sources and unoptimized development fallbacks are retained. Small units were already at 1K. The emergency 65-joint Ranger fallback keeps its rig/geometry but uses 512px maps: 40.68 → 4.06 MiB across its GLTF dependency set.
- Largest remaining production asset is the 7.27 MiB UAL GLB. Only `Idle_Loop` and `Spell_Simple_Shoot` are used at runtime, but extracting just those clips safely requires preserving the 65-joint hierarchy and verifying animation targets; this is the best next measured optimization candidate. The next largest models are now ~1.6–2.1 MiB each.
- The previous all-in-one JS entry was 7,589 KiB (1,700 KiB gzip). The current initial entry is 81.6 KiB (26.2 KiB gzip); the deferred Babylon chunk is 7,512.7 KiB (1,676.5 KiB gzip). Total JS has not materially shrunk—the gain is that the map/faction screens do not pay that cost up front.
- Current Babylon `Engine` construction does not adapt to the device's full DPR, which avoids a 3× mobile render-surface multiplier. Do not raise this without checking low-end mobile GPUs; a later quality tier should tune render scale and shadow quality together.
- A reversible format experiment on temporary copies found Draco/Meshopt can reduce the already-optimized GLBs further (e.g. Blue Wizard 1.40 MiB → 0.48/0.62 MiB; Brute 1.43 MiB → 0.73/0.84 MiB), but both need runtime decoders; Babylon's default decoder configuration fetches decoder code externally. We did not adopt that remote dependency because it adds offline/deployment risk. A KTX2/ETC1S trial was not adopted because the required `ktx` executable is absent and adding that toolchain is not justified yet. WebP was also skipped: the five actually used transparent UI portraits total only 1.36 MiB. No dependency was added for any trial.
- Measured mobile content budgets: normal defender ≤40K triangles / 1–4 MiB / 1–2 materials / 1K maps; elite defender ≤50K / 2–6 MiB / 1–2 materials (Sovereign is currently 40.8K / 2.07 MiB); normal enemy ≤40K / 1–4 MiB / 1–2 materials / 1K maps; boss ≤50K / 2–8 MiB / 1–2 materials. Environment prop target ≤10K triangles and ≤1 MiB, reusing the shared Castle colormap/material. These targets are based on current 22.9K–40.8K defenders, 21.3K–44.9K enemies and 0.33 MiB total Castle set; larger bosses may exceed the normal unit budget only with a clear visual role.
- Animation budget guidance from the existing Ranger/UAL rig: keep typical humanoids around 50–70 joints (Ranger uses 65); aim for no more than ~5–8 gameplay clips per unit and extract only needed clips rather than shipping a whole library. Reuse compatible skeletons/animation clips, bake 15–30 fps tracks with redundant keyframes removed, and validate bone names/hierarchy and `AssetContainer` cloning. Keep skeleton/skin data intact; the current static optimized unit GLBs have no skins, so test any compression separately before applying it to animated assets.
- Future content partitioning: current runtime manifest groups defenders, enemies, environment, UI and fallback/animation; the 13 Castle GLBs plus one shared colormap are the only environment payload used by all three maps. Keep later factions, map-specific terrain, and bosses in separate groups and load only the selected faction/map or wave-near boss. Enemy templates already load by current/upcoming wave at runtime; the build manifest still includes every currently reachable type. No remote content delivery or service worker was added. Vite hashes JS/CSS; public GLBs use stable paths, so future cache-safe updates should version filenames or add an explicit asset-version policy. A service worker can improve repeat visits but risks stale builds and will not reduce package size, so defer it.
- The renderer uses `AssetContainer` templates with Babylon's scene-instantiation path, which creates per-instance skeleton/animation state while sharing imported geometry/material references. Keep that pattern for future animated defenders; do not share a mutable skeleton itself between units. For multiplayer-scale counts, profile entity scans and shadow-map refresh separately—the current 16-enemy active-wave cap and small tower counts have not justified changing gameplay loops.
- Runtime diagnostics remain opt-in: `?perfDebug=1` records FPS/frame time, mesh/skeleton/effect/shadow counts; `?waveDebug=1` exposes enemy template/scene audits. The browser smoke test now records startup marks and a headless SwiftShader scene sample; those FPS numbers are diagnostic only and are not phone-GPU benchmarks.
- `npm run audit:assets` regenerates the file-level report; `npm run build` prints production size by category and advisory budgets (160 MiB soft total, 12 MiB GLB, 2 MiB raster). At this audit, source packs are `3D/` 308 MiB, `Background/` 161 MiB, `Quaternius/` 688 MiB and UAL 61 MiB; `dist/` is 41.87 MiB and the working directory is about 2.77 GiB including dependencies/build/Git. No project asset file exceeds 50 MiB; `.git` contains a ~552 MiB pack, with the Git object store around 704 MiB. Avoid adding raw source packs or rewriting Git history automatically; Git LFS/history cleanup may be worth planning before more source art is committed.
- App Store reality: this is a static web build, not a native iOS/Android package. A wrapper would start around the 41.87 MiB raw `dist/` size plus native shell; HTTP compression mainly helps the 7.54 MiB JS/CSS, while already-compressed GLBs/images remain near raw size. Browser initial UI remains ~81.6 KiB JS; battlefield load is deferred. For a native package, include only core UI/common units and download faction/map/boss groups on demand later; do not count gzip as installed-size savings. No audio files or service worker currently exist.

## Animated Monster Pack POC

- Local audit and browser measurements: `docs/animated-monster-pack-audit.md`.
- Skeleton King uses Quaternius Animated Monster Pack `Skeleton.fbx`; Idle, Running and Death play from visual state, and Attack is mapped for future enemy attack actions. The rest of the enemy roster keeps its existing optimized GLBs; the static Skeleton King GLB remains the fallback.
- FBX is loaded only when this enemy enters the progressive wave preload. Per-instance skeletons/clips are disposed with the visual; at most 12 short-lived death visuals are retained.
- To rerun the browser animation/stress check, start Vite and run `npm run test:enemy-animation` (headless Chrome; optional `TD_TEST_URL` overrides the default local URL). Its 25/50/100 headless FPS readings use SwiftShader and are not physical-device performance claims.

## Meshy Goblin locomotion

- Only the standard Goblin uses `3D/Goblin/Meshy_AI_Bloodfang_Marauder_biped/Meshy_AI_Bloodfang_Marauder_biped_Animation_Casual_Walk_withSkin.glb`; its own `Casual_Walk` is the only imported movement clip. The optimized runtime GLB is cached with Babylon's enemy templates; the optimized static Goblin remains its fallback.
- Regenerate the runtime model with `powershell -ExecutionPolicy Bypass -File scripts/optimize-meshy-goblin.ps1`. Run `node scripts/audit-meshy-goblin.mjs` to compare source/runtime rig, clip, texture and triangle metadata. The runtime file is included in `scripts/runtime-asset-manifest.json`.
- Future same-rig Meshy clip and multi-clip guidance: [`docs/meshy-enemy-animation-pipeline.md`](docs/meshy-enemy-animation-pipeline.md).
