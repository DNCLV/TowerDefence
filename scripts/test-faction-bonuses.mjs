import assert from "node:assert/strict";
import { FactionBonusSystem, getVeteranProgress } from "../src/game/FactionBonusSystem.ts";
import { createEnemy } from "../src/game/enemies/Enemy.ts";
import { createBasicTower, getTowerAttackProfile, upgradeTower } from "../src/game/towers/Tower.ts";

const enemy = (id, type = "goblin", movementType = "ground") => {
  const result = createEnemy(id, type, [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }]);
  result.movementType = movementType;
  return result;
};

const royalTower = createBasicTower(1, { x: 1, y: 1 }, "holy-knight");
assert.equal(getVeteranProgress("arcane-kingdom", royalTower).rank, 0);
const baseProfile = getTowerAttackProfile(royalTower, enemy(1), "arcane-kingdom");
royalTower.combatStats.kills = 25;
assert.equal(getVeteranProgress("arcane-kingdom", royalTower).rank, 1);
assert.equal(getTowerAttackProfile(royalTower, enemy(2), "arcane-kingdom").damage, Math.round(baseProfile.damage * 1.05));
royalTower.combatStats.damageDone = 4_500;
assert.equal(getVeteranProgress("arcane-kingdom", royalTower).rank, 2);
assert.equal(getTowerAttackProfile(royalTower, enemy(3), "arcane-kingdom").fireRate, royalTower.fireRate * 1.05);
royalTower.combatStats.kills = 150;
royalTower.combatStats.damageDone = 9_000;
assert.equal(getVeteranProgress("arcane-kingdom", royalTower).rank, 3);
assert.equal(getTowerAttackProfile(royalTower, enemy(4), "arcane-kingdom").damage, Math.round(royalTower.damage * 1.08));
upgradeTower(royalTower);
assert.equal(getVeteranProgress("arcane-kingdom", royalTower).rank, 3, "upgrade preserves veterancy");
assert.equal(getVeteranProgress("ancient-grove", royalTower).rank, 0, "non-Royal faction has no Veteran Corps");

const maze = new FactionBonusSystem("ancient-grove");
const groveTower = createBasicTower(2, { x: 1, y: 1 }, "blue-wizard");
const route = [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }];
maze.rebuildLivingMazeInfluence([groveTower], [route]);
assert.equal(maze.isLivingMazeInfluenced({ x: 0, y: 1 }), true);
assert.equal(maze.isLivingMazeInfluenced({ x: 5, y: 5 }), false);
const ground = enemy(10);
maze.updateLivingMazeExposure(ground, 1);
assert.equal(maze.getLivingMazeSlowMultiplier(ground), 0.92, "Living Maze first stage is 8% slow");
maze.updateLivingMazeExposure(ground, 2);
assert.equal(maze.getLivingMazeSlowMultiplier(ground), 0.86, "Living Maze second stage is 14% slow");
maze.updateLivingMazeExposure(ground, 2);
assert.equal(maze.getLivingMazeSlowMultiplier(ground), 0.8, "Living Maze caps at 20% slow");
const flying = enemy(11, "goblinRider", "flying");
maze.updateLivingMazeExposure(flying, 10);
assert.equal(flying.livingMazeExposureSeconds, 0);
assert.equal(maze.getLivingMazeSlowMultiplier(flying), 1);
ground.path = [...route, { x: 4, y: 1 }];
ground.currentPathIndex = 3;
maze.updateLivingMazeExposure(ground, 0.1);
assert.equal(ground.livingMazeExposureSeconds, 0, "Leaving influence resets exposure");
maze.rebuildLivingMazeInfluence([], [route]);
assert.equal(maze.getLivingMazeInfluencedCells().length, 0, "Selling the Grove tower clears influence");

console.log("Faction bonus tests passed: Veteran Corps progression/modifiers and Living Maze influence/exposure/ground-only behavior.");
