// Runtime integration check for optimized new enemy/defender GLBs and build-info UI.
// Start `npm run dev -- --host 127.0.0.1` first.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "td-content-assets-"));
const pending = new Map();
let chrome;
let ownsChrome = false;
let socket;
let nextId = 0;

async function command(method, params = {}) {
  const id = ++nextId;
  const response = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 45000);
    pending.set(id, (value) => { clearTimeout(timeout); resolve(value); });
  });
  socket.send(JSON.stringify({ id, method, params }));
  return response;
}

async function evaluate(expression) {
  const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result?.value;
}

async function main() {
  const paths = [
    "/assets/models/enemies/undead-dragon.glb", "/assets/models/enemies/optimized/undead-dragon.glb",
    "/assets/models/enemies/skeleton-king.glb", "/assets/models/enemies/optimized/skeleton-king.glb",
    "/assets/models/enemies/skeletal-commander.glb", "/assets/models/enemies/optimized/skeletal-commander.glb",
    "/assets/models/defenders/green-archer.glb", "/assets/models/defenders/optimized/green-archer.glb",
    "/assets/models/defenders/battlemage.glb", "/assets/models/defenders/optimized/battlemage.glb",
    "/assets/models/defenders/sovereign.glb", "/assets/models/defenders/optimized/sovereign.glb",
    "/assets/ui/defenders/green-archer.png", "/assets/ui/defenders/battlemage.png",
    "/assets/ui/defenders/sovereign.png",
  ];
  for (const assetPath of paths) {
    const response = await fetch(`http://127.0.0.1:5173${assetPath}`);
    if (!response.ok) throw new Error(`Missing runtime asset: ${assetPath} (${response.status})`);
  }

  let pages;
  try {
    pages = await (await fetch("http://127.0.0.1:9255/json")).json();
  } catch {
    chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
      "--headless=new", "--disable-extensions", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--remote-debugging-port=9255", `--user-data-dir=${profile}`, "about:blank",
    ], { windowsHide: true, stdio: "ignore" });
    ownsChrome = true;
    await delay(1200);
    pages = await (await fetch("http://127.0.0.1:9255/json")).json();
  }
  socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message.result || message.error); pending.delete(message.id); }
  });
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await command("Page.navigate", { url: "http://127.0.0.1:5173/?waveDebug=1&defenderVisualDebug=1&enemyVisualDebug=1&enemyGroundDebug=1" });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const loaded = await evaluate("(window.__enemyTemplateAudit?.length ?? 0) === 9 && (window.__defenderTemplateAudit?.length ?? 0) === 3 && !!window.__towerDefenceUi");
    if (loaded) break;
    if (attempt === 99) throw new Error("New enemy and defender GLB templates failed to load.");
    await delay(300);
  }
  const visualState = await evaluate(`(() => {
    const game = window.__towerDefenceGameState;
    const ui = window.__towerDefenceUi;
    if (!game || !ui) throw new Error('Debug game state/UI bridge is unavailable');
    game.gold = 5000;
    const place = (type) => {
      for (let y = 0; y < game.grid.height; y++) for (let x = 0; x < game.grid.width; x++) {
        const cell = { x, y };
        if (game.canPlaceBasicTower(cell, type) === 'placed') return game.placeBasicTower(cell, type);
      }
      return 'no-build-cell';
    };
    const types = ['blue-wizard', 'holy-knight', 'green-archer', 'battlemage', 'sovereign'];
    const placedIds = [];
    for (const type of types) {
      for (let index = 0; index < 5; index += 1) {
        if (place(type) !== 'placed') throw new Error('Could not place ' + (index + 1) + '/5 ' + type + ' defenders');
        placedIds.push(game.towers[game.towers.length - 1].id);
      }
    }
    ui.chooseBuildUnit('green-archer');
    const archer = {
      name: document.querySelector('#build-unit-info-name').textContent,
      role: document.querySelector('#build-unit-info-role').textContent,
      damage: document.querySelector('#build-unit-info-damage').textContent,
      range: document.querySelector('#build-unit-info-range').textContent,
      rate: document.querySelector('#build-unit-info-rate').textContent,
      cost: document.querySelector('#build-unit-info-cost').textContent,
    };
    ui.chooseBuildUnit('battlemage');
    const battlemage = {
      name: document.querySelector('#build-unit-info-name').textContent,
      role: document.querySelector('#build-unit-info-role').textContent,
      damage: document.querySelector('#build-unit-info-damage').textContent,
      range: document.querySelector('#build-unit-info-range').textContent,
      rate: document.querySelector('#build-unit-info-rate').textContent,
      cost: document.querySelector('#build-unit-info-cost').textContent,
    };
    ui.chooseBuildUnit('sovereign');
    const sovereign = {
      name: document.querySelector('#build-unit-info-name').textContent,
      role: document.querySelector('#build-unit-info-role').textContent,
      cost: document.querySelector('#build-unit-info-cost').textContent,
      profiles: [...document.querySelectorAll('#build-sovereign-profiles > span.profile-mode')].map((row) => row.textContent),
      range: document.querySelector('#build-sovereign-profiles > .profile-summary').textContent,
      costSummary: document.querySelectorAll('#build-sovereign-profiles > .profile-summary')[1].textContent,
    };
    ui.selectTower(placedIds[24]);
    const selectedSovereign = {
      name: document.querySelector('.tower-name').textContent,
      level: document.querySelector('#tower-level').textContent,
      profiles: [...document.querySelectorAll('#tower-sovereign-profiles > span.profile-mode')].map((row) => row.textContent),
      range: document.querySelector('#tower-sovereign-profiles > .profile-summary').textContent,
    };
    document.querySelector('#upgrade-button').click();
    const sovereignLevel2 = {
      level: document.querySelector('#tower-level').textContent,
      profiles: [...document.querySelectorAll('#tower-sovereign-profiles > span.profile-mode')].map((row) => row.textContent),
    };
    document.querySelector('#upgrade-button').click();
    const sovereignLevel3 = {
      level: document.querySelector('#tower-level').textContent,
      profiles: [...document.querySelectorAll('#tower-sovereign-profiles > span.profile-mode')].map((row) => row.textContent),
      action: document.querySelector('#upgrade-button').textContent,
    };
    ui.selectTower();
    ui.selectTower(placedIds[14]);
    const groundLineup = window.__towerDefenceEnemyVisualTest.spawnGroundLineup();
    return { archer, battlemage, sovereign, selectedSovereign, sovereignLevel2, sovereignLevel3, groundLineup, placedIds, towers: game.towers.map(({ type, level }) => ({ type, level })) };
  })()`);
  await delay(1000);
  const result = await evaluate(`({
    enemyTemplates: window.__enemyTemplateAudit,
    enemyVisualInstances: window.__enemyVisualInstances,
    defenderTemplates: window.__defenderTemplateAudit,
    defenderInstances: window.__defenderVisualInstances,
    sceneTriangles: window.__enemySceneStats?.totalSceneTriangles,
    selection: window.__towerDefenceUi.selectionVisual(),
  })`);
  if (result.enemyTemplates.some((asset) => !asset.optimized) || result.enemyTemplates.length !== 9) {
    throw new Error(`Enemy factory did not load all optimized GLBs: ${JSON.stringify(result.enemyTemplates)}`);
  }
  const groundTypes = ["goblin", "goblinBrute", "ghoul", "wraith", "giantGoblin", "skeletonKing"];
  const groundInstances = result.enemyVisualInstances?.filter((asset) => groundTypes.includes(asset.type)) ?? [];
  const expectedGroundOffsets = { goblin: -0.12, goblinBrute: -0.02, ghoul: -0.02, wraith: 0.15, giantGoblin: -0.02, skeletonKing: -0.02 };
  if (groundInstances.length !== 6 || groundInstances.some((asset) => Math.abs(asset.groundOffsetY - expectedGroundOffsets[asset.type]) > 1e-9
    || Math.abs(asset.bounds.minY - asset.groundOffsetY) > 0.005)) {
    throw new Error(`Ground enemy model bounds/alignment offsets failed: ${JSON.stringify(groundInstances)}`);
  }
  if (result.defenderTemplates.some((asset) => !asset.optimized) || result.defenderTemplates.length !== 3) {
    throw new Error(`Defender factory did not load all optimized GLBs: ${JSON.stringify(result.defenderTemplates)}`);
  }
  const newTypeInstances = result.defenderInstances?.filter((asset) => ["green-archer", "battlemage", "sovereign"].includes(asset.type)) ?? [];
  const newTypeCounts = Object.fromEntries(["green-archer", "battlemage", "sovereign"].map((type) => [
    type, newTypeInstances.filter((asset) => asset.type === type).length,
  ]));
  if (newTypeInstances.length !== 15 || Object.values(newTypeCounts).some((count) => count !== 5)
    || newTypeInstances.some((asset) => !asset.optimized || asset.primitiveFallback || !asset.assetPath || asset.bounds.minY < -0.002
      || asset.bounds.width >= 1 || asset.bounds.depth >= 1)) {
    throw new Error(`Defender GLB instance or bounds check failed: ${JSON.stringify(result.defenderInstances)}`);
  }
  const typeToExpectedPath = {
    "green-archer": "/assets/models/defenders/optimized/green-archer.glb",
    battlemage: "/assets/models/defenders/optimized/battlemage.glb",
    sovereign: "/assets/models/defenders/optimized/sovereign.glb",
  };
  if (result.defenderTemplates.some((asset) => asset.assetPath !== typeToExpectedPath[asset.type])) {
    throw new Error(`Defender type resolved to the wrong GLB: ${JSON.stringify(result.defenderTemplates)}`);
  }
  if (!result.selection.visible || !result.selection.markerVisible || result.selection.markerPosition.y <= 0.2) {
    throw new Error(`Selection ring/diamond failed for imported defender: ${JSON.stringify(result.selection)}`);
  }
  if (visualState.archer.name !== "Green Archer" || visualState.archer.role !== "Anti-Air · 3× flying damage"
    || visualState.archer.damage !== "12" || visualState.archer.range !== "5.0 Tiles" || visualState.archer.cost !== "20 Gold") {
    throw new Error(`Archer build panel is not config-driven: ${JSON.stringify(visualState.archer)}`);
  }
  if (visualState.battlemage.name !== "Battlemage" || visualState.battlemage.role !== "Hybrid / Splash"
    || visualState.battlemage.damage !== "50" || visualState.battlemage.range !== "3.6 Tiles" || visualState.battlemage.cost !== "35 Gold") {
    throw new Error(`Battlemage build panel is not config-driven: ${JSON.stringify(visualState.battlemage)}`);
  }
  if (visualState.sovereign.name !== "Sovereign" || visualState.sovereign.role !== "Adaptive / Ultimate"
    || visualState.sovereign.profiles.length !== 3 || visualState.sovereign.range !== "Range4.5 Tiles"
    || visualState.sovereign.costSummary !== "Build Cost100 Gold"
    || visualState.selectedSovereign.name !== "Sovereign" || visualState.selectedSovereign.level !== "Level 1"
    || visualState.selectedSovereign.profiles.length !== 3 || visualState.selectedSovereign.range !== "Range4.5 Tiles"
    || visualState.sovereignLevel2.level !== "Level 2" || !visualState.sovereignLevel2.profiles[0].includes("170 dmg · 1.65/s")
    || !visualState.sovereignLevel2.profiles[1].includes("105 dmg · 2.40/s")
    || !visualState.sovereignLevel2.profiles[2].includes("430 dmg · 0.60/s")
    || visualState.sovereignLevel3.level !== "Level 3" || visualState.sovereignLevel3.action !== "MAX LEVEL"
    || !visualState.sovereignLevel3.profiles[0].includes("360 dmg · 1.80/s")
    || !visualState.sovereignLevel3.profiles[1].includes("225 dmg · 2.60/s")
    || !visualState.sovereignLevel3.profiles[2].includes("950 dmg · 0.65/s")) {
    throw new Error(`Sovereign build/selected profile UI failed: ${JSON.stringify(visualState.sovereign)} / ${JSON.stringify(visualState.selectedSovereign)}`);
  }
  if (!Number.isFinite(result.sceneTriangles)) throw new Error("Scene triangle telemetry was not populated.");
  await evaluate("window.__towerDefenceUi.selectTower(); window.__towerDefenceUi.chooseBuildUnit('sovereign')");
  await evaluate(`(() => {
    const ui = window.__towerDefenceUi;
    for (const towerId of [${visualState.placedIds[0]}, ${visualState.placedIds[5]}]) {
      ui.selectTower(towerId);
      document.querySelector('#upgrade-button').click();
      document.querySelector('#upgrade-button').click();
    }
  })()`);
  const layouts = [];
  const screenshots = [];
  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    await command("Emulation.setDeviceMetricsOverride", {
      ...viewport, deviceScaleFactor: 1, mobile: viewport.width < 600,
    });
    await evaluate("window.__towerDefenceUi.chooseBuildUnit('sovereign')");
    await delay(350);
    const layout = await evaluate(`(() => {
      const rect = (element) => { const { x, y, width, height, right, bottom } = element.getBoundingClientRect(); return { x, y, width, height, right, bottom }; };
      const footer = document.querySelector('.bottom-hud-bar');
      const tray = document.querySelector('.defender-choice-panel');
      const cards = [...tray.querySelectorAll('.defender-choice')];
      const trayRect = tray.getBoundingClientRect();
      const visibleCards = cards.filter((card) => {
        const cardRect = card.getBoundingClientRect();
        return cardRect.left >= trayRect.left - 1 && cardRect.right <= trayRect.right + 1;
      }).length;
      const selected = document.querySelector('#build-sovereign-button');
      const selectedRect = selected.getBoundingClientRect();
      const waveElement = document.querySelector('#start-wave-button');
      const autoElement = document.querySelector('#auto-button');
      const wave = rect(waveElement);
      const auto = rect(autoElement);
      const towerLayouts = [];
      for (const [type, id] of ${JSON.stringify([
        ["Wizard L3", visualState.placedIds[0]],
        ["Knight L3", visualState.placedIds[5]],
        ["Battlemage", visualState.placedIds[15]],
        ["Sovereign L3", visualState.placedIds[24]],
      ])}) {
        window.__towerDefenceUi.selectTower(id);
        const panel = document.querySelector('#tower-panel');
        const identity = panel.querySelector('.tower-identity');
        const stats = panel.querySelector('#tower-sovereign-profiles:not([hidden])') ?? panel.querySelector('.tower-stats');
        const actions = panel.querySelector('.tower-actions');
        const upgrade = panel.querySelector('.upgrade-button');
        const info = panel.querySelector('.upgrade-info-button');
        const sell = panel.querySelector('.sell-button');
        towerLayouts.push({
          type,
          level: panel.querySelector('#tower-level').textContent.trim(),
          panel: rect(panel), identity: rect(identity), stats: rect(stats), actions: rect(actions),
          upgrade: rect(upgrade), info: rect(info), sell: rect(sell),
          upgradeClip: upgrade.scrollWidth > upgrade.clientWidth + 1,
          sellClip: sell.scrollWidth > sell.clientWidth + 1,
        });
      }
      return {
        viewport: { width: innerWidth, height: innerHeight },
        hudHeight: rect(footer).height,
        card: { width: rect(cards[0]).width, height: rect(cards[0]).height },
        visibleCards,
        trayScrollable: tray.scrollWidth > tray.clientWidth,
        overflowAffordance: document.querySelector('.build-unit-section').classList.contains('has-overflow'),
        selectedCardVisible: selectedRect.left >= trayRect.left - 1 && selectedRect.right <= trayRect.right + 1,
        horizontalPageOverflow: document.documentElement.scrollWidth > innerWidth,
        touchAction: getComputedStyle(tray).touchAction,
        actionsVisible: wave.width > 0 && auto.width > 0 && wave.bottom <= innerHeight && auto.bottom <= innerHeight,
        waveControls: {
          sameSize: Math.abs(wave.width - auto.width) < 0.5 && Math.abs(wave.height - auto.height) < 0.5,
          sameEdges: Math.abs(wave.x - auto.x) < 0.5 && Math.abs(wave.right - auto.right) < 0.5,
          sameRadius: getComputedStyle(waveElement).borderRadius === getComputedStyle(autoElement).borderRadius,
          width: wave.width, height: wave.height, radius: getComputedStyle(waveElement).borderRadius,
        },
        towerLayouts,
      };
    })()`);
    if (layout.card.width < 70 || layout.card.width > 85 || layout.card.height < 85 || layout.card.height > 105
      || (viewport.width < 600 && !layout.trayScrollable) || !layout.selectedCardVisible || layout.horizontalPageOverflow
      || layout.touchAction !== "pan-x" || !layout.actionsVisible
      || !layout.waveControls.sameSize || !layout.waveControls.sameEdges || !layout.waveControls.sameRadius
      || layout.towerLayouts.some((tower) => tower.panel.width <= 0 || tower.upgrade.width < 92 || tower.sell.width < 104
        || tower.info.width < 30 || tower.info.width > 36 || tower.upgradeClip || tower.sellClip
        || tower.upgrade.right > tower.info.x + 1 || tower.info.right > tower.sell.x + 1
        || tower.actions.right > tower.panel.right + 1
        || (viewport.width <= 520 && (tower.actions.top < tower.stats.bottom - 1 || tower.actions.left < tower.panel.left - 1)))
      || (viewport.width < 400 && (layout.visibleCards < 3 || layout.visibleCards > 4))) {
      throw new Error(`Compact HUD layout failed at ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`);
    }
    layouts.push(layout);
  }
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const originalHudHeight = await evaluate("document.querySelector('.bottom-hud-bar').getBoundingClientRect().height");
  await evaluate(`(() => {
    const tray = document.querySelector('.defender-choice-panel');
    for (let index = 0; index < 3; index += 1) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'defender-choice';
      card.dataset.layoutTest = 'true';
      card.textContent = 'Future Unit';
      tray.append(card);
    }
  })()`);
  await delay(100);
  const futureUnitHudHeight = await evaluate("document.querySelector('.bottom-hud-bar').getBoundingClientRect().height");
  await evaluate("document.querySelectorAll('[data-layout-test]').forEach((card) => card.remove())");
  if (Math.abs(futureUnitHudHeight - originalHudHeight) > 1) {
    throw new Error(`Adding future unit cards changed bottom HUD height: ${originalHudHeight} -> ${futureUnitHudHeight}`);
  }
  if (process.env.SAVE_COMPACT_HUD_SCREENSHOTS === "1") {
    const screenshotDirectory = path.resolve(__dirname, "../artifacts/compact-hud");
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    await command("Page.navigate", { url: "http://127.0.0.1:5173/" });
    await delay(800);
    for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
      await command("Emulation.setDeviceMetricsOverride", {
        ...viewport, deviceScaleFactor: 1, mobile: viewport.width < 600,
      });
      await delay(150);
      const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
      const fileName = `after-${viewport.width}x${viewport.height}.png`;
      fs.writeFileSync(path.join(screenshotDirectory, fileName), Buffer.from(screenshot.data, "base64"));
      screenshots.push(path.join(screenshotDirectory, fileName));
    }
  }
  console.log(JSON.stringify({
    responsiveLayouts: layouts.map(({ viewport, hudHeight, card, visibleCards, trayScrollable, actionsVisible, waveControls, towerLayouts }) => ({
      viewport, hudHeight, card, visibleCards, trayScrollable, actionsVisible, waveControls,
      towerLayouts: towerLayouts.map(({ type, level, panel, stats, actions, upgrade, info, sell, upgradeClip, sellClip }) => ({
        type, level, panel, stats, actions, upgrade, info, sell, upgradeClip, sellClip,
      })),
    })),
    futureUnitHudHeight, screenshots, runtimeFilesServed: paths.length,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket) socket.close();
  if (chrome && ownsChrome) {
    const closed = new Promise((resolve) => chrome.once("close", resolve));
    chrome.kill();
    await Promise.race([closed, delay(5000)]);
  }
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); }
  catch (error) { console.warn("Temporary browser profile cleanup deferred:", error.message); }
});
