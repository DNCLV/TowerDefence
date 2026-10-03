const socket = new WebSocket(process.argv[2]);
let id = 0;
const timeout = setTimeout(() => process.exit(2), 20000);
const evaluate = (expression) => socket.send(JSON.stringify({
  id: ++id,
  method: "Runtime.evaluate",
  params: { expression, returnByValue: true },
}));

socket.addEventListener("open", () => evaluate('document.querySelector(".hud-actions button")?.click()'));
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id === 1) {
    setTimeout(() => evaluate(`JSON.stringify({
      audit: window.__enemyVisualAudit || [],
      camera: window.__cameraDebugHistory || []
    })`), 5000);
  }
  if (message.id === 2) {
    clearTimeout(timeout);
    console.log(message.result.result.value);
    socket.close();
  }
});
