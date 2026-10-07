import assert from "node:assert/strict";
import { GameState } from "../src/game/GameState.ts";
import { DEFENDER_CONFIG, getDefenderTotalInvestment } from "../src/game/config/DefenderConfig.ts";
import { FACTIONS } from "../src/game/config/FactionConfig.ts";
import { createEnemy } from "../src/game/enemies/Enemy.ts";
import { getVeteranProgress } from "../src/game/FactionBonusSystem.ts";
import {
  canTowerTargetEnemy, createBasicTower, getTowerAttackProfile, getTowerSellRefund,
  getTowerSplashRadiusTiles, getTowerSplashRatio, isTowerInRange, upgradeTower,
} from "../src/game/towers/Tower.ts";

const config = DEFENDER_CONFIG["holy-emperor"];
assert.equal(FACTIONS["arcane-kingdom"].units.includes("holy-emperor"), true);
assert.equal(FACTIONS["ancient-grove"].units.includes("holy-emperor"), false);
assert.deepEqual(config.levels.map(({ damage, range, fireRate, upgradeCost }) => [damage, range, fireRate, upgradeCost]), [
  [450, 0, 0.85, null], [700, 0, 1, 400], [950, 0, 1.25, 500],
]);
assert.equal(config.buildCost, 300);
assert.equal(config.supportsMapWideTargeting, true);
assert.deepEqual(config.targetTypes, ["ground", "air"]);
assert.equal(getDefenderTotalInvestment(3, "holy-emperor"), 1200);
assert.equal(config.splashDamageRatios?.[1], 0);
assert.equal(config.splashDamageRatios?.[2], 0);
assert.equal(config.splashDamageRatios?.[3], 0.65);
assert.deepEqual(config.levels.map(({ damage, fireRate }) => damage * fireRate), [382.5, 700, 1187.5],
  "base DPS is 382.5 / 700 / 1187.5 before splash and faction modifiers");
assert.deepEqual([1, 2, 3, 4].map((splashTargetCount) => 950 * (1 + 0.65 * (splashTargetCount - 1)) * 1.25),
  [1187.5, 1959.375, 2731.25, 3503.125], "multi-target L3 DPS includes one primary plus 0–3 splash targets");

const purchase = new GameState("single-spawn", "arcane-kingdom", 701);
purchase.gold = 300;
const buildCell = (() => {
  for (let y = 0; y < purchase.grid.height; y += 1) {
    for (let x = 0; x < purchase.grid.width; x += 1) {
      const cell = { x, y };
      if (purchase.canPlaceBasicTower(cell, "holy-emperor") === "placed") return cell;
    }
  }
  throw new Error("No legal Holy Emperor build cell found");
})();
assert.equal(purchase.placeBasicTower(buildCell, "holy-emperor"), "placed");
assert.equal(purchase.gold, 0, "L1 costs 300 gold");
const emperor = purchase.towers[0];
emperor.combatStats.damageDone = 41_234;
emperor.combatStats.kills = 9;
purchase.gold = 399;
assert.equal(purchase.upgradeBasicTower(emperor.id), "not-enough-gold");
assert.equal(emperor.level, 1);
purchase.gold = 400;
assert.equal(purchase.upgradeBasicTower(emperor.id), "upgraded");
assert.equal(purchase.gold, 0);
assert.deepEqual([emperor.damage, emperor.fireRate], [700, 1]);
assert.deepEqual(emperor.combatStats, { kills: 9, damageDone: 41_234 }, "L2 keeps lifetime combat telemetry");
purchase.gold = 499;
assert.equal(purchase.upgradeBasicTower(emperor.id), "not-enough-gold");
purchase.gold = 500;
assert.equal(purchase.upgradeBasicTower(emperor.id), "upgraded");
assert.equal(purchase.gold, 0);
assert.deepEqual([emperor.level, emperor.damage, emperor.fireRate], [3, 950, 1.25]);
assert.deepEqual(emperor.combatStats, { kills: 9, damageDone: 41_234 }, "L3 keeps lifetime combat telemetry");
assert.equal(getTowerSellRefund(emperor), 840, "existing 70% refund applies to the 1,200g investment");
assert.equal(purchase.upgradeBasicTower(emperor.id), "max-level");
assert.deepEqual([purchase.sellTower(emperor.id), purchase.gold], [{ refund: 840 }, 840]);

const grove = new GameState("single-spawn", "ancient-grove", 702);
grove.gold = 1000;
assert.equal(grove.canPlaceBasicTower({ x: 6, y: 6 }, "holy-emperor"), "invalid-cell");

const route = Array.from({ length: 60 }, (_, x) => ({ x, y: 10 }));
const makeEnemy = (id, type, x, y = 10, pathIndex = Math.floor(x), hp = 20_000) => {
  const enemy = createEnemy(id, type, route, 1);
  Object.assign(enemy, { x, y, currentPathIndex: pathIndex, speed: 0, hp, maxHp: hp });
  return enemy;
};
const makeTower = (level, id = 1) => {
  const tower = createBasicTower(id, { x: 5, y: 5 }, "holy-emperor");
  for (let next = 2; next <= level; next += 1) upgradeTower(tower);
  return tower;
};
const runAttack = (tower, enemies) => {
  const state = new GameState("single-spawn", "arcane-kingdom", 703);
  state.waveActive = true;
  state.toSpawn = 1;
  state.towers = [tower];
  state.enemies = enemies;
  state.update(0.001);
  return state;
};

const l1 = makeTower(1);
const l2 = makeTower(2);
const l3 = makeTower(3);
assert.deepEqual([1, 2, 3].map((level) => {
  const tower = [l1, l2, l3][level - 1];
  return getTowerAttackProfile(tower, makeEnemy(100 + level, "goblin", 3), "arcane-kingdom").fireRate;
}), [0.85, 1, 1.25]);
assert.deepEqual([getTowerSplashRatio(l1, "ranged"), getTowerSplashRatio(l2, "ranged"), getTowerSplashRatio(l3, "ranged")], [0, 0, 0.65]);
assert.equal(getTowerSplashRadiusTiles(l3), 1.75);

// Semantic map-wide range works from anywhere, while ordinary target filters remain authoritative.
const farGround = makeEnemy(201, "goblin", 58);
const farAirBoss = makeEnemy(202, "skeletalCommander", 58, 10, 57);
const farGroundBoss = makeEnemy(203, "skeletonKing", 2);
for (const enemy of [farGround, farAirBoss, farGroundBoss]) assert.equal(isTowerInRange(l1, enemy), true);
assert.equal(canTowerTargetEnemy(l1, farGround), true);
assert.equal(canTowerTargetEnemy(l1, farAirBoss), true);
assert.equal(canTowerTargetEnemy(l1, farGroundBoss), true);
assert.equal(isTowerInRange(createBasicTower(9, { x: 5, y: 5 }, "blue-wizard"), farGround), false,
  "map-wide capability does not make normal defender ranges global");

// Target priority still chooses the living enemy nearest the exit, including a flying boss.
const nearSpawn = makeEnemy(210, "goblin", 2);
const nearExitBoss = makeEnemy(211, "skeletalCommander", 56, 10, 55);
const deadAtExit = makeEnemy(212, "skeletonKing", 59, 10, 59);
deadAtExit.alive = false;
const priorityState = runAttack(makeTower(1), [nearSpawn, nearExitBoss, deadAtExit]);
assert.equal(priorityState.attackEvents.find((event) => event.effectKind === "primary")?.targetEnemyId, nearExitBoss.id);
assert.equal(nearExitBoss.hp, 20_000 - 450);
assert.equal(nearSpawn.hp, 20_000);

// L1 and L2 remain single-target even with a nearby second enemy.
for (const tower of [makeTower(1, 11), makeTower(2, 12)]) {
  const primary = makeEnemy(220 + tower.level, "goblin", 32, 10, 32);
  const neighbor = makeEnemy(230 + tower.level, "ghoul", 31, 10, 30);
  const state = runAttack(tower, [neighbor, primary]);
  assert.equal(primary.hp, 20_000 - tower.damage);
  assert.equal(neighbor.hp, 20_000);
  assert.equal(state.attackEvents.some((event) => event.isSplash), false);
}

// L3 applies one full primary hit and local 65% damage to ground and flying targets only.
const emperorL3 = makeTower(3, 20);
const primary = makeEnemy(301, "skeletonKing", 32, 10, 32);
const groundNeighbor = makeEnemy(302, "goblin", 31, 10, 30);
const flyingNeighbor = makeEnemy(303, "goblinRider", 32, 11, 31);
const outsideRadius = makeEnemy(304, "ghoul", 35, 10, 28);
const deadNeighbor = makeEnemy(305, "goblin", 32.2, 10, 32);
deadNeighbor.alive = false;
emperorL3.combatStats.damageDone = 39_500;
const splashState = runAttack(emperorL3, [outsideRadius, flyingNeighbor, groundNeighbor, deadNeighbor, primary]);
const primaryEvent = splashState.attackEvents.find((event) => event.effectKind === "primary");
assert.equal(primaryEvent?.targetEnemyId, primary.id);
assert.equal(primary.hp, 20_000 - 950);
assert.equal(groundNeighbor.hp, 20_000 - 618);
assert.equal(flyingNeighbor.hp, 20_000 - 618);
assert.equal(outsideRadius.hp, 20_000, "damage beyond 1.75 tiles is not splashed");
assert.equal(deadNeighbor.hp, 20_000);
const actualResolvedDamage = splashState.attackEvents.reduce((sum, event) => sum + event.damageDealt, 0);
assert.equal(actualResolvedDamage, 2_186);
assert.equal(emperorL3.combatStats.damageDone, 41_686, "primary and splash are counted once as resolved damage and trigger Veteran I");
assert.equal(getVeteranProgress("arcane-kingdom", emperorL3).rank, 1);

// Veteran Corps applies through the shared modifier pipeline and upgrades preserve run experience.
const veteranTower = makeTower(1, 30);
veteranTower.combatStats.damageDone = 39_999;
assert.equal(getVeteranProgress("arcane-kingdom", veteranTower).rank, 0);
const veteranTarget = makeEnemy(401, "goblin", 5, 10, 5);
const veteranState = runAttack(veteranTower, [veteranTarget]);
assert.equal(veteranTower.combatStats.damageDone, 40_449);
assert.equal(getVeteranProgress("arcane-kingdom", veteranTower).rank, 1);
const veteranProfile = getTowerAttackProfile(veteranTower, makeEnemy(402, "goblin", 56), "arcane-kingdom");
assert.equal(veteranProfile.damage, 473);
assert.equal(veteranProfile.fireRate, 0.85);
veteranState.gold = 400;
assert.equal(veteranState.upgradeBasicTower(veteranTower.id), "upgraded");
assert.equal(veteranTower.combatStats.damageDone, 40_449);
assert.equal(getVeteranProgress("arcane-kingdom", veteranTower).rank, 1);
assert.equal(getVeteranProgress("ancient-grove", veteranTower).rank, 0);
assert.equal(veteranState.sellTower(veteranTower.id).refund, 489, "L2 refund follows the existing floored 70% formula for 700g invested");
veteranState.towers = [createBasicTower(31, { x: 6, y: 6 }, "holy-emperor")];
veteranState.resetGame("try-again");
assert.equal(veteranState.towers.length, 0, "reset clears the previous run's tower state");

console.log("Holy Emperor config, targeting, cost, splash, and Veteran Corps checks passed.");
