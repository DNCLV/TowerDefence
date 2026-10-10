// Runtime integration check for optimized new enemy/defender GLBs and build-info UI.
// Start `npm run dev -- --host 127.0.0.1` first.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const runtimeAssetManifest = require("./runtime-asset-manifest.json");
const expectedDefenderPaths = {
  "green-archer": "/assets/models/defenders/optimized/green-archer.glb",
  battlemage: "/assets/models/defenders/optimized/battlemage.glb",
  sovereign: "/assets/models/defenders/optimized/sovereign.glb",
  "holy-emperor": "/assets/models/defenders/optimized/holy-emperor.glb",
  treant: "/assets/models/defenders/optimized/treant.glb",
  "thorn-owl": "/assets/models/defenders/optimized/thorn-owl.glb",
  druid: "/assets/models/defenders/optimized/druid.glb",
  seer: "/assets/models/defenders/optimized/seer.glb",
  "bark-titan": "/assets/models/defenders/optimized/bark-titan.glb",
  "thorn-dancer": "/assets/models/defenders/optimized/thorn-dancer.glb",
};
const expectedDedicatedGrovePortraits = {
  "bark-titan": "/assets/ui/defenders/bark-titan.png",
  "thorn-dancer": "/assets/ui/defenders/thorn-dancer.png",
};
const expectedMapPreviews = {
  "single-spawn": "/assets/ui/map-previews/open-field.png",
  "two-spawns": "/assets/ui/map-previews/split-advance.png",
  "three-spawns": "/assets/ui/map-previews/triple-convergence.png",
};
const expectedQuaterniusNatureAssets = [
  "forest-quaternius-common-tree", "forest-quaternius-pine",
  "forest-quaternius-bush", "forest-quaternius-flower-bush",
  "forest-quaternius-rock-1", "forest-quaternius-rock-2", "forest-quaternius-rock-3",
];
const groveImportedTypes = ["treant", "thorn-owl", "druid", "seer", "bark-titan", "thorn-dancer"];
const groveRosterTypes = ["treant", "thorn-owl", "druid", "seer", "bark-titan", "thorn-dancer"];
const royalImportedTypes = ["green-archer", "battlemage", "sovereign", "holy-emperor"];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "td-content-assets-"));
const appUrl = process.env.TD_TEST_URL ?? "http://127.0.0.1:5173/";
const cdpTimeoutMs = Number(process.env.TD_CDP_TIMEOUT_MS ?? 45000);
const pending = new Map();
const browserErrors = [];
const mapReviewScreenshots = [];
let chrome;
let ownsChrome = false;
let socket;
let nextId = 0;

async function command(method, params = {}) {
  const id = ++nextId;
  const response = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP timeout after ${cdpTimeoutMs} ms: ${method}`)), cdpTimeoutMs);
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

async function waitForGroundEnemyBounds() {
  const expectedTypes = ["goblin", "goblinBrute", "ghoul", "wraith", "giantGoblin", "skeletonKing"];
  const deadline = Date.now() + 30000;
  let latest;
  while (Date.now() < deadline) {
    latest = await evaluate(`(() => {
      const expectedTypes = ${JSON.stringify(expectedTypes)};
      const instances = window.__enemyVisualInstances ?? [];
      const byType = Object.fromEntries(expectedTypes.map((type) => [type, instances.find((asset) => asset.type === type)]));
      return {
        ready: expectedTypes.every((type) => Boolean(byType[type])),
        instances: expectedTypes.map((type) => byType[type] ?? { type, status: "not-created" }),
        templates: (window.__enemyTemplateAudit ?? []).filter((asset) => expectedTypes.includes(asset.type)),
        loadAudit: (window.__enemyVisualAudit ?? []).filter((asset) => expectedTypes.includes(asset.type)).slice(-12),
        activeTypes: [...new Set((window.__towerDefenceGameState?.enemies ?? []).map((enemy) => enemy.type))],
      };
    })()`);
    if (latest.ready) return latest.instances;
    await delay(100);
  }
  throw new Error(`Enemy bounds unavailable after progressive visual load: ${JSON.stringify(latest)}`);
}

async function waitForChromePages(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (chrome?.exitCode !== null && chrome?.exitCode !== undefined) {
      throw new Error(`Headless Chrome exited before DevTools became ready (code ${chrome.exitCode}).`);
    }
    try {
      const response = await fetch("http://127.0.0.1:9255/json");
      if (response.ok) return await response.json();
      lastError = new Error(`Chrome DevTools returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Headless Chrome DevTools did not become ready within ${timeoutMs} ms: ${lastError?.message ?? "unknown error"}`);
}

function getManifestAssetPaths() {
  const paths = new Set();
  const pending = Object.values(runtimeAssetManifest.groups).flat();
  while (pending.length) {
    const asset = pending.pop().replaceAll("\\", "/");
    if (paths.has(asset)) continue;
    paths.add(asset);
    const absolute = path.join(__dirname, "..", "public", asset);
    if (!/\.(gltf|glb)$/i.test(asset)) continue;
    const bytes = fs.readFileSync(absolute);
    let json;
    if (asset.toLowerCase().endsWith(".gltf")) json = JSON.parse(bytes.toString("utf8"));
    else {
      for (let offset = 12; offset + 8 <= bytes.length;) {
        const length = bytes.readUInt32LE(offset);
        const type = bytes.readUInt32LE(offset + 4);
        if (type === 0x4e4f534a) json = JSON.parse(bytes.toString("utf8", offset + 8, offset + 8 + length).trim());
        offset += 8 + length;
      }
    }
    for (const entry of [...(json?.buffers ?? []), ...(json?.images ?? [])]) {
      const uri = entry.uri;
      if (!uri || uri.startsWith("data:") || /^[a-z]+:/i.test(uri) || uri.startsWith("/")) continue;
      pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(asset), decodeURIComponent(uri.split("?")[0]))));
    }
  }
  return [...paths].map((asset) => `/${asset}`);
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const groveManifest = new Set(runtimeAssetManifest.groups.ancientGroveDefenders);
  const uiManifest = new Set(runtimeAssetManifest.groups.ui);
  for (const [type, runtimePath] of Object.entries({
    "bark-titan": expectedDefenderPaths["bark-titan"],
    "thorn-dancer": expectedDefenderPaths["thorn-dancer"],
  })) {
    const relative = runtimePath.replace(/^\//, "");
    if (!groveManifest.has(relative) || !fs.existsSync(path.join(repoRoot, "public", relative))) {
      throw new Error(`${type} dedicated runtime GLB is missing from the Ancient Grove manifest or public assets: ${runtimePath}`);
    }
  }
  if (expectedDefenderPaths["bark-titan"] === expectedDefenderPaths.treant
    || expectedDefenderPaths["thorn-dancer"] === expectedDefenderPaths.seer) {
    throw new Error("Bark Titan and Thorn Dancer must not resolve to the temporary Treant/Seer GLBs.");
  }
  for (const [type, portraitPath] of Object.entries(expectedDedicatedGrovePortraits)) {
    const relative = portraitPath.replace(/^\//, "");
    if (!uiManifest.has(relative) || !fs.existsSync(path.join(repoRoot, "public", relative))) {
      throw new Error(`${type} dedicated portrait is missing from the UI manifest or public assets: ${portraitPath}`);
    }
  }
  for (const [mapId, previewPath] of Object.entries(expectedMapPreviews)) {
    const relative = previewPath.replace(/^\//, "");
    if (!uiManifest.has(relative) || !fs.existsSync(path.join(repoRoot, "public", relative))) {
      throw new Error(`${mapId} preview is missing from the UI manifest or public assets: ${previewPath}`);
    }
  }
  const runtimeSources = [
    "src/game/rendering3d/DefenderVisualConfig.ts",
    "src/game/rendering3d/QuaterniusDefenderFactory.ts",
    "src/main.ts",
  ].map((relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8"));
  if (runtimeSources.some((source) => /(?:[A-Za-z]:[\\/]|["'`]\/?3D[\\/])/i.test(source))) {
    throw new Error("Runtime source must not reference source-only 3D/ assets or absolute filesystem paths.");
  }
  const paths = getManifestAssetPaths();
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
    pages = await waitForChromePages();
  }
  socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown" || message.method === "Runtime.consoleAPICalled" || message.method === "Log.entryAdded"
      || message.method === "Network.loadingFailed") browserErrors.push(message);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message.result || message.error); pending.delete(message.id); }
  });
  await command("Runtime.enable");
  await command("Log.enable");
  await command("Network.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await command("Emulation.setTouchEmulationEnabled", { enabled: true, configuration: "mobile" });
  await command("Page.navigate", { url: `${appUrl}?waveDebug=1&inputDebug=1&minimapDebug=1&defenderVisualDebug=1&enemyVisualDebug=1&enemyGroundDebug=1&terrainArtDebug=1` });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await evaluate("document.querySelectorAll('.map-mode-card').length === 2 && document.querySelectorAll('.map-choice-card').length === 0");
    if (ready) break;
    if (attempt === 99) {
      const pageState = await evaluate(`({ url: location.href, title: document.title, body: document.body.innerText.slice(0, 800), app: document.querySelector('#app')?.innerHTML.slice(0, 800) })`);
      throw new Error(`Mode Select screen did not load two mode choices: ${JSON.stringify({ pageState, browserErrors })}`);
    }
    await delay(100);
  }
  const bootTiming = await evaluate(`(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const shell = performance.getEntriesByName('tower-defence-app-shell-ready')[0];
    return navigation ? {
      responseStartMs: Math.round(navigation.responseStart),
      domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
      appShellReadyMs: shell ? Math.round(shell.startTime) : null,
    } : null;
  })()`);
  const modeLayouts = [];
  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 1365, height: 900 }]) {
    await command("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: viewport.width < 500 });
    modeLayouts.push(await evaluate(`(() => {
      const app = document.querySelector('#app').getBoundingClientRect();
      const grid = document.querySelector('.map-mode-grid');
      const cards = [...document.querySelectorAll('.map-mode-card')].map((card) => {
        const rect = card.getBoundingClientRect();
        return { width: rect.width, height: rect.height, left: rect.left, right: rect.right, bottom: rect.bottom };
      });
      return {
        viewport: [${viewport.width}, ${viewport.height}],
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        mapCardCount: document.querySelectorAll('.map-choice-card').length,
        modeCount: cards.length,
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        cards,
        textFits: document.querySelector('#map-select-title').scrollWidth <= document.querySelector('#map-select-title').clientWidth
          && [...document.querySelectorAll('.map-mode-copy > *')].every((node) => {
            const text = node.getBoundingClientRect();
            const card = node.closest('.map-mode-card').getBoundingClientRect();
            return node.scrollWidth <= node.clientWidth && text.left >= card.left && text.right <= card.right;
          }),
        allVisible: cards.every((card) => card.width > 0 && card.height >= 44 && card.left >= app.left && card.right <= app.right && card.bottom <= app.bottom),
      };
    })()`));
  }
  if (modeLayouts.some((layout) => layout.pageWidth > layout.viewportWidth || layout.mapCardCount !== 0 || layout.modeCount !== 2 || !layout.allVisible || !layout.textFits)
    || modeLayouts[0].columns !== 1 || modeLayouts[1].columns !== 1 || modeLayouts[2].columns !== 2) {
    throw new Error(`Mode Select responsive layout failed: ${JSON.stringify(modeLayouts)}`);
  }
  await evaluate("document.querySelector('[data-map-mode=\"single-player\"]').click()");
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
        textFits: [...document.querySelectorAll('.map-choice-copy')].every((node) => node.scrollWidth <= node.clientWidth + 1),
        cardStability: { maxCardShift, cardScrollStable, before: stableBefore, after: stableAfter },
      };
    })()`));
  }
  if (responsiveLayouts.some((layout) => layout.pageWidth > layout.viewportWidth || !layout.titleVisible || !layout.selectedCardVisible || !layout.startVisible || !layout.textFits
    || layout.cardStability.maxCardShift > 0.5 || !layout.cardStability.cardScrollStable)
    || responsiveLayouts[0].gridFlow !== "column" || !responsiveLayouts[0].hasHorizontalCarousel || responsiveLayouts[0].cardWidth < 240
    || responsiveLayouts[1].gridFlow !== "column" || !responsiveLayouts[1].hasHorizontalCarousel || responsiveLayouts[1].cardWidth < 240
    || responsiveLayouts[2].gridFlow !== "row" || responsiveLayouts[2].hasHorizontalCarousel || responsiveLayouts[2].cardWidth >= responsiveLayouts[2].appWidth / 2) {
    throw new Error(`Choose Map responsive layout failed: ${JSON.stringify(responsiveLayouts)}`);
  }
  if (process.env.SAVE_THREE_SPAWN_LAYOUT_SCREENSHOTS === "1") {
    await command("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.querySelector('.map-choice-card[data-map-id="three-spawns"]').click()`);
    await delay(250);
    const screenshotDirectory = path.resolve(__dirname, "../artifacts/three-spawn-layout");
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
    const fileName = "map-select-preview.png";
    fs.writeFileSync(path.join(screenshotDirectory, fileName), Buffer.from(screenshot.data, "base64"));
    mapReviewScreenshots.push(path.join(screenshotDirectory, fileName));
    await evaluate(`document.querySelector('.map-choice-card[data-map-id="single-spawn"]').click()`);
  }
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mapSelection = await evaluate(`(() => {
    const continueButton = document.querySelector('#start-selected-map');
    const minimapAbsentBeforeStarting = !document.querySelector('#minimap-panel') && !document.querySelector('#game-minimap');
    if (continueButton.disabled) throw new Error('CONTINUE should be enabled for the preselected first map');
    const first = document.querySelector('.map-choice-card[data-map-id="single-spawn"]');
    if (first.getAttribute('aria-pressed') !== 'true') throw new Error('1 Spawn should be selected by default');
    const checks = [...document.querySelectorAll('.map-choice-card')].map((card) => {
      card.click();
      return { id: card.dataset.mapId, selected: card.getAttribute('aria-pressed') === 'true', canStart: !continueButton.disabled };
    });
    document.querySelector('.map-choice-card[data-map-id="single-spawn"]').click();
    return {
      checks,
      minimapAbsentBeforeStarting,
      eyebrow: document.querySelector('.map-select-eyebrow')?.textContent.trim(),
      defaultMap: first.dataset.mapId,
      continueText: continueButton.textContent.trim(),
      mapNames: [...document.querySelectorAll('.map-choice-card .map-choice-copy strong')].map((node) => node.textContent.trim()),
      startingGolds: [...document.querySelectorAll('.map-choice-card .map-economy')].map((node) => Number(node.textContent.trim().split(' ').find((part) => Number.isFinite(Number(part))))),
      previews: [...document.querySelectorAll('.map-preview')].map((preview) => {
        const image = preview.querySelector('.map-preview-artwork');
        return {
          mapId: preview.dataset.previewMap,
          type: preview.dataset.previewType,
          source: image?.getAttribute('src'),
          loaded: Boolean(image?.complete && image.naturalWidth === 432 && image.naturalHeight === 576),
          hasSchematic: preview.querySelector('svg') !== null,
          visible: image ? (() => {
            const rect = image.getBoundingClientRect();
            const style = getComputedStyle(image);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
          })() : false,
        };
      }),
    };
  })()`);
  if (mapSelection.checks.length !== 3 || mapSelection.checks.some((choice) => !choice.selected || !choice.canStart)
    || !mapSelection.eyebrow?.startsWith("TOWER DEFENCE ·")
    || mapSelection.defaultMap !== "single-spawn"
    || mapSelection.continueText.replace(/\s+/g, " ").toUpperCase() !== "CONTINUE →"
    || !mapSelection.minimapAbsentBeforeStarting
    || JSON.stringify(mapSelection.mapNames) !== JSON.stringify(["Open Field", "Split Advance", "Triple Convergence"])
    || JSON.stringify(mapSelection.startingGolds) !== JSON.stringify([100, 135, 150])
    || mapSelection.previews.length !== 3
    || mapSelection.previews.some((preview) => !preview.visible || !preview.loaded || preview.type !== "static" || preview.hasSchematic)
    || JSON.stringify(mapSelection.previews.map(({ mapId }) => mapId)) !== JSON.stringify(Object.keys(expectedMapPreviews))
    || mapSelection.previews.some((preview) => !preview.source?.endsWith(expectedMapPreviews[preview.mapId]))) {
    throw new Error(`Map selection flow failed: ${JSON.stringify(mapSelection)}`);
  }
  const modeFlow = await evaluate(`(() => {
    document.querySelector('#back-to-mode-select').click();
    const initial = {
      eyebrow: document.querySelector('.map-select-eyebrow')?.textContent.trim(),
      modes: [...document.querySelectorAll('.map-mode-card')].map((card) => ({ id: card.dataset.mapMode, title: card.querySelector('strong').textContent.trim(), subtitle: card.querySelector('small').textContent.trim() })),
      maps: document.querySelectorAll('.map-choice-card').length,
      continueVisible: !!document.querySelector('#start-selected-map'),
    };
    document.querySelector('[data-map-mode="multiplayer"]').click();
    const multiplayer = {
      activeMode: document.querySelector('[data-active-map-mode]')?.dataset.activeMapMode,
      maps: [...document.querySelectorAll('.map-choice-card')].map((card) => card.dataset.mapId),
      selected: document.querySelector('.map-choice-card.is-selected')?.dataset.mapId,
      continueVisible: !!document.querySelector('#start-selected-map'),
      polishedPreview: document.querySelector('[data-preview-map="twin-bastion"] .map-preview-map-frame') !== null,
    };
    document.querySelector('#back-to-mode-select').click();
    const back = { modes: document.querySelectorAll('.map-mode-card').length, maps: document.querySelectorAll('.map-choice-card').length };
    document.querySelector('[data-map-mode="single-player"]').click();
    return {
      initial,
      multiplayer,
      back,
      restoredMode: document.querySelector('[data-active-map-mode]')?.dataset.activeMapMode,
      restoredMaps: [...document.querySelectorAll('.map-choice-card')].map((card) => card.dataset.mapId),
      restoredSelection: document.querySelector('.map-choice-card.is-selected')?.dataset.mapId,
    };
  })()`);
  if (JSON.stringify(modeFlow.initial.modes) !== JSON.stringify([
    { id: "single-player", title: "Single Player", subtitle: "Play solo" },
    { id: "multiplayer", title: "Multiplayer", subtitle: "Play co-op" },
  ]) || modeFlow.initial.eyebrow !== "TOWER DEFENCE · FIELD COMMAND" || modeFlow.initial.maps !== 0 || modeFlow.initial.continueVisible
    || modeFlow.multiplayer.activeMode !== "multiplayer" || JSON.stringify(modeFlow.multiplayer.maps) !== JSON.stringify(["twin-bastion"])
    || modeFlow.multiplayer.selected !== "twin-bastion" || !modeFlow.multiplayer.continueVisible || !modeFlow.multiplayer.polishedPreview
    || modeFlow.back.modes !== 2 || modeFlow.back.maps !== 0
    || modeFlow.restoredMode !== "single-player" || JSON.stringify(modeFlow.restoredMaps) !== JSON.stringify(["single-spawn", "two-spawns", "three-spawns"])
    || modeFlow.restoredSelection !== "single-spawn") {
    throw new Error(`Two-step mode flow failed: ${JSON.stringify(modeFlow)}`);
  }
  if (process.env.TD_MULTIPLAYER_ONLY === "1") {
    const reverseFactions = process.env.TD_MULTIPLAYER_REVERSE === "1";
    const playerOneFaction = reverseFactions ? "ancient-grove" : "arcane-kingdom";
    const playerTwoFaction = reverseFactions ? "arcane-kingdom" : "ancient-grove";
    await evaluate(`document.querySelector('#back-to-mode-select').click(); document.querySelector('[data-map-mode="multiplayer"]').click(); document.querySelector('.map-choice-card[data-map-id="twin-bastion"]').click()`);
    await evaluate("document.querySelector('#start-selected-map').click()");
    for (let attempt = 0; attempt < 50 && !(await evaluate("document.querySelector('#faction-select-title')?.textContent.includes('PLAYER 1')")); attempt += 1) await delay(100);
    await evaluate(`document.querySelector('[data-faction-id="${playerOneFaction}"]').click(); document.querySelector('#start-battlefield').click()`);
    for (let attempt = 0; attempt < 50 && !(await evaluate("document.querySelector('#faction-select-title')?.textContent.includes('PLAYER 2')")); attempt += 1) await delay(100);
    await evaluate(`document.querySelector('[data-faction-id="${playerTwoFaction}"]').click(); document.querySelector('#start-battlefield').click()`);
    let multiplayerReady = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      multiplayerReady = await evaluate("window.__towerDefenceGameState?.map.id === 'twin-bastion' && document.querySelectorAll('[data-player-id]').length === 2");
      if (multiplayerReady) break;
      await delay(150);
    }
    if (!multiplayerReady) throw new Error("Twin Bastion browser prototype did not initialize.");
    const multiplayer = await evaluate(`(() => {
      const game = window.__towerDefenceGameState;
      const before = { activePlayerId: game.activePlayerId, factionId: game.factionId, gold: game.gold };
      document.querySelector('[data-player-id="player-2"]').click();
      return {
        map: game.map.id,
        dimensions: [game.map.width, game.map.height],
        players: game.players.map(({ playerId, factionId, gold }) => ({ playerId, factionId, gold })),
        goals: game.goals.map(({ id, approachCell }) => ({ id, approachCell })),
        spawns: game.layout.activeSpawns.map(({ id, preferredGoalId }) => ({ id, preferredGoalId })),
        before,
        after: { activePlayerId: game.activePlayerId, factionId: game.factionId, gold: game.gold },
        playerButtons: [...document.querySelectorAll('[data-player-id]')].map((button) => ({ id: button.dataset.playerId, pressed: button.getAttribute('aria-pressed') })),
        minimap: { spawnCount: document.querySelector('#minimap-panel')?.dataset.spawnCount, goalCount: document.querySelector('#minimap-panel')?.dataset.goalCount },
      };
    })()`);
    if (multiplayer.map !== "twin-bastion" || JSON.stringify(multiplayer.dimensions) !== JSON.stringify([77, 80])
      || JSON.stringify(multiplayer.players) !== JSON.stringify([
        { playerId: "player-1", factionId: playerOneFaction, gold: 80 },
        { playerId: "player-2", factionId: playerTwoFaction, gold: 80 },
      ])
      || multiplayer.goals.length !== 2 || multiplayer.spawns[0]?.preferredGoalId !== "goal-a" || multiplayer.spawns[1]?.preferredGoalId !== "goal-b"
      || multiplayer.before.activePlayerId !== "player-1" || multiplayer.after.activePlayerId !== "player-2" || multiplayer.after.factionId !== playerTwoFaction
      || multiplayer.playerButtons[1]?.pressed !== "true" || multiplayer.minimap.spawnCount !== "2" || multiplayer.minimap.goalCount !== "2") {
      throw new Error(`Twin Bastion browser state failed: ${JSON.stringify(multiplayer)}`);
    }
    console.log(`Twin Bastion browser prototype passed (${playerOneFaction} / ${playerTwoFaction})`, JSON.stringify(multiplayer));
    return;
  }
  if (process.env.TD_GROVE_UNITS_ONLY === "1") {
    await evaluate("document.querySelector('#start-selected-map').click()");
    for (let attempt = 0; attempt < 50 && !(await evaluate("!!document.querySelector('.faction-select-screen')")); attempt += 1) await delay(100);
    await evaluate(`document.querySelector('[data-faction-id="ancient-grove"]').click(); document.querySelector('#start-battlefield').click()`);
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      ready = await evaluate(`window.__towerDefenceGameState?.factionId === 'ancient-grove'
        && document.querySelector('.game-ui')?.dataset.defenderAssetsReady === 'true'
        && !!document.querySelector('#build-bark-titan-button') && !!document.querySelector('#build-thorn-dancer-button')`);
      if (ready) break;
      await delay(150);
    }
    if (!ready) throw new Error("Ancient Grove expanded roster did not initialize.");
    const placed = await evaluate(`(() => {
      const game = window.__towerDefenceGameState;
      game.gold = 20_000;
      const entries = [
        ['bark-titan', null], ['thorn-dancer', null],
        ['bark-titan', 'stonebark-titan'], ['bark-titan', 'heartwood-crusher'],
        ['thorn-dancer', 'blight-dancer'], ['thorn-dancer', 'winterthorn-dancer'],
      ];
      const result = [];
      for (const [type, branch] of entries) {
        let tower;
        for (let y = 1; y < game.grid.height - 1 && !tower; y += 1) for (let x = 1; x < game.grid.width - 1; x += 1) {
          const cell = { x, y };
          if (game.canPlaceBasicTower(cell, type) !== 'placed' || game.placeBasicTower(cell, type) !== 'placed') continue;
          tower = game.towers.at(-1);
          break;
        }
        if (!tower) throw new Error('No legal placement for ' + type + ' / ' + branch);
        if (branch && (game.upgradeBasicTower(tower.id) !== 'upgraded' || game.upgradeBasicTower(tower.id, branch) !== 'upgraded')) {
          throw new Error('Could not specialize ' + branch);
        }
        result.push({ id: tower.id, type, branch });
      }
      window.__towerDefenceUi.selectTower(result.find(({ type, branch }) => type === 'thorn-dancer' && !branch).id);
      return result;
    })()`);
    let browserResult;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      browserResult = await evaluate(`(() => {
        const placed = ${JSON.stringify(placed)};
        const instances = window.__defenderVisualInstances ?? [];
        return {
          roster: [...window.__towerDefenceGameState.availableUnits],
          towers: window.__towerDefenceGameState.towers.map(({ id, type, level, specializationId }) => ({ id, type, level, specializationId })),
          visuals: placed.map(({ id }) => instances.findLast((entry) => entry.id === id) ?? null),
          templates: window.__defenderTemplateAudit ?? [],
          portraits: Object.fromEntries(['bark-titan', 'thorn-dancer'].map((type) => [type,
            document.querySelector('#build-' + type + '-button .unit-portrait-frame img')?.getAttribute('src') ?? null])),
          auraBuff: [...document.querySelectorAll('#tower-buff-icons .tower-buff-icon')].some((node) => node.getAttribute('aria-label')?.includes('Verdant Resonance')),
        };
      })()`);
      if (browserResult.visuals.every(Boolean) && browserResult.auraBuff) break;
      await delay(100);
    }
    if (JSON.stringify(browserResult.roster) !== JSON.stringify(groveRosterTypes)
      || browserResult.visuals.some((visual, index) => !visual || visual.type !== placed[index].type
        || visual.assetPath !== expectedDefenderPaths[placed[index].type] || visual.primitiveFallback)
      || browserResult.towers.filter(({ type }) => type === 'bark-titan' || type === 'thorn-dancer').length !== 6
      || placed.filter(({ branch }) => branch).some(({ id, branch }) => !browserResult.towers.some((tower) => tower.id === id && tower.level === 3 && tower.specializationId === branch))
      || JSON.stringify(browserResult.templates.map(({ type }) => type).sort()) !== JSON.stringify([...groveImportedTypes].sort())
      || Object.entries(expectedDedicatedGrovePortraits).some(([type, portrait]) => !browserResult.portraits[type]?.endsWith(portrait))
      || !browserResult.auraBuff) {
      throw new Error(`Ancient Grove expanded roster browser test failed: ${JSON.stringify({ placed, browserResult, browserErrors })}`);
    }
    console.log("Ancient Grove expanded roster browser test passed", JSON.stringify({ placed, browserResult }));
    return;
  }
  await evaluate("document.querySelector('#start-selected-map').click()");
  let factionSelectReady = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    factionSelectReady = await evaluate(`(() => !!document.querySelector('.faction-select-screen')
      && !document.querySelector('#game3d') && !document.querySelector('#minimap-panel'))()`);
    if (factionSelectReady) break;
    await delay(50);
  }
  const factionSelection = await evaluate(`(() => ({
    title: document.querySelector('#faction-select-title')?.textContent.trim(),
    eyebrow: document.querySelector('.faction-select-screen .map-select-eyebrow')?.textContent.trim(),
    names: [...document.querySelectorAll('.faction-choice-copy strong')].map((node) => node.textContent.trim().toUpperCase()),
    selectedCount: document.querySelectorAll('.faction-choice-card[aria-checked="true"]').length,
    expandedCount: [...document.querySelectorAll('.faction-card-details')].filter((node) => !node.hidden).length,
    unitsVisible: document.querySelector('.faction-choice-card.is-selected .faction-unit-list')?.children.length,
    actionCount: document.querySelectorAll('#start-battlefield').length,
    startText: document.querySelector('#start-battlefield')?.textContent.trim().replace(/\\s+/g, ' ').toUpperCase(),
    selectedMap: document.querySelector('.faction-select-screen .map-select-footer > span')?.textContent.trim(),
    minimapAbsentBeforeGameplay: !document.querySelector('#minimap-panel') && !document.querySelector('#game-minimap'),
  }))()`);
  if (!factionSelectReady || factionSelection.title !== "CHOOSE FACTION"
    || !factionSelection.eyebrow?.startsWith("TOWER DEFENCE ·")
    || !factionSelection.names.includes("ROYAL GUARD")
    || factionSelection.selectedCount !== 1 || factionSelection.expandedCount !== 1
    || factionSelection.unitsVisible !== 6 || factionSelection.actionCount !== 1
    || factionSelection.startText !== "CONTINUE WITH ROYAL GUARD →"
    || !factionSelection.selectedMap?.startsWith("Open Field")
    || !factionSelection.minimapAbsentBeforeGameplay) {
    throw new Error(`Faction selection flow failed: ${JSON.stringify({ factionSelectReady, factionSelection })}`);
  }
  await evaluate(`(() => {
    const grove = document.querySelector('[data-faction-id="ancient-grove"]');
    grove.click();
    if (grove.getAttribute('aria-checked') !== 'true' || !grove.classList.contains('is-selected')
      || document.querySelectorAll('.faction-choice-card[aria-checked="true"]').length !== 1
      || document.querySelector('.faction-choice-card.is-selected .faction-card-details').hidden
      || document.querySelector('#start-battlefield').textContent.trim().replace(/\\s+/g, ' ').toUpperCase() !== 'CONTINUE WITH ANCIENT GROVE →') {
      throw new Error('Faction card selection did not update the selected details and global action.');
    }
    const groveUnits = document.querySelector('.faction-choice-card.is-selected .faction-unit-list');
    if (groveUnits.children.length !== 6 || !['Treant', 'Thorn Owl', 'Druid', 'Seer', 'Bark Titan', 'Thorn Dancer'].every((unit) => groveUnits.textContent.includes(unit))
      || groveUnits.textContent.includes('Holy Emperor')) {
      throw new Error('Ancient Grove must offer its six Grove units; Holy Emperor remains exclusive to Royal Guard.');
    }
    grove.focus();
    grove.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    if (document.querySelector('.faction-choice-card[aria-checked="true"]')?.dataset.factionId !== 'arcane-kingdom'
      || document.querySelector('#start-battlefield').textContent.trim().replace(/\\s+/g, ' ').toUpperCase() !== 'CONTINUE WITH ROYAL GUARD →') {
      throw new Error('Keyboard faction selection did not update the global action.');
    }
  })()`);
  await command("Emulation.setDeviceMetricsOverride", { width: 360, height: 640, deviceScaleFactor: 1, mobile: true });
  const compactFactionLayout = await evaluate(`(() => {
    const app = document.querySelector('#app').getBoundingClientRect();
    const action = document.querySelector('#start-battlefield').getBoundingClientRect();
    const grid = document.querySelector('.faction-choice-grid').getBoundingClientRect();
    const selected = document.querySelector('.faction-choice-card.is-selected').getBoundingClientRect();
    return { viewportWidth: document.documentElement.clientWidth, pageWidth: document.documentElement.scrollWidth,
      appBottom: app.bottom, actionBottom: action.bottom, actionVisible: action.height > 0 && action.bottom <= app.bottom,
      cards: document.querySelectorAll('.faction-choice-card').length, selectedWithinList: selected.right <= grid.right };
  })()`);
  if (compactFactionLayout.pageWidth > compactFactionLayout.viewportWidth || !compactFactionLayout.actionVisible
    || compactFactionLayout.cards < 2 || !compactFactionLayout.selectedWithinList) {
    throw new Error(`Compact mobile faction layout failed: ${JSON.stringify(compactFactionLayout)}`);
  }
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  // Exercise the Grove's packaged GLBs before the long Royal Guard combat/UI checks.
  // Its L3 branches intentionally reuse their base unit model until distinct GLBs exist.
  await evaluate(`(() => {
    document.querySelector('[data-faction-id="ancient-grove"]').click();
    document.querySelector('#start-battlefield').click();
  })()`);
  let groveReady = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    groveReady = await evaluate(`(() => window.__towerDefenceGameState?.factionId === 'ancient-grove'
      && document.querySelector('.game-ui')?.dataset.defenderAssetsReady === 'true'
      && window.__terrainArtDebug?.environmentReady === true
      && (window.__defenderTemplateAudit?.length ?? 0) === ${groveImportedTypes.length})()`);
    if (groveReady) break;
    await delay(300);
  }
  if (!groveReady) {
    throw new Error(`Ancient Grove defender templates did not finish loading: ${JSON.stringify(await evaluate(`({
      faction: window.__towerDefenceGameState?.factionId,
      ready: document.querySelector('.game-ui')?.dataset.defenderAssetsReady,
      templates: window.__defenderTemplateAudit ?? null,
    })`))}`);
  }
  let groveEnvironment = await evaluate('window.__terrainArtDebug ?? null');
  if (groveEnvironment?.themeStyle !== 'forest' || groveEnvironment?.themeId !== 'ancient-grove-forest'
    || groveEnvironment?.groundMaterial !== 'forest-clearing-grass-earth-pbr'
    || groveEnvironment?.endpointDecorationMeshCount !== 0
    || groveEnvironment?.environmentComposition?.trees < 150
    || groveEnvironment?.environmentComposition?.rocks < groveEnvironment?.terrainRegionCount
    || groveEnvironment?.environmentComposition?.importedModels < 16
    // Every curated Quaternius template must be represented by a real hardware instance;
    // preloading alone is not enough to count as a visual overhaul.
    || expectedQuaterniusNatureAssets.some((key) => !(groveEnvironment?.environmentRendering?.byAsset?.[key] > 0))
    || groveEnvironment?.environmentRendering?.templateAssets < 14
    || groveEnvironment?.environmentRendering?.instances < (
      groveEnvironment?.environmentComposition?.trees
      + groveEnvironment?.environmentComposition?.rocks
      + groveEnvironment?.environmentComposition?.vegetation
    )) {
    throw new Error(`Ancient Grove forest environment failed: ${JSON.stringify(groveEnvironment)}`);
  }
  console.log('Ancient Grove forest environment passed', JSON.stringify(groveEnvironment));
  if (process.env.SAVE_FOREST_ART_SCREENSHOTS === '1') {
    const screenshotDirectory = path.resolve(process.env.TD_VISUAL_REVIEW_DIR
      ?? path.resolve(__dirname, '../artifacts/forest-art-review'));
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    const reports = { 'single-spawn': groveEnvironment };
    const captureForest = async (mapId) => {
      await delay(700);
      await evaluate("document.querySelector('pre[style*=\\\"z-index:30\\\"]')?.remove(); document.querySelector('#minimap-dock')?.style.setProperty('visibility', 'hidden')");
      const screenshot = await command('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync(path.join(screenshotDirectory, `${mapId}-mobile.png`), Buffer.from(screenshot.data, 'base64'));
    };
    const openForestMap = async (mapId) => {
      await evaluate(`(() => {
        document.querySelector('#reset-menu-button').click();
        document.querySelector('#return-map-select-button').click();
        window.__defenderTemplateAudit = [];
      })()`);
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (await evaluate("!!document.querySelector('.map-select-screen')")) break;
        await delay(50);
      }
      await evaluate(`document.querySelector('[data-map-id="${mapId}"]').click(); document.querySelector('#start-selected-map').click()`);
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (await evaluate("!!document.querySelector('.faction-select-screen')")) break;
        await delay(50);
      }
      await evaluate(`document.querySelector('[data-faction-id="ancient-grove"]').click(); document.querySelector('#start-battlefield').click()`);
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const ready = await evaluate(`window.__terrainArtDebug?.map === '${mapId}'
          && window.__terrainArtDebug?.environmentReady === true
          && document.querySelector('.game-ui')?.dataset.defenderAssetsReady === 'true'`);
        if (ready) return await evaluate('window.__terrainArtDebug');
        await delay(200);
      }
      throw new Error(`Forest environment did not initialize for ${mapId}`);
    };
    await captureForest('single-spawn');
    for (const mapId of ['two-spawns', 'three-spawns']) {
      reports[mapId] = await openForestMap(mapId);
      await captureForest(mapId);
    }
    groveEnvironment = await openForestMap('single-spawn');
    console.log('Forest map visual reports', JSON.stringify(reports));
  }
  const groveBaseIds = await evaluate(`(() => {
    const game = window.__towerDefenceGameState;
    game.gold = 20_000;
    const ui = window.__towerDefenceUi;
    const canvas = document.querySelector('#game3d').getBoundingClientRect();
    const top = document.querySelector('.top-hud-bar').getBoundingClientRect();
    const bottom = document.querySelector('.bottom-hud-bar').getBoundingClientRect();
    const usableHeight = bottom.top - top.bottom;
    const targetPositions = [
      [0.34, 0.40], [0.66, 0.40], [0.34, 0.68], [0.66, 0.68],
      [0.50, 0.32], [0.50, 0.76], [0.24, 0.54], [0.76, 0.54], [0.50, 0.54], [0.42, 0.54],
    ].map(([x, y]) => ({ x: canvas.left + canvas.width * x, y: top.bottom + usableHeight * y }));
    const candidates = [];
    for (let y = 0; y < game.grid.height; y += 1) for (let x = 0; x < game.grid.width; x += 1) {
      const cell = { x, y }, point = ui.projectCell(cell);
      if (point.x <= canvas.left + 24 || point.x >= canvas.right - 24
        || point.y <= top.bottom + 24 || point.y >= bottom.top - 24) continue;
      candidates.push({ cell, ...point });
    }
    let placementIndex = 0;
    const place = (type) => {
      const target = targetPositions[Math.min(placementIndex, targetPositions.length - 1)];
      const ordered = candidates.slice().sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y));
      for (const { cell } of ordered) {
        if (game.canPlaceBasicTower(cell, type) !== 'placed') continue;
        if (game.placeBasicTower(cell, type) !== 'placed') continue;
        placementIndex += 1;
        return game.towers.at(-1).id;
      }
      throw new Error('No valid Grove placement for ' + type);
    };
    const ids = {};
    for (const type of ${JSON.stringify(groveRosterTypes)}) ids[type] = place(type);
    return ids;
  })()`);
  if (process.env.TD_GROVE_SCREENSHOT) {
    await delay(500);
    await evaluate("document.querySelector('pre[style*=\\\"z-index:30\\\"]')?.remove(); document.querySelector('#minimap-dock')?.style.setProperty('visibility', 'hidden')");
    const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(process.env.TD_GROVE_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
  }
  const groveBranchResults = await evaluate(`(() => {
    const game = window.__towerDefenceGameState;
    const ui = window.__towerDefenceUi;
    const canvas = document.querySelector('#game3d').getBoundingClientRect();
    const top = document.querySelector('.top-hud-bar').getBoundingClientRect();
    const bottom = document.querySelector('.bottom-hud-bar').getBoundingClientRect();
    const usableHeight = bottom.top - top.bottom;
    const targetPositions = [
      [0.34, 0.40], [0.66, 0.40], [0.34, 0.68], [0.66, 0.68],
      [0.50, 0.32], [0.50, 0.76], [0.24, 0.54], [0.76, 0.54], [0.50, 0.54], [0.42, 0.54],
    ].map(([x, y]) => ({ x: canvas.left + canvas.width * x, y: top.bottom + usableHeight * y }));
    const candidates = [];
    for (let y = 0; y < game.grid.height; y += 1) for (let x = 0; x < game.grid.width; x += 1) {
      const cell = { x, y }, point = ui.projectCell(cell);
      if (point.x <= canvas.left + 24 || point.x >= canvas.right - 24
        || point.y <= top.bottom + 24 || point.y >= bottom.top - 24) continue;
      candidates.push({ cell, ...point });
    }
    let placementIndex = ${groveRosterTypes.length};
    const place = (type) => {
      const target = targetPositions[Math.min(placementIndex, targetPositions.length - 1)];
      const ordered = candidates.slice().sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y));
      for (const { cell } of ordered) {
        if (game.canPlaceBasicTower(cell, type) !== 'placed') continue;
        if (game.placeBasicTower(cell, type) !== 'placed') continue;
        placementIndex += 1;
        return game.towers.at(-1).id;
      }
      throw new Error('No valid Grove placement for ' + type);
    };
    const ids = { ...${JSON.stringify(groveBaseIds)} };
    for (const [branch, type] of [
      ['needlewing-owl', 'thorn-owl'], ['elderwing', 'thorn-owl'],
      ['dire-wolf', 'druid'], ['elder-bear', 'druid'],
      ['moon-seer', 'seer'], ['sun-seer', 'seer'],
      ['stonebark-titan', 'bark-titan'], ['heartwood-crusher', 'bark-titan'],
      ['blight-dancer', 'thorn-dancer'], ['winterthorn-dancer', 'thorn-dancer'],
    ]) {
      const id = place(type);
      if (game.upgradeBasicTower(id) !== 'upgraded' || game.upgradeBasicTower(id, branch) !== 'upgraded') {
        throw new Error('Could not specialize Grove tower as ' + branch);
      }
      ids[branch] = id;
    }
    return { ids, roster: [...game.availableUnits], towers: game.towers.map(({ id, type, level, specializationId, cell, damage, range, fireRate }) =>
      ({ id, type, level, specializationId, cell, damage, range, fireRate })),
      cards: ${JSON.stringify(groveRosterTypes)}.map((type) => Boolean(document.querySelector('#build-' + type + '-button'))) };
  })()`);
  const grovePlacements = { ...groveBranchResults, ids: { ...groveBaseIds, ...groveBranchResults.ids } };
  let groveVisuals;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    groveVisuals = await evaluate(`(() => {
      const ids = ${JSON.stringify(grovePlacements.ids)};
      const records = window.__defenderVisualInstances ?? [];
      return Object.fromEntries(Object.entries(ids).map(([unit, id]) => [unit, records.findLast((entry) => entry.id === id) ?? null]));
    })()`);
    if (Object.values(groveVisuals).every(Boolean)) break;
    await delay(100);
  }
  const groveTemplates = await evaluate('window.__defenderTemplateAudit ?? []');
  const groveTypes = groveRosterTypes;
  if (JSON.stringify(grovePlacements.roster) !== JSON.stringify(groveTypes)
    || groveTypes.some((type) => !grovePlacements.ids[type]) || !grovePlacements.cards.every(Boolean)
    || grovePlacements.towers.length !== 16
    || JSON.stringify(groveTemplates.map(({ type }) => type).sort()) !== JSON.stringify([...groveImportedTypes].sort())
    || groveTemplates.some(({ type, assetPath, optimized, triangleCount, materials }) =>
      assetPath !== expectedDefenderPaths[type] || !optimized || !(triangleCount > 0) || !(materials > 0))) {
    throw new Error(`Ancient Grove roster/template mapping failed: ${JSON.stringify({ grovePlacements, groveTemplates })}`);
  }
  const branchTypes = { 'needlewing-owl': 'thorn-owl', elderwing: 'thorn-owl', 'dire-wolf': 'druid',
    'elder-bear': 'druid', 'moon-seer': 'seer', 'sun-seer': 'seer',
    'stonebark-titan': 'bark-titan', 'heartwood-crusher': 'bark-titan',
    'blight-dancer': 'thorn-dancer', 'winterthorn-dancer': 'thorn-dancer' };
  const groveStateAfterVisuals = await evaluate(`window.__towerDefenceGameState.towers.map(({ id, type, level, specializationId, cell, damage, range, fireRate }) =>
    ({ id, type, level, specializationId, cell, damage, range, fireRate }))`);
  if (JSON.stringify(groveStateAfterVisuals) !== JSON.stringify(grovePlacements.towers)
    || Object.entries(branchTypes).some(([branch, type]) => {
      const tower = groveStateAfterVisuals.find(({ id }) => id === grovePlacements.ids[branch]);
      return !tower || tower.type !== type || tower.level !== 3 || tower.specializationId !== branch;
    })) {
    throw new Error(`Grove model instancing changed the tower state or lost a branch: ${JSON.stringify({ grovePlacements, groveStateAfterVisuals })}`);
  }
  if (Object.entries(groveVisuals).some(([unit, visual]) => {
    const type = branchTypes[unit] ?? unit;
    const dimensions = visual?.bounds;
    const maxWidth = type === "thorn-owl" ? 1.65 : 1.3;
    return !visual || visual.type !== type || visual.assetPath !== expectedDefenderPaths[type]
      || (branchTypes[unit] && visual.level !== 3)
      || !visual.optimized || visual.primitiveFallback || !dimensions
      || ![dimensions.width, dimensions.height, dimensions.depth, dimensions.minY].every(Number.isFinite)
      || dimensions.width <= 0 || dimensions.height <= 0 || dimensions.depth <= 0
      || dimensions.width > maxWidth || dimensions.depth > 1.3 || dimensions.height > 2.6
      || dimensions.minY < -0.02 || dimensions.minY > 0.9;
  })) {
    throw new Error(`Ancient Grove GLB instance, branch reuse or bounds failed: ${JSON.stringify(groveVisuals)}`);
  }
  console.log('Ancient Grove GLB mapping passed', JSON.stringify({ groveTemplates, groveVisuals }));
  if (process.env.TD_GROVE_SCREENSHOT) {
    const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(process.env.TD_GROVE_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
  }
  await evaluate(`(() => {
    document.querySelector('#reset-menu-button').click();
    document.querySelector('#return-map-select-button').click();
    window.__defenderVisualInstances = [];
    window.__enemyTemplateAudit = [];
    window.__enemyVisualInstances = [];
    window.__enemyVisualAudit = [];
  })()`);
  let returnedFromGrove = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    returnedFromGrove = await evaluate(`(() => !!document.querySelector('.map-select-screen')
      && !document.querySelector('#game3d') && !window.__towerDefenceGameState)()`);
    if (returnedFromGrove) break;
    await delay(50);
  }
  if (!returnedFromGrove) throw new Error('Ancient Grove test run did not return to Map Select.');
  await evaluate("document.querySelector('#start-selected-map').click()");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await evaluate("!!document.querySelector('.faction-select-screen')")) break;
    if (attempt === 49) throw new Error('Royal Guard faction screen did not reopen after Grove test.');
    await delay(50);
  }
  await evaluate(`(() => {
    document.querySelector('[data-faction-id="arcane-kingdom"]').click();
    document.querySelector('#start-battlefield').click();
  })()`);
  let initialRunReady = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    initialRunReady = await evaluate(`(() => window.__towerDefenceGameState?.map.id === "single-spawn"
      && !!document.querySelector('#game3d') && !!document.querySelector('#minimap-panel'))()`);
    if (initialRunReady) break;
    await delay(100);
  }
  if (!initialRunReady) throw new Error("Start Battlefield did not start the selected single-spawn map.");
  const battlefieldStartupTiming = await evaluate(`(() => {
    const getMark = (name) => performance.getEntriesByName(name).at(-1)?.startTime ?? null;
    const requested = getMark('tower-defence-battlefield-load-requested');
    const rendererReady = getMark('tower-defence-renderer-module-ready');
    const firstFrame = getMark('tower-defence-first-battlefield-frame');
    const defendersReady = getMark('tower-defence-defender-assets-ready');
    return {
      rendererModuleMs: requested !== null && rendererReady !== null ? Math.round(rendererReady - requested) : null,
      firstFrameMs: requested !== null && firstFrame !== null ? Math.round(firstFrame - requested) : null,
      defendersReadyMs: requested !== null && defendersReady !== null ? Math.round(defendersReady - requested) : null,
    };
  })()`);
  const initialMapGold = await evaluate("window.__towerDefenceGameState.gold");
  if (initialMapGold !== 100) throw new Error(`Single-spawn map started with ${initialMapGold} gold instead of 100.`);
  const initialDefenderLoadGate = await evaluate(`(() => ({
    ready: document.querySelector('.game-ui')?.dataset.defenderAssetsReady === 'true',
    buildButtonsDisabled: [...document.querySelectorAll('.defender-choice:not(.select-tool)')].every((button) => button.disabled),
    startWaveDisabled: document.querySelector('#start-wave-button')?.disabled,
    hint: document.querySelector('.build-unit-info-hint')?.textContent.trim(),
  }))()`);
  if (!initialDefenderLoadGate.ready && (!initialDefenderLoadGate.buildButtonsDisabled
    || !initialDefenderLoadGate.startWaveDisabled || !initialDefenderLoadGate.hint?.toLowerCase().includes("loading"))) {
    throw new Error(`Gameplay controls became interactive before defender preload completed: ${JSON.stringify(initialDefenderLoadGate)}`);
  }
  console.log("Choose Map and Faction browser flow passed", JSON.stringify({ modeLayouts, responsiveLayouts, modeFlow, mapSelection, factionSelection, initialRunReady }));
  console.log("Startup timing sample (headless browser; use as a relative smoke metric)", JSON.stringify({ bootTiming, battlefieldStartupTiming }));
  if (process.env.SAVE_CASTLE_ART_SCREENSHOTS === "1") {
    const screenshotDirectory = path.resolve(process.env.TD_VISUAL_REVIEW_DIR ?? path.resolve(__dirname, "../artifacts/castle-art-review"));
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const environmentReady = await evaluate("window.__terrainArtDebug?.environmentReady === true");
      if (environmentReady) break;
      await delay(250);
    }
    const terrainReport = await evaluate("window.__terrainArtDebug ?? null");
    console.log("Castle art terrain report", JSON.stringify(terrainReport));
    for (const viewport of [
      { name: "desktop", width: 1365, height: 900, mobile: false },
      { name: "mobile", width: 390, height: 844, mobile: true },
    ]) {
      await command("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
      await delay(1200);
      const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
      fs.writeFileSync(path.join(screenshotDirectory, `single-spawn-${viewport.name}.png`), Buffer.from(screenshot.data, "base64"));
    }
    for (const mapId of ["two-spawns", "three-spawns"]) {
      const reviewUrl = new URL(appUrl);
      for (const key of ["waveDebug", "inputDebug", "minimapDebug", "defenderVisualDebug", "enemyVisualDebug", "enemyGroundDebug", "terrainArtDebug"]) {
        reviewUrl.searchParams.set(key, "1");
      }
      await command("Page.navigate", { url: reviewUrl.toString() });
      let mapSelectReady = false;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        mapSelectReady = await evaluate(`(() => {
          const mode = document.querySelector('[data-map-mode="single-player"]');
          if (mode) mode.click();
          return document.querySelectorAll('.map-choice-card').length === 3;
        })()`);
        if (mapSelectReady) break;
        await delay(100);
      }
      if (!mapSelectReady) throw new Error(`Castle art review could not open map selection for ${mapId}.`);
      await evaluate(`document.querySelector('.map-choice-card[data-map-id="${mapId}"]').click()`);
      await evaluate("document.querySelector('#start-selected-map').click()");
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (await evaluate("!!document.querySelector('.faction-select-screen')")) break;
        await delay(50);
      }
      await delay(300);
      await evaluate("document.querySelector('#start-battlefield').click()");
      let selectedRunReady = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        selectedRunReady = await evaluate(`window.__terrainArtDebug?.map === "${mapId}" && window.__terrainArtDebug?.environmentReady === true`);
        if (selectedRunReady) break;
        await delay(150);
      }
      if (!selectedRunReady) {
        const diagnostics = await evaluate(`(() => ({
          mapId: window.__terrainArtDebug?.map ?? null,
          gameCanvas: !!document.querySelector('#game3d'),
          factionScreen: !!document.querySelector('.faction-select-screen'),
          terrainArt: window.__terrainArtDebug ?? null,
        }))()`);
        throw new Error(`Castle art review could not initialize ${mapId}: ${JSON.stringify(diagnostics)}`);
      }
      for (const viewport of [
        { name: "desktop", width: 1365, height: 900, mobile: false },
        { name: "mobile", width: 390, height: 844, mobile: true },
      ]) {
        await command("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
        await delay(1200);
        const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
        fs.writeFileSync(path.join(screenshotDirectory, `${mapId}-${viewport.name}.png`), Buffer.from(screenshot.data, "base64"));
      }
    }
    console.log("Castle art screenshots saved", screenshotDirectory);
    if (process.env.TD_MAP_SELECT_ONLY === "1") return;
    const initialDebugUrl = new URL(appUrl);
    for (const key of ["waveDebug", "inputDebug", "minimapDebug", "defenderVisualDebug", "enemyVisualDebug", "enemyGroundDebug", "terrainArtDebug"]) {
      initialDebugUrl.searchParams.set(key, "1");
    }
    await command("Page.navigate", { url: initialDebugUrl.toString() });
    let initialMapSelectReady = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      initialMapSelectReady = await evaluate(`(() => {
        const mode = document.querySelector('[data-map-mode="single-player"]');
        if (mode) mode.click();
        return document.querySelectorAll('.map-choice-card').length === 3;
      })()`);
      if (initialMapSelectReady) break;
      await delay(100);
    }
    if (!initialMapSelectReady) throw new Error("Castle art review could not restore the initial Map Select flow.");
    await evaluate("document.querySelector('#start-selected-map').click()");
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (await evaluate("!!document.querySelector('.faction-select-screen')")) break;
      await delay(50);
    }
    await evaluate("document.querySelector('#start-battlefield').click()");
    let initialBattlefieldReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      initialBattlefieldReady = await evaluate("window.__terrainArtDebug?.map === 'single-spawn' && window.__terrainArtDebug?.environmentReady === true");
      if (initialBattlefieldReady) break;
      await delay(150);
    }
    if (!initialBattlefieldReady) throw new Error("Castle art review could not restore the initial single-spawn battlefield.");
  }
  if (process.env.TD_MAP_SELECT_ONLY === "1") return;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const loaded = await evaluate(`(window.__enemyTemplateAudit?.length ?? 0) === 9 && (window.__defenderTemplateAudit?.length ?? 0) === ${royalImportedTypes.length} && !!window.__towerDefenceUi && !!window.__towerDefenceInputDebug && document.querySelector('.game-ui')?.dataset.defenderAssetsReady === 'true'`);
    if (loaded) break;
    if (attempt === 99) {
      const audit = await evaluate(`({ enemyTemplates: window.__enemyTemplateAudit?.map(({ type }) => type),
        defenderTemplates: window.__defenderTemplateAudit?.map(({ type, assetPath }) => ({ type, assetPath })),
        defenderAssetsReady: document.querySelector('.game-ui')?.dataset.defenderAssetsReady,
        hasUi: !!window.__towerDefenceUi, hasInputDebug: !!window.__towerDefenceInputDebug })`);
      throw new Error(`New enemy and defender GLB templates failed to load: ${JSON.stringify({ audit, browserErrors })}`);
    }
    await delay(300);
  }
  const initialMinimap = await evaluate(`(() => {
    const panel = document.querySelector('#minimap-panel');
    const canvas = document.querySelector('#game-minimap');
    return panel && canvas ? {
      mapId: panel.dataset.mapId,
      dimensions: panel.dataset.mapDimensions,
      terrainCells: Number(panel.dataset.terrainCells),
      spawnCount: Number(panel.dataset.spawnCount),
      goalCell: panel.dataset.goalCell,
      pointerEvents: getComputedStyle(panel).pointerEvents,
      width: canvas.getBoundingClientRect().width,
      height: canvas.getBoundingClientRect().height,
    } : null;
  })()`);
  if (!initialMinimap || initialMinimap.mapId !== "single-spawn" || initialMinimap.dimensions !== "17x32"
    || initialMinimap.terrainCells !== 220 || initialMinimap.spawnCount !== 1 || initialMinimap.goalCell !== "8,31"
    || initialMinimap.pointerEvents !== "none") {
    throw new Error(`Initial single-spawn minimap did not match selected map: ${JSON.stringify(initialMinimap)}`);
  }
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
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
    const sovereignBranchChoice = {
      visible: !document.querySelector('#specialization-choice').hidden,
      bounds: document.querySelector('#specialization-choice').getBoundingClientRect().toJSON(),
      options: [...document.querySelectorAll('#specialization-options .specialization-option')].map((button) => ({
        name: button.querySelector('strong').textContent,
        role: button.querySelector('small').textContent,
        description: button.querySelector('span').textContent,
        cost: button.querySelector('em').textContent,
        disabled: button.disabled,
      })),
    };
    [...document.querySelectorAll('#specialization-options .specialization-option')]
      .find((button) => button.querySelector('strong').textContent === 'Storm Regent').click();
    const sovereignLevel3 = {
      level: document.querySelector('#tower-level').textContent,
      profiles: [...document.querySelectorAll('#tower-sovereign-profiles > span.profile-mode')].map((row) => row.textContent),
      action: document.querySelector('#upgrade-button').textContent,
      specialization: game.towers.find(({ id }) => id === placedIds[24]).specializationId,
      specializationLabel: document.querySelector('#tower-specialization').textContent,
      specializationDetail: document.querySelector('#tower-specialization-detail').textContent,
    };
    ui.selectTower(placedIds[14]);
    document.querySelector('#upgrade-button').click();
    document.querySelector('#upgrade-button').click();
    const archerBranchChoice = {
      visible: !document.querySelector('#specialization-choice').hidden,
      bounds: document.querySelector('#specialization-choice').getBoundingClientRect().toJSON(),
      options: [...document.querySelectorAll('#specialization-options .specialization-option')].map((button) => ({
        name: button.querySelector('strong').textContent,
        role: button.querySelector('small').textContent,
        description: button.querySelector('span').textContent,
        cost: button.querySelector('em').textContent,
        disabled: button.disabled,
      })),
    };
    [...document.querySelectorAll('#specialization-options .specialization-option')]
      .find((button) => button.querySelector('strong').textContent === 'Dragon Slayer').click();
    const archerLevel3 = {
      level: document.querySelector('#tower-level').textContent,
      specialization: game.towers.find(({ id }) => id === placedIds[14]).specializationId,
      specializationLabel: document.querySelector('#tower-specialization').textContent,
      specializationDetail: document.querySelector('#tower-specialization-detail').textContent,
    };
    ui.selectTower();
    ui.chooseBuildUnit('holy-emperor');
    const holyEmperor = {
      cardExists: !!document.querySelector('#build-holy-emperor-button'),
      cardCost: document.querySelector('#build-holy-emperor-button .unit-card-cost')?.textContent,
      cardPortrait: document.querySelector('#build-holy-emperor-button .unit-portrait-frame img')?.getAttribute('src'),
      name: document.querySelector('#build-unit-info-name').textContent,
      damage: document.querySelector('#build-unit-info-damage').textContent,
      range: document.querySelector('#build-unit-info-range').textContent,
      rate: document.querySelector('#build-unit-info-rate').textContent,
      cost: document.querySelector('#build-unit-info-cost').textContent,
      capabilities: document.querySelector('#build-unit-info-capabilities').textContent,
      portraitIsFallback: document.querySelector('#build-unit-info-image').hidden
        || !document.querySelector('#build-unit-info-fallback').hidden,
    };
    game.gold = 10000;
    if (place('holy-emperor') !== 'placed') throw new Error('Could not place a Holy Emperor in the browser test map.');
    const holyEmperorTower = game.towers.at(-1);
    ui.selectTower(holyEmperorTower.id);
    const holyEmperorLevel1 = {
      level: document.querySelector('#tower-level').textContent,
      damage: document.querySelector('#tower-damage').textContent,
      range: document.querySelector('#tower-range').textContent,
      rate: document.querySelector('#tower-fire-rate').textContent,
      details: document.querySelector('#tower-specialization-detail').textContent,
      upgrade: document.querySelector('#upgrade-button').textContent,
    };
    document.querySelector('#upgrade-button').click();
    const holyEmperorLevel2 = {
      level: document.querySelector('#tower-level').textContent,
      damage: document.querySelector('#tower-damage').textContent,
      rate: document.querySelector('#tower-fire-rate').textContent,
      details: document.querySelector('#tower-specialization-detail').textContent,
      upgrade: document.querySelector('#upgrade-button').textContent,
      tooltip: document.querySelector('#upgrade-tooltip').textContent,
    };
    document.querySelector('#upgrade-button').click();
    const holyEmperorLevel3 = {
      level: document.querySelector('#tower-level').textContent,
      damage: document.querySelector('#tower-damage').textContent,
      rate: document.querySelector('#tower-fire-rate').textContent,
      details: document.querySelector('#tower-specialization-detail').textContent,
      upgrade: document.querySelector('#upgrade-button').textContent,
    };
    ui.selectTower();
    ui.selectTower(placedIds[14]);
    const groundLineup = window.__towerDefenceEnemyVisualTest.spawnGroundLineup();
    return { archer, battlemage, sovereign, selectedSovereign, sovereignLevel2, sovereignBranchChoice, sovereignLevel3, holyEmperor,
      holyEmperorId: holyEmperorTower.id,
      holyEmperorLevel1, holyEmperorLevel2, holyEmperorLevel3,
      archerBranchChoice, archerLevel3, groundLineup, placedIds, towers: game.towers.map(({ type, level }) => ({ type, level })) };
  })()`);
  if (!visualState.sovereignBranchChoice.visible || visualState.sovereignBranchChoice.options.map(({ name }) => name).join("|") !== "Storm Regent|War Sovereign"
    || visualState.sovereignBranchChoice.options.some(({ disabled, cost }) => disabled || !cost.includes("200 Gold"))
    || visualState.sovereignBranchChoice.bounds.left < 0 || visualState.sovereignBranchChoice.bounds.right > 390
    || visualState.sovereignBranchChoice.bounds.top < 0 || visualState.sovereignBranchChoice.bounds.bottom > 844
    || visualState.sovereignLevel3.specialization !== "storm-regent" || visualState.sovereignLevel3.specializationLabel !== "STORM REGENT"
    || !visualState.sovereignLevel3.specializationDetail.includes("Every 3rd attack")
    || !visualState.archerBranchChoice.visible || visualState.archerBranchChoice.options.map(({ name }) => name).join("|") !== "Dragon Slayer|Ranger"
    || visualState.archerBranchChoice.options.some(({ disabled, cost }) => disabled || !cost.includes("70 Gold"))
    || visualState.archerBranchChoice.bounds.left < 0 || visualState.archerBranchChoice.bounds.right > 390
    || visualState.archerBranchChoice.bounds.top < 0 || visualState.archerBranchChoice.bounds.bottom > 844
    || visualState.archerLevel3.level !== "Level 3 · P1" || visualState.archerLevel3.specialization !== "dragon-slayer"
    || visualState.archerLevel3.specializationLabel !== "DRAGON SLAYER"
    || !visualState.archerLevel3.specializationDetail.includes("damage to air")) {
    throw new Error(`Mobile specialization branch UI failed: ${JSON.stringify({
      sovereign: visualState.sovereignBranchChoice, sovereignSelected: visualState.sovereignLevel3,
      archer: visualState.archerBranchChoice, archerSelected: visualState.archerLevel3,
    })}`);
  }
  if (!visualState.holyEmperor.cardExists || visualState.holyEmperor.cardCost !== "300G"
    || !visualState.holyEmperor.cardPortrait?.endsWith("/assets/ui/defenders/holy-emperor.jpg")
    || visualState.holyEmperor.name !== "Holy Emperor"
    || visualState.holyEmperor.damage !== "450" || visualState.holyEmperor.range !== "MAP WIDE"
    || visualState.holyEmperor.rate !== "0.85/s" || visualState.holyEmperor.cost !== "300 Gold"
    || !visualState.holyEmperor.capabilities.includes("MAP-WIDE")
    || !visualState.holyEmperor.capabilities.includes("TARGETS GROUND + AIR")
    || visualState.holyEmperor.portraitIsFallback) {
    throw new Error(`Holy Emperor build card/details failed: ${JSON.stringify(visualState.holyEmperor)}`);
  }
  if (visualState.holyEmperorLevel1.level !== "Level 1 · P1" || visualState.holyEmperorLevel1.damage !== "450"
    || visualState.holyEmperorLevel1.range !== "MAP WIDE" || visualState.holyEmperorLevel1.rate !== "0.85/s"
    || !visualState.holyEmperorLevel1.details.includes("TARGETS GROUND + AIR")
    || !visualState.holyEmperorLevel1.upgrade.includes("400G")
    || visualState.holyEmperorLevel2.level !== "Level 2 · P1" || visualState.holyEmperorLevel2.damage !== "700"
    || visualState.holyEmperorLevel2.rate !== "1.00/s" || !visualState.holyEmperorLevel2.upgrade.includes("500G")
    || !visualState.holyEmperorLevel2.tooltip.includes("Divine Splash: 65% within 1.75 tiles")
    || visualState.holyEmperorLevel3.level !== "Level 3 · P1" || visualState.holyEmperorLevel3.damage !== "950"
    || visualState.holyEmperorLevel3.rate !== "1.25/s" || !visualState.holyEmperorLevel3.details.includes("DIVINE SPLASH 65% WITHIN 1.75 TILES")
    || visualState.holyEmperorLevel3.upgrade !== "MAX LEVEL") {
    throw new Error(`Holy Emperor upgrade UI failed: ${JSON.stringify({
      L1: visualState.holyEmperorLevel1, L2: visualState.holyEmperorLevel2, L3: visualState.holyEmperorLevel3,
    })}`);
  }
  console.log("Mobile specialization branch UI passed", JSON.stringify({
    sovereign: visualState.sovereignBranchChoice, sovereignSelected: visualState.sovereignLevel3,
    archer: visualState.archerBranchChoice, archerSelected: visualState.archerLevel3,
  }));
  const groundEnemyBounds = await waitForGroundEnemyBounds();
  const result = await evaluate(`({
    enemyTemplates: window.__enemyTemplateAudit,
    enemyVisualInstances: window.__enemyVisualInstances,
    defenderTemplates: window.__defenderTemplateAudit,
    defenderInstances: window.__defenderVisualInstances,
    sceneStats: window.__enemySceneStats,
    selection: window.__towerDefenceUi.selectionVisual(),
  })`);
  if (process.env.TD_HOLY_EMPEROR_ONLY === "1") {
    const emperorTemplate = result.defenderTemplates?.find((asset) => asset.type === "holy-emperor");
    const emperorVisual = result.defenderInstances?.findLast((asset) => asset.id === visualState.holyEmperorId);
    if (result.defenderTemplates?.length !== royalImportedTypes.length || !emperorTemplate?.optimized
      || emperorTemplate.assetPath !== "/assets/models/defenders/optimized/holy-emperor.glb"
      || !emperorVisual || emperorVisual.type !== "holy-emperor" || !emperorVisual.optimized
      || emperorVisual.primitiveFallback || emperorVisual.assetPath !== emperorTemplate.assetPath
      || !emperorVisual.bounds || emperorVisual.bounds.width >= 1 || emperorVisual.bounds.depth >= 1
      || Math.abs(emperorVisual.bounds.height - 1.9) > 0.02 || emperorVisual.targetVisualHeight <= 1.747
      || Math.abs(emperorVisual.bounds.minY) > 0.01) {
      throw new Error(`Holy Emperor browser asset integration failed: ${JSON.stringify({ emperorTemplate, emperorVisual })}`);
    }
    if (process.env.TD_HOLY_EMPEROR_SCREENSHOT === "1") {
      await evaluate(`window.__towerDefenceUi.selectTower(${visualState.holyEmperorId})`);
      const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
      const screenshotPath = path.join(os.tmpdir(), "tower-defence-holy-emperor-browser.png");
      fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
      console.log(`Holy Emperor runtime screenshot: ${screenshotPath}`);
    }
    console.log("Holy Emperor browser integration passed", JSON.stringify({
      name: visualState.holyEmperor.name,
      portrait: visualState.holyEmperor.cardPortrait,
      levels: [visualState.holyEmperorLevel1, visualState.holyEmperorLevel2, visualState.holyEmperorLevel3],
      template: emperorTemplate,
      visual: emperorVisual,
    }));
    return;
  }
  const staticEnemyTemplates = result.enemyTemplates;
  const staticAssetsMissingFromProduction = staticEnemyTemplates.filter((asset) =>
    !asset.assetPath.includes("/optimized/") || !runtimeAssetManifest.groups.enemies.includes(asset.assetPath.replace(/^\//, "")),
  );
  if (staticAssetsMissingFromProduction.length > 0 || staticEnemyTemplates.length !== 9) {
    throw new Error(`Enemy factories did not resolve the nine optimized runtime GLBs: ${JSON.stringify(result.enemyTemplates)}`);
  }
  if (result.sceneStats) {
    console.log("Scene rendering sample (headless SwiftShader; not representative of a phone GPU)", JSON.stringify({
      meshes: result.sceneStats.sceneMeshes,
      materials: result.sceneStats.materials,
      textures: result.sceneStats.textures,
      triangles: result.sceneStats.totalSceneTriangles,
      activeTriangles: result.sceneStats.activeSceneTriangles,
      defenderTriangles: result.sceneStats.defenderTriangles,
      fps: result.sceneStats.fps,
      frameTimeMs: result.sceneStats.frameTimeMs,
      cachedEnemyModels: result.sceneStats.cachedModels,
    }));
  }
  const groundTypes = ["goblin", "goblinBrute", "ghoul", "wraith", "giantGoblin", "skeletonKing"];
  const groundInstances = groundEnemyBounds.filter((asset) => groundTypes.includes(asset.type));
  const expectedGroundOffsets = { goblin: 0, goblinBrute: -0.02, ghoul: -0.02, wraith: 0.15, giantGoblin: 0, skeletonKing: -0.02 };
  if (groundInstances.length !== 6 || groundInstances.some((asset) => Math.abs(asset.groundOffsetY - expectedGroundOffsets[asset.type]) > 1e-9
    || Math.abs(asset.bounds.minY - asset.groundOffsetY) > 0.005)) {
    throw new Error(`Ground enemy model bounds/alignment offsets failed: ${JSON.stringify(groundInstances)}`);
  }
  if (result.defenderTemplates.some((asset) => !asset.optimized)
    || JSON.stringify(result.defenderTemplates.map(({ type }) => type).sort()) !== JSON.stringify([...royalImportedTypes].sort())) {
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
    return [type, instances.reduce((sum, asset) => sum + asset.bounds.height * asset.visualScaleMultiplier, 0) / instances.length];
  }));
  const expectedVisualHeights = { "green-archer": 1.518 * 0.95, battlemage: 1.594 * 0.9, sovereign: 1.747 * 0.9 };
  if (Object.entries(expectedVisualHeights).some(([type, expected]) =>
    Math.abs(visualHeights[type] - expected) > 0.025)) {
    throw new Error(`Defender crowding scale or visual-height normalization failed: ${JSON.stringify({ visualHeights, expectedVisualHeights })}`);
  }
  const typeToExpectedPath = expectedDefenderPaths;
  if (result.defenderTemplates.some((asset) => asset.assetPath !== typeToExpectedPath[asset.type])) {
    throw new Error(`Defender type resolved to the wrong GLB: ${JSON.stringify(result.defenderTemplates)}`);
  }
  const holyEmperorVisual = result.defenderInstances?.findLast((asset) => asset.id === visualState.holyEmperorId);
  if (!holyEmperorVisual || holyEmperorVisual.type !== "holy-emperor" || !holyEmperorVisual.optimized
    || holyEmperorVisual.primitiveFallback || holyEmperorVisual.assetPath !== typeToExpectedPath["holy-emperor"]
    || !holyEmperorVisual.bounds || holyEmperorVisual.bounds.width >= 1 || holyEmperorVisual.bounds.depth >= 1
    || Math.abs(holyEmperorVisual.bounds.height - 1.9) > 0.02 || holyEmperorVisual.targetVisualHeight <= 1.747
    || Math.abs(holyEmperorVisual.bounds.minY) > 0.01) {
    throw new Error(`Holy Emperor GLB instance or bounds check failed: ${JSON.stringify(holyEmperorVisual)}`);
  }
  if (!result.selection.visible || !result.selection.markerVisible || result.selection.markerPosition.y <= 0.2) {
    throw new Error(`Selection ring/diamond failed for imported defender: ${JSON.stringify(result.selection)}`);
  }
  const selectedSovereignVisual = newTypeInstances.findLast((asset) => asset.id === visualState.placedIds[24]);
  if (!selectedSovereignVisual || result.selection.markerPosition.y <= selectedSovereignVisual.bounds.maxY + 0.2) {
    throw new Error(`Selection diamond intersects the Sovereign model: ${JSON.stringify({ selection: result.selection, visual: selectedSovereignVisual })}`);
  }
  if (visualState.archer.name !== "Green Archer" || visualState.archer.role !== "Anti-Air · 4× flying damage · reduced ground damage"
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
    || visualState.selectedSovereign.name !== "Sovereign" || visualState.selectedSovereign.level !== "Level 1 · P1"
    || visualState.selectedSovereign.profiles.length !== 3 || visualState.selectedSovereign.range !== "Range4.5 Tiles"
    || visualState.sovereignLevel2.level !== "Level 2 · P1" || !visualState.sovereignLevel2.profiles[0].includes("170 dmg · 1.65/s")
    || !visualState.sovereignLevel2.profiles[1].includes("105 dmg · 2.40/s")
    || !visualState.sovereignLevel2.profiles[2].includes("430 dmg · 0.60/s")
    || !visualState.sovereignBranchChoice.visible || visualState.sovereignBranchChoice.options.map(({ name }) => name).join("|") !== "Storm Regent|War Sovereign"
    || visualState.sovereignBranchChoice.options.some(({ disabled, cost }) => disabled || !cost.includes("200 Gold"))
    || visualState.sovereignBranchChoice.bounds.left < 0 || visualState.sovereignBranchChoice.bounds.right > 390
    || visualState.sovereignBranchChoice.bounds.top < 0 || visualState.sovereignBranchChoice.bounds.bottom > 844
    || visualState.sovereignLevel3.specialization !== "storm-regent" || visualState.sovereignLevel3.specializationLabel !== "STORM REGENT"
    || !visualState.sovereignLevel3.specializationDetail.includes("Every 3rd attack")
    || !visualState.archerBranchChoice.visible || visualState.archerBranchChoice.options.map(({ name }) => name).join("|") !== "Dragon Slayer|Ranger"
    || visualState.archerBranchChoice.options.some(({ disabled, cost }) => disabled || !cost.includes("70 Gold"))
    || visualState.archerBranchChoice.bounds.left < 0 || visualState.archerBranchChoice.bounds.right > 390
    || visualState.archerBranchChoice.bounds.top < 0 || visualState.archerBranchChoice.bounds.bottom > 844
    || visualState.archerLevel3.level !== "Level 3 · P1" || visualState.archerLevel3.specialization !== "dragon-slayer"
    || visualState.archerLevel3.specializationLabel !== "DRAGON SLAYER"
    || !visualState.archerLevel3.specializationDetail.includes("damage to air")
    || visualState.sovereignLevel3.level !== "Level 3 · P1" || visualState.sovereignLevel3.action !== "MAX LEVEL"
    || !visualState.sovereignLevel3.profiles[0].includes("360 dmg · 1.80/s")
    || !visualState.sovereignLevel3.profiles[1].includes("225 dmg · 2.60/s")
    || !visualState.sovereignLevel3.profiles[2].includes("950 dmg · 0.65/s")) {
    throw new Error(`Sovereign build/selected profile UI failed: ${JSON.stringify(visualState.sovereign)} / ${JSON.stringify(visualState.selectedSovereign)}`);
  }
  if (!Number.isFinite(result.sceneStats?.totalSceneTriangles)) throw new Error("Scene triangle telemetry was not populated.");
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
    // Let the viewport resize and the HUD/minimap ResizeObservers settle before assertions.
    await delay(100);
    if (viewport.width <= 390) {
      const infoLayout = await evaluate(`(() => {
        document.querySelector('#battlefield-info-toggle').click();
        const panel = document.querySelector('#battlefield-info-panel').getBoundingClientRect();
        const toggle = document.querySelector('#battlefield-info-toggle').getBoundingClientRect();
        const status = document.querySelector('.status-panel').getBoundingClientRect();
        const topHud = document.querySelector('.top-hud-bar').getBoundingClientRect();
        return { width: panel.width, height: panel.height, right: panel.right, viewportWidth: innerWidth,
          visible: !document.querySelector('#battlefield-info-panel').hidden,
          toggle: { x: toggle.x, y: toggle.y, width: toggle.width, height: toggle.height },
          status: { x: status.x, bottom: status.bottom }, topHud: { bottom: topHud.bottom } };
      })()`);
      if (!infoLayout.visible || infoLayout.width > viewport.width || infoLayout.right > viewport.width + 1
        || infoLayout.height >= viewport.height * 0.7 || infoLayout.toggle.width < 40 || infoLayout.toggle.height < 40
        || infoLayout.toggle.y < infoLayout.status.bottom - 1 || infoLayout.toggle.x > infoLayout.status.x + 2
        || infoLayout.toggle.y + infoLayout.toggle.height > infoLayout.topHud.bottom + 1) {
        throw new Error(`Battlefield info does not fit mobile viewport ${viewport.width}: ${JSON.stringify(infoLayout)}`);
      }
      await evaluate("document.querySelector('#battlefield-info-close').click()");
    }
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
      const selectedIndex = cards.indexOf(selected);
      const previousCard = cards[selectedIndex - 1], nextCard = cards[selectedIndex + 1];
      const visibleWidth = (card) => Math.max(0, Math.min(card.getBoundingClientRect().right, trayRect.right)
        - Math.max(card.getBoundingClientRect().left, trayRect.left));
      const selectedScale = new DOMMatrix(getComputedStyle(selected).transform).a;
      const adjacentScale = new DOMMatrix(getComputedStyle(previousCard ?? nextCard).transform).a;
      const waveElement = document.querySelector('#start-wave-button');
      const autoElement = document.querySelector('#auto-button');
      const minimapPanel = document.querySelector('#minimap-panel');
      const minimap = rect(minimapPanel);
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
        card: { width: selectedRect.width, height: selectedRect.height },
        visibleCards,
        trayScrollable: tray.scrollWidth > tray.clientWidth,
        selectedScale,
        adjacentScale,
        selectedCenterDelta: Math.abs((selectedRect.left + selectedRect.right - trayRect.left - trayRect.right) / 2),
        leftPreview: visibleWidth(previousCard),
        rightPreview: visibleWidth(nextCard),
        overflowAffordance: document.querySelector('.build-unit-section').classList.contains('has-overflow'),
        selectedCardVisible: selectedRect.left >= trayRect.left - 1 && selectedRect.right <= trayRect.right + 1,
        horizontalPageOverflow: document.documentElement.scrollWidth > innerWidth,
        touchAction: getComputedStyle(tray).touchAction,
        actionsVisible: wave.width > 0 && auto.width > 0 && wave.bottom <= innerHeight && auto.bottom <= innerHeight,
        minimap: {
          ...minimap,
          mapId: minimapPanel.dataset.mapId,
          dimensions: minimapPanel.dataset.mapDimensions,
          pointerEvents: getComputedStyle(minimapPanel).pointerEvents,
          panelBelowTray: minimap.bottom <= rect(document.querySelector('#tower-panel')).y - 4,
          clearOfActions: minimap.right < Math.min(wave.x, auto.x) - 4 || minimap.bottom < Math.min(wave.y, auto.y) - 4,
        },
        waveControls: {
          sameSize: Math.abs(wave.width - auto.width) < 0.5 && Math.abs(wave.height - auto.height) < 0.5,
          sameEdges: Math.abs(wave.x - auto.x) < 0.5 && Math.abs(wave.right - auto.right) < 0.5,
          sameRadius: getComputedStyle(waveElement).borderRadius === getComputedStyle(autoElement).borderRadius,
          width: wave.width, height: wave.height, radius: getComputedStyle(waveElement).borderRadius,
        },
        towerLayouts,
      };
    })()`);
    if (layout.card.width < 75 || layout.card.width > 98 || layout.card.height < 56 || layout.card.height > 70
      || (viewport.width < 600 && !layout.trayScrollable) || !layout.selectedCardVisible || layout.horizontalPageOverflow
      || layout.selectedScale < 0.97 || layout.selectedCenterDelta > 3 || layout.adjacentScale < 0.78 || layout.adjacentScale > 0.91
      || layout.leftPreview < 12 || layout.rightPreview < 12 || layout.touchAction !== "none" || !layout.actionsVisible
      || layout.minimap.width < (viewport.width < 600 ? 95 : 120)
      || layout.minimap.width > (viewport.width < 600 ? 106 : 140)
      || !layout.minimap.panelBelowTray || !layout.minimap.clearOfActions || layout.minimap.pointerEvents !== "none"
      || layout.minimap.mapId !== "single-spawn" || layout.minimap.dimensions !== "17x32"
      || !layout.waveControls.sameSize || !layout.waveControls.sameEdges || !layout.waveControls.sameRadius
      || layout.towerLayouts.some((tower) => tower.panel.width <= 0 || tower.upgrade.width < 92 || tower.sell.width < 104
        || tower.info.width < 30 || tower.info.width > 36 || tower.upgradeClip || tower.sellClip
        || tower.upgrade.right > tower.info.x + 1 || tower.info.right > tower.sell.x + 1
        || tower.actions.right > tower.panel.right + 1
        || (viewport.width <= 520 && (tower.actions.top < tower.stats.bottom - 1 || tower.actions.left < tower.panel.left - 1)))
      || layout.hudHeight > Math.min(310, viewport.height * 0.32)) {
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
  console.log("Minimap responsive checks passed", JSON.stringify(layouts.map(({ viewport, minimap }) => ({ viewport, minimap }))));
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
  if (!afterCancel.hidden || afterCancel.wave !== resetBeforeCancel.wave || !afterCancel.active
    || afterCancel.towers !== resetBeforeCancel.towers || afterCancel.auto !== resetBeforeCancel.auto
    || afterCancel.gold < resetBeforeCancel.gold) {
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
  const minimapAfterReset = await evaluate(`(() => ({
    towers: document.querySelector('#minimap-panel')?.dataset.towerCount,
    enemies: document.querySelector('#minimap-panel')?.dataset.enemyCount,
  }))()`);
  if (resetRunState.mapId !== 'single-spawn' || resetRunState.gold !== 100 || resetRunState.gold !== resetRunState.startingGold || resetRunState.lives !== 10
    || resetRunState.wave !== 1 || resetRunState.active || resetRunState.enemies !== 0 || resetRunState.towers !== 0 || resetRunState.auto) {
    throw new Error(`Restart Current Map did not reset the same run: ${JSON.stringify(resetRunState)}`);
  }
  if (minimapAfterReset.towers !== "0" || minimapAfterReset.enemies !== "0") {
    throw new Error(`Minimap retained stale markers after restart: ${JSON.stringify(minimapAfterReset)}`);
  }
  const inputCandidate = await evaluate(`(() => {
    const game = window.__towerDefenceGameState;
    const ui = window.__towerDefenceUi;
    game.gold = Math.max(game.gold, 5000);
    const canvas = document.querySelector('#game3d').getBoundingClientRect();
    const topHud = document.querySelector('.top-hud-bar').getBoundingClientRect();
    const bottomHud = document.querySelector('.bottom-hud-bar').getBoundingClientRect();
    let firstBuildable;
    let firstProjected;
    let bestClusterCandidate;
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
        && point.y > topHud.bottom + 12 && point.y < bottomHud.top - 12) {
        const adjacentBuildableCount = (() => {
          let count = 0;
          for (let neighborY = Math.max(0, y - 1); neighborY <= Math.min(game.grid.height - 1, y + 1); neighborY += 1) {
            for (let neighborX = Math.max(0, x - 1); neighborX <= Math.min(game.grid.width - 1, x + 1); neighborX += 1) {
              if (game.canPlaceBasicTower({ x: neighborX, y: neighborY }, 'blue-wizard') === 'placed') count += 1;
            }
          }
          return count;
        })();
        const candidate = { cell, ...point, adjacentBuildableCount };
        if (!bestClusterCandidate || adjacentBuildableCount > bestClusterCandidate.adjacentBuildableCount) bestClusterCandidate = candidate;
      }
    }
    if (bestClusterCandidate) return { ...bestClusterCandidate, canvas: { left: canvas.left, right: canvas.right, top: canvas.top, bottom: canvas.bottom }, topHud: { bottom: topHud.bottom }, bottomHud: { top: bottomHud.top } };
    return { diagnostic: true, firstBuildable, firstProjected, placementResults, gold: game.gold, gameOver: game.gameOver, canvas: { left: canvas.left, right: canvas.right, top: canvas.top, bottom: canvas.bottom, width: canvas.width, height: canvas.height }, topHud: { bottom: topHud.bottom }, bottomHud: { top: bottomHud.top }, grid: { width: game.grid.width, height: game.grid.height } };
  })()`);
  if (inputCandidate.diagnostic) throw new Error(`Could not find an unobstructed buildable cell for touch input smoke test: ${JSON.stringify(inputCandidate)}`);
  const defaultTool = await evaluate(`(() => ({
    selected: document.querySelector('#select-tool-button').getAttribute('aria-pressed'),
    wizardSelected: document.querySelector('#build-blue-wizard-button').getAttribute('aria-pressed'),
    buildMode: window.__towerDefenceInputDebug().buildMode,
  }))()`);
  if (defaultTool.selected !== 'true' || defaultTool.wizardSelected !== 'false' || defaultTool.buildMode !== 'SELECT') {
    throw new Error(`Fresh run did not default to Select: ${JSON.stringify(defaultTool)}`);
  }
  const infoPanelCheck = await evaluate(`(() => {
    document.querySelector('#battlefield-info-toggle').click();
    const panel = document.querySelector('#battlefield-info-panel');
    return { expanded: document.querySelector('#battlefield-info-toggle').getAttribute('aria-expanded'), visible: !panel.hidden,
      text: panel.textContent, bounds: panel.getBoundingClientRect().toJSON(), viewport: innerWidth };
  })()`);
  if (infoPanelCheck.expanded !== 'true' || !infoPanelCheck.visible || !infoPanelCheck.text.includes('ENEMY HP SCALING')
    || !infoPanelCheck.text.includes('AFFIXES UNLOCKED THIS RUN')
    || !infoPanelCheck.text.toLowerCase().includes('remain available for the rest of the run')
    || !infoPanelCheck.text.includes('Current multiplier') || infoPanelCheck.bounds.width > infoPanelCheck.viewport) {
    throw new Error(`Battlefield info panel failed to open/readably fit: ${JSON.stringify(infoPanelCheck)}`);
  }
  await evaluate("document.querySelector('#battlefield-info-close').click()");
  const towerCountBeforeTouch = await evaluate("window.__towerDefenceGameState.towers.length");
  const goldBeforeSelectTap = await evaluate("window.__towerDefenceGameState.gold");
  await tap(inputCandidate.x, inputCandidate.y);
  const selectTap = await evaluate(`({ towers: window.__towerDefenceGameState.towers.length, gold: window.__towerDefenceGameState.gold, action: window.__towerDefenceInputDebug().lastAction })`);
  if (selectTap.towers !== towerCountBeforeTouch || selectTap.gold !== goldBeforeSelectTap || !selectTap.action.includes('Select tool')) {
    throw new Error(`Select tool placed/spent gold on an empty cell: ${JSON.stringify(selectTap)}`);
  }
  const wizardButtonPoint = await evaluate(`(() => { const rect = document.querySelector('#build-blue-wizard-button').getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`);
  await tap(wizardButtonPoint.x, wizardButtonPoint.y);
  const wizardMode = await evaluate(`({ pressed: document.querySelector('#build-blue-wizard-button').getAttribute('aria-pressed'), mode: window.__towerDefenceInputDebug().buildMode })`);
  if (wizardMode.pressed !== 'true' || !wizardMode.mode.includes('blue-wizard')) throw new Error(`Wizard build tool failed to activate: ${JSON.stringify(wizardMode)}`);
  const goldBeforePlacement = await evaluate("window.__towerDefenceGameState.gold");
  await tap(inputCandidate.x, inputCandidate.y);
  const tapPlacement = await evaluate(`({
    towerCount: window.__towerDefenceGameState.towers.length,
    gold: window.__towerDefenceGameState.gold,
    state: window.__towerDefenceInputDebug(),
    selectPressed: document.querySelector('#select-tool-button').getAttribute('aria-pressed'),
    wizardPressed: document.querySelector('#build-blue-wizard-button').getAttribute('aria-pressed'),
  })`);
  if (tapPlacement.towerCount !== towerCountBeforeTouch + 1 || !tapPlacement.state.lastAction.includes("placed")
    || tapPlacement.gold !== goldBeforePlacement - 10 || tapPlacement.selectPressed !== 'false'
    || tapPlacement.wizardPressed !== 'true' || !tapPlacement.state.buildMode.includes('blue-wizard')) {
    throw new Error(`Mobile tap failed to place a defender while preserving build mode: ${JSON.stringify(tapPlacement)}`);
  }

  const firstWizardCell = inputCandidate.cell;
  const buildNextAdjacentWizard = async (placedCells) => {
    const candidate = await evaluate(`(() => {
      const game = window.__towerDefenceGameState, ui = window.__towerDefenceUi;
      const canvas = document.querySelector('#game3d').getBoundingClientRect();
      const top = document.querySelector('.top-hud-bar').getBoundingClientRect();
      const bottom = document.querySelector('.bottom-hud-bar').getBoundingClientRect();
      const origins = ${JSON.stringify([firstWizardCell])}.concat(${JSON.stringify(placedCells)});
      const candidates = [];
      for (let y = 0; y < game.grid.height; y += 1) for (let x = 0; x < game.grid.width; x += 1) {
        const adjacent = origins.filter((origin) => Math.max(Math.abs(x - origin.x), Math.abs(y - origin.y)) <= 1).length;
        if (adjacent === 0) continue;
        const cell = { x, y };
        if (game.canPlaceBasicTower(cell, 'blue-wizard') !== 'placed') continue;
        const point = ui.projectCell(cell);
        if (point.x <= canvas.left + 15 || point.x >= canvas.right - 15 || point.y <= top.bottom + 12 || point.y >= bottom.top - 12) continue;
        candidates.push({ cell, ...point, adjacent });
      }
      return candidates.sort((a, b) => b.adjacent - a.adjacent)[0];
    })()`);
    if (!candidate) throw new Error('Could not find another visible, adjacent legal cell for sequential Wizard placement.');
    await tap(candidate.x, candidate.y);
    return candidate;
  };
  const sequentialPlacements = [];
  for (let index = 0; index < 4; index += 1) {
    sequentialPlacements.push(await buildNextAdjacentWizard(sequentialPlacements.map(({ cell }) => cell)));
  }
  await delay(120);
  const repeatedBuild = await evaluate(`(() => ({
    count: window.__towerDefenceGameState.towers.length,
    gold: window.__towerDefenceGameState.gold,
    buildMode: window.__towerDefenceInputDebug().buildMode,
    selectPressed: document.querySelector('#select-tool-button').getAttribute('aria-pressed'),
    wizardPressed: document.querySelector('#build-blue-wizard-button').getAttribute('aria-pressed'),
    triad: window.__towerDefenceGameState.towers.some(tower => tower.formationId === 'arcane-triad'),
    visuals: window.__towerDefenceUi.formationVisuals(),
  }))()`);
  if (repeatedBuild.count !== towerCountBeforeTouch + 5 || repeatedBuild.gold !== goldBeforePlacement - 50
    || repeatedBuild.selectPressed !== 'false' || repeatedBuild.wizardPressed !== 'true'
    || !repeatedBuild.buildMode.includes('blue-wizard') || !repeatedBuild.triad) {
    throw new Error(`Five sequential Wizard placements or Arcane Triad activation failed: ${JSON.stringify(repeatedBuild)}`);
  }
  const triadVisual = repeatedBuild.visuals.find(({ formationId }) => formationId === 'arcane-triad');
  if (!triadVisual || triadVisual.markerCount !== 4 || triadVisual.hasGroundRing) {
    throw new Error(`Formation feedback is not compact/ring-free: ${JSON.stringify(triadVisual ?? repeatedBuild.visuals)}`);
  }

  const invalidCell = await evaluate(`(() => {
    const game = window.__towerDefenceGameState, ui = window.__towerDefenceUi;
    const canvas = document.querySelector('#game3d').getBoundingClientRect();
    const top = document.querySelector('.top-hud-bar').getBoundingClientRect();
    const bottom = document.querySelector('.bottom-hud-bar').getBoundingClientRect();
    for (let y = 0; y < game.grid.height; y += 1) for (let x = 0; x < game.grid.width; x += 1) {
      const cell = { x, y };
      if (game.canPlaceBasicTower(cell, 'blue-wizard') !== 'invalid-cell' || game.towerAt(cell)) continue;
      const point = ui.projectCell(cell);
      if (point.x > canvas.left + 15 && point.x < canvas.right - 15 && point.y > top.bottom + 12 && point.y < bottom.top - 12) return { cell, ...point };
    }
  })()`);
  if (!invalidCell) throw new Error('No visible invalid terrain cell available for invalid-placement feedback test.');
  const towersBeforeInvalid = repeatedBuild.count;
  await tap(invalidCell.x, invalidCell.y);
  const invalidPlacement = await evaluate(`({ count: window.__towerDefenceGameState.towers.length, mode: window.__towerDefenceInputDebug().buildMode, action: window.__towerDefenceInputDebug().lastAction })`);
  if (invalidPlacement.count !== towersBeforeInvalid || !invalidPlacement.mode.includes('blue-wizard') || !invalidPlacement.action.includes('rejected')) {
    throw new Error(`Invalid placement cancelled or changed build mode: ${JSON.stringify(invalidPlacement)}`);
  }
  const affordableCell = await evaluate(`(() => {
    const game = window.__towerDefenceGameState, ui = window.__towerDefenceUi;
    const canvas = document.querySelector('#game3d').getBoundingClientRect();
    const top = document.querySelector('.top-hud-bar').getBoundingClientRect();
    const bottom = document.querySelector('.bottom-hud-bar').getBoundingClientRect();
    for (let y = 0; y < game.grid.height; y += 1) for (let x = 0; x < game.grid.width; x += 1) {
      const cell = { x, y };
      if (game.canPlaceBasicTower(cell, 'blue-wizard') !== 'placed') continue;
      const point = ui.projectCell(cell);
      if (point.x > canvas.left + 15 && point.x < canvas.right - 15 && point.y > top.bottom + 12 && point.y < bottom.top - 12) return { cell, ...point };
    }
  })()`);
  if (!affordableCell) throw new Error('No visible legal cell available for insufficient-gold feedback test.');
  const beforeInsufficient = await evaluate(`(() => { const game = window.__towerDefenceGameState; game.gold = 0; return game.towers.length; })()`);
  await tap(affordableCell.x, affordableCell.y);
  const insufficientPlacement = await evaluate(`({ count: window.__towerDefenceGameState.towers.length, mode: window.__towerDefenceInputDebug().buildMode, action: window.__towerDefenceInputDebug().lastAction })`);
  await evaluate('window.__towerDefenceGameState.gold = 5000');
  if (insufficientPlacement.count !== beforeInsufficient || !insufficientPlacement.mode.includes('blue-wizard') || !insufficientPlacement.action.includes('not-enough-gold')) {
    throw new Error(`Insufficient gold cancelled or changed build mode: ${JSON.stringify(insufficientPlacement)}`);
  }
  await tap(inputCandidate.x, inputCandidate.y);
  await delay(100);
  const towerSelection = await evaluate(`({ ...window.__towerDefenceUi.selectionVisual(), mode: window.__towerDefenceInputDebug().buildMode })`);
  if (towerSelection.selectedTowerId === undefined || !towerSelection.visible || !towerSelection.mode.includes('blue-wizard')) {
    throw new Error(`Mobile tap failed to select the occupied tower: ${JSON.stringify(towerSelection)}`);
  }
  await tap(inputCandidate.x, inputCandidate.y);
  await delay(100);
  const towerDeselection = await evaluate("window.__towerDefenceUi.selectionVisual()");
  if (towerDeselection.selectedTowerId !== undefined || towerDeselection.visible) throw new Error(`Deselected tower kept its selection ring: ${JSON.stringify(towerDeselection)}`);
  await tap(inputCandidate.x, inputCandidate.y);
  await delay(100);
  const towerReselection = await evaluate("window.__towerDefenceUi.selectionVisual()");
  if (towerReselection.selectedTowerId === undefined || !towerReselection.visible) throw new Error(`Selection ring did not return on reselection: ${JSON.stringify(towerReselection)}`);
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
    || pinchResult.state.cameraMaxRadius !== 42
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
  if (traySwipe.scrollLeft <= 0 || traySwipe.touchAction !== "none"
    || Math.hypot(traySwipe.cameraTarget.x - cameraBeforeTraySwipe.x, traySwipe.cameraTarget.z - cameraBeforeTraySwipe.z) > 0.01) {
    throw new Error(`Build Units swipe did not stay isolated to the horizontal tray: ${JSON.stringify(traySwipe)}`);
  }
  const knightButton = await evaluate(`(() => {
    const button = document.querySelector('#build-holy-knight-button').getBoundingClientRect();
    return { x: button.left + button.width / 2, y: button.top + button.height / 2 };
  })()`);
  await tap(knightButton.x, knightButton.y);
  const buildCardTap = await evaluate(`({
    pressed: document.querySelector('#build-holy-knight-button').getAttribute('aria-pressed'),
    buildMode: window.__towerDefenceInputDebug().buildMode,
  })`);
  if (buildCardTap.pressed !== "true" || !buildCardTap.buildMode.includes("holy-knight")) {
    throw new Error(`Build Unit card touch did not select Knight: ${JSON.stringify(buildCardTap)}`);
  }
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  const escapeCancelled = await evaluate(`({ select: document.querySelector('#select-tool-button').getAttribute('aria-pressed'), mode: window.__towerDefenceInputDebug().buildMode })`);
  if (escapeCancelled.select !== 'true' || escapeCancelled.mode !== 'SELECT') throw new Error(`Escape did not cancel placement mode: ${JSON.stringify(escapeCancelled)}`);
  const selectToolPoint = await evaluate(`(() => { const rect = document.querySelector('#select-tool-button').getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`);
  await tap(selectToolPoint.x, selectToolPoint.y);
  const selectTapCancel = await evaluate(`({ select: document.querySelector('#select-tool-button').getAttribute('aria-pressed'), mode: window.__towerDefenceInputDebug().buildMode })`);
  if (selectTapCancel.select !== 'true' || selectTapCancel.mode !== 'SELECT') throw new Error(`Touching Select did not cancel placement mode: ${JSON.stringify(selectTapCancel)}`);
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
  await delay(250);
  const minimapEnemyBeforeMove = await evaluate(`(() => {
    const panel = document.querySelector('#minimap-panel');
    const canvas = document.querySelector('#game-minimap');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let redPixels = 0;
    let hash = 2166136261;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 180 && pixels[index + 1] < 130 && pixels[index + 2] < 150) redPixels += 1;
      hash = Math.imul(hash ^ pixels[index], 16777619);
    }
    return { enemies: Number(panel.dataset.enemyCount), towers: Number(panel.dataset.towerCount), redPixels, hash: hash >>> 0 };
  })()`);
  await delay(300);
  const minimapEnemyAfterMove = await evaluate(`(() => {
    const panel = document.querySelector('#minimap-panel');
    const canvas = document.querySelector('#game-minimap');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let redPixels = 0;
    let hash = 2166136261;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 180 && pixels[index + 1] < 130 && pixels[index + 2] < 150) redPixels += 1;
      hash = Math.imul(hash ^ pixels[index], 16777619);
    }
    return { enemies: Number(panel.dataset.enemyCount), redPixels, hash: hash >>> 0 };
  })()`);
  if (minimapEnemyBeforeMove.enemies < 1 || minimapEnemyBeforeMove.redPixels < 1
    || minimapEnemyAfterMove.enemies < 1 || minimapEnemyAfterMove.redPixels < 1
    || minimapEnemyBeforeMove.hash === minimapEnemyAfterMove.hash) {
    throw new Error(`Minimap enemy dots were absent or did not move: ${JSON.stringify({ minimapEnemyBeforeMove, minimapEnemyAfterMove })}`);
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
    pinch: { radiusBefore: radiusBeforePinch, radiusAfter: pinchResult.state.cameraRadius, maxRadius: pinchResult.state.cameraMaxRadius,
      action: pinchResult.state.lastAction, towersUnchanged: pinchResult.towers === towersBeforePan },
    traySwipe: { scrollLeft: traySwipe.scrollLeft, touchAction: traySwipe.touchAction, cameraUnchanged: true },
    buildCardTap, autoToggledOn, autoToggledOff, waveStarted, minimapEnemyBeforeMove, minimapEnemyAfterMove,
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
  // The current carousel owns horizontal drag/pointer capture, so native touch handling is intentionally disabled.
  if (inputSurfaceAudit.canvasTouchAction !== "none" || inputSurfaceAudit.trayTouchAction !== "none"
    || inputSurfaceAudit.buttonTouchAction !== "manipulation" || inputSurfaceAudit.gameUiPointerEvents !== "none"
    || inputSurfaceAudit.appCornerOverlayPointerEvents !== "none" || inputSurfaceAudit.battlefieldHitTarget !== "game3d"
    || !inputSurfaceAudit.resetOverlayHidden) {
    throw new Error(`Battlefield/UI pointer-event layers are misconfigured: ${JSON.stringify(inputSurfaceAudit)}`);
  }
  const affixWarningQueued = await evaluate(`(() => {
    const game = window.__towerDefenceGameState;
    game.resetGame('try-again');
    game.wavesStarted = 14;
    game.currentWave = 14;
    game.autoRun = true;
    const started = game.startWave();
    const actual = window.__towerDefenceUi.expectedAffixRoll();
    return { started, warningTier: game.affixWarning.tier, actual, enemies: game.enemies.length, pending: game.enemiesRemaining };
  })()`);
  let affixWarningStart;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    affixWarningStart = await evaluate(`(() => {
      const warning = document.querySelector('#hp-scaling-warning');
      const cards = [...warning.querySelectorAll('.wave-warning-affix')].map((card) => ({ name: card.querySelector('strong')?.textContent.trim(), effect: card.querySelector('small')?.textContent.trim() }));
      return { ...${JSON.stringify(affixWarningQueued)}, title: warning.querySelector('#wave-warning-title').textContent,
        body: warning.querySelector('#wave-warning-body').textContent,
        visible: !warning.hidden, cards, zIndex: getComputedStyle(warning).zIndex,
        uiWave: document.querySelector('#stat-wave').textContent.trim(), stateWave: window.__towerDefenceGameState.currentWave };
    })()`);
    if (affixWarningStart.visible && affixWarningStart.cards.length === 2) break;
    await delay(100);
  }
  if (!affixWarningStart.started || !affixWarningStart.visible || affixWarningStart.warningTier !== 1
    || affixWarningStart.title !== 'ENEMY AFFIXES AWAKEN' || affixWarningStart.actual.length !== 2
    || !affixWarningStart.body?.toLowerCase().includes('from this wave onward')
    || affixWarningStart.cards.length !== 2 || affixWarningStart.cards.some((card) => !card.name || !card.effect)
    || affixWarningStart.actual.some((affix, index) => affix.name.toUpperCase() !== affixWarningStart.cards[index].name)
    || affixWarningStart.enemies !== 0 || affixWarningStart.pending < 1 || Number(affixWarningStart.zIndex) < 22) {
    throw new Error(`Wave 15 warning did not show the actual rolled affixes or hold Auto Run spawning: ${JSON.stringify(affixWarningStart)}`);
  }
  await delay(2500);
  const affixWarningStillVisible = await evaluate(`(() => ({ visible: !document.querySelector('#hp-scaling-warning').hidden,
    enemies: window.__towerDefenceGameState.enemies.length, pending: window.__towerDefenceGameState.enemiesRemaining }))()`);
  if (!affixWarningStillVisible.visible || affixWarningStillVisible.enemies !== 0 || affixWarningStillVisible.pending < 1) {
    throw new Error(`Wave 15 affix warning did not hold for five seconds: ${JSON.stringify(affixWarningStillVisible)}`);
  }
  let affixWarningReleased;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    affixWarningReleased = await evaluate(`(() => ({ visible: !document.querySelector('#hp-scaling-warning').hidden,
      hiding: document.querySelector('#hp-scaling-warning').classList.contains('is-hiding'),
      warningActive: !!window.__towerDefenceGameState.affixWarning,
      enemies: window.__towerDefenceGameState.enemies.length, auto: window.__towerDefenceGameState.autoRun }))()`);
    if (!affixWarningReleased.warningActive && affixWarningReleased.enemies > 0) break;
    await delay(100);
  }
  if (affixWarningReleased.warningActive || affixWarningReleased.enemies < 1 || !affixWarningReleased.auto
    || (affixWarningReleased.visible && !affixWarningReleased.hiding)) {
    throw new Error(`Auto Run did not resume spawning after the five-second affix warning: ${JSON.stringify(affixWarningReleased)}`);
  }
  await evaluate(`(() => {
    window.__towerDefenceGameState.autoRun = true;
    document.querySelector('#reset-menu-button').click();
    document.querySelector('#return-map-select-button').click();
  })()`);
  let returnedToMapSelect = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    returnedToMapSelect = await evaluate(`(() => !!document.querySelector('.map-select-screen')
      && !document.querySelector('#game3d') && !document.querySelector('#minimap-panel') && !window.__towerDefenceGameState)()`);
    if (returnedToMapSelect) break;
    await delay(50);
  }
  const mapSelectAfterReturn = await evaluate(`(() => ({
    selectedMap: document.querySelector('.map-choice-card.is-selected')?.dataset.mapId,
    startEnabled: !document.querySelector('#start-selected-map').disabled,
    canvasCount: document.querySelectorAll('#game3d').length,
    gameStateAvailable: !!window.__towerDefenceGameState,
    minimapCount: document.querySelectorAll('#minimap-panel, #game-minimap').length,
  }))()`);
  if (!returnedToMapSelect || mapSelectAfterReturn.selectedMap !== "single-spawn"
    || !mapSelectAfterReturn.startEnabled || mapSelectAfterReturn.canvasCount !== 0 || mapSelectAfterReturn.gameStateAvailable
    || mapSelectAfterReturn.minimapCount !== 0) {
    throw new Error(`Return to Map Select did not cleanly end the run: ${JSON.stringify({ returnedToMapSelect, mapSelectAfterReturn })}`);
  }
  await evaluate(`(() => {
    document.querySelector('.map-choice-card[data-map-id="two-spawns"]').click();
    document.querySelector('#start-selected-map').click();
  })()`);
  let twoSpawnFactionReady = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    twoSpawnFactionReady = await evaluate(`!!document.querySelector('.faction-select-screen')`);
    if (twoSpawnFactionReady) break;
    await delay(50);
  }
  const twoSpawnFactionGold = await evaluate("document.querySelector('.faction-select-screen .map-select-footer > span')?.textContent.trim()");
  if (!twoSpawnFactionReady || !twoSpawnFactionGold?.includes("135 Gold")) {
    throw new Error(`Two-spawn faction screen showed the wrong starting gold: ${twoSpawnFactionGold}`);
  }
  await evaluate("document.querySelector('#start-battlefield').click()");
  let twoSpawnRunReady = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    twoSpawnRunReady = await evaluate(`(() => window.__towerDefenceGameState?.map.id === "two-spawns")()`);
    if (twoSpawnRunReady) break;
    await delay(100);
  }
  const twoSpawnStartedGold = await evaluate("window.__towerDefenceGameState?.gold");
  if (!twoSpawnRunReady || twoSpawnStartedGold !== 135) {
    throw new Error(`Two-spawn map started with ${twoSpawnStartedGold} gold instead of 135.`);
  }
  await evaluate(`(() => {
    document.querySelector('#reset-menu-button').click();
    document.querySelector('#return-map-select-button').click();
  })()`);
  let returnedFromTwoSpawn = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    returnedFromTwoSpawn = await evaluate(`(() => !!document.querySelector('.map-select-screen') && !window.__towerDefenceGameState)()`);
    if (returnedFromTwoSpawn) break;
    await delay(50);
  }
  const selectedAfterTwoSpawn = await evaluate("document.querySelector('.map-choice-card.is-selected')?.dataset.mapId");
  if (!returnedFromTwoSpawn || selectedAfterTwoSpawn !== "two-spawns") {
    throw new Error(`Returning from the two-spawn run lost the selected map: ${selectedAfterTwoSpawn}`);
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
  let threeSpawnFactionReady = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    threeSpawnFactionReady = await evaluate(`(() => !!document.querySelector('.faction-select-screen')
      && !document.querySelector('#game3d') && !document.querySelector('#minimap-panel'))()`);
    if (threeSpawnFactionReady) break;
    await delay(50);
  }
  const threeSpawnFaction = await evaluate(`(() => ({
    name: document.querySelector('.faction-choice-copy strong')?.textContent.trim().toUpperCase(),
    startText: document.querySelector('#start-battlefield')?.textContent.trim().replace(/\\s+/g, ' ').toUpperCase(),
    selectedMap: document.querySelector('.faction-select-screen .map-select-footer > span')?.textContent.trim(),
  }))()`);
  if (!threeSpawnFactionReady || threeSpawnFaction.name !== "ROYAL GUARD"
    || threeSpawnFaction.startText !== "CONTINUE WITH ROYAL GUARD →"
    || !threeSpawnFaction.selectedMap?.startsWith("Triple Convergence")) {
    throw new Error(`Three-spawn map was not carried through faction selection: ${JSON.stringify({ threeSpawnFactionReady, threeSpawnFaction })}`);
  }
  await evaluate("document.querySelector('#start-battlefield').click()");
  let newMapRunReady = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    newMapRunReady = await evaluate(`(() => !!window.__towerDefenceGameState
      && window.__towerDefenceGameState.map.id === "three-spawns")()`);
    if (newMapRunReady) break;
    await delay(100);
  }
  const restartedMapState = await evaluate(`(() => ({
    mapId: window.__towerDefenceGameState?.map.id,
    gold: window.__towerDefenceGameState?.gold,
    wave: window.__towerDefenceGameState?.currentWave,
    active: window.__towerDefenceGameState?.waveActive,
    auto: window.__towerDefenceGameState?.autoRun,
    canvasCount: document.querySelectorAll('#game3d').length,
    minimapCount: document.querySelectorAll('#minimap-panel, #game-minimap').length,
  }))()`);
  if (!newMapRunReady || restartedMapState.mapId !== "three-spawns" || restartedMapState.gold !== 150 || restartedMapState.wave !== 1
    || restartedMapState.active || restartedMapState.auto || restartedMapState.canvasCount !== 1 || restartedMapState.minimapCount !== 2) {
    throw new Error(`Starting a newly selected map after returning failed: ${JSON.stringify(restartedMapState)}`);
  }
  const newMapMinimap = await evaluate(`(() => {
    const panel = document.querySelector('#minimap-panel');
    return panel ? {
      mapId: panel.dataset.mapId,
      dimensions: panel.dataset.mapDimensions,
      terrainCells: Number(panel.dataset.terrainCells),
      spawnCount: Number(panel.dataset.spawnCount),
      goalCell: panel.dataset.goalCell,
      towers: panel.dataset.towerCount,
      enemies: panel.dataset.enemyCount,
    } : null;
  })()`);
  if (!newMapMinimap || newMapMinimap.mapId !== "three-spawns" || newMapMinimap.dimensions !== "43x66"
    || newMapMinimap.terrainCells !== 1041 || newMapMinimap.spawnCount !== 3 || newMapMinimap.goalCell !== "21,65"
    || newMapMinimap.towers !== "0" || newMapMinimap.enemies !== "0") {
    throw new Error(`Three-spawn minimap did not rebuild cleanly: ${JSON.stringify(newMapMinimap)}`);
  }
  if (process.env.SAVE_THREE_SPAWN_LAYOUT_SCREENSHOTS === "1") {
    await command("Emulation.setDeviceMetricsOverride", { width: 1100, height: 1450, deviceScaleFactor: 1, mobile: false });
    await delay(700);
    const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
    const screenshotDirectory = path.resolve(__dirname, "../artifacts/three-spawn-layout");
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    const fileName = "gameplay-three-spawn.png";
    fs.writeFileSync(path.join(screenshotDirectory, fileName), Buffer.from(screenshot.data, "base64"));
    mapReviewScreenshots.push(path.join(screenshotDirectory, fileName));

    const mapOverview = await evaluate(`(() => {
      const canvas = document.querySelector('#game-minimap');
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`);
    const overviewShot = await command("Page.captureScreenshot", {
      format: "png", fromSurface: true,
      clip: { ...mapOverview, scale: 1 },
    });
    fs.writeFileSync(path.join(screenshotDirectory, "gameplay-full-map-minimap.png"), Buffer.from(overviewShot.data, "base64"));

    const minimapSamples = [];
    const debugPositions = [
      { name: "top", x: 21, y: 5 }, { name: "center", x: 21, y: 33 }, { name: "bottom", x: 21, y: 60 },
      { name: "left", x: 3, y: 33 }, { name: "right", x: 40, y: 33 },
    ];
    for (const position of debugPositions) {
      await evaluate(`window.__towerDefenceMinimapDebug.setTarget(${position.x}, ${position.y})`);
      let sample;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        sample = await evaluate(`(() => {
          const debug = window.__towerDefenceMinimapDebug.snapshot();
          const canvas = document.querySelector('#game-minimap');
          return {
            cameraTargetWorld: debug.targetWorld,
            logicalGrid: debug.logicalCenter,
            renderedGrid: { x: Number(canvas.dataset.cameraGridX), y: Number(canvas.dataset.cameraGridY) },
            minimap: { x: Number(canvas.dataset.cameraMinimapX), y: Number(canvas.dataset.cameraMinimapY) },
            viewport: { x: debug.view.x, y: debug.view.y, width: debug.view.width, height: debug.view.height, canvasHeight: canvas.getBoundingClientRect().height },
            map: debug.map,
          };
        })()`);
        if (Math.abs(sample.renderedGrid.x - position.x) < 1 && Math.abs(sample.renderedGrid.y - position.y) < 1) break;
        await delay(100);
      }
      if (Math.abs(sample.logicalGrid.y - position.y) > 1.5 || Math.abs(sample.logicalGrid.x - position.x) > 1.5
        || Math.abs(sample.renderedGrid.y - position.y) > 1 || Math.abs(sample.renderedGrid.x - position.x) > 1
        || sample.map.width !== 43 || sample.map.height !== 66
        || (position.name === "top" && sample.minimap.y >= sample.viewport.canvasHeight / 2)
        || (position.name === "center" && Math.abs(sample.minimap.y - sample.viewport.canvasHeight / 2) > sample.viewport.canvasHeight * 0.12)
        || (position.name === "bottom" && sample.minimap.y <= sample.viewport.canvasHeight / 2)) {
        throw new Error(`Minimap ${position.name} camera placement failed: ${JSON.stringify(sample)}`);
      }
      minimapSamples.push({ ...position, ...sample });
      if (position.name === "top" || position.name === "bottom") {
        const debugShot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
        fs.writeFileSync(path.join(screenshotDirectory, `gameplay-minimap-${position.name}.png`), Buffer.from(debugShot.data, "base64"));
      }
    }
    if (!(minimapSamples[0].minimap.y < minimapSamples[2].minimap.y)
      || !(minimapSamples[0].viewport.y < minimapSamples[2].viewport.y)
      || !(minimapSamples[3].minimap.x < minimapSamples[4].minimap.x)
      || !(minimapSamples[3].viewport.x < minimapSamples[4].viewport.x)) {
      throw new Error(`Minimap viewport Y is mirrored: ${JSON.stringify(minimapSamples)}`);
    }
    mapReviewScreenshots.push(...[
      path.join(screenshotDirectory, "gameplay-full-map-minimap.png"),
      path.join(screenshotDirectory, "gameplay-minimap-top.png"),
      path.join(screenshotDirectory, "gameplay-minimap-bottom.png"),
    ]);
    console.log("Minimap top/bottom camera checks passed", JSON.stringify(minimapSamples));
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
    gameHudLayouts: layouts.map(({ viewport, hudHeight, card, visibleCards, trayScrollable, actionsVisible, waveControls, minimap, towerLayouts }) => ({
      viewport, hudHeight, card, visibleCards, trayScrollable, actionsVisible, waveControls, minimap,
      towerLayouts: towerLayouts.map(({ type, level, panel, stats, actions, upgrade, info, sell, upgradeClip, sellClip }) => ({
        type, level, panel, stats, actions, upgrade, info, sell, upgradeClip, sellClip,
      })),
    })),
    futureUnitHudHeight, screenshots, mapReviewScreenshots, runtimeFilesServed: paths.length,
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
