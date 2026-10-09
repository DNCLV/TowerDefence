import assert from "node:assert/strict";
import { WORLD_UNITS_PER_CELL } from "../src/core/GameConstants.ts";
import { GameState } from "../src/game/GameState.ts";
import { AncientGroveStatusSystem } from "../src/game/AncientGroveStatusSystem.ts";
import { FactionBonusSystem } from "../src/game/FactionBonusSystem.ts";
import { DEFENDER_CONFIG } from "../src/game/config/DefenderConfig.ts";
import { FACTION_BONUS_CONFIG } from "../src/game/config/FactionBonusConfig.ts";
import { FACTIONS } from "../src/game/config/FactionConfig.ts";
import { SPECIALIZATIONS_BY_DEFENDER, TOWER_SPECIALIZATIONS } from "../src/game/config/SpecializationConfig.ts";
import { getVerdantResonanceProfile } from "../src/game/config/AncientGroveUnitConfig.ts";
import { createEnemy } from "../src/game/enemies/Enemy.ts";
import { createBasicTower, isTowerInRange, upgradeTower } from "../src/game/towers/Tower.ts";

const route = Array.from({ length: 20 }, (_, index) => ({ x: 5 + index, y: 5 }));
const makeEnemy = (id, x, y, movementType = "ground", hp = 50_000) => {
  const enemy = createEnemy(id, movementType === "flying" ? "goblinRider" : "goblin", route);
  Object.assign(enemy, { x, y, movementType, speed: 0, hp, maxHp: hp, currentPathIndex: 0 });
  return enemy;
};
const combatState = (towers, enemies) => {
  const state = new GameState("single-spawn", "ancient-grove", 71);
  state.waveActive = true;
  state.toSpawn = 0;
  state.towers = towers;
  state.enemies = enemies;
  state.refreshLivingMazeInfluence();
  return state;
};
const makeL3 = (id, type, specializationId) => {
  const tower = createBasicTower(id, { x: 5, y: 5 }, type);
  upgradeTower(tower);
  upgradeTower(tower, specializationId);
  return tower;
};

assert.deepEqual(FACTIONS["ancient-grove"].units.slice(-2), ["bark-titan", "thorn-dancer"]);
assert.deepEqual(DEFENDER_CONFIG.treant.levels.map(({ damage, fireRate }) => [damage, fireRate]), [[15, 0.95], [32, 1.05], [52, 1.15]]);
assert.deepEqual([FACTION_BONUS_CONFIG.thornRot.damagePerStackPerSecond, FACTION_BONUS_CONFIG.thornRot.maxStacks], [
  { 1: 5, 2: 9, 3: 13 }, { 1: 5, 2: 5, 3: 6 },
]);
assert.deepEqual(DEFENDER_CONFIG["thorn-owl"].levels.map(({ damage, range, fireRate, upgradeCost }) => [
  damage, range / WORLD_UNITS_PER_CELL, fireRate, upgradeCost,
]), [[28, 6, 1.4, null], [52, 6.6, 1.55, 25], [82, 8, 1.7, 125]]);
assert.deepEqual([DEFENDER_CONFIG.treant.buildCost, DEFENDER_CONFIG["thorn-owl"].buildCost, DEFENDER_CONFIG["thorn-owl"].targetTypes], [7, 15, ["air"]]);
assert.equal(DEFENDER_CONFIG["bark-titan"].buildCost, 150);
assert.deepEqual(DEFENDER_CONFIG["bark-titan"].levels.map(({ range, fireRate }) => [range, fireRate]), [[1, 0.5], [1, 0.5], [1, 0.5]]);
assert.equal(DEFENDER_CONFIG["thorn-dancer"].buildCost, 300);
assert.deepEqual(SPECIALIZATIONS_BY_DEFENDER["bark-titan"], ["stonebark-titan", "heartwood-crusher"]);
assert.deepEqual(SPECIALIZATIONS_BY_DEFENDER["thorn-dancer"], ["blight-dancer", "winterthorn-dancer"]);

// Bark Titan hits every ground enemy in Holy Knight's adjacent-cell footprint, but neither air nor the second ring.
const bark = createBasicTower(1, { x: 5, y: 5 }, "bark-titan");
const adjacentA = makeEnemy(1, 6, 5);
const adjacentB = makeEnemy(2, 4, 4);
const secondRing = makeEnemy(3, 7, 5);
const flying = makeEnemy(4, 6, 6, "flying");
const barkState = combatState([bark], [adjacentA, adjacentB, secondRing, flying]);
barkState.update(0.001);
assert.deepEqual([adjacentA.hp, adjacentB.hp, secondRing.hp, flying.hp], [49_480, 49_480, 50_000, 50_000]);
assert.equal(bark.cooldownRemaining, 2, "0.5 attacks/sec produces one attack every two seconds");
assert.deepEqual(barkState.attackEvents.map(({ targetEnemyId, effectKind }) => [targetEnemyId, effectKind]), [[1, "radial"], [2, "radial"]]);

// Stonebark adds exactly one outward cell ring and retains the fixed slow cadence.
const stonebark = makeL3(2, "bark-titan", "stonebark-titan");
const stoneOuter = makeEnemy(5, 7, 5);
const stoneBeyond = makeEnemy(6, 8, 5);
assert.equal(isTowerInRange(stonebark, stoneOuter), true);
assert.equal(isTowerInRange(stonebark, stoneBeyond), false);
const stoneState = combatState([stonebark], [stoneOuter, stoneBeyond]);
stoneState.update(0.001);
assert.deepEqual([stoneOuter.hp, stoneBeyond.hp, stonebark.fireRate], [48_500, 50_000, 0.5]);

// Heartwood's normal ring attacks every time; its third attack adds a wider 75% shockwave.
const heartwood = makeL3(3, "bark-titan", "heartwood-crusher");
const heartInner = makeEnemy(7, 6, 5);
const heartOuter = makeEnemy(8, 7, 5);
const heartState = combatState([heartwood], [heartInner, heartOuter]);
heartState.update(0.001);
heartState.update(2);
assert.deepEqual([heartInner.hp, heartOuter.hp, heartwood.specializationAttackCounter], [45_800, 50_000, 2]);
heartState.update(2);
assert.deepEqual([heartInner.hp, heartOuter.hp], [42_125, 48_425]);
assert.ok(heartState.attackEvents.some(({ targetEnemyId, effectKind, damageDealt }) => targetEnemyId === 8 && effectKind === "shockwave" && damageDealt === 1_575));

// Aura profiles amplify only existing effects and do not stack identical copies.
assert.deepEqual(getVerdantResonanceProfile(), {
  radiusCells: 4.5, dotDamageMultiplier: 1.2, slowStrengthMultiplier: 1.25, enablesGroundEffectsAgainstFlying: true,
});
assert.equal(getVerdantResonanceProfile("blight-dancer").dotDamageMultiplier, 1.4);
assert.equal(getVerdantResonanceProfile("blight-dancer").slowStrengthMultiplier, 1.15);
assert.equal(getVerdantResonanceProfile("winterthorn-dancer").dotDamageMultiplier, 1.15);
assert.equal(getVerdantResonanceProfile("winterthorn-dancer").slowStrengthMultiplier, 1.4);

const maze = new FactionBonusSystem("ancient-grove");
const treant = createBasicTower(10, { x: 5, y: 5 }, "treant");
maze.rebuildLivingMazeInfluence([treant], [route]);
const controlledFlyer = makeEnemy(9, 6, 5, "flying");
maze.updateLivingMazeExposure(controlledFlyer, 5, true, { x: 6, y: 5 });
assert.equal(maze.getLivingMazeSlowMultiplier(controlledFlyer, 1.25, true), 0.75, "base aura strengthens the 20% cap to 25%");
assert.equal(maze.getLivingMazeSlowMultiplier(controlledFlyer), 1, "flying remains unaffected without aura permission");

// A flying enemy in both Treant influence and the Dancer aura can receive Thorn Rot; leaving aura clears it.
const dancer = createBasicTower(11, { x: 6, y: 5 }, "thorn-dancer");
treant.cooldownRemaining = 999;
dancer.cooldownRemaining = 999;
const auraFlyer = makeEnemy(10, 6, 6, "flying", 1_000);
const auraState = combatState([treant, dancer], [auraFlyer]);
auraState.update(1);
assert.equal(auraFlyer.thornRotStacks, 1);
assert.equal(auraFlyer.hp, 994, "base Verdant Resonance increases 5 Thorn Rot DPS to 6");
auraFlyer.x = 20;
auraFlyer.y = 20;
auraState.update(0.01);
assert.equal(auraFlyer.thornRotStacks, 0, "ground-only Thorn Rot stops immediately when a flyer leaves the enabling aura");

// Existing air-capable Sunbrand remains valid everywhere, but receives amplification only inside the aura.
const sunInside = makeEnemy(11, 6, 6, "flying", 1_000);
sunInside.sunbrandStacks = 1;
sunInside.sunbrandGraceSecondsRemaining = 10;
const sunAuraState = combatState([dancer], [sunInside]);
sunAuraState.update(1);
assert.equal(sunInside.hp, 979, "18 Sunbrand DPS receives the base +20% aura bonus");
const sunOutside = makeEnemy(12, 20, 20, "flying", 1_000);
sunOutside.sunbrandStacks = 1;
sunOutside.sunbrandGraceSecondsRemaining = 10;
const sunBaseState = combatState([], [sunOutside]);
sunBaseState.update(1);
assert.equal(sunOutside.hp, 982, "Sunbrand keeps normal damage outside Verdant Resonance");

const secondDancer = createBasicTower(13, { x: 7, y: 5 }, "thorn-dancer");
secondDancer.cooldownRemaining = 999;
const overlappingAuraTarget = makeEnemy(15, 6, 6, "flying", 1_000);
overlappingAuraTarget.sunbrandStacks = 1;
overlappingAuraTarget.sunbrandGraceSecondsRemaining = 10;
const overlappingAuraState = combatState([dancer, secondDancer], [overlappingAuraTarget]);
overlappingAuraState.update(1);
assert.equal(overlappingAuraTarget.hp, 979, "overlapping base auras use the strongest bonus instead of stacking");

// Thorn Dancer's own shot is ordinary magic damage and applies no status or control state.
const plainDancer = createBasicTower(14, { x: 5, y: 5 }, "thorn-dancer");
const plainTarget = makeEnemy(13, 7, 5, "ground", 1_000);
const plainState = combatState([plainDancer], [plainTarget]);
plainState.update(0.001);
assert.equal(plainTarget.hp, 880);
assert.deepEqual([plainTarget.thornRotStacks, plainTarget.sunbrandStacks, plainTarget.slowSecondsRemaining], [0, 0, 0]);

// Ground-only status API remains unchanged when no aura explicitly enables flying.
const statuses = new AncientGroveStatusSystem();
const noAuraFlyer = makeEnemy(14, 6, 5, "flying");
statuses.updateEnemy(noAuraFlyer, 2, 3);
assert.equal(noAuraFlyer.thornRotStacks, 0);

assert.equal(TOWER_SPECIALIZATIONS["stonebark-titan"].level3Stats.range, 2);
assert.deepEqual(TOWER_SPECIALIZATIONS["heartwood-crusher"].shockwave, { everyNthAttack: 3, damageRatio: 0.75, rangeCells: 2 });

console.log("Ancient Grove unit tests passed: Bark Titan radial coverage, both Titan branches, Verdant Resonance amplification, flying eligibility, and aura-only support behavior.");
