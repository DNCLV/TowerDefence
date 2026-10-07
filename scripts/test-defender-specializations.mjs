import assert from "node:assert/strict";
import { WORLD_UNITS_PER_CELL } from "../src/core/GameConstants.ts";
import { GameState } from "../src/game/GameState.ts";
import { AFFIXES } from "../src/game/config/EnemyAffixConfig.ts";
import { resolveFormation } from "../src/game/config/FormationConfig.ts";
import { SPECIALIZATIONS_BY_DEFENDER, TOWER_SPECIALIZATIONS } from "../src/game/config/SpecializationConfig.ts";
import { applyArcherMark, createEnemy, updateEnemySpecialStatuses } from "../src/game/enemies/Enemy.ts";
import { applyEnemyAffixes } from "../src/game/enemies/EnemyAffixSystem.ts";
import { createBasicTower, getTowerAttackProfile, getTowerDamageType, upgradeTower } from "../src/game/towers/Tower.ts";

const route = Array.from({ length: 16 }, (_, index) => ({ x: 5 + index, y: 5 }));
const makeEnemy = (id, type = "goblin", x = 6, hp = 20_000) => {
  const enemy = createEnemy(id, type, route);
  Object.assign(enemy, { x, y: 5, currentPathIndex: Math.max(0, x - 5), speed: 0, hp, maxHp: hp });
  return enemy;
};
const makeL3 = (id, type, specializationId) => {
  const tower = createBasicTower(id, { x: 5, y: 5 }, type);
  upgradeTower(tower);
  upgradeTower(tower, specializationId);
  return tower;
};
const combatState = (tower, enemies) => {
  const state = new GameState("single-spawn", "arcane-kingdom", 42);
  state.waveActive = true;
  state.toSpawn = 0;
  state.towers = [tower];
  state.enemies = enemies;
  return state;
};

// The current L3 upgrade cost is shared by both branch choices, and GameState still requires the choice.
for (const [type, choices] of Object.entries({
  "green-archer": ["dragon-slayer", "ranger"],
  sovereign: ["storm-regent", "war-sovereign"],
})) {
  assert.deepEqual(SPECIALIZATIONS_BY_DEFENDER[type], choices);
  for (const id of choices) {
    const state = new GameState("single-spawn", "arcane-kingdom", 42);
    state.gold = 1000;
    const tower = createBasicTower(1, { x: 5, y: 5 }, type);
    upgradeTower(tower);
    state.towers = [tower];
    const before = state.gold;
    const l3Cost = state.towers[0].type === "green-archer" ? 70 : 200;
    assert.equal(state.upgradeBasicTower(1), "specialization-required");
    assert.equal(state.gold, before);
    assert.equal(state.upgradeBasicTower(1, id), "upgraded");
    assert.equal(tower.specializationId, id);
    assert.equal(state.gold, before - l3Cost);
  }
}

const dragon = makeL3(10, "green-archer", "dragon-slayer");
assert.deepEqual([dragon.damage, dragon.range, dragon.fireRate], [78, 5 * WORLD_UNITS_PER_CELL, 1.55]);
assert.equal(getTowerAttackProfile(dragon, makeEnemy(11, "goblinRider")).damage, 390);
assert.equal(getTowerAttackProfile(dragon, makeEnemy(12, "goblin")).damage, 31, "ground damage stays useful and near the old L3 baseline");
assert.equal(getTowerDamageType(dragon), "physical");
const armoredFlyer = makeEnemy(13, "goblinRider");
applyEnemyAffixes(armoredFlyer, [{ id: "armored", tier: 2 }]);
const dragonCombat = combatState(dragon, [makeEnemy(14, "goblin", 9), armoredFlyer]);
dragonCombat.update(0.001);
assert.equal(dragonCombat.attackEvents[0].targetEnemyId, armoredFlyer.id, "Dragon Slayer prioritizes a valid flying target over a more progressed ground target");
assert.equal(dragonCombat.attackEvents[0].damageDealt, 293, "physical armor reduces the boosted anti-air hit after the specialization multiplier");

const ranger = makeL3(20, "green-archer", "ranger");
assert.deepEqual([ranger.damage, ranger.range, ranger.fireRate], [55, 5 * WORLD_UNITS_PER_CELL, 2.25]);
assert.equal(ranger.fireRate / 1.8, 1.25);
assert.equal(getTowerAttackProfile(ranger, makeEnemy(21, "goblin")).damage, 55);
assert.equal(getTowerAttackProfile(ranger, makeEnemy(22, "goblinRider")).damage, 77);
assert.equal(getTowerDamageType(ranger), "physical");
const rangerMarkTarget = makeEnemy(23);
const rangerCombat = combatState(ranger, [rangerMarkTarget]);
rangerCombat.update(0.001);
assert.equal(rangerMarkTarget.archerMarkSecondsRemaining, 3, "Ranger applies a 3 second mark on hit");
assert.equal(rangerCombat.attackEvents[0].damageDealt, 55, "the hit that applies the mark does not receive a retroactive bonus");
ranger.cooldownRemaining = 0;
rangerCombat.update(0.001);
assert.equal(rangerCombat.attackEvents[0].damageDealt, 61, "the active mark grants one 10% Archer damage modifier");
assert.equal(rangerMarkTarget.archerMarkSecondsRemaining, 3, "subsequent Ranger hits refresh the timer without stacking");
updateEnemySpecialStatuses(rangerMarkTarget, 3.1);
assert.equal(rangerMarkTarget.archerMarkSecondsRemaining, 0);
assert.equal(getTowerAttackProfile(ranger, rangerMarkTarget).damage, 55, "expired mark restores ordinary Ranger damage");
const markedArmoredTarget = makeEnemy(24);
applyEnemyAffixes(markedArmoredTarget, [{ id: "armored", tier: 2 }]);
applyArcherMark(markedArmoredTarget, 3);
assert.equal(getTowerAttackProfile(ranger, markedArmoredTarget).damage, 61, "Mark modifies physical damage before the normal resistance pipeline");
const rangerTargeting = combatState(ranger, [makeEnemy(25, "goblinRider", 6), makeEnemy(26, "goblin", 9)]);
ranger.cooldownRemaining = 0;
rangerTargeting.update(0.001);
assert.equal(rangerTargeting.attackEvents[0].targetEnemyId, 26, "Ranger keeps general progression targeting rather than forcing air priority");

const storm = makeL3(30, "sovereign", "storm-regent");
assert.deepEqual([storm.damage, storm.range, storm.fireRate], [360, 4.5 * WORLD_UNITS_PER_CELL, 1.8]);
assert.equal(getTowerAttackProfile(storm, makeEnemy(31, "goblin")).damage, 225, "Storm Regent retains Sovereign rapid profile");
const stormEnemies = [makeEnemy(32, "goblin", 7), makeEnemy(33, "goblinRider", 8), makeEnemy(34, "goblin", 9)];
const stormCombat = combatState(storm, stormEnemies);
stormCombat.update(0.001);
assert.equal(stormCombat.attackEvents.length, 1, "first attack does not chain");
stormCombat.update(0.56);
assert.equal(stormCombat.attackEvents.length, 1, "second attack does not chain");
stormCombat.update(0.56);
assert.deepEqual(stormCombat.attackEvents.map(({ effectKind, targetEnemyId, damageDealt, damageType }) => [effectKind, targetEnemyId, damageDealt, damageType]), [
  ["primary", 34, 225, "physical"], ["chain", 33, 144, "magic"], ["chain", 32, 45, "physical"],
]);
assert.equal(new Set(stormCombat.attackEvents.map(({ targetEnemyId }) => targetEnemyId)).size, 3, "chain never hits a target twice or recursively");
assert.equal(storm.specializationAttackCounter, 3);
assert.equal(getTowerDamageType(storm, "anti-air"), "magic");

const war = makeL3(40, "sovereign", "war-sovereign");
assert.equal(getTowerAttackProfile(war, makeEnemy(41, "goblin")).damage, 225, "ordinary fodder gets no executioner bonus");
assert.equal(getTowerAttackProfile(war, makeEnemy(42, "goblinBrute")).damage, 1235, "tank gets +30% on Sovereign heavy profile");
assert.equal(getTowerAttackProfile(war, makeEnemy(43, "skeletonKing")).damage, 1235, "boss gets +30% on Sovereign heavy profile");
assert.equal(getTowerAttackProfile(war, makeEnemy(44, "undeadDragon")).damage, 468, "flying tank uses anti-air magic profile and still receives its class bonus");
assert.equal(getTowerDamageType(war, "ranged"), "physical");
assert.equal(getTowerDamageType(war, "anti-air"), "magic");
const armoredTank = makeEnemy(45, "goblinBrute");
applyEnemyAffixes(armoredTank, [{ id: "armored", tier: 2 }]);
const warCombat = combatState(war, [armoredTank]);
warCombat.update(0.001);
assert.equal(warCombat.attackEvents[0].damageDealt, 926, "tank bonus is applied before normal physical resistance");

assert.equal(resolveFormation({ type: "green-archer", cell: { x: 5, y: 5 } }, [])?.id, undefined, "Archer formation roster remains unchanged");
assert.equal(resolveFormation({ type: "sovereign", cell: { x: 5, y: 5 } }, [])?.id, undefined, "Sovereign formation roster remains unchanged");
assert.ok(AFFIXES.armored && AFFIXES["arcane-ward"], "branch mechanics use existing physical/magic affix resistances");

console.log("Defender specialization tests passed: branch flow/costs, Dragon Slayer, Ranger Mark, Storm Regent, War Sovereign, resistances, and formation compatibility.");
