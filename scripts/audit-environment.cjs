const socketUrl = process.argv[2];
if (!socketUrl) throw new Error("DevTools websocket URL is required.");

const socket = new WebSocket(socketUrl);
let requestId = 0;
let poll;

function requestReport() {
  socket.send(JSON.stringify({
    id: ++requestId,
    method: "Runtime.evaluate",
    params: {
      expression: `window.__environmentMeshDump ? JSON.stringify({
        url: location.href,
        bad: window.__environmentMeshDump.filter((mesh) =>
          mesh.enabled && mesh.name !== "snowGround" && mesh.name !== "grid" &&
          (mesh.oversized || mesh.maxDimension > 8)),
        largest: window.__environmentMeshDump.filter((mesh) =>
          mesh.enabled && mesh.name !== "snowGround" && mesh.name !== "grid").slice(0, 5)
            .map((mesh) => ({ name: mesh.name, source: mesh.sourceAsset,
              dimensions: mesh.dimensions, inFrustum: mesh.inCameraFrustum }))
      }) : ""`,
      returnByValue: true,
    },
  }));
}

socket.addEventListener("open", () => {
  requestReport();
  poll = setInterval(requestReport, 1000);
});
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const value = message.result?.result?.value;
  if (!value) return;
  clearInterval(poll);
  console.log(value);
  socket.close();
});
setTimeout(() => process.exit(2), 50000);
