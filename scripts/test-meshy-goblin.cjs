// Real-browser integration and lifecycle stress test for the Meshy Bloodfang Goblin.
// Start `npm run dev` first; set TD_TEST_URL when Vite uses another port.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "td-meshy-goblin-"));
const appUrl = process.env.TD_TEST_URL ?? "http://127.0.0.1:5173/";
const port = 9265;
const pending = new Map();
const browserMessages = [];
let chrome;
let socket;
let nextId = 0;
let failGoblinAsset = false;
let failedGoblinRequests = 0;

async function command(method, params = {}) {
  const id = ++nextId;
  const response = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 120000);
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

async function waitFor(expression, label, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const value = await evaluate(expression); if (value) return value; } catch {}
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${label}; browser=${JSON.stringify(browserMessages.slice(-20))}`);
}

async function enterBattlefield(query) {
  await command("Page.navigate", { url: `${appUrl}?${query}` });
  await waitFor("!!document.querySelector('#start-selected-map')", "Choose Map");
  await evaluate("document.querySelector('#start-selected-map').click()");
  await waitFor("!!document.querySelector('#start-battlefield')", "Royal Guard faction selection");
  await delay(250);
  return evaluate("performance.getEntriesByType('resource').map(r=>r.name).filter(u=>u.includes('goblin-meshy-casual-walk.glb'))");
}

async function startSelectedBattlefield() {
  await evaluate("document.querySelector('#start-battlefield').click()");
  await waitFor("!!document.querySelector('.game-ui')", "battlefield UI");
  await waitFor("document.querySelector('.game-ui')?.dataset.defenderAssetsReady === 'true'", "game renderer");
  await waitFor("window.__enemyTemplateAudit?.some(item=>item.type==='goblin')", "progressively loaded Goblin template", 120000);
}

async function main() {
  chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--disable-extensions", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--enable-precise-memory-info", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  let pages;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; }
    catch { await delay(250); }
  }
  if (!pages) throw new Error("Headless Chrome DevTools did not start.");
  socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") browserMessages.push({ type: "exception", text: message.params.exceptionDetails?.text });
    if (message.method === "Runtime.consoleAPICalled") browserMessages.push({ type: message.params.type,
      text: message.params.args?.map((arg) => arg.value ?? arg.description).join(" ") });
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      if (failGoblinAsset && request.url.includes("goblin-meshy-casual-walk.glb")) {
        failedGoblinRequests += 1;
        void command("Fetch.failRequest", { requestId, errorReason: "Failed" }).catch((error) => browserMessages.push({ type: "test-error", text: String(error) }));
      } else {
        void command("Fetch.continueRequest", { requestId }).catch((error) => browserMessages.push({ type: "test-error", text: String(error) }));
      }
      return;
    }
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message.result || message.error); pending.delete(message.id); }
  });
  await command("Runtime.enable");
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });

  const query = "waveDebug=1&enemyVisualDebug=1&enemyAnimationDebug=1&minimapDebug=1&disableEnvironmentProps=1";
  const preGameplayRequests = await enterBattlefield(query);
  if (preGameplayRequests.length !== 0) throw new Error(`Meshy Goblin loaded before entering gameplay: ${JSON.stringify(preGameplayRequests)}`);
  await startSelectedBattlefield();

  const template = await waitFor("window.__enemyTemplateAudit?.find(item=>item.type==='goblin')", "Goblin template audit", 30000);
  if (!template.assetPath.endsWith("goblin-meshy-casual-walk.glb")) {
    throw new Error(`Animated GLB did not load; fallback template=${JSON.stringify(template)}; browser=${JSON.stringify(browserMessages.slice(-25))}`);
  }
  const fallbackPath = "/assets/models/enemies/optimized/goblin.glb";
  if (template.skeletons !== 1 || template.animations.length !== 1 || template.animations[0] !== "Casual_Walk"
    || !template.assetPath.endsWith("goblin-meshy-casual-walk.glb") || fallbackPath === template.assetPath) {
    throw new Error(`Unexpected runtime Goblin asset: ${JSON.stringify(template)}`);
  }

  const spawned = await evaluate("window.__towerDefenceEnemyAnimationTest.spawn(2,'goblin')");
  if (spawned.length !== 2 || spawned.some(({ type }) => type !== "goblin")) throw new Error(`Wrong visual stress entities: ${JSON.stringify(spawned)}`);
  let moving;
  try {
    moving = await waitFor(`(() => { const s=window.__towerDefenceEnemyAnimationTest.snapshot(); return s.active?.filter(e=>e.type==='goblin'&&e.state==='moving'&&e.clip?.endsWith('Casual_Walk')).length===2 ? s : null; })()`,
      "two independently animated Casual_Walk Goblins", 25000);
  } catch (error) {
    const diagnostics = await evaluate(`(() => ({ snapshot:window.__towerDefenceEnemyAnimationTest.snapshot(),
      entities:window.__towerDefenceGameState.enemies.map(e=>({id:e.id,type:e.type,speed:e.speed,pathLength:e.path.length,currentPathIndex:e.currentPathIndex})),
      transitions:window.__enemyAnimationTransitions,templates:window.__enemyTemplateAudit?.filter(item=>item.type==='goblin'),
      instances:window.__enemyVisualInstances?.filter(item=>item.type==='goblin') }))()`);
    throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}`);
  }
  if (moving.active.filter((enemy) => enemy.isPlaying && enemy.loops).length !== 2) throw new Error(`Casual_Walk must be playing in a loop: ${JSON.stringify(moving.active)}`);
  if (moving.skeletons !== 2 || moving.activeAnimationGroups !== 2) throw new Error(`Goblin skeleton/group clones are not per instance: ${JSON.stringify(moving)}`);
  const heading = await evaluate(`(() => {
    const e=window.__towerDefenceGameState.enemies[0], v=window.__towerDefenceEnemyAnimationTest.snapshot().active.find(item=>item.id===e.id);
    const next=e.path[e.currentPathIndex+1];
    const expected=Math.atan2(next.x-e.x,next.y-e.y);
    return {expected,actual:v.rotationY,error:Math.abs(Math.atan2(Math.sin(expected-v.rotationY),Math.cos(expected-v.rotationY)))};
  })()`);
  if (heading.error > 0.001) throw new Error(`Goblin is not facing its GameState path direction: ${JSON.stringify(heading)}`);

  const goblinTemplate = template;
  const instance = await evaluate("window.__enemyVisualInstances.find(item=>item.id===-9300)");
  if (!instance?.bounds || Math.abs(instance.bounds.minY) > 0.025 || instance.scale !== 2.22
    || instance.bounds.height > 1.7 || instance.bounds.height < 1.35) {
    throw new Error(`Goblin scale/ground bounds do not match the existing enemy: ${JSON.stringify(instance)}`);
  }
  if (process.env.TD_MESHY_GOBLIN_SCREENSHOT) {
    await evaluate(`(() => {
      window.__towerDefenceMinimapDebug?.setTarget(8.5,1.5);
      window.__towerDefenceGameState.enemies[1].x += 1.5;
      window.__towerDefenceGameState.enemies[1].y += 1.2;
    })()`);
    for (let index = 0; index < 4; index += 1) {
      await command("Input.dispatchMouseEvent", { type: "mouseWheel", x: 450, y: 350, deltaX: 0, deltaY: -180 });
    }
    await delay(600);
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.resolve(process.env.TD_MESHY_GOBLIN_SCREENSHOT), Buffer.from(screenshot.data, "base64"));
  }

  await delay(4500);
  const loopAfterCycle = await evaluate(`(() => ({
    state:window.__towerDefenceEnemyAnimationTest.snapshot().active.filter(e=>e.type==='goblin'),
    transitions:window.__enemyAnimationTransitions.filter(e=>e.enemyType==='goblin'&&e.state==='moving'),
  }))()`);
  if (loopAfterCycle.state.length !== 2 || loopAfterCycle.state.some((enemy) => !enemy.clip?.endsWith("Casual_Walk") || !enemy.loops)
    || loopAfterCycle.transitions.length !== 2) {
    throw new Error(`Casual_Walk did not keep looping without per-frame restarts: ${JSON.stringify(loopAfterCycle)}`);
  }

  const speedCheck = await evaluate(`(() => {
    const enemies=window.__towerDefenceGameState.enemies;
    enemies[0].slowMultiplier=.75; enemies[0].slowSecondsRemaining=1;
    enemies[1].affixes=[{id:'swift',tier:3}];
    return true;
  })()`);
  const modifierSpeeds = await waitFor(`(() => {
    const s=window.__towerDefenceEnemyAnimationTest.snapshot().active.filter(e=>e.type==='goblin').sort((a,b)=>b.id-a.id);
    return s.length===2&&s[0].speed<=.76&&s[1].speed>=1.24?s:null;
  })()`, "slow and Swift playback-rate sync");
  if (!speedCheck || modifierSpeeds[0].id === modifierSpeeds[1].id
    || modifierSpeeds[0].effectiveGameplaySpeedCellsPerSecond >= modifierSpeeds[1].effectiveGameplaySpeedCellsPerSecond) {
    throw new Error(`Per-instance speed sync failed: ${JSON.stringify(modifierSpeeds)}`);
  }

  const frenziedSpeed = await evaluate(`(() => {
    const enemy=window.__towerDefenceGameState.enemies[0];
    enemy.slowMultiplier=1; enemy.slowSecondsRemaining=0; enemy.affixes=[{id:'frenzied',tier:3}]; enemy.hp=enemy.maxHp*.34;
    const commander=window.__towerDefenceGameState.enemies[1]; commander.affixes=[];
    return true;
  })()`);
  const frenzied = await waitFor("window.__towerDefenceEnemyAnimationTest.snapshot().active.find(e=>e.id===-9300)?.speed>1.29", "Frenzied visual playback increase");
  if (!frenziedSpeed || !frenzied) throw new Error("Frenzied did not accelerate the Goblin's visual clip.");

  const commanderCheck = await evaluate(`(() => {
    const [target,aura]=window.__towerDefenceGameState.enemies;
    target.hp=target.maxHp; target.affixes=[]; aura.affixes=[{id:'commander',tier:3}];
    return true;
  })()`);
  const auraTarget = await waitFor("window.__towerDefenceEnemyAnimationTest.snapshot().active.find(e=>e.id===-9300)?.speed>1.17", "Commander aura playback increase");
  if (!commanderCheck || !auraTarget) throw new Error("Commander aura movement speed was not reflected visually.");

  const overlayCounts = await evaluate(`(() => {
    const enemy=window.__towerDefenceGameState.enemies[0];
    enemy.affixes=[{id:'armored',tier:1},{id:'arcane-ward',tier:1},{id:'shielded',tier:1}];
    enemy.maxShield=100; enemy.shield=80; enemy.slowSecondsRemaining=1; enemy.slowMultiplier=.75;
    return true;
  })()`);
  const overlayState = await waitFor("(() => { const s=window.__towerDefenceEnemyAnimationTest.snapshot(); return s.affixIconCount>=2&&s.shieldBarCount>=1&&s.slowIndicatorCount>=1?s:null; })()", "affix, shield, and Frostweaver slow visuals on the animated root");
  if (!overlayCounts || !overlayState) throw new Error(`Goblin status attachments disappeared: ${JSON.stringify(overlayState)}`);

  const baseSpeed = await evaluate(`(() => {
    for(const e of window.__towerDefenceGameState.enemies){e.affixes=[];e.slowMultiplier=1;e.slowSecondsRemaining=0;}
    document.querySelector('#speed-button').click(); return true;
  })()`);
  const doubleSpeed = await waitFor("window.__towerDefenceEnemyAnimationTest.snapshot().active.find(e=>e.id===-9300)?.speed===1.6", "game-speed scaling and animation clamp");
  if (!baseSpeed || !doubleSpeed) throw new Error("The visual playback rate did not follow the 2x simulation speed/clamp.");
  await evaluate("document.querySelector('#speed-button').click()");

  const pauseFrame = await evaluate(`(() => {
    document.querySelector('#pause-button').click();
    return window.__towerDefenceEnemyAnimationTest.snapshot().active.find(e=>e.id===-9300)?.frame;
  })()`);
  const paused = await waitFor("window.__towerDefenceEnemyAnimationTest.snapshot().active.find(e=>e.id===-9300)?.isPlaying===false", "Casual_Walk pause");
  await delay(350);
  const pausedFrame = await evaluate("window.__towerDefenceEnemyAnimationTest.snapshot().active.find(e=>e.id===-9300)?.frame");
  if (paused.isPlaying || Math.abs(pausedFrame - pauseFrame) > 0.02) throw new Error(`Goblin animation continued while paused (${pauseFrame} -> ${pausedFrame}).`);
  await evaluate("document.querySelector('#pause-button').click()");
  const resumed = await waitFor("window.__towerDefenceEnemyAnimationTest.snapshot().active.find(e=>e.id===-9300)?.isPlaying===true", "Casual_Walk resume");
  if (!resumed) throw new Error("Goblin animation failed to resume.");

  // This debug wave is deliberately inactive, so move only the test entity's
  // GameState coordinates and verify the presentation root mirrors them exactly.
  const motionBefore = await evaluate(`(() => {
    const e=window.__towerDefenceGameState.enemies[0]; e.speed=.25; e.affixes=[]; e.slowMultiplier=1;
    const v=window.__towerDefenceEnemyAnimationTest.snapshot().active.find(item=>item.id===e.id);
    return {cell:{x:e.x,y:e.y},world:v.position,frame:v.frame};
  })()`);
  await evaluate("window.__towerDefenceGameState.enemies[0].x += .1; window.__towerDefenceGameState.enemies[0].y += .05");
  await waitFor(`(() => {
    const e=window.__towerDefenceGameState.enemies[0];
    const v=window.__towerDefenceEnemyAnimationTest.snapshot().active.find(item=>item.id===e.id);
    return Math.abs(v.position.x-${motionBefore.world.x + 0.1})<.005&&Math.abs(v.position.z-${motionBefore.world.z + 0.05})<.005;
  })()`, "visual root following the GameState test position", 15000);
  const motionAfter = await evaluate(`(() => {
    const e=window.__towerDefenceGameState.enemies[0];
    const v=window.__towerDefenceEnemyAnimationTest.snapshot().active.find(item=>item.id===e.id);
    return {cell:{x:e.x,y:e.y},world:v.position,frame:v.frame};
  })()`);
  const cellDistance = Math.hypot(motionAfter.cell.x - motionBefore.cell.x, motionAfter.cell.y - motionBefore.cell.y);
  const visualDistance = Math.hypot(motionAfter.world.x - motionBefore.world.x, motionAfter.world.z - motionBefore.world.z);
  if (Math.abs(visualDistance - cellDistance) > 0.005 || Math.abs(motionAfter.world.y - motionBefore.world.y) > 0.005
    || motionAfter.frame === motionBefore.frame) {
    throw new Error(`Animation affected path movement/grounding: ${JSON.stringify({ motionBefore, motionAfter, cellDistance, visualDistance })}`);
  }

  const goblinKilled = await evaluate("[window.__towerDefenceEnemyAnimationTest.kill(-9300),window.__towerDefenceEnemyAnimationTest.kill(-9301)]");
  if (goblinKilled[0] !== -9300 || goblinKilled[1] !== -9301) throw new Error(`Goblin removal hook failed: ${JSON.stringify(goblinKilled)}`);
  await waitFor("(() => { const s=window.__towerDefenceEnemyAnimationTest.snapshot(); return s.skeletons===0&&s.activeAnimationGroups===0&&s.active.length===0; })()", "Goblin skeleton/controller disposal");

  const stress = [];
  for (const count of [25, 50, 100]) {
    const created = await evaluate(`window.__towerDefenceEnemyAnimationTest.spawn(${count},'goblin')`);
    if (created.length !== count) throw new Error(`Spawned ${created.length}/${count} stress Goblins.`);
    const stats = await waitFor(`(() => {
      const s=window.__towerDefenceEnemyAnimationTest.snapshot();
      return s.active?.length===${count}&&s.active.every(e=>e.type==='goblin'&&e.clip?.endsWith('Casual_Walk')&&e.loops)?s:null;
    })()`, `${count} independent Goblin skeletons`, 90000);
    await delay(900);
    const measured = await evaluate("(() => ({...window.__towerDefenceEnemyAnimationTest.snapshot(),heapBytes:performance.memory?.usedJSHeapSize??null}))()");
    if (measured.activeAnimationGroups !== count || measured.skeletons !== count) throw new Error(`Goblin stress allocation mismatch at ${count}: ${JSON.stringify(measured)}`);
    stress.push({ requested: count, active: measured.active.length, skeletons: measured.skeletons, animationGroups: measured.animationGroups,
      activeAnimationGroups: measured.activeAnimationGroups, meshCount: measured.meshCount, fps: measured.fps,
      frameTimeMs: measured.frameTimeMs, heapBytes: measured.heapBytes });
    if (!stats) throw new Error(`No stress snapshot for ${count}.`);
  }

  const mobileLayouts = [];
  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }]) {
    await command("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: true });
    await delay(150);
    mobileLayouts.push(await evaluate(`(() => ({ viewport:[innerWidth,innerHeight], horizontalOverflow:document.documentElement.scrollWidth>innerWidth,
      activeGoblins:window.__towerDefenceEnemyAnimationTest.snapshot().active.length }))()`));
  }
  if (mobileLayouts.some((layout) => layout.horizontalOverflow)) throw new Error(`Goblin presentation caused mobile HUD overflow: ${JSON.stringify(mobileLayouts)}`);

  const cleanup = await evaluate(`(() => {
    let removed=0; while(window.__towerDefenceEnemyAnimationTest.kill()!==undefined) removed++;
    return {removed,snapshot:window.__towerDefenceEnemyAnimationTest.snapshot()};
  })()`);
  if (cleanup.removed !== 100) throw new Error(`Stress cleanup removed ${cleanup.removed}/100 Goblins.`);
  const cleaned = await waitFor("(() => { const s=window.__towerDefenceEnemyAnimationTest.snapshot(); return s.active.length===0&&s.dying.length===0&&s.skeletons===0&&s.animationGroups===0&&s.activeAnimationGroups===0?s:null; })()",
    "all 100 Goblin skeletons/groups cleaned up", 20000);

  // Verify the real load-failure branch falls back to the already shipped static Goblin.
  await command("Fetch.enable", { patterns: [{ urlPattern: "*goblin-meshy-casual-walk.glb*", requestStage: "Request" }] });
  failGoblinAsset = true;
  await enterBattlefield(query);
  await startSelectedBattlefield();
  const fallbackTemplate = await evaluate("window.__enemyTemplateAudit.find(item=>item.type==='goblin')");
  const fallbackSpawned = await evaluate("window.__towerDefenceEnemyAnimationTest.spawn(1,'goblin')");
  const fallbackVisual = await waitFor("window.__towerDefenceEnemyAnimationTest.snapshot().activeVisuals?.find(v=>v.type==='goblin'&&!v.animated)", "static Goblin fallback visual");
  if (failedGoblinRequests < 1 || fallbackSpawned.length !== 1 || fallbackTemplate.skeletons !== 0
    || !fallbackTemplate.assetPath.endsWith("/assets/models/enemies/optimized/goblin.glb")
    || fallbackVisual.assetPath !== fallbackTemplate.assetPath) {
    throw new Error(`Static Goblin fallback failed: ${JSON.stringify({ failedGoblinRequests, fallbackTemplate, fallbackVisual })}`);
  }

  const errors = browserMessages.filter(({ type }) => type === "exception");
  if (errors.length) throw new Error(`Browser JavaScript exceptions: ${JSON.stringify(errors)}`);
  console.log(JSON.stringify({
    sourceAsset: "3D/Goblin/Meshy_AI_Bloodfang_Marauder_biped/Meshy_AI_Bloodfang_Marauder_biped_Animation_Casual_Walk_withSkin.glb",
    template: goblinTemplate,
    instance,
    moving: moving.active,
    loopAfterCycle,
    modifierSpeeds,
    heading,
    frenziedPlaybackSpeed: frenzied.speed,
    commanderAuraPlaybackSpeed: auraTarget.speed,
    overlays: { affixIcons: overlayState.affixIconCount, shieldBars: overlayState.shieldBarCount, slowIndicators: overlayState.slowIndicatorCount },
    gameSpeed: doubleSpeed.speed,
    pause: { frameBefore: pauseFrame, frameAfter: pausedFrame, resumed: resumed.isPlaying },
    gameStateVsVisualMotion: { cellDistance, visualDistance },
    stress,
    mobileLayouts,
    afterCleanup: cleaned,
    fallback: { failedRequests: failedGoblinRequests, assetPath: fallbackTemplate.assetPath, animated: fallbackVisual.animated },
    browserExceptions: errors,
    note: "SwiftShader frame times are diagnostic only, not physical mobile-hardware performance claims.",
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  socket?.close();
  chrome?.kill();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 }); } catch {} }, 1000).unref();
});
