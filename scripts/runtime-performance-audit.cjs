const socketUrl = process.argv[2];
if (!socketUrl) throw new Error("DevTools websocket URL is required.");

const socket = new WebSocket(socketUrl);
const timeout = setTimeout(() => process.exit(2), 60000);

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        while (!window.__towerDefenceGameState) await new Promise(resolve => setTimeout(resolve, 100));
        const state = window.__towerDefenceGameState;
        const waves = [];
        state.autoRun = false;
        for (let expected = 1; expected <= 7; expected += 1) {
          const started = state.startWave();
          state.toSpawn = 0;
          state.spawnQueues.clear();
          state.enemies = [];
          state.update(0.016);
          waves.push({ expected, started, currentWave: state.currentWave, waveActive: state.waveActive,
            lives: state.lives, gold: state.gold, gameOver: state.gameOver });
        }
        return JSON.stringify({
          waves,
          latestPerformance: (window.__performanceSnapshots || []).slice(-3),
          resetOccurred: state.currentWave === 1,
        });
      })()`,
    },
  }));
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== 1) return;
  clearTimeout(timeout);
  console.log(message.result?.result?.value ?? JSON.stringify(message));
  socket.close();
});
