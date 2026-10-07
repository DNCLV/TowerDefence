// Browser proof-of-concept/stress check for the Animated Monster Pack integration.
// Start `npm run dev -- --host 127.0.0.1` first.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "td-enemy-animation-"));
const appUrl = process.env.TD_TEST_URL ?? "http://127.0.0.1:5174/";
const port = 9264;
const pending = new Map();
const browserMessages = [];
let chrome;
let socket;
let nextId = 0;

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
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--disable-extensions", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-precise-memory-info",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  let pages;
  for (let attempt = 0; attempt < 80; attempt += 1) {
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
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message.result || message.error); pending.delete(message.id); }
  });
  await command("Runtime.enable");
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
  const debugFlags = `waveDebug=1&enemyVisualDebug=1&enemyAnimationDebug=1&disableEnvironmentProps=1${process.env.TD_ANIMATION_SCREENSHOT ? "&minimapDebug=1" : ""}`;
  await command("Page.navigate", { url: `${appUrl}?${debugFlags}` });
  await waitFor("!!document.querySelector('#start-selected-map')", "map selection screen");
  await evaluate("document.querySelector('#start-selected-map').click(); document.querySelector('#start-battlefield').click()");
  try { await waitFor("!!window.__towerDefenceEnemyAnimationTest", "animation test hook", 20000); }
  catch (error) {
    const diagnostics = await evaluate(`({ title:document.querySelector('#faction-select-title')?.textContent,
      loading:document.querySelector('.battlefield-loading-overlay')?.textContent,
      gameUI:!!document.querySelector('.game-ui'), hook:!!window.__towerDefenceEnemyAnimationTest,
      url:location.href })`);
    throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}; browserMessages=${JSON.stringify(browserMessages.slice(-30))}`);
  }
  await waitFor("document.querySelector('.game-ui')?.dataset.defenderAssetsReady === 'true'", "gameplay renderer");
  await delay(1200);
  const baseline = await evaluate(`(() => ({ ...window.__towerDefenceEnemyAnimationTest.snapshot(),
    heapBytes:performance.memory?.usedJSHeapSize ?? null }))()`);

  const spawned = await evaluate("window.__towerDefenceEnemyAnimationTest.spawn(1)");
  if (!Array.isArray(spawned) || spawned.length !== 1 || spawned[0].type !== "skeletonKing") throw new Error(`Unexpected POC spawn: ${JSON.stringify(spawned)}`);
  try {
    await waitFor("window.__towerDefenceEnemyAnimationTest.snapshot().active?.some(enemy => enemy.id === -9300 && enemy.clip?.includes('Skeleton_Running'))", "Skeleton Running clip", 30000);
  } catch (error) {
    const diagnostics = await evaluate(`({ snapshot:window.__towerDefenceEnemyAnimationTest.snapshot(),
      loaded:window.__enemyTemplateAudit?.filter(item=>item.type==='skeletonKing'),
      spawns:window.__enemyVisualSpawnAudit?.filter(item=>item.type==='skeletonKing'),
      instances:window.__enemyVisualAudit?.filter(item=>item.type==='skeletonKing'),
      transitions:window.__enemyAnimationTransitions })`);
    throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}; browserMessages=${JSON.stringify(browserMessages.slice(-30))}`);
  }
  const initial = await evaluate("({ snapshot:window.__towerDefenceEnemyAnimationTest.snapshot(), template:window.__enemyTemplateAudit?.find(item=>item.type==='skeletonKing'), instance:window.__enemyVisualInstances?.find(item=>item.id===-9300), transitions:window.__enemyAnimationTransitions ?? [] })");
  if (initial.template?.skeletons !== 1 || !initial.template.animations?.some((name) => name.endsWith("Skeleton_Idle"))
    || !initial.instance?.bounds || !initial.instance.assetPath?.endsWith("Skeleton.fbx")) {
    throw new Error(`Animated Skeleton King did not use the expected FBX rig: ${JSON.stringify(initial)}`);
  }
  if (process.env.TD_ANIMATION_SCREENSHOT) {
    await evaluate("window.__towerDefenceMinimapDebug?.setTarget(8.5, 1.5)");
    await delay(750);
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.resolve(process.env.TD_ANIMATION_SCREENSHOT), Buffer.from(screenshot.data, "base64"));
  }
  if (process.env.TD_ANIMATION_SCREENSHOT_ONLY === "1") {
    console.log(JSON.stringify({ asset: initial.template, instance: initial.instance, state: initial.snapshot.active[0], screenshot: process.env.TD_ANIMATION_SCREENSHOT }, null, 2));
    return;
  }

  await delay(700);
  const repeated = await evaluate("window.__enemyAnimationTransitions.filter(item=>item.enemyId===-9300&&item.state==='moving').length");
  if (repeated !== 1) throw new Error(`Moving clip restarted ${repeated} times instead of once.`);
  await evaluate("window.__towerDefenceGameState.enemies[0].speed=0");
  const idleState = await waitFor("(() => { const item=window.__towerDefenceEnemyAnimationTest.snapshot().active.find(item=>item.id===-9300); return item?.state==='idle' ? item : null; })()", "Idle clip after the enemy stops", 15000);
  if (idleState?.state !== "idle" || !idleState.clip?.includes("Skeleton_Idle")) {
    const context = await evaluate("({speed:window.__towerDefenceGameState.enemies.find(enemy=>enemy.id===-9300)?.speed,transitions:window.__enemyAnimationTransitions})");
    throw new Error(`Idle state failed: ${JSON.stringify({ idleState, context })}`);
  }
  const pausedPosition = idleState.position;
  await delay(400);
  const stillIdlePosition = await evaluate("window.__towerDefenceEnemyAnimationTest.snapshot().active.find(item=>item.id===-9300).position");
  const rootStayedStable = Math.hypot(stillIdlePosition.x - pausedPosition.x, stillIdlePosition.z - pausedPosition.z) < 0.001;
  if (!rootStayedStable) throw new Error("Skeleton animation moved the GameState-controlled root while stopped.");

  await evaluate(`(() => {
    const enemy=window.__towerDefenceGameState.enemies[0];
    enemy.speed=0.25; enemy.slowMultiplier=0.5;
    return enemy.id;
  })()`);
  await delay(100);
  const slowSpeedState = await waitFor("(() => { const item=window.__towerDefenceEnemyAnimationTest.snapshot().active.find(item=>item.id===-9300); return item?.speed<1 ? item : null; })()", "slower playback for Frost slow", 15000);
  const slowSpeed = slowSpeedState.speed;
  await evaluate(`(() => {
    const enemy=window.__towerDefenceGameState.enemies[0];
    enemy.slowMultiplier=1; enemy.affixes=[{id:'swift',tier:1}];
  })()`);
  const swiftSpeedState = await waitFor("(() => { const item=window.__towerDefenceEnemyAnimationTest.snapshot().active.find(item=>item.id===-9300); return item?.speed>1 ? item : null; })()", "faster playback for Swift", 15000);
  const swiftSpeed = swiftSpeedState.speed;
  await evaluate("window.__towerDefenceGameState.enemies[0].affixes=[]");
  const speedSummary = { slow: slowSpeed, swift: swiftSpeed };
  if (!(speedSummary.slow < 1 && speedSummary.swift > 1)) throw new Error(`Visual speed sync failed: ${JSON.stringify(speedSummary)}`);

  const killed = await evaluate("window.__towerDefenceEnemyAnimationTest.kill(-9300)");
  if (killed !== -9300) throw new Error("The test enemy was not removed from GameState immediately.");
  const dying = await evaluate("window.__towerDefenceEnemyAnimationTest.snapshot()");
  const dyingVisual = dying.dying?.find((item) => item.id === -9300);
  if (!dyingVisual || dyingVisual.state !== "dying" || !dyingVisual.clip?.includes("Skeleton_Death")) throw new Error(`Death clip did not start: ${JSON.stringify(dying)}`);
  await waitFor("window.__towerDefenceEnemyAnimationTest.snapshot().dying?.length === 0", "visual corpse cleanup", 5000);

  const stress = [];
  for (const count of [25, 50, 100]) {
    const created = await evaluate(`window.__towerDefenceEnemyAnimationTest.spawn(${count})`);
    if (created.length !== count) throw new Error(`Spawned ${created.length}/${count} stress enemies.`);
    const stats = await waitFor(`(() => { const s=window.__towerDefenceEnemyAnimationTest.snapshot(); return s.active?.length===${count} ? s : null; })()`, `${count} animated skeletons`, 90000);
    await delay(1200);
    const measured = await evaluate(`(() => ({ ...window.__towerDefenceEnemyAnimationTest.snapshot(), heapBytes:performance.memory?.usedJSHeapSize ?? null }))()`);
    if (measured.activeAnimationGroups !== count || measured.skeletons < count) {
      throw new Error(`Stress count mismatch at ${count}: ${JSON.stringify(measured)}`);
    }
    stress.push({ requested: count, active: measured.active.length, activeAnimationGroups: measured.activeAnimationGroups,
      skeletons: measured.skeletons, animationGroups: measured.animationGroups, meshCount: measured.meshCount,
      fps: measured.fps, frameTimeMs: measured.frameTimeMs, heapBytes: measured.heapBytes });
    if (!stats) throw new Error(`No stats returned for ${count}.`);
  }

  const mobileLayouts = [];
  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }]) {
    await command("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: true });
    await delay(150);
    mobileLayouts.push(await evaluate(`(() => ({ viewport:[innerWidth,innerHeight], uiWidth:document.querySelector('.game-ui').getBoundingClientRect().width,
      horizontalOverflow:document.documentElement.scrollWidth>innerWidth, animationCount:window.__towerDefenceEnemyAnimationTest.snapshot().active.length }))()`));
  }
  const retainedCorpseCount = await evaluate(`(() => {
    let killed=0;
    while (window.__towerDefenceEnemyAnimationTest.kill() !== undefined) killed++;
    return { killed, snapshot:window.__towerDefenceEnemyAnimationTest.snapshot() };
  })()`);
  if (retainedCorpseCount.killed !== 100 || retainedCorpseCount.snapshot.dying.length > 12) {
    throw new Error(`Death visual cap failed: ${JSON.stringify(retainedCorpseCount)}`);
  }
  await waitFor(`(() => { const s=window.__towerDefenceEnemyAnimationTest.snapshot(); return s.active.length===0&&s.dying.length===0&&s.skeletons===0&&s.activeAnimationGroups===0 ? s : null; })()`,
    "all stress skeletons and death visuals disposed", 15000);
  const afterCleanup = await evaluate("window.__towerDefenceEnemyAnimationTest.snapshot()");
  console.log(JSON.stringify({ baseline, asset:initial.template, instance:initial.instance, initialState:initial.snapshot.active[0], movingTransitions:repeated,
    rootStableWhileIdle:rootStayedStable, speedCheck:speedSummary, dyingVisual:dyingVisual && { state:dyingVisual.state, clip:dyingVisual.clip },
    corpseDisposed:true, stress, mobileLayouts, retainedCorpseCap:retainedCorpseCount.snapshot.dying.length,
    afterStressCleanup:afterCleanup, note:"Headless SwiftShader measurements are comparative only, not physical-phone FPS." }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  socket?.close();
  chrome?.kill();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 }); } catch {} }, 1000).unref();
});
