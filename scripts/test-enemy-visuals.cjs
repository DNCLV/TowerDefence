// Browser integration check. Start `npm run dev -- --host 127.0.0.1` first.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "td-enemy-visuals-"));
const appUrl = process.env.TD_TEST_URL ?? "http://127.0.0.1:5173/";
const appOrigin = new URL(appUrl).origin;
const pending = new Map();
let chrome;
let socket;
let nextId = 0;

async function command(method, params = {}) {
  const id = ++nextId;
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 45000);
    pending.set(id, (message) => { clearTimeout(timeout); resolve(message); });
  });
  socket.send(JSON.stringify({ id, method, params }));
  return result;
}

async function evaluate(expression) {
  const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result?.value;
}

async function main() {
  const assets = ["goblin", "goblin-brute", "goblin-rider", "giant-goblin", "ghoul", "wraith", "undead-dragon", "skeleton-king"];
  for (const asset of assets) {
    for (const sourcePath of [`optimized/${asset}.glb`, `${asset}.glb`]) {
      const response = await fetch(`${appOrigin}/assets/models/enemies/${sourcePath}`);
      if (!response.ok) throw new Error(`Missing runtime asset: ${sourcePath} (${response.status})`);
    }
  }
  chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--disable-extensions", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--remote-debugging-port=9253", `--user-data-dir=${profile}`, "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  await delay(1200);
  const pages = await (await fetch("http://127.0.0.1:9253/json")).json();
  socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message.result || message.error); pending.delete(message.id); }
  });
  await command("Runtime.enable");
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await command("Page.navigate", { url: `${appUrl}${appUrl.includes("?") ? "&" : "?"}waveDebug=1&perfDebug=1` });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate("!!document.querySelector('#start-selected-map')")) break;
    await delay(100);
  }
  await evaluate("document.querySelector('#start-selected-map').click()");
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate("!!document.querySelector('#start-battlefield')")) break;
    await delay(100);
  }
  await evaluate("document.querySelector('#start-battlefield').click()");
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const loaded = await evaluate("window.__enemyTemplateAudit?.length ?? 0");
    if (loaded === 8) break;
    if (attempt === 79) throw new Error("All eight optimized GLB templates did not load.");
    await delay(500);
  }
  let before = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    before = await evaluate("window.__enemySceneStats ?? null");
    if (before?.cachedModels === 8) break;
    await delay(250);
  }
  if (process.env.TD_ENEMY_VISUAL_BASE_SCREENSHOT) {
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(process.env.TD_ENEMY_VISUAL_BASE_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
  }

  const populated = await evaluate(`(async () => {
    const [{ createEnemy }, { ENEMY_CONFIG }] = await Promise.all([
      import('/src/game/enemies/Enemy.ts'), import('/src/game/config/EnemyConfig.ts')
    ]);
    const state = window.__towerDefenceGameState;
    if (!state) throw new Error('Debug GameState is not exposed.');
    const exit = state.exit;
    const counts = { goblin: 10, goblinBrute: 10, goblinRider: 10, giantGoblin: 3, ghoul: 10, wraith: 10, undeadDragon: 10, skeletonKing: 1 };
    const enemies = [];
    let id = 1000;
    for (const [type, count] of Object.entries(counts)) {
      for (let index = 0; index < count; index += 1) {
        const x = 3 + (index % 10) * 4;
        const typeOffset = { goblinBrute: 2, goblinRider: 4, giantGoblin: 6, ghoul: 8, wraith: 10, undeadDragon: 12, skeletonKing: 14 }[type] ?? 0;
        const y = 3 + Math.floor(index / 10) * 7 + typeOffset;
        enemies.push(createEnemy(id++, type, [{ x, y }, { x: exit.x, y: exit.y }]));
      }
    }
    state.waveActive = true;
    state.toSpawn = 1;
    state.enemies = enemies;
    return { total: enemies.length, types: counts, expectedModels: Object.keys(ENEMY_CONFIG).length };
  })()`);
  await delay(2500);
  const result = await evaluate(`({
    templates: window.__enemyTemplateAudit,
    instances: window.__enemyVisualInstances,
    activeVisualCount: document.querySelector('#stat-enemies')?.textContent,
    sceneStats: window.__enemySceneStats,
    errors: window.__enemyVisualAudit?.filter(entry => entry.status === 'rejected') ?? []
  })`);
  if (process.env.TD_GIANT_GOBLIN_ONLY === "1") {
    if (!populated || result.errors.length) throw new Error(`Giant visual sample failed to render: ${JSON.stringify(result.errors)}`);
    const giant = result.instances.find((item) => item.type === "giantGoblin");
    const brute = result.instances.find((item) => item.type === "goblinBrute");
    if (!giant || !brute) throw new Error("Giant Goblin or Goblin Brute did not produce a rendered instance.");
    const ratio = giant.bounds.height / brute.bounds.height;
    if (Math.abs(giant.scale - 2.36) > 0.001 || ratio < 1.8 || ratio > 2.2
      || giant.bounds.height >= giant.maxDimension || Math.abs(giant.bounds.minY) > 0.001
      || giant.hpBarOffsetY < giant.bounds.height + 0.2 || giant.hpBarOffsetY > giant.bounds.height + 0.5) {
      throw new Error(`Giant Goblin visual bounds/attachments are out of range: ${JSON.stringify({ giant, brute, ratio })}`);
    }
    const gameplayStats = await evaluate(`(async () => { const { ENEMY_CONFIG } = await import('/src/game/config/EnemyConfig.ts');
      return { giant: ENEMY_CONFIG.giantGoblin, brute: ENEMY_CONFIG.goblinBrute }; })()`);
    if (gameplayStats.giant.hp !== 3000 || gameplayStats.giant.speedMultiplier !== 0.42
      || gameplayStats.giant.goldReward !== 10 || gameplayStats.giant.livesDamage !== 3
      || gameplayStats.giant.threatWeight !== 18 || gameplayStats.brute.hp !== 550) {
      throw new Error(`Giant/Brute gameplay stats changed: ${JSON.stringify(gameplayStats)}`);
    }
    console.log("Giant Goblin visual size check passed", JSON.stringify({
      giant: { scale: giant.scale, bounds: giant.bounds, hpBarOffsetY: giant.hpBarOffsetY },
      brute: { scale: brute.scale, bounds: brute.bounds }, ratio, gameplayStats,
    }));
    return;
  }
  if (!populated || result.instances?.length !== 64) throw new Error(`Expected 64 enemy instances; got ${result.instances?.length ?? 0}.`);
  if (result.errors.length) throw new Error(`A model failed bounds validation: ${JSON.stringify(result.errors)}`);
  if (result.instances.some((item) => item.cachedModelCount !== result.templates.length)) {
    throw new Error(`Enemy GLB templates were not cached before instantiation: ${JSON.stringify({ templates: result.templates.length, counts: [...new Set(result.instances.map((item) => item.cachedModelCount))] })}`);
  }
  if (result.templates.length !== 8 || result.templates.some((item) => !item.optimized || !item.assetPath.includes("/optimized/"))) {
    throw new Error(`The eight optimized models were not used: ${JSON.stringify(result.templates)}`);
  }
  const perType = Object.fromEntries(Object.keys(populated.types).map((type) => {
    const item = result.instances.find((entry) => entry.type === type);
    return [type, { count: result.instances.filter((entry) => entry.type === type).length, ...item }];
  }));
  const giant = perType.giantGoblin;
  const brute = perType.goblinBrute;
  const giantToBruteHeight = giant.bounds.height / brute.bounds.height;
  if (Math.abs(giant.scale - 2.36) > 0.001) throw new Error(`Giant visual scale should be 2.36; got ${giant.scale}.`);
  if (giant.bounds.height < 4.4 || giant.bounds.height > 4.6 || giant.bounds.height >= giant.maxDimension
    || giantToBruteHeight < 1.8 || giantToBruteHeight > 2.2) {
    throw new Error(`Giant height should be about 2x Goblin Brute while under its 7-unit guard; got height ${giant.bounds.height}, ratio ${giantToBruteHeight}.`);
  }
  if (Math.abs(giant.bounds.minY) > 0.001) throw new Error(`Giant should stay ground-aligned; minY=${giant.bounds.minY}.`);
  if (giant.hpBarOffsetY < giant.bounds.height + 0.2 || giant.hpBarOffsetY > giant.bounds.height + 0.5) {
    throw new Error(`Giant HP bar should clear the measured head height; offset=${giant.hpBarOffsetY}, height=${giant.bounds.height}.`);
  }
  const dragon = perType.undeadDragon;
  const king = perType.skeletonKing;
  if (dragon.count !== 10 || dragon.bounds.width <= perType.goblinRider.bounds.width) throw new Error("Dragon should render bigger than Goblin Rider.");
  if (king.count !== 1 || king.bounds.height <= giant.bounds.height || king.bounds.height >= king.maxDimension) throw new Error("Skeleton King measured scale is not within its boss visual guard.");
  if (dragon.hpBarOffsetY < dragon.bounds.height + 0.2 || king.hpBarOffsetY < king.bounds.height + 0.2) throw new Error("New enemy HP bar offsets do not clear their model bounds.");
  const templates = result.templates.map(({ type, assetPath, roots, meshes, materials, textures, skeletons, animations, cameras, lights }) => ({
    type, assetPath, roots, meshes, materials, textures, skeletons, animations, cameras, lights,
  }));
  if (JSON.stringify(result.sceneStats.visibleByType) !== JSON.stringify(populated.types)) throw new Error("The active renderer did not retain all requested enemy visuals.");
  const expectedTriangleTotals = { goblin: 213260, goblinBrute: 282880, goblinRider: 359300, giantGoblin: 120162, ghoul: 216380, wraith: 254860, undeadDragon: 371920, skeletonKing: 44860 };
  if (JSON.stringify(result.sceneStats.trianglesByType) !== JSON.stringify(expectedTriangleTotals)) {
    throw new Error(`Optimized stress-test triangle counts differ: ${JSON.stringify(result.sceneStats.trianglesByType)}`);
  }
  if (result.sceneStats.totalSceneTriangles < result.sceneStats.totalEnemyTriangles) {
    throw new Error(`Full scene triangle estimate is below the enemy-only total: ${JSON.stringify(result.sceneStats)}`);
  }
  const sourceStressTriangles = 18847440;
  const optimizedStressTriangles = Object.values(expectedTriangleTotals).reduce((sum, value) => sum + value, 0);
  const triangleReductionPercent = Number(((1 - optimizedStressTriangles / sourceStressTriangles) * 100).toFixed(2));
  if (process.env.TD_ENEMY_VISUAL_SCREENSHOT) {
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(process.env.TD_ENEMY_VISUAL_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
  }
  console.log(JSON.stringify({ before, after: result.sceneStats, templates, perType, stressTest: {
    activeEnemies: populated.total, sourceTriangles: sourceStressTriangles,
    optimizedTriangles: optimizedStressTriangles, triangleReductionPercent,
    totalSceneTriangles: result.sceneStats.totalSceneTriangles,
    fps: result.sceneStats.fps, frameTimeMs: result.sceneStats.frameTimeMs,
    activeSceneMeshes: result.sceneStats.activeSceneMeshes,
    activeSceneTriangles: result.sceneStats.activeSceneTriangles,
  }, loadCount: result.templates.length }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket) socket.close();
  if (chrome) {
    const closed = new Promise((resolve) => chrome.once("close", resolve));
    chrome.kill();
    await Promise.race([closed, delay(5000)]);
  }
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); }
  catch (error) { console.warn("Temporary browser profile cleanup deferred:", error.message); }
});
