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

- 10×12 grid med spawn til venstre og exit til højre.
- Tap/click bygger Basic Towers for 10 gold, med 100 gold fra start.
- Tower-placering afvises, hvis den lukker den sidste gyldige rute.
- BFS-stien vises visuelt og opdateres efter hver gyldig placering.
- Hover eller drag over et felt viser en diskret gron/rod placement-preview. Et ugyldigt tap giver desuden en kort rod markering og forklarende tekst.
- Start Wave spawner 10 enemies med 650 ms mellem spawns. Deres rute fryses som et path-snapshot ved wave-start.
- Enemies bevæger sig med delta-time-baseret core-logik, følger spillerens maze og koster et life ved exit.
- UI viser wave og resterende enemies (inklusive dem, der endnu ikke er spawned). Bygning er låst under en aktiv wave.
- Basic Towers angriber automatisk med separat cooldown, 110 range, 25 damage og 1 angreb pr. sekund.
- Towers prioriterer den enemy, der er længst fremme på wave-ruten. Dræbte enemies giver 2 gold, og Phaser viser en kort hit-linje.

## Naturlige næste skridt

Tilføj flere tower-typer, wave-skalering, tower-opgraderinger samt bedre feedback for skud og skade. Game-kernen er bevidst uden Phaser-imports, så den kan genbruges i en senere Unity/C#- eller C++-port.
