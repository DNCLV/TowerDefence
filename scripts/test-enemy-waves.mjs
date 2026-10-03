import assert from "node:assert/strict";
const [{ GameState }, enemyModule, waveModule, visualModule, towerModule, constantsModule, defenderModule] = await Promise.all([
  import("../src/game/GameState.ts"),
  import("../src/game/enemies/Enemy.ts"),
  import("../src/game/config/WaveConfig.ts"),
  import("../src/game/rendering3d/EnemyVisualConfig.ts"),
  import("../src/game/towers/Tower.ts"),
  import("../src/core/GameConstants.ts"),
  import("../src/game/config/DefenderConfig.ts"),
]);
const originalLog = console.log;
const originalInfo = console.info;
console.log = () => {};
console.info = () => {};

try {
  const { createEnemy } = enemyModule;
  const { ENEMY_VISUAL_CONFIG } = visualModule;
  const { getEnemyHpForWave, getEnemyHpMultiplier, getEnemyHpTier } = enemyModule;
  const {
    ENEMY_THREAT_WEIGHT, MAX_ACTIVE_WAVE_ENEMIES, getWaveComposition, createWaveSpawnQueue,
    countWaveComposition, getWaveSpawnInterval, getWaveThreatBudget, getWaveRewardMultiplier,
    getWaveGoldReward,
  } = waveModule;
  const { createBasicTower, canTowerTargetEnemy, getTotalTowerInvestment, getTowerSellRefund } = towerModule;
  const { WORLD_UNITS_PER_CELL } = constantsModule;
  const { DEFENDER_CONFIG } = defenderModule;

  const expected = {
    1: [12, 0, 0, 0], 2: [16, 0, 0, 0], 3: [14, 2, 0, 0], 4: [18, 2, 0, 0],
    5: [14, 4, 0, 0], 6: [20, 4, 0, 0], 7: [0, 0, 12, 0], 8: [16, 4, 2, 0],
    9: [18, 5, 3, 0], 10: [14, 4, 0, 1], 11: [22, 5, 4, 0], 12: [18, 7, 4, 0],
    13: [24, 6, 5, 0], 14: [0, 0, 18, 0], 15: [20, 8, 5, 0], 16: [24, 8, 6, 0],
    17: [18, 10, 7, 0], 18: [26, 9, 8, 0], 19: [20, 12, 8, 0], 20: [18, 8, 4, 2],
  };
  const keys = ["goblin", "goblinBrute", "goblinRider", "giantGoblin", "ghoul", "wraith"];
  for (const [wave, counts] of Object.entries(expected)) {
    const composition = countWaveComposition(getWaveComposition(Number(wave)));
    assert.deepEqual(keys.slice(0, 4).map((key) => composition[key]), counts, `wave ${wave} composition`);
    assert.equal(composition.ghoul + composition.wraith, 0, `new archetypes are not introduced before wave 25`);
  }
  assert.deepEqual(countWaveComposition(getWaveComposition(25)), {
    goblin: 10, goblinBrute: 4, goblinRider: 0, giantGoblin: 0, ghoul: 6, wraith: 3, undeadDragon: 0, skeletonKing: 0, skeletalCommander: 0,
  }, "wave 25 introduces Ghoul and Wraith exactly as specified");
  assert.deepEqual(countWaveComposition(getWaveComposition(26)), {
    goblin: 8, goblinBrute: 5, goblinRider: 3, giantGoblin: 0, ghoul: 8, wraith: 4, undeadDragon: 0, skeletonKing: 0, skeletalCommander: 0,
  }, "wave 26 uses the specified mixed composition");
  assert.deepEqual(countWaveComposition(getWaveComposition(27)), {
    goblin: 6, goblinBrute: 4, goblinRider: 0, giantGoblin: 0, ghoul: 10, wraith: 6, undeadDragon: 0, skeletonKing: 0, skeletalCommander: 0,
  }, "wave 27 uses the specified mixed composition");
  assert.deepEqual(countWaveComposition(getWaveComposition(28)), {
    goblin: 0, goblinBrute: 0, goblinRider: 34, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 0, skeletonKing: 0, skeletalCommander: 0,
  }, "wave 28 remains flying-focused");
  for (const wave of [22, 23, 24, 28]) {
    const counts = countWaveComposition(getWaveComposition(wave));
    assert.equal(counts.ghoul + counts.wraith, 0, `wave ${wave} excludes not-yet-introduced or special-wave new enemies`);
  }
  const firstGeneratedMixedWave = countWaveComposition(getWaveComposition(29));
  assert.ok(firstGeneratedMixedWave.ghoul > 0 && firstGeneratedMixedWave.wraith > 0,
    "both new enemies enter normal generated threat-budget waves after wave 28");
  for (let wave = 7; wave <= 200; wave += 7) {
    const counts = countWaveComposition(getWaveComposition(wave));
    assert.equal(counts.ghoul + counts.wraith, 0, `flying-focused wave ${wave} excludes new ground enemies`);
  }
  assert.deepEqual([ENEMY_THREAT_WEIGHT.ghoul, ENEMY_THREAT_WEIGHT.wraith], [3, 7]);
  const optimizedEnemyPaths = {
    goblin: "/assets/models/enemies/optimized/goblin.glb",
    goblinBrute: "/assets/models/enemies/optimized/goblin-brute.glb",
    goblinRider: "/assets/models/enemies/optimized/goblin-rider.glb",
    giantGoblin: "/assets/models/enemies/optimized/giant-goblin.glb",
    ghoul: "/assets/models/enemies/optimized/ghoul.glb",
    wraith: "/assets/models/enemies/optimized/wraith.glb",
  };
  const sourceEnemyPaths = {
    goblin: "/assets/models/enemies/goblin.glb",
    goblinBrute: "/assets/models/enemies/goblin-brute.glb",
    goblinRider: "/assets/models/enemies/goblin-rider.glb",
    giantGoblin: "/assets/models/enemies/giant-goblin.glb",
    ghoul: "/assets/models/enemies/ghoul.glb",
    wraith: "/assets/models/enemies/wraith.glb",
  };
  for (const [type, path] of Object.entries(optimizedEnemyPaths)) {
    assert.equal(ENEMY_VISUAL_CONFIG[type].assetPath, path, `${type} uses optimized runtime GLB`);
    assert.equal(ENEMY_VISUAL_CONFIG[type].fallbackAssetPath, sourceEnemyPaths[type], `${type} keeps original runtime GLB fallback`);
  }
  const ghoulVisualHeight = ENEMY_VISUAL_CONFIG.ghoul.sourceDimensions.height * ENEMY_VISUAL_CONFIG.ghoul.scale;
  const goblinVisualHeight = ENEMY_VISUAL_CONFIG.goblin.sourceDimensions.height * ENEMY_VISUAL_CONFIG.goblin.scale;
  const bruteVisualHeight = ENEMY_VISUAL_CONFIG.goblinBrute.sourceDimensions.height * ENEMY_VISUAL_CONFIG.goblinBrute.scale;
  const wraithVisualHeight = ENEMY_VISUAL_CONFIG.wraith.sourceDimensions.height * ENEMY_VISUAL_CONFIG.wraith.scale;
  assert.ok(goblinVisualHeight < ghoulVisualHeight && ghoulVisualHeight < bruteVisualHeight,
    "Ghoul presentation scale sits between Goblin and Brute model heights");
  assert.ok(ENEMY_VISUAL_CONFIG.ghoul.hpBarOffsetY > ghoulVisualHeight);
  assert.ok(ENEMY_VISUAL_CONFIG.wraith.hpBarOffsetY > wraithVisualHeight);
  assert.deepEqual(createWaveSpawnQueue(getWaveComposition(9)).slice(0, 3), ["goblin", "goblinBrute", "goblinRider"]);
  assert.deepEqual(createWaveSpawnQueue(getWaveComposition(70)).slice(-7), Array(7).fill("giantGoblin"));

  const lateWaveSnapshots = {
    21: { counts: { goblin: 0, goblinBrute: 0, goblinRider: 26, giantGoblin: 0, ghoul: 0, wraith: 0 }, threat: 78 },
    35: { counts: { goblin: 0, goblinBrute: 0, goblinRider: 20, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 4, skeletonKing: 0, skeletalCommander: 1 }, threat: 98 },
    42: { counts: { goblin: 0, goblinBrute: 0, goblinRider: 30, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 4, skeletonKing: 0, skeletalCommander: 2 }, threat: 142 },
    49: { counts: { goblin: 0, goblinBrute: 0, goblinRider: 36, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 5, skeletonKing: 0, skeletalCommander: 3 }, threat: 180 },
    50: { counts: { goblin: 0, goblinBrute: 0, goblinRider: 0, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 0, skeletonKing: 1, skeletalCommander: 0 }, threat: 0 },
    70: { counts: { goblin: 0, goblinBrute: 0, goblinRider: 54, giantGoblin: 7, ghoul: 0, wraith: 0, undeadDragon: 6, skeletonKing: 0, skeletalCommander: 4 }, threat: 380 },
    80: { counts: { goblin: 33, goblinBrute: 16, goblinRider: 11, giantGoblin: 8, ghoul: 19, wraith: 6 }, threat: 373 },
    100: { counts: { goblin: 42, goblinBrute: 21, goblinRider: 14, giantGoblin: 10, ghoul: 24, wraith: 7 }, threat: 469 },
    116: { counts: { goblin: 30, goblinBrute: 27, goblinRider: 20, giantGoblin: 0, ghoul: 29, wraith: 9 }, threat: 348 },
    120: { counts: { goblin: 31, goblinBrute: 28, goblinRider: 20, giantGoblin: 12, ghoul: 30, wraith: 9 }, threat: 572 },
    140: { counts: { goblin: 0, goblinBrute: 0, goblinRider: 114, giantGoblin: 14, ghoul: 0, wraith: 0, undeadDragon: 11, skeletonKing: 0, skeletalCommander: 9 }, threat: 786 },
    200: { counts: { goblin: 53, goblinBrute: 48, goblinRider: 35, giantGoblin: 20, ghoul: 51, wraith: 15 }, threat: 968 },
  };
  for (const [waveText, snapshot] of Object.entries(lateWaveSnapshots)) {
    const wave = Number(waveText);
    const composition = getWaveComposition(wave);
    const counts = countWaveComposition(composition);
    assert.deepEqual(Object.fromEntries(Object.keys(snapshot.counts).map((type) => [type, counts[type]])), snapshot.counts,
      `deterministic composition for wave ${wave}`);
    assert.equal(composition.totalThreat, snapshot.threat, `weighted threat for wave ${wave}`);
    if (wave % 7 === 0) {
      assert.equal(snapshot.counts.ghoul + snapshot.counts.wraith, 0, `flying-focused wave ${wave} excludes new ground enemies`);
    }
    assert.ok(composition.spawnInterval >= 0.29, `wave ${wave} respects the safe spawn floor`);
  }
  assert.ok(Math.abs(getWaveThreatBudget(116) - 342.2) < 1e-9);
  assert.equal(getWaveComposition(116).totalThreat >= 340, true, "wave 116 should meet the late-game threat target");
  assert.equal(getWaveComposition(116).threatBudget, getWaveThreatBudget(116));
  assert.equal(getWaveComposition(70).threatBudget, undefined, "7/10 collision uses pure flying plus Giants, without a normal mix");
  assert.equal(getWaveComposition(120).threatBudget, 355, "Giant event escorts use a full threat budget before Giants are added");
  assert.equal(getWaveComposition(21).entries.some(({ type }) => type === "goblin" || type === "goblinBrute"), false);
  assert.deepEqual([7, 14, 21, 28, 35, 42].map((wave) => countWaveComposition(getWaveComposition(wave)).goblinRider), [12, 18, 26, 34, 20, 30]);
  assert.deepEqual(
    [60, 100, 120, 200].map((wave) => countWaveComposition(getWaveComposition(wave)).giantGoblin),
    [6, 10, 12, 20],
    "every 10th wave retains wave/10 Giants except the dedicated wave-50 boss override",
  );
  const normalBudgetWaves = [22, 49, 80, 101, 116, 200];
  const normalBudgets = normalBudgetWaves.map(getWaveThreatBudget);
  assert.ok(normalBudgets.every((budget, index) => index === 0 || budget > normalBudgets[index - 1]), "normal-wave threat budget grows through late game");
  assert.ok(getWaveComposition(116).totalThreat > getWaveComposition(22).totalThreat * 5, "wave 116 is substantially harder than an early post-20 wave");
  assert.deepEqual(
    [1, 30, 31, 60, 61, 100, 101, 200].map(getWaveRewardMultiplier),
    [1, 1, 0.75, 0.75, 0.5, 0.5, 0.35, 0.35],
  );
  assert.deepEqual([1, 30, 31, 60, 61, 100, 101].map((wave) => getWaveGoldReward(3, wave)), [3, 3, 2, 2, 2, 2, 1]);
  assert.deepEqual([1, 30, 60, 100, 150, 200].map((wave) => Number(getWaveSpawnInterval(wave).toFixed(2))), [0.7, 0.55, 0.42, 0.34, 0.29, 0.29]);
  assert.ok(getWaveComposition(100).totalThreat > getWaveComposition(20).totalThreat * 3, "late waves do not collapse to early-wave threat");

  const hpTierSnapshots = [
    [1, 0, 1], [10, 0, 1], [11, 1, 2], [20, 1, 2], [21, 2, 4], [30, 2, 4],
    [31, 3, 8], [40, 3, 8], [41, 4, 16], [50, 4, 16], [51, 5, 32], [61, 6, 64],
  ];
  for (const [wave, tier, multiplier] of hpTierSnapshots) {
    assert.equal(getEnemyHpTier(wave), tier, `HP tier boundary at wave ${wave}`);
    assert.equal(getEnemyHpMultiplier(wave), multiplier, `HP multiplier at wave ${wave}`);
  }
  const specialWaveHpChecks = [
    [14, { goblin: 300, goblinBrute: 1100, goblinRider: 320, giantGoblin: 6000, ghoul: 900, wraith: 1400 }],
    [20, { goblin: 300, goblinBrute: 1100, goblinRider: 320, giantGoblin: 6000, ghoul: 900, wraith: 1400 }],
    [21, { goblin: 600, goblinBrute: 2200, goblinRider: 640, giantGoblin: 12000, ghoul: 1800, wraith: 2800 }],
    [30, { goblin: 600, goblinBrute: 2200, goblinRider: 640, giantGoblin: 12000, ghoul: 1800, wraith: 2800 }],
    [35, { goblin: 1200, goblinBrute: 4400, goblinRider: 1280, giantGoblin: 24000, ghoul: 3600, wraith: 5600 }],
    [40, { goblin: 1200, goblinBrute: 4400, goblinRider: 1280, giantGoblin: 24000, ghoul: 3600, wraith: 5600 }],
    [42, { goblin: 2400, goblinBrute: 8800, goblinRider: 2560, giantGoblin: 48000, ghoul: 7200, wraith: 11200 }],
    [70, { goblin: 9600, goblinBrute: 35200, goblinRider: 10240, giantGoblin: 192000, ghoul: 28800, wraith: 44800 }],
  ];
  for (const [wave, expectedHp] of specialWaveHpChecks) {
    assert.deepEqual(Object.fromEntries(keys.map((type) => [type, getEnemyHpForWave(type, wave)])), expectedHp, `special-wave HP scaling at ${wave}`);
  }
  assert.equal(countWaveComposition(getWaveComposition(14)).goblinRider, 18, "wave 14 remains flying-focused");
  assert.equal(countWaveComposition(getWaveComposition(20)).giantGoblin, 2, "wave 20 remains a Giant wave");
  assert.equal(countWaveComposition(getWaveComposition(21)).goblinRider, 26, "wave 21 remains flying-focused");
  assert.deepEqual([countWaveComposition(getWaveComposition(25)).ghoul, countWaveComposition(getWaveComposition(25)).wraith], [6, 3]);
  assert.deepEqual([countWaveComposition(getWaveComposition(28)).ghoul, countWaveComposition(getWaveComposition(28)).wraith], [0, 0]);
  assert.equal(countWaveComposition(getWaveComposition(30)).giantGoblin, 3, "wave 30 remains a Giant wave");
  assert.deepEqual([countWaveComposition(getWaveComposition(35)).goblinRider, countWaveComposition(getWaveComposition(35)).undeadDragon, countWaveComposition(getWaveComposition(35)).skeletalCommander], [20, 4, 1]);
  assert.equal(countWaveComposition(getWaveComposition(40)).giantGoblin, 4, "wave 40 remains a Giant wave");
  assert.deepEqual([countWaveComposition(getWaveComposition(42)).goblinRider, countWaveComposition(getWaveComposition(42)).undeadDragon], [30, 4]);
  assert.deepEqual(
    [countWaveComposition(getWaveComposition(70)).goblinRider, countWaveComposition(getWaveComposition(70)).undeadDragon, countWaveComposition(getWaveComposition(70)).giantGoblin],
    [54, 6, 7],
    "wave 70 keeps the Rider/Giant collision",
  );
  assert.equal(countWaveComposition(getWaveComposition(32)).undeadDragon, 2, "wave 32 introduces two dragons in a normal mixed escort composition");
  assert.deepEqual(countWaveComposition(getWaveComposition(50)), {
    goblin: 0, goblinBrute: 0, goblinRider: 0, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 0, skeletonKing: 1, skeletalCommander: 0,
  }, "wave 50 is only one Skeleton King");
  const wave45Composition = getWaveComposition(45);
  const wave45Counts = countWaveComposition(wave45Composition);
  const wave45EnemyHp = Object.fromEntries(keys.map((type) => [type, getEnemyHpForWave(type, 45)]));
  const wave45TotalHp = keys.reduce((total, type) => total + wave45Counts[type] * wave45EnemyHp[type], 0);
  assert.deepEqual(keys.map((type) => wave45Counts[type]), [25, 8, 5, 0, 10, 2], "wave 45 includes new enemies in deterministic threat mix");
  assert.equal(wave45Composition.threatBudget, 115);
  assert.equal(Number(wave45Composition.spawnInterval.toFixed(3)), 0.485);
  assert.equal(wave45TotalHp, 237600);
  originalInfo("Wave 45 HP regression", {
    counts: wave45Counts,
    threatBudget: wave45Composition.threatBudget,
    totalThreat: wave45Composition.totalThreat,
    spawnInterval: wave45Composition.spawnInterval,
    enemyHp: wave45EnemyHp,
    totalWaveHp: wave45TotalHp,
  });
  const typeHpAtTier = {
    11: [300, 1100, 320, 6000, 900, 1400],
    21: [600, 2200, 640, 12000, 1800, 2800],
    31: [1200, 4400, 1280, 24000, 3600, 5600],
    41: [2400, 8800, 2560, 48000, 7200, 11200],
    51: [4800, 17600, 5120, 96000, 14400, 22400],
  };
  for (const [waveText, expectedHp] of Object.entries(typeHpAtTier)) {
    const wave = Number(waveText);
    assert.deepEqual(keys.map((type) => getEnemyHpForWave(type, wave)), expectedHp, `scaled enemy HP at wave ${wave}`);
  }
  assert.deepEqual(keys.map((type) => getEnemyHpForWave(type, 48)), [2400, 8800, 2560, 48000, 7200, 11200]);
  assert.deepEqual(countWaveComposition(getWaveComposition(48)), { goblin: 27, goblinBrute: 9, goblinRider: 5, giantGoblin: 0, ghoul: 10, wraith: 2, undeadDragon: 0, skeletonKing: 0, skeletalCommander: 0 });
  assert.equal(getWaveComposition(48).totalThreat, 122);
  assert.equal(Number(getWaveComposition(48).spawnInterval.toFixed(3)), 0.472);

  const expectedTierWarnings = [[10, 11, 2], [20, 21, 4], [30, 31, 8], [40, 41, 16], [50, 51, 32], [60, 61, 64]];
  for (const [wave, nextWave, nextMultiplier] of expectedTierWarnings) {
    const warningState = new GameState();
    warningState.currentWave = wave;
    warningState.wavesStarted = wave;
    warningState.waveActive = true;
    warningState.autoRun = true;
    warningState.toSpawn = 0;
    warningState.update(0.01, 0.01);
    assert.equal(warningState.waveActive, false, `Auto Run waits after completed wave ${wave}`);
    assert.deepEqual(warningState.hpTierWarning, {
      completedWave: wave,
      nextWave,
      nextMultiplier,
    });
    assert.equal(warningState.startWave(), false, "manual start cannot bypass the readable tier warning");
    warningState.update(2.95, 2.95);
    assert.equal(warningState.waveActive, false, "warning remains visible for its hold period");
    warningState.update(0.1, 0.1);
    assert.equal(warningState.hpTierWarning, undefined);
    assert.equal(warningState.waveActive, true, "Auto Run resumes after the warning");
    assert.equal(warningState.currentWave, wave + 1);
  }
  const manualWarningState = new GameState();
  manualWarningState.currentWave = 10;
  manualWarningState.wavesStarted = 10;
  manualWarningState.waveActive = true;
  manualWarningState.toSpawn = 0;
  manualWarningState.update(0.01, 0.01);
  assert.ok(manualWarningState.hpTierWarning, "manual mode also receives the warning");
  manualWarningState.update(3.1, 3.1);
  assert.equal(manualWarningState.waveActive, false, "manual mode does not auto-start after warning");
  assert.equal(manualWarningState.startWave(), true, "manual start is available after the warning");

  const routes = [{ x: 0, y: 0 }, { x: 2, y: 0 }];
  const goblin = createEnemy(1, "goblin", routes);
  const brute = createEnemy(2, "goblinBrute", routes);
  const rider = createEnemy(3, "goblinRider", routes);
  const giant = createEnemy(4, "giantGoblin", routes);
  const ghoul = createEnemy(5, "ghoul", routes);
  const wraith = createEnemy(6, "wraith", routes);
  assert.deepEqual([goblin.maxHp, brute.maxHp, rider.maxHp, giant.maxHp], [150, 550, 160, 3000]);
  assert.deepEqual([ghoul.maxHp, wraith.maxHp], [450, 700]);
  assert.deepEqual([goblin.reward, brute.reward, rider.reward, giant.reward], [1, 3, 2, 10]);
  assert.deepEqual([ghoul.reward, wraith.reward], [3, 5]);
  assert.deepEqual([goblin.livesDamage, brute.livesDamage, rider.livesDamage, giant.livesDamage], [1, 1, 1, 3]);
  assert.deepEqual([ghoul.livesDamage, wraith.livesDamage], [1, 1]);
  assert.deepEqual([goblin.speed, brute.speed, rider.speed, giant.speed].map((speed) => Number((speed * WORLD_UNITS_PER_CELL / 90).toFixed(2))), [1.05, 0.72, 1.2, 0.42]);
  assert.deepEqual([ghoul.movementType, wraith.movementType], ["ground", "ground"]);
  const normalizedSpeeds = [wraith, rider, goblin, ghoul, brute, giant]
    .map((enemy) => Number((enemy.speed * WORLD_UNITS_PER_CELL / 90).toFixed(2)));
  assert.deepEqual(normalizedSpeeds, [1.6, 1.2, 1.05, 0.95, 0.72, 0.42], "Wraith is fastest and the full movement order remains distinct");
  assert.ok(getEnemyHpForWave("goblin", 25) < getEnemyHpForWave("ghoul", 25));
  assert.ok(getEnemyHpForWave("ghoul", 25) < getEnemyHpForWave("goblinBrute", 25));
  assert.ok(getEnemyHpForWave("goblinBrute", 25) < getEnemyHpForWave("wraith", 25));
  assert.ok(getEnemyHpForWave("wraith", 25) < getEnemyHpForWave("giantGoblin", 25));
  assert.deepEqual([getEnemyHpForWave("ghoul", 25), getEnemyHpForWave("wraith", 25)], [1800, 2800]);
  assert.deepEqual([getEnemyHpForWave("ghoul", 35), getEnemyHpForWave("wraith", 35)], [3600, 5600]);
  assert.deepEqual([getEnemyHpForWave("ghoul", 45), getEnemyHpForWave("wraith", 45)], [7200, 11200]);
  assert.deepEqual(
    [rider.maxHp, Number((rider.speed * WORLD_UNITS_PER_CELL / 90).toFixed(2)), rider.reward, rider.livesDamage, rider.movementType],
    [160, 1.2, 2, 1, "flying"],
    "Rider balance and flying behavior remain unchanged",
  );
  assert.deepEqual(
    keys.map((type) => getEnemyHpForWave(type, 101)),
    [153600, 563200, 163840, 3072000, 460800, 716800],
    "all archetypes, including Riders, scale HP with deterministic rounding",
  );
  const scaledRider = createEnemy(5, "goblinRider", routes, 42);
  assert.deepEqual([scaledRider.hp, scaledRider.maxHp, scaledRider.reward, scaledRider.livesDamage, scaledRider.speed, scaledRider.movementType], [2560, 2560, 2, 1, rider.speed, "flying"]);

  let waveDebug;
  console.info = (label, details) => { if (label === "Wave composition") waveDebug = details; };
  const scaledGameState = new GameState();
  scaledGameState.wavesStarted = 40;
  assert.equal(scaledGameState.startWave(), true);
  scaledGameState.update(0);
  console.info = () => {};
  assert.equal(scaledGameState.currentWave, 41);
  assert.equal(waveDebug.hpTier, 4);
  assert.equal(waveDebug.hpMultiplier, 16);
  for (const type of keys) {
    assert.equal(waveDebug.enemyHp[type], getEnemyHpForWave(type, 41), `wave debug reports ${type} HP`);
  }
  const wave41Counts = countWaveComposition(getWaveComposition(41));
  assert.deepEqual([waveDebug.ghoul, waveDebug.wraith], [wave41Counts.ghoul, wave41Counts.wraith], "wave debug reports both new enemy counts");
  assert.equal(waveDebug.totalWaveHp, keys.reduce((total, type) => total + wave41Counts[type] * waveDebug.enemyHp[type], 0));
  assert.ok(scaledGameState.enemies.length > 0);
  for (const enemy of scaledGameState.enemies) {
    assert.equal(enemy.maxHp, getEnemyHpForWave(enemy.type, 41), "GameState passes the active wave into enemy creation");
    assert.equal(enemy.hp / enemy.maxHp, 1, "new scaled enemies begin at full health-bar ratio");
  }

  const cappedState = new GameState();
  cappedState.waveActive = true;
  cappedState.spawnQueue = Array(100).fill("goblinRider");
  cappedState.toSpawn = 100;
  cappedState.waveSpawnInterval = 0.3;
  for (let tick = 0; tick < 40 && cappedState.enemies.length < MAX_ACTIVE_WAVE_ENEMIES; tick += 1) {
    cappedState.update(tick === 0 ? 0 : 0.3);
    for (const enemy of cappedState.enemies) enemy.speed = 0;
  }
  assert.equal(cappedState.enemies.length, MAX_ACTIVE_WAVE_ENEMIES, "queued flying units fill, but never exceed, the active model cap");
  assert.equal(cappedState.toSpawn, 100 - MAX_ACTIVE_WAVE_ENEMIES, "the cap staggers units rather than deleting wave enemies");

  // Damage regression: a level-1 Knight defeats these targets using its configured 55 damage.
  for (const [type, hp, expectedKnightHits] of [["goblin", 150, 3], ["goblinBrute", 550, 10], ["giantGoblin", 3000, 55]]) {
    const combat = new GameState();
    const target = createEnemy(400 + expectedKnightHits, type, [{ x: 5, y: 5 }, { x: 6, y: 5 }]);
    target.x = 5;
    target.y = 5;
    target.speed = 0; // Hold it inside this isolated melee-range combat check.
    const defender = createBasicTower(500 + expectedKnightHits, { x: 5, y: 4 }, "holy-knight");
    combat.waveActive = true;
    combat.toSpawn = 1;
    combat.enemies = [target];
    combat.towers = [defender];
    for (let tick = 0; combat.enemies.length > 0 && tick < 400; tick += 1) combat.update(0.25);
    assert.equal(combat.enemies.length, 0, `${type} should eventually be defeated by the existing Knight`);
    assert.equal(defender.combatStats.kills, 1);
    assert.equal(defender.combatStats.damageDone, hp);
    assert.equal(Math.ceil(hp / defender.damage), expectedKnightHits, `${type} requires more Knight hits after the HP pass`);
  }

  const wizard = createBasicTower(1, { x: 1, y: 0 }, "blue-wizard");
  const knight = createBasicTower(2, { x: 1, y: 0 }, "holy-knight");
  assert.deepEqual([wizard.damage, wizard.range, wizard.fireRate], [25, 110, 1]);
  assert.deepEqual([knight.damage, knight.range, knight.fireRate], [55, 1, 0.9]);
  assert.deepEqual(DEFENDER_CONFIG["holy-knight"].levels.map(({ damage, range, fireRate }) => [damage, range, fireRate]), [
    [55, 1, 0.9],
    [140, 1, 1.05],
    [320, 1, 1.15],
  ]);
  assert.deepEqual(DEFENDER_CONFIG["holy-knight"].targetTypes, ["ground"]);
  assert.deepEqual(DEFENDER_CONFIG["blue-wizard"].levels.map(({ damage, fireRate }) => [damage, fireRate]), [
    [25, 1],
    [65, 1.15],
    [150, 1.25],
  ]);

  const sellCases = [
    { level: 1, invested: 10, refund: 7 },
    { level: 2, invested: 30, refund: 21 },
    { level: 3, invested: 75, refund: 52 },
  ];
  for (const type of ["blue-wizard", "holy-knight"]) {
    for (const sellCase of sellCases) {
      const sellState = new GameState();
      sellState.gold = 1000;
      let buildCell;
      for (let y = 1; y < sellState.grid.height && !buildCell; y += 1) {
        for (let x = 1; x < sellState.grid.width && !buildCell; x += 1) {
          const candidate = { x, y };
          if (sellState.canPlaceBasicTower(candidate, type) === "placed") buildCell = candidate;
        }
      }
      assert.ok(buildCell, `should find a build cell for ${type}`);
      assert.equal(sellState.placeBasicTower(buildCell, type), "placed");
      for (let level = 1; level < sellCase.level; level += 1) {
        assert.equal(sellState.upgradeBasicTower(sellState.towers[0].id), "upgraded");
      }
      const tower = sellState.towers[0];
      tower.combatStats.kills = 8;
      tower.combatStats.damageDone = 900;
      assert.equal(getTotalTowerInvestment(tower.level, tower.type), sellCase.invested);
      assert.equal(getTowerSellRefund(tower), sellCase.refund);
      const goldBeforeSale = sellState.gold;
      const sold = sellState.sellTower(tower.id);
      assert.deepEqual(sold, { refund: sellCase.refund });
      assert.equal(sellState.gold, goldBeforeSale + sellCase.refund);
      assert.equal(sellState.towers.length, 0, "sold tower is removed from GameState");
      assert.equal(sellState.grid.isBuildable(buildCell), true, "sold tower frees its grid cell");
      assert.equal(sellState.towerAt(buildCell), undefined, "sold tower no longer occupies the cell");
      assert.equal(sellState.placeBasicTower(buildCell, type), "placed", "the same cell can be rebuilt");
      assert.deepEqual(sellState.towers[0].combatStats, { kills: 0, damageDone: 0 }, "combat telemetry is not transferred after sale");
    }
  }
  const activeSellState = new GameState();
  activeSellState.gold = 1000;
  const activeSellCell = { x: 5, y: 5 };
  assert.equal(activeSellState.placeBasicTower(activeSellCell, "blue-wizard"), "placed");
  const activeSellTower = activeSellState.towers[0];
  activeSellState.waveActive = true;
  activeSellState.wavePath = [...activeSellState.path];
  const activeSellRoute = activeSellState.path;
  const activeSellEnemy = createEnemy(900, "goblin", activeSellRoute);
  activeSellState.enemies = [activeSellEnemy];
  const activeSale = activeSellState.sellTower(activeSellTower.id);
  assert.deepEqual(activeSale, { refund: 7 });
  assert.deepEqual(activeSellState.wavePath, activeSellState.path, "selling during a wave updates the active route snapshot");
  assert.deepEqual(activeSellEnemy.path[0], { x: Math.round(activeSellEnemy.x), y: Math.round(activeSellEnemy.y) }, "active enemies are repathed from their current cell after a sale");
  assert.deepEqual(activeSellEnemy.path.at(-1), activeSellState.exit, "repathed enemies still reach the castle");
  const targetingTypes = ["goblin", "goblinBrute", "ghoul", "wraith", "giantGoblin", "goblinRider"];
  for (const type of targetingTypes) {
    const target = createEnemy(950 + type.length, type, [{ x: 5, y: 5 }, { x: 6, y: 5 }]);
    assert.equal(canTowerTargetEnemy(wizard, target), true, `Wizard can target ${type}`);
    assert.equal(canTowerTargetEnemy(knight, target), type !== "goblinRider", `Knight ground-only targeting for ${type}`);
  }
  for (const type of ["ghoul", "wraith"]) {
    const groundTarget = createEnemy(1000 + type.length, type, [{ x: 5, y: 5 }, { x: 6, y: 5 }], 25);
    assert.equal(canTowerTargetEnemy(wizard, groundTarget), true, `Wizard can target ${type}`);
    assert.equal(canTowerTargetEnemy(knight, groundTarget), true, `Knight can target ${type}`);
    for (const defenderType of ["blue-wizard", "holy-knight"]) {
      const combat = new GameState();
      const target = createEnemy(1100 + type.length, type, [{ x: 5, y: 5 }, { x: 6, y: 5 }], 25);
      target.x = 5;
      target.y = 5;
      target.speed = 0;
      combat.waveActive = true;
      combat.toSpawn = 1;
      combat.enemies = [target];
      combat.towers = [createBasicTower(1200 + type.length, { x: 5, y: 4 }, defenderType)];
      combat.update(0.001);
      assert.equal(combat.attackEvents.length, 1, `${defenderType} attacks ${type}`);
      assert.equal(combat.attackEvents[0].targetEnemyId, target.id);
    }
  }

  // A real seventh wave creates direct rider routes, and maze placements do not repath them.
  const state = new GameState();
  state.wavesStarted = 6;
  assert.equal(state.startWave(), true);
  state.update(0);
  assert.ok(state.enemies.length > 0);
  assert.ok(state.enemies.every((enemy) => enemy.type === "goblinRider" && enemy.movementType === "flying" && enemy.maxHp === 160 && enemy.path.length === 2));
  const savedRoutes = new Map(state.enemies.map((enemy) => [enemy.id, JSON.stringify(enemy.path)]));
  let placed = false;
  for (let y = 0; y < state.grid.height && !placed; y += 1) {
    for (let x = 0; x < state.grid.width && !placed; x += 1) {
      if (state.canPlaceBasicTower({ x, y }) === "placed") placed = state.placeBasicTower({ x, y }) === "placed";
    }
  }
  assert.equal(placed, true, "should find a valid build cell during the flying wave");
  for (const enemy of state.enemies) assert.equal(JSON.stringify(enemy.path), savedRoutes.get(enemy.id), "rider route stays direct through maze edits");

  for (const type of ["ghoul", "wraith"]) {
    const groundState = new GameState();
    const groundSpawn = groundState.layout.activeSpawns[0];
    const groundRoute = groundState.spawnPaths.get(groundSpawn.id);
    assert.ok(groundRoute && groundRoute.length > 3, `${type} gets a normal ground route`);
    const groundEnemy = createEnemy(1300 + type.length, type, groundRoute);
    groundState.waveActive = true;
    groundState.toSpawn = 1;
    groundState.enemies = [groundEnemy];
    groundState.update(0.05);
    assert.equal(groundEnemy.path.length, groundRoute.length, `${type} follows its maze route`);
    let blockingCell;
    for (const cell of groundRoute.slice(2, -1)) {
      if (groundState.canPlaceBasicTower(cell) !== "placed") continue;
      if (groundState.placeBasicTower(cell) === "placed") {
        blockingCell = cell;
        break;
      }
    }
    assert.ok(blockingCell, `a safe route-blocking tower can be placed for ${type}`);
    assert.deepEqual(groundEnemy.path.at(-1), groundState.exit, `${type} repath still reaches the exit`);
    assert.equal(groundEnemy.path.some((cell) => cell.x === blockingCell.x && cell.y === blockingCell.y), false,
      `${type} repaths around the blocked cell`);
  }

  const combatState = new GameState();
  const target = createEnemy(99, "goblinRider", [{ x: 5, y: 5 }, { x: 6, y: 5 }]);
  target.x = 5; target.y = 5;
  combatState.waveActive = true;
  combatState.toSpawn = 1;
  combatState.enemies = [target];
  combatState.towers = [createBasicTower(100, { x: 5, y: 4 }, "blue-wizard")];
  combatState.update(0.001);
  assert.equal(combatState.attackEvents.length, 1, "Wizard can damage a Rider");
  const knightState = new GameState();
  const knightTarget = createEnemy(101, "goblinRider", [{ x: 5, y: 5 }, { x: 6, y: 5 }]);
  knightTarget.x = 5; knightTarget.y = 5;
  knightState.waveActive = true;
  knightState.toSpawn = 1;
  knightState.enemies = [knightTarget];
  knightState.towers = [createBasicTower(101, { x: 5, y: 4 }, "holy-knight")];
  knightState.update(0.001);
  assert.equal(knightState.attackEvents.length, 0, "Holy Knight cannot damage a Rider");

  const rewardState = new GameState();
  const rewardedBrute = createEnemy(150, "goblinBrute", [{ x: 5, y: 5 }, { x: 6, y: 5 }]);
  rewardedBrute.hp = 1;
  rewardState.waveActive = true;
  rewardState.toSpawn = 1;
  rewardState.enemies = [rewardedBrute];
  const rewardStartingGold = rewardState.gold;
  const rewardTower = createBasicTower(150, { x: 5, y: 4 }, "blue-wizard");
  rewardTower.damage = 10;
  rewardState.towers = [rewardTower];
  rewardState.update(0.001);
  assert.equal(rewardState.gold, rewardStartingGold + 3, "Brute kill pays its configured reward");

  for (const [wave, expectedPayout] of [[31, 2], [61, 2], [101, 1]]) {
    const compressedRewardState = new GameState();
    compressedRewardState.currentWave = wave;
    compressedRewardState.waveActive = true;
    compressedRewardState.toSpawn = 1;
    const enemy = createEnemy(600 + wave, "goblinBrute", [{ x: 5, y: 5 }, { x: 6, y: 5 }]);
    enemy.hp = 1;
    enemy.x = 5;
    enemy.y = 5;
    compressedRewardState.enemies = [enemy];
    const payoutTower = createBasicTower(700 + wave, { x: 5, y: 4 }, "blue-wizard");
    payoutTower.damage = 10;
    compressedRewardState.towers = [payoutTower];
    const startingGold = compressedRewardState.gold;
    compressedRewardState.update(0.001);
    assert.equal(compressedRewardState.gold, startingGold + expectedPayout, `Brute reward is compressed correctly on wave ${wave}`);
  }

  const leakState = new GameState();
  const leakingGiant = createEnemy(200, "giantGoblin", [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  leakingGiant.speed = 2;
  leakState.waveActive = true;
  leakState.enemies = [leakingGiant];
  leakState.update(1);
  assert.equal(leakState.lives, 7, "one Giant leak removes three lives");

  originalLog("Enemy/wave tests passed: fixed waves, late threat snapshots, flying/Giant stacking, reward compression, active cap, archetype stats, repathing, targeting, and leaks.");
} finally {
  console.log = originalLog;
  console.info = originalInfo;
}
