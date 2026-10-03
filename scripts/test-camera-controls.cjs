// Manual-like camera gesture regression test using Chrome DevTools Protocol.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'td-camera-'));
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5192', '--strictPort'], { windowsHide: true });
let chrome, socket;
const pending = new Map(); let id = 0;
async function command(method, params = {}) {
  const requestId = ++id;
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(requestId, value => { clearTimeout(timeout); resolve(value); });
  });
  socket.send(JSON.stringify({ id: requestId, method, params }));
  return result;
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}
async function camera() {
  const text = await evaluate("document.querySelector('pre[style*=fixed]')?.textContent || ''");
  const match = text.match(/alpha ([\d.-]+) beta ([\d.-]+) radius ([\d.-]+)\ntarget ([\d.-]+), ([\d.-]+)/);
  if (!match) throw new Error('Camera debug overlay missing: ' + text);
  return { alpha: +match[1], beta: +match[2], radius: +match[3], x: +match[4], z: +match[5] };
}
async function mouseDrag(x1, y1, x2, y2) {
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x2, y: y2, button: 'left', buttons: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0 });
  await delay(250);
}
async function cornerSweep(repeats) {
  const results = [];
  for (const [x, y] of [[520, 880], [20, 880], [520, 20], [20, 20]]) {
    for (let step = 0; step < repeats; step++) await mouseDrag(270, 450, x, y);
    results.push(await camera());
  }
  return results;
}
(async () => {
  await delay(2500);
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-extensions', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=9239', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  await delay(2000);
  const pages = await (await fetch('http://127.0.0.1:9239/json')).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const data = JSON.parse(event.data); if (pending.has(data.id)) { pending.get(data.id)(data.result || data.error); pending.delete(data.id); } });
  await command('Emulation.setDeviceMetricsOverride', { width: 540, height: 900, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: 'http://127.0.0.1:5192/?cameraDebug=1&waveDebug=1' });
  for (let attempt = 0; attempt < 90; attempt++) {
    await delay(1000);
    if (await evaluate("!!document.querySelector('pre[style*=fixed]')")) break;
    if (attempt === 89) throw new Error('Camera debug overlay did not initialize: ' + await evaluate('document.body.innerText'));
  }
  for (let attempt = 0; attempt < 90; attempt++) {
    await delay(1000);
    if (await evaluate('window.__enemyTemplateAudit?.length === 4')) break;
    if (attempt === 89) throw new Error('Enemy/environment assets did not finish loading');
  }
  const initial = await camera();
  fs.mkdirSync('artifacts/camera-angle', { recursive: true });
  const view = await command('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('artifacts/camera-angle/along-alpha-pi.png', Buffer.from(view.data, 'base64'));
  const initialTowers = await evaluate('window.__towerDefenceGameState.towers.length');
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: 270, y: 450, button: 'left', buttons: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 270, y: 450, button: 'left', buttons: 0 });
  await delay(250);
  const towersAfterTap = await evaluate('window.__towerDefenceGameState.towers.length');
  const corners = await cornerSweep(16);
  await command('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 270, y: 450, deltaY: -1000 });
  const wheelEvent = await evaluate("(() => { const e = new WheelEvent('wheel', { deltaY: -350, bubbles: true, cancelable: true }); document.querySelector('canvas').dispatchEvent(e); return { prevented: e.defaultPrevented }; })()");
  await delay(250);
  const wheel = await camera();
  const touchContext = await evaluate(`(() => ({ towers: window.__towerDefenceGameState.towers.length, touchAction: getComputedStyle(document.querySelector('canvas')).touchAction }))()`);
  await command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const oneFingerBefore = await camera();
  await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 210, y: 450, id: 11 }] });
  await command('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 340, y: 450, id: 11 }] });
  await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(250);
  const oneFingerAfter = await camera();
  const towersAfterTouchDrag = await evaluate('window.__towerDefenceGameState.towers.length');
  const pinchStart = await camera();
  const pinchTowers = await evaluate('window.__towerDefenceGameState.towers.length');
  await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 450, id: 1 }, { x: 360, y: 450, id: 2 }] });
  await command('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 130, y: 450, id: 1 }, { x: 410, y: 450, id: 2 }] });
  await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(300);
  const pinch = await camera();
  const towersAfterPinch = await evaluate('window.__towerDefenceGameState.towers.length');
  const minZoomCorners = await cornerSweep(28);
  await evaluate("document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', { deltaY: 5000, bubbles: true, cancelable: true }))");
  await delay(800);
  const maxZoom = await camera();
  const maxZoomCorners = await cornerSweep(16);
  const angleStable = corners.concat(minZoomCorners, maxZoomCorners, [wheel, pinch]).every(c => Math.abs(c.alpha - initial.alpha) < 0.001 && Math.abs(c.beta - initial.beta) < 0.001);
  const panMoved = corners.some(c => Math.hypot(c.x - initial.x, c.z - initial.z) > 2);
  const allTargetsBounded = corners.every(c => c.x >= -1 && c.x <= 49 && c.z >= -1 && c.z <= 33);
  const expectedCorners = [[0, 0], [0, 32], [48, 0], [48, 32]];
  const allCornersReached = corners.every((c, i) => Math.abs(c.x - expectedCorners[i][0]) <= 1 && Math.abs(c.z - expectedCorners[i][1]) <= 1);
  const minZoomCornersReached = minZoomCorners.every((c, i) => Math.abs(c.x - expectedCorners[i][0]) <= 1 && Math.abs(c.z - expectedCorners[i][1]) <= 1);
  const maxZoomCornersReached = maxZoomCorners.every((c, i) => Math.abs(c.x - expectedCorners[i][0]) <= 1 && Math.abs(c.z - expectedCorners[i][1]) <= 1);
  const wheelZoomed = wheelEvent.prevented && wheel.radius < initial.radius && maxZoom.radius === 32;
  const pinchZoomed = pinch.radius === 13.5 && pinch.radius < pinchStart.radius && towersAfterPinch === pinchTowers;
  const panAtMaxZoom = maxZoomCorners.every(c => Math.abs(c.alpha - initial.alpha) < 0.001 && Math.abs(c.beta - initial.beta) < 0.001 && c.x >= -1 && c.x <= 49 && c.z >= -1 && c.z <= 33);
  const placementAndDragSafe = towersAfterTap === initialTowers + 1 && touchContext.towers === towersAfterTap && towersAfterTouchDrag === towersAfterTap && Math.hypot(oneFingerAfter.x - oneFingerBefore.x, oneFingerAfter.z - oneFingerBefore.z) > 1;
  if (!angleStable || !panMoved || !allTargetsBounded || !allCornersReached || !minZoomCornersReached || !maxZoomCornersReached || !wheelZoomed || !pinchZoomed || !panAtMaxZoom || !placementAndDragSafe) {
    throw new Error(JSON.stringify({ initial, initialTowers, towersAfterTap, corners, wheel, wheelEvent, oneFingerBefore, oneFingerAfter, pinchStart, pinch, minZoomCorners, maxZoom, maxZoomCorners, touchContext, towersAfterTouchDrag, towersAfterPinch, angleStable, panMoved, allTargetsBounded, allCornersReached, minZoomCornersReached, maxZoomCornersReached, wheelZoomed, pinchZoomed, panAtMaxZoom, placementAndDragSafe }));
  }
  console.log(JSON.stringify({ initial, towersAfterTap, corners, minZoomCorners, maxZoom, maxZoomCorners, wheel, pinch, angleStable, panMoved, allTargetsBounded, allCornersReached, minZoomCornersReached, maxZoomCornersReached, wheelZoomed, pinchZoomed, panAtMaxZoom, placementAndDragSafe, hudCanvasTouchAction: touchContext.touchAction }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket?.readyState === 1) { await command('Browser.close').catch(() => {}); socket.close(); }
  chrome?.kill(); server.kill();
});
