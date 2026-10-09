import assert from "node:assert/strict";
import { GameState } from "../src/game/GameState.ts";
import { MAPS } from "../src/game/config/MapConfig.ts";
import { Grid } from "../src/game/grid/Grid.ts";
import { findPathToAnyGoal } from "../src/game/pathfinding/Pathfinder.ts";
import { createEnemy } from "../src/game/enemies/Enemy.ts";

const twin = MAPS["twin-bastion"];
assert.deepEqual([twin.width, twin.height], [77, 80]);
assert.equal(twin.multiplayer?.playerSlots.length, 2);
assert.equal(twin.layout.activeSpawns.length, 2);
assert.equal(twin.layout.goals?.length, 2);

const state = new GameState(twin, ["arcane-kingdom", "ancient-grove"], 1234);
assert.deepEqual(state.players.map(({ playerId, gold, factionId }) => ({ playerId, gold, factionId })), [
  { playerId: "player-1", gold: 80, factionId: "arcane-kingdom" },
  { playerId: "player-2", gold: 80, factionId: "ancient-grove" },
]);
assert.equal(state.lives, 20);
assert.equal(state.routeForSpawn("spawn-a")?.goalId, "goal-a");
assert.equal(state.routeForSpawn("spawn-b")?.goalId, "goal-b");

const p1Cell = { x: 10, y: 10 };
const p2Cell = { x: 65, y: 10 };
const sharedCell = { x: 30, y: 48 };
assert.equal(state.canPlaceBasicTower(p1Cell, "blue-wizard", "player-1"), "placed");
assert.equal(state.canPlaceBasicTower(p2Cell, "blue-wizard", "player-1"), "forbidden-zone");
assert.equal(state.canPlaceBasicTower(sharedCell, "blue-wizard", "player-1"), "placed");
assert.equal(state.canPlaceBasicTower(p2Cell, "treant", "player-2"), "placed");
assert.equal(state.canPlaceBasicTower(p1Cell, "treant", "player-2"), "forbidden-zone");
assert.equal(state.canPlaceBasicTower(sharedCell, "treant", "player-2"), "placed");

const p2GoldBefore = state.getPlayer("player-2").gold;
assert.equal(state.placeBasicTower(p1Cell, "blue-wizard", "player-1"), "placed");
const owned = state.towerAt(p1Cell);
assert.equal(owned.ownerPlayerId, "player-1");
assert.equal(state.getPlayer("player-2").gold, p2GoldBefore, "P1 spending leaves P2 gold unchanged");
assert.equal(state.upgradeBasicTower(owned.id, undefined, "player-2"), "not-owner");
assert.equal(state.sellTower(owned.id, "player-2"), "not-owner");
state.getPlayer("player-1").gold = 1_000;
assert.equal(state.upgradeBasicTower(owned.id, undefined, "player-1"), "upgraded");
assert.equal(state.upgradeBasicTower(owned.id, "stormcaller", "player-2"), "not-owner");
assert.equal(state.upgradeBasicTower(owned.id, "stormcaller", "player-1"), "upgraded");
assert.equal(owned.specializationId, "stormcaller");
const beforeRefund = state.getPlayer("player-1").gold;
const sale = state.sellTower(owned.id, "player-1");
assert.equal(typeof sale, "object");
assert.equal(state.getPlayer("player-1").gold, beforeRefund + sale.refund);
assert.ok(!state.getPlayer("player-1").ownedTowerIds.includes(owned.id));

// Preferred goals win near-ties, then yield only when an alternate is at least four steps shorter.
const routeGrid = new Grid(12, 12);
const routeGoals = [{ id: "goal-a", cell: { x: 2, y: 8 } }, { id: "goal-b", cell: { x: 8, y: 8 } }];
assert.equal(findPathToAnyGoal(routeGrid, { x: 5, y: 0 }, routeGoals, "goal-a", undefined, 4)?.goalId, "goal-a");
for (let y = 0; y <= 9; y += 1) routeGrid.setTerrain({ x: 3, y }, true);
assert.equal(findPathToAnyGoal(routeGrid, { x: 5, y: 0 }, routeGoals, "goal-a", "goal-a", 4)?.goalId, "goal-b");

// One lane may close when another remains; the final shared route may not be blocked.
const goalA = { id: "goal-a", cell: { x: 2, y: 7 }, gateCell: { x: 2, y: 8 }, approachCell: { x: 2, y: 7 }, side: "south" };
const goalB = { id: "goal-b", cell: { x: 6, y: 7 }, gateCell: { x: 6, y: 8 }, approachCell: { x: 6, y: 7 }, side: "south" };
const validationMap = {
  id: "twin-bastion", name: "Validation", subtitle: "", description: "", width: 9, height: 9,
  layout: {
    castle: goalA, goals: [goalA, goalB],
    activeSpawns: [
      { id: "spawn-a", cell: { x: 2, y: 1 }, gateCell: { x: 2, y: 0 }, entryCell: { x: 2, y: 1 }, side: "north", preferredGoalId: "goal-a", allowedGoalIds: ["goal-a", "goal-b"], weight: 1 },
      { id: "spawn-b", cell: { x: 6, y: 1 }, gateCell: { x: 6, y: 0 }, entryCell: { x: 6, y: 1 }, side: "north", preferredGoalId: "goal-b", allowedGoalIds: ["goal-a", "goal-b"], weight: 1 },
    ],
  },
  terrain: Array.from({ length: 9 }, (_, x) => x === 2 || x === 6 ? [] : [{ x, y: 4 }]).flat(),
  terrainRegions: [], startingGold: 1_000, enemyCountMultiplier: 1,
  multiplayer: {
    minPlayers: 2, maxPlayers: 2, startingGoldPerPlayer: 1_000, teamStartingLives: 20,
    playerSlots: [
      { playerId: "player-1", playerIndex: 0, buildZoneIds: ["shared"] },
      { playerId: "player-2", playerIndex: 1, buildZoneIds: ["shared"] },
    ],
    buildZones: [{ id: "shared", kind: "shared", x: 0, y: 0, width: 9, height: 9 }],
  },
};
const validation = new GameState(validationMap, ["arcane-kingdom", "arcane-kingdom"], 12);
assert.equal(validation.placeBasicTower({ x: 2, y: 4 }, "blue-wizard", "player-1"), "placed", "closing one crossing is legal");
assert.equal(validation.canPlaceBasicTower({ x: 6, y: 4 }, "blue-wizard", "player-2"), "blocks-path", "closing the final crossing is rejected");

// Both destinations consume the same team life pool.
const leakState = new GameState(twin, ["arcane-kingdom", "ancient-grove"], 9);
leakState.waveActive = true;
leakState.enemies = leakState.goals.map((goal, index) => createEnemy(900 + index, "goblin", [{ ...goal.approachCell }], 1));
leakState.update(1);
assert.equal(leakState.lives, 18);

// Rewards preserve their total and split deterministically across active players.
const rewardState = new GameState(twin, ["arcane-kingdom", "ancient-grove"], 7);
rewardState.getPlayer("player-1").gold = 1_000;
assert.equal(rewardState.placeBasicTower(p1Cell, "blue-wizard", "player-1"), "placed");
rewardState.players.forEach((player) => { player.gold = 0; });
const rewardEnemy = createEnemy(950, "goblin", [{ x: 10, y: 11 }, { x: 10, y: 12 }], 1);
rewardEnemy.hp = 1;
rewardEnemy.maxHp = 1;
rewardEnemy.reward = 10;
rewardEnemy.speed = 0;
rewardState.enemies = [rewardEnemy];
rewardState.waveActive = true;
rewardState.update(0.1);
assert.deepEqual(rewardState.players.map((player) => player.gold), [5, 5]);

const weighted = new GameState(twin, ["arcane-kingdom", "ancient-grove"], 5);
assert.equal(weighted.startWave(), true);
const laneQueueSizes = [...weighted.spawnQueuesBySpawn.values()].map((queue) => queue.length);
assert.ok(Math.abs(laneQueueSizes[0] - laneQueueSizes[1]) <= 1, "default Twin Bastion wave pressure is approximately 50/50");
const pressureMap = { ...twin, layout: { ...twin.layout, activeSpawns: twin.layout.activeSpawns.map((spawn, index) => ({ ...spawn, weight: index === 0 ? 7 : 3 })) } };
const pressure = new GameState(pressureMap, ["arcane-kingdom", "ancient-grove"], 5);
assert.equal(pressure.startWave(), true);
const pressureSizes = [...pressure.spawnQueuesBySpawn.values()].map((queue) => queue.length);
assert.ok(pressureSizes[0] > pressureSizes[1] && pressureSizes.reduce((sum, count) => sum + count, 0) === 18,
  "spawn weights support asymmetric future lane pressure without changing WaveConfig");

console.log("Multiplayer Phase 1 tests passed: players, economies, ownership, zones, multi-goal routing, shared lives, rewards, and weighted lanes.");
