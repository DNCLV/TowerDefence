// Browser smoke test for selected-tower readability at narrow portrait sizes.
// Requires npm run dev and Google Chrome on this machine.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "td-qol-selection-"));
const pending = new Map();
let chrome;
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
  await command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await command("Emulation.setDeviceMetricsOverride", { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
  await command("Page.navigate", { url: "http://127.0.0.1:5173/?waveDebug=1&disableEnvironmentProps=1" });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate("!!window.__towerDefenceUi && document.querySelector('.game-title')?.textContent === 'Tower Defence'")) break;
    if (attempt === 99) throw new Error("Game UI did not initialize.");
    await delay(250);
  }

  const results = [];
  for (const [width, height] of [[360, 800], [390, 844]]) {
    console.log(`Testing touch selection at ${width}x${height}`);
    await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    await command("Page.navigate", { url: "http://127.0.0.1:5173/?waveDebug=1&disableEnvironmentProps=1" });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await evaluate("!!window.__towerDefenceUi && document.querySelector('.game-title')?.textContent === 'Tower Defence'")) break;
      if (attempt === 99) throw new Error(`Game UI did not initialize at ${width}x${height}.`);
      await delay(250);
    }
    const ids = await evaluate("window.__towerDefenceUi.createDenseTowerTestLayout()");
    console.log(`Created ${ids.length} towers`);
    if (ids.length < 12) throw new Error(`Dense test layout placed only ${ids.length} towers at ${width}x${height}.`);
    const projectedTowers = await evaluate(`(() => {
      const state=window.__towerDefenceGameState, ui=window.__towerDefenceUi;
      return ${JSON.stringify(ids)}.map(id=>{const tower=state.towers.find(item=>item.id===id);return {id,cell:tower.cell,screen:ui.projectCell(tower.cell)};});
    })()`);
    console.log("Projected tower positions");
    const bounds = await evaluate(`(() => {const canvas=document.querySelector('#game3d'),r=canvas.getBoundingClientRect(),t=document.querySelector('.top-hud-bar').getBoundingClientRect(),b=document.querySelector('.bottom-hud-bar').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,safeTop:t.bottom+4,safeBottom:b.top-4};})()`);
    const visibleTowers = projectedTowers.filter(({ screen }) => screen.x > bounds.left + 8 && screen.x < bounds.right - 8
      && screen.y > bounds.safeTop && screen.y < bounds.safeBottom);
    if (visibleTowers.length < 3) throw new Error(`Too few test towers are visible in the gameplay area at ${width}x${height}.`);
    const centerY = (bounds.safeTop + bounds.safeBottom) / 2;
    const centerTower = visibleTowers.reduce((best, tower) => Math.hypot(tower.screen.x - width / 2, tower.screen.y - centerY)
      < Math.hypot(best.screen.x - width / 2, best.screen.y - centerY) ? tower : best);
    const edgeTower = visibleTowers.reduce((best, tower) => {
      const edgeDistance = Math.min(tower.screen.x - bounds.left, bounds.right - tower.screen.x, tower.screen.y - bounds.safeTop, bounds.safeBottom - tower.screen.y);
      const bestDistance = Math.min(best.screen.x - bounds.left, bounds.right - best.screen.x, best.screen.y - bounds.safeTop, bounds.safeBottom - best.screen.y);
      return edgeDistance < bestDistance ? tower : best;
    });
    const tapTower = async (tower) => {
      await command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: tower.screen.x, y: tower.screen.y, radiusX: 5, radiusY: 5, force: 1 }] });
      await command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await delay(100);
      return evaluate("window.__towerDefenceUi.selectionVisual()");
    };
    const centerSelection = await tapTower(centerTower);
    console.log("Center touch completed");
    if (centerSelection.selectedTowerId !== centerTower.id || !centerSelection.visible
      || !centerSelection.markerVisible || centerSelection.markerPosition.y <= 0.2) {
      throw new Error(`Touch did not select center tower ${centerTower.id} at ${width}x${height}: ${JSON.stringify(centerSelection)}`);
    }
    const neighborTower = visibleTowers.find((tower) => tower.id !== centerTower.id
      && Math.abs(tower.cell.x - centerTower.cell.x) + Math.abs(tower.cell.y - centerTower.cell.y) <= 2);
    let neighborTouchSelected = !neighborTower;
    if (neighborTower) {
      const neighborSelection = await tapTower(neighborTower);
      if (neighborSelection.selectedTowerId !== neighborTower.id || !neighborSelection.visible
        || !neighborSelection.markerVisible || neighborSelection.markerPosition.y <= 0.2) {
        throw new Error(`Touch did not move selection to neighboring tower ${neighborTower.id}: ${JSON.stringify(neighborSelection)}`);
      }
      neighborTouchSelected = neighborSelection.selectedTowerId === neighborTower.id;
    }
    const edgeSelection = await tapTower(edgeTower);
    console.log("Edge touch completed");
    if (edgeSelection.selectedTowerId !== edgeTower.id || !edgeSelection.visible
      || !edgeSelection.markerVisible || edgeSelection.markerPosition.y <= 0.2) {
      throw new Error(`Touch did not select screen-edge tower ${edgeTower.id} at ${width}x${height}: ${JSON.stringify(edgeSelection)}`);
    }
    const selectedId = edgeTower.id;
    const selectionChecks = { visibleTowerCount: visibleTowers.length, centerCell: centerTower.cell, neighborCell: neighborTower?.cell,
      edgeCell: edgeTower.cell, centerTouchSelected: centerSelection.selectedTowerId === centerTower.id,
      neighborTouchSelected, edgeTouchSelected: edgeSelection.selectedTowerId === edgeTower.id };
    await delay(900);
    const details = await evaluate(`(() => {
      const rect = (selector) => { const r=document.querySelector(selector).getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
      const visual=window.__towerDefenceUi.selectionVisual();
      const selected=document.querySelector('#tower-panel');
      const app=rect('#app'), bottom=rect('.bottom-hud-bar'), panel=rect('#tower-panel');
      return {width:innerWidth,height:innerHeight,visual,selectedVisible:!selected.hidden,selectedName:document.querySelector('.tower-name').textContent,
        selectedPanel:panel,bottomHud:bottom,app,hasHorizontalOverflow:document.documentElement.scrollWidth>innerWidth};
    })()`);
    if (!details.visual.visible || details.visual.selectedTowerId !== edgeTower.id || !details.visual.markerVisible
      || details.visual.markerPosition.y <= 0.2 || !details.selectedVisible || details.hasHorizontalOverflow
      || details.selectedPanel.left < 0 || details.selectedPanel.right > width
      || details.bottomHud.bottom > height + 1 || details.app.width > width + 1) {
      throw new Error(`Selected-tower UI does not fit ${width}x${height}: ${JSON.stringify(details)}`);
    }
    details.selectionChecks = selectionChecks;
    const sell = await evaluate(`(() => {
      const state=window.__towerDefenceGameState, ui=window.__towerDefenceUi;
      const tower=state.towers.find(candidate=>candidate.id===${selectedId});
      const before=state.gold;
      const button=document.querySelector('#sell-button');
      button.click();
      const confirmation=button.classList.contains('is-confirming')&&button.textContent.startsWith('CONFIRM');
      button.click();
      return {confirmation, sold:!state.towers.some(candidate=>candidate.id===${selectedId}),
        goldRefund:state.gold-before, selectionCleared:ui.selectionVisual().selectedTowerId===undefined,
        markerCleared:!ui.selectionVisual().markerVisible};
    })()`);
    if (!sell.confirmation || !sell.sold || sell.goldRefund !== 7 || !sell.selectionCleared || !sell.markerCleared) {
      throw new Error(`Inline sell flow failed at ${width}x${height}: ${JSON.stringify(sell)}`);
    }
    details.sell = sell;
    if (width === 360) {
      const warningShown = await evaluate(`(() => {
        const state=window.__towerDefenceGameState;
        state.currentWave=10; state.wavesStarted=10; state.waveActive=true; state.toSpawn=0; state.enemies=[]; state.autoRun=true;
        state.update(0.01, 0.01);
        return {warning:state.hpTierWarning,active:state.waveActive};
      })()`);
      await delay(250);
      const warningUi = await evaluate(`({visible:!document.querySelector('#hp-scaling-warning').hidden,
        copy:document.querySelector('#hp-scaling-warning').innerText.replace(/\\s+/g,' ').trim(),
        startDisabled:document.querySelector('#start-wave-button').disabled})`);
      if (!warningShown.warning || warningShown.active || !warningUi.visible || !warningUi.startDisabled
        || warningUi.copy !== 'THE HORDE GROWS STRONGER Dark forces gather beyond the gates. Stronger enemies are approaching. Prepare your defenses.') {
        throw new Error(`Tier warning did not display/lock correctly: ${JSON.stringify({ warningShown, warningUi })}`);
      }
      const warningWait = await evaluate(`({wave:window.__towerDefenceGameState.currentWave,
        active:window.__towerDefenceGameState.waveActive,warning:!!window.__towerDefenceGameState.hpTierWarning})`);
      if (warningWait.wave !== 10 || warningWait.active || !warningWait.warning) {
        throw new Error(`Auto Run did not wait during the tier warning: ${JSON.stringify(warningWait)}`);
      }
      details.warning = { ...warningUi, autoWaitsBeforeNextWave: true };
    }
    results.push({ ...details, denseTowerCount: ids.length, selectedId: edgeTower.id });
  }
  console.log(JSON.stringify({ viewports: results }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  socket?.close();
  chrome?.kill();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {} }, 1000).unref();
});
