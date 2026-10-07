// Inspect the local Quaternius Animated Monster Pack through Babylon's FBX loader.
// Start the Vite dev server first; this keeps the audit on the same importer used at runtime.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pack = path.join(root, "Quaternius", "Animated Monster Pack by @Quaternius");
const models = ["Bat", "Dragon", "Skeleton", "Slime"];
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "td-monster-pack-audit-"));
const appUrl = process.env.TD_TEST_URL ?? "http://127.0.0.1:5174/";
const port = 9263;
const pending = new Map();
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

async function main() {
  chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--disable-extensions", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  let pages;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
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
  await command("Page.navigate", { url: appUrl });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if (await evaluate("!!document.querySelector('#game3d')")) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const sourceFiles = models.map((name) => {
    const fbx = path.join(pack, "FBX", `${name}.fbx`);
    const blend = path.join(pack, "Blend", `${name}.blend`);
    const obj = path.join(pack, "OBJ", `${name}.obj`);
    return { name, fbxBytes: fs.statSync(fbx).size, blendBytes: fs.statSync(blend).size, objBytes: fs.statSync(obj).size };
  });
  const fbxBase64 = Object.fromEntries(models.map((name) => [
    name, fs.readFileSync(path.join(pack, "FBX", `${name}.fbx`)).toString("base64"),
  ]));
  const report = await evaluate(`(async () => {
    const [{ NullEngine, Scene }, { FBXFileLoader }] = await Promise.all([
      import('/node_modules/.vite/deps/@babylonjs_core.js'),
      import('/node_modules/@babylonjs/loaders/FBX/fbxFileLoader.js'),
    ]);
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const names = ${JSON.stringify(models)};
    const fbxBase64 = ${JSON.stringify(fbxBase64)};
    const results = [];
    for (const name of names) {
      try {
        const binary = atob(fbxBase64[name]);
        const data = Uint8Array.from(binary, char => char.charCodeAt(0));
        const container = await new FBXFileLoader().loadAssetContainerAsync(scene, data, '');
        const meshData = container.meshes.filter(mesh => mesh.getTotalVertices() > 0).map(mesh => ({
          name: mesh.name,
          vertices: mesh.getTotalVertices(),
          triangles: (mesh.getTotalIndices() ?? 0) / 3,
        }));
        container.transformNodes.forEach(node => node.computeWorldMatrix(true));
        const bounds = container.meshes.filter(mesh => mesh.getTotalVertices() > 0).reduce((result, mesh) => {
          mesh.computeWorldMatrix(true);
          const box = mesh.getBoundingInfo().boundingBox;
          return {
            minX: Math.min(result.minX, box.minimumWorld.x), minY: Math.min(result.minY, box.minimumWorld.y), minZ: Math.min(result.minZ, box.minimumWorld.z),
            maxX: Math.max(result.maxX, box.maximumWorld.x), maxY: Math.max(result.maxY, box.maximumWorld.y), maxZ: Math.max(result.maxZ, box.maximumWorld.z),
          };
        }, { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity });
        const dimensions = { width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY, depth: bounds.maxZ - bounds.minZ };
        const clipData = container.animationGroups.map(group => {
          const fps = group.targetedAnimations[0]?.animation?.framePerSecond ?? null;
          return { name: group.name, from: group.from, to: group.to, frameRate: fps,
            durationSeconds: fps ? Number(((group.to - group.from) / fps).toFixed(3)) : null,
            targetedTracks: group.targetedAnimations.length,
            rootMotionTracks: group.targetedAnimations.filter(track => /(^|\|)Root$/i.test(track.target?.name ?? '')
              && track.animation?.targetProperty === 'position').map(track => ({ target: track.target.name, property: track.animation.targetProperty })) };
        });
        results.push({ name, meshData, triangles: meshData.reduce((sum, mesh) => sum + mesh.triangles, 0), dimensions,
          skeletons: container.skeletons.map(skeleton => ({ name: skeleton.name, boneCount: skeleton.bones.length,
            bones: skeleton.bones.map(bone => ({ name: bone.name, parent: bone.getParent()?.name ?? null })) })),
          clips: clipData, materialNames: container.materials.map(material => material.name),
          textures: container.textures.map(texture => ({ name: texture.name, size: texture.getSize?.() ?? null })) });
        container.dispose();
      } catch (error) { results.push({ name, error: String(error) }); }
    }
    engine.dispose();
    return results;
  })()`);
  console.log(JSON.stringify({ pack: path.relative(root, pack), sourceFiles, babylonInventory: report }, null, 2));
  if (report.length !== models.length || report.some((item) => item.error || item.skeletons?.length === 0)) {
    throw new Error("One or more FBX assets failed to load or have no skeleton; see inventory above.");
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  socket?.close();
  chrome?.kill();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 }); } catch {} }, 1000).unref();
});
