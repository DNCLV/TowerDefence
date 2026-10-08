import assert from "node:assert/strict";
import { GameState } from "../src/game/GameState.ts";
import { AncientGroveStatusSystem, getSunbrandDamage, getSunbrandTargetPriority, getThornRotDamage } from "../src/game/AncientGroveStatusSystem.ts";
import { AFFIXES } from "../src/game/config/EnemyAffixConfig.ts";
import { resolveFormation } from "../src/game/config/FormationConfig.ts";
import { TOWER_SPECIALIZATIONS } from "../src/game/config/SpecializationConfig.ts";
import { FACTION_BONUS_CONFIG } from "../src/game/config/FactionBonusConfig.ts";
import { WORLD_UNITS_PER_CELL } from "../src/core/GameConstants.ts";
import { createEnemy, getEnemyHpForWave } from "../src/game/enemies/Enemy.ts";
import {
  applyEnemyAffixes, applyEnemySlow, EnemyAffixSystem, getCommanderAuraMultiplier,
  getEnemyDamageMultiplier, getEnemySpeedMultiplier, updateEnemyAffixes,
} from "../src/game/enemies/EnemyAffixSystem.ts";
import {
  canTowerTargetEnemy, createBasicTower, getTowerAttackProfile, getTowerDamageType,
  getTowerSplashRadiusMultiplier, getTowerSplashRatio, getTotalTowerInvestment, getTowerSellRefund, upgradeTower,
  getTowerSplashRatioForTarget, getTowerAttackMode,
} from "../src/game/towers/Tower.ts";
import { DEFENDER_CONFIG } from "../src/game/config/DefenderConfig.ts";
import { FACTIONS } from "../src/game/config/FactionConfig.ts";

const path = Array.from({ length: 12 }, (_, index) => ({ x: 5 + index, y: 5 }));
const makeEnemy = (id, type = "goblin", x = 6, y = 5, hp = 10000, wave = 1) => {
  const enemy = createEnemy(id, type, path, wave);
  Object.assign(enemy, { x, y, currentPathIndex: Math.max(0, Math.min(path.length - 1, Math.floor(x) - 5)), hp, maxHp: hp, speed: 0 });
  return enemy;
};
const level2Tower = (id, type, cell = { x: 5, y: 5 }) => {
  const tower = createBasicTower(id, cell, type);
  upgradeTower(tower);
  return tower;
};
const attackWith = (tower, enemies) => {
  const state = new GameState("single-spawn", "arcane-kingdom", 123);
  state.waveActive = true;
  state.toSpawn = 1;
  state.towers = [tower];
  state.enemies = enemies;
  state.update(0.001);
  return state;
};

assert.deepEqual(Object.fromEntries(Object.entries(TOWER_SPECIALIZATIONS).map(([id, config]) => [id, [
  config.level3Stats.damage, config.level3Stats.range === undefined ? null : Number(config.level3Stats.range.toFixed(1)), config.level3Stats.fireRate,
]])), {
  stormcaller: [115, 135, 1.42], frostweaver: [110, 135, 1.05],
  "royal-champion": [320, null, 1.05], "dawn-paladin": [230, null, 1.4],
  spellblade: [290, 129.6, 1.1], warcaster: [290, 151.2, 1.1],
  "dragon-slayer": [78, 180, 1.55], ranger: [55, 180, 2.25],
  "storm-regent": [360, 162, 1.8], "war-sovereign": [360, 162, 1.8],
  "needlewing-owl": [105, 270, 2.25], elderwing: [82, 288, 1.7],
  "dire-wolf": [95, null, 2.5], "elder-bear": [310, null, 0.8],
  "moon-seer": [260, 198, 1.15], "sun-seer": [95, 198, 1.1],
});

// L3 choice is required, validated, and charged only after a valid branch is chosen.
for (const [type, choices] of Object.entries({
  "blue-wizard": ["stormcaller", "frostweaver"],
  "holy-knight": ["royal-champion", "dawn-paladin"],
  battlemage: ["spellblade", "warcaster"],
  "green-archer": ["dragon-slayer", "ranger"],
  sovereign: ["storm-regent", "war-sovereign"],
  "thorn-owl": ["needlewing-owl", "elderwing"],
  druid: ["dire-wolf", "elder-bear"],
  seer: ["moon-seer", "sun-seer"],
})) {
  for (const specializationId of choices) {
    const state = new GameState("single-spawn", "arcane-kingdom", 10);
    state.gold = 1000;
    const tower = level2Tower(1, type);
    state.towers = [tower];
    const before = state.gold;
    assert.equal(state.upgradeBasicTower(1), "specialization-required");
    assert.equal(state.gold, before);
    assert.equal(state.upgradeBasicTower(1, "not-a-branch"), "invalid-specialization");
    assert.equal(state.gold, before);
    assert.equal(state.upgradeBasicTower(1, specializationId), "upgraded");
    assert.equal(tower.level, 3);
    assert.equal(tower.specializationId, specializationId);
  }
}

// Ancient Grove's four-unit roster, progression prices and distinct role stats.
assert.deepEqual(FACTIONS["ancient-grove"].units, ["treant", "thorn-owl", "druid", "seer"]);
assert.deepEqual(["treant", "thorn-owl", "druid", "seer"].map((id) => DEFENDER_CONFIG[id].buildCost), [7, 15, 55, 75]);
assert.deepEqual(["treant", "thorn-owl", "druid", "seer"].map((id) => DEFENDER_CONFIG[id].levels.map(({ damage, fireRate, upgradeCost }) => [damage, fireRate, upgradeCost])), [
  [[18, 1, null], [32, 1.05, 15], [52, 1.15, 25]],
  [[24, 1.3, null], [38, 1.4, 25], [82, 1.7, 125]],
  [[60, 1.05, null], [100, 1.15, 70], [310, 0.8, 110]],
  [[65, 0.85, null], [110, 0.95, 100], [95, 1.1, 150]],
]);
assert.deepEqual(DEFENDER_CONFIG.treant.targetTypes, ["ground"], "Treants remain ground-only");
assert.deepEqual(DEFENDER_CONFIG["thorn-owl"].targetTypes, ["air"], "Thorn Owl remains air-only");
assert.deepEqual(DEFENDER_CONFIG["thorn-owl"].levels.map(({ damage, range, fireRate, upgradeCost }) => [
  damage, Number((range / WORLD_UNITS_PER_CELL).toFixed(1)), fireRate, upgradeCost,
]), [[24, 5.5, 1.3, null], [38, 6, 1.4, 25], [82, 8, 1.7, 125]], "Owl costs/ranges and L2/L3 stay unchanged");
assert.deepEqual(DEFENDER_CONFIG.treant.levels.map(({ damage, fireRate }) => Number((damage * fireRate).toFixed(1))), [18, 33.6, 59.8]);
const treantEconomy = new GameState("single-spawn", "ancient-grove", 100);
const treantBuildCell = Array.from({ length: treantEconomy.map.width * treantEconomy.map.height }, (_, index) => ({
  x: index % treantEconomy.map.width, y: Math.floor(index / treantEconomy.map.width),
})).find((cell) => treantEconomy.canPlaceBasicTower(cell, "treant") === "placed");
assert.ok(treantBuildCell, "Wave 1 map has a valid Treant build cell");
treantEconomy.gold = 6;
assert.equal(treantEconomy.placeBasicTower(treantBuildCell, "treant"), "not-enough-gold");
treantEconomy.gold = 7;
assert.equal(treantEconomy.placeBasicTower(treantBuildCell, "treant"), "placed");
const purchasedTreant = treantEconomy.towers[0];
assert.equal(treantEconomy.gold, 0);
assert.deepEqual([1, 2, 3].map((level) => getTotalTowerInvestment(level, "treant")), [7, 22, 47]);
treantEconomy.gold = 14;
assert.equal(treantEconomy.upgradeBasicTower(purchasedTreant.id), "not-enough-gold");
treantEconomy.gold = 15;
assert.equal(treantEconomy.upgradeBasicTower(purchasedTreant.id), "upgraded");
treantEconomy.gold = 24;
assert.equal(treantEconomy.upgradeBasicTower(purchasedTreant.id), "not-enough-gold");
treantEconomy.gold = 25;
assert.equal(treantEconomy.upgradeBasicTower(purchasedTreant.id), "upgraded");
assert.equal(getTowerSellRefund(purchasedTreant), 32, "L3 Treant uses the normal 70% refund on 47 invested gold");
assert.deepEqual(["needlewing-owl", "elderwing", "dire-wolf", "elder-bear", "moon-seer", "sun-seer"].map((id) => TOWER_SPECIALIZATIONS[id].level3Stats), [
  { damage: 105, range: 270, fireRate: 2.25 }, { damage: 82, range: 288, fireRate: 1.7 },
  { damage: 95, fireRate: 2.5 }, { damage: 310, fireRate: 0.8 },
  { damage: 260, range: 198, fireRate: 1.15 }, { damage: 95, range: 198, fireRate: 1.1 },
]);

// Thorn Rot: at most one stack/sec, overlap-independent, full-stack expiry and flying immunity.
const groveStatuses = new AncientGroveStatusSystem();
const rotEnemy = makeEnemy(701);
for (let i = 0; i < 4; i += 1) groveStatuses.updateEnemy(rotEnemy, 0.25, 1);
assert.equal(rotEnemy.thornRotStacks, 1, "multiple overlapping influence sources still add one stack per second");
groveStatuses.updateEnemy(rotEnemy, 1, 1);
assert.equal(rotEnemy.thornRotStacks, 2);
rotEnemy.thornRotStacks = 5;
for (const outsideSecond of [1, 2, 3]) {
  groveStatuses.updateEnemy(rotEnemy, 1, 0);
  assert.equal(rotEnemy.thornRotStacks, 5, `stacks remain unchanged at ${outsideSecond}s outside`);
}
groveStatuses.updateEnemy(rotEnemy, 0.25, 3);
assert.equal(rotEnemy.thornRotStacks, 5, "re-entry preserves stacks");
groveStatuses.updateEnemy(rotEnemy, 1, 3);
assert.equal(rotEnemy.thornRotStacks, 6, "re-entry resumes stack accrual");
groveStatuses.updateEnemy(rotEnemy, 3.99, 0);
assert.equal(rotEnemy.thornRotStacks, 6, "stacks remain through 3.99s outside after re-entry");
groveStatuses.updateEnemy(rotEnemy, 0.01, 0);
assert.equal(rotEnemy.thornRotStacks, 0, "all stacks expire together after four continuous seconds outside");
const flyingRot = makeEnemy(702, "goblinRider");
groveStatuses.updateEnemy(flyingRot, 2, 3);
assert.equal(flyingRot.thornRotStacks, 0, "flying enemies are immune to Thorn Rot");
assert.deepEqual([1, 2, 3].map((level) => FACTION_BONUS_CONFIG.thornRot.damagePerStackPerSecond[level]), [6, 9, 13]);
assert.deepEqual([1, 2, 3].map((level) => FACTION_BONUS_CONFIG.thornRot.maxStacks[level]), [5, 5, 6]);
assert.deepEqual([1, 2, 3].map((level) => getThornRotDamage({ thornRotStacks: FACTION_BONUS_CONFIG.thornRot.maxStacks[level] }, level)), [30, 45, 78]);

// Sunbrand: per-hit stacks, four-second grace, one stack/sec decay, refresh and fixed priority.
const brandEnemy = makeEnemy(703);
for (let hit = 0; hit < 4; hit += 1) groveStatuses.applySunbrandHit(brandEnemy);
assert.equal(brandEnemy.sunbrandStacks, 4);
assert.equal(groveStatuses.applySunbrandHit(brandEnemy), true, "a hit at four stacks triggers Solar Detonation");
assert.equal(brandEnemy.sunbrandStacks, 4, "detonation does not consume stacks");
groveStatuses.updateEnemy(brandEnemy, 4, 0);
assert.equal(brandEnemy.sunbrandStacks, 4, "four-second grace preserves stacks");
groveStatuses.updateEnemy(brandEnemy, 1, 0);
assert.equal(brandEnemy.sunbrandStacks, 3);
groveStatuses.updateEnemy(brandEnemy, 1, 0);
assert.equal(brandEnemy.sunbrandStacks, 2);
groveStatuses.updateEnemy(brandEnemy, 1, 0);
assert.equal(brandEnemy.sunbrandStacks, 1);
groveStatuses.updateEnemy(brandEnemy, 1, 0);
assert.equal(brandEnemy.sunbrandStacks, 0);
brandEnemy.sunbrandStacks = 3;
groveStatuses.applySunbrandHit(brandEnemy);
assert.equal(brandEnemy.sunbrandStacks, 4, "reapplication adds one stack and resets decay grace");
assert.equal(getSunbrandDamage({ sunbrandStacks: 4 }), 72);
assert.deepEqual([3, 0, 2, 1, 4].sort((a, b) => getSunbrandTargetPriority(a) - getSunbrandTargetPriority(b)), [3, 0, 2, 1, 4]);

// Grove Hunter thresholds and the two mechanically distinct Druid branches.
const groveDruid = createBasicTower(704, { x: 5, y: 5 }, "druid");
upgradeTower(groveDruid); upgradeTower(groveDruid, "dire-wolf");
const exposedTank = makeEnemy(705, "goblinBrute");
exposedTank.livingMazeExposureSeconds = 4;
const wolfProfile = getTowerAttackProfile(groveDruid, exposedTank);
assert.equal(wolfProfile.damage, Math.round(95 * 1.2 * 1.3), "Wolf stacks Grove Hunter and tank bonus");
assert.equal(wolfProfile.fireRate, 2.5 * 1.15, "Wolf gains attack speed at four seconds of exposure");
assert.equal(wolfProfile.physicalResistancePenetration, 0.5);
const elderBear = createBasicTower(706, { x: 5, y: 5 }, "druid");
upgradeTower(elderBear); upgradeTower(elderBear, "elder-bear");
assert.equal(getTowerSplashRatioForTarget(elderBear, "melee", 0, 1), 0.55);
assert.equal(getTowerSplashRatioForTarget(elderBear, "melee", 2, 4), 0.7);
assert.equal(getTowerAttackMode(elderBear, makeEnemy(707, "goblin", 6, 5)), "melee");

// Real GameState integration: Sun Seer selects 3 -> 0 -> 2 -> 1 -> 4, then brands and detonates.
const sun = createBasicTower(708, { x: 5, y: 5 }, "seer");
upgradeTower(sun); upgradeTower(sun, "sun-seer");
const targets = [4, 1, 3, 0, 2].map((stacks, index) => {
  const enemy = makeEnemy(710 + index, "goblin", 6, 5);
  enemy.sunbrandStacks = stacks;
  enemy.sunbrandGraceSecondsRemaining = 4;
  return enemy;
});
const sunState = new GameState("single-spawn", "ancient-grove", 708);
sunState.waveActive = true; sunState.toSpawn = 1; sunState.towers = [sun]; sunState.enemies = targets;
sunState.update(0.001);
assert.equal(sunState.attackEvents[0]?.targetEnemyId, 712, "Sun Seer first restores the three-stack target");
assert.equal(sunState.attackEvents[0]?.damageDealt, 95, "a three-stack target is hit before a fully branded target");
assert.equal(targets[2].sunbrandStacks, 4, "Solar detonation leaves the target at four stacks");
assert.equal(targets[2].sunbrandGraceSecondsRemaining, 4, "Solar hit refreshes the grace period");
const fullyBranded = makeEnemy(720, "goblin", 6, 5);
fullyBranded.sunbrandStacks = 4; fullyBranded.sunbrandGraceSecondsRemaining = 4;
sun.cooldownRemaining = 0;
const detonationState = new GameState("single-spawn", "ancient-grove", 709);
detonationState.waveActive = true; detonationState.toSpawn = 1; detonationState.towers = [sun]; detonationState.enemies = [fullyBranded];
detonationState.update(0.001);
assert.equal(detonationState.attackEvents[0]?.damageDealt, 275, "hitting an already fully branded target adds 180 magic damage");
assert.equal(fullyBranded.sunbrandStacks, 4, "Solar detonation does not consume the four stacks");

// Status damage is applied by GameState and survives without any renderer dependency.
const rotState = new GameState("single-spawn", "ancient-grove", 721);
const rotCell = rotState.path[5];
const rotTarget = createEnemy(721, "goblin", rotState.path, 1);
Object.assign(rotTarget, { currentPathIndex: 5, x: rotCell.x, y: rotCell.y, hp: 10000, maxHp: 10000, speed: 0 });
const overlappingTreants = [0, 1, 2, 3].map((offset) => {
  const treant = createBasicTower(730 + offset, { x: rotCell.x + (offset % 2 ? 1 : -1), y: rotCell.y + (offset < 2 ? 1 : -1) }, "treant");
  treant.cooldownRemaining = 10;
  return treant;
});
rotState.towers = overlappingTreants;
rotState.factionBonuses.rebuildLivingMazeInfluence(rotState.towers, [rotState.path]);
rotState.waveActive = true; rotState.toSpawn = 1; rotState.enemies = [rotTarget];
rotState.update(1);
assert.equal(rotTarget.thornRotStacks, 1, "four overlapping Treants still add one Thorn Rot stack/sec");
assert.equal(rotTarget.hp, 9994, "one L1 Thorn Rot stack deals 6 DPS through GameState");

const sunDotEnemy = makeEnemy(722);
sunDotEnemy.sunbrandStacks = 4; sunDotEnemy.sunbrandGraceSecondsRemaining = 4; sunDotEnemy.speed = 0;
sun.cooldownRemaining = 10;
const sunDotState = new GameState("single-spawn", "ancient-grove", 722);
sunDotState.waveActive = true; sunDotState.toSpawn = 1; sunDotState.towers = [sun]; sunDotState.enemies = [sunDotEnemy];
sunDotState.update(4);
assert.equal(sunDotEnemy.hp, 10000 - 72 * 4, "Sunbrand deals 72 DPS during its four-second grace");
assert.equal(sunDotEnemy.sunbrandStacks, 4);
sunDotState.update(1);
assert.equal(sunDotEnemy.sunbrandStacks, 3);
assert.equal(sunDotEnemy.hp, 10000 - 72 * 4 - 54, "Sunbrand continues dealing damage while decaying one stack/sec");

// Stormcaller chains twice, in order, without repeating its primary target.
const storm = level2Tower(2, "blue-wizard");
storm.specializationId = "stormcaller";
storm.level = 3;
storm.damage = TOWER_SPECIALIZATIONS.stormcaller.level3Stats.damage;
storm.range = TOWER_SPECIALIZATIONS.stormcaller.level3Stats.range;
storm.fireRate = TOWER_SPECIALIZATIONS.stormcaller.level3Stats.fireRate;
const stormState = attackWith(storm, [makeEnemy(11, "goblin", 6, 5), makeEnemy(12, "goblin", 7, 5), makeEnemy(13, "goblin", 8, 5)]);
assert.deepEqual(stormState.attackEvents.map((event) => [event.effectKind, event.targetEnemyId, event.damageDealt]), [
  ["primary", 13, 115], ["chain", 12, 52], ["chain", 11, 29],
]);
assert.equal(stormState.towers[0].combatStats.damageDone, 196, "chain hits use the canonical telemetry path");

// Frost slow is temporary, refreshes to a full duration, and never alters base speed.
const frost = createBasicTower(3, { x: 5, y: 5 }, "blue-wizard");
upgradeTower(frost); frost.specializationId = "frostweaver"; frost.level = 3;
frost.damage = 110; frost.range = 135; frost.fireRate = 1.05;
const slowed = makeEnemy(14, "goblin", 6, 5);
const frostState = attackWith(frost, [slowed]);
const baseSpeed = slowed.speed;
assert.equal(slowed.slowMultiplier, 0.75);
assert.equal(slowed.slowSecondsRemaining, 1.5);
frostState.update(1, 1);
assert.equal(slowed.slowMultiplier, 0.75);
assert.equal(slowed.slowSecondsRemaining, 1.5, "a subsequent frost hit refreshes rather than stacks the slow");
assert.equal(slowed.speed, baseSpeed, "slow leaves the base speed unchanged");

// Holy Knight boss bonus only affects tank/boss classes; Dawn Paladin is bounded cleave.
const champion = createBasicTower(4, { x: 5, y: 5 }, "holy-knight");
upgradeTower(champion); champion.specializationId = "royal-champion"; champion.level = 3; champion.damage = 320; champion.fireRate = 1.05;
assert.equal(getTowerAttackProfile(champion, makeEnemy(20, "goblin", 6, 5)).damage, 320);
assert.equal(getTowerAttackProfile(champion, makeEnemy(21, "goblinBrute", 6, 5)).damage, 416);
assert.equal(getTowerAttackProfile(champion, makeEnemy(22, "skeletonKing", 6, 5)).damage, 416);
assert.equal(getTowerDamageType(champion, "melee"), "physical");
const paladin = createBasicTower(5, { x: 5, y: 5 }, "holy-knight");
upgradeTower(paladin); paladin.specializationId = "dawn-paladin"; paladin.level = 3; paladin.damage = 230; paladin.fireRate = 1.4;
const cleaveState = attackWith(paladin, [makeEnemy(31, "goblin", 6, 5), makeEnemy(32, "goblin", 6, 6), makeEnemy(33, "goblin", 5, 6)]);
assert.equal(cleaveState.attackEvents.filter(({ effectKind }) => effectKind === "cleave").length, 2);
assert.equal(cleaveState.attackEvents.length, 3, "cleave is capped at two secondaries and cannot recurse");

// Battlemage branches retain the fallback/range modes while specializing their main role.
const spellblade = createBasicTower(6, { x: 5, y: 5 }, "battlemage");
upgradeTower(spellblade); spellblade.specializationId = "spellblade"; spellblade.level = 3; spellblade.damage = 290;
assert.equal(getTowerAttackProfile(spellblade, makeEnemy(40, "goblin", 6, 5)).damage, 464);
assert.equal(getTowerSplashRatio(spellblade, "melee"), 0.6);
assert.equal(getTowerSplashRatio(spellblade, "ranged"), 0.5, "Spellblade keeps normal ranged fallback splash");
assert.equal(getTowerDamageType(spellblade, "melee"), "physical");
const warcaster = createBasicTower(7, { x: 5, y: 5 }, "battlemage");
upgradeTower(warcaster); warcaster.specializationId = "warcaster"; warcaster.level = 3; warcaster.damage = 290;
warcaster.range = 4.2 * WORLD_UNITS_PER_CELL;
assert.equal(warcaster.range, 4.2 * WORLD_UNITS_PER_CELL);
assert.equal(getTowerSplashRatio(warcaster, "ranged"), 0.6);
assert.equal(getTowerSplashRatio(warcaster, "melee"), 0.5);
assert.equal(getTowerAttackProfile(warcaster, makeEnemy(41, "goblin", 6, 5)).damage, 392);
assert.equal(canTowerTargetEnemy(warcaster, makeEnemy(42, "goblinRider", 6, 5)), true, "Warcaster retains air targeting");
assert.equal(getTowerDamageType(warcaster, "ranged"), "magic");

// All five formations evaluate the 8 neighboring cells; only one highest-priority bonus applies.
const towerAt = (id, type, x, y) => createBasicTower(id, { x, y }, type);
const centerWizard = towerAt(50, "blue-wizard", 5, 5);
const wizards = [centerWizard, towerAt(51, "blue-wizard", 4, 5), towerAt(52, "blue-wizard", 6, 5)];
assert.equal(resolveFormation(centerWizard, wizards)?.id, "arcane-triad");
const overlapWizard = [centerWizard, ...wizards.slice(1), towerAt(53, "holy-knight", 5, 4), towerAt(54, "holy-knight", 5, 6)];
assert.equal(resolveFormation(centerWizard, overlapWizard)?.id, "arcane-triad", "Arcane Triad priority beats Royal Escort");
const knight = towerAt(55, "holy-knight", 5, 5);
assert.equal(resolveFormation(knight, [knight, towerAt(56, "holy-knight", 4, 5), towerAt(57, "holy-knight", 5, 4)])?.attackSpeedMultiplier, 1.12);
const mage = towerAt(58, "battlemage", 5, 5);
const vanguardTowers = [mage, towerAt(59, "blue-wizard", 4, 5), towerAt(60, "holy-knight", 6, 5), towerAt(61, "blue-wizard", 5, 4)];
assert.equal(resolveFormation(mage, vanguardTowers)?.id, "arcane-vanguard", "Vanguard priority beats Spell Battery");
assert.equal(resolveFormation(mage, [mage, ...vanguardTowers.slice(1, 2), vanguardTowers[3]])?.id, "spell-battery");
const vanguardTower = createBasicTower(62, { x: 5, y: 5 }, "battlemage");
vanguardTower.formationId = "arcane-vanguard";
assert.equal(getTowerAttackProfile(vanguardTower, makeEnemy(63, "goblin", 6, 5)).damage, 75, "Vanguard applies to melee and ranged damage");
assert.equal(getTowerSplashRadiusMultiplier(vanguardTower), 1.15);
const batteryTower = createBasicTower(64, { x: 5, y: 5 }, "battlemage");
batteryTower.formationId = "spell-battery";
assert.equal(getTowerAttackProfile(batteryTower, makeEnemy(65, "goblin", 6, 5)).damage, 68, "Battery does not buff melee");
assert.equal(getTowerAttackProfile(batteryTower, makeEnemy(66, "goblin", 8, 5)).damage, 57, "Battery buffs ranged mode only");

const formationState = new GameState("single-spawn", "arcane-kingdom", 20);
formationState.gold = 1000;
formationState.towers = wizards;
formationState.refreshFormations();
assert.equal(centerWizard.formationId, "arcane-triad");
formationState.sellTower(51);
assert.equal(centerWizard.formationId, undefined, "selling a qualifying neighbor disables the formation");
formationState.towers.push(towerAt(51, "blue-wizard", 4, 5));
formationState.refreshFormations();
assert.equal(centerWizard.formationId, "arcane-triad", "a qualifying neighbor reactivates it");
formationState.resetGame("try-again");
assert.equal(formationState.towers.length, 0);

// Affix rolls are run-seeded, milestones are gated, and each run keeps its progression.
const runA = new EnemyAffixSystem(1);
const runB = new EnemyAffixSystem(2);
assert.equal(runA.rollMilestone(14), undefined);
const tier1A = runA.rollMilestone(15);
assert.equal(tier1A.tier, 1);
assert.equal(tier1A.title, "THE HORDE MUTATES");
assert.equal(new Set(tier1A.affixes).size, 2);
assert.notDeepEqual(tier1A.affixes, runB.rollMilestone(15).affixes, "new run seeds can produce different rolls");
const tier2 = runA.rollMilestone(30);
const tier3 = runA.rollMilestone(45);
assert.equal(tier2.tier, 2); assert.equal(tier3.tier, 3);
for (const affix of [...tier1A.affixes, ...tier2.affixes, ...tier3.affixes]) {
  assert.ok(runA.getProgression()[1]?.includes(affix) || runA.getProgression()[2]?.includes(affix) || runA.getProgression()[3]?.includes(affix));
}
const empoweredBoss = makeEnemy(70, "skeletonKing", 6, 5, 100, 45);
const bossSystem = new EnemyAffixSystem(10);
const bossAffixes = [bossSystem.rollMilestone(15), bossSystem.rollMilestone(30), bossSystem.rollMilestone(45)].flatMap((roll) => roll.affixes);
bossSystem.assign(empoweredBoss, 50);
assert.equal(empoweredBoss.affixes.length, bossAffixes.length, "Skeleton King carries each current milestone affix exactly once");

// Exact resistance, fortified-after-wave-scaling, shields, regen, speed and nonstacking Commander aura.
const armored = makeEnemy(71);
applyEnemyAffixes(armored, [{ id: "armored", tier: 3 }, { id: "arcane-ward", tier: 2 }]);
assert.equal(getEnemyDamageMultiplier(armored, "physical"), 0.65);
assert.equal(getEnemyDamageMultiplier(armored, "magic"), 0.75);
const fortified = createEnemy(72, "goblin", path, 11);
applyEnemyAffixes(fortified, [{ id: "fortified", tier: 1 }]);
assert.equal(fortified.maxHp, Math.round(getEnemyHpForWave("goblin", 11) * 1.2));
assert.equal(fortified.hp, fortified.maxHp);
const shielded = createEnemy(73, "goblin", path, 1);
applyEnemyAffixes(shielded, [{ id: "fortified", tier: 1 }, { id: "shielded", tier: 2 }]);
assert.equal(shielded.shield, Math.round(shielded.maxHp * 0.25));
assert.equal(shielded.maxHp, 180, "fortification is applied before its shield is calculated");
const shieldTestTower = createBasicTower(730, { x: 5, y: 5 }, "blue-wizard");
const shieldTestEnemy = makeEnemy(731, "goblin", 6, 5, 100);
shieldTestEnemy.shield = 20; shieldTestEnemy.maxShield = 20;
const shieldTestState = attackWith(shieldTestTower, [shieldTestEnemy]);
assert.deepEqual([shieldTestEnemy.shield, shieldTestEnemy.hp, shieldTestState.attackEvents[0].damageDealt], [0, 95, 25], "shield absorbs first and overflow reaches HP; telemetry counts effective damage once");
const regenerator = makeEnemy(74, "goblin", 6, 5, 50);
applyEnemyAffixes(regenerator, [{ id: "regenerator", tier: 3 }]);
regenerator.hp = regenerator.maxHp - 1;
regenerator.regenDelayRemaining = 0;
updateEnemyAffixes(regenerator, 10);
assert.equal(regenerator.hp, regenerator.maxHp, "regen is capped at max health");
const swiftFrenzy = makeEnemy(75, "goblin", 6, 5, 30);
swiftFrenzy.maxHp = 100;
applyEnemyAffixes(swiftFrenzy, [{ id: "swift", tier: 1 }, { id: "frenzied", tier: 3 }]);
assert.ok(Math.abs(getEnemySpeedMultiplier(swiftFrenzy) - (1.1 * 1.3)) < 1e-10);
swiftFrenzy.hp = 35;
assert.equal(getEnemySpeedMultiplier(swiftFrenzy), 1.1, "Frenzied only triggers below 35% health");
const auraTarget = makeEnemy(76, "goblin", 6, 5);
const commander1 = makeEnemy(77, "skeletalCommander", 7, 5); commander1.affixes = [{ id: "commander", tier: 1 }];
const commander2 = makeEnemy(78, "skeletalCommander", 8, 5); commander2.affixes = [{ id: "commander", tier: 3 }];
assert.equal(getCommanderAuraMultiplier(auraTarget, [auraTarget, commander1, commander2]), 1.18, "Commander aura uses highest nearby bonus without stacking");
assert.equal(getCommanderAuraMultiplier(commander2, [commander2]), 1);
assert.equal(canTowerTargetEnemy(createBasicTower(79, { x: 5, y: 5 }, "blue-wizard"), makeEnemy(80, "goblinRider")), true, "flying target eligibility is unchanged");
const thornOwl = createBasicTower(801, { x: 5, y: 5 }, "thorn-owl");
assert.equal(canTowerTargetEnemy(thornOwl, makeEnemy(802, "goblinRider")), true, "Thorn Owl targets flying enemies");
assert.equal(canTowerTargetEnemy(thornOwl, makeEnemy(803, "goblin")), false, "Thorn Owl cannot target ground enemies");
const owlTarget = makeEnemy(804, "goblinRider");
attackWith(thornOwl, [owlTarget]);
assert.equal(owlTarget.slowMultiplier, 1, "Thorn Owl attacks do not apply flying slow");
assert.equal(owlTarget.livingMazeExposureSeconds, 0, "Thorn Owl has no Living Maze interaction");

// Milestone warning prevents immediate spawn and clears after the warning window.
const warningState = new GameState("single-spawn", "arcane-kingdom", 30);
warningState.wavesStarted = 14;
warningState.currentWave = 14;
assert.equal(warningState.startWave(), true);
assert.equal(warningState.currentWave, 15);
assert.equal(warningState.affixWarning.title, "THE HORDE MUTATES");
warningState.update(0, 0);
assert.equal(warningState.enemies.length, 0, "milestone wave does not spawn behind its warning");
warningState.update(0, 4.9);
assert.ok(warningState.affixWarning, "affix warning remains visible for the full five-second window");
assert.equal(warningState.enemies.length, 0, "Auto Run does not spawn before the warning ends");
warningState.update(0, 0.1);
assert.equal(warningState.affixWarning, undefined);
assert.equal(warningState.enemies.length, 1, "spawning begins as soon as warning completes");
const autoWarningState = new GameState("single-spawn", "arcane-kingdom", 31);
autoWarningState.currentWave = 14; autoWarningState.wavesStarted = 14;
autoWarningState.waveActive = true; autoWarningState.autoRun = true; autoWarningState.toSpawn = 0;
autoWarningState.update(0);
assert.equal(autoWarningState.currentWave, 15, "Auto Run transitions directly into milestone wave");
assert.equal(autoWarningState.affixWarning.title, "THE HORDE MUTATES");
assert.equal(autoWarningState.waveActive, true);
assert.equal(autoWarningState.enemies.length, 0, "Auto Run waits during its milestone warning");

const regenDelay = makeEnemy(81, "goblin", 6, 5, 100);
regenDelay.affixes = [{ id: "regenerator", tier: 3 }]; regenDelay.hp = 50; regenDelay.regenDelayRemaining = 1;
updateEnemyAffixes(regenDelay, 0.5);
assert.equal(regenDelay.hp, 50, "regen pauses during the full hit delay");
updateEnemyAffixes(regenDelay, 1);
assert.equal(regenDelay.hp, 50.75, "a delta crossing the delay heals only for time after the pause");

// Deterministic Wave 1 sanity: spend 56 of the normal 100 starting gold on
// eight valid, route-covering Treants, then let the platform-neutral game model run.
const groveWave1 = new GameState("single-spawn", "ancient-grove", 100);
const groveReferenceRoute = [...groveWave1.path];
for (let count = 0; count < 8; count += 1) {
  const target = groveReferenceRoute[Math.round((count + 1) * (groveReferenceRoute.length - 1) / 9)];
  const buildCells = [];
  for (let y = 0; y < groveWave1.map.height; y += 1) for (let x = 0; x < groveWave1.map.width; x += 1) {
    const cell = { x, y };
    if (!groveWave1.grid.isBuildable(cell)) continue;
    buildCells.push({ cell, distance: Math.hypot(x - target.x, y - target.y) });
  }
  buildCells.sort((a, b) => a.distance - b.distance || a.cell.x - b.cell.x || a.cell.y - b.cell.y);
  const selectedCell = buildCells.find(({ cell }) => groveWave1.canPlaceBasicTower(cell, "treant") === "placed")?.cell;
  assert.ok(selectedCell, `Treant ${count + 1} has a valid non-blocking build cell`);
  assert.equal(groveWave1.placeBasicTower(selectedCell, "treant"), "placed");
}
assert.equal(groveWave1.gold, 44, "eight L1 Treants cost 56 gold, leaving 44 from normal starting gold");
assert.equal(groveWave1.startWave(), true);
for (let frame = 0; frame < 2000 && groveWave1.waveActive; frame += 1) groveWave1.update(0.1);
assert.equal(groveWave1.waveActive, false, "the real Wave 1 simulation completes");
assert.ok(groveWave1.lives > 0, "Ancient Grove survives the first wave with eight L1 Treants");
assert.ok(groveWave1.towers.reduce((total, tower) => total + tower.combatStats.kills, 0) > 0,
  "Treants deal enough real combat damage to kill Wave 1 enemies");

console.log("Gameplay depth tests passed: specializations, formations, affixes, damage, warning timing.");
