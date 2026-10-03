// Runtime smoke test for the Blue Wizard defender. Requires `npm run dev` to be running.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'td-wizard-'));
let chrome, socket;
const pending = new Map();
const consoleLines = [];
let id = 0;

async function command(method, params = {}) {
  const requestId = ++id;
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(requestId, value => { clearTimeout(timer); resolve(value); });
  });
  socket.send(JSON.stringify({ id: requestId, method, params }));
  return result;
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}

(async () => {
  const response = await fetch('http://127.0.0.1:5173/assets/models/defenders/blue-wizard.glb');
  if (!response.ok || Number(response.headers.get('content-length')) < 1_000_000) throw new Error('Wizard GLB is not being served correctly.');

  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-extensions', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=9240', '--user-data-dir=' + profile, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  await delay(1500);
  const pages = await (await fetch('http://127.0.0.1:9240/json')).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' ');
      consoleLines.push(text);
    }
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message.result || message.error); pending.delete(message.id); }
  });
  await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 540, height: 900, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: 'http://127.0.0.1:5173/?waveDebug=1' });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await evaluate("!!document.querySelector('.stat-row')")) break;
    if (attempt === 59) throw new Error('HUD did not initialize');
    await delay(250);
  }
  const layout = await evaluate(`(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; };
    return { stats: document.querySelectorAll('.stat-row').length, menuButtons: document.querySelectorAll('.menu-button').length,
      resetButton: !!document.querySelector('#reset-menu-button'), speedButton: document.querySelector('#speed-button').textContent,
      startWave: !document.querySelector('#start-wave-button').hidden, auto: !document.querySelector('#auto-button').hidden,
      panelInitiallyHidden: document.querySelector('#tower-panel').hidden,
      status: rect('.status-panel'), menu: rect('.menu-panel'), actions: rect('.bottom-actions') };
  })()`);
  if (layout.stats !== 4 || layout.menuButtons !== 5 || !layout.resetButton || layout.speedButton !== '1×'
    || !layout.startWave || !layout.auto || !layout.panelInitiallyHidden) {
    throw new Error('UI layout missing expected elements: ' + JSON.stringify(layout));
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
  await delay(150);
  const narrowLayout = await evaluate(`(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
    return { width: innerWidth, height: innerHeight, status: rect('.status-panel'), menu: rect('.menu-panel'), actions: rect('.bottom-actions') };
  })()`);
  if (narrowLayout.status.right > narrowLayout.menu.x || narrowLayout.actions.x < 0 || narrowLayout.actions.right > narrowLayout.width) {
    throw new Error('Portrait layout overlaps or clips at 360px: ' + JSON.stringify(narrowLayout));
  }
  const narrowScreenshot = await command('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('artifacts/wizard-smoke', { recursive: true });
  fs.writeFileSync('artifacts/wizard-smoke/ui-portrait-360.png', Buffer.from(narrowScreenshot.data, 'base64'));
  await command('Emulation.setDeviceMetricsOverride', { width: 540, height: 900, deviceScaleFactor: 1, mobile: false });
  await delay(150);
  const controlSmoke = await evaluate(`(() => {
    const speed = document.querySelector('#speed-button');
    const pause = document.querySelector('#pause-button');
    speed.click();
    const fastWhileRunning = speed.textContent;
    pause.click();
    const pausedLabel = pause.textContent;
    const speedWhilePaused = speed.textContent;
    pause.click();
    const resumedLabel = pause.textContent;
    speed.click();
    return { fastWhileRunning, pausedLabel, speedWhilePaused, resumedLabel, normalAgain: speed.textContent };
  })()`);
  if (controlSmoke.fastWhileRunning !== '2×' || !controlSmoke.pausedLabel.includes('Resume')
    || controlSmoke.speedWhilePaused !== '2×' || !controlSmoke.resumedLabel.includes('Pause') || controlSmoke.normalAgain !== '1×') {
    throw new Error('Pause/speed controls failed to preserve the selected speed: ' + JSON.stringify(controlSmoke));
  }
  const determinism = await evaluate(`(async () => {
    const [{ GameState }, { SimulationClock }] = await Promise.all([
      import('/src/game/GameState.ts'), import('/src/game/SimulationClock.ts')
    ]);
    const createScenario = () => {
      const state = new GameState();
      const cell = { x: 3, y: 15 };
      if (!cell || state.placeBasicTower(cell) !== 'placed' || !state.startWave()) throw new Error('Test scenario init failed');
      return state;
    };
    const oneX = createScenario(), twoX = createScenario();
    const clockOne = new SimulationClock(), clockTwo = new SimulationClock();
    clockTwo.toggleSpeed();
    for (let frame = 0; frame < 60; frame++) {
      oneX.update(clockOne.toSimulationDelta(0.05));
      twoX.update(clockTwo.toSimulationDelta(0.025));
    }
    const snapshot = state => ({ gold: state.gold, lives: state.lives, wave: state.currentWave,
      waveActive: state.waveActive, enemiesRemaining: state.enemiesRemaining,
      towers: state.towers.map(tower => ({ level: tower.level, cooldown: tower.cooldownRemaining })),
      enemies: state.enemies.map(enemy => ({ id: enemy.id, hp: enemy.hp, x: enemy.x, y: enemy.y })) });
    const left = snapshot(oneX), right = snapshot(twoX);
    clockTwo.togglePause();
    const pausedDelta = clockTwo.toSimulationDelta(0.025);
    const simulationDeltaAtOneX = new SimulationClock().toSimulationDelta(0.05);
    return { oneX: left, twoX: right, identical: JSON.stringify(left) === JSON.stringify(right),
      pausedDelta, simulationDeltaAtOneX };
  })()`);
  if (!determinism.identical || determinism.pausedDelta !== 0 || determinism.simulationDeltaAtOneX !== 0.05) {
    throw new Error('1x/2x same-simulation-time determinism failed: ' + JSON.stringify(determinism));
  }
  const stressResults = await evaluate(`(async () => {
    const [{ GameState }, { SimulationClock }] = await Promise.all([
      import('/src/game/GameState.ts'), import('/src/game/SimulationClock.ts')
    ]);
    return [10, 30, 50].map(count => {
      const state = new GameState();
      state.waveActive = true;
      state.toSpawn = 0;
      state.spawnTimer = 1000;
      const path = state.path;
      for (let id = 1; id <= count; id++) state.enemies.push({ id, hp: 100, maxHp: 100, reward: 1,
        speed: 1 / 3, x: path[0].x, y: path[0].y, currentPathIndex: 0, path, alive: true });
      const clock = new SimulationClock(); clock.toggleSpeed();
      const before = performance.now();
      for (let frame = 0; frame < 120; frame++) state.update(clock.toSimulationDelta(0.01));
      return { enemies: count, updateMs: Number((performance.now() - before).toFixed(2)), remaining: state.enemies.length };
    });
  })()`);
  if (stressResults.some(result => result.remaining !== result.enemies || result.updateMs > 2000)) {
    throw new Error('2x simulation stress test failed: ' + JSON.stringify(stressResults));
  }
  const cancelResetSmoke = await evaluate(`(() => {
    const state = window.__towerDefenceGameState;
    const before = { gold: state.gold, wave: state.currentWave, towers: state.towers.length };
    document.querySelector('#reset-menu-button').click();
    const modalVisible = !document.querySelector('#reset-confirmation').hidden;
    const modalOwnsCenterInput = document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('#reset-confirmation') !== null;
    document.querySelector('#cancel-reset-button').click();
    return { before, after: { gold: state.gold, wave: state.currentWave, towers: state.towers.length }, modalVisible,
      modalClosed: document.querySelector('#reset-confirmation').hidden, modalOwnsCenterInput };
  })()`);
  if (!cancelResetSmoke.modalVisible || !cancelResetSmoke.modalClosed || !cancelResetSmoke.modalOwnsCenterInput
    || JSON.stringify(cancelResetSmoke.before) !== JSON.stringify(cancelResetSmoke.after)) {
    throw new Error('Reset confirmation/cancel/world-input guard failed: ' + JSON.stringify(cancelResetSmoke));
  }

  let audit;
  for (let attempt = 0; attempt < 60; attempt++) {
    await delay(1000);
    audit = consoleLines.find(line => line.includes('Blue Wizard GLB audit'));
    if (audit) break;
  }
  if (!audit) throw new Error('Blue Wizard did not finish loading: ' + consoleLines.join('\n'));
  const placement = await evaluate(`(() => {
    const state = window.__towerDefenceGameState;
    const candidates = [];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 80; x++) {
      if (state.canPlaceBasicTower({ x, y }) === 'placed') candidates.push({ x, y });
    }
    candidates.sort((a, b) => Math.abs(a.x - 39) + Math.abs(a.y - 16) - Math.abs(b.x - 39) - Math.abs(b.y - 16));
    const cell = candidates[0];
    return { cell, result: cell ? state.placeBasicTower(cell) : 'no-valid-cell' };
  })()`);
  if (placement.result !== 'placed') throw new Error('Could not place a test tower: ' + JSON.stringify(placement));
  for (let attempt = 0; attempt < 30; attempt++) {
    await delay(500);
    if (consoleLines.some(line => line.includes('Blue Wizard placement bounds'))) break;
  }
  if (!consoleLines.some(line => line.includes('Blue Wizard placement bounds'))) throw new Error('Wizard instance/bounds were not created.');
  const beforeSelectionScreenshot = await command('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('artifacts/wizard-smoke', { recursive: true });
  fs.writeFileSync('artifacts/wizard-smoke/blue-wizard-before-select.png', Buffer.from(beforeSelectionScreenshot.data, 'base64'));
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: 306, y: 486, button: 'left', buttons: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 306, y: 486, button: 'left', buttons: 0 });
  await delay(100);
  const selected = await evaluate(`({ visible: !document.querySelector('#tower-panel').hidden,
    towerCount: window.__towerDefenceGameState.towers.length,
    selectedName: document.querySelector('.tower-name').textContent })`);
  if (!selected.visible || selected.selectedName !== 'Blue Wizard') throw new Error('Clicking a placed tower did not open its panel: ' + JSON.stringify(selected));
  const desktopUpgradeTooltip = await evaluate(`(() => {
    const wrap = document.querySelector('#upgrade-action-wrap');
    wrap.dispatchEvent(new MouseEvent('mouseenter'));
    return { visible: !document.querySelector('#upgrade-tooltip').hidden,
      text: document.querySelector('#upgrade-tooltip').textContent };
  })()`);
  if (!desktopUpgradeTooltip.visible || !desktopUpgradeTooltip.text.includes('Upgrade to Level 2')
    || !desktopUpgradeTooltip.text.includes('Damage: 25 -> 65')
    || !desktopUpgradeTooltip.text.includes('Attack Rate: 1.00 -> 1.15 attacks/sec')
    || !desktopUpgradeTooltip.text.includes('DPS: 25 -> 74.75')
    || !desktopUpgradeTooltip.text.includes('Upgrade Cost: 20 gold')
    || !desktopUpgradeTooltip.text.includes('Total Invested After Upgrade: 30 gold')) {
    throw new Error('Desktop upgrade hover tooltip is incomplete: ' + JSON.stringify(desktopUpgradeTooltip));
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
  const mobileUpgradeTooltip = await evaluate(`(() => {
    document.querySelector('#upgrade-action-wrap').dispatchEvent(new MouseEvent('mouseleave'));
    document.querySelector('#upgrade-info-button').click();
    const tooltip = document.querySelector('#upgrade-tooltip').getBoundingClientRect();
    return { visible: !document.querySelector('#upgrade-tooltip').hidden, left: tooltip.left, right: tooltip.right,
      viewportWidth: innerWidth, text: document.querySelector('#upgrade-tooltip').textContent };
  })()`);
  if (!mobileUpgradeTooltip.visible || mobileUpgradeTooltip.left < 0 || mobileUpgradeTooltip.right > mobileUpgradeTooltip.viewportWidth) {
    throw new Error('Mobile upgrade tooltip is not accessible/in bounds: ' + JSON.stringify(mobileUpgradeTooltip));
  }
  await evaluate("document.querySelector('#upgrade-info-button').click()");
  await command('Emulation.setDeviceMetricsOverride', { width: 540, height: 900, deviceScaleFactor: 1, mobile: false });
  fs.mkdirSync('artifacts/wizard-smoke', { recursive: true });
  const selectedScreenshot = await command('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('artifacts/wizard-smoke/blue-wizard-selected.png', Buffer.from(selectedScreenshot.data, 'base64'));
  const upgradeResult = await evaluate(`(() => {
    document.querySelector('#upgrade-button').click();
    const state = window.__towerDefenceGameState;
    return { level: state.towers[0].level, panelLevel: document.querySelector('#tower-level').textContent,
      selectedVisible: !document.querySelector('#tower-panel').hidden };
  })()`);
  if (upgradeResult.level !== 2 || upgradeResult.panelLevel !== 'Level 2' || !upgradeResult.selectedVisible) {
    throw new Error('Wizard visual did not survive tower upgrade/rebuild: ' + JSON.stringify(upgradeResult));
  }
  await evaluate("window.__towerDefenceGameState.gold = 100");
  await delay(300);
  const level3Tooltip = await evaluate(`(() => {
    // The injected test gold is not part of the normal UI event flow; unlock the
    // button explicitly so its real click handler exercises the Level 3 upgrade.
    document.querySelector('#upgrade-button').disabled = false;
    document.querySelector('#upgrade-action-wrap').dispatchEvent(new MouseEvent('mouseenter'));
    return { text: document.querySelector('#upgrade-tooltip').textContent };
  })()`);
  if (!level3Tooltip.text.includes('Upgrade to Level 3')
    || !level3Tooltip.text.includes('Damage: 65 -> 150')
    || !level3Tooltip.text.includes('Attack Rate: 1.15 -> 1.25 attacks/sec')
    || !level3Tooltip.text.includes('DPS: 74.75 -> 187.5')
    || !level3Tooltip.text.includes('Upgrade Cost: 45 gold')
    || !level3Tooltip.text.includes('Total Invested After Upgrade: 75 gold')) {
    throw new Error('Level 2 -> 3 upgrade values/cost are incorrect: ' + JSON.stringify(level3Tooltip));
  }
  const maxLevelResult = await evaluate(`(() => {
    document.querySelector('#upgrade-button').click();
    const state = window.__towerDefenceGameState;
    return { level: state.towers[0].level, damage: state.towers[0].damage,
      attackRate: state.towers[0].fireRate, buttonText: document.querySelector('#upgrade-button').textContent };
  })()`);
  if (maxLevelResult.level !== 3 || maxLevelResult.damage !== 150
    || maxLevelResult.attackRate !== 1.25 || maxLevelResult.buttonText !== 'MAX LEVEL') {
    throw new Error('Level 3 upgrade/max-level state is incorrect: ' + JSON.stringify(maxLevelResult));
  }
  const uiSafety = await evaluate(`(() => {
    const state = window.__towerDefenceGameState;
    const before = state.towers.length;
    document.querySelector('#save-button').click();
    document.querySelector('#sell-button').click();
    const after = state.towers.length;
    document.querySelector('#close-tower-panel').click();
    return { before, after, panelClosed: document.querySelector('#tower-panel').hidden };
  })()`);
  if (uiSafety.before !== uiSafety.after || !uiSafety.panelClosed) throw new Error('UI actions affected world state or failed to deselect: ' + JSON.stringify(uiSafety));
  await delay(300);
  const screenshot = await command('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('artifacts/wizard-smoke/blue-wizard.png', Buffer.from(screenshot.data, 'base64'));
  const waveStart = await evaluate(`(() => {
    const state = window.__towerDefenceGameState;
    const spawn = state.layout.activeSpawns[0].entryCell;
    const cells = [];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 80; x++) {
      if (state.canPlaceBasicTower({ x, y }) === 'placed') cells.push({ x, y });
    }
    cells.sort((a, b) => Math.abs(a.x - spawn.x) + Math.abs(a.y - spawn.y) - Math.abs(b.x - spawn.x) - Math.abs(b.y - spawn.y));
    const cell = cells[0];
    const placement = cell ? state.placeBasicTower(cell) : 'no-valid-cell';
    return { cell, placement, started: state.startWave() };
  })()`);
  if (waveStart.placement !== 'placed' || !waveStart.started) throw new Error('Could not start the arcane attack test: ' + JSON.stringify(waveStart));
  let sawArcaneProjectile = false;
  let sawImpactBurst = false;
  for (let attempt = 0; attempt < 180; attempt++) {
    const counts = await evaluate('window.__combatVisualDebug?.()');
    sawArcaneProjectile ||= counts?.totalArcaneProjectiles > 0;
    sawImpactBurst ||= counts?.totalArcaneBursts > 0;
    if (sawArcaneProjectile && sawImpactBurst) break;
    await delay(50);
  }
  if (!sawArcaneProjectile || !sawImpactBurst) {
    throw new Error(`Arcane attack effects not observed (projectile=${sawArcaneProjectile}, burst=${sawImpactBurst}).`);
  }
  await evaluate("document.querySelector('#speed-button').click()");
  await delay(150);
  const pauseFreeze = await evaluate(`(() => {
    const state = window.__towerDefenceGameState;
    const snapshot = () => ({ enemiesRemaining: state.enemiesRemaining,
      enemies: state.enemies.map(enemy => ({ id: enemy.id, x: enemy.x, y: enemy.y, hp: enemy.hp })) });
    const before = snapshot();
    document.querySelector('#pause-button').click();
    return { before, pauseLabel: document.querySelector('#pause-button').textContent,
      speedLabel: document.querySelector('#speed-button').textContent };
  })()`);
  await delay(350);
  const whilePaused = await evaluate(`(() => {
    const state = window.__towerDefenceGameState;
    return { enemiesRemaining: state.enemiesRemaining,
      enemies: state.enemies.map(enemy => ({ id: enemy.id, x: enemy.x, y: enemy.y, hp: enemy.hp })) };
  })()`);
  if (pauseFreeze.speedLabel !== '2×' || !pauseFreeze.pauseLabel.includes('Resume')
    || JSON.stringify(pauseFreeze.before) !== JSON.stringify(whilePaused)) {
    throw new Error('Pause did not freeze active simulation while preserving 2x: ' + JSON.stringify({ pauseFreeze, whilePaused }));
  }
  await evaluate("document.querySelector('#pause-button').click()");
  await delay(1000);
  const resumed = await evaluate(`(() => ({ pauseLabel: document.querySelector('#pause-button').textContent,
    speedLabel: document.querySelector('#speed-button').textContent,
    enemiesRemaining: window.__towerDefenceGameState.enemiesRemaining,
    positions: window.__towerDefenceGameState.enemies.map(enemy => [enemy.id, enemy.x, enemy.y]) }))()`);
  const pausedPositions = pauseFreeze.before.enemies.map(enemy => [enemy.id, enemy.x, enemy.y]);
  if (!resumed.pauseLabel.includes('Pause') || resumed.speedLabel !== '2×'
    || JSON.stringify(pausedPositions) === JSON.stringify(resumed.positions)) {
    throw new Error('Resume failed to continue at the selected 2x speed: ' + JSON.stringify(resumed));
  }
  const reset = await evaluate(`(() => {
    const state = window.__towerDefenceGameState;
    document.querySelector('#reset-menu-button').click();
    const modalVisible = !document.querySelector('#reset-confirmation').hidden;
    document.querySelector('#confirm-reset-button').click();
    return { modalVisible, modalClosed: document.querySelector('#reset-confirmation').hidden,
      towers: state.towers.length, enemies: state.enemies.length, gold: state.gold, lives: state.lives,
      wave: state.currentWave, waveActive: state.waveActive, autoRun: state.autoRun,
      pauseLabel: document.querySelector('#pause-button').textContent,
      speedLabel: document.querySelector('#speed-button').textContent };
  })()`);
  await delay(300);
  if (reset.towers !== 0) throw new Error('Test reset left stale towers: ' + JSON.stringify(reset));
  if (!reset.modalVisible || !reset.modalClosed || reset.enemies !== 0 || reset.gold !== 70 || reset.lives !== 10
    || reset.wave !== 1 || reset.waveActive || reset.autoRun || !reset.pauseLabel.includes('Pause') || reset.speedLabel !== '1×') {
    throw new Error('Confirmed reset did not restore a clean 1x run: ' + JSON.stringify(reset));
  }
  const applicationBootCount = consoleLines.filter(line => line.includes('APPLICATION BOOT')).length;
  if (applicationBootCount !== 1) throw new Error(`Reset unexpectedly reloaded the page (${applicationBootCount} application boots).`);
  const postResetEffects = await evaluate('window.__combatVisualDebug?.()');
  if (postResetEffects?.projectiles || postResetEffects?.arcaneBursts) throw new Error('Effects survived reset: ' + JSON.stringify(postResetEffects));
  console.log(JSON.stringify({ assetHttpStatus: response.status, layout, narrowLayout, controlSmoke, determinism, stressResults,
    cancelResetSmoke, placement, selected, desktopUpgradeTooltip, mobileUpgradeTooltip, upgradeResult, level3Tooltip,
    maxLevelResult, uiSafety, waveStart, sawArcaneProjectile, sawImpactBurst, pauseFreeze, whilePaused, resumed,
    reset, applicationBootCount, postResetEffects,
    relevantLogs: consoleLines.filter(line => /Blue Wizard|failed to load/i.test(line)) }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket?.readyState === 1) { await command('Browser.close').catch(() => {}); socket.close(); }
  chrome?.kill();
  if (chrome && chrome.exitCode === null) await Promise.race([
    new Promise(resolve => chrome.once('exit', resolve)),
    delay(3000),
  ]);
  fs.rmSync(profile, { recursive: true, force: true });
});
