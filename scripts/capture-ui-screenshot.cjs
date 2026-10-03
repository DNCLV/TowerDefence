// Capture a fixed portrait viewport from the running Vite app through Chrome DevTools.
// Usage: node scripts/capture-ui-screenshot.cjs artifacts/ui-polish-before.png
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const output = path.resolve(process.argv[2] ?? "artifacts/ui-polish.png");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "td-ui-shot-"));
let chrome;
let socket;
let nextId = 0;
const pending = new Map();

async function command(method, params = {}) {
  const id = ++nextId;
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30000);
    pending.set(id, (message) => { clearTimeout(timeout); resolve(message); });
  });
  socket.send(JSON.stringify({ id, method, params }));
  return result;
}

async function main() {
  chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--disable-extensions", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--remote-debugging-port=9252", `--user-data-dir=${profile}`, "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  let pages;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      pages = await (await fetch("http://127.0.0.1:9252/json")).json();
      break;
    } catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  if (!pages) throw new Error("Chrome DevTools did not start");
  socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message.result ?? message.error); pending.delete(message.id); }
  });
  await command("Runtime.enable");
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await command("Page.navigate", { url: "http://127.0.0.1:5173/?waveDebug=1" });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await command("Runtime.evaluate", { expression: "document.querySelector('.game-title')?.textContent", returnByValue: true });
    if (state.result?.value === "Tower Defence") { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Game UI did not initialize");
  await command("Runtime.evaluate", { expression: "Promise.all([...document.images].map(image => image.decode().catch(() => undefined)))", awaitPromise: true });
  if (process.argv[3] === "--tower") {
    await command("Runtime.evaluate", { expression: `(() => {
      const screenshotStyle = document.createElement('style');
      screenshotStyle.textContent = '#tower-panel[hidden] { display: block !important; }';
      document.head.append(screenshotStyle);
      document.querySelector('#tower-empty-state').hidden = true;
      document.querySelector('#tower-panel').hidden = false;
      document.querySelector('.tower-name').textContent = 'Blue Wizard';
      document.querySelector('#tower-level').textContent = 'Level 2';
      document.querySelector('#tower-damage').textContent = '65';
      document.querySelector('#tower-range').textContent = '4.2 Tiles';
      document.querySelector('#tower-fire-rate').textContent = '1.15/s';
      document.querySelector('#tower-kills').textContent = '14';
      document.querySelector('#tower-damage-done').textContent = '1,845';
      document.querySelector('.tower-portrait').style.backgroundImage = 'url("/assets/ui/defenders/wizard.png")';
    })()` });
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
  console.log(`Saved ${output} at 390x844`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  socket?.close();
  chrome?.kill();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {} }, 1000).unref();
});
