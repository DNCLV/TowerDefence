// Isolated portrait capture. Run with: node scripts/capture-arena.cjs before 0
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const label = process.argv[2] || 'after';
const seed = process.argv[3] || '0';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'td-capture-'));
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5191', '--strictPort'], { windowsHide: true });
let chrome;
let socket;
const pending = new Map();
let id = 0;
async function command(method, params = {}) {
  const requestId = ++id;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('CDP timeout: ' + method)); }, 90000);
    pending.set(requestId, value => { clearTimeout(timer); resolve(value); });
  });
  socket.send(JSON.stringify({ id: requestId, method, params }));
  return promise;
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}
(async () => {
  await delay(3000);
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-extensions', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=9238', '--user-data-dir=' + profile, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  await delay(2500);
  const pages = await (await fetch('http://127.0.0.1:9238/json')).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (pending.has(data.id)) { pending.get(data.id)(data.result || data.error); pending.delete(data.id); }
  });
  await command('Emulation.setDeviceMetricsOverride', { width: 540, height: 900, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: 'http://127.0.0.1:5191/?themeSeed=' + seed + '&perfDebug=1&waveDebug=1&dumpSceneMeshes=1' });
  for (let attempt = 0; attempt < 90; attempt++) {
    await delay(1000);
    if (await evaluate('!!window.__environmentMeshDump && (window.__enemyTemplateAudit?.length === 4)')) break;
    if (attempt === 89) throw new Error('Scene assets did not become ready');
  }
  const report = await evaluate(`JSON.stringify({ meshes: window.__environmentMeshDump.length,
    environmentMeshes: window.__environmentMeshDump.filter(m => m.sourceAsset !== 'procedural/runtime').length,
    camera: window.__cameraDebugHistory, enemyTemplates: window.__enemyTemplateAudit,
    metrics: document.querySelector('.perf-debug')?.textContent })`);
  fs.mkdirSync('artifacts/visual-overhaul', { recursive: true });
  fs.writeFileSync('artifacts/visual-overhaul/' + label + '-' + seed + '.json', report);
  await evaluate("document.querySelector('.perf-debug')?.remove()");
  const shot = await command('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('artifacts/visual-overhaul/' + label + '-' + seed + '.png', Buffer.from(shot.data, 'base64'));
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 270, y: 510 });
  await delay(650);
  const buildShot = await command('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('artifacts/visual-overhaul/' + label + '-build-hover-' + seed + '.png', Buffer.from(buildShot.data, 'base64'));
  console.log(report);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket?.readyState === 1) { await command('Browser.close').catch(() => {}); socket.close(); }
  chrome?.kill(); server.kill();
});
