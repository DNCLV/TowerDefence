// Runtime integration check for optimized new enemy/defender GLBs and build-info UI.
// Start `npm run dev -- --host 127.0.0.1` first.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "td-content-assets-"));
const appUrl = process.env.TD_TEST_URL ?? "http://127.0.0.1:5173/";
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
    const response = await fetch(new URL(assetPath.replace(/^\//, ""), appUrl));
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
  await command("Emulation.setTouchEmulationEnabled", { enabled: true, configuration: "mobile" });
  await command("Page.navigate", { url: `${appUrl}?waveDebug=1&inputDebug=1&defenderVisualDebug=1&enemyVisualDebug=1&enemyGroundDebug=1` });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await evaluate("document.querySelectorAll('.map-choice-card').length === 3");
    if (ready) break;
    if (attempt === 99) {
      const pageState = await evaluate(`({ url: location.href, title: document.title, body: document.body.innerText.slice(0, 800), app: document.querySelector('#app')?.innerHTML.slice(0, 800) })`);
      throw new Error(`Choose Map screen did not load three map choices: ${JSON.stringify(pageState)}`);
    }
    await delay(100);
  }
  const responsiveLayouts = [];
  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 1365, height: 900 }]) {
    await command("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: viewport.width < 500 });
    responsiveLayouts.push(await evaluate(`(() => {
      const app = document.querySelector('#app').getBoundingClientRect();
      const grid = document.querySelector('.map-choice-grid');
      const title = document.querySelector('#map-select-title').getBoundingClientRect();
      const start = document.querySelector('#start-selected-map').getBoundingClientRect();
      const selected = document.querySelector('.map-choice-card.is-selected').getBoundingClientRect();
      const cardGrid = document.querySelector('.map-choice-grid');
      const cards = [...document.querySelectorAll('.map-choice-card')];
      const getCardRects = () => cards.map((card) => {
        const rect = card.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
      const stableBefore = getCardRects();
      const scrollBefore = { left: cardGrid.scrollLeft, top: cardGrid.scrollTop };
      for (const id of ['single-spawn', 'two-spawns', 'three-spawns', 'single-spawn']) {
        document.querySelector('.map-choice-card[data-map-id="' + id + '"]').click();
      }
      const stableAfter = getCardRects();
      const maxCardShift = Math.max(...stableBefore.flatMap((before, index) =>
        Object.keys(before).map((key) => Math.abs(before[key] - stableAfter[index][key]))));
      const cardScrollStable = cardGrid.scrollLeft === scrollBefore.left && cardGrid.scrollTop === scrollBefore.top;
      document.querySelector('.map-choice-card[data-map-id="single-spawn"]').click();
      return {
        viewport: [${viewport.width}, ${viewport.height}],
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        appWidth: app.width,
        titleVisible: title.width > 0 && title.left >= app.left && title.right <= app.right,
        selectedCardVisible: selected.width > 0 && selected.right > app.left && selected.left < app.right,
        startVisible: start.width > 0 && start.bottom <= app.bottom,
        gridFlow: getComputedStyle(grid).gridAutoFlow,
        cardWidth: document.querySelector('.map-choice-card').getBoundingClientRect().width,
        hasHorizontalCarousel: grid.scrollWidth > grid.clientWidth,
        cardStability: { maxCardShift, cardScrollStable, before: stableBefore, after: stableAfter },
      };
    })()`));
  }
  if (responsiveLayouts.some((layout) => layout.pageWidth > layout.viewportWidth || !layout.titleVisible || !layout.selectedCardVisible || !layout.startVisible
    || layout.cardStability.maxCardShift > 0.5 || !layout.cardStability.cardScrollStable)
    || responsiveLayouts[0].gridFlow !== "column" || !responsiveLayouts[0].hasHorizontalCarousel || responsiveLayouts[0].cardWidth < 240
    || responsiveLayouts[1].gridFlow !== "column" || !responsiveLayouts[1].hasHorizontalCarousel || responsiveLayouts[1].cardWidth < 240
    || responsiveLayouts[2].gridFlow !== "row" || responsiveLayouts[2].hasHorizontalCarousel || responsiveLayouts[2].cardWidth >= responsiveLayouts[2].appWidth / 2) {
    throw new Error(`Choose Map responsive layout failed: ${JSON.stringify(responsiveLayouts)}`);
  }
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mapSelection = await evaluate(`(() => {
    const start = document.querySelector('#start-selected-map');
    if (start.disabled) throw new Error('START should be enabled for the preselected first map');
    const first = document.querySelector('.map-choice-card[data-map-id="single-spawn"]');
    if (first.getAttribute('aria-pressed') !== 'true') throw new Error('1 Spawn should be selected by default');
    const checks = [...document.querySelectorAll('.map-choice-card')].map((card) => {
      card.click();
      return { id: card.dataset.mapId, selected: card.getAttribute('aria-pressed') === 'true', canStart: !start.disabled };
    });
    document.querySelector('.map-choice-card[data-map-id="single-spawn"]').click();
    start.click();
    return {
      checks,
      defaultMap: first.dataset.mapId,
      mapNames: [...document.querySelectorAll('.map-choice-card .map-choice-copy strong')].map((node) => node.textContent.trim()),
      previewPaths: [...document.querySelectorAll('.map-preview svg')].map((svg) => svg.querySelectorAll('.map-preview-route').length),
      previewObstacles: [...document.querySelectorAll('.map-preview svg')].map((svg) => svg.querySelectorAll('.map-preview-obstacle').length),
      threeSpawnColors: [...document.querySelectorAll('[data-map-id="three-spawns"] .map-preview-spawn')].map((node) => node.style.getPropertyValue('--spawn-color')),
    };
  })()`);
  if (mapSelection.checks.length !== 3 || mapSelection.checks.some((choice) => !choice.selected || !choice.canStart)
    || mapSelection.defaultMap !== "single-spawn"
    || JSON.stringify(mapSelection.previewPaths) !== JSON.stringify([1, 2, 3])
    || JSON.stringify(mapSelection.mapNames) !== JSON.stringify(["Open Field", "Split Advance", "Triple Convergence"])
    || mapSelection.previewObstacles[0] !== 0 || mapSelection.previewObstacles[1] === 0 || mapSelection.previewObstacles[2] < 3
    || new Set(mapSelection.threeSpawnColors).size !== 3) {
    throw new Error(`Map selection flow failed: ${JSON.stringify(mapSelection)}`);
  }
  console.log("Choose Map responsive checks passed", JSON.stringify({ responsiveLayouts, mapSelection }));
  if (process.env.TD_MAP_SELECT_ONLY === "1") return;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const loaded = await evaluate("(window.__enemyTemplateAudit?.length ?? 0) === 9 && (window.__defenderTemplateAudit?.length ?? 0) === 3 && !!window.__towerDefenceUi && !!window.__towerDefenceInputDebug");
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
      || asset.bounds.width >= 1 || asset.bounds.depth >= 1 || Math.abs(asset.bounds.minY) > 0.01 || !(asset.groundOffset > 0))) {
    throw new Error(`Defender GLB instance or bounds check failed: ${JSON.stringify(result.defenderInstances)}`);
  }
  const visualHeights = Object.fromEntries(["green-archer", "battlemage", "sovereign"].map((type) => {
    const instances = newTypeInstances.filter((asset) => asset.type === type && asset.level === 1);
    return [type, instances.reduce((sum, asset) => sum + asset.bounds.height, 0) / instances.length];
  }));
  const wizardReferenceHeight = 1.89845 * (1.13 * 0.75);
  if (visualHeights["green-archer"] < wizardReferenceHeight * 0.93 || visualHeights["green-archer"] > wizardReferenceHeight * 0.96
    || visualHeights.battlemage < wizardReferenceHeight * 0.97 || visualHeights.battlemage > wizardReferenceHeight * 1.02
    || visualHeights.sovereign < wizardReferenceHeight * 1.07 || visualHeights.sovereign > wizardReferenceHeight * 1.12) {
    throw new Error(`Defender visual heights are not roster-normalized: ${JSON.stringify(visualHeights)}`);
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
  const selectedSovereignVisual = newTypeInstances.findLast((asset) => asset.id === visualState.placedIds[24]);
  if (!selectedSovereignVisual || result.selection.markerPosition.y <= selectedSovereignVisual.bounds.maxY + 0.2) {
    throw new Error(`Selection diamond intersects the Sovereign model: ${JSON.stringify({ selection: result.selection, visual: selectedSovereignVisual })}`);
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
  const touch = async (type, points = []) => command("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map(({ x, y, id }) => ({ x, y, id, radiusX: 2, radiusY: 2, force: 1 })),
    modifiers: 0,
  });
  const tap = async (x, y, id = 1) => {
    await touch("touchStart", [{ x, y, id }]);
    await delay(50);
    await touch("touchEnd");
    await delay(100);
  };
  // Verify the reset choices against a populated run, then restart before touch input tests.
  await evaluate(`(() => {
    const game = window.__towerDefenceGameState;
    game.autoRun = true;
    if (!game.waveActive) game.startWave();
    document.querySelector('#reset-menu-button').click();
  })()`);
  const resetDialog = await evaluate(`(() => {
    const dialog = document.querySelector('#reset-confirmation');
    const canvas = document.querySelector('#game3d').getBoundingClientRect();
    const hit = document.elementFromPoint(canvas.left + canvas.width / 2, canvas.top + canvas.height / 2);
    return {
      visible: !dialog.hidden,
      title: dialog.querySelector('h2').textContent.trim(),
      body: dialog.querySelector('p').textContent.trim(),
      actions: [...dialog.querySelectorAll('button')].map((button) => button.textContent.trim()),
      blocksBattlefield: !!hit?.closest('#reset-confirmation'),
    };
  })()`);
  const resetBeforeCancel = await evaluate(`(() => {
    const game = window.__towerDefenceGameState;
    return { wave: game.currentWave, active: game.waveActive, enemies: game.enemiesRemaining, gold: game.gold, lives: game.lives, towers: game.towers.length, auto: game.autoRun };
  })()`);
  await delay(700);
  const resetWhileOpen = await evaluate(`(() => {
    const game = window.__towerDefenceGameState;
    return { wave: game.currentWave, active: game.waveActive, enemies: game.enemiesRemaining, gold: game.gold, lives: game.lives, towers: game.towers.length, auto: game.autoRun };
  })()`);
  if (!resetDialog.visible || resetDialog.title !== 'RESET RUN?' || resetDialog.body !== 'What would you like to do?'
    || resetDialog.actions.join('|') !== 'RESTART CURRENT MAP|RETURN TO MAP SELECT|CANCEL' || !resetDialog.blocksBattlefield
    || JSON.stringify(resetBeforeCancel) !== JSON.stringify(resetWhileOpen)) {
    throw new Error(`Reset menu failed to pause/block the run or show its three choices: ${JSON.stringify({ resetDialog, resetBeforeCancel, resetWhileOpen })}`);
  }
  await evaluate("document.querySelector('#cancel-reset-button').click()");
  const afterCancel = await evaluate(`(() => {
    const game = window.__towerDefenceGameState;
    return { hidden: document.querySelector('#reset-confirmation').hidden, wave: game.currentWave, active: game.waveActive, gold: game.gold, lives: game.lives, towers: game.towers.length, auto: game.autoRun };
  })()`);
  if (!afterCancel.hidden || JSON.stringify({ wave: afterCancel.wave, active: afterCancel.active, gold: afterCancel.gold, lives: afterCancel.lives, towers: afterCancel.towers, auto: afterCancel.auto })
    !== JSON.stringify({ wave: resetBeforeCancel.wave, active: resetBeforeCancel.active, gold: resetBeforeCancel.gold, lives: resetBeforeCancel.lives, towers: resetBeforeCancel.towers, auto: resetBeforeCancel.auto })) {
    throw new Error(`Cancel changed the run instead of restoring it: ${JSON.stringify({ resetBeforeCancel, afterCancel })}`);
  }
  await evaluate(`(() => {
    document.querySelector('#reset-menu-button').click();
    document.querySelector('#confirm-reset-button').click();
  })()`);
  await delay(180);
  const resetRunState = await evaluate(`(() => {
    const game = window.__towerDefenceGameState;
    return { mapId: game.map.id, gold: game.gold, startingGold: game.map.startingGold, lives: game.lives, wave: game.currentWave, active: game.waveActive, enemies: game.enemies.length, towers: game.towers.length, auto: game.autoRun };
  })()`);
  if (resetRunState.mapId !== 'single-spawn' || resetRunState.gold !== resetRunState.startingGold || resetRunState.lives !== 10
    || resetRunState.wave !== 1 || resetRunState.active || resetRunState.enemies !== 0 || resetRunState.towers !== 0 || resetRunState.auto) {
    throw new Error(`Restart Current Map did not reset the same run: ${JSON.stringify(resetRunState)}`);
  }
  const inputCandidate = await evaluate(`(() => {
    const game = window.__towerDefenceGameState;
    const ui = window.__towerDefenceUi;
    game.gold = Math.max(game.gold, 5000);
    ui.chooseBuildUnit('blue-wizard');
    const canvas = document.querySelector('#game3d').getBoundingClientRect();
    const topHud = document.querySelector('.top-hud-bar').getBoundingClientRect();
    const bottomHud = document.querySelector('.bottom-hud-bar').getBoundingClientRect();
    let firstBuildable;
    let firstProjected;
    const placementResults = {};
    for (let y = 0; y < game.grid.height; y += 1) for (let x = 0; x < game.grid.width; x += 1) {
      const cell = { x, y };
      const result = game.canPlaceBasicTower(cell, 'blue-wizard');
      placementResults[result] = (placementResults[result] ?? 0) + 1;
      if (result !== 'placed') continue;
      firstBuildable ??= cell;
      const point = ui.projectCell(cell);
      firstProjected ??= { cell, ...point };
      if (point.x > canvas.left + 15 && point.x < canvas.right - 15
        && point.y > topHud.bottom + 12 && point.y < bottomHud.top - 12) return { cell, ...point, canvas: { left: canvas.left, right: canvas.right, top: canvas.top, bottom: canvas.bottom }, topHud: { bottom: topHud.bottom }, bottomHud: { top: bottomHud.top } };
    }
    return { diagnostic: true, firstBuildable, firstProjected, placementResults, gold: game.gold, gameOver: game.gameOver, canvas: { left: canvas.left, right: canvas.right, top: canvas.top, bottom: canvas.bottom, width: canvas.width, height: canvas.height }, topHud: { bottom: topHud.bottom }, bottomHud: { top: bottomHud.top }, grid: { width: game.grid.width, height: game.grid.height } };
  })()`);
  if (inputCandidate.diagnostic) throw new Error(`Could not find an unobstructed buildable cell for touch input smoke test: ${JSON.stringify(inputCandidate)}`);
  const towerCountBeforeTouch = await evaluate("window.__towerDefenceGameState.towers.length");
  await tap(inputCandidate.x, inputCandidate.y);
  const tapPlacement = await evaluate(`({
    towerCount: window.__towerDefenceGameState.towers.length,
    state: window.__towerDefenceInputDebug(),
  })`);
  if (tapPlacement.towerCount !== towerCountBeforeTouch + 1 || !tapPlacement.state.lastAction.includes("placed")) {
    throw new Error(`Mobile tap failed to place a defender: ${JSON.stringify(tapPlacement)}`);
  }
  await tap(inputCandidate.x, inputCandidate.y);
  const towerSelection = await evaluate("window.__towerDefenceUi.selectionVisual()");
  if (towerSelection.selectedTowerId === undefined) {
    throw new Error(`Mobile tap failed to select the occupied tower: ${JSON.stringify(towerSelection)}`);
  }
  const towerCountBeforeCancel = await evaluate("window.__towerDefenceGameState.towers.length");
  await touch("touchStart", [{ x: inputCandidate.x, y: inputCandidate.y, id: 1 }]);
  await delay(40);
  await touch("touchCancel");
  await delay(80);
  const cancelResult = await evaluate(`({
    towerCount: window.__towerDefenceGameState.towers.length,
    selectedTowerId: window.__towerDefenceUi.selectionVisual().selectedTowerId,
    state: window.__towerDefenceInputDebug(),
  })`);
  if (cancelResult.towerCount !== towerCountBeforeCancel || cancelResult.selectedTowerId !== towerSelection.selectedTowerId
    || !cancelResult.state.lastAction.includes("cancelled")) {
    throw new Error(`Cancelled touch was incorrectly treated as a tap: ${JSON.stringify(cancelResult)}`);
  }
  const cameraBeforePan = await evaluate("window.__towerDefenceInputDebug().cameraTarget");
  const towersBeforePan = await evaluate("window.__towerDefenceGameState.towers.length");
  await touch("touchStart", [{ x: inputCandidate.x, y: inputCandidate.y, id: 1 }]);
  await delay(60);
  await touch("touchMove", [{ x: inputCandidate.x + 70, y: inputCandidate.y + 8, id: 1 }]);
  await delay(60);
  await touch("touchEnd");
  await delay(100);
  const panResult = await evaluate(`({
    state: window.__towerDefenceInputDebug(),
    towers: window.__towerDefenceGameState.towers.length,
  })`);
  const panDistance = Math.hypot(panResult.state.cameraTarget.x - cameraBeforePan.x, panResult.state.cameraTarget.z - cameraBeforePan.z);
  if (panDistance < 0.01 || panResult.towers !== towersBeforePan || panResult.state.gesture !== "PAN") {
    throw new Error(`One-finger drag failed or placed a defender: ${JSON.stringify({ panDistance, panResult })}`);
  }
  const pinchStart = await evaluate("({ x: innerWidth / 2, y: (document.querySelector('.top-hud-bar').getBoundingClientRect().bottom + document.querySelector('.bottom-hud-bar').getBoundingClientRect().top) / 2 })");
  const radiusBeforePinch = await evaluate("window.__towerDefenceInputDebug().cameraRadius");
  await touch("touchStart", [{ x: pinchStart.x - 35, y: pinchStart.y, id: 1 }]);
  await delay(40);
  await touch("touchStart", [{ x: pinchStart.x - 35, y: pinchStart.y, id: 1 }, { x: pinchStart.x + 35, y: pinchStart.y, id: 2 }]);
  await delay(60);
  await touch("touchMove", [{ x: pinchStart.x - 60, y: pinchStart.y, id: 1 }, { x: pinchStart.x + 60, y: pinchStart.y, id: 2 }]);
  await delay(60);
  await touch("touchEnd");
  await delay(100);
  const pinchResult = await evaluate(`({ state: window.__towerDefenceInputDebug(), towers: window.__towerDefenceGameState.towers.length })`);
  if (Math.abs(pinchResult.state.cameraRadius - radiusBeforePinch) < 0.01
    || pinchResult.towers !== towersBeforePan || pinchResult.state.gesture !== "PINCH") {
    throw new Error(`Two-finger pinch failed or placed a defender: ${JSON.stringify({ radiusBeforePinch, pinchResult })}`);
  }
  const trayBeforeSwipe = await evaluate(`(() => {
    const tray = document.querySelector('.defender-choice-panel');
    tray.scrollLeft = 0;
    const rect = tray.getBoundingClientRect();
    return { x: rect.right - 15, y: rect.top + rect.height / 2 };
  })()`);
  const cameraBeforeTraySwipe = await evaluate("window.__towerDefenceInputDebug().cameraTarget");
  await touch("touchStart", [{ x: trayBeforeSwipe.x, y: trayBeforeSwipe.y, id: 1 }]);
  await delay(60);
  await touch("touchMove", [{ x: trayBeforeSwipe.x - 120, y: trayBeforeSwipe.y, id: 1 }]);
  await delay(100);
  await touch("touchEnd");
  await delay(120);
  const traySwipe = await evaluate(`({
    scrollLeft: document.querySelector('.defender-choice-panel').scrollLeft,
    touchAction: getComputedStyle(document.querySelector('.defender-choice-panel')).touchAction,
    cameraTarget: window.__towerDefenceInputDebug().cameraTarget,
  })`);
  if (traySwipe.scrollLeft <= 0 || traySwipe.touchAction !== "pan-x"
    || Math.hypot(traySwipe.cameraTarget.x - cameraBeforeTraySwipe.x, traySwipe.cameraTarget.z - cameraBeforeTraySwipe.z) > 0.01) {
    throw new Error(`Build Units swipe did not stay isolated to the horizontal tray: ${JSON.stringify(traySwipe)}`);
  }
  const knightButton = await evaluate(`(() => {
    const button = document.querySelector('#build-knight-button').getBoundingClientRect();
    return { x: button.left + button.width / 2, y: button.top + button.height / 2 };
  })()`);
  await tap(knightButton.x, knightButton.y);
  const buildCardTap = await evaluate(`({
    pressed: document.querySelector('#build-knight-button').getAttribute('aria-pressed'),
    buildMode: window.__towerDefenceInputDebug().buildMode,
  })`);
  if (buildCardTap.pressed !== "true" || !buildCardTap.buildMode.includes("holy-knight")) {
    throw new Error(`Build Unit card touch did not select Knight: ${JSON.stringify(buildCardTap)}`);
  }
  const buttonTouchPoint = async (selector) => evaluate(`(() => {
    const rect = document.querySelector('${selector}').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  const autoPoint = await buttonTouchPoint("#auto-button");
  await tap(autoPoint.x, autoPoint.y);
  const autoToggledOn = await evaluate("window.__towerDefenceGameState.autoRun");
  await tap(autoPoint.x, autoPoint.y);
  const autoToggledOff = await evaluate("!window.__towerDefenceGameState.autoRun");
  const wavePoint = await buttonTouchPoint("#start-wave-button");
  await tap(wavePoint.x, wavePoint.y);
  const waveStarted = await evaluate("window.__towerDefenceGameState.waveActive");
  if (!autoToggledOn || !autoToggledOff || !waveStarted) {
    throw new Error(`Mobile HUD button taps failed: ${JSON.stringify({ autoToggledOn, autoToggledOff, waveStarted })}`);
  }
  await command("Emulation.setTouchEmulationEnabled", { enabled: false });
  await command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const desktopProbe = await evaluate(`(() => {
    const canvas = document.querySelector('#game3d').getBoundingClientRect();
    return { x: canvas.left + canvas.width / 2, y: canvas.top + canvas.height / 2 };
  })()`);
  const desktopTargetBeforePan = await evaluate("window.__towerDefenceInputDebug().cameraTarget");
  const desktopTowersBeforePan = await evaluate("window.__towerDefenceGameState.towers.length");
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: desktopProbe.x, y: desktopProbe.y, button: "left", buttons: 1, clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: desktopProbe.x + 50, y: desktopProbe.y + 4, button: "left", buttons: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: desktopProbe.x + 50, y: desktopProbe.y + 4, button: "left", buttons: 0, clickCount: 1 });
  await delay(100);
  const desktopPan = await evaluate("window.__towerDefenceInputDebug()");
  const desktopPanDistance = Math.hypot(
    desktopPan.cameraTarget.x - desktopTargetBeforePan.x,
    desktopPan.cameraTarget.z - desktopTargetBeforePan.z,
  );
  if (desktopPanDistance < 0.01 || await evaluate("window.__towerDefenceGameState.towers.length") !== desktopTowersBeforePan
    || desktopPan.gesture !== "PAN") {
    throw new Error(`Desktop mouse-pan regression failed: ${JSON.stringify({ desktopPanDistance, desktopPan })}`);
  }
  const mobileInput = {
    tapPlacement: tapPlacement.state.lastAction,
    towerSelection: towerSelection.selectedTowerId,
    pointerCancel: { noPlacement: cancelResult.towerCount === towerCountBeforeCancel, selectionPreserved: cancelResult.selectedTowerId === towerSelection.selectedTowerId },
    pan: { distance: Number(panDistance.toFixed(2)), action: panResult.state.lastAction, towersUnchanged: panResult.towers === towersBeforePan },
    pinch: { radiusBefore: radiusBeforePinch, radiusAfter: pinchResult.state.cameraRadius, action: pinchResult.state.lastAction, towersUnchanged: pinchResult.towers === towersBeforePan },
    traySwipe: { scrollLeft: traySwipe.scrollLeft, touchAction: traySwipe.touchAction, cameraUnchanged: true },
    buildCardTap, autoToggledOn, autoToggledOff, waveStarted,
    desktopMousePan: { distance: Number(desktopPanDistance.toFixed(2)), action: desktopPan.lastAction, towersUnchanged: true },
  };
  const inputSurfaceAudit = await evaluate(`(() => {
    const canvas = document.querySelector('#game3d');
    const rect = canvas.getBoundingClientRect();
    return {
      canvasTouchAction: getComputedStyle(canvas).touchAction,
      trayTouchAction: getComputedStyle(document.querySelector('.defender-choice-panel')).touchAction,
      buttonTouchAction: getComputedStyle(document.querySelector('#auto-button')).touchAction,
      gameUiPointerEvents: getComputedStyle(document.querySelector('.game-ui')).pointerEvents,
      appCornerOverlayPointerEvents: getComputedStyle(document.querySelector('#app'), '::before').pointerEvents,
      battlefieldHitTarget: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2).id,
      resetOverlayHidden: document.querySelector('#reset-confirmation').hidden,
    };
  })()`);
  if (inputSurfaceAudit.canvasTouchAction !== "none" || inputSurfaceAudit.trayTouchAction !== "pan-x"
    || inputSurfaceAudit.buttonTouchAction !== "manipulation" || inputSurfaceAudit.gameUiPointerEvents !== "none"
    || inputSurfaceAudit.appCornerOverlayPointerEvents !== "none" || inputSurfaceAudit.battlefieldHitTarget !== "game3d"
    || !inputSurfaceAudit.resetOverlayHidden) {
    throw new Error(`Battlefield/UI pointer-event layers are misconfigured: ${JSON.stringify(inputSurfaceAudit)}`);
  }
  await evaluate(`(() => {
    window.__towerDefenceGameState.autoRun = true;
    document.querySelector('#reset-menu-button').click();
    document.querySelector('#return-map-select-button').click();
  })()`);
  let returnedToMapSelect = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    returnedToMapSelect = await evaluate(`(() => !!document.querySelector('.map-select-screen')
      && !document.querySelector('#game3d') && !window.__towerDefenceGameState)()`);
    if (returnedToMapSelect) break;
    await delay(50);
  }
  const mapSelectAfterReturn = await evaluate(`(() => ({
    selectedMap: document.querySelector('.map-choice-card.is-selected')?.dataset.mapId,
    startEnabled: !document.querySelector('#start-selected-map').disabled,
    canvasCount: document.querySelectorAll('#game3d').length,
    gameStateAvailable: !!window.__towerDefenceGameState,
  }))()`);
  if (!returnedToMapSelect || mapSelectAfterReturn.selectedMap !== "single-spawn"
    || !mapSelectAfterReturn.startEnabled || mapSelectAfterReturn.canvasCount !== 0 || mapSelectAfterReturn.gameStateAvailable) {
    throw new Error(`Return to Map Select did not cleanly end the run: ${JSON.stringify({ returnedToMapSelect, mapSelectAfterReturn })}`);
  }
  await evaluate(`(() => {
    document.querySelector('.map-choice-card[data-map-id="three-spawns"]').click();
  })()`);
  await delay(300);
  const awaitingExplicitStart = await evaluate(`(() => ({
    selectedMap: document.querySelector('.map-choice-card.is-selected')?.dataset.mapId,
    startEnabled: !document.querySelector('#start-selected-map').disabled,
    canvasCount: document.querySelectorAll('#game3d').length,
    gameStateAvailable: !!window.__towerDefenceGameState,
  }))()`);
  if (awaitingExplicitStart.selectedMap !== "three-spawns" || !awaitingExplicitStart.startEnabled
    || awaitingExplicitStart.canvasCount !== 0 || awaitingExplicitStart.gameStateAvailable) {
    throw new Error(`Returning to the map selector unexpectedly started a run: ${JSON.stringify(awaitingExplicitStart)}`);
  }
  await evaluate("document.querySelector('#start-selected-map').click()");
  let newMapRunReady = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    newMapRunReady = await evaluate(`(() => !!window.__towerDefenceGameState
      && window.__towerDefenceGameState.map.id === "three-spawns")()`);
    if (newMapRunReady) break;
    await delay(100);
  }
  const restartedMapState = await evaluate(`(() => ({
    mapId: window.__towerDefenceGameState?.map.id,
    wave: window.__towerDefenceGameState?.currentWave,
    active: window.__towerDefenceGameState?.waveActive,
    auto: window.__towerDefenceGameState?.autoRun,
    canvasCount: document.querySelectorAll('#game3d').length,
  }))()`);
  if (!newMapRunReady || restartedMapState.mapId !== "three-spawns" || restartedMapState.wave !== 1
    || restartedMapState.active || restartedMapState.auto || restartedMapState.canvasCount !== 1) {
    throw new Error(`Starting a newly selected map after returning failed: ${JSON.stringify(restartedMapState)}`);
  }
  const resetNavigation = { returnedToMapSelect, mapSelectAfterReturn, awaitingExplicitStart, restartedMapState };
  if (process.env.SAVE_COMPACT_HUD_SCREENSHOTS === "1") {
    const screenshotDirectory = path.resolve(__dirname, "../artifacts/compact-hud");
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    await command("Page.navigate", { url: appUrl });
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
    mapSelectLayouts: responsiveLayouts,
    defenderVisualHeights: visualHeights,
    gameHudLayouts: layouts.map(({ viewport, hudHeight, card, visibleCards, trayScrollable, actionsVisible, waveControls, towerLayouts }) => ({
      viewport, hudHeight, card, visibleCards, trayScrollable, actionsVisible, waveControls,
      towerLayouts: towerLayouts.map(({ type, level, panel, stats, actions, upgrade, info, sell, upgradeClip, sellClip }) => ({
        type, level, panel, stats, actions, upgrade, info, sell, upgradeClip, sellClip,
      })),
    })),
    futureUnitHudHeight, screenshots, runtimeFilesServed: paths.length,
    mobileInput,
    inputSurfaceAudit,
    resetNavigation,
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
