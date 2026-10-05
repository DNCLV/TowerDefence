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
- Enemy HP, speed multipliers, rewards, and leak damage are defined per archetype in `src/game/config/EnemyConfig.ts`; HP never scales by wave.
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

## Build and GitHub Pages

- Development: `npm install`, then `npm run dev`.
- Production build: `npm run build` (TypeScript check + Vite build).
- GitHub Pages deploys automatically on pushes to `main`; run it manually from the Actions tab with `Deploy GitHub Pages` → `Run workflow`.
- Production assets use the `/TowerDefence/` base path. The expected URL is `https://<USERNAME>.github.io/TowerDefence/`.
- Runtime models, textures, and UI images are served from `public/assets/`. Raw source art packs are ignored by Git; the runtime copies remain included.
- The first setup may require selecting **Settings → Pages → Build and deployment → Source: GitHub Actions**.
