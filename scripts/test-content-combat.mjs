import assert from "node:assert/strict";
import { GameState } from "../src/game/GameState.ts";
import { ENEMY_CONFIG } from "../src/game/config/EnemyConfig.ts";
import { DEFENDER_CONFIG, getDefenderTotalInvestment } from "../src/game/config/DefenderConfig.ts";
import { countWaveComposition, getWaveComposition } from "../src/game/config/WaveConfig.ts";
import { createEnemy, getEnemyHpForWave } from "../src/game/enemies/Enemy.ts";
import { canTowerTargetEnemy, createBasicTower, getTowerAttackMode, getTowerDamageAgainstEnemy, getTowerLevelStats, getTowerAttackProfile, upgradeTower } from "../src/game/towers/Tower.ts";
import { WORLD_UNITS_PER_CELL } from "../src/core/GameConstants.ts";

const route = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }];
const makeEnemy = (id, type, x, y, hp = 10000) => {
  const enemy = createEnemy(id, type, route, 1);
  enemy.x = x;
  enemy.y = y;
  enemy.speed = 0;
  enemy.hp = hp;
  enemy.maxHp = hp;
  return enemy;
};
const atLevel = (type, level, id = 1, cell = { x: 5, y: 5 }) => {
  const tower = createBasicTower(id, cell, type);
  for (let current = 1; current < level; current += 1) upgradeTower(tower);
  return tower;
};
const attack = (tower, enemies) => {
  const state = new GameState();
  state.waveActive = true;
  state.toSpawn = 1;
  state.towers = [tower];
  state.enemies = enemies;
  state.update(0.001);
  return { state, events: [...state.attackEvents] };
};

assert.deepEqual(
  [ENEMY_CONFIG.undeadDragon.hp, ENEMY_CONFIG.undeadDragon.speedMultiplier, ENEMY_CONFIG.undeadDragon.goldReward,
    ENEMY_CONFIG.undeadDragon.livesDamage, ENEMY_CONFIG.undeadDragon.movementType, ENEMY_CONFIG.undeadDragon.threatWeight],
  [480, 0.9, 5, 2, "flying", 6],
);
assert.deepEqual(Object.fromEntries(Object.entries(ENEMY_CONFIG).map(([type, config]) => [type, [config.movementType, config.combatClass]])), {
  goblin: ["ground", "fodder"], goblinBrute: ["ground", "tank"], goblinRider: ["flying", "fodder"],
  giantGoblin: ["ground", "tank"], ghoul: ["ground", "fodder"], wraith: ["ground", "fodder"],
  undeadDragon: ["flying", "tank"], skeletonKing: ["ground", "boss"], skeletalCommander: ["flying", "boss"],
});
assert.deepEqual(
  [ENEMY_CONFIG.skeletalCommander.hp, ENEMY_CONFIG.skeletalCommander.speedMultiplier, ENEMY_CONFIG.skeletalCommander.goldReward,
    ENEMY_CONFIG.skeletalCommander.livesDamage, ENEMY_CONFIG.skeletalCommander.movementType, ENEMY_CONFIG.skeletalCommander.combatClass,
    ENEMY_CONFIG.skeletalCommander.threatWeight, ENEMY_CONFIG.skeletalCommander.boss],
  [1400, 0.72, 12, 4, "flying", "boss", 14, true],
);
assert.deepEqual(
  [ENEMY_CONFIG.skeletonKing.hp, ENEMY_CONFIG.skeletonKing.speedMultiplier, ENEMY_CONFIG.skeletonKing.goldReward,
    ENEMY_CONFIG.skeletonKing.livesDamage, ENEMY_CONFIG.skeletonKing.movementType],
  [12000, 0.22, 75, 10, "ground"],
);
assert.deepEqual(countWaveComposition(getWaveComposition(35)), {
  goblin: 0, goblinBrute: 0, goblinRider: 20, giantGoblin: 0, ghoul: 0, wraith: 0,
  undeadDragon: 4, skeletonKing: 0, skeletalCommander: 1,
});
assert.equal(getEnemyHpForWave("skeletalCommander", 35), 11200);
const runtimeCommander = createEnemy(2001, "skeletalCommander", route, 35);
assert.deepEqual([runtimeCommander.hp, Number((runtimeCommander.speed * WORLD_UNITS_PER_CELL / 90).toFixed(2)), runtimeCommander.reward,
  runtimeCommander.livesDamage, runtimeCommander.movementType, runtimeCommander.combatClass], [11200, 0.72, 12, 4, "flying", "boss"]);
assert.equal(canTowerTargetEnemy(atLevel("holy-knight", 1), runtimeCommander), false, "Holy Knight cannot hit flying Commander");
assert.equal(canTowerTargetEnemy(atLevel("blue-wizard", 1), runtimeCommander), true);
assert.equal(canTowerTargetEnemy(atLevel("green-archer", 1), runtimeCommander), true);
assert.equal(canTowerTargetEnemy(atLevel("battlemage", 1), runtimeCommander), true);
assert.equal(canTowerTargetEnemy(atLevel("sovereign", 1), runtimeCommander), true);
for (const [wave, count] of [[42, 2], [49, 3], [63, 4]]) {
  assert.equal(countWaveComposition(getWaveComposition(wave)).skeletalCommander, count);
}
assert.equal(getEnemyHpForWave("undeadDragon", 35), 3840);
assert.equal(getEnemyHpForWave("skeletonKing", 50), 144000);
assert.deepEqual(
  ["wraith", "goblinRider", "goblin", "ghoul", "undeadDragon", "goblinBrute", "giantGoblin", "skeletalCommander", "skeletonKing"]
    .map((type) => ENEMY_CONFIG[type].speedMultiplier),
  [1.6, 1.2, 1.05, 0.95, 0.9, 0.72, 0.42, 0.72, 0.22],
);

const wave32 = countWaveComposition(getWaveComposition(32));
assert.equal(wave32.undeadDragon, 2);
assert.ok(wave32.goblin + wave32.goblinBrute + wave32.ghoul + wave32.wraith > 0, "wave 32 retains a normal ground mix");
assert.deepEqual(
  [countWaveComposition(getWaveComposition(35)).goblinRider, countWaveComposition(getWaveComposition(35)).undeadDragon,
    countWaveComposition(getWaveComposition(35)).skeletalCommander],
  [20, 4, 1],
);
const wave50 = countWaveComposition(getWaveComposition(50));
assert.deepEqual(Object.entries(wave50).filter(([, count]) => count > 0), [["skeletonKing", 1]]);
const bossState = new GameState();
bossState.wavesStarted = 49;
assert.equal(bossState.startWave(), true);
bossState.update(0);
assert.deepEqual(bossState.enemies.map(({ type, hp, speed, reward, livesDamage, movementType }) => ({
  type, hp, speed: Number((speed * WORLD_UNITS_PER_CELL / 90).toFixed(2)), reward, livesDamage, movementType,
})), [{ type: "skeletonKing", hp: 144000, speed: 0.22, reward: 75, livesDamage: 10, movementType: "ground" }]);

assert.deepEqual(DEFENDER_CONFIG["blue-wizard"].levels.map(({ damage, range, fireRate }) => [damage, range, fireRate]), [
  [25, 110, 1], [65, 120, 1.15], [150, 135, 1.25],
]);
assert.deepEqual(DEFENDER_CONFIG["holy-knight"].levels.map(({ damage, range, fireRate }) => [damage, range, fireRate]), [
  [55, 1, 0.9], [140, 1, 1.05], [320, 1, 1.15],
]);
assert.deepEqual(DEFENDER_CONFIG["green-archer"].levels.map(({ damage, fireRate, range }) => [damage, fireRate, range]), [
  [12, 1.5, 180], [28, 1.65, 180], [65, 1.8, 180],
]);
assert.deepEqual(DEFENDER_CONFIG.battlemage.levels.map(({ damage, fireRate, range, upgradeCost }) => [damage, fireRate, range, upgradeCost]), [
  [50, 1, 129.6, null], [125, 1.05, 129.6, 65], [290, 1.1, 129.6, 120],
]);
assert.deepEqual([1, 2, 3].map((level) => DEFENDER_CONFIG["green-archer"].levels[level - 1].upgradeCost), [null, 35, 70]);
assert.deepEqual([1, 2, 3].map((level) => DEFENDER_CONFIG.battlemage.levels[level - 1].upgradeCost), [null, 65, 120]);
assert.deepEqual([1, 2, 3].map((level) => getDefenderTotalInvestment(level, "green-archer")), [20, 55, 125]);
assert.deepEqual([1, 2, 3].map((level) => getDefenderTotalInvestment(level, "battlemage")), [35, 100, 220]);
assert.deepEqual([1, 2, 3].map((level) => getDefenderTotalInvestment(level, "sovereign")), [100, 225, 425]);
assert.deepEqual(DEFENDER_CONFIG.sovereign.levels.map(({ range, upgradeCost }) => [range / WORLD_UNITS_PER_CELL, upgradeCost]), [
  [4.5, null], [4.5, 125], [4.5, 200],
]);
assert.deepEqual(["antiAir", "rapid", "heavy"].map((mode) => DEFENDER_CONFIG.sovereign.attackProfiles[mode].map(({ damage, fireRate }) => [damage, fireRate])), [
  [[75, 1.5], [170, 1.65], [360, 1.8]],
  [[45, 2.2], [105, 2.4], [225, 2.6]],
  [[180, 0.55], [430, 0.6], [950, 0.65]],
]);
assert.equal(DEFENDER_CONFIG.sovereign.splashDamageRatios, undefined, "Sovereign remains single-target");
for (let level = 1; level <= 3; level += 1) {
  const tower = atLevel("sovereign", level);
  for (const [type, mode, profileIndex] of [
    ["goblinRider", "anti-air", 0], ["undeadDragon", "anti-air", 0], ["skeletalCommander", "anti-air", 0],
    ["goblin", "rapid", 1], ["ghoul", "rapid", 1], ["wraith", "rapid", 1],
    ["goblinBrute", "heavy", 2], ["giantGoblin", "heavy", 2], ["skeletonKing", "heavy", 2],
  ]) {
    const enemy = makeEnemy(3000 + level * 20 + profileIndex * 10 + type.length, type, 6, 5);
    const profile = getTowerAttackProfile(tower, enemy);
    assert.equal(profile.mode, mode, `${type} selects ${mode}`);
    assert.equal(profile.damage, DEFENDER_CONFIG.sovereign.attackProfiles[profileIndex === 0 ? "antiAir" : profileIndex === 1 ? "rapid" : "heavy"][level - 1].damage);
    assert.equal(profile.fireRate, DEFENDER_CONFIG.sovereign.attackProfiles[profileIndex === 0 ? "antiAir" : profileIndex === 1 ? "rapid" : "heavy"][level - 1].fireRate);
  }
}

// One cooldown serves every Sovereign mode. The next profile is chosen from the next live target.
const adaptiveState = new GameState();
adaptiveState.waveActive = true;
adaptiveState.toSpawn = 1;
const adaptiveTower = atLevel("sovereign", 1, 499);
adaptiveState.towers = [adaptiveTower];
const wraith = makeEnemy(490, "wraith", 6, 5, 1);
adaptiveState.enemies = [wraith];
adaptiveState.update(0.001);
assert.equal(adaptiveState.attackEvents[0].attackMode, "rapid");
assert.ok(Math.abs(adaptiveTower.cooldownRemaining - 1 / 2.2) < 1e-9);
const dragon = makeEnemy(491, "undeadDragon", 6, 5);
adaptiveState.enemies = [dragon];
adaptiveState.update(1 / 2.2 + 0.001);
assert.equal(adaptiveState.attackEvents[0].attackMode, "anti-air");
assert.ok(Math.abs(adaptiveTower.cooldownRemaining - 1 / 1.5) < 1e-9);
const giant = makeEnemy(492, "giantGoblin", 6, 5);
adaptiveState.enemies = [giant];
adaptiveState.update(1 / 1.5 + 0.001);
assert.equal(adaptiveState.attackEvents[0].attackMode, "heavy");
assert.ok(Math.abs(adaptiveTower.cooldownRemaining - 1 / 0.55) < 1e-9);

const effectiveDamageState = new GameState();
effectiveDamageState.waveActive = true;
effectiveDamageState.toSpawn = 1;
const commander = makeEnemy(493, "skeletalCommander", 6, 5, 60);
const sovereign = atLevel("sovereign", 1, 494);
effectiveDamageState.towers = [sovereign];
effectiveDamageState.enemies = [commander];
effectiveDamageState.update(0.001);
assert.equal(effectiveDamageState.attackEvents[0].damageDealt, 60, "damage telemetry excludes overkill");
assert.equal(sovereign.combatStats.damageDone, 60);
assert.equal(sovereign.combatStats.kills, 1, "lethal attack is credited to Sovereign");
assert.equal(effectiveDamageState.attackEvents[0].isSplash, false);

const archerGroundDps = [];
const archerAirDps = [];
for (let level = 1; level <= 3; level += 1) {
  const stats = getTowerLevelStats(level, "green-archer");
  archerGroundDps.push(stats.damage * stats.fireRate);
  archerAirDps.push(stats.damage * stats.fireRate * 4);
  const ground = makeEnemy(10 + level, "goblin", 7, 5);
  const flying = makeEnemy(20 + level, "undeadDragon", 7, 5);
  const tower = atLevel("green-archer", level);
  assert.equal(canTowerTargetEnemy(tower, ground), true);
  assert.equal(canTowerTargetEnemy(tower, flying), true);
  assert.equal(getTowerDamageAgainstEnemy(tower, ground), [6, 14, 33][level - 1]);
  assert.equal(getTowerDamageAgainstEnemy(tower, flying), [48, 112, 260][level - 1]);
  assert.equal(attack(atLevel("green-archer", level), [flying]).events[0].damageDealt, [48, 112, 260][level - 1]);
}
assert.deepEqual(archerGroundDps.map((value) => Number((value * 0.5).toFixed(1))), [9, 23.1, 58.5]);
assert.deepEqual(archerAirDps.map((value) => Number(value.toFixed(1))), [72, 184.8, 468]);
const archerGroundTarget = makeEnemy(301, "goblin", 8, 5);
const archerFlyingTarget = makeEnemy(302, "undeadDragon", 6, 5);
const archerTargeting = attack(atLevel("green-archer", 1), [archerGroundTarget, archerFlyingTarget]);
assert.equal(archerTargeting.events[0].targetEnemyId, archerFlyingTarget.id, "Archer prioritizes flying targets");
assert.equal(canTowerTargetEnemy(atLevel("holy-knight", 1), makeEnemy(30, "undeadDragon", 6, 5)), false);
assert.equal(canTowerTargetEnemy(atLevel("blue-wizard", 1), makeEnemy(31, "undeadDragon", 6, 5)), true);

for (let level = 1; level <= 3; level += 1) {
  const adjacent = makeEnemy(40 + level, "goblin", 6, 5);
  const distant = makeEnemy(50 + level, "goblin", 7, 5);
  const airAdjacent = makeEnemy(60 + level, "undeadDragon", 6, 5);
  const tower = atLevel("battlemage", level);
  assert.equal(getTowerAttackMode(tower, adjacent), "melee");
  assert.equal(getTowerAttackMode(tower, distant), "ranged");
  assert.equal(getTowerAttackMode(tower, airAdjacent), "ranged", "flying targets cannot trigger melee mode");
  const base = [50, 125, 290][level - 1];
  const meleeDamage = Math.round(base * 1.35);
  assert.equal(getTowerDamageAgainstEnemy(tower, adjacent), meleeDamage);
  const meleeResult = attack(tower, [adjacent]);
  assert.equal(meleeResult.events[0].attackMode, "melee");
  assert.equal(meleeResult.events[0].damageDealt, meleeDamage);
  const rangedResult = attack(atLevel("battlemage", level), [distant]);
  assert.equal(rangedResult.events[0].attackMode, "ranged");
  assert.equal(rangedResult.events[0].damageDealt, base);

  const primary = makeEnemy(100 + level, "goblin", 8.5, 8);
  const adjacentTargets = [makeEnemy(200 + level, "goblin", 9, 7), makeEnemy(300 + level, "goblin", 10, 8), makeEnemy(400 + level, "goblin", 9, 9)];
  const outside = makeEnemy(500 + level, "goblin", 11, 8);
  const splashTower = atLevel("battlemage", level, 700 + level, { x: 5, y: 8 });
  const splash = attack(splashTower, [primary, ...adjacentTargets, outside]);
  const primaryEvent = splash.events.find((event) => event.targetEnemyId === primary.id);
  const secondaryEvents = splash.events.filter((event) => event.isSplash);
  assert.equal(primaryEvent?.damageDealt, base, "primary receives full ranged hit");
  assert.deepEqual(secondaryEvents.map((event) => event.targetEnemyId).sort((a, b) => a - b), adjacentTargets.map((enemy) => enemy.id).sort((a, b) => a - b));
  assert.deepEqual(secondaryEvents.map((event) => event.damageDealt), Array(3).fill(Math.round(base * [0.35, 0.4, 0.5][level - 1])));
  assert.equal(splash.events.some((event) => event.targetEnemyId === outside.id), false, "outside adjacent cells receive no splash");
  assert.equal(splashTower.combatStats.damageDone, base + secondaryEvents.reduce((total, event) => total + event.damageDealt, 0));
}

const lethalSplashTower = atLevel("battlemage", 1, 901, { x: 5, y: 8 });
const lethalPrimary = makeEnemy(902, "goblin", 8.5, 8);
const lethalSecondary = makeEnemy(903, "goblin", 9, 7, 1);
const lethalSplash = attack(lethalSplashTower, [lethalPrimary, lethalSecondary]);
assert.equal(lethalSplashTower.combatStats.kills, 1, "lethal splash is credited to its Battlemage");
assert.equal(lethalSplash.events.find((event) => event.targetEnemyId === lethalSecondary.id)?.enemyDied, true);
assert.equal(lethalSplash.events.find((event) => event.targetEnemyId === lethalSecondary.id)?.damageDealt, 1, "overkill is excluded from effective damage telemetry");

console.log("Content/combat tests passed: boss/flying composition, unchanged scaling, five defender types, Sovereign profiles, anti-air, Battlemage splash.");
