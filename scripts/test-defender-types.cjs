// Runtime smoke test for defender stats, adjacent8 range, UI choice and Knight model loading.
// Requires npm run dev and Google Chrome on this machine.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "td-defenders-"));
const pending = new Map();
const logs = [];
let chrome;
let socket;
let nextId = 0;

async function command(method, params = {}) {
  const id = ++nextId;
  const response = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 20000);
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
  const asset = await fetch("http://127.0.0.1:5173/assets/models/defenders/holy-knight.glb");
  if (!asset.ok || Number(asset.headers.get("content-length")) !== 11943732) throw new Error("Knight GLB is not served at expected runtime path.");
  chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--disable-extensions", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--remote-debugging-port=9251", `--user-data-dir=${profile}`, "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  await delay(1200);
  const pages = await (await fetch("http://127.0.0.1:9251/json")).json();
  socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled") logs.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message.result || message.error); pending.delete(message.id); }
  });
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
  await command("Page.navigate", { url: "http://127.0.0.1:5173/?waveDebug=1" });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await evaluate("!!window.__towerDefenceGameState")) break;
    if (attempt === 59) throw new Error("Game UI did not initialize.");
    await delay(250);
  }

  const controls = await evaluate(`(() => {
    const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}; };
    const panel=document.querySelector('#tower-panel'), empty=document.querySelector('#tower-empty-state'), buildInfo=document.querySelector('#build-unit-info');
    panel.hidden=false; empty.hidden=true; buildInfo.hidden=true;
    const selectedDetails=rect('#tower-panel'), selectedActions=rect('.bottom-actions'), selectedInfo=rect('.tower-info-section'), selectedBottom=rect('.bottom-hud-bar');
    panel.hidden=true; buildInfo.hidden=false; empty.hidden=true;
    return { app:rect('#app'), top:rect('.top-hud-bar'), bottom:rect('.bottom-hud-bar'), build:rect('.build-unit-section'), info:rect('.tower-info-section'),
      choices:rect('.defender-choice-panel'), actions:rect('.bottom-actions'),
      actionDisplay:getComputedStyle(document.querySelector('.bottom-actions')).display,
      selectedDetails,selectedActions,selectedInfo,selectedBottom,
      title:document.querySelector('.game-title').textContent,
      labels:[...document.querySelectorAll('.defender-choice')].map(b=>b.textContent.trim()),
      costs:[...document.querySelectorAll('.unit-card-cost')].map(n=>n.textContent.trim()) };
  })()`);
  if (Math.abs(controls.top.left - controls.app.left) > 5 || Math.abs(controls.app.right - controls.top.right) > 5
    || Math.abs(controls.bottom.left - controls.app.left) > 5 || Math.abs(controls.app.right - controls.bottom.right) > 5
    || controls.bottom.top <= controls.top.bottom || Math.abs(controls.bottom.bottom - controls.app.bottom) > 5
    || controls.build.right > controls.info.left || controls.actionDisplay !== "grid"
    || controls.selectedDetails.left < controls.selectedInfo.left || controls.selectedDetails.right > controls.selectedInfo.right
    || controls.selectedActions.bottom > controls.selectedBottom.bottom || controls.selectedDetails.top < controls.selectedBottom.top
    || controls.labels.length !== 4 || JSON.stringify(controls.costs) !== JSON.stringify(["10 GOLD", "10 GOLD", "20 GOLD", "35 GOLD"])
    || controls.title !== "Tower Defence") {
    throw new Error("Full-width HUD layout does not fit mobile portrait: " + JSON.stringify(controls));
  }
  const portraits = await evaluate(`(async () => {
    const wizard=document.querySelector('#build-wizard-button'), knight=document.querySelector('#build-knight-button');
    await Promise.all([...document.querySelectorAll('.defender-choice img')].map(image=>image.decode()));
    const frameRect=(selector)=>{const r=document.querySelector(selector).getBoundingClientRect();return {width:r.width,height:r.height,centerX:r.left+r.width/2,centerY:r.top+r.height/2}};
    const wizardFrame=frameRect('#build-wizard-button .unit-portrait-frame'), knightFrame=frameRect('#build-knight-button .unit-portrait-frame');
    const wizardFit=getComputedStyle(document.querySelector('#build-wizard-button img')).objectFit;
    const knightFit=getComputedStyle(document.querySelector('#build-knight-button img')).objectFit;
    wizard.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));
    const wizardInfo=document.querySelector('#build-unit-info');
    const wizardDetails={visible:!wizardInfo.hidden,name:document.querySelector('#build-unit-info-name').textContent,
      role:document.querySelector('#build-unit-info-role').textContent,damage:document.querySelector('#build-unit-info-damage').textContent,
      range:document.querySelector('#build-unit-info-range').textContent,rate:document.querySelector('#build-unit-info-rate').textContent,
      cost:document.querySelector('#build-unit-info-cost').textContent};
    knight.click();
    const knightDetails={visible:!wizardInfo.hidden,name:document.querySelector('#build-unit-info-name').textContent,
      role:document.querySelector('#build-unit-info-role').textContent,damage:document.querySelector('#build-unit-info-damage').textContent,
      range:document.querySelector('#build-unit-info-range').textContent,rate:document.querySelector('#build-unit-info-rate').textContent,
      cost:document.querySelector('#build-unit-info-cost').textContent};
    wizard.click();
    return { wizardImage:document.querySelector('#build-wizard-button img').naturalWidth, knightImage:document.querySelector('#build-knight-button img').naturalWidth,
      buildCardInfoVisible:wizard.textContent.includes('Blue Wizard') && knight.textContent.includes('Holy Knight')
        && document.querySelector('#wizard-build-cost').textContent === '10 GOLD' && document.querySelector('#knight-build-cost').textContent === '10 GOLD',
      selectedBuildCard:document.querySelector('.defender-choice.is-selected .unit-card-copy strong').textContent,
      wizardDetails,knightDetails,wizardFrame,knightFrame,wizardFit,knightFit,
      popupsRemoved:document.querySelectorAll('.defender-tooltip').length===0,
      towerCombatStatFields:[...document.querySelectorAll('.tower-combat-stats span')].map(node=>node.textContent.trim()) };
  })()`);
  if (!portraits.wizardImage || !portraits.knightImage || !portraits.buildCardInfoVisible || portraits.selectedBuildCard !== 'Blue Wizard'
    || !portraits.popupsRemoved || portraits.wizardFit !== 'contain' || portraits.knightFit !== 'contain'
    || Math.abs(portraits.wizardFrame.width - portraits.knightFrame.width) > 1 || Math.abs(portraits.wizardFrame.height - portraits.knightFrame.height) > 1
    || portraits.wizardDetails.name !== 'Blue Wizard' || portraits.wizardDetails.role !== 'Ranged Defender' || portraits.wizardDetails.damage !== '25' || portraits.wizardDetails.rate !== '1.00/s' || portraits.wizardDetails.cost !== '10 Gold'
    || portraits.knightDetails.name !== 'Holy Knight' || portraits.knightDetails.role !== 'Melee Defender' || portraits.knightDetails.damage !== '55' || portraits.knightDetails.range !== 'Adjacent 8' || portraits.knightDetails.rate !== '0.90/s' || portraits.knightDetails.cost !== '10 Gold'
    || portraits.towerCombatStatFields.join('|') !== 'Kills 0|Damage Done 0'
  ) {
    throw new Error("Unit portrait alignment or build-info panel failed: " + JSON.stringify(portraits));
  }

  const logic = await evaluate(`(async () => {
    const [{ DEFENDER_CONFIG, getDefenderTotalInvestment }, { createBasicTower, isTowerInRange }, { GameState }, { BALANCE }] = await Promise.all([
      import('/src/game/config/DefenderConfig.ts'), import('/src/game/towers/Tower.ts'), import('/src/game/GameState.ts')
      , import('/src/game/config/BalanceConfig.ts')
    ]);
    const knight = createBasicTower(1, {x: 5, y: 5}, 'holy-knight');
    const inRange = (x, y) => isTowerInRange(knight, { id: x * 100 + y, hp: 100, maxHp: 100, reward: 1, speed: 1, x, y,
      currentPathIndex: 0, path: [{x, y}], alive: true });
    const adjacent = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) adjacent.push(inRange(5 + dx, 5 + dy));
    const sameCell = inRange(5, 5), twoAway = inRange(7, 5);
    const interpolationRange = [3.51, 4.49, 4.51, 5.49, 5.51, 6.49].map((x) => inRange(x, 6));
    const wizardTower = createBasicTower(2, {x: 5, y: 5}, 'blue-wizard');
    const wizardRange = isTowerInRange(wizardTower, { id: 90, hp: 100, maxHp: 100, reward: 1, speed: 1, x: 8, y: 5,
      currentPathIndex: 0, path: [{x:8,y:5}], alive: true });
    const wizard = DEFENDER_CONFIG['blue-wizard'].levels.map(s => [s.damage, s.fireRate]);
    const knightStats = DEFENDER_CONFIG['holy-knight'].levels.map(s => [s.damage, s.fireRate]);
    const investment = [1,2,3].map(level => [getDefenderTotalInvestment(level, 'blue-wizard'), getDefenderTotalInvestment(level, 'holy-knight')]);
    const state = new GameState();
    const cell = (() => { for (let y = 0; y < state.grid.height; y++) for (let x = 0; x < state.grid.width; x++)
      if (state.canPlaceBasicTower({x,y}, 'blue-wizard') === 'placed') return {x,y}; })();
    if (!cell || state.placeBasicTower(cell, 'blue-wizard') !== 'placed') throw new Error('Wizard build failed');
    const knightCell = (() => { for (let y = 0; y < state.grid.height; y++) for (let x = 0; x < state.grid.width; x++)
      if (state.canPlaceBasicTower({x,y}, 'holy-knight') === 'placed') return {x,y}; })();
    if (!knightCell || state.placeBasicTower(knightCell, 'holy-knight') !== 'placed') throw new Error('Knight build failed');
    state.gold = 1000;
    const upgrades = state.towers.map(t => [state.upgradeBasicTower(t.id), state.upgradeBasicTower(t.id), t.type, t.damage, t.fireRate, t.rangeMode]);
    const combat = new GameState();
    combat.towers = [knight];
    combat.waveActive = true;
    combat.enemies = [{ id: 91, hp: 100, maxHp: 100, reward: 1, speed: 0, x: 6, y: 6,
      currentPathIndex: 0, path: [{x:6,y:6},{x:6,y:7},{x:6,y:8}], alive: true }];
    combat.update(0);
    const diagonalAttack = { targetId: combat.attackEvents[0]?.targetEnemyId, hp: combat.enemies[0]?.hp };
    const outOfRange = new GameState();
    outOfRange.towers = [knight];
    outOfRange.waveActive = true;
    outOfRange.enemies = [{ id: 92, hp: 100, maxHp: 100, reward: 1, speed: 0, x: 7, y: 5,
      currentPathIndex: 0, path: [{x:7,y:5},{x:8,y:5}], alive: true }];
    outOfRange.update(0);
    const stoppedAfterLeavingMelee = outOfRange.attackEvents.length === 0;

    const overkillTest = new GameState();
    const overkillTower = createBasicTower(30, {x:5,y:5}, 'holy-knight');
    overkillTest.towers = [overkillTower];
    overkillTest.waveActive = true;
    overkillTest.enemies = [{ id: 301, hp: 20, maxHp: 100, reward: 1, speed: 0, x: 6, y: 5,
      currentPathIndex: 0, path: [{x:6,y:5},{x:6,y:6}], alive: true }];
    overkillTest.update(0);
    const overkillStats = { ...overkillTower.combatStats, effectiveDamage: overkillTest.attackEvents[0]?.damageDealt };

    const assistTest = new GameState();
    const assistWizard = createBasicTower(31, {x:5,y:5}, 'blue-wizard');
    const lethalKnight = createBasicTower(32, {x:5,y:5}, 'holy-knight');
    assistWizard.damage = 60;
    lethalKnight.damage = 40;
    assistTest.towers = [assistWizard, lethalKnight];
    assistTest.waveActive = true;
    assistTest.enemies = [{ id: 302, hp: 100, maxHp: 100, reward: 1, speed: 0, x: 6, y: 5,
      currentPathIndex: 0, path: [{x:6,y:5},{x:6,y:6}], alive: true }];
    assistTest.update(0);
    const assistStats = { wizard: { ...assistWizard.combatStats }, knight: { ...lethalKnight.combatStats },
      attackDamage: assistTest.attackEvents.map((event) => event.damageDealt), lethalEvents: assistTest.attackEvents.map((event) => event.enemyDied) };
    const wizardStatsIdentity = assistWizard.combatStats;
    const knightStatsIdentity = lethalKnight.combatStats;
    assistTest.gold = 100;
    const upgradeResults = [assistTest.upgradeBasicTower(assistWizard.id), assistTest.upgradeBasicTower(lethalKnight.id)];
    const statsSurvivedUpgrade = assistWizard.combatStats === wizardStatsIdentity && lethalKnight.combatStats === knightStatsIdentity
      && assistWizard.combatStats.damageDone === 60 && lethalKnight.combatStats.damageDone === 40 && lethalKnight.combatStats.kills === 1;

    assistTest.resetGame('try-again');
    const resetClearedTowers = assistTest.towers.length === 0;
    assistTest.gold = 100;
    for (let y = 0; y < assistTest.grid.height && assistTest.towers.length === 0; y++) for (let x = 0; x < assistTest.grid.width; x++) {
      if (assistTest.placeBasicTower({x,y}, 'holy-knight') === 'placed') break;
    }
    const freshTowerStats = assistTest.towers[0]?.combatStats;

    // Every immediate neighbor of the spawn is independently buildable; normal path validation
    // must still reject the placement that closes the final cardinal route.
    const spawnTest = new GameState();
    spawnTest.gold = 1000;
    const spawnCell = spawnTest.spawn;
    const neighbors = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx || dy) neighbors.push({ x: spawnCell.x + dx, y: spawnCell.y + dy });
    }
    const spawnNeighborResults = neighbors.map((cell) => spawnTest.canPlaceBasicTower(cell, 'holy-knight'));
    const closePathTest = new GameState();
    closePathTest.gold = 1000;
    const cardinal = [{x:spawnCell.x,y:spawnCell.y-1},{x:spawnCell.x+1,y:spawnCell.y},{x:spawnCell.x,y:spawnCell.y+1},{x:spawnCell.x-1,y:spawnCell.y}];
    const closureResults = cardinal.map((cell) => closePathTest.placeBasicTower(cell, 'holy-knight'));

    // Identical one-defender investment and a controlled straight pass along one adjacent tile.
    // We record actual in-range time, attack acquisition, hits, damage and kills.
    const runPass = (type) => {
      const state = new GameState();
      const tower = createBasicTower(1, {x:5,y:5}, type);
      state.towers = [tower];
      state.gold = 90;
      const route = Array.from({length:10}, (_, i) => ({x:i+1,y:6}));
      const enemy = { id: 501, hp: 100, maxHp: 100, reward: 1, speed: 2.5, x: 1, y: 6,
        currentPathIndex: 0, path: route, alive: true };
      state.enemies = [enemy];
      state.waveActive = true;
      let uptime = 0, elapsed = 0, firstAcquire = null, hits = 0;
      while (elapsed < 5 && state.enemies.length) {
        state.update(0.01);
        elapsed += 0.01;
        if (isTowerInRange(tower, enemy)) uptime += 0.01;
        if (state.attackEvents.length) {
          hits += state.attackEvents.length;
          if (firstAcquire === null) firstAcquire = elapsed;
        }
      }
      return { type, investedGold:10, uptimeSeconds:+uptime.toFixed(2), acquireSeconds:firstAcquire,
        attacks:hits, damageDealt:100-enemy.hp, kills:enemy.hp<=0 ? 1 : 0, leaked:!enemy.alive && enemy.hp>0 ? 1 : 0 };
    };
    const passComparison = [runPass('blue-wizard'), runPass('holy-knight')];
    const runWave = (type) => {
      const state = new GameState();
      state.gold = 100;
      if (state.placeBasicTower({x:5,y:15}, type) !== 'placed') throw new Error(type + ' test tower placement failed');
      const tower = state.towers[0];
      state.startWave();
      let elapsed = 0, uptime = 0, attacks = 0;
      const dealtByEnemy = new Map();
      let kills = 0;
      while (state.waveActive && elapsed < 40) {
        for (const enemy of state.enemies) if (enemy.alive && isTowerInRange(tower, enemy)) uptime += 0.01;
        state.update(0.01);
        elapsed += 0.01;
        for (const event of state.attackEvents) {
          attacks += 1;
          dealtByEnemy.set(event.targetEnemyId,
            (dealtByEnemy.get(event.targetEnemyId) ?? 0) + event.damageDealt);
          if (event.enemyDied) kills += 1;
        }
      }
      return { defender:type, investmentGold:10, attacks, damageDealt:[...dealtByEnemy.values()].reduce((sum, damage) => sum + damage, 0),
        kills, livesLost:10-state.lives, enemySecondsInRange:+uptime.toFixed(2), waveCompleted:!state.waveActive, durationSeconds:+elapsed.toFixed(2) };
    };
    const earlyWaveComparison = [runWave('blue-wizard'), runWave('holy-knight')];
    const runEqualBudgetWave = (type) => {
      const state = new GameState();
      state.gold = 70;
      for (const x of [5,11,17,23,29,35,41]) {
        if (state.placeBasicTower({x,y:15}, type) !== 'placed') throw new Error(type + ' budget tower placement failed at ' + x);
      }
      const towers = [...state.towers];
      state.startWave();
      let elapsed = 0, uptime = 0, attacks = 0;
      const dealtByEnemy = new Map();
      let kills = 0;
      while (state.waveActive && elapsed < 40) {
        for (const enemy of state.enemies) if (enemy.alive && towers.some((tower) => isTowerInRange(tower, enemy))) uptime += 0.01;
        state.update(0.01);
        elapsed += 0.01;
        for (const event of state.attackEvents) {
          const tower = towers.find((candidate) => candidate.id === event.towerId);
          attacks += 1;
          dealtByEnemy.set(event.targetEnemyId,
            (dealtByEnemy.get(event.targetEnemyId) ?? 0) + event.damageDealt);
          if (event.enemyDied) kills += 1;
        }
      }
      return { defender:type, investmentGold:70, attacks, damageDealt:[...dealtByEnemy.values()].reduce((sum, damage) => sum + damage, 0),
        kills, livesLost:10-state.lives, enemySecondsInAttackCoverage:+uptime.toFixed(2), waveCompleted:!state.waveActive, durationSeconds:+elapsed.toFixed(2) };
    };
    const equalBudgetWaveComparison = [runEqualBudgetWave('blue-wizard'), runEqualBudgetWave('holy-knight')];
    const ui = document.querySelector('#build-knight-button');
    ui.click();
    return { adjacent, sameCell, twoAway, interpolationRange, wizardRange, diagonalAttack, stoppedAfterLeavingMelee,
      overkillStats, assistStats, upgradeResults, statsSurvivedUpgrade, resetClearedTowers, freshTowerStats,
      spawnCell, spawnNeighborResults, closureResults, passComparison, earlyWaveComparison, equalBudgetWaveComparison,
      wizard, knightStats, investment, towers: state.towers.map(t => t.type), upgrades,
      knightChoiceSelected: ui.classList.contains('is-selected') };
  })()`);

  if (!logic.adjacent.every(Boolean) || logic.sameCell || logic.twoAway || !logic.interpolationRange.every(Boolean) || !logic.wizardRange
    || logic.diagonalAttack.targetId !== 91 || logic.diagonalAttack.hp !== 45 || !logic.stoppedAfterLeavingMelee) {
    throw new Error(`Combat range test failed: ${JSON.stringify(logic)}`);
  }
  if (!logic.spawnNeighborResults.every((result) => result === 'placed')
    || JSON.stringify(logic.closureResults) !== JSON.stringify(['placed','placed','placed','blocks-path'])) {
    throw new Error(`Spawn buildability/path test failed: ${JSON.stringify(logic)}`);
  }
  if (JSON.stringify(logic.wizard) !== JSON.stringify([[25,1],[65,1.15],[150,1.25]])
    || JSON.stringify(logic.knightStats) !== JSON.stringify([[55,0.9],[140,1.05],[320,1.15]])) throw new Error(`Defender balance mismatch: ${JSON.stringify(logic)}`);
  if (JSON.stringify(logic.investment) !== JSON.stringify([[10,10],[30,30],[75,75]])
    || JSON.stringify(logic.towers) !== JSON.stringify(["blue-wizard","holy-knight"])
    || logic.upgrades.some((row) => row[0] !== "upgraded" || row[1] !== "upgraded") || !logic.knightChoiceSelected) {
    throw new Error(`Build/upgrade/UI test failed: ${JSON.stringify(logic)}`);
  }
  if (logic.passComparison[0].investedGold !== logic.passComparison[1].investedGold
    || logic.passComparison[1].damageDealt <= logic.passComparison[0].damageDealt
    || logic.passComparison[1].kills !== 1 || logic.passComparison[1].uptimeSeconds < 1) {
    throw new Error(`Controlled Knight/Wizard pass failed: ${JSON.stringify(logic.passComparison)}`);
  }
  if (!logic.earlyWaveComparison.every((result) => result.waveCompleted)
    || logic.earlyWaveComparison[1].damageDealt <= logic.earlyWaveComparison[0].damageDealt) {
    throw new Error(`Early wave Knight/Wizard comparison failed: ${JSON.stringify(logic.earlyWaveComparison)}`);
  }
  if (!logic.equalBudgetWaveComparison.every((result) => result.waveCompleted)
    || logic.equalBudgetWaveComparison[1].investmentGold !== logic.equalBudgetWaveComparison[0].investmentGold
    || logic.equalBudgetWaveComparison[1].damageDealt < logic.equalBudgetWaveComparison[0].damageDealt
    || logic.equalBudgetWaveComparison[1].kills < logic.equalBudgetWaveComparison[0].kills
    || logic.equalBudgetWaveComparison[1].livesLost > logic.equalBudgetWaveComparison[0].livesLost) {
    throw new Error(`Equal-budget Knight/Wizard wave comparison failed: ${JSON.stringify(logic.equalBudgetWaveComparison)}`);
  }
  if (logic.overkillStats.effectiveDamage !== 20 || logic.overkillStats.damageDone !== 20 || logic.overkillStats.kills !== 1
    || JSON.stringify(logic.assistStats) !== JSON.stringify({ wizard:{kills:0,damageDone:60}, knight:{kills:1,damageDone:40}, attackDamage:[60,40], lethalEvents:[false,true] })
    || JSON.stringify(logic.upgradeResults) !== JSON.stringify(['upgraded','upgraded']) || !logic.statsSurvivedUpgrade
    || !logic.resetClearedTowers || JSON.stringify(logic.freshTowerStats) !== JSON.stringify({kills:0,damageDone:0})) {
    throw new Error(`Per-tower combat stats test failed: ${JSON.stringify({ overkillStats:logic.overkillStats, assistStats:logic.assistStats,
      upgradeResults:logic.upgradeResults, statsSurvivedUpgrade:logic.statsSurvivedUpgrade, resetClearedTowers:logic.resetClearedTowers, freshTowerStats:logic.freshTowerStats })}`);
  }

  const rendererPlacement = await evaluate(`(() => {
    const state=window.__towerDefenceGameState, ui=window.__towerDefenceUi;
    const place=(type)=>{for(let y=0;y<state.grid.height;y++)for(let x=0;x<state.grid.width;x++){
      const cell={x,y};if(state.canPlaceBasicTower(cell,type)==='placed'&&state.placeBasicTower(cell,type)==='placed')return state.towers.at(-1);
    }return undefined;};
    const wizard=place('blue-wizard'),knight=place('holy-knight');
    if(!ui||!wizard||!knight)return {ok:false,hasUi:!!ui,wizard:!!wizard,knight:!!knight,gold:state.gold};
    const panel=document.querySelector('#tower-panel'),buildInfo=document.querySelector('#build-unit-info'),empty=document.querySelector('#tower-empty-state');
    ui.selectTower(wizard.id);
    const placedWizard={visible:!panel.hidden,name:document.querySelector('.tower-name').textContent,
      level:document.querySelector('#tower-level').textContent,kills:document.querySelector('#tower-kills').textContent,
      damageDone:document.querySelector('#tower-damage-done').textContent,actions:!document.querySelector('#upgrade-button').hidden&&!document.querySelector('#sell-button').hidden};
    ui.chooseBuildUnit('holy-knight');
    const towerWinsPriority=!panel.hidden&&buildInfo.hidden&&document.querySelector('.tower-name').textContent==='Blue Wizard';
    ui.selectTower();
    const returnsToBuildInfo=!panel.hidden&&!buildInfo.hidden ? false : (panel.hidden&&!buildInfo.hidden&&document.querySelector('#build-unit-info-name').textContent==='Holy Knight');
    ui.selectTower(knight.id);
    const placedKnight={visible:!panel.hidden,name:document.querySelector('.tower-name').textContent,level:document.querySelector('#tower-level').textContent,
      kills:document.querySelector('#tower-kills').textContent,damageDone:document.querySelector('#tower-damage-done').textContent,
      actions:!document.querySelector('#upgrade-button').hidden&&!document.querySelector('#sell-button').hidden};
    document.querySelector('#close-tower-panel').click();
    const closeRestoresBuildInfo=panel.hidden&&!buildInfo.hidden&&document.querySelector('#build-unit-info-name').textContent==='Holy Knight';
    return {ok:true,placedWizard,placedKnight,towerWinsPriority,returnsToBuildInfo,closeRestoresBuildInfo,
      emptyStateHiddenWhileBuilding:empty.hidden,wizardTowerId:wizard.id,knightTowerId:knight.id,
      classes:[...document.querySelectorAll('.defender-choice')].map(button=>button.classList.contains('is-selected'))};
  })()`);
  if (!rendererPlacement?.ok || !rendererPlacement.placedWizard.visible || rendererPlacement.placedWizard.name !== 'Blue Wizard'
    || rendererPlacement.placedWizard.level !== 'Level 1' || rendererPlacement.placedWizard.kills !== '0' || rendererPlacement.placedWizard.damageDone !== '0'
    || !rendererPlacement.placedWizard.actions || !rendererPlacement.towerWinsPriority || !rendererPlacement.returnsToBuildInfo
    || !rendererPlacement.placedKnight.visible || rendererPlacement.placedKnight.name !== 'Holy Knight' || !rendererPlacement.placedKnight.actions
    || !rendererPlacement.closeRestoresBuildInfo || !rendererPlacement.emptyStateHiddenWhileBuilding
    || JSON.stringify(rendererPlacement.classes) !== JSON.stringify([false,true,false,false])) {
    throw new Error("Build/tower info-panel state priority failed: " + JSON.stringify(rendererPlacement));
  }
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const portrait390 = await evaluate(`(() => {
    const rect=(selector)=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const ui=window.__towerDefenceUi, panel=document.querySelector('#tower-panel'), buildInfo=document.querySelector('#build-unit-info');
    ui.selectTower(${rendererPlacement.knightTowerId});
    const tower={panel:rect('#tower-panel'),actions:rect('.bottom-actions'),info:rect('.tower-info-section'),bottom:rect('.bottom-hud-bar'),panelVisible:!panel.hidden,buildInfoHidden:buildInfo.hidden};
    ui.selectTower();
    const build={panel:rect('#build-unit-info'),actions:rect('.bottom-actions'),info:rect('.tower-info-section'),bottom:rect('.bottom-hud-bar'),panelVisible:!buildInfo.hidden};
    const frames=[...document.querySelectorAll('.unit-portrait-frame')].map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,centerX:r.left+r.width/2}});
    return {viewport:{width:innerWidth,height:innerHeight},top:rect('.top-hud-bar'),bottom:rect('.bottom-hud-bar'),buildSection:rect('.build-unit-section'),tower,build,frames};
  })()`);
  const fits = (state) => state.panel.left >= state.info.left && state.panel.right <= state.info.right
    && state.panel.top >= state.bottom.top && state.actions.bottom <= state.bottom.bottom;
  if (portrait390.viewport.width !== 390 || portrait390.viewport.height !== 844
    || portrait390.top.right > 390 || portrait390.bottom.right > 390 || !portrait390.tower.panelVisible || !portrait390.tower.buildInfoHidden
    || !fits(portrait390.tower) || !portrait390.build.panelVisible || !fits(portrait390.build)
    || portrait390.frames.length !== 4
    || portrait390.frames.some((frame) => frame.left < portrait390.buildSection.left || frame.right > portrait390.buildSection.right)
    || portrait390.frames.some((frame) => Math.abs(frame.width - portrait390.frames[0].width) > 1 || Math.abs(frame.height - portrait390.frames[0].height) > 1)) {
    throw new Error("390x844 portrait layout or selected info state overflows: " + JSON.stringify(portrait390));
  }
  await delay(15000);
  if (!logs.some((line) => line.includes("Holy Knight GLB audit")) || !logs.some((line) => line.includes("Holy Knight placement"))) {
    throw new Error("Holy Knight model did not complete audit and instance placement. Browser console: " + logs.join(" | "));
  }
  console.log(JSON.stringify({ controls, portraits, rendererPlacement, portrait390, ...logic, modelLoadedAndPlaced: true, auditSeen: true }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  socket?.close();
  chrome?.kill();
  // Keep the temporary profile outside the repository; Chrome can retain a lock briefly.
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {} }, 1000).unref();
});
