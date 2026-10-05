import assert from "node:assert/strict";
const [{ GameState }, enemyModule, waveModule, visualModule, towerModule, constantsModule, defenderModule] = await Promise.all([
  import("../src/game/GameState.ts"),
  import("../src/game/enemies/Enemy.ts"),
  import("../src/game/config/WaveConfig.ts"),
  import("../src/game/rendering3d/EnemyVisualConfig.ts"),
  import("../src/game/towers/Tower.ts"),
  import("../src/core/GameConstants.ts"),
  import("../src/game/config/DefenderConfig.ts"),
]);
const { MAPS } = await import("../src/game/config/MapConfig.ts");
const { getMapPreviewGeometry } = await import("../src/game/config/MapPreview.ts");
const { groundFootprintToLogicalBounds, logicalMapPointToMinimap } = await import("../src/game/minimap/MinimapCoordinates.ts");
const { VISUAL_CONFIG } = await import("../src/game/rendering3d/VisualConfig.ts");
const { traceBoundary, triangulate } = await import("../src/game/rendering3d/TerrainCliffRenderer.ts");
const { TILE_SIZE_3D } = await import("../src/game/rendering3d/Grid3D.ts");
const originalLog = console.log;
const originalInfo = console.info;
console.log = () => {};
console.info = () => {};

try {
  const mapMetrics = [];
  let totalTerrainFormations = 0;
  const cellBounds = (cells) => ({
    minX: Math.min(...cells.map(({ x }) => x)), maxX: Math.max(...cells.map(({ x }) => x)),
    minY: Math.min(...cells.map(({ y }) => y)), maxY: Math.max(...cells.map(({ y }) => y)),
  });
  const countTurns = (route) => route.reduce((turns, current, index) => {
    if (index < 2) return turns;
    const previous = route[index - 2], before = route[index - 1];
    return turns + (before.x - previous.x !== current.x - before.x || before.y - previous.y !== current.y - before.y ? 1 : 0);
  }, 0);
  const minimapBounds = groundFootprintToLogicalBounds(
    [{ x: 3, z: 4 }, { x: 9, z: 4 }, { x: 9, z: 24 }, { x: 3, z: 24 }], TILE_SIZE_3D,
  );
  assert.deepEqual(minimapBounds, { x: 3, y: 4, width: 6, height: 20 }, "world Z maps directly to logical top-to-bottom grid Y");
  const minimapRect = { x: 4, y: 4, width: 144, height: 220 };
  const minimapTop = logicalMapPointToMinimap({ x: 36, y: 8 }, 72, 110, minimapRect);
  const minimapBottom = logicalMapPointToMinimap({ x: 36, y: 102 }, 72, 110, minimapRect);
  assert.ok(minimapTop.y < minimapBottom.y, "increasing logical grid Y moves down the minimap, never up");
  assert.equal(minimapTop.x, minimapBottom.x, "matching logical X remains vertically aligned on the minimap");
  const { createEnemy } = enemyModule;
  const { ENEMY_VISUAL_CONFIG } = visualModule;
  const { getEnemyHpForWave, getEnemyHpMultiplier, getEnemyHpTier } = enemyModule;
  const {
    ENEMY_THREAT_WEIGHT, MAX_ACTIVE_WAVE_ENEMIES, MIN_SPAWN_INTERVAL, getWaveComposition, createWaveSpawnQueue,
    countWaveComposition, getWaveSpawnInterval, getWaveThreatBudget, getWaveRewardMultiplier,
    getWaveGoldReward,
  } = waveModule;
  const { createBasicTower, canTowerTargetEnemy, getTotalTowerInvestment, getTowerSellRefund } = towerModule;
  const { WORLD_UNITS_PER_CELL } = constantsModule;
  const { DEFENDER_CONFIG } = defenderModule;

  // Retired map-topology assertions are kept below for reference; current map
  // geometry is covered by test-map-adjustments.mjs.
  if (false) {
  for (const [mapId, expectedName, expectedGold, multiplier, expectedSpawnCells, expectedGoalCell, expectedWidth, expectedHeight, expectedTerrainCells, expectedTerrainRegions] of [
    ["single-spawn", "Open Field", 70, 1, [{ x: 8, y: 0 }], { x: 8, y: 31 }, 17, 32, 132, 2],
    ["two-spawns", "Split Advance", 110, 1.5, [{ x: 6, y: 0 }, { x: 17, y: 0 }], { x: 11, y: 40 }, 23, 41, 357, 3],
    ["three-spawns", "Triple Convergence", 150, 2, [{ x: 8, y: 0 }, { x: 21, y: 0 }, { x: 35, y: 0 }], { x: 21, y: 65 }, 43, 66, 1041, 7],
  ]) {
    const mapState = new GameState(mapId);
    const map = MAPS[mapId];
    const expectedSpawnCount = expectedSpawnCells.length;
    assert.equal(map.name, expectedName, `${mapId} uses its approved map name`);
    assert.equal(mapState.gold, expectedGold, `${mapId} initializes its configured gold`);
    assert.equal(map.width, expectedWidth, `${mapId} uses the redesigned map width`);
    assert.equal(map.height, expectedHeight, `${mapId} uses the redesigned map height`);
    assert.equal(mapState.layout.activeSpawns.length, expectedSpawnCount, `${mapId} has the configured entry count`);
    assert.equal(map.terrain.length, expectedTerrainCells, `${mapId} has only its configured large terrain formations`);
    assert.equal(map.terrainRegions.length, expectedTerrainRegions, `${mapId} contains only the approved terrain masses`);
    assert.equal(mapState.spawnPaths.size, expectedSpawnCount, `${mapId} has a path from every entry`);
    assert.deepEqual(map.layout.activeSpawns.map(({ gateCell }) => gateCell), expectedSpawnCells, `${mapId} spawn gate coordinates are fixed`);
    assert.deepEqual(map.layout.castle.gateCell, expectedGoalCell, `${mapId} goal gate coordinate is fixed`);
    const terrainKeys = new Set(map.terrain.map(({ x, y }) => `${x},${y}`));
    const preview = getMapPreviewGeometry(map);
    const previewCells = preview.terrain.flatMap(({ x, y, width, height }) =>
      Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, column) => `${x + column},${y + row}`)).flat());
    assert.equal(preview.width, map.width, `${mapId} preview uses the gameplay grid width`);
    assert.equal(preview.height, map.height, `${mapId} preview uses the gameplay grid height`);
    assert.equal(new Set(previewCells).size, previewCells.length, `${mapId} preview terrain rectangles do not overlap`);
    assert.deepEqual(new Set(previewCells), terrainKeys, `${mapId} preview blocked footprint exactly matches gameplay terrain`);
    assert.deepEqual(preview.spawns.map(({ cell }) => cell), map.layout.activeSpawns.map(({ gateCell }) => gateCell),
      `${mapId} preview spawn markers use gameplay gate coordinates`);
    assert.deepEqual(preview.goal, map.layout.castle.gateCell, `${mapId} preview goal marker uses gameplay gate coordinates`);
    const regionKeys = new Set(map.terrainRegions.flatMap((region) => region.cells.map(({ x, y }) => `${x},${y}`)));
    assert.deepEqual(regionKeys, terrainKeys, `${mapId} visual terrain regions match the pathfinding terrain mask`);
    assert.equal(terrainKeys.size, map.terrain.length, `${mapId} has no duplicate blocked cells`);
    assert.ok(map.terrain.every(({ x, y }) => x >= 0 && x < map.width && y >= 0 && y < map.height), `${mapId} terrain stays within map bounds`);
    if (map.terrain.length > 0) {
      const sampleMountainCell = map.terrain[0];
      assert.equal(mapState.grid.isBuildable(sampleMountainCell), false, `${mapId} mountain terrain blocks building`);
      assert.equal(mapState.canPlaceBasicTower(sampleMountainCell), "invalid-cell", `${mapId} mountain footprint rejects tower placement`);
    }
    const adjacentBuildCell = map.terrain.flatMap(({ x, y }) => [
      { x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 },
    ]).find((cell) => mapState.grid.isBuildable(cell) && mapState.canPlaceBasicTower(cell) === "placed");
    assert.ok(adjacentBuildCell, `${mapId} allows tower placement directly next to a mountain edge`);
    const reservedCells = new Set([
      ...map.layout.activeSpawns.flatMap(({ gateCell, entryCell }) => [gateCell, entryCell]),
      map.layout.castle.gateCell, map.layout.castle.approachCell,
    ].map(({ x, y }) => `${x},${y}`));
    for (const key of reservedCells) assert.equal(terrainKeys.has(key), false, `${mapId} terrain does not cover spawn/goal cells`);
    const buildableCells = map.width * map.height - terrainKeys.size - reservedCells.size;
    const buildableRatio = buildableCells / (map.width * map.height);
    const minimumBuildableRatio = mapId === "single-spawn" ? 0.75 : mapId === "two-spawns" ? 0.58 : 0.63;
    assert.ok(buildableRatio >= minimumBuildableRatio,
      `${mapId} preserves broad player-built maze space (${Math.round(buildableRatio * 100)}%)`);
    if (mapId === "single-spawn") {
      const leftMountain = map.terrainRegions.find(({ id }) => id === "left-mountain");
      const rightMountain = map.terrainRegions.find(({ id }) => id === "right-mountain");
      assert.ok(leftMountain && rightMountain, "Open Field has exactly its two side mountain masses");
      assert.deepEqual(cellBounds(leftMountain.cells), { minX: 0, maxX: 4, minY: 9, maxY: 44 });
      assert.deepEqual(cellBounds(rightMountain.cells), { minX: 23, maxX: 27, minY: 9, maxY: 44 });
      assert.ok(mapState.grid.isBuildable({ x: 14, y: 27 }), "Open Field retains its open central build corridor");
      assert.ok(mapState.spawnPaths.get("spawn-north").every(({ x }) => x === 14), "the single-spawn route remains straight through the open center");
    }
    for (const spawn of mapState.layout.activeSpawns) assert.equal(mapState.grid.isBuildable(spawn.gateCell), false, `${mapId} protects spawn gate cells`);
    assert.equal(mapState.grid.isBuildable(mapState.layout.castle.gateCell), false, `${mapId} protects the castle gate cell`);
    mapMetrics.push({ mapId, dimensions: `${map.width}x${map.height}`, total: map.width * map.height,
      spawnGates: map.layout.activeSpawns.map(({ id, gateCell }) => ({ id, ...gateCell })), goalGate: map.layout.castle.gateCell,
      terrain: terrainKeys.size, reserved: reservedCells.size, buildable: buildableCells,
      buildablePct: Number((buildableRatio * 100).toFixed(1)), blockedPct: Number((100 * (terrainKeys.size + reservedCells.size) / (map.width * map.height)).toFixed(1)),
      previewTerrainRects: preview.terrain.length,
      terrainRegions: map.terrainRegions.map((region) => ({
        id: region.id, cells: region.cells.length,
        x: [Math.min(...region.cells.map(({ x }) => x)), Math.max(...region.cells.map(({ x }) => x))],
        y: [Math.min(...region.cells.map(({ y }) => y)), Math.max(...region.cells.map(({ y }) => y))],
      })) });
    const terrainByKey = new Map(map.terrain.map((cell) => [`${cell.x},${cell.y}`, cell]));
    const unvisited = new Set(terrainByKey.keys());
    while (unvisited.size > 0) {
      const first = unvisited.values().next().value;
      const pending = [first], component = [];
      unvisited.delete(first);
      for (let index = 0; index < pending.length; index += 1) {
        const cell = terrainByKey.get(pending[index]);
        component.push(cell);
        for (const [x, y] of [[cell.x - 1, cell.y], [cell.x + 1, cell.y], [cell.x, cell.y - 1], [cell.x, cell.y + 1]]) {
          const key = `${x},${y}`;
          if (unvisited.delete(key)) pending.push(key);
        }
      }
      const outline = traceBoundary(component);
      const triangles = triangulate(outline);
      assert.ok(outline.length >= 3 && triangles.length === (outline.length - 2) * 3,
        `${mapId} terrain formation has a closed, filled plateau mesh outline`);
      assert.ok(outline.every(({ x, z }) => Number.isInteger(x / TILE_SIZE_3D) && Number.isInteger(z / TILE_SIZE_3D)),
        `${mapId} rendered terrain vertices sit on grid intersections`);
      assert.ok(outline.every((point, index) => {
        const next = outline[(index + 1) % outline.length];
        return point.x === next.x || point.z === next.z;
      }), `${mapId} terrain edges follow grid lines with no diagonal cuts`);
      const footprintArea = Math.abs(outline.reduce((area, point, index) => {
        const next = outline[(index + 1) % outline.length];
        return area + point.x * next.z - next.x * point.z;
      }, 0) / 2);
      assert.equal(footprintArea, component.length,
        `${mapId} rendered plateau covers exactly the source blocked-cell area`);
      totalTerrainFormations += 1;
    }
    for (const spawn of mapState.layout.activeSpawns) {
      const route = mapState.spawnPaths.get(spawn.id);
      assert.ok(route && route.length > 1, `${mapId}/${spawn.id} has a valid route`);
      assert.deepEqual(route[0], spawn.entryCell);
      assert.deepEqual(route.at(-1), mapState.exit, "all routes reach the one shared castle approach");
    }
    if (expectedSpawnCount > 1) {
      const routes = [...mapState.spawnPaths.values()];
      const sharedCells = routes[0].filter((cell) => routes.slice(1).every((route) => route.some((candidate) => candidate.x === cell.x && candidate.y === cell.y)));
      assert.ok(sharedCells.length >= (expectedSpawnCount === 2 ? 8 : 7), `${mapId} routes converge into a shared lower area`);
    }
    assert.equal(mapState.startWave(), true);
    const scaledWaveOne = Math.max(1, Math.round(12 * multiplier));
    assert.equal(mapState.enemiesRemaining, scaledWaveOne, `${mapId} applies its enemy count multiplier`);
    mapState.update(0);
    const initialSpawnCounts = new Map(mapState.layout.activeSpawns.map(({ id }) => [id, 0]));
    const countedEnemies = new Set();
    const recordSpawned = () => {
      for (const enemy of mapState.enemies) {
        if (countedEnemies.has(enemy.id)) continue;
        countedEnemies.add(enemy.id);
        const spawnId = mapState.layout.activeSpawns.find(({ entryCell }) => entryCell.x === enemy.path[0].x && entryCell.y === enemy.path[0].y)?.id;
        assert.ok(spawnId, `${mapId} enemy starts on a configured entry route`);
        initialSpawnCounts.set(spawnId, initialSpawnCounts.get(spawnId) + 1);
        enemy.speed = 0;
      }
    };
    recordSpawned();
    for (let tick = 0; tick < 5; tick += 1) {
      mapState.update(0.71);
      recordSpawned();
    }
    const distributedCounts = [...initialSpawnCounts.values()];
    assert.ok(Math.max(...distributedCounts) - Math.min(...distributedCounts) <= 1,
      `${mapId} distributes its first spawns evenly across its entries`);
  }
  }
  // The former map-topology block below targeted the retired 28x54/38x68/72x110
  // layouts. Map geometry is now covered by test-map-adjustments.mjs.
  if (false) {
  const singleMazeState = new GameState("single-spawn");
  singleMazeState.gold = 5000;
  for (const [y, gapX] of [[15, 10], [22, 18]]) {
    for (let x = 5; x <= 22; x += 1) {
      if (x === gapX) continue;
      assert.equal(singleMazeState.placeBasicTower({ x, y }), "placed", "open field supports a player-built wall with a valid gap");
    }
  }
  const singleMazePath = singleMazeState.spawnPaths.get("spawn-north");
  assert.ok(singleMazePath.some(({ x, y }) => x === 10 && y === 15)
    && singleMazePath.some(({ x, y }) => x === 18 && y === 22)
    && countTurns(singleMazePath) >= 4,
  "the single-spawn open field supports a multi-turn custom maze");
  // Camera target/pan bounds are map-size-derived; verify every corner remains inside
  // the existing fixed-angle camera safety envelope at all zoom stops and both layouts.
  for (const map of Object.values(MAPS)) {
    for (const radius of [VISUAL_CONFIG.minCameraRadius, VISUAL_CONFIG.defaultCameraRadius, VISUAL_CONFIG.maxCameraRadius]) {
      const cameraExtent = radius + 1.5;
      const offsetX = radius * Math.cos(VISUAL_CONFIG.defaultCameraAlpha) * Math.sin(VISUAL_CONFIG.defaultCameraBeta);
      const offsetZ = radius * Math.sin(VISUAL_CONFIG.defaultCameraAlpha) * Math.sin(VISUAL_CONFIG.defaultCameraBeta);
      for (const [targetX, targetZ] of [[0, 0], [map.width, 0], [0, map.height], [map.width, map.height]]) {
        const cameraX = targetX + offsetX;
        const cameraZ = targetZ + offsetZ;
        assert.ok(cameraX >= -cameraExtent && cameraX <= map.width + cameraExtent, `${map.id} camera can reach a horizontal map corner`);
        assert.ok(cameraZ >= -cameraExtent && cameraZ <= map.height + cameraExtent, `${map.id} camera can reach a vertical map corner`);
        assert.ok(radius * Math.cos(VISUAL_CONFIG.defaultCameraBeta) >= 8.5, `${map.id} keeps the minimum safe camera height`);
      }
    }
  }
  // Collect configured ground routes deterministically without tower combat noise.
  function collectSpawnRoutes(mapId, total) {
    const state = new GameState(mapId);
    state.waveActive = true;
    state.spawnQueue = Array(total).fill("goblin");
    state.toSpawn = total;
    state.spawnTimer = 0;
    state.nextMidLane = 0;
    state.enemyMidLanes.clear();
    const routes = [];
    for (let tick = 0; routes.length < total && tick < total + 2; tick += 1) {
      state.update(tick === 0 ? 0 : 0.66);
      routes.push(...state.enemies.map((enemy) => enemy.path.map((cell) => ({ ...cell }))));
      state.enemies = [];
    }
    assert.equal(routes.length, total, `${mapId} spawns all requested ground enemies`);
    return { state, routes };
  }
  const { state: twoSpawnState, routes: twoSpawnRoutes } = collectSpawnRoutes("two-spawns", 20);
  const twoOriginCounts = new Map(MAPS["two-spawns"].layout.activeSpawns.map(({ id }) => [id, 0]));
  for (const route of twoSpawnRoutes) {
    const spawn = MAPS["two-spawns"].layout.activeSpawns.find(({ entryCell }) => entryCell.x === route[0].x && entryCell.y === route[0].y);
    assert.ok(spawn);
    twoOriginCounts.set(spawn.id, twoOriginCounts.get(spawn.id) + 1);
    assert.deepEqual(route.at(-1), twoSpawnState.exit, "both two-spawn fronts reach the shared goal");
  }
  assert.deepEqual([...twoOriginCounts.values()], [10, 10], "20 ground enemies split 10/10 across two spawns");
  const [twoLeftRoute, twoRightRoute] = [twoSpawnRoutes[0], twoSpawnRoutes[1]];
  let twoSharedSuffix = 0;
  while (twoSharedSuffix < twoLeftRoute.length && twoSharedSuffix < twoRightRoute.length) {
    const leftCell = twoLeftRoute[twoLeftRoute.length - 1 - twoSharedSuffix];
    const rightCell = twoRightRoute[twoRightRoute.length - 1 - twoSharedSuffix];
    if (leftCell.x !== rightCell.x || leftCell.y !== rightCell.y) break;
    twoSharedSuffix += 1;
  }
  const twoMergeRoutePercent = 1 - twoSharedSuffix / ((twoLeftRoute.length + twoRightRoute.length) / 2);
  assert.ok(twoMergeRoutePercent >= 0.72 && twoMergeRoutePercent <= 0.84,
    `two-spawn fronts stay distinct for about three quarters of the route (${Math.round(twoMergeRoutePercent * 100)}%)`);
  assert.ok(twoSharedSuffix >= 10, "two-spawn fronts share a substantial lower convergence area");
  const twoMap = MAPS["two-spawns"];
  const twoDivider = twoMap.terrainRegions.find(({ id }) => id === "central-split-ridge");
  assert.ok(twoDivider && Math.max(...twoDivider.cells.map(({ y }) => y)) === MAPS["two-spawns"].finalLaneTarget.y - 5,
    "two-spawn central ridge ends four open rows before the widened y=51 merge field");
  assert.equal(new Set(twoDivider.cells.map(({ x }) => x)).size, 6, "two-spawn central divider is six cells wide (50% wider than before)");
  assert.equal(MAPS["two-spawns"].finalLaneTarget.y / MAPS["two-spawns"].height, 0.75,
    "two-spawn fronts remain split for 75% of the map length");
  const twoSideMountains = ["left-side-funnel-mountain", "right-side-funnel-mountain"]
    .map((id) => twoMap.terrainRegions.find((region) => region.id === id));
  assert.ok(twoSideMountains.every((region) => region
    && Math.min(...region.cells.map(({ y }) => y)) === 0
    && Math.max(...region.cells.map(({ y }) => y)) === 63), "upper side walls and lower funnel masses retain their approved extents");
  assert.equal(new Set(twoSideMountains[0].cells.map(({ x }) => x)).size, 11);
  assert.equal(new Set(twoSideMountains[1].cells.map(({ x }) => x)).size, 11);
  for (let y = 0; y <= 50; y += 1) {
    for (let x = 0; x <= 3; x += 1) assert.equal(twoSpawnState.grid.isTerrain({ x, y }), true, "four-cell left outer cliff stays continuous along the upper lane");
    for (let x = 34; x <= 37; x += 1) assert.equal(twoSpawnState.grid.isTerrain({ x, y }), true, "four-cell right outer cliff stays continuous along the upper lane");
  }
  for (let y = 47; y <= 54; y += 1) for (let x = 4; x <= 33; x += 1) {
    assert.equal(twoSpawnState.grid.isBuildable({ x, y }), true, "the divider ends before an eight-row central transition field");
  }
  for (let y = 51; y <= 54; y += 1) for (let x = 0; x < twoMap.width; x += 1) {
    assert.equal(twoSpawnState.grid.isBuildable({ x, y }), true, "four full-width rows separate the outer walls and lower masses");
  }
  for (let y = 55; y <= 63; y += 1) for (let x = 11; x <= 26; x += 1) {
    assert.equal(twoSpawnState.grid.isTerrain({ x, y }), false, "the centered 16-cell final funnel remains open");
  }
  assert.equal(Array.from({ length: 16 }, (_, index) => index + 11)
    .filter((x) => twoSpawnState.grid.isBuildable({ x, y: 59 })).length, 16,
  "the two-spawn final funnel is sixteen buildable cells wide across nine rows");
  assert.ok(Array.from({ length: 12 }, (_, index) => index + 4).every((x) => twoSpawnState.grid.isBuildable({ x, y: 24 })),
    "left two-spawn lane retains a 12-cell-wide open build area");
  assert.ok(Array.from({ length: 12 }, (_, index) => index + 22).every((x) => twoSpawnState.grid.isBuildable({ x, y: 24 })),
    "right two-spawn lane retains a 12-cell-wide open build area");
  assert.ok(twoSpawnState.canPlaceBasicTower({ x: 5, y: 24 }) === "placed", "left broad maze zone supports legal building");
  assert.ok(twoSpawnState.canPlaceBasicTower({ x: 32, y: 24 }) === "placed", "right broad maze zone supports legal building");
  const twoMazeState = new GameState("two-spawns");
  twoMazeState.gold = 10000;
  const twoLaneBarriers = [
    { spawnId: "spawn-north-west", firstX: 4, lastX: 15, gaps: [5, 11, 6] },
    { spawnId: "spawn-north-east", firstX: 22, lastX: 33, gaps: [32, 26, 32] },
  ];
  const twoTurnsBefore = new Map(twoLaneBarriers.map(({ spawnId }) => [spawnId, countTurns(twoMazeState.spawnPaths.get(spawnId))]));
  for (const lane of twoLaneBarriers) {
    for (const [rowIndex, y] of [12, 18, 24].entries()) {
      for (let x = lane.firstX; x <= lane.lastX; x += 1) {
        if (x === lane.gaps[rowIndex]) continue;
        assert.equal(twoMazeState.placeBasicTower({ x, y }), "placed", `${lane.spawnId} keeps a legal winding gap at row ${y}`);
      }
    }
    const addedTurns = countTurns(twoMazeState.spawnPaths.get(lane.spawnId)) - twoTurnsBefore.get(lane.spawnId);
    assert.ok(addedTurns >= 4, `${lane.spawnId} supports several meaningful player-built turns`);
  }
  const twoMergeMaze = new GameState("two-spawns");
  twoMergeMaze.gold = 10000;
  const twoMergeTurnsBefore = countTurns(twoMergeMaze.spawnPaths.get("spawn-north-west"));
  for (const [rowIndex, y] of [50, 52, 54].entries()) {
    const gap = [19, 30, 12][rowIndex];
    const firstX = y <= 50 ? 4 : 0;
    const lastX = y <= 50 ? 33 : twoMap.width - 1;
    for (let x = firstX; x <= lastX; x += 1) {
      if (x === gap) continue;
      assert.equal(twoMergeMaze.placeBasicTower({ x, y }), "placed", `wide two-spawn merge permits a maze wall at row ${y}`);
    }
  }
  assert.ok(countTurns(twoMergeMaze.spawnPaths.get("spawn-north-west")) - twoMergeTurnsBefore >= 4,
    "the widened two-spawn shared approach supports multiple player-built turns");
  const twoMergeTurnsAdded = countTurns(twoMergeMaze.spawnPaths.get("spawn-north-west")) - twoMergeTurnsBefore;

  if (false) { // Historical assertions for the retired 48x82 terrain layout.
  const { state: threeSpawnState, routes: threeSpawnRoutes } = collectSpawnRoutes("three-spawns", 30);
  const threeMap = MAPS["three-spawns"];
  const threeOriginCounts = new Map(MAPS["three-spawns"].layout.activeSpawns.map(({ id }) => [id, 0]));
  const gateCounts = [0, 0];
  for (const route of threeSpawnRoutes) {
    const spawn = threeMap.layout.activeSpawns.find(({ entryCell }) => entryCell.x === route[0].x && entryCell.y === route[0].y);
    assert.ok(spawn);
    threeOriginCounts.set(spawn.id, threeOriginCounts.get(spawn.id) + 1);
    const lane = threeMap.midLaneTargets.findIndex((target) => route.some(({ x, y }) => x === target.x && y === target.y));
    assert.ok(lane >= 0, `${spawn.id} ground route uses one of the two controlled lower openings`);
    gateCounts[lane] += 1;
    assert.ok(route.every(({ x, y }) => y < 57 || y > 60 || (lane === 0 ? x <= 22 : x >= 25)),
      `${spawn.id} stays on its assigned side of the final central tongue`);
    assert.deepEqual(route.at(-1), threeSpawnState.exit, "three-spawn route reaches the shared castle approach");
    assert.ok(route.some(({ x, y }) => x === threeMap.finalLaneTarget.x && y === threeMap.finalLaneTarget.y),
      "three-spawn route traverses the configured final approach waypoint");
  }
  assert.deepEqual([...threeOriginCounts.values()], [10, 10, 10], "30 ground enemies distribute 10/10/10 across spawn origins");
  assert.deepEqual(gateCounts, [15, 15], "ground enemies are evenly assigned across both controlled lower openings");
  for (const y of [8, 20, 26]) {
    for (const [startX, endX, laneName, minimumOpenCells] of [[4, 13, "left", 10], [19, 28, "center", 10], [34, 43, "right", 10]]) {
      const openCells = Array.from({ length: endX - startX + 1 }, (_, index) => startX + index)
        .filter((x) => threeSpawnState.grid.isBuildable({ x, y })).length;
      assert.ok(openCells >= minimumOpenCells, `${laneName} early maze zone remains broad at row ${y}`);
    }
  }
  const westDivider = threeMap.terrainRegions.find(({ id }) => id === "west-center-divider");
  const eastDivider = threeMap.terrainRegions.find(({ id }) => id === "center-east-divider");
  const centralMountain = threeMap.terrainRegions.find(({ id }) => id === "central-mid-mountain");
  const sideMountains = ["left-side-mountain", "right-side-mountain"]
    .map((id) => threeMap.terrainRegions.find((region) => region.id === id));
  assert.ok(westDivider && eastDivider && centralMountain && sideMountains.every(Boolean));
  assert.deepEqual(threeMap.terrainRegions.map(({ id }) => id).sort(), [
    "center-east-divider", "central-mid-mountain", "left-side-mountain", "right-side-mountain", "west-center-divider",
  ], "three-spawn contains only the five required mountain formations");
  assert.equal(new Set(westDivider.cells.map(({ x }) => x)).size, 5, "three-spawn west divider is five cells wide (67% wider than before)");
  assert.equal(new Set(eastDivider.cells.map(({ x }) => x)).size, 5, "three-spawn east divider is five cells wide (67% wider than before)");
  assert.ok(sideMountains.every((region) => Math.min(...region.cells.map(({ y }) => y)) === 0
    && Math.max(...region.cells.map(({ y }) => y)) === 75), "three-spawn outer walls and lower masses retain separated elevations");
  assert.ok(sideMountains.every((region) => new Set(region.cells.map(({ x }) => x)).size === 8),
    "three-spawn lower masses leave a broad shared final field");
  for (let y = 0; y <= 55; y += 1) {
    for (let x = 0; x <= 3; x += 1) assert.equal(threeSpawnState.grid.isTerrain({ x, y }), true, "four-cell left outer cliff continuously frames the early and middle map");
    for (let x = 44; x <= 47; x += 1) assert.equal(threeSpawnState.grid.isTerrain({ x, y }), true, "four-cell right outer cliff continuously frames the early and middle map");
  }
  const westDividerEnd = Math.max(...westDivider.cells.map(({ y }) => y));
  assert.equal(westDividerEnd, 28, "three upper lanes stay separated for at least 35% of map height");
  assert.equal(Math.max(...eastDivider.cells.map(({ y }) => y)), 28, "both top dividers have the same fixed length");
  assert.ok(Array.from({ length: 9 }, (_, row) => row + 29).every((y) =>
    Array.from({ length: 40 }, (_, column) => column + 4).every((x) => threeSpawnState.grid.isBuildable({ x, y })) ),
  "three-spawn dividers end before a broad 40-by-9 transition area");
  assert.ok(Array.from({ length: 19 }, (_, row) => row + 38).every((y) =>
    Array.from({ length: 12 }, (_, column) => column + 18).every((x) => threeSpawnState.grid.isTerrain({ x, y }))),
  "the broad center mountain fully closes the middle section");
  assert.ok(Array.from({ length: 4 }, (_, row) => row + 57).every((y) =>
    [23, 24].every((x) => threeSpawnState.grid.isTerrain({ x, y }))),
  "the short central tongue separates two lower approaches for four rows");
  assert.ok(Array.from({ length: 5 }, (_, row) => row + 61).every((y) =>
    Array.from({ length: threeMap.width }, (_, x) => x).every((x) => threeSpawnState.grid.isBuildable({ x, y })) ),
  "the central block ends five completely open rows before the lower side masses");
  assert.ok(Array.from({ length: 10 }, (_, row) => row + 66).every((y) =>
    Array.from({ length: 8 }, (_, x) => x).every((x) => threeSpawnState.grid.isTerrain({ x, y }))
      && Array.from({ length: 8 }, (_, x) => x + 40).every((x) => threeSpawnState.grid.isTerrain({ x, y })) ),
  "lower side masses are separated from the central mountain by a broad buildable transition");
  assert.deepEqual(threeMap.midLaneTargets, [{ x: 16, y: 62 }, { x: 31, y: 62 }],
    "enemy routes are assigned to the two defined lower openings");
  assert.deepEqual(threeMap.convergenceOpenings, threeMap.midLaneTargets);
  for (const opening of threeMap.convergenceOpenings) {
    assert.equal(threeSpawnState.grid.isTerrain(opening), false, "each controlled opening is buildable terrain space");
  }
  assert.ok(Array.from({ length: 5 }, (_, row) => row + 76).every((y) =>
    Array.from({ length: 48 }, (_, x) => x).every((x) => threeSpawnState.grid.isBuildable({ x, y }))),
  "the shared final goal area below row 75 stays completely open");
  const threeRoutePhasePercentages = {
    threeSeparateLanes: Number(((westDividerEnd + 1) / threeMap.height * 100).toFixed(1)),
    upperOpenTransition: Number((9 / threeMap.height * 100).toFixed(1)),
    centralMountain: Number((23 / threeMap.height * 100).toFixed(1)),
    lowerOpenTransition: Number((5 / threeMap.height * 100).toFixed(1)),
    lowerSideMasses: Number((10 / threeMap.height * 100).toFixed(1)),
    finalGoalField: Number((6 / threeMap.height * 100).toFixed(1)),
  };
  for (const spawn of threeMap.layout.activeSpawns) {
    assert.ok(threeSpawnState.spawnPaths.get(spawn.id)?.length > 1, `${spawn.id} has a ground route to the common goal`);
  }
  const finalCandidates = [];
  for (let y = 74; y < threeMap.height - 2; y += 1) for (let x = 0; x < threeMap.width; x += 1) {
    if (threeSpawnState.canPlaceBasicTower({ x, y }) === "placed") finalCandidates.push({ x, y });
  }
  assert.ok(finalCandidates.length > 0, "3-spawn final shared field remains useful for maze building");
  const lowerRunLength = (startX, endX, y) => {
    let longest = 0, current = 0;
    for (let x = startX; x <= endX; x += 1) {
      if (threeSpawnState.grid.isBuildable({ x, y })) { current += 1; longest = Math.max(longest, current); }
      else current = 0;
    }
    return longest;
  };
  assert.equal(lowerRunLength(8, 39, 70), 32, "lower shared approach has a 32-cell-wide build field");
  assert.equal(lowerRunLength(0, 47, 62), 48, "lower open transition spans the full 48-cell map width");

  const threeUpperTransitionMaze = new GameState("three-spawns");
  threeUpperTransitionMaze.gold = 10000;
  const threeUpperTurnsBefore = countTurns(threeUpperTransitionMaze.spawnPaths.get("spawn-north-west"));
  for (const [rowIndex, y] of [30, 33, 36].entries()) {
    const gap = [8, 35, 11][rowIndex];
    for (let x = 4; x <= 43; x += 1) {
      if (x === gap) continue;
      assert.equal(threeUpperTransitionMaze.placeBasicTower({ x, y }), "placed", `three-spawn upper transition supports a maze row at ${y}`);
    }
  }
  const threeUpperTurnsAdded = countTurns(threeUpperTransitionMaze.spawnPaths.get("spawn-north-west")) - threeUpperTurnsBefore;
  assert.ok(threeUpperTurnsAdded >= 4, "three-spawn upper transition enables multiple additional turns");

  const threeLowerTransitionMaze = new GameState("three-spawns");
  threeLowerTransitionMaze.gold = 10000;
  const threeLowerTurnsBefore = countTurns(threeLowerTransitionMaze.spawnPaths.get("spawn-north-west"));
  for (const [rowIndex, y] of [61, 63, 65].entries()) {
    const gap = [16, 31, 17][rowIndex];
    for (let x = 0; x < threeMap.width; x += 1) {
      if (x === gap) continue;
      assert.equal(threeLowerTransitionMaze.placeBasicTower({ x, y }), "placed", `three-spawn lower transition supports a maze row at ${y}`);
    }
  }
  const threeLowerTurnsAdded = countTurns(threeLowerTransitionMaze.spawnPaths.get("spawn-north-west")) - threeLowerTurnsBefore;
  assert.ok(threeLowerTurnsAdded >= 4, "three-spawn lower transition enables multiple additional turns");

  // Alternating half-width tower barriers create a 5-cell gap that snakes between both sides.
  const mazeState = new GameState("three-spawns");
  mazeState.gold = 10000;
  const mazeRouteChanges = [];
  const lanes = [
    { spawnId: "spawn-north-west", firstX: 4, lastX: 13, gaps: [5, 11, 6] },
    { spawnId: "spawn-north", firstX: 19, lastX: 28, gaps: [27, 20, 25] },
    { spawnId: "spawn-north-east", firstX: 34, lastX: 43, gaps: [35, 42, 37] },
  ];
  const turnsBefore = new Map(lanes.map(({ spawnId }) => [spawnId, countTurns(mazeState.spawnPaths.get(spawnId))]));
  let successfulPlacements = 0;
  for (const lane of lanes) {
    for (const [rowIndex, y] of [5, 10, 15].entries()) {
      for (let x = lane.firstX; x <= lane.lastX; x += 1) {
        if (x === lane.gaps[rowIndex]) continue;
        assert.equal(mazeState.placeBasicTower({ x, y }), "placed", `${lane.spawnId} maze barrier leaves a legal gap at row ${y}`);
        successfulPlacements += 1;
      }
    }
    const turnsAfter = countTurns(mazeState.spawnPaths.get(lane.spawnId));
    const addedTurns = turnsAfter - turnsBefore.get(lane.spawnId);
    assert.ok(addedTurns >= 3,
      `${lane.spawnId} route gains at least three additional turns from player tower placements (${turnsBefore.get(lane.spawnId)} → ${turnsAfter})`);
    mazeRouteChanges.push({ spawnId: lane.spawnId, turnsBefore: turnsBefore.get(lane.spawnId), turnsAfter, added: addedTurns });
  }
  assert.equal(successfulPlacements, 81);
  assert.equal(mazeState.spawnPaths.size, 3, "all three routes remain valid after 81 legal maze placements");
  mapMetrics.push({ mazeTurns: mazeRouteChanges });
  }

  // Approved seven-rectangle 3-spawn map: exact footprint, open zones, route and maze checks.
  const { state: threeSpawnState, routes: threeSpawnRoutes } = collectSpawnRoutes("three-spawns", 30);
  const threeMap = MAPS["three-spawns"];
  const threeOriginCounts = new Map(threeMap.layout.activeSpawns.map(({ id }) => [id, 0]));
  const gateCounts = [0, 0];
  for (const route of threeSpawnRoutes) {
    const spawn = threeMap.layout.activeSpawns.find(({ entryCell }) => entryCell.x === route[0].x && entryCell.y === route[0].y);
    assert.ok(spawn);
    threeOriginCounts.set(spawn.id, threeOriginCounts.get(spawn.id) + 1);
    const lane = threeMap.midLaneTargets.findIndex((target) => route.some(({ x, y }) => x === target.x && y === target.y));
    assert.ok(lane >= 0, `${spawn.id} ground route uses a defined lower approach`);
    gateCounts[lane] += 1;
    assert.ok(route.filter(({ y }) => y >= 50 && y <= 67).every(({ x }) => x < 17 || x > 54),
      `${spawn.id} routes around, not through, the center plateau`);
    assert.deepEqual(route.at(-1), threeSpawnState.exit, "three-spawn route reaches the shared castle approach");
    assert.ok(route.some(({ x, y }) => x === threeMap.finalLaneTarget.x && y === threeMap.finalLaneTarget.y),
      "three-spawn route traverses the bottom-center waypoint");
  }
  assert.deepEqual([...threeOriginCounts.values()], [10, 10, 10], "30 ground enemies distribute 10/10/10 across spawn origins");
  assert.deepEqual(gateCounts, [15, 15], "ground enemies use both lower approaches evenly");

  const expectedThreeSpawnRectangles = [
    ["left-outer-wall", 0, 0, 5, 110], ["right-outer-wall", 67, 0, 5, 110],
    ["left-upper-divider", 21, 0, 7, 35], ["right-upper-divider", 44, 0, 7, 35],
    ["center-horizontal-plateau", 17, 50, 38, 18],
    ["lower-left-plateau", 0, 88, 28, 14], ["lower-right-plateau", 44, 88, 28, 14],
  ];
  assert.equal(threeMap.terrainRegions.length, 7, "three-spawn uses exactly seven terrain formations");
  for (const [index, [id, x, y, width, height]] of expectedThreeSpawnRectangles.entries()) {
    const region = threeMap.terrainRegions[index];
    assert.equal(region.id, id, `formation ${index + 1} has its approved identity`);
    assert.deepEqual(cellBounds(region.cells), { minX: x, maxX: x + width - 1, minY: y, maxY: y + height - 1 },
      `${id} has the exact grid-aligned bounds`);
    assert.equal(region.cells.length, width * height, `${id} is a filled rectangle`);
  }
  assert.equal(threeMap.terrain.length, 2918, "the seven footprints contain exactly 2,918 unique blocked cells");
  const [leftOuter, rightOuter, leftDivider, rightDivider, centerPlateau, lowerLeft, lowerRight] = threeMap.terrainRegions;
  assert.equal(new Set(leftDivider.cells.map(({ x }) => x)).size, 7, "upper dividers widened from 5 to 7 cells");
  assert.equal(new Set(rightDivider.cells.map(({ x }) => x)).size, 7, "upper dividers are symmetric at 7 cells");
  assert.equal(new Set(centerPlateau.cells.map(({ x }) => x)).size, 38, "center plateau occupies about 61% of the playable interior width");
  assert.equal(new Set(lowerLeft.cells.map(({ x }) => x)).size, 28, "lower-left plateau is 1.75x its prior width");
  assert.equal(new Set(lowerRight.cells.map(({ x }) => x)).size, 28, "lower-right plateau is 1.75x its prior width");

  for (let y = 0; y < threeMap.height; y += 1) {
    for (let x = 0; x < 5; x += 1) assert.equal(threeSpawnState.grid.isTerrain({ x, y }), true, "left wall meets the left map edge");
    for (let x = 67; x < 72; x += 1) assert.equal(threeSpawnState.grid.isTerrain({ x, y }), true, "right wall meets the right map edge");
  }
  assert.ok(leftOuter.cells.some(({ x, y }) => x === 0 && y === 87) && lowerLeft.cells.some(({ x, y }) => x === 0 && y === 88)
    && rightOuter.cells.some(({ x, y }) => x === 71 && y === 87) && lowerRight.cells.some(({ x, y }) => x === 71 && y === 88),
  "outer walls meet lower plateaus with no buildable strip outside them");
  for (const y of [8, 20, 26]) for (const [startX, endX, name] of [[5, 20, "left"], [28, 43, "center"], [51, 66, "right"]]) {
    assert.ok(Array.from({ length: endX - startX + 1 }, (_, i) => startX + i)
      .every((x) => threeSpawnState.grid.isBuildable({ x, y })), `${name} starting lane remains broad at row ${y}`);
  }
  for (let y = 0; y < 35; y += 1) {
    for (let x = 21; x <= 27; x += 1) assert.equal(threeSpawnState.grid.isTerrain({ x, y }), true, "left divider footprint is continuous");
    for (let x = 44; x <= 50; x += 1) assert.equal(threeSpawnState.grid.isTerrain({ x, y }), true, "right divider footprint is continuous");
  }
  // Divider ends at row 34; plateau starts at row 50: 15 open rows between them.
  for (let y = 35; y < 50; y += 1) for (let x = 5; x < 67; x += 1) {
    assert.equal(threeSpawnState.grid.isBuildable({ x, y }), true, "15-row upper transition remains open");
  }
  for (let y = 50; y < 68; y += 1) {
    for (let x = 17; x < 55; x += 1) assert.equal(threeSpawnState.grid.isTerrain({ x, y }), true, "center plateau is a 38-by-18 block");
    for (const [startX, endX] of [[5, 16], [55, 66]]) for (let x = startX; x <= endX; x += 1) {
      assert.equal(threeSpawnState.grid.isBuildable({ x, y }), true, "12-cell side route stays open around the plateau");
    }
  }
  // Plateau ends at row 67; lower masses start at row 88: 20 open rows.
  for (let y = 68; y < 88; y += 1) for (let x = 5; x < 67; x += 1) {
    assert.equal(threeSpawnState.grid.isBuildable({ x, y }), true, "20-row lower transition remains open");
  }
  for (let y = 88; y < 102; y += 1) {
    for (let x = 0; x < 28; x += 1) assert.equal(threeSpawnState.grid.isTerrain({ x, y }), true, "lower-left plateau is filled");
    for (let x = 28; x < 44; x += 1) assert.equal(threeSpawnState.grid.isBuildable({ x, y }), true, "16-cell lower central passage is buildable");
    for (let x = 44; x < 72; x += 1) assert.equal(threeSpawnState.grid.isTerrain({ x, y }), true, "lower-right plateau is filled");
  }
  for (let y = 102; y < 109; y += 1) for (let x = 5; x < 67; x += 1) {
    assert.equal(threeSpawnState.grid.isBuildable({ x, y }), true, "final field below plateaus remains broadly open");
  }
  assert.deepEqual(threeMap.midLaneTargets, [{ x: 16, y: 76 }, { x: 55, y: 76 }]);
  assert.deepEqual(threeMap.convergenceOpenings, threeMap.midLaneTargets);
  assert.deepEqual(threeMap.finalLaneTarget, { x: 36, y: 105 }, "final lane stays aligned to the centered goal");
  const threeRoutePhasePercentages = {
    threeSeparateLanes: Number((35 / threeMap.height * 100).toFixed(1)),
    upperOpenTransition: Number((15 / threeMap.height * 100).toFixed(1)),
    centerPlateau: Number((18 / threeMap.height * 100).toFixed(1)),
    lowerOpenTransition: Number((20 / threeMap.height * 100).toFixed(1)),
    lowerPlateaus: Number((14 / threeMap.height * 100).toFixed(1)),
    finalGoalField: Number((7 / threeMap.height * 100).toFixed(1)),
  };
  for (const spawn of threeMap.layout.activeSpawns) {
    assert.ok(threeSpawnState.spawnPaths.get(spawn.id)?.length > 1, `${spawn.id} has a ground route to the goal`);
  }
  assert.equal(Array.from({ length: 16 }, (_, i) => i + 28).filter((x) => threeSpawnState.grid.isBuildable({ x, y: 95 })).length,
    16, "the 16-cell lower passage is usable for a tower maze");
  assert.ok(Array.from({ length: 62 }, (_, i) => i + 5).every((x) => threeSpawnState.grid.isBuildable({ x, y: 103 })),
    "final open field spans the 62-cell interior below the plateaus");

  const threeUpperTransitionMaze = new GameState("three-spawns");
  threeUpperTransitionMaze.gold = 10000;
  const threeUpperTurnsBefore = countTurns(threeUpperTransitionMaze.spawnPaths.get("spawn-north-west"));
  const upperLanes = [[5, 20], [28, 43], [51, 66]];
  const upperGapsByRow = [[13, 36, 58], [18, 30, 52], [7, 40, 65]];
  for (const [rowIndex, y] of [8, 17, 26].entries()) {
    for (const [laneIndex, [firstX, lastX]] of upperLanes.entries()) {
      for (let x = firstX; x <= lastX; x += 1) if (x !== upperGapsByRow[rowIndex][laneIndex]) {
        assert.equal(threeUpperTransitionMaze.placeBasicTower({ x, y }), "placed", `upper lane maze row ${y} leaves a valid crossing`);
      }
    }
  }
  const threeUpperTurnsAdded = countTurns(threeUpperTransitionMaze.spawnPaths.get("spawn-north-west")) - threeUpperTurnsBefore;
  assert.ok(threeUpperTurnsAdded >= 3, "left upper lane supports at least three player-created turns");
  assert.equal(threeUpperTransitionMaze.spawnPaths.size, 3, "all three upper lanes retain paths after maze construction");
  for (const spawn of threeUpperTransitionMaze.layout.activeSpawns) {
    assert.ok(countTurns(threeUpperTransitionMaze.spawnPaths.get(spawn.id)) >= 3, `${spawn.id} has meaningful upper-lane maze turns`);
  }

  const threeLowerTransitionMaze = new GameState("three-spawns");
  threeLowerTransitionMaze.gold = 10000;
  const threeLowerTurnsBefore = countTurns(threeLowerTransitionMaze.spawnPaths.get("spawn-north-west"));
  for (const [rowIndex, y] of [72, 78, 84].entries()) {
    const gap = [16, 36, 55][rowIndex];
    for (let x = 5; x < 67; x += 1) if (x !== gap) {
      assert.equal(threeLowerTransitionMaze.placeBasicTower({ x, y }), "placed", `lower open field permits a legal maze row at ${y}`);
    }
  }
  const threeLowerTurnsAdded = countTurns(threeLowerTransitionMaze.spawnPaths.get("spawn-north-west")) - threeLowerTurnsBefore;
  assert.ok(threeLowerTurnsAdded >= 4, "lower transition supports multiple player-built turns");

  const mazeState = new GameState("three-spawns");
  mazeState.gold = 10000;
  const mazeRouteChanges = [];
  const lanes = [
    { spawnId: "spawn-north-west", firstX: 5, lastX: 20, gaps: [6, 15, 8] },
    { spawnId: "spawn-north", firstX: 28, lastX: 43, gaps: [36, 30, 40] },
    { spawnId: "spawn-north-east", firstX: 51, lastX: 66, gaps: [58, 52, 65] },
  ];
  const turnsBefore = new Map(lanes.map(({ spawnId }) => [spawnId, countTurns(mazeState.spawnPaths.get(spawnId))]));
  let successfulPlacements = 0;
  for (const lane of lanes) {
    for (const [rowIndex, y] of [5, 10, 15].entries()) {
      for (let x = lane.firstX; x <= lane.lastX; x += 1) if (x !== lane.gaps[rowIndex]) {
        assert.equal(mazeState.placeBasicTower({ x, y }), "placed", `${lane.spawnId} zig-zag row ${y} leaves a safe gap`);
        successfulPlacements += 1;
      }
    }
    const turnsAfter = countTurns(mazeState.spawnPaths.get(lane.spawnId));
    const added = turnsAfter - turnsBefore.get(lane.spawnId);
    assert.ok(added >= 3, `${lane.spawnId} route gains at least three maze turns (${turnsBefore.get(lane.spawnId)} → ${turnsAfter})`);
    mazeRouteChanges.push({ spawnId: lane.spawnId, turnsBefore: turnsBefore.get(lane.spawnId), turnsAfter, added });
  }
  assert.equal(successfulPlacements, 135);
  assert.equal(mazeState.spawnPaths.size, 3, "all routes remain valid after 135 legal maze placements");
  mapMetrics.push({ mazeTurns: mazeRouteChanges });

  const flyingState = new GameState("two-spawns");
  flyingState.waveActive = true;
  flyingState.spawnQueue = ["goblinRider"];
  flyingState.toSpawn = 1;
  flyingState.spawnTimer = 0;
  flyingState.update(0);
  const flyingEnemy = flyingState.enemies[0];
  assert.equal(flyingEnemy.movementType, "flying");
  assert.deepEqual(flyingEnemy.path, [flyingEnemy.path[0], flyingState.exit], "flying keeps a direct spawn-to-goal route over cliff terrain");

  }
  assert.deepEqual([MAPS["single-spawn"].startingGold, MAPS["two-spawns"].startingGold, MAPS["three-spawns"].startingGold], [70, 110, 150]);
  for (const [mapId, multiplier] of [["single-spawn", 1], ["two-spawns", 1.5], ["three-spawns", 2]]) {
    const special = new GameState(mapId);
    special.wavesStarted = 34;
    assert.equal(special.startWave(), true, `${mapId} keeps special Wave 35 startable`);
    assert.equal(special.enemiesRemaining, Math.round(20 * multiplier) + Math.round(4 * multiplier) + Math.round(multiplier),
      `${mapId} scales each type in the flying/commander special wave`);
    special.resetGame("try-again");
    special.wavesStarted = 49;
    assert.equal(special.startWave(), true, `${mapId} keeps boss Wave 50 startable`);
    assert.equal(special.enemiesRemaining, Math.round(multiplier), `${mapId} scales the boss-wave count without changing boss type`);
    assert.equal(special.waveEnemyComposition.skeletonKing, Math.round(multiplier));
  }

  const expected = {
    1: [12, 0, 0, 0], 2: [16, 0, 0, 0], 3: [14, 2, 0, 0], 4: [18, 2, 0, 0],
    5: [14, 4, 0, 0], 6: [20, 4, 0, 0], 7: [0, 0, 12, 0], 8: [16, 4, 2, 0],
    9: [18, 5, 3, 0], 10: [14, 4, 0, 1], 11: [22, 5, 4, 0], 12: [18, 7, 4, 0],
    13: [24, 6, 5, 0], 14: [0, 0, 18, 0], 15: [20, 8, 5, 0], 16: [24, 8, 6, 0],
    17: [18, 10, 7, 0], 18: [26, 9, 8, 0], 19: [20, 12, 8, 0], 20: [18, 8, 4, 2],
  };
  const keys = ["goblin", "goblinBrute", "goblinRider", "giantGoblin", "ghoul", "wraith"];
  for (const [wave, counts] of Object.entries(expected)) {
    const composition = countWaveComposition(getWaveComposition(Number(wave)));
    assert.deepEqual(keys.slice(0, 4).map((key) => composition[key]), counts, `wave ${wave} composition`);
    assert.equal(composition.ghoul + composition.wraith, 0, `new archetypes are not introduced before wave 25`);
  }
  assert.deepEqual(countWaveComposition(getWaveComposition(25)), {
    goblin: 10, goblinBrute: 4, goblinRider: 0, giantGoblin: 0, ghoul: 6, wraith: 3, undeadDragon: 0, skeletonKing: 0, skeletalCommander: 0,
  }, "wave 25 introduces Ghoul and Wraith exactly as specified");
  assert.deepEqual(countWaveComposition(getWaveComposition(26)), {
    goblin: 8, goblinBrute: 5, goblinRider: 3, giantGoblin: 0, ghoul: 8, wraith: 4, undeadDragon: 0, skeletonKing: 0, skeletalCommander: 0,
  }, "wave 26 uses the specified mixed composition");
  assert.deepEqual(countWaveComposition(getWaveComposition(27)), {
    goblin: 6, goblinBrute: 4, goblinRider: 0, giantGoblin: 0, ghoul: 10, wraith: 6, undeadDragon: 0, skeletonKing: 0, skeletalCommander: 0,
  }, "wave 27 uses the specified mixed composition");
  assert.deepEqual(countWaveComposition(getWaveComposition(28)), {
    goblin: 0, goblinBrute: 0, goblinRider: 34, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 0, skeletonKing: 0, skeletalCommander: 0,
  }, "wave 28 remains flying-focused");
  for (const wave of [22, 23, 24, 28]) {
    const counts = countWaveComposition(getWaveComposition(wave));
    assert.equal(counts.ghoul + counts.wraith, 0, `wave ${wave} excludes not-yet-introduced or special-wave new enemies`);
  }
  const firstGeneratedMixedWave = countWaveComposition(getWaveComposition(29));
  assert.ok(firstGeneratedMixedWave.ghoul > 0 && firstGeneratedMixedWave.wraith > 0,
    "both new enemies enter normal generated threat-budget waves after wave 28");
  for (let wave = 7; wave <= 200; wave += 7) {
    const counts = countWaveComposition(getWaveComposition(wave));
    assert.equal(counts.ghoul + counts.wraith, 0, `flying-focused wave ${wave} excludes new ground enemies`);
  }
  assert.deepEqual([ENEMY_THREAT_WEIGHT.ghoul, ENEMY_THREAT_WEIGHT.wraith], [3, 7]);
  const optimizedEnemyPaths = {
    goblin: "/assets/models/enemies/optimized/goblin.glb",
    goblinBrute: "/assets/models/enemies/optimized/goblin-brute.glb",
    goblinRider: "/assets/models/enemies/optimized/goblin-rider.glb",
    giantGoblin: "/assets/models/enemies/optimized/giant-goblin.glb",
    ghoul: "/assets/models/enemies/optimized/ghoul.glb",
    wraith: "/assets/models/enemies/optimized/wraith.glb",
  };
  const sourceEnemyPaths = {
    goblin: "/assets/models/enemies/goblin.glb",
    goblinBrute: "/assets/models/enemies/goblin-brute.glb",
    goblinRider: "/assets/models/enemies/goblin-rider.glb",
    giantGoblin: "/assets/models/enemies/giant-goblin.glb",
    ghoul: "/assets/models/enemies/ghoul.glb",
    wraith: "/assets/models/enemies/wraith.glb",
  };
  for (const [type, path] of Object.entries(optimizedEnemyPaths)) {
    assert.equal(ENEMY_VISUAL_CONFIG[type].assetPath, path, `${type} uses optimized runtime GLB`);
    assert.equal(ENEMY_VISUAL_CONFIG[type].fallbackAssetPath, sourceEnemyPaths[type], `${type} keeps original runtime GLB fallback`);
  }
  const ghoulVisualHeight = ENEMY_VISUAL_CONFIG.ghoul.sourceDimensions.height * ENEMY_VISUAL_CONFIG.ghoul.scale;
  const goblinVisualHeight = ENEMY_VISUAL_CONFIG.goblin.sourceDimensions.height * ENEMY_VISUAL_CONFIG.goblin.scale;
  const bruteVisualHeight = ENEMY_VISUAL_CONFIG.goblinBrute.sourceDimensions.height * ENEMY_VISUAL_CONFIG.goblinBrute.scale;
  const wraithVisualHeight = ENEMY_VISUAL_CONFIG.wraith.sourceDimensions.height * ENEMY_VISUAL_CONFIG.wraith.scale;
  assert.ok(goblinVisualHeight < ghoulVisualHeight && ghoulVisualHeight < bruteVisualHeight,
    "Ghoul presentation scale sits between Goblin and Brute model heights");
  assert.ok(ENEMY_VISUAL_CONFIG.ghoul.hpBarOffsetY > ghoulVisualHeight);
  assert.ok(ENEMY_VISUAL_CONFIG.wraith.hpBarOffsetY > wraithVisualHeight);
  assert.deepEqual(createWaveSpawnQueue(getWaveComposition(9)).slice(0, 3), ["goblin", "goblinBrute", "goblinRider"]);
  assert.deepEqual(createWaveSpawnQueue(getWaveComposition(70)).slice(-7), Array(7).fill("giantGoblin"));

  const lateWaveSnapshots = {
    21: { counts: { goblin: 0, goblinBrute: 0, goblinRider: 26, giantGoblin: 0, ghoul: 0, wraith: 0 }, threat: 78 },
    35: { counts: { goblin: 0, goblinBrute: 0, goblinRider: 20, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 4, skeletonKing: 0, skeletalCommander: 1 }, threat: 98 },
    42: { counts: { goblin: 0, goblinBrute: 0, goblinRider: 30, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 4, skeletonKing: 0, skeletalCommander: 2 }, threat: 142 },
    49: { counts: { goblin: 0, goblinBrute: 0, goblinRider: 36, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 5, skeletonKing: 0, skeletalCommander: 3 }, threat: 180 },
    50: { counts: { goblin: 0, goblinBrute: 0, goblinRider: 0, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 0, skeletonKing: 1, skeletalCommander: 0 }, threat: 0 },
    70: { counts: { goblin: 0, goblinBrute: 0, goblinRider: 54, giantGoblin: 7, ghoul: 0, wraith: 0, undeadDragon: 6, skeletonKing: 0, skeletalCommander: 4 }, threat: 380 },
    80: { counts: { goblin: 33, goblinBrute: 16, goblinRider: 11, giantGoblin: 8, ghoul: 19, wraith: 6 }, threat: 373 },
    100: { counts: { goblin: 42, goblinBrute: 21, goblinRider: 14, giantGoblin: 10, ghoul: 24, wraith: 7 }, threat: 469 },
    116: { counts: { goblin: 30, goblinBrute: 27, goblinRider: 20, giantGoblin: 0, ghoul: 29, wraith: 9 }, threat: 348 },
    120: { counts: { goblin: 31, goblinBrute: 28, goblinRider: 20, giantGoblin: 12, ghoul: 30, wraith: 9 }, threat: 572 },
    140: { counts: { goblin: 0, goblinBrute: 0, goblinRider: 114, giantGoblin: 14, ghoul: 0, wraith: 0, undeadDragon: 11, skeletonKing: 0, skeletalCommander: 9 }, threat: 786 },
    200: { counts: { goblin: 53, goblinBrute: 48, goblinRider: 35, giantGoblin: 20, ghoul: 51, wraith: 15 }, threat: 968 },
  };
  for (const [waveText, snapshot] of Object.entries(lateWaveSnapshots)) {
    const wave = Number(waveText);
    const composition = getWaveComposition(wave);
    const counts = countWaveComposition(composition);
    assert.deepEqual(Object.fromEntries(Object.keys(snapshot.counts).map((type) => [type, counts[type]])), snapshot.counts,
      `deterministic composition for wave ${wave}`);
    assert.equal(composition.totalThreat, snapshot.threat, `weighted threat for wave ${wave}`);
    if (wave % 7 === 0) {
      assert.equal(snapshot.counts.ghoul + snapshot.counts.wraith, 0, `flying-focused wave ${wave} excludes new ground enemies`);
    }
    assert.ok(composition.spawnInterval >= MIN_SPAWN_INTERVAL, `wave ${wave} respects the safe spawn floor`);
  }
  assert.ok(Math.abs(getWaveThreatBudget(116) - 342.2) < 1e-9);
  assert.equal(getWaveComposition(116).totalThreat >= 340, true, "wave 116 should meet the late-game threat target");
  assert.equal(getWaveComposition(116).threatBudget, getWaveThreatBudget(116));
  assert.equal(getWaveComposition(70).threatBudget, undefined, "7/10 collision uses pure flying plus Giants, without a normal mix");
  assert.equal(getWaveComposition(120).threatBudget, 355, "Giant event escorts use a full threat budget before Giants are added");
  assert.equal(getWaveComposition(21).entries.some(({ type }) => type === "goblin" || type === "goblinBrute"), false);
  assert.deepEqual([7, 14, 21, 28, 35, 42].map((wave) => countWaveComposition(getWaveComposition(wave)).goblinRider), [12, 18, 26, 34, 20, 30]);
  assert.deepEqual(
    [60, 100, 120, 200].map((wave) => countWaveComposition(getWaveComposition(wave)).giantGoblin),
    [6, 10, 12, 20],
    "every 10th wave retains wave/10 Giants except the dedicated wave-50 boss override",
  );
  const normalBudgetWaves = [22, 49, 80, 101, 116, 200];
  const normalBudgets = normalBudgetWaves.map(getWaveThreatBudget);
  assert.ok(normalBudgets.every((budget, index) => index === 0 || budget > normalBudgets[index - 1]), "normal-wave threat budget grows through late game");
  assert.ok(getWaveComposition(116).totalThreat > getWaveComposition(22).totalThreat * 5, "wave 116 is substantially harder than an early post-20 wave");
  assert.deepEqual(
    [1, 30, 31, 60, 61, 100, 101, 200].map(getWaveRewardMultiplier),
    [1, 1, 0.75, 0.75, 0.5, 0.5, 0.35, 0.35],
  );
  assert.deepEqual([1, 30, 31, 60, 61, 100, 101].map((wave) => getWaveGoldReward(3, wave)), [3, 3, 2, 2, 2, 2, 1]);
  assert.deepEqual([1, 30, 60, 100, 150, 200].map((wave) => Number(getWaveSpawnInterval(wave).toFixed(2))), [0.5, 0.4, 0.32, 0.26, 0.22, 0.22]);
  assert.ok(getWaveComposition(100).totalThreat > getWaveComposition(20).totalThreat * 3, "late waves do not collapse to early-wave threat");

  const hpTierSnapshots = [
    [1, 0, 1], [10, 0, 1], [11, 1, 2], [20, 1, 2], [21, 2, 4], [30, 2, 4],
    [31, 3, 8], [40, 3, 8], [41, 4, 16], [50, 4, 16], [51, 5, 32], [61, 6, 64],
  ];
  for (const [wave, tier, multiplier] of hpTierSnapshots) {
    assert.equal(getEnemyHpTier(wave), tier, `HP tier boundary at wave ${wave}`);
    assert.equal(getEnemyHpMultiplier(wave), multiplier, `HP multiplier at wave ${wave}`);
  }
  const specialWaveHpChecks = [
    [14, { goblin: 300, goblinBrute: 1100, goblinRider: 320, giantGoblin: 6000, ghoul: 900, wraith: 1400 }],
    [20, { goblin: 300, goblinBrute: 1100, goblinRider: 320, giantGoblin: 6000, ghoul: 900, wraith: 1400 }],
    [21, { goblin: 600, goblinBrute: 2200, goblinRider: 640, giantGoblin: 12000, ghoul: 1800, wraith: 2800 }],
    [30, { goblin: 600, goblinBrute: 2200, goblinRider: 640, giantGoblin: 12000, ghoul: 1800, wraith: 2800 }],
    [35, { goblin: 1200, goblinBrute: 4400, goblinRider: 1280, giantGoblin: 24000, ghoul: 3600, wraith: 5600 }],
    [40, { goblin: 1200, goblinBrute: 4400, goblinRider: 1280, giantGoblin: 24000, ghoul: 3600, wraith: 5600 }],
    [42, { goblin: 2400, goblinBrute: 8800, goblinRider: 2560, giantGoblin: 48000, ghoul: 7200, wraith: 11200 }],
    [70, { goblin: 9600, goblinBrute: 35200, goblinRider: 10240, giantGoblin: 192000, ghoul: 28800, wraith: 44800 }],
  ];
  for (const [wave, expectedHp] of specialWaveHpChecks) {
    assert.deepEqual(Object.fromEntries(keys.map((type) => [type, getEnemyHpForWave(type, wave)])), expectedHp, `special-wave HP scaling at ${wave}`);
  }
  assert.equal(countWaveComposition(getWaveComposition(14)).goblinRider, 18, "wave 14 remains flying-focused");
  assert.equal(countWaveComposition(getWaveComposition(20)).giantGoblin, 2, "wave 20 remains a Giant wave");
  assert.equal(countWaveComposition(getWaveComposition(21)).goblinRider, 26, "wave 21 remains flying-focused");
  assert.deepEqual([countWaveComposition(getWaveComposition(25)).ghoul, countWaveComposition(getWaveComposition(25)).wraith], [6, 3]);
  assert.deepEqual([countWaveComposition(getWaveComposition(28)).ghoul, countWaveComposition(getWaveComposition(28)).wraith], [0, 0]);
  assert.equal(countWaveComposition(getWaveComposition(30)).giantGoblin, 3, "wave 30 remains a Giant wave");
  assert.deepEqual([countWaveComposition(getWaveComposition(35)).goblinRider, countWaveComposition(getWaveComposition(35)).undeadDragon, countWaveComposition(getWaveComposition(35)).skeletalCommander], [20, 4, 1]);
  assert.equal(countWaveComposition(getWaveComposition(40)).giantGoblin, 4, "wave 40 remains a Giant wave");
  assert.deepEqual([countWaveComposition(getWaveComposition(42)).goblinRider, countWaveComposition(getWaveComposition(42)).undeadDragon], [30, 4]);
  assert.deepEqual(
    [countWaveComposition(getWaveComposition(70)).goblinRider, countWaveComposition(getWaveComposition(70)).undeadDragon, countWaveComposition(getWaveComposition(70)).giantGoblin],
    [54, 6, 7],
    "wave 70 keeps the Rider/Giant collision",
  );
  assert.equal(countWaveComposition(getWaveComposition(32)).undeadDragon, 2, "wave 32 introduces two dragons in a normal mixed escort composition");
  assert.deepEqual(countWaveComposition(getWaveComposition(50)), {
    goblin: 0, goblinBrute: 0, goblinRider: 0, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 0, skeletonKing: 1, skeletalCommander: 0,
  }, "wave 50 is only one Skeleton King");
  const wave45Composition = getWaveComposition(45);
  const wave45Counts = countWaveComposition(wave45Composition);
  const wave45EnemyHp = Object.fromEntries(keys.map((type) => [type, getEnemyHpForWave(type, 45)]));
  const wave45TotalHp = keys.reduce((total, type) => total + wave45Counts[type] * wave45EnemyHp[type], 0);
  assert.deepEqual(keys.map((type) => wave45Counts[type]), [25, 8, 5, 0, 10, 2], "wave 45 includes new enemies in deterministic threat mix");
  assert.equal(wave45Composition.threatBudget, 115);
  assert.equal(Number(wave45Composition.spawnInterval.toFixed(3)), 0.36);
  assert.equal(wave45TotalHp, 237600);
  originalInfo("Wave 45 HP regression", {
    counts: wave45Counts,
    threatBudget: wave45Composition.threatBudget,
    totalThreat: wave45Composition.totalThreat,
    spawnInterval: wave45Composition.spawnInterval,
    enemyHp: wave45EnemyHp,
    totalWaveHp: wave45TotalHp,
  });
  const typeHpAtTier = {
    11: [300, 1100, 320, 6000, 900, 1400],
    21: [600, 2200, 640, 12000, 1800, 2800],
    31: [1200, 4400, 1280, 24000, 3600, 5600],
    41: [2400, 8800, 2560, 48000, 7200, 11200],
    51: [4800, 17600, 5120, 96000, 14400, 22400],
  };
  for (const [waveText, expectedHp] of Object.entries(typeHpAtTier)) {
    const wave = Number(waveText);
    assert.deepEqual(keys.map((type) => getEnemyHpForWave(type, wave)), expectedHp, `scaled enemy HP at wave ${wave}`);
  }
  assert.deepEqual(keys.map((type) => getEnemyHpForWave(type, 48)), [2400, 8800, 2560, 48000, 7200, 11200]);
  assert.deepEqual(countWaveComposition(getWaveComposition(48)), { goblin: 27, goblinBrute: 9, goblinRider: 5, giantGoblin: 0, ghoul: 10, wraith: 2, undeadDragon: 0, skeletonKing: 0, skeletalCommander: 0 });
  assert.equal(getWaveComposition(48).totalThreat, 122);
  assert.equal(Number(getWaveComposition(48).spawnInterval.toFixed(3)), 0.352);

  const expectedTierWarnings = [[10, 11, 2], [20, 21, 4], [30, 31, 8], [40, 41, 16], [50, 51, 32], [60, 61, 64]];
  for (const [wave, nextWave, nextMultiplier] of expectedTierWarnings) {
    const warningState = new GameState();
    warningState.currentWave = wave;
    warningState.wavesStarted = wave;
    warningState.waveActive = true;
    warningState.autoRun = true;
    warningState.toSpawn = 0;
    warningState.update(0.01, 0.01);
    assert.equal(warningState.waveActive, false, `Auto Run waits after completed wave ${wave}`);
    assert.deepEqual(warningState.hpTierWarning, {
      completedWave: wave,
      nextWave,
      nextMultiplier,
    });
    assert.equal(warningState.startWave(), false, "manual start cannot bypass the readable tier warning");
    warningState.update(2.95, 2.95);
    assert.equal(warningState.waveActive, false, "warning remains visible for its hold period");
    warningState.update(0.1, 0.1);
    assert.equal(warningState.hpTierWarning, undefined);
    assert.equal(warningState.waveActive, true, "Auto Run resumes after the warning");
    assert.equal(warningState.currentWave, wave + 1);
  }
  const manualWarningState = new GameState();
  manualWarningState.currentWave = 10;
  manualWarningState.wavesStarted = 10;
  manualWarningState.waveActive = true;
  manualWarningState.toSpawn = 0;
  manualWarningState.update(0.01, 0.01);
  assert.ok(manualWarningState.hpTierWarning, "manual mode also receives the warning");
  manualWarningState.update(3.1, 3.1);
  assert.equal(manualWarningState.waveActive, false, "manual mode does not auto-start after warning");
  assert.equal(manualWarningState.startWave(), true, "manual start is available after the warning");

  const routes = [{ x: 0, y: 0 }, { x: 2, y: 0 }];
  const goblin = createEnemy(1, "goblin", routes);
  const brute = createEnemy(2, "goblinBrute", routes);
  const rider = createEnemy(3, "goblinRider", routes);
  const giant = createEnemy(4, "giantGoblin", routes);
  const ghoul = createEnemy(5, "ghoul", routes);
  const wraith = createEnemy(6, "wraith", routes);
  assert.deepEqual([goblin.maxHp, brute.maxHp, rider.maxHp, giant.maxHp], [150, 550, 160, 3000]);
  assert.deepEqual([ghoul.maxHp, wraith.maxHp], [450, 700]);
  assert.deepEqual([goblin.reward, brute.reward, rider.reward, giant.reward], [1, 3, 2, 10]);
  assert.deepEqual([ghoul.reward, wraith.reward], [3, 5]);
  assert.deepEqual([goblin.livesDamage, brute.livesDamage, rider.livesDamage, giant.livesDamage], [1, 1, 1, 3]);
  assert.deepEqual([ghoul.livesDamage, wraith.livesDamage], [1, 1]);
  assert.deepEqual([goblin.speed, brute.speed, rider.speed, giant.speed].map((speed) => Number((speed * WORLD_UNITS_PER_CELL / 90).toFixed(2))), [1.05, 0.72, 1.2, 0.42]);
  assert.deepEqual([ghoul.movementType, wraith.movementType], ["ground", "ground"]);
  const normalizedSpeeds = [wraith, rider, goblin, ghoul, brute, giant]
    .map((enemy) => Number((enemy.speed * WORLD_UNITS_PER_CELL / 90).toFixed(2)));
  assert.deepEqual(normalizedSpeeds, [1.6, 1.2, 1.05, 0.95, 0.72, 0.42], "Wraith is fastest and the full movement order remains distinct");
  assert.ok(getEnemyHpForWave("goblin", 25) < getEnemyHpForWave("ghoul", 25));
  assert.ok(getEnemyHpForWave("ghoul", 25) < getEnemyHpForWave("goblinBrute", 25));
  assert.ok(getEnemyHpForWave("goblinBrute", 25) < getEnemyHpForWave("wraith", 25));
  assert.ok(getEnemyHpForWave("wraith", 25) < getEnemyHpForWave("giantGoblin", 25));
  assert.deepEqual([getEnemyHpForWave("ghoul", 25), getEnemyHpForWave("wraith", 25)], [1800, 2800]);
  assert.deepEqual([getEnemyHpForWave("ghoul", 35), getEnemyHpForWave("wraith", 35)], [3600, 5600]);
  assert.deepEqual([getEnemyHpForWave("ghoul", 45), getEnemyHpForWave("wraith", 45)], [7200, 11200]);
  assert.deepEqual(
    [rider.maxHp, Number((rider.speed * WORLD_UNITS_PER_CELL / 90).toFixed(2)), rider.reward, rider.livesDamage, rider.movementType],
    [160, 1.2, 2, 1, "flying"],
    "Rider balance and flying behavior remain unchanged",
  );
  assert.deepEqual(
    keys.map((type) => getEnemyHpForWave(type, 101)),
    [153600, 563200, 163840, 3072000, 460800, 716800],
    "all archetypes, including Riders, scale HP with deterministic rounding",
  );
  const scaledRider = createEnemy(5, "goblinRider", routes, 42);
  assert.deepEqual([scaledRider.hp, scaledRider.maxHp, scaledRider.reward, scaledRider.livesDamage, scaledRider.speed, scaledRider.movementType], [2560, 2560, 2, 1, rider.speed, "flying"]);

  let waveDebug;
  console.info = (label, details) => { if (label === "Wave composition") waveDebug = details; };
  const scaledGameState = new GameState();
  scaledGameState.wavesStarted = 40;
  assert.equal(scaledGameState.startWave(), true);
  scaledGameState.update(0);
  console.info = () => {};
  assert.equal(scaledGameState.currentWave, 41);
  assert.equal(waveDebug.hpTier, 4);
  assert.equal(waveDebug.hpMultiplier, 16);
  for (const type of keys) {
    assert.equal(waveDebug.enemyHp[type], getEnemyHpForWave(type, 41), `wave debug reports ${type} HP`);
  }
  const wave41Counts = countWaveComposition(getWaveComposition(41));
  assert.deepEqual([waveDebug.ghoul, waveDebug.wraith], [wave41Counts.ghoul, wave41Counts.wraith], "wave debug reports both new enemy counts");
  assert.equal(waveDebug.totalWaveHp, keys.reduce((total, type) => total + wave41Counts[type] * waveDebug.enemyHp[type], 0));
  assert.ok(scaledGameState.enemies.length > 0);
  for (const enemy of scaledGameState.enemies) {
    assert.equal(enemy.maxHp, getEnemyHpForWave(enemy.type, 41), "GameState passes the active wave into enemy creation");
    assert.equal(enemy.hp / enemy.maxHp, 1, "new scaled enemies begin at full health-bar ratio");
  }

  const cappedState = new GameState();
  cappedState.waveActive = true;
  cappedState.spawnQueue = Array(100).fill("goblinRider");
  cappedState.toSpawn = 100;
  cappedState.waveSpawnInterval = 0.3;
  for (let tick = 0; tick < 40 && cappedState.enemies.length < MAX_ACTIVE_WAVE_ENEMIES; tick += 1) {
    cappedState.update(tick === 0 ? 0 : 0.3);
    for (const enemy of cappedState.enemies) enemy.speed = 0;
  }
  assert.equal(cappedState.enemies.length, MAX_ACTIVE_WAVE_ENEMIES, "queued flying units fill, but never exceed, the active model cap");
  assert.equal(cappedState.toSpawn, 100 - MAX_ACTIVE_WAVE_ENEMIES, "the cap staggers units rather than deleting wave enemies");

  const threeSpawnWave = new GameState("three-spawns");
  threeSpawnWave.waveActive = true;
  threeSpawnWave.spawnQueue = Array(30).fill("goblin");
  threeSpawnWave.toSpawn = 30;
  threeSpawnWave.waveSpawnInterval = 0.3;
  for (let tick = 0; tick < 10; tick += 1) {
    threeSpawnWave.update(tick === 0 ? 0 : 0.3);
    for (const enemy of threeSpawnWave.enemies) enemy.speed = 0;
  }
  const spawnIds = threeSpawnWave.layout.activeSpawns.map(({ id }) => id);
  const originCounts = new Map(spawnIds.map((id) => [id, 0]));
  const middleRouteCounts = { left: 0, right: 0 };
  for (const enemy of threeSpawnWave.enemies) {
    const origin = threeSpawnWave.layout.activeSpawns.find(({ entryCell }) =>
      entryCell.x === enemy.path[0].x && entryCell.y === enemy.path[0].y)?.id;
    assert.ok(origin);
    originCounts.set(origin, originCounts.get(origin) + 1);
    if (origin === "spawn-north") {
      if (enemy.path.some(({ x, y }) => x === 9 && y === 29)) middleRouteCounts.left += 1;
      if (enemy.path.some(({ x, y }) => x === 33 && y === 29)) middleRouteCounts.right += 1;
    }
  }
  assert.deepEqual([...originCounts.values()], [10, 10, 10], "three-spawn waves distribute mobs evenly");
  assert.deepEqual(middleRouteCounts, { left: 5, right: 5 }, "middle spawn splits mobs evenly between left and right passages");
  assert.deepEqual(threeSpawnWave.enemies.slice(0, 3).map((enemy) => enemy.path[0]),
    threeSpawnWave.layout.activeSpawns.map(({ entryCell }) => entryCell),
    "three-spawn waves start one mob at each front in the same spawn tick");

  // Damage regression: a level-1 Knight defeats these targets using its configured 55 damage.
  for (const [type, hp, expectedKnightHits] of [["goblin", 150, 3], ["goblinBrute", 550, 10], ["giantGoblin", 3000, 55]]) {
    const combat = new GameState();
    const target = createEnemy(400 + expectedKnightHits, type, [{ x: 5, y: 5 }, { x: 6, y: 5 }]);
    target.x = 5;
    target.y = 5;
    target.speed = 0; // Hold it inside this isolated melee-range combat check.
    const defender = createBasicTower(500 + expectedKnightHits, { x: 5, y: 4 }, "holy-knight");
    combat.waveActive = true;
    combat.toSpawn = 1;
    combat.enemies = [target];
    combat.towers = [defender];
    for (let tick = 0; combat.enemies.length > 0 && tick < 400; tick += 1) combat.update(0.25);
    assert.equal(combat.enemies.length, 0, `${type} should eventually be defeated by the existing Knight`);
    assert.equal(defender.combatStats.kills, 1);
    assert.equal(defender.combatStats.damageDone, hp);
    assert.equal(Math.ceil(hp / defender.damage), expectedKnightHits, `${type} requires more Knight hits after the HP pass`);
  }

  const wizard = createBasicTower(1, { x: 1, y: 0 }, "blue-wizard");
  const knight = createBasicTower(2, { x: 1, y: 0 }, "holy-knight");
  assert.deepEqual([wizard.damage, wizard.range, wizard.fireRate], [25, 110, 1]);
  assert.deepEqual([knight.damage, knight.range, knight.fireRate], [55, 1, 0.9]);
  assert.deepEqual(DEFENDER_CONFIG["holy-knight"].levels.map(({ damage, range, fireRate }) => [damage, range, fireRate]), [
    [55, 1, 0.9],
    [140, 1, 1.05],
    [320, 1, 1.15],
  ]);
  assert.deepEqual(DEFENDER_CONFIG["holy-knight"].targetTypes, ["ground"]);
  assert.deepEqual(DEFENDER_CONFIG["blue-wizard"].levels.map(({ damage, fireRate }) => [damage, fireRate]), [
    [25, 1],
    [65, 1.15],
    [150, 1.25],
  ]);

  const sellCases = [
    { level: 1, invested: 10, refund: 7 },
    { level: 2, invested: 30, refund: 21 },
    { level: 3, invested: 75, refund: 52 },
  ];
  for (const type of ["blue-wizard", "holy-knight"]) {
    for (const sellCase of sellCases) {
      const sellState = new GameState();
      sellState.gold = 1000;
      let buildCell;
      for (let y = 1; y < sellState.grid.height && !buildCell; y += 1) {
        for (let x = 1; x < sellState.grid.width && !buildCell; x += 1) {
          const candidate = { x, y };
          if (sellState.canPlaceBasicTower(candidate, type) === "placed") buildCell = candidate;
        }
      }
      assert.ok(buildCell, `should find a build cell for ${type}`);
      assert.equal(sellState.placeBasicTower(buildCell, type), "placed");
      for (let level = 1; level < sellCase.level; level += 1) {
        assert.equal(sellState.upgradeBasicTower(sellState.towers[0].id), "upgraded");
      }
      const tower = sellState.towers[0];
      tower.combatStats.kills = 8;
      tower.combatStats.damageDone = 900;
      assert.equal(getTotalTowerInvestment(tower.level, tower.type), sellCase.invested);
      assert.equal(getTowerSellRefund(tower), sellCase.refund);
      const goldBeforeSale = sellState.gold;
      const sold = sellState.sellTower(tower.id);
      assert.deepEqual(sold, { refund: sellCase.refund });
      assert.equal(sellState.gold, goldBeforeSale + sellCase.refund);
      assert.equal(sellState.towers.length, 0, "sold tower is removed from GameState");
      assert.equal(sellState.grid.isBuildable(buildCell), true, "sold tower frees its grid cell");
      assert.equal(sellState.towerAt(buildCell), undefined, "sold tower no longer occupies the cell");
      assert.equal(sellState.placeBasicTower(buildCell, type), "placed", "the same cell can be rebuilt");
      assert.deepEqual(sellState.towers[0].combatStats, { kills: 0, damageDone: 0 }, "combat telemetry is not transferred after sale");
    }
  }
  const activeSellState = new GameState();
  activeSellState.gold = 1000;
  const activeSellCell = { x: 5, y: 5 };
  assert.equal(activeSellState.placeBasicTower(activeSellCell, "blue-wizard"), "placed");
  const activeSellTower = activeSellState.towers[0];
  activeSellState.waveActive = true;
  activeSellState.wavePath = [...activeSellState.path];
  const activeSellRoute = activeSellState.path;
  const activeSellEnemy = createEnemy(900, "goblin", activeSellRoute);
  activeSellState.enemies = [activeSellEnemy];
  const activeSale = activeSellState.sellTower(activeSellTower.id);
  assert.deepEqual(activeSale, { refund: 7 });
  assert.deepEqual(activeSellState.wavePath, activeSellState.path, "selling during a wave updates the active route snapshot");
  assert.deepEqual(activeSellEnemy.path[0], { x: Math.round(activeSellEnemy.x), y: Math.round(activeSellEnemy.y) }, "active enemies are repathed from their current cell after a sale");
  assert.deepEqual(activeSellEnemy.path.at(-1), activeSellState.exit, "repathed enemies still reach the castle");
  const targetingTypes = ["goblin", "goblinBrute", "ghoul", "wraith", "giantGoblin", "goblinRider"];
  for (const type of targetingTypes) {
    const target = createEnemy(950 + type.length, type, [{ x: 5, y: 5 }, { x: 6, y: 5 }]);
    assert.equal(canTowerTargetEnemy(wizard, target), true, `Wizard can target ${type}`);
    assert.equal(canTowerTargetEnemy(knight, target), type !== "goblinRider", `Knight ground-only targeting for ${type}`);
  }
  for (const type of ["ghoul", "wraith"]) {
    const groundTarget = createEnemy(1000 + type.length, type, [{ x: 5, y: 5 }, { x: 6, y: 5 }], 25);
    assert.equal(canTowerTargetEnemy(wizard, groundTarget), true, `Wizard can target ${type}`);
    assert.equal(canTowerTargetEnemy(knight, groundTarget), true, `Knight can target ${type}`);
    for (const defenderType of ["blue-wizard", "holy-knight"]) {
      const combat = new GameState();
      const target = createEnemy(1100 + type.length, type, [{ x: 5, y: 5 }, { x: 6, y: 5 }], 25);
      target.x = 5;
      target.y = 5;
      target.speed = 0;
      combat.waveActive = true;
      combat.toSpawn = 1;
      combat.enemies = [target];
      combat.towers = [createBasicTower(1200 + type.length, { x: 5, y: 4 }, defenderType)];
      combat.update(0.001);
      assert.equal(combat.attackEvents.length, 1, `${defenderType} attacks ${type}`);
      assert.equal(combat.attackEvents[0].targetEnemyId, target.id);
    }
  }

  // A real seventh wave creates direct rider routes, and maze placements do not repath them.
  const state = new GameState();
  state.wavesStarted = 6;
  assert.equal(state.startWave(), true);
  state.update(0);
  assert.ok(state.enemies.length > 0);
  assert.ok(state.enemies.every((enemy) => enemy.type === "goblinRider" && enemy.movementType === "flying" && enemy.maxHp === 160 && enemy.path.length === 2));
  const savedRoutes = new Map(state.enemies.map((enemy) => [enemy.id, JSON.stringify(enemy.path)]));
  let placed = false;
  for (let y = 0; y < state.grid.height && !placed; y += 1) {
    for (let x = 0; x < state.grid.width && !placed; x += 1) {
      if (state.canPlaceBasicTower({ x, y }) === "placed") placed = state.placeBasicTower({ x, y }) === "placed";
    }
  }
  assert.equal(placed, true, "should find a valid build cell during the flying wave");
  for (const enemy of state.enemies) assert.equal(JSON.stringify(enemy.path), savedRoutes.get(enemy.id), "rider route stays direct through maze edits");

  for (const type of ["ghoul", "wraith"]) {
    const groundState = new GameState();
    const groundSpawn = groundState.layout.activeSpawns[0];
    const groundRoute = groundState.spawnPaths.get(groundSpawn.id);
    assert.ok(groundRoute && groundRoute.length > 3, `${type} gets a normal ground route`);
    const groundEnemy = createEnemy(1300 + type.length, type, groundRoute);
    groundState.waveActive = true;
    groundState.toSpawn = 1;
    groundState.enemies = [groundEnemy];
    groundState.update(0.05);
    assert.equal(groundEnemy.path.length, groundRoute.length, `${type} follows its maze route`);
    let blockingCell;
    for (const cell of groundRoute.slice(2, -1)) {
      if (groundState.canPlaceBasicTower(cell) !== "placed") continue;
      if (groundState.placeBasicTower(cell) === "placed") {
        blockingCell = cell;
        break;
      }
    }
    assert.ok(blockingCell, `a safe route-blocking tower can be placed for ${type}`);
    assert.deepEqual(groundEnemy.path.at(-1), groundState.exit, `${type} repath still reaches the exit`);
    assert.equal(groundEnemy.path.some((cell) => cell.x === blockingCell.x && cell.y === blockingCell.y), false,
      `${type} repaths around the blocked cell`);
  }

  const combatState = new GameState();
  const target = createEnemy(99, "goblinRider", [{ x: 5, y: 5 }, { x: 6, y: 5 }]);
  target.x = 5; target.y = 5;
  combatState.waveActive = true;
  combatState.toSpawn = 1;
  combatState.enemies = [target];
  combatState.towers = [createBasicTower(100, { x: 5, y: 4 }, "blue-wizard")];
  combatState.update(0.001);
  assert.equal(combatState.attackEvents.length, 1, "Wizard can damage a Rider");
  const knightState = new GameState();
  const knightTarget = createEnemy(101, "goblinRider", [{ x: 5, y: 5 }, { x: 6, y: 5 }]);
  knightTarget.x = 5; knightTarget.y = 5;
  knightState.waveActive = true;
  knightState.toSpawn = 1;
  knightState.enemies = [knightTarget];
  knightState.towers = [createBasicTower(101, { x: 5, y: 4 }, "holy-knight")];
  knightState.update(0.001);
  assert.equal(knightState.attackEvents.length, 0, "Holy Knight cannot damage a Rider");

  const rewardState = new GameState();
  const rewardedBrute = createEnemy(150, "goblinBrute", [{ x: 5, y: 5 }, { x: 6, y: 5 }]);
  rewardedBrute.hp = 1;
  rewardState.waveActive = true;
  rewardState.toSpawn = 1;
  rewardState.enemies = [rewardedBrute];
  const rewardStartingGold = rewardState.gold;
  const rewardTower = createBasicTower(150, { x: 5, y: 4 }, "blue-wizard");
  rewardTower.damage = 10;
  rewardState.towers = [rewardTower];
  rewardState.update(0.001);
  assert.equal(rewardState.gold, rewardStartingGold + 3, "Brute kill pays its configured reward");

  for (const [wave, expectedPayout] of [[31, 2], [61, 2], [101, 1]]) {
    const compressedRewardState = new GameState();
    compressedRewardState.currentWave = wave;
    compressedRewardState.waveActive = true;
    compressedRewardState.toSpawn = 1;
    const enemy = createEnemy(600 + wave, "goblinBrute", [{ x: 5, y: 5 }, { x: 6, y: 5 }]);
    enemy.hp = 1;
    enemy.x = 5;
    enemy.y = 5;
    compressedRewardState.enemies = [enemy];
    const payoutTower = createBasicTower(700 + wave, { x: 5, y: 4 }, "blue-wizard");
    payoutTower.damage = 10;
    compressedRewardState.towers = [payoutTower];
    const startingGold = compressedRewardState.gold;
    compressedRewardState.update(0.001);
    assert.equal(compressedRewardState.gold, startingGold + expectedPayout, `Brute reward is compressed correctly on wave ${wave}`);
  }

  const leakState = new GameState();
  const leakingGiant = createEnemy(200, "giantGoblin", [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  leakingGiant.speed = 2;
  leakState.waveActive = true;
  leakState.enemies = [leakingGiant];
  leakState.update(1);
  assert.equal(leakState.lives, 7, "one Giant leak removes three lives");

  originalLog("Map maze-space metrics", mapMetrics);
  originalLog("Grid-aligned terrain meshes", { formations: totalTerrainFormations, meshes: totalTerrainFormations * 2 });
  originalLog("Enemy/wave tests passed: fixed waves, late threat snapshots, flying/Giant stacking, reward compression, active cap, archetype stats, repathing, targeting, and leaks.");
} finally {
  console.log = originalLog;
  console.info = originalInfo;
}
