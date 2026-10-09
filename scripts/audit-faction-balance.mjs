import { GameState } from "../src/game/GameState.ts";
import { WORLD_UNITS_PER_CELL } from "../src/core/GameConstants.ts";
import { DEFENDER_CONFIG, getDefenderTotalInvestment } from "../src/game/config/DefenderConfig.ts";
import { VETERAN_TIERS } from "../src/game/config/FactionBonusConfig.ts";
import { getWaveComposition } from "../src/game/config/WaveConfig.ts";
import { canTowerTargetEnemy, createBasicTower, getTowerAttackProfile, getTowerSplashRatioForTarget, upgradeTower } from "../src/game/towers/Tower.ts";
import { createEnemy } from "../src/game/enemies/Enemy.ts";
import { MAPS } from "../src/game/config/MapConfig.ts";

const FIXED_SEED = 0x5eed1234;
const STEP_SECONDS = 0.05;
const MAX_SECONDS = 240;
const MAP_IDS = ["single-spawn", "two-spawns", "three-spawns"];
const SINGLE_SPAWN_AIR_CELLS = [
  { x: 6, y: 15 }, { x: 10, y: 15 }, { x: 6, y: 9 }, { x: 10, y: 21 },
  { x: 10, y: 9 }, { x: 6, y: 21 }, { x: 6, y: 5 }, { x: 10, y: 25 },
  { x: 10, y: 5 }, { x: 6, y: 25 }, { x: 6, y: 12 }, { x: 10, y: 18 },
  { x: 10, y: 12 }, { x: 6, y: 18 }, { x: 6, y: 27 }, { x: 10, y: 27 },
];
// Seven alternating partial walls: the same realistic maze footprint is used by both factions.
const REFERENCE_CELLS = [
  { x: 5, y: 4 }, { x: 6, y: 4 }, { x: 7, y: 4 }, { x: 8, y: 4 }, { x: 9, y: 4 },
  { x: 7, y: 8 }, { x: 8, y: 8 }, { x: 9, y: 8 }, { x: 10, y: 8 }, { x: 11, y: 8 },
  { x: 5, y: 12 }, { x: 6, y: 12 }, { x: 7, y: 12 }, { x: 8, y: 12 }, { x: 9, y: 12 },
  { x: 7, y: 16 }, { x: 8, y: 16 }, { x: 9, y: 16 }, { x: 10, y: 16 }, { x: 11, y: 16 },
  { x: 5, y: 20 }, { x: 6, y: 20 }, { x: 7, y: 20 }, { x: 8, y: 20 }, { x: 9, y: 20 },
  { x: 7, y: 24 }, { x: 8, y: 24 }, { x: 9, y: 24 }, { x: 10, y: 24 }, { x: 11, y: 24 },
  { x: 5, y: 28 }, { x: 6, y: 28 }, { x: 7, y: 28 }, { x: 8, y: 28 }, { x: 9, y: 28 },
];
const WALL_EDGE_KEYS = ["9,4", "7,8", "9,12", "7,16", "9,20", "7,24", "9,28"];

const originalLog = console.log;
const originalInfo = console.info;

function prepareAffixes(state, wave) {
  for (const milestone of [15, 30, 45]) {
    if (milestone < wave) state.affixSystem.rollMilestone(milestone);
  }
}

function createTower(id, cell, definition) {
  const tower = createBasicTower(id, cell, definition.type);
  if (definition.level >= 2) upgradeTower(tower);
  if (definition.level >= 3) upgradeTower(tower, definition.specializationId);
  return tower;
}

function distanceSquared(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function buildableCells(state) {
  const cells = [];
  for (let y = 1; y < state.map.height - 1; y += 1) {
    for (let x = 1; x < state.map.width - 1; x += 1) {
      const cell = { x, y };
      if (state.grid.isBuildable(cell)) cells.push(cell);
    }
  }
  return cells;
}

function flightSamples(state) {
  return state.layout.activeSpawns.flatMap((spawn) => Array.from({ length: 17 }, (_, index) => {
    const progress = index / 16;
    return {
      laneId: spawn.id,
      x: spawn.entryCell.x + (state.layout.castle.approachCell.x - spawn.entryCell.x) * progress,
      y: spawn.entryCell.y + (state.layout.castle.approachCell.y - spawn.entryCell.y) * progress,
    };
  }));
}

function selectAirCells(mapId, count = mapId === "single-spawn" ? 16 : 24) {
  if (mapId === "single-spawn") return SINGLE_SPAWN_AIR_CELLS.slice(0, count);
  const state = new GameState(mapId, "arcane-kingdom", FIXED_SEED);
  const samples = flightSamples(state);
  const candidates = buildableCells(state);
  const selected = [];
  const covered = new Set();
  while (selected.length < count) {
    let best;
    for (const cell of candidates) {
      if (selected.some((chosen) => chosen.x === cell.x && chosen.y === cell.y)) continue;
      // Use the shorter Royal AA range so selected cells are neutral and useful to both factions.
      const inRange = samples.filter((sample) => distanceSquared(cell, sample) <= 5 ** 2);
      const newCoverage = inRange.filter((sample) => !covered.has(`${sample.laneId}:${sample.x}:${sample.y}`)).length;
      const lanes = new Set(inRange.map((sample) => sample.laneId)).size;
      const separation = selected.length ? Math.min(...selected.map((chosen) => distanceSquared(cell, chosen))) : 100;
      const score = newCoverage * 100 + lanes * 12 + Math.min(separation, 16) - cell.y * 0.001 - cell.x * 0.0001;
      if (!best || score > best.score) best = { cell, inRange, score };
    }
    if (!best) break;
    selected.push(best.cell);
    best.inRange.forEach((sample) => covered.add(`${sample.laneId}:${sample.x}:${sample.y}`));
  }
  return selected;
}

const AIR_CELLS_BY_MAP = Object.fromEntries(MAP_IDS.map((mapId) => [mapId, selectAirCells(mapId)]));

function runIsolatedWave(mapId, factionId, wave, definitions) {
  const state = new GameState(mapId, factionId, FIXED_SEED);
  prepareAffixes(state, wave);
  const cells = AIR_CELLS_BY_MAP[mapId];
  const placementOrder = [...definitions].sort((a, b) => getDefenderTotalInvestment(b.level, b.type) - getDefenderTotalInvestment(a.level, a.type));
  state.towers = placementOrder.map((definition, index) => createTower(index + 1, cells[index], definition));
  state.refreshLivingMazeInfluence();
  state.gold = 0;
  state.wavesStarted = wave - 1;
  if (!state.startWave()) throw new Error(`Could not start wave ${wave}`);
  let seconds = 0;
  while (state.waveActive && !state.gameOver && seconds < MAX_SECONDS) {
    state.update(STEP_SECONDS);
    seconds += STEP_SECONDS;
  }
  return {
    cleared: !state.waveActive && !state.gameOver,
    flawless: !state.waveActive && !state.gameOver && state.lives === 10,
    seconds: Number(seconds.toFixed(2)),
    lives: state.lives,
    leakedEnemies: state.enemiesLeaked,
    kills: state.enemiesKilled,
    damage: Math.round(state.towers.reduce((sum, tower) => sum + tower.combatStats.damageDone, 0)),
  };
}

function referenceCandidates(state) {
  const routeCells = [...state.spawnPaths.entries()].flatMap(([laneId, route]) => route.map((cell) => ({ ...cell, laneId })));
  return buildableCells(state).map((cell) => {
    const nearest = routeCells.reduce((best, routeCell) => {
      const distance = Math.abs(cell.x - routeCell.x) + Math.abs(cell.y - routeCell.y);
      return distance < best.distance ? { distance, laneId: routeCell.laneId } : best;
    }, { distance: Infinity, laneId: "" });
    return { cell, ...nearest };
  }).sort((a, b) => a.distance - b.distance || a.cell.y - b.cell.y || a.cell.x - b.cell.x);
}

function buildConfiguredState(mapId, factionId, definitions) {
  const state = new GameState(mapId, factionId, FIXED_SEED);
  state.gold = 1_000_000;
  let singleSpawnCells;
  if (mapId === "single-spawn") {
    if (definitions.length > REFERENCE_CELLS.length) throw new Error("Reference build exceeds the 35-cell audit footprint");
    const occupied = REFERENCE_CELLS.slice(0, definitions.length);
    singleSpawnCells = Array(definitions.length);
    const unassigned = new Set(occupied.map((cell) => `${cell.x},${cell.y}`));
    const takeCell = (preferredKeys = []) => {
      const key = preferredKeys.find((candidate) => unassigned.has(candidate)) ?? unassigned.values().next().value;
      if (!key) throw new Error("No unassigned reference-build cell");
      unassigned.delete(key);
      const [x, y] = key.split(",").map(Number);
      return { x, y };
    };
    definitions.forEach((definition, index) => {
      if (DEFENDER_CONFIG[definition.type].rangeMode === "adjacent8") singleSpawnCells[index] = takeCell(WALL_EDGE_KEYS);
    });
    definitions.forEach((_definition, index) => { if (!singleSpawnCells[index]) singleSpawnCells[index] = takeCell(); });
  }
  const placements = [];
  for (const [index, definition] of definitions.entries()) {
    const candidates = mapId === "single-spawn"
      ? REFERENCE_CELLS.map((cell) => ({ cell }))
      : referenceCandidates(state);
    const targetLane = state.layout.activeSpawns[index % state.layout.activeSpawns.length].id;
    const orderedCandidates = mapId === "single-spawn"
      ? candidates
      : [...candidates].sort((a, b) => Number(b.laneId === targetLane) - Number(a.laneId === targetLane)
        || a.distance - b.distance || a.cell.y - b.cell.y || a.cell.x - b.cell.x);
    const cell = singleSpawnCells?.[index]
      ?? orderedCandidates.find(({ cell: candidate }) => state.canPlaceBasicTower(candidate, definition.type) === "placed")?.cell;
    if (!cell) throw new Error(`No ${mapId} reference-build cell for ${definition.type}`);
    if (state.placeBasicTower(cell, definition.type) !== "placed") throw new Error(`Failed to place ${definition.type}`);
    const tower = state.towers.at(-1);
    if (definition.level >= 2 && state.upgradeBasicTower(tower.id) !== "upgraded") throw new Error(`Failed L2 ${definition.type}`);
    if (definition.level >= 3 && state.upgradeBasicTower(tower.id, definition.specializationId) !== "upgraded") throw new Error(`Failed L3 ${definition.type}`);
    placements.push({ type: definition.type, level: definition.level, specializationId: definition.specializationId ?? null, cell });
  }
  const pathLengths = [...state.spawnPaths.values()].map((path) => path.length);
  return { state, placements, pathLength: state.path.length, pathLengths };
}

function runReferenceWave(mapId, factionId, wave, definitions) {
  const built = buildConfiguredState(mapId, factionId, definitions);
  const state = built.state;
  prepareAffixes(state, wave);
  state.gold = 0;
  state.wavesStarted = wave - 1;
  if (!state.startWave()) throw new Error(`Could not start reference wave ${wave}`);
  let seconds = 0;
  while (state.waveActive && !state.gameOver && seconds < MAX_SECONDS) {
    state.update(STEP_SECONDS);
    seconds += STEP_SECONDS;
  }
  return summarizeReference(state, definitions, built, seconds);
}

function summarizeReference(state, definitions, built, seconds) {
  const totalGold = definitions.reduce((sum, definition) => sum + getDefenderTotalInvestment(definition.level, definition.type), 0);
  const airOnlyGold = definitions.filter(({ type }) => DEFENDER_CONFIG[type].targetTypes.length === 1 && DEFENDER_CONFIG[type].targetTypes[0] === "air")
    .reduce((sum, definition) => sum + getDefenderTotalInvestment(definition.level, definition.type), 0);
  const groundOnlyGold = definitions.filter(({ type }) => DEFENDER_CONFIG[type].targetTypes.length === 1 && DEFENDER_CONFIG[type].targetTypes[0] === "ground")
    .reduce((sum, definition) => sum + getDefenderTotalInvestment(definition.level, definition.type), 0);
  return {
    cleared: !state.waveActive && !state.gameOver,
    seconds: Number(seconds.toFixed(2)), lives: state.lives, leakedEnemies: state.enemiesLeaked, kills: state.enemiesKilled,
    totalGold, slots: definitions.length, airOnlyGold, groundOnlyGold, pathLength: built.pathLength, pathLengths: built.pathLengths,
    damage: Math.round(state.towers.reduce((sum, tower) => sum + tower.combatStats.damageDone, 0)),
    build: Object.entries(definitions.reduce((counts, definition) => {
      const label = `${definition.type} L${definition.level}${definition.specializationId ? ` ${definition.specializationId}` : ""}`;
      counts[label] = (counts[label] ?? 0) + 1;
      return counts;
    }, {})).map(([label, count]) => `${count}x ${label}`).join(" + "),
  };
}

const repeat = (count, definition) => Array.from({ length: count }, () => ({ ...definition }));
const scaleBuild = (definitions, multiplier) => [
  ...repeat(Math.floor(multiplier), {}).flatMap(() => definitions.map((definition) => ({ ...definition }))),
  ...definitions.slice(0, Math.round(definitions.length * (multiplier % 1))).map((definition) => ({ ...definition })),
];

function combinations(categories, maxSlots) {
  const output = [];
  const visit = (index, remaining, counts) => {
    if (index === categories.length) {
      if (counts.some(Boolean)) output.push([...counts]);
      return;
    }
    for (let count = 0; count <= remaining; count += 1) {
      counts[index] = count;
      visit(index + 1, remaining - count, counts);
    }
  };
  visit(0, maxSlots, Array(categories.length).fill(0));
  return output.map((counts) => ({
    counts,
    slots: counts.reduce((sum, count) => sum + count, 0),
    gold: counts.reduce((sum, count, index) => sum + count * categories[index].gold, 0),
    definitions: counts.flatMap((count, index) => Array.from({ length: count }, () => categories[index].definition)),
    label: counts.map((count, index) => count ? `${count}x ${categories[index].label}` : "").filter(Boolean).join(" + "),
  })).sort((a, b) => a.gold - b.gold || a.slots - b.slots || a.label.localeCompare(b.label));
}

function findAirThreshold(mapId, factionId, wave, categories) {
  const baseSlotLimit = Math.min(16, AIR_CELLS_BY_MAP[mapId].length);
  let candidates = combinations(categories, baseSlotLimit);
  const cache = new Map();
  const evaluate = (candidate) => {
    const key = `${candidate.counts.length}:${candidate.counts.join(",")}`;
    if (!cache.has(key)) cache.set(key, { ...candidate, ...runIsolatedWave(mapId, factionId, wave, candidate.definitions) });
    return cache.get(key);
  };
  let firstClear;
  let firstFlawless;
  for (const candidate of candidates) {
    if (firstClear && firstFlawless && candidate.gold > firstFlawless.gold) break;
    const record = evaluate(candidate);
    if (!firstClear && record.cleared) firstClear = record;
    if (!firstFlawless && record.flawless) firstFlawless = record;
  }
  if (!firstFlawless && AIR_CELLS_BY_MAP[mapId].length > baseSlotLimit) {
    const lateCategories = categories.filter(({ definition }) => definition.level === 3);
    const overflow = combinations(lateCategories, AIR_CELLS_BY_MAP[mapId].length)
      .filter((candidate) => candidate.slots > baseSlotLimit);
    candidates = [...candidates, ...overflow];
    for (const candidate of overflow) {
      const record = evaluate(candidate);
      if (!firstClear && record.cleared) firstClear = record;
      if (!firstFlawless && record.flawless) firstFlawless = record;
      if (firstFlawless && candidate.gold > firstFlawless.gold) break;
    }
  }
  let slotFlawless;
  for (const candidate of [...candidates].sort((a, b) => a.slots - b.slots || a.gold - b.gold || a.label.localeCompare(b.label))) {
    const record = evaluate(candidate);
    if (record.flawless) {
      slotFlawless = record;
      break;
    }
  }
  return { firstClear, firstFlawless, slotFlawless };
}

function representativeEnemy(type = "goblinRider", wave = 35) {
  return createEnemy(999, type, [{ x: 8, y: 1 }, { x: 8, y: 30 }], wave);
}

function theoreticalAirOutput(definitions, enemyType = "goblinRider", veteranDamage = 0) {
  const enemy = representativeEnemy(enemyType);
  return definitions.reduce((sum, definition, index) => {
    const tower = createTower(index + 1, SINGLE_SPAWN_AIR_CELLS[index], definition);
    tower.combatStats.damageDone = veteranDamage;
    const profile = getTowerAttackProfile(tower, enemy, definition.factionId);
    const volley = definition.specializationId === "elderwing"
      ? 1 + getTowerSplashRatioForTarget(tower, "ranged", 0, 0) + getTowerSplashRatioForTarget(tower, "ranged", 1, 0)
      : 1;
    return sum + profile.damage * profile.fireRate * volley;
  }, 0);
}

const royalAir = [
  { label: "Archer L1", gold: 20, definition: { type: "green-archer", level: 1, factionId: "arcane-kingdom" } },
  { label: "Archer L2", gold: 55, definition: { type: "green-archer", level: 2, factionId: "arcane-kingdom" } },
  { label: "Dragon Slayer", gold: 125, definition: { type: "green-archer", level: 3, specializationId: "dragon-slayer", factionId: "arcane-kingdom" } },
  { label: "Ranger", gold: 125, definition: { type: "green-archer", level: 3, specializationId: "ranger", factionId: "arcane-kingdom" } },
];
const groveAir = [
  { label: "Owl L1", gold: 15, definition: { type: "thorn-owl", level: 1, factionId: "ancient-grove" } },
  { label: "Owl L2", gold: 40, definition: { type: "thorn-owl", level: 2, factionId: "ancient-grove" } },
  { label: "Needlewing", gold: 165, definition: { type: "thorn-owl", level: 3, specializationId: "needlewing-owl", factionId: "ancient-grove" } },
  { label: "Elderwing", gold: 165, definition: { type: "thorn-owl", level: 3, specializationId: "elderwing", factionId: "ancient-grove" } },
];

function summarizeThreshold(threshold, enemyType) {
  if (!threshold) return null;
  const definitions = threshold.definitions;
  return {
    build: threshold.label,
    gold: threshold.gold,
    slots: threshold.slots,
    lives: threshold.lives,
    leakedEnemies: threshold.leakedEnemies,
    seconds: threshold.seconds,
    damage: threshold.damage,
    theoreticalPrimaryDps: Number(theoreticalAirOutput(definitions, enemyType).toFixed(1)),
    veteranIIIPrimaryDps: definitions[0]?.factionId === "arcane-kingdom"
      ? Number(theoreticalAirOutput(definitions, enemyType, VETERAN_TIERS.at(-1).requiredDamage).toFixed(1)) : null,
  };
}

function levelMetrics(type, level, specializationId) {
  const definition = { type, level, specializationId };
  const tower = createTower(1, SINGLE_SPAWN_AIR_CELLS[0], definition);
  const fodder = representativeEnemy("goblin", 35);
  const air = representativeEnemy("goblinRider", 35);
  const tank = representativeEnemy("giantGoblin", 35);
  const airTank = representativeEnemy("undeadDragon", 35);
  const boss = representativeEnemy("skeletonKing", 50);
  const profile = (enemy) => {
    if (!canTowerTargetEnemy(tower, enemy)) return 0;
    const result = getTowerAttackProfile(tower, enemy);
    return Number((result.damage * result.fireRate).toFixed(2));
  };
  return {
    type, level, specializationId: specializationId ?? null,
    gold: getDefenderTotalInvestment(level, type),
    directDps: { groundFodder: profile(fodder), airFodder: profile(air), groundTank: profile(tank), airTank: profile(airTank), boss: profile(boss) },
    rangeCells: DEFENDER_CONFIG[type].rangeMode === "adjacent8" ? tower.range : Number((tower.range / WORLD_UNITS_PER_CELL).toFixed(1)),
  };
}

console.log = () => {};
console.info = () => {};
const referenceBuilds = {
  wave1: {
    royal: repeat(10, { type: "holy-knight", level: 1 }),
    grove: repeat(14, { type: "treant", level: 1 }),
  },
  wave10: {
    royal: [...repeat(10, { type: "holy-knight", level: 2 }), ...repeat(2, { type: "blue-wizard", level: 1 })],
    grove: [{ type: "bark-titan", level: 1 }, ...repeat(7, { type: "treant", level: 2 }), ...repeat(3, { type: "treant", level: 1 })],
  },
  wave15: {
    royal: [
      ...repeat(2, { type: "holy-knight", level: 3, specializationId: "royal-champion" }),
      ...repeat(2, { type: "blue-wizard", level: 3, specializationId: "stormcaller" }),
      ...repeat(2, { type: "green-archer", level: 2 }),
      { type: "battlemage", level: 2 }, ...repeat(3, { type: "blue-wizard", level: 1 }),
    ],
    grove: [{ type: "druid", level: 3, specializationId: "elder-bear" }, ...repeat(4, { type: "thorn-owl", level: 1 }), ...repeat(10, { type: "treant", level: 2 }), ...repeat(3, { type: "treant", level: 1 })],
  },
  wave15L2Grove: [
    ...repeat(2, { type: "druid", level: 2 }), { type: "seer", level: 2 },
    ...repeat(2, { type: "thorn-owl", level: 2 }), ...repeat(5, { type: "treant", level: 1 }),
  ],
  wave30: {
    royal: [
      ...repeat(2, { type: "holy-knight", level: 3, specializationId: "royal-champion" }),
      ...repeat(2, { type: "holy-knight", level: 3, specializationId: "dawn-paladin" }),
      ...repeat(3, { type: "blue-wizard", level: 3, specializationId: "stormcaller" }),
      ...repeat(2, { type: "battlemage", level: 3, specializationId: "warcaster" }),
      { type: "sovereign", level: 3, specializationId: "war-sovereign" },
    ],
    grove: [...repeat(3, { type: "druid", level: 3, specializationId: "elder-bear" }), { type: "seer", level: 3, specializationId: "moon-seer" }, ...repeat(8, { type: "treant", level: 3 })],
  },
  wave30L2Grove: [
    ...repeat(4, { type: "druid", level: 2 }), ...repeat(3, { type: "seer", level: 2 }),
    ...repeat(7, { type: "treant", level: 3 }), ...repeat(5, { type: "treant", level: 1 }),
  ],
  wave50: {
    royal: [...repeat(29, { type: "blue-wizard", level: 3, specializationId: "stormcaller" }), { type: "holy-emperor", level: 2 }],
    grove: [...repeat(8, { type: "seer", level: 3, specializationId: "moon-seer" }), ...repeat(27, { type: "treant", level: 1 })],
  },
};

function auditMap(mapId) {
  const air = {};
  for (const wave of process.env.AUDIT_REFERENCES_ONLY ? [] : [14, 21, 35, 42]) {
    const enemyType = wave >= 35 ? "skeletalCommander" : "goblinRider";
    const royal = findAirThreshold(mapId, "arcane-kingdom", wave, royalAir);
    const grove = findAirThreshold(mapId, "ancient-grove", wave, groveAir);
    air[wave] = {
      composition: getWaveComposition(wave, MAPS[mapId]).entries,
      royal: { clear: summarizeThreshold(royal.firstClear, enemyType), flawless: summarizeThreshold(royal.firstFlawless, enemyType), slotFlawless: summarizeThreshold(royal.slotFlawless, enemyType) },
      grove: { clear: summarizeThreshold(grove.firstClear, enemyType), flawless: summarizeThreshold(grove.firstFlawless, enemyType), slotFlawless: summarizeThreshold(grove.slotFlawless, enemyType) },
    };
  }
  const versus = (wave, builds) => ({
    royal: runReferenceWave(mapId, "arcane-kingdom", wave, builds.royal),
    grove: runReferenceWave(mapId, "ancient-grove", wave, builds.grove),
  });
  const references = {
    wave1: versus(1, referenceBuilds.wave1),
    wave10: versus(10, referenceBuilds.wave10),
    wave15: versus(15, referenceBuilds.wave15),
    wave15L2Grove: runReferenceWave(mapId, "ancient-grove", 15, referenceBuilds.wave15L2Grove),
    wave30: versus(30, referenceBuilds.wave30),
    wave30L2Grove: runReferenceWave(mapId, "ancient-grove", 30, referenceBuilds.wave30L2Grove),
    wave50: versus(50, referenceBuilds.wave50),
  };
  const earlyScale = MAPS[mapId].startingGold / MAPS["single-spawn"].startingGold;
  const pressureScale = MAPS[mapId].enemyCountMultiplier;
  const scaledReferences = {
    wave1: versus(1, {
      royal: scaleBuild(referenceBuilds.wave1.royal, earlyScale),
      grove: scaleBuild(referenceBuilds.wave1.grove, earlyScale),
    }),
    wave10: versus(10, {
      royal: scaleBuild(referenceBuilds.wave10.royal, pressureScale),
      grove: scaleBuild(referenceBuilds.wave10.grove, pressureScale),
    }),
    wave15: versus(15, {
      royal: scaleBuild(referenceBuilds.wave15.royal, pressureScale),
      grove: scaleBuild(referenceBuilds.wave15.grove, pressureScale),
    }),
    wave30: versus(30, {
      royal: scaleBuild(referenceBuilds.wave30.royal, pressureScale),
      grove: scaleBuild(referenceBuilds.wave30.grove, pressureScale),
    }),
  };
  return {
    map: { id: mapId, name: MAPS[mapId].name, spawns: MAPS[mapId].layout.activeSpawns.length, startingGold: MAPS[mapId].startingGold, enemyCountMultiplier: MAPS[mapId].enemyCountMultiplier },
    auditCells: { air: AIR_CELLS_BY_MAP[mapId].length, referenceCapacity: buildableCells(new GameState(mapId, "arcane-kingdom", FIXED_SEED)).length },
    air,
    references, scaledReferences,
  };
}

const selectedMaps = process.env.AUDIT_MAP ? [process.env.AUDIT_MAP] : MAP_IDS;
const maps = Object.fromEntries(selectedMaps.map((mapId) => [mapId, auditMap(mapId)]));
console.log = originalLog;
console.info = originalInfo;

const unitMetrics = {
  royal: [
    ...[1, 2].map((level) => levelMetrics("blue-wizard", level)), levelMetrics("blue-wizard", 3, "stormcaller"), levelMetrics("blue-wizard", 3, "frostweaver"),
    ...[1, 2].map((level) => levelMetrics("holy-knight", level)), levelMetrics("holy-knight", 3, "royal-champion"), levelMetrics("holy-knight", 3, "dawn-paladin"),
    ...[1, 2].map((level) => levelMetrics("green-archer", level)), levelMetrics("green-archer", 3, "dragon-slayer"), levelMetrics("green-archer", 3, "ranger"),
    ...[1, 2].map((level) => levelMetrics("battlemage", level)), levelMetrics("battlemage", 3, "spellblade"), levelMetrics("battlemage", 3, "warcaster"),
    ...[1, 2].map((level) => levelMetrics("sovereign", level)), levelMetrics("sovereign", 3, "storm-regent"), levelMetrics("sovereign", 3, "war-sovereign"),
    ...[1, 2, 3].map((level) => levelMetrics("holy-emperor", level)),
  ],
  grove: [
    ...[1, 2, 3].map((level) => levelMetrics("treant", level)),
    ...[1, 2].map((level) => levelMetrics("thorn-owl", level)), levelMetrics("thorn-owl", 3, "needlewing-owl"), levelMetrics("thorn-owl", 3, "elderwing"),
    ...[1, 2].map((level) => levelMetrics("druid", level)), levelMetrics("druid", 3, "dire-wolf"), levelMetrics("druid", 3, "elder-bear"),
    ...[1, 2].map((level) => levelMetrics("seer", level)), levelMetrics("seer", 3, "moon-seer"), levelMetrics("seer", 3, "sun-seer"),
    ...[1, 2].map((level) => levelMetrics("bark-titan", level)), levelMetrics("bark-titan", 3, "stonebark-titan"), levelMetrics("bark-titan", 3, "heartwood-crusher"),
    ...[1, 2].map((level) => levelMetrics("thorn-dancer", level)), levelMetrics("thorn-dancer", 3, "blight-dancer"), levelMetrics("thorn-dancer", 3, "winterthorn-dancer"),
  ],
};

originalLog(JSON.stringify(process.env.AUDIT_REFERENCES_ONLY
  ? { fixedSeed: FIXED_SEED, stepSeconds: STEP_SECONDS, maps }
  : process.env.AUDIT_MAP
    ? { fixedSeed: FIXED_SEED, stepSeconds: STEP_SECONDS, maps }
    : { fixedSeed: FIXED_SEED, stepSeconds: STEP_SECONDS, maps, unitMetrics }, null, 2));
