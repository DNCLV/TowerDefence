import assert from "node:assert/strict";
import { FactionBonusSystem, getVeteranProgress, getVeteranRank } from "../src/game/FactionBonusSystem.ts";
import { VETERAN_TIERS } from "../src/game/config/FactionBonusConfig.ts";
import { GameState } from "../src/game/GameState.ts";
import { createEnemy } from "../src/game/enemies/Enemy.ts";
import { createBasicTower, getTowerAttackProfile, upgradeTower } from "../src/game/towers/Tower.ts";

const enemy = (id, type = "goblin", movementType = "ground") => {
  const result = createEnemy(id, type, [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }]);
  result.movementType = movementType;
  return result;
};

const royalTower = createBasicTower(1, { x: 1, y: 1 }, "holy-knight");
assert.deepEqual(VETERAN_TIERS.map(({ requiredDamage }) => requiredDamage), [40_000, 150_000, 350_000]);
assert.equal("requiredKills" in VETERAN_TIERS[0], false, "veteran tiers have no kill requirement");
assert.equal(getVeteranProgress("arcane-kingdom", royalTower).rank, 0);
const baseProfile = getTowerAttackProfile(royalTower, enemy(1), "arcane-kingdom");

for (const [damage, expectedRank] of [
  [39_999, 0], [40_000, 1], [149_999, 1], [150_000, 2], [349_999, 2], [350_000, 3],
]) assert.equal(getVeteranRank(damage), expectedRank, `${damage} damage resolves to Veteran ${expectedRank}`);

royalTower.combatStats.kills = 1_000_000;
royalTower.combatStats.damageDone = 39_999;
assert.equal(getVeteranProgress("arcane-kingdom", royalTower).rank, 0, "kills do not grant veterancy below the damage threshold");
royalTower.combatStats.damageDone = 40_000;
assert.equal(getVeteranProgress("arcane-kingdom", royalTower).rank, 1, "damage threshold applies without waiting for a later wave");
assert.equal(getTowerAttackProfile(royalTower, enemy(2), "arcane-kingdom").damage, Math.round(baseProfile.damage * 1.05));
assert.deepEqual([getVeteranProgress("arcane-kingdom", royalTower).damageBonus, getVeteranProgress("arcane-kingdom", royalTower).attackSpeedBonus], [0.05, 0]);
royalTower.combatStats.kills = 0;
royalTower.combatStats.damageDone = 149_999;
assert.equal(getVeteranProgress("arcane-kingdom", royalTower).rank, 1);
royalTower.combatStats.damageDone = 150_000;
assert.equal(getVeteranProgress("arcane-kingdom", royalTower).rank, 2);
assert.equal(getTowerAttackProfile(royalTower, enemy(3), "arcane-kingdom").fireRate, royalTower.fireRate * 1.05);
assert.deepEqual([getVeteranProgress("arcane-kingdom", royalTower).damageBonus, getVeteranProgress("arcane-kingdom", royalTower).attackSpeedBonus], [0.05, 0.05], "Veteran II reports cumulative active bonuses");
royalTower.combatStats.damageDone = 349_999;
assert.equal(getVeteranProgress("arcane-kingdom", royalTower).rank, 2);
royalTower.combatStats.damageDone = 350_000;
assert.equal(getVeteranProgress("arcane-kingdom", royalTower).rank, 3);
assert.equal(getVeteranProgress("arcane-kingdom", royalTower).damageMultiplier, 1.13);
assert.equal(getVeteranProgress("arcane-kingdom", royalTower).attackSpeedMultiplier, 1.1);
assert.equal(getTowerAttackProfile(royalTower, enemy(4), "arcane-kingdom").damage, Math.round(royalTower.damage * 1.13));
upgradeTower(royalTower);
assert.equal(getVeteranProgress("arcane-kingdom", royalTower).rank, 3, "upgrade preserves veterancy");
upgradeTower(royalTower, "royal-champion");
assert.equal(getVeteranProgress("arcane-kingdom", royalTower).rank, 3, "specialization preserves veterancy");
assert.equal(getVeteranProgress("ancient-grove", royalTower).rank, 0, "non-Royal faction has no Veteran Corps");
assert.equal(getVeteranProgress("ancient-grove", royalTower).damageMultiplier, 1);
assert.equal(getVeteranProgress("ancient-grove", royalTower).attackSpeedMultiplier, 1);

const lifecycle = new GameState("single-spawn", "arcane-kingdom", 21);
lifecycle.gold = 100_000;
lifecycle.currentWave = 1;
const persistentTower = createBasicTower(21, { x: 5, y: 5 }, "holy-knight");
persistentTower.combatStats.damageDone = 150_000;
lifecycle.towers = [persistentTower];
assert.equal(getVeteranProgress(lifecycle.factionId, persistentTower).rank, 2, "damage ranks up on wave 1");
assert.equal(lifecycle.upgradeBasicTower(21), "upgraded");
assert.equal(getVeteranProgress(lifecycle.factionId, persistentTower).rank, 2, "upgrade keeps tower damage and rank");
assert.equal(lifecycle.upgradeBasicTower(21, "royal-champion"), "upgraded");
assert.equal(getVeteranProgress(lifecycle.factionId, persistentTower).rank, 2, "specialization keeps tower damage and rank");
assert.notEqual(lifecycle.sellTower(21), "tower-not-found");
assert.equal(lifecycle.towers.length, 0, "selling removes the veteran tower instance");
const freshTower = createBasicTower(22, { x: 5, y: 5 }, "holy-knight");
assert.equal(getVeteranProgress(lifecycle.factionId, freshTower).rank, 0, "new towers start with zero veterancy");
lifecycle.towers = [freshTower];
lifecycle.resetGame("try-again");
assert.equal(lifecycle.towers.length, 0, "new run reset clears towers and their veterancy");

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
