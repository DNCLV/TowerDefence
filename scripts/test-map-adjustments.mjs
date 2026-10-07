import assert from "node:assert/strict";
import { GameState } from "../src/game/GameState.ts";
import { MAPS } from "../src/game/config/MapConfig.ts";
import { getMapPreviewGeometry } from "../src/game/config/MapPreview.ts";
import { findPath, findPathThrough } from "../src/game/pathfinding/Pathfinder.ts";
import { VISUAL_CONFIG } from "../src/game/rendering3d/VisualConfig.ts";

const originalSizes = {
  "single-spawn": [28, 54],
  "two-spawns": [38, 68],
  "three-spawns": [72, 110],
};

assert.equal(VISUAL_CONFIG.unitVisualScaleMultiplier, 1.5);

for (const [id, map] of Object.entries(MAPS)) {
  const [originalWidth, originalHeight] = originalSizes[id];
  assert.ok(Math.abs(map.width / originalWidth - 0.6) < 0.02, `${id}: width reduced by about 40%`);
  assert.ok(Math.abs(map.height / originalHeight - 0.6) < 0.02, `${id}: height reduced by about 40%`);

  const state = new GameState(id);
  const preview = getMapPreviewGeometry(map);
  assert.deepEqual([preview.width, preview.height], [map.width, map.height]);
  assert.equal(map.terrain.length, new Set(map.terrain.map(({ x, y }) => `${x},${y}`)).size);
  assert.ok(map.terrain.every(({ x, y }) => x >= 0 && y >= 0 && x < map.width && y < map.height));
  assert.ok(map.terrain.every((cell) => state.grid.isTerrain(cell)));
  assert.equal(preview.terrain.reduce((total, rect) => total + rect.width * rect.height, 0), map.terrain.length);

  for (const spawn of map.layout.activeSpawns) {
    assert.ok(!state.grid.isBuildable(spawn.gateCell), `${id}: spawn gate is reserved`);
    const route = state.spawnPaths.get(spawn.id);
    assert.ok(route?.length > 1, `${id}: ${spawn.id} has a route`);
    assert.deepEqual(route[0], spawn.entryCell);
    assert.deepEqual(route.at(-1), map.layout.castle.approachCell);
    assert.ok(route.every((cell) => !state.grid.isTerrain(cell)), `${id}: route avoids mountains`);
    if (id === "three-spawns" && spawn.id === "spawn-north") {
      // The middle three-spawn front intentionally alternates between two routed lanes.
      // Its current first variant goes left, so it is valid but not necessarily the BFS tie winner.
      const leftLaneRoute = findPathThrough(state.grid, spawn.entryCell, [
        { x: 9, y: 29 }, { x: 9, y: 41 }, { x: 17, y: 52 }, state.exit,
      ]);
      assert.ok(leftLaneRoute, `${id}: middle spawn has a left routed lane`);
      assert.deepEqual(route, leftLaneRoute, `${id}: middle spawn uses the first routed lane`);
      const shortestRoute = findPath(state.grid, spawn.entryCell, state.exit);
      assert.ok(shortestRoute && route.length >= shortestRoute.length, `${id}: routed lane remains path-valid`);
    } else {
      assert.deepEqual(route, findPath(state.grid, spawn.entryCell, state.exit), `${id}: spawn uses shortest path`);
    }
  }
  assert.ok(!state.grid.isBuildable(map.layout.castle.gateCell), `${id}: castle gate is reserved`);
  console.log(`${map.name}: ${map.width}x${map.height}, ${map.terrain.length} mountain cells, ${state.spawnPaths.size} routes`);
}
