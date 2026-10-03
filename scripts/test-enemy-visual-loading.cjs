// Isolated Babylon GLB smoke test; requires the Vite dev server and Chrome.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "td-enemy-visuals-"));
const pending = new Map();
const runtimeErrors = [];
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

async function waitFor(predicate, label, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await evaluate(predicate);
    if (result) return result;
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${label}; runtime errors: ${JSON.stringify(runtimeErrors)}`);
}

async function main() {
  chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--disable-extensions", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--remote-debugging-port=9257", `--user-data-dir=${profile}`, "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  await delay(1200);
  const pages = await (await fetch("http://127.0.0.1:9257/json")).json();
  socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails?.text ?? "runtime exception");
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message.result || message.error); pending.delete(message.id); }
  });
  await command("Runtime.enable");
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
  await command("Page.navigate", { url: "http://127.0.0.1:5173/?enemyVisualDebug=1&waveDebug=1&disableEnvironmentProps=1" });

  await waitFor("!!window.__towerDefenceEnemyVisualTest?.spawnPair", "debug spawn hook");
  // Spawn immediately while large GLBs may still be loading. The renderer must
  // wait for these two templates instead of showing its humanoid placeholder.
  const spawned = await evaluate("window.__towerDefenceEnemyVisualTest.spawnPair()");
  if (!Array.isArray(spawned) || spawned.map(({ type }) => type).join(",") !== "ghoul,wraith") {
    throw new Error(`Debug spawn hook returned unexpected enemies: ${JSON.stringify(spawned)}`);
  }
  await waitFor("['ghoul','wraith'].every(type => window.__enemyTemplateAudit?.some(item => item.type === type))",
    "both Ghoul/Wraith GLB templates to load");
  await waitFor("['ghoul','wraith'].every(type => window.__enemyVisualSpawnAudit?.some(item => item.type === type))",
    "both enemy instances to render");

  const report = await evaluate(`(() => {
    const types=['ghoul','wraith'];
    return types.map(type => ({
      template:window.__enemyTemplateAudit.find(item=>item.type===type),
      spawn:window.__enemyVisualSpawnAudit.find(item=>item.type===type),
      instance:window.__enemyVisualAudit.find(item=>item.status==='accepted'&&item.type===type),
      debugLabel:Object.values(window.__enemyVisualDebugLabels ?? {}).find(label=>label.startsWith(type.toUpperCase())),
    }));
  })()`);
  for (const item of report) {
    if (!item.template?.meshes?.some((mesh) => mesh.vertices > 0 && mesh.hasMaterial)
      || !item.spawn || item.spawn.fallback || item.spawn.renderableMeshCount < 1 || item.spawn.materials.length < 1
      || item.instance?.status !== "accepted" || item.debugLabel !== `${item.spawn.type.toUpperCase()} · GLB`) {
      throw new Error(`Enemy did not resolve to a renderable GLB instance: ${JSON.stringify({ report, runtimeErrors })}`);
    }
  }
  console.log(JSON.stringify({ isolatedSpawn: spawned, visualAudit: report, runtimeErrors }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  socket?.close();
  chrome?.kill();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 }); } catch {} }, 1000).unref();
});
