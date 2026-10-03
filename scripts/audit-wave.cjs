const socketUrl = process.argv[2];
if (!socketUrl) throw new Error("DevTools websocket URL is required.");

const socket = new WebSocket(socketUrl);
let id = 0;
let poll;
const timeout = setTimeout(() => process.exit(2), 60000);

function evaluate(expression) {
  socket.send(JSON.stringify({ id: ++id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
}

socket.addEventListener("open", () => {
  evaluate(`document.querySelector(".hud-actions button")?.click(); "started"`);
  poll = setInterval(() => evaluate(`JSON.stringify({
    camera: window.__cameraDebugHistory || [],
    enemyAudit: window.__enemyVisualAudit || [],
    enemyMeshes: (window.__environmentMeshDump || []).filter((mesh) =>
      mesh.name.startsWith("enemy-") || mesh.name.startsWith("goblin-"))
      .map((mesh) => ({ name: mesh.name, source: mesh.sourceAsset,
        dimensions: mesh.dimensions, position: mesh.absolutePosition, scaling: mesh.scaling })),
    oversized: (window.__environmentMeshDump || []).filter((mesh) =>
      mesh.enabled && mesh.name !== "snowGround" && mesh.name !== "grid" && mesh.maxDimension > 4)
  })`), 1000);
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const value = message.result?.result?.value;
  if (!value || value === "started") return;
  const report = JSON.parse(value);
  if (report.camera.length < 3) return;
  clearInterval(poll);
  clearTimeout(timeout);
  console.log(JSON.stringify(report));
  socket.close();
});
