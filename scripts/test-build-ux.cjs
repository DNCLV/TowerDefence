// Focused desktop/touch regression for persistent build tools and compact formation markers.
// Start the app with `npm run dev -- --host 127.0.0.1` first.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "td-build-ux-"));
const appUrl = process.env.TD_TEST_URL ?? "http://127.0.0.1:5173/";
const port = 9261;
const pending = new Map();
let browser;
let socket;
let nextId = 0;

async function command(method, params = {}) {
  const id = ++nextId;
  const response = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30000);
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
  browser = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--disable-extensions", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  let pages;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (browser.exitCode !== null) throw new Error(`Headless Chrome exited with code ${browser.exitCode}`);
    try { pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; }
    catch { await delay(250); }
  }
  if (!pages) throw new Error("Headless Chrome DevTools did not start.");
  socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message.result || message.error); pending.delete(message.id); }
  });
  await command("Runtime.enable");
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await command("Emulation.setTouchEmulationEnabled", { enabled: true, configuration: "mobile" });
  await command("Page.navigate", { url: `${appUrl}?waveDebug=1&inputDebug=1` });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate("!!document.querySelector('#start-selected-map')")) break;
    await delay(100);
  }
  await evaluate("document.querySelector('#start-selected-map').click()");
  await evaluate("document.querySelector('#start-battlefield').click()");
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const ready = await evaluate("!!window.__towerDefenceUi && document.querySelector('.game-ui')?.dataset.defenderAssetsReady === 'true'");
    if (ready) break;
    await delay(250);
  }
  const ready = await evaluate("!!window.__towerDefenceUi && document.querySelector('.game-ui')?.dataset.defenderAssetsReady === 'true'");
  if (!ready) throw new Error("Gameplay/defender visuals did not become ready.");

  const minimapBefore = await evaluate(`(() => ({ panel: document.querySelector('#minimap-panel').getBoundingClientRect().toJSON(),
    tab: document.querySelector('#minimap-toggle').getBoundingClientRect().toJSON(),
    dockClass: document.querySelector('#minimap-dock').className, inlineLeft: document.querySelector('#minimap-dock').style.left, left: getComputedStyle(document.querySelector('#minimap-dock')).left,
    transitionDuration: getComputedStyle(document.querySelector('#minimap-dock')).transitionDuration,
    expanded: document.querySelector('#minimap-toggle').getAttribute('aria-expanded'), arrow: document.querySelector('#minimap-toggle').innerText.trim(),
    canvas: document.querySelector('#game-minimap').width }))()`);
  // Headless Chrome may suspend CSS transitions between CDP calls; inspect final layout deterministically.
  await evaluate("document.querySelector('#minimap-dock').style.transition='none'; document.querySelector('#minimap-panel').style.transition='none'");
  await evaluate("document.querySelector('#minimap-toggle').click()"); await delay(260);
  await evaluate("document.querySelector('#minimap-dock').style.removeProperty('transition'); document.querySelector('#minimap-panel').style.removeProperty('transition')");
  const minimapClosed = await evaluate(`(() => ({ panel: document.querySelector('#minimap-panel').getBoundingClientRect().toJSON(),
    tab: document.querySelector('#minimap-toggle').getBoundingClientRect().toJSON(),
    dock: document.querySelector('#minimap-dock').getBoundingClientRect().toJSON(),
    panelVisibility: getComputedStyle(document.querySelector('#minimap-panel')).visibility,
    dockOverflow: getComputedStyle(document.querySelector('#minimap-dock')).overflow,
    dockClass: document.querySelector('#minimap-dock').className, inlineLeft: document.querySelector('#minimap-dock').style.left, left: getComputedStyle(document.querySelector('#minimap-dock')).left,
    expanded: document.querySelector('#minimap-toggle').getAttribute('aria-expanded'), arrow: document.querySelector('#minimap-toggle').innerText.trim(),
    canvas: document.querySelector('#game-minimap').width }))()`);
  await evaluate("document.querySelector('#minimap-toggle').click()"); await delay(260);
  const minimapReopened = await evaluate(`(() => ({ tab: document.querySelector('#minimap-toggle').getBoundingClientRect().toJSON(), dock: document.querySelector('#minimap-dock').getBoundingClientRect().toJSON(),
    dockClass: document.querySelector('#minimap-dock').className, inlineLeft: document.querySelector('#minimap-dock').style.left, left: getComputedStyle(document.querySelector('#minimap-dock')).left,
    expanded: document.querySelector('#minimap-toggle').getAttribute('aria-expanded'), canvas: document.querySelector('#game-minimap').width }))()`);
  if (minimapBefore.expanded !== 'true' || minimapBefore.arrow !== '‹' || minimapBefore.tab.left < minimapBefore.panel.right - 1
    || !minimapBefore.transitionDuration.startsWith('0.22s')
    || minimapClosed.expanded !== 'false' || minimapClosed.arrow !== '›' || minimapClosed.tab.left > 5
    || minimapClosed.dock.width > minimapClosed.tab.width + 1 || minimapClosed.dockOverflow !== 'hidden' || minimapClosed.panelVisibility !== 'hidden'
    || minimapReopened.expanded !== 'true' || minimapReopened.dock.width <= minimapReopened.tab.width || minimapReopened.canvas !== minimapBefore.canvas) {
    throw new Error(`Collapsible minimap state/layout failed: ${JSON.stringify({ minimapBefore, minimapClosed, minimapReopened })}`);
  }

  const carouselLayouts = [];
  for (const [width, height] of [[360, 800], [390, 844], [1280, 900]]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await evaluate("document.querySelector('#build-blue-wizard-button').click()");
    await delay(550);
    const layout = await evaluate(`(() => {
      const panel = document.querySelector('.defender-choice-panel');
      const selected = document.querySelector('.defender-choice.is-selected');
      const left = document.querySelector('#select-tool-button');
      const right = document.querySelector('#build-holy-knight-button');
      const rect = (element) => element.getBoundingClientRect();
      const viewport = rect(panel), card = rect(selected);
      const carousel = rect(document.querySelector('.build-carousel-shell'));
      const previous = rect(document.querySelector('#carousel-previous'));
      const next = rect(document.querySelector('#carousel-next'));
      const arrowsReserved = previous.right <= viewport.left + 1 && next.left >= viewport.right - 1
        && previous.left >= carousel.left && next.right <= carousel.right;
      const visible = (element) => Math.max(0, Math.min(rect(element).right, viewport.right) - Math.max(rect(element).left, viewport.left));
      return { width: innerWidth, hudHeight: rect(document.querySelector('.bottom-hud-bar')).height,
        scrollLeft: panel.scrollLeft, scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth,
        selectedOffsetLeft: selected.offsetLeft, firstOffsetLeft: left.offsetLeft,
        viewport: viewport.toJSON(), card: card.toJSON(),
        previous: previous.toJSON(), next: next.toJSON(), carousel: carousel.toJSON(),
        centerDelta: Math.abs((card.left + card.right - viewport.left - viewport.right) / 2),
        selectedScale: new DOMMatrix(getComputedStyle(selected).transform).a,
        adjacentScale: new DOMMatrix(getComputedStyle(right).transform).a,
        leftPreview: visible(left), rightPreview: visible(right), cardWidth: card.width,
        selectedId: selected.id, mode: window.__towerDefenceInputDebug().buildMode, arrowsReserved,
        rosterCount: panel.querySelectorAll('.defender-choice').length,
        expectedCount: window.__towerDefenceGameState.faction.units.length + 1,
        safeAreaPadding: parseFloat(getComputedStyle(document.querySelector('.bottom-hud-bar')).paddingBottom),
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    })()`);
    if (layout.centerDelta > 3 || layout.selectedId !== "build-blue-wizard-button" || !layout.mode.includes("blue-wizard")
      || layout.selectedScale < 0.97 || layout.adjacentScale < 0.78 || layout.adjacentScale > 0.91
      || layout.leftPreview < 12 || layout.rightPreview < 12 || layout.rosterCount !== layout.expectedCount
      || !layout.arrowsReserved || layout.hudHeight > 135 || layout.safeAreaPadding < 7 || layout.pageOverflow) {
      throw new Error(`Build carousel layout failed: ${JSON.stringify(layout)}`);
    }
    carouselLayouts.push(layout);
    if (process.env.TD_BUILD_CAROUSEL_SCREENSHOT === "1") {
      const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
      fs.writeFileSync(path.join(os.tmpdir(), `td-carousel-${width}.png`), Buffer.from(screenshot.data, "base64"));
    }
  }
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("document.querySelector('#select-tool-button').click()");
  await delay(450);
  await evaluate("document.querySelector('#carousel-next').click()");
  await delay(350);
  const nextSelection = await evaluate("document.querySelector('.defender-choice.is-selected')?.id");
  await evaluate("document.querySelector('#carousel-next').click()");
  await delay(350);
  await evaluate("document.querySelector('#carousel-previous').click()");
  await delay(350);
  const previousSelection = await evaluate("document.querySelector('.defender-choice.is-selected')?.id");
  await evaluate("document.querySelector('.defender-choice.is-selected').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))");
  await delay(350);
  const keyboardSelection = await evaluate("document.querySelector('.defender-choice.is-selected')?.id");
  await evaluate("document.querySelector('#build-holy-emperor-button').click()");
  await delay(500);
  const emperorSelection = await evaluate(`({ id: document.querySelector('.defender-choice.is-selected')?.id,
    ultimate: document.querySelector('#build-holy-emperor-button').classList.contains('is-ultimate'),
    nextDisabled: document.querySelector('#carousel-next').disabled,
    mode: window.__towerDefenceInputDebug().buildMode })`);
  if (nextSelection !== "build-blue-wizard-button" || previousSelection !== "build-blue-wizard-button"
    || keyboardSelection !== "build-holy-knight-button" || emperorSelection.id !== "build-holy-emperor-button"
    || !emperorSelection.ultimate || !emperorSelection.nextDisabled || !emperorSelection.mode.includes("holy-emperor")) {
    throw new Error(`Build carousel controls failed: ${JSON.stringify({ nextSelection, previousSelection, keyboardSelection, emperorSelection })}`);
  }
  await evaluate("document.querySelector('#build-blue-wizard-button').click()");
  await delay(350);
  const swipePoint = await evaluate(`(() => { const rect = document.querySelector('.defender-choice-panel').getBoundingClientRect();
    return { x: rect.left + rect.width * .62, y: rect.top + rect.height / 2 }; })()`);
  const swipeTouch = async (type, x) => command("Input.dispatchTouchEvent", {
    type, touchPoints: type === "touchEnd" ? [] : [{ id: 1, x, y: swipePoint.y, radiusX: 2, radiusY: 2, force: 1 }],
  });
  await swipeTouch("touchStart", swipePoint.x);
  for (const distance of [20, 45, 70, 95]) { await swipeTouch("touchMove", swipePoint.x - distance); await delay(24); }
  await swipeTouch("touchEnd", swipePoint.x - 95);
  await delay(500);
  const swipeSelection = await evaluate(`(() => { const selected = document.querySelector('.defender-choice.is-selected');
    const viewport = document.querySelector('.defender-choice-panel').getBoundingClientRect();
    const rect = selected.getBoundingClientRect();
    return { id: selected.id, delta: Math.abs((rect.left + rect.right - viewport.left - viewport.right) / 2),
      mode: window.__towerDefenceInputDebug().buildMode }; })()`);
  if (swipeSelection.id !== "build-holy-knight-button" || swipeSelection.delta > 3
    || !swipeSelection.mode.includes("holy-knight")) throw new Error(`Carousel touch swipe/snap failed: ${JSON.stringify(swipeSelection)}`);
  await evaluate("document.querySelector('#select-tool-button').click()");
  await delay(500);
  console.log("Build carousel browser layout and controls passed", JSON.stringify({ carouselLayouts, nextSelection, previousSelection, keyboardSelection, emperorSelection, swipeSelection }));

  // Mobile emulation also covers touch input below; activate this DOM control
  // directly here so the test focuses on its expanded state and layout.
  await evaluate("document.querySelector('#battlefield-info-toggle').click()");
  await delay(120);
  const infoPanelState = await evaluate(`(() => {
    const toggle = document.querySelector('#battlefield-info-toggle');
    const button = toggle.getBoundingClientRect(), status = document.querySelector('.status-panel').getBoundingClientRect();
    const hud = document.querySelector('.top-hud-bar').getBoundingClientRect();
    return { width: button.width, height: button.height, x: button.x, y: button.y,
      statusX: status.x, statusBottom: status.bottom, hudBottom: hud.bottom,
      expanded: toggle.getAttribute('aria-expanded'),
      visible: !document.querySelector('#battlefield-info-panel').hidden,
      text: document.querySelector('#battlefield-info-content').textContent };
  })()`);
  if (!infoPanelState.visible || infoPanelState.expanded !== "true" || infoPanelState.width < 40 || infoPanelState.height < 40 || infoPanelState.y < infoPanelState.statusBottom - 1
    || infoPanelState.x > infoPanelState.statusX + 2 || infoPanelState.y + infoPanelState.height > infoPanelState.hudBottom + 1
    || !infoPanelState.text.includes('Current multiplier') || !infoPanelState.text.toLowerCase().includes('remain available for the rest of the run')
    || !infoPanelState.text.includes('AFFIXES UNLOCKED THIS RUN')) throw new Error(`Run info UI layout/content failed: ${JSON.stringify(infoPanelState)}`);
  await evaluate("document.querySelector('#battlefield-info-close').click()");

  const milestoneWarnings = [];
  for (const [wave, title, phrase] of [
    [15, 'ENEMY AFFIXES AWAKEN', 'from this wave onward'],
    [30, 'THE HORDE GROWS DEADLIER', 'from this point onward'],
    [45, 'THE CURSE DEEPENS', 'for the rest of the run'],
  ]) {
    const started = await evaluate(`(() => {
      const game = window.__towerDefenceGameState;
      game.resetGame('try-again'); game.currentWave = ${wave - 1}; game.wavesStarted = ${wave - 1}; game.autoRun = true;
      return { started: game.startWave(), wave: game.currentWave };
    })()`);
    if (!started.started || started.wave !== wave) throw new Error(`Could not trigger Wave ${wave} warning test.`);
    let warning;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      warning = await evaluate(`(() => ({
        title: document.querySelector('#wave-warning-title').textContent,
        body: document.querySelector('#wave-warning-body').textContent,
        visible: !document.querySelector('#hp-scaling-warning').hidden,
        active: !!window.__towerDefenceGameState.affixWarning,
        enemies: window.__towerDefenceGameState.enemies.length,
        auto: window.__towerDefenceGameState.autoRun,
      }))()`);
      if (warning.visible && warning.title === title) break;
      await delay(100);
    }
    if (!warning.visible || !warning.active || warning.title !== title || !warning.body.toLowerCase().includes(phrase)
      || warning.enemies !== 0 || !warning.auto) throw new Error(`Wave ${wave} warning copy/hold failed: ${JSON.stringify(warning)}`);
    milestoneWarnings.push({ wave, ...warning });
  }
  await evaluate("window.__towerDefenceGameState.resetGame('try-again')");

  const touch = async (type, points) => command("Input.dispatchTouchEvent", { type, touchPoints: points });
  const tapCell = async (cell) => {
    const point = await evaluate(`window.__towerDefenceUi.projectCell(${JSON.stringify(cell)})`);
    await touch("touchStart", [{ ...point, id: 1, radiusX: 2, radiusY: 2, force: 1 }]);
    await delay(40);
    await touch("touchEnd", []);
    await delay(120);
  };
  const findCell = async (filter, origin) => evaluate(`(() => {
    const game = window.__towerDefenceGameState, ui = window.__towerDefenceUi;
    const canvas = document.querySelector('#game3d').getBoundingClientRect();
    const top = document.querySelector('.top-hud-bar').getBoundingClientRect();
    const bottom = document.querySelector('.bottom-hud-bar').getBoundingClientRect();
    const origin = ${JSON.stringify(origin)};
    const candidates = [];
    for (let y = 0; y < game.grid.height; y += 1) for (let x = 0; x < game.grid.width; x += 1) {
      const cell = { x, y }, result = game.canPlaceBasicTower(cell, 'blue-wizard');
      if (game.towerAt(cell) || !(${filter})) continue;
      const point = ui.projectCell(cell);
      if (point.x <= canvas.left + 15 || point.x >= canvas.right - 15 || point.y <= top.bottom + 12 || point.y >= bottom.top - 12) continue;
      candidates.push({ cell, ...point, distance: origin ? Math.hypot(x - origin.x, y - origin.y) : 0 });
    }
    return candidates.sort((a, b) => a.distance - b.distance)[0];
  })()`);

  const select = async (type) => evaluate(`document.querySelector('#build-${type}-button').click()`);
  const starting = await evaluate(`({ count: window.__towerDefenceGameState.towers.length, gold: window.__towerDefenceGameState.gold,
    selected: document.querySelector('#select-tool-button').getAttribute('aria-pressed') })`);
  if (starting.count !== 0 || starting.selected !== "true") throw new Error(`Fresh build state incorrect: ${JSON.stringify(starting)}`);
  await select("blue-wizard");
  const first = await findCell("result === 'placed'", undefined);
  if (!first) throw new Error("No visible legal Wizard placement found.");
  await tapCell(first.cell);
  for (let index = 1; index < 5; index += 1) {
    const next = await findCell("result === 'placed' && Math.max(Math.abs(x-origin.x), Math.abs(y-origin.y)) <= 2", first.cell);
    if (!next) throw new Error(`Could not find the next adjacent build cell (${index + 1}/5).`);
    await tapCell(next.cell);
  }
  const placed = await evaluate(`({ count: window.__towerDefenceGameState.towers.length, gold: window.__towerDefenceGameState.gold,
    buildMode: window.__towerDefenceInputDebug().buildMode,
    select: document.querySelector('#select-tool-button').getAttribute('aria-pressed'),
    wizard: document.querySelector('#build-blue-wizard-button').getAttribute('aria-pressed'),
    triad: window.__towerDefenceGameState.towers.some(tower => tower.formationId === 'arcane-triad'),
    visuals: window.__towerDefenceUi.formationVisuals() })`);
  if (placed.count !== 5 || placed.gold !== starting.gold - 50 || placed.select !== "false" || placed.wizard !== "true"
    || !placed.buildMode.includes("blue-wizard") || !placed.triad) throw new Error(`Repeated touch placement failed: ${JSON.stringify(placed)}`);
  const triad = placed.visuals.find((visual) => visual.formationId === "arcane-triad");
  if (!triad || triad.markerCount !== 4 || triad.hasGroundRing) throw new Error(`Formation still renders a ground ring or lost its local marks: ${JSON.stringify(triad)}`);
  await tapCell(first.cell);
  const selectedRing = await evaluate("({ visible: window.__towerDefenceUi.selectionVisual().visible, mode: window.__towerDefenceInputDebug().buildMode })");
  await tapCell(first.cell);
  const unselectedRing = await evaluate("({ visible: window.__towerDefenceUi.selectionVisual().visible, mode: window.__towerDefenceInputDebug().buildMode })");
  if (!selectedRing.visible || !selectedRing.mode.includes("blue-wizard") || unselectedRing.visible || !unselectedRing.mode.includes("blue-wizard")) {
    throw new Error(`Selection ring/build-tool distinction failed: ${JSON.stringify({ selectedRing, unselectedRing })}`);
  }

  const invalid = await findCell("result === 'invalid-cell'", undefined);
  if (!invalid) throw new Error("No visible invalid terrain cell found.");
  await tapCell(invalid.cell);
  const invalidResult = await evaluate("({ count: window.__towerDefenceGameState.towers.length, gold: window.__towerDefenceGameState.gold, mode: window.__towerDefenceInputDebug().buildMode, action: window.__towerDefenceInputDebug().lastAction })");
  if (invalidResult.count !== 5 || invalidResult.gold !== placed.gold || !invalidResult.mode.includes("blue-wizard") || !invalidResult.action.includes("rejected")) {
    throw new Error(`Invalid placement cancelled the build tool: ${JSON.stringify(invalidResult)}`);
  }
  const unaffordable = await findCell("result === 'placed'", undefined);
  await evaluate("window.__towerDefenceGameState.gold = 0");
  await tapCell(unaffordable.cell);
  const poorResult = await evaluate("({ count: window.__towerDefenceGameState.towers.length, mode: window.__towerDefenceInputDebug().buildMode, action: window.__towerDefenceInputDebug().lastAction })");
  await evaluate("window.__towerDefenceGameState.gold = 5000");
  if (poorResult.count !== 5 || !poorResult.mode.includes("blue-wizard") || !poorResult.action.includes("not-enough-gold")) {
    throw new Error(`Insufficient gold cancelled the build tool: ${JSON.stringify(poorResult)}`);
  }

  await select("holy-knight");
  const switched = await evaluate("({ mode: window.__towerDefenceInputDebug().buildMode, knight: document.querySelector('#build-holy-knight-button').getAttribute('aria-pressed') })");
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  const escaped = await evaluate("({ mode: window.__towerDefenceInputDebug().buildMode, select: document.querySelector('#select-tool-button').getAttribute('aria-pressed') })");
  if (!switched.mode.includes("holy-knight") || switched.knight !== "true" || escaped.mode !== "SELECT" || escaped.select !== "true") {
    throw new Error(`Unit switching/Escape failed: ${JSON.stringify({ switched, escaped })}`);
  }

  await command("Emulation.setTouchEmulationEnabled", { enabled: false });
  await command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await select("holy-knight");
  const desktopCell = await findCell("result === 'placed'", undefined);
  const desktopPoint = await evaluate(`window.__towerDefenceUi.projectCell(${JSON.stringify(desktopCell.cell)})`);
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: desktopPoint.x, y: desktopPoint.y, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: desktopPoint.x, y: desktopPoint.y, button: "left", clickCount: 1 });
  await delay(120);
  const desktop = await evaluate("({ mode: window.__towerDefenceInputDebug().buildMode, count: window.__towerDefenceGameState.towers.length })");
  if (!desktop.mode.includes("holy-knight") || desktop.count !== 6) throw new Error(`Desktop placement did not retain the selected unit: ${JSON.stringify(desktop)}`);
  const formationTowerId = await evaluate(`(() => { const tower = window.__towerDefenceGameState.towers.find((item) => item.formationId === 'arcane-triad');
    window.__towerDefenceUi.selectTower(tower.id); return tower.id; })()`);
  await delay(150);
  const inactiveBuffs = await evaluate(`(() => ({ labels: [...document.querySelectorAll('#tower-buff-icons button')]
    .map((button) => button.getAttribute('aria-label')), hudHeight: document.querySelector('.bottom-hud-bar').getBoundingClientRect().height,
    underPortrait: document.querySelector('.tower-portrait-stack .tower-buff-row')?.previousElementSibling?.classList.contains('tower-portrait'),
    iconsAccessible: [...document.querySelectorAll('#tower-buff-icons button')].every(button => !!button.getAttribute('aria-label')),
    veteran: document.querySelector('#tower-veteran').textContent,
    iconsOnly: !/[0-9%]/.test(document.querySelector('#tower-buff-icons').textContent) }))()`);
  if (!inactiveBuffs.labels.some((label) => label.includes('Arcane Triad'))
    || inactiveBuffs.labels.some((label) => label.includes('Veteran')) || !inactiveBuffs.iconsOnly
    || !inactiveBuffs.underPortrait || !inactiveBuffs.iconsAccessible
    || !inactiveBuffs.veteran.includes('40K TO VETERAN I') || inactiveBuffs.hudHeight > 230) {
    throw new Error(`Initial compact tower buffs/progress failed: ${JSON.stringify(inactiveBuffs)}`);
  }
  const veteranProgress = [];
  for (const damage of [39_999, 40_000, 150_000, 350_000]) {
    await evaluate(`(() => { window.__towerDefenceGameState.towers.find((item) => item.id === ${formationTowerId}).combatStats.damageDone = ${damage};
      window.__towerDefenceUi.selectTower(); window.__towerDefenceUi.selectTower(${formationTowerId}); })()`);
    veteranProgress.push(await evaluate(`(() => ({ text: document.querySelector('#tower-veteran').textContent,
      label: document.querySelector('#tower-veteran').getAttribute('aria-label'),
      icons: [...document.querySelectorAll('#tower-buff-icons button')].map((button) => button.getAttribute('aria-label')) }))()`));
  }
  if (!veteranProgress[0].text.includes('1 TO VETERAN I') || !veteranProgress[1].text.includes('110K TO VETERAN II')
    || !veteranProgress[2].text.includes('200K TO VETERAN III') || !veteranProgress[3].text.includes('MAX')
    || veteranProgress.some((progress) => progress.text.includes('%'))
    || veteranProgress.slice(1).some((progress) => !progress.icons.some((label) => label.includes('Veteran')))) {
    throw new Error(`Veteran thresholds/compact progress failed: ${JSON.stringify(veteranProgress)}`);
  }
  const specialization = await evaluate(`(() => { const game = window.__towerDefenceGameState;
    const result = { level2: game.upgradeBasicTower(${formationTowerId}), level3: game.upgradeBasicTower(${formationTowerId}, 'stormcaller') };
    window.__towerDefenceUi.selectTower(); window.__towerDefenceUi.selectTower(${formationTowerId}); return result; })()`);
  const specializedBuffs = await evaluate(`(() => ({
    labels: [...document.querySelectorAll('#tower-buff-icons button')].map((button) => button.getAttribute('aria-label')),
    specialization: document.querySelector('#tower-specialization').textContent,
    detailsHidden: getComputedStyle(document.querySelector('#tower-specialization-detail')).display === 'none',
    hudBuffText: document.querySelector('.tower-secondary-bonuses').innerText,
    hudHeight: document.querySelector('.bottom-hud-bar').getBoundingClientRect().height,
  }))()`);
  if (specialization.level2 !== 'upgraded' || specialization.level3 !== 'upgraded'
    || !specializedBuffs.labels.some((label) => label.includes('Stormcaller'))
    || !specializedBuffs.labels.some((label) => label.includes('Arcane Triad'))
    || specializedBuffs.specialization !== 'STORMCALLER' || !specializedBuffs.detailsHidden
    || specializedBuffs.hudBuffText.includes('%') || specializedBuffs.hudHeight > 230) {
    throw new Error(`Specialization buff icons failed: ${JSON.stringify({ specialization, specializedBuffs })}`);
  }
  if (process.env.TD_BUILD_CAROUSEL_SCREENSHOT === "1") {
    const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(os.tmpdir(), "td-carousel-selected-tower.png"), Buffer.from(screenshot.data, "base64"));
  }
  await evaluate("document.querySelector('#tower-buff-icons button').click()");
  const buffInfo = await evaluate(`({ open: !document.querySelector('#battlefield-info-panel').hidden,
    text: document.querySelector('#battlefield-info-content').textContent })`);
  if (!buffInfo.open || !buffInfo.text.includes('ACTIVE BUFFS') || !buffInfo.text.includes('Arcane Triad')
    || !buffInfo.text.includes('Stormcaller') || !buffInfo.text.includes('Veteran III')) {
    throw new Error(`Buff details were not accessible through Info: ${JSON.stringify(buffInfo)}`);
  }
  console.log("Build UX browser test passed", JSON.stringify({ infoPanel: infoPanelState, minimapBefore, minimapClosed, minimapReopened, milestoneWarnings, placed: placed.count, remainingGold: placed.gold, triad, selectedRing, unselectedRing, invalidResult, poorResult, switched, escaped, desktop, inactiveBuffs, veteranProgress, specialization, specializedBuffs, buffInfoOpen: buffInfo.open }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket) socket.close();
  if (browser && browser.exitCode === null) {
    const closed = new Promise((resolve) => browser.once("close", resolve));
    browser.kill();
    await Promise.race([closed, delay(3000)]);
  }
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); }
  catch (error) { console.warn("Temporary browser profile cleanup deferred:", error.message); }
});
