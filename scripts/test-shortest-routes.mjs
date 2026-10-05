import assert from "node:assert/strict";
import { GameState } from "../src/game/GameState.ts";
import { findPath } from "../src/game/pathfinding/Pathfinder.ts";
import { VISUAL_CONFIG } from "../src/game/rendering3d/VisualConfig.ts";

assert.ok(VISUAL_CONFIG.maxCameraRadius > 38, "camera can zoom farther out");

for (const blockedCell of [{ x: 8, y: 9 }, { x: 8, y: 8 }]) {
  const state = new GameState("single-spawn");
  assert.equal(state.startWave(), true);
  state.update(0.01);
  const enemy = state.enemies[0];
  assert.ok(enemy, "wave spawns a ground enemy");
  enemy.x = 8;
  enemy.y = blockedCell.y === 9 ? 8.4 : 8.7;
  enemy.currentPathIndex = enemy.path.findIndex(({ x, y }) => x === 8 && y === 8);
  assert.ok(enemy.currentPathIndex >= 0);
  const positionBefore = { x: enemy.x, y: enemy.y };

  assert.equal(state.placeBasicTower(blockedCell), "placed");
  assert.deepEqual({ x: enemy.x, y: enemy.y }, positionBefore, "rerouting never teleports a mob");
  assert.equal(enemy.currentPathIndex, -1, "mob first finishes its current segment");
  assert.deepEqual(enemy.path, findPath(state.grid, enemy.path[0], state.exit), "new route is shortest from the reachable anchor");
  assert.ok(!enemy.path.some(({ x, y }) => x === blockedCell.x && y === blockedCell.y), "route avoids the new tower");

  const anchor = enemy.path[0];
  const distanceBefore = Math.hypot(anchor.x - enemy.x, anchor.y - enemy.y);
  state.moveEnemy(enemy, 0.05);
  const distanceAfter = Math.hypot(anchor.x - enemy.x, anchor.y - enemy.y);
  assert.ok(distanceAfter < distanceBefore, "first movement heads toward the chosen anchor");
  assert.equal(enemy.x, 8, "mob does not cut diagonally across cells");
}

console.log("Shortest route and mid-cell direction checks passed.");
