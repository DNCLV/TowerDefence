import "./style.css";
import { BabylonGameRenderer } from "./game/rendering3d/BabylonGameRenderer";
import { GameState } from "./game/GameState";
import { createEnemy } from "./game/enemies/Enemy";
import { getTotalTowerInvestment, getTowerDps, getTowerLevelStats, getTowerSellRefund } from "./game/towers/Tower";
import { DEFENDER_CONFIG, DefenderType } from "./game/config/DefenderConfig";
import { WORLD_UNITS_PER_CELL } from "./core/GameConstants";
import { resolveAssetUrl } from "./core/AssetUrl";
import { MAP_CHOICES, MapDefinition } from "./game/config/MapConfig";
import { getMapPreviewGeometry } from "./game/config/MapPreview";
import { MinimapRenderer } from "./game/minimap/MinimapRenderer";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app root element");

function renderMapPreview(map: MapDefinition): string {
  const geometry = getMapPreviewGeometry(map);
  const terrain = geometry.terrain.map(({ x, y, width, height }) =>
    `<rect class="map-preview-terrain" data-terrain-rect="${x},${y},${width},${height}" x="${x}" y="${y}" width="${width}" height="${height}"/>`).join("");
  const spawnColors = ["#ff6b66", "#69c5ff", "#69df9c"];
  const spawns = geometry.spawns.map(({ id, cell }, index) =>
    `<circle class="map-preview-spawn" data-spawn-id="${id}" data-cell-x="${cell.x}" data-cell-y="${cell.y}" style="--spawn-color:${spawnColors[index % spawnColors.length]}" cx="${cell.x + 0.5}" cy="${cell.y + 0.5}" r="0.36"/>`).join("");
  return `<svg viewBox="0 0 ${geometry.width} ${geometry.height}" preserveAspectRatio="xMidYMid meet" focusable="false" data-grid-width="${geometry.width}" data-grid-height="${geometry.height}" data-terrain-cells="${map.terrain.length}">
    <rect class="map-preview-field" x="0" y="0" width="${geometry.width}" height="${geometry.height}"/>
    <g class="map-preview-terrain-regions">${terrain}</g>
    <g class="map-preview-spawns">${spawns}</g>
    <circle class="map-preview-goal" data-cell-x="${geometry.goal.x}" data-cell-y="${geometry.goal.y}" cx="${geometry.goal.x + 0.5}" cy="${geometry.goal.y + 0.5}" r="0.42"/>
  </svg>`;
}

let selectedMap: MapDefinition = MAP_CHOICES[0];
let pendingRendererDisposal: Promise<void> = Promise.resolve();
const mapSelect = document.createElement("main");
mapSelect.className = "map-select-screen";
mapSelect.innerHTML = `
  <section class="map-select-panel" aria-labelledby="map-select-title">
    <header class="map-select-heading">
      <p class="map-select-eyebrow">WINTERMAUL · FIELD COMMAND</p>
      <h1 id="map-select-title">CHOOSE MAP</h1>
      <p class="map-select-tagline">DEFEND <i></i> ADAPT <i></i> SURVIVE</p>
      <p class="map-select-intro">Choose the battlefield. Every road leads to the keep.</p>
    </header>
    <div class="map-choice-grid" role="group" aria-label="Choose a map">
      ${MAP_CHOICES.map((map) => `<button class="map-choice-card" type="button" data-map-id="${map.id}" aria-pressed="false">
        <span class="map-preview" aria-hidden="true">${renderMapPreview(map)}</span>
        <span class="map-choice-copy"><strong>${map.name}</strong><small>${map.subtitle}</small><span>${map.description}</span></span>
        <span class="map-choice-meta"><span class="map-economy">✦ ${map.startingGold} GOLD</span><span class="map-pressure">${map.enemyCountMultiplier === 1 ? "NORMAL" : map.enemyCountMultiplier < 2 ? "HIGH" : "EXTREME"} PRESSURE</span></span>
      </button>`).join("")}
    </div>
    <footer class="map-select-footer"><span id="map-select-hint">1 Spawn · 70 Gold</span><button id="start-selected-map" type="button">START <span aria-hidden="true">→</span></button></footer>
  </section>`;
app.append(mapSelect);

const mapStartButton = mapSelect.querySelector<HTMLButtonElement>("#start-selected-map")!;
function selectMap(map: MapDefinition, card: HTMLButtonElement): void {
  selectedMap = map;
  mapSelect.querySelectorAll<HTMLButtonElement>(".map-choice-card").forEach((candidate) => {
    const isSelected = candidate === card;
    candidate.classList.toggle("is-selected", isSelected);
    candidate.setAttribute("aria-pressed", String(isSelected));
  });
  mapSelect.querySelector<HTMLElement>("#map-select-hint")!.textContent = `${map.name} · ${map.startingGold} Gold`;
}
mapSelect.querySelectorAll<HTMLButtonElement>("[data-map-id]").forEach((card) => {
  card.addEventListener("click", () => {
    const map = MAP_CHOICES.find((choice) => choice.id === card.dataset.mapId);
    if (!map) return;
    selectMap(map, card);
  });
});
selectMap(selectedMap, mapSelect.querySelector<HTMLButtonElement>(`[data-map-id="${selectedMap.id}"]`)!);
mapStartButton.addEventListener("click", () => {
  if (mapStartButton.disabled || mapSelect.classList.contains("is-starting")) return;
  const mapToStart = selectedMap;
  mapStartButton.disabled = true;
  void pendingRendererDisposal.then(() => {
    if (!mapSelect.isConnected) return;
    mapSelect.classList.add("is-starting");
    window.setTimeout(() => {
      if (!mapSelect.isConnected) return;
      mapSelect.remove();
      startGame(mapToStart);
    }, 260);
  }).catch((error: unknown) => {
    mapStartButton.disabled = false;
    console.error("Could not dispose the previous map renderer.", error);
  });
});

function startGame(map: MapDefinition): void {
const canvas = document.createElement("canvas");
canvas.id = "game3d";
app?.append(canvas);

const ui = document.createElement("div");
ui.className = "game-ui";
ui.innerHTML = `
  <header class="top-hud-bar">
    <div class="hud-status-group">
  <section class="status-panel" aria-label="Game status">
    <div class="status-heading"><span class="game-title">Tower Defence</span><span class="field-status-label">FIELD STATUS</span></div>
    <div class="stat-row"><span class="stat-icon icon-wave" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 21V4m1 1c5-4 8 4 13 0v10c-5 4-8-4-13 0"/></svg></span><span class="stat-label">Wave</span><strong id="stat-wave" class="stat-value">1</strong></div>
    <div class="stat-row"><span class="stat-icon icon-enemies" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14Z"/><path d="M9 11h.1M15 11h.1M9 16v2m3-2v2m3-2v2"/></svg></span><span class="stat-label">Enemies</span><strong id="stat-enemies" class="stat-value">0</strong></div>
    <div class="stat-row"><span class="stat-icon icon-gold" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M14.5 8.5c-.6-.7-1.4-1-2.5-1-1.3 0-2.2.7-2.2 1.7 0 2.8 4.7 1.2 4.7 4 0 1.1-1 2-2.6 2-1.1 0-2.1-.4-2.8-1.2M12 5.5v13"/></svg></span><span class="stat-label">Gold</span><strong id="stat-gold" class="stat-value stat-gold-value">0</strong></div>
    <div class="stat-row"><span class="stat-icon icon-lives" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20.5 8.8c0 4.6-8.5 10-8.5 10s-8.5-5.4-8.5-10A4.3 4.3 0 0 1 12 6.4a4.3 4.3 0 0 1 8.5 2.4Z"/></svg></span><span class="stat-label">Lives</span><strong id="stat-lives" class="stat-value stat-lives-value">0</strong></div>
  </section>
    </div>
  <nav class="menu-panel" aria-label="Game menu">
    <button id="pause-button" class="menu-button" type="button"><span aria-hidden="true">Ⅱ</span>Pause</button>
    <button id="save-button" class="menu-button" type="button"><span aria-hidden="true">▣</span>Save</button>
    <button id="load-button" class="menu-button" type="button"><span aria-hidden="true">↻</span>Load</button>
    <button id="reset-menu-button" class="menu-button reset-menu-button" type="button"><span aria-hidden="true">⟲</span>Reset</button>
    <button id="speed-button" class="menu-button speed-button" type="button" aria-pressed="false">1×</button>
  </nav>
  </header>

  <div id="reset-confirmation" class="reset-confirmation" role="dialog" aria-modal="true" aria-labelledby="reset-confirmation-title" hidden>
    <section class="reset-confirmation-card ui-panel">
      <h2 id="reset-confirmation-title">RESET RUN?</h2>
      <p>What would you like to do?</p>
      <div class="reset-confirmation-actions">
        <button id="confirm-reset-button" class="action-button confirm-reset-button" type="button">RESTART CURRENT MAP</button>
        <button id="return-map-select-button" class="action-button return-map-select-button" type="button">RETURN TO MAP SELECT</button>
        <button id="cancel-reset-button" class="action-button" type="button">CANCEL</button>
      </div>
    </section>
  </div>

  <aside id="hp-scaling-warning" class="hp-scaling-warning" role="status" aria-live="polite" hidden>
    <span class="hp-warning-sigil" aria-hidden="true">⚔</span>
    <div class="hp-warning-copy">
      <strong>THE HORDE GROWS STRONGER</strong>
      <p>Dark forces gather beyond the gates.<br>Stronger enemies are approaching.</p>
      <small>Prepare your defenses.</small>
    </div>
  </aside>

  <section id="minimap-panel" class="minimap-panel" aria-label="Tactical map overview">
    <div class="minimap-heading"><span>FIELD MAP</span><span aria-hidden="true">N ↑</span></div>
    <canvas id="game-minimap" class="game-minimap" role="img" aria-label="Map overview"></canvas>
  </section>

  <footer class="bottom-hud-bar">
    <section class="build-unit-section" aria-label="Build units">
      <div class="bottom-section-heading"><span>BUILD UNITS</span></div>
  <nav class="defender-choice-panel" aria-label="Choose defender to build">
    <button id="build-wizard-button" class="defender-choice is-selected" type="button" aria-label="Select Blue Wizard" aria-pressed="true">
      <span class="unit-portrait-frame"><img src="${resolveAssetUrl("assets/ui/defenders/wizard.png")}" alt="" draggable="false"></span>
      <span class="unit-card-copy"><strong id="wizard-build-name">Wizard</strong><small id="wizard-build-cost" class="unit-card-cost"></small></span>
      <span class="unit-card-selection">SELECTED</span>
    </button>
    <button id="build-knight-button" class="defender-choice" type="button" aria-label="Select Holy Knight" aria-pressed="false">
      <span class="unit-portrait-frame"><img src="${resolveAssetUrl("assets/ui/defenders/knight.png")}" alt="" draggable="false"></span>
      <span class="unit-card-copy"><strong id="knight-build-name">Knight</strong><small id="knight-build-cost" class="unit-card-cost"></small></span>
      <span class="unit-card-selection">SELECTED</span>
    </button>
    <button id="build-archer-button" class="defender-choice" type="button" aria-label="Select Green Archer" aria-pressed="false">
      <span class="unit-portrait-frame"><img src="${resolveAssetUrl("assets/ui/defenders/green-archer.png")}" alt="" draggable="false"></span>
      <span class="unit-card-copy"><strong>Archer</strong><small class="unit-card-cost"></small></span>
      <span class="unit-card-selection">SELECTED</span>
    </button>
    <button id="build-battlemage-button" class="defender-choice" type="button" aria-label="Select Battlemage" aria-pressed="false">
      <span class="unit-portrait-frame"><img src="${resolveAssetUrl("assets/ui/defenders/battlemage.png")}" alt="" draggable="false"></span>
      <span class="unit-card-copy"><strong>Battlemage</strong><small class="unit-card-cost"></small></span>
      <span class="unit-card-selection">SELECTED</span>
    </button>
    <button id="build-sovereign-button" class="defender-choice" type="button" aria-label="Select Sovereign" aria-pressed="false">
      <span class="unit-portrait-frame"><img src="${resolveAssetUrl("assets/ui/defenders/sovereign.png")}" alt="" draggable="false"></span>
      <span class="unit-card-copy"><strong>Sovereign</strong><small class="unit-card-cost"></small></span>
      <span class="unit-card-selection">SELECTED</span>
    </button>
  </nav>
    </section>
    <section class="tower-info-section" aria-label="Selected tower and actions">
      <div id="tower-empty-state" class="tower-empty-state">
        <span class="empty-state-icon" aria-hidden="true">✥</span>
        <strong>Select a unit or tower</strong>
        <small>Details will appear here</small>
      </div>
      <section id="build-unit-info" class="build-unit-info" aria-label="Selected unit for building" hidden>
        <div class="build-unit-info-heading">
          <span class="build-unit-info-portrait"><img id="build-unit-info-image" alt="" draggable="false"></span>
          <span class="build-unit-info-name-wrap"><strong id="build-unit-info-name"></strong><small id="build-unit-info-role"></small></span>
        </div>
        <div class="build-unit-info-stats">
          <span>Damage <strong id="build-unit-info-damage"></strong></span>
          <span>Range <strong id="build-unit-info-range"></strong></span>
          <span>Attack Rate <strong id="build-unit-info-rate"></strong></span>
          <span>Build Cost <strong id="build-unit-info-cost"></strong></span>
        </div>
        <div id="build-sovereign-profiles" class="sovereign-profile-list" hidden></div>
        <small class="build-unit-info-hint">Click a tile to place</small>
      </section>
  <section id="tower-panel" class="tower-panel" aria-label="Selected defender" hidden>
    <button id="close-tower-panel" class="panel-close" type="button" aria-label="Deselect tower">×</button>
    <div class="tower-identity">
      <div class="tower-portrait" aria-hidden="true">✦</div>
      <div><div class="tower-name">Blue Wizard</div><div id="tower-level" class="tower-level">Level 1</div></div>
    </div>
    <div class="tower-stats">
      <span>Damage <strong id="tower-damage">—</strong></span>
      <span>Range <strong id="tower-range">—</strong></span>
      <span>Fire rate <strong id="tower-fire-rate">—</strong></span>
    </div>
    <div id="tower-sovereign-profiles" class="sovereign-profile-list tower-sovereign-profiles" hidden></div>
    <div class="tower-combat-stats" aria-label="Tower combat statistics">
      <span>Kills <strong id="tower-kills">0</strong></span>
      <span>Damage Done <strong id="tower-damage-done">0</strong></span>
    </div>
    <div class="tower-actions">
      <div id="upgrade-action-wrap" class="upgrade-action-wrap">
        <div id="upgrade-tooltip" class="upgrade-tooltip" role="tooltip" hidden></div>
        <button id="upgrade-button" class="action-button upgrade-button" type="button">UPGRADE</button>
        <button id="upgrade-info-button" class="upgrade-info-button" type="button" aria-label="Show upgrade details" aria-expanded="false">i</button>
      </div>
      <button id="sell-button" class="action-button sell-button" type="button">SELL</button>
    </div>
    <div id="tower-message" class="tower-message" aria-live="polite"></div>
  </section>

  <div class="wave-controls bottom-actions" aria-label="Wave controls">
    <button id="start-wave-button" class="action-button start-wave-button" type="button">START WAVE</button>
    <button id="auto-button" class="action-button auto-button" type="button">AUTO: OFF</button>
    <button id="try-again-button" class="action-button try-again-button" type="button" hidden>TRY AGAIN</button>
      </div>
    </section>
  </footer>
`;
app?.append(ui);

// UI pointer input is intentionally contained here and never reaches the canvas controls.
for (const eventName of ["pointerdown", "pointerup", "pointermove", "pointercancel", "lostpointercapture", "click", "dblclick", "wheel", "touchstart", "touchmove", "touchend", "touchcancel", "contextmenu"]) {
  ui.addEventListener(eventName, (event) => event.stopPropagation(), { passive: eventName === "wheel" || eventName.startsWith("touch") });
}

const gameState = new GameState(map);
const renderer = new BabylonGameRenderer(canvas, map);
const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
console.info("APPLICATION BOOT", { navigationType: navigation?.type ?? "unknown" });
const debugParams = new URLSearchParams(window.location.search);
if (debugParams.get("waveDebug") === "1" || debugParams.get("perfDebug") === "1") {
  (window as Window & { __towerDefenceGameState?: GameState }).__towerDefenceGameState = gameState;
}

const query = <T extends HTMLElement>(selector: string): T => {
  const element = ui.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
};
const minimapPanel = query<HTMLElement>("#minimap-panel");
const minimapCanvas = query<HTMLCanvasElement>("#game-minimap");
const minimap = new MinimapRenderer(minimapPanel, minimapCanvas, map);
const bottomHudBar = query<HTMLElement>(".bottom-hud-bar");
const syncMinimapDock = (): void => {
  ui.style.setProperty("--game-bottom-hud-height", `${bottomHudBar.getBoundingClientRect().height}px`);
};
const minimapDockObserver = new ResizeObserver(syncMinimapDock);
minimapDockObserver.observe(bottomHudBar);
requestAnimationFrame(syncMinimapDock);
const buildUnitSection = query<HTMLElement>(".build-unit-section");
const defenderChoicePanel = query<HTMLElement>(".defender-choice-panel");
const updateBuildTrayOverflow = (): void => {
  buildUnitSection.classList.toggle("has-overflow", defenderChoicePanel.scrollWidth > defenderChoicePanel.clientWidth + 1);
};
defenderChoicePanel.addEventListener("scroll", updateBuildTrayOverflow, { passive: true });
defenderChoicePanel.addEventListener("wheel", (event) => {
  if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && defenderChoicePanel.scrollWidth > defenderChoicePanel.clientWidth) {
    defenderChoicePanel.scrollLeft += event.deltaY;
    event.preventDefault();
  }
}, { passive: false });
const handleBuildTrayResize = (): void => {
  updateBuildTrayOverflow();
  // ResizeObserver normally keeps the minimap dock in sync; this rAF fallback
  // also handles viewport/orientation changes before the observer callback.
  requestAnimationFrame(syncMinimapDock);
};
const buildTrayResizeObserver = new ResizeObserver(updateBuildTrayOverflow);
const buildTrayMutationObserver = new MutationObserver(updateBuildTrayOverflow);
window.addEventListener("resize", handleBuildTrayResize, { passive: true });
buildTrayResizeObserver.observe(defenderChoicePanel);
buildTrayMutationObserver.observe(defenderChoicePanel, { childList: true });
const disposeBuildTrayObservers = (): void => {
  window.removeEventListener("resize", handleBuildTrayResize);
  buildTrayResizeObserver.disconnect();
  buildTrayMutationObserver.disconnect();
  minimapDockObserver.disconnect();
};
requestAnimationFrame(updateBuildTrayOverflow);
const waveValue = query<HTMLElement>("#stat-wave");
const enemiesValue = query<HTMLElement>("#stat-enemies");
const goldValue = query<HTMLElement>("#stat-gold");
const livesValue = query<HTMLElement>("#stat-lives");
const startButton = query<HTMLButtonElement>("#start-wave-button");
const autoButton = query<HTMLButtonElement>("#auto-button");
const pauseButton = query<HTMLButtonElement>("#pause-button");
const speedButton = query<HTMLButtonElement>("#speed-button");
const resetMenuButton = query<HTMLButtonElement>("#reset-menu-button");
const resetConfirmation = query<HTMLElement>("#reset-confirmation");
const cancelResetButton = query<HTMLButtonElement>("#cancel-reset-button");
const confirmResetButton = query<HTMLButtonElement>("#confirm-reset-button");
const returnMapSelectButton = query<HTMLButtonElement>("#return-map-select-button");
const tryAgainButton = query<HTMLButtonElement>("#try-again-button");
const hpScalingWarning = query<HTMLElement>("#hp-scaling-warning");
const towerPanel = query<HTMLElement>("#tower-panel");
const towerEmptyState = query<HTMLElement>("#tower-empty-state");
const buildUnitInfo = query<HTMLElement>("#build-unit-info");
const buildUnitInfoImage = query<HTMLImageElement>("#build-unit-info-image");
const buildUnitInfoName = query<HTMLElement>("#build-unit-info-name");
const buildUnitInfoRole = query<HTMLElement>("#build-unit-info-role");
const buildUnitInfoDamage = query<HTMLElement>("#build-unit-info-damage");
const buildUnitInfoRange = query<HTMLElement>("#build-unit-info-range");
const buildUnitInfoRate = query<HTMLElement>("#build-unit-info-rate");
const buildUnitInfoCost = query<HTMLElement>("#build-unit-info-cost");
const buildSovereignProfiles = query<HTMLElement>("#build-sovereign-profiles");
const towerPortrait = query<HTMLElement>(".tower-portrait");
const towerLevel = query<HTMLElement>("#tower-level");
const towerDamage = query<HTMLElement>("#tower-damage");
const towerRange = query<HTMLElement>("#tower-range");
const towerFireRate = query<HTMLElement>("#tower-fire-rate");
const towerStandardStats = query<HTMLElement>(".tower-stats");
const towerSovereignProfiles = query<HTMLElement>("#tower-sovereign-profiles");
const towerKills = query<HTMLElement>("#tower-kills");
const towerDamageDone = query<HTMLElement>("#tower-damage-done");
const upgradeButton = query<HTMLButtonElement>("#upgrade-button");
const upgradeInfoButton = query<HTMLButtonElement>("#upgrade-info-button");
const upgradeActionWrap = query<HTMLElement>("#upgrade-action-wrap");
const upgradeTooltip = query<HTMLElement>("#upgrade-tooltip");
const towerMessage = query<HTMLElement>("#tower-message");
const sellButton = query<HTMLButtonElement>("#sell-button");
let pendingSellTowerId: number | undefined;
let sellConfirmationTimer: number | undefined;
let activeWarningWave: number | undefined;
let warningHideTimer: number | undefined;
let selectedTowerId: number | undefined;
let selectedBuildType: DefenderType | undefined = "blue-wizard";
let selectionMessage = "";
let resetMenuWasPaused = false;

const cancelSellConfirmation = (): void => {
  if (sellConfirmationTimer !== undefined) window.clearTimeout(sellConfirmationTimer);
  sellConfirmationTimer = undefined;
  pendingSellTowerId = undefined;
};

for (const [selector, type] of [
  ["#wizard-build-cost", "blue-wizard"], ["#knight-build-cost", "holy-knight"],
  ["#build-archer-button .unit-card-cost", "green-archer"], ["#build-battlemage-button .unit-card-cost", "battlemage"],
  ["#build-sovereign-button .unit-card-cost", "sovereign"],
] as const) query<HTMLElement>(selector).textContent = String(DEFENDER_CONFIG[type].buildCost);
query<HTMLElement>("#tower-fire-rate").parentElement!.firstChild!.textContent = "Attack Speed ";

const setSelection = (towerId?: number): void => {
  if (towerId !== selectedTowerId) cancelSellConfirmation();
  selectedTowerId = towerId;
  selectionMessage = "";
  if (towerId === undefined) hideUpgradeTooltip();
  renderSelectedTower(gameState);
};

const wizardBuildButton = query<HTMLButtonElement>("#build-wizard-button");
const knightBuildButton = query<HTMLButtonElement>("#build-knight-button");
const archerBuildButton = query<HTMLButtonElement>("#build-archer-button");
const battlemageBuildButton = query<HTMLButtonElement>("#build-battlemage-button");
const sovereignBuildButton = query<HTMLButtonElement>("#build-sovereign-button");
const buildButtons: Record<DefenderType, HTMLButtonElement> = {
  "blue-wizard": wizardBuildButton,
  "holy-knight": knightBuildButton,
  "green-archer": archerBuildButton,
  battlemage: battlemageBuildButton,
  sovereign: sovereignBuildButton,
};
const chooseBuildType = (type: DefenderType): void => {
  selectedBuildType = type;
  renderer.setBuildDefenderType(type);
  for (const [buttonType, button] of Object.entries(buildButtons) as [DefenderType, HTMLButtonElement][]) {
    button.classList.toggle("is-selected", buttonType === type);
    button.setAttribute("aria-pressed", String(buttonType === type));
  }
  buildButtons[type].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  if (selectedTowerId === undefined) renderBuildUnitInfo();
};
wizardBuildButton.addEventListener("click", () => chooseBuildType("blue-wizard"));
knightBuildButton.addEventListener("click", () => chooseBuildType("holy-knight"));
archerBuildButton.addEventListener("click", () => chooseBuildType("green-archer"));
battlemageBuildButton.addEventListener("click", () => chooseBuildType("battlemage"));
sovereignBuildButton.addEventListener("click", () => chooseBuildType("sovereign"));

query<HTMLButtonElement>("#save-button").addEventListener("click", () => console.info("Save not implemented yet"));
query<HTMLButtonElement>("#load-button").addEventListener("click", () => console.info("Load not implemented yet"));
pauseButton.addEventListener("click", () => {
  const paused = renderer.togglePause();
  renderPauseButton(paused);
});
speedButton.addEventListener("click", () => {
  const speed = renderer.toggleGameSpeed();
  speedButton.textContent = `${speed}×`;
  speedButton.classList.toggle("is-fast", speed === 2);
  speedButton.setAttribute("aria-pressed", String(speed === 2));
});
resetMenuButton.addEventListener("click", openResetConfirmation);
cancelResetButton.addEventListener("click", cancelResetMenu);
resetConfirmation.addEventListener("click", (event) => {
  if (event.target === resetConfirmation) cancelResetMenu();
});
resetConfirmation.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    cancelResetMenu();
    return;
  }
  if (event.key !== "Tab") return;
  const buttons = [confirmResetButton, returnMapSelectButton, cancelResetButton];
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
confirmResetButton.addEventListener("click", () => {
  closeResetConfirmation(false, false);
  resetRun();
});
returnMapSelectButton.addEventListener("click", returnToMapSelect);
query<HTMLButtonElement>("#close-tower-panel").addEventListener("click", () => renderer.selectTower());
sellButton.addEventListener("click", () => {
  const tower = gameState.towers.find((candidate) => candidate.id === selectedTowerId);
  if (!tower) return;
  if (pendingSellTowerId !== tower.id) {
    cancelSellConfirmation();
    pendingSellTowerId = tower.id;
    selectionMessage = "Tap again within 3 seconds to confirm.";
    sellConfirmationTimer = window.setTimeout(() => {
      cancelSellConfirmation();
      if (selectedTowerId === tower.id) {
        selectionMessage = "Sell cancelled.";
        renderSelectedTower(gameState);
      }
    }, 3200);
    renderSelectedTower(gameState);
    return;
  }

  cancelSellConfirmation();
  const result = gameState.sellTower(tower.id);
  if (typeof result === "object") {
    selectionMessage = "";
    renderer.selectTower();
  } else {
    selectionMessage = result === "game-over" ? "Cannot sell after Game Over." : "Tower is no longer available.";
    renderSelectedTower(gameState);
  }
});
upgradeButton.addEventListener("click", () => {
  if (selectedTowerId === undefined) return;
  cancelSellConfirmation();
  hideUpgradeTooltip();
  const result = gameState.upgradeBasicTower(selectedTowerId);
  selectionMessage = result === "upgraded" ? "" : result === "not-enough-gold" ? "Not enough gold" : result === "max-level" ? "Max level reached" : "Upgrade unavailable";
  renderSelectedTower(gameState);
});
upgradeInfoButton.addEventListener("click", () => {
  const isOpen = upgradeActionWrap.classList.toggle("is-open");
  upgradeInfoButton.setAttribute("aria-expanded", String(isOpen));
  upgradeTooltip.hidden = !isOpen;
});
upgradeActionWrap.addEventListener("mouseenter", showUpgradeTooltip);
upgradeActionWrap.addEventListener("mouseleave", () => {
  if (!upgradeActionWrap.classList.contains("is-open")) hideUpgradeTooltip();
});
upgradeButton.addEventListener("focus", showUpgradeTooltip);
upgradeButton.addEventListener("blur", () => {
  if (!upgradeActionWrap.classList.contains("is-open")) hideUpgradeTooltip();
});
startButton.addEventListener("click", () => {
  renderer.logCameraState("BEFORE START WAVE");
  if (gameState.startWave()) {
    renderer.logCameraState("AFTER startWave()");
    console.log("Wave started", { wave: gameState.currentWave, enemies: gameState.enemiesRemaining });
  }
});
autoButton.addEventListener("click", () => gameState.toggleAutoRun());
tryAgainButton.addEventListener("click", () => {
  resetRun();
});

renderer.start(gameState, (state) => {
  minimap.update(state, renderer.getApproximateMinimapView());
  goldValue.textContent = String(state.gold);
  livesValue.textContent = String(state.lives);
  waveValue.textContent = String(state.currentWave);
  enemiesValue.textContent = String(state.enemiesRemaining);
  startButton.disabled = state.waveActive || state.gameOver || Boolean(state.hpTierWarning);
  autoButton.textContent = `AUTO: ${state.autoRun ? "ON" : "OFF"}`;
  autoButton.classList.toggle("is-on", state.autoRun);
  autoButton.disabled = state.gameOver;
  startButton.hidden = state.gameOver;
  autoButton.hidden = state.gameOver;
  tryAgainButton.hidden = !state.gameOver;
  renderHpScalingWarning(state.hpTierWarning);
  renderSelectedTower(state);
}, setSelection);

if (debugParams.get("enemyVisualDebug") === "1") {
  (window as Window & { __towerDefenceEnemyVisualTest?: { spawnPair: () => object[]; spawnGroundLineup: () => object[] } }).__towerDefenceEnemyVisualTest = {
    /** Places frozen, side-by-side presentation-only instances without starting/changing a wave. */
    spawnPair: () => {
      const route = gameState.path.length > 1 ? gameState.path : gameState.spawnPaths.values().next().value;
      if (!route || route.length < 2) return [];
      const ghoul = createEnemy(-9101, "ghoul", route, 25);
      const wraith = createEnemy(-9102, "wraith", route, 25);
      ghoul.x = gameState.grid.width * 0.38;
      ghoul.y = gameState.grid.height * 0.55;
      ghoul.speed = 0;
      wraith.x = gameState.grid.width * 0.62;
      wraith.y = gameState.grid.height * 0.55;
      wraith.speed = 0;
      gameState.waveActive = false;
      gameState.enemies = [ghoul, wraith];
      return [ghoul, wraith].map(({ id, type, movementType, maxHp, speed }) => ({ id, type, movementType, maxHp, speed }));
    },
    /** Creates six frozen ground archetypes at one terrain elevation for camera-distance alignment review. */
    spawnGroundLineup: () => {
      const route = gameState.path.length > 1 ? gameState.path : gameState.spawnPaths.values().next().value;
      if (!route || route.length < 2) return [];
      const types = ["goblin", "goblinBrute", "ghoul", "wraith", "giantGoblin", "skeletonKing"] as const;
      gameState.waveActive = false;
      gameState.enemies = types.map((type, index) => {
        const enemy = createEnemy(-9200 - index, type, route, 35);
        enemy.x = gameState.grid.width * (0.12 + index * 0.15);
        enemy.y = gameState.grid.height * 0.55;
        enemy.speed = 0;
        return enemy;
      });
      return gameState.enemies.map(({ id, type, movementType, x, y }) => ({ id, type, movementType, x, y }));
    },
  };
}

if (debugParams.get("waveDebug") === "1") {
  (window as Window & { __towerDefenceUi?: {
    chooseBuildUnit: (type: DefenderType) => void;
    selectTower: (towerId?: number) => void;
    createDenseTowerTestLayout: () => number[];
    selectionVisual: () => ReturnType<BabylonGameRenderer["getSelectionVisualDebug"]>;
    projectCell: (cell: { x: number; y: number }) => ReturnType<BabylonGameRenderer["getCellClientPosition"]>;
  } }).__towerDefenceUi = {
    chooseBuildUnit: chooseBuildType,
    selectTower: (towerId?: number) => renderer.selectTower(towerId),
    createDenseTowerTestLayout: () => {
      gameState.gold = Math.max(gameState.gold, 1000);
      const ids: number[] = [];
      const centerX = Math.floor(gameState.grid.width / 2);
      const centerY = Math.floor(gameState.grid.height / 2);
      for (let radius = 0; radius <= 4 && ids.length < 20; radius += 1) {
        for (let y = Math.max(0, centerY - 5); y <= Math.min(gameState.grid.height - 1, centerY + 5) && ids.length < 20; y += 1) {
          for (let x = Math.max(0, centerX - 5); x <= Math.min(gameState.grid.width - 1, centerX + 5) && ids.length < 20; x += 1) {
            if (Math.max(Math.abs(x - centerX), Math.abs(y - centerY)) !== radius) continue;
            const result = gameState.placeBasicTower({ x, y }, ids.length % 2 ? "holy-knight" : "blue-wizard");
            if (result === "placed") ids.push(gameState.towers[gameState.towers.length - 1]!.id);
          }
        }
      }
      return ids;
    },
    selectionVisual: () => renderer.getSelectionVisualDebug(),
    projectCell: (cell: { x: number; y: number }) => renderer.getCellClientPosition(cell),
  };
}

if (debugParams.get("inputDebug") === "1") {
  (window as Window & { __towerDefenceInputDebug?: () => ReturnType<BabylonGameRenderer["getInputDebugState"]> })
    .__towerDefenceInputDebug = () => renderer.getInputDebugState();
}

if (debugParams.get("minimapDebug") === "1") {
  (window as Window & { __towerDefenceMinimapDebug?: {
    setTarget: (logicalGridX: number, logicalGridY: number) => boolean;
    snapshot: () => ReturnType<BabylonGameRenderer["getMinimapDebugState"]>;
  } }).__towerDefenceMinimapDebug = {
    setTarget: (logicalGridX, logicalGridY) => renderer.setMinimapDebugTarget(logicalGridX, logicalGridY),
    snapshot: () => renderer.getMinimapDebugState(),
  };
}

function renderSelectedTower(state: GameState): void {
  if (selectedTowerId === undefined) {
    towerPanel.hidden = true;
    renderBuildUnitInfo();
    return;
  }
  const tower = state.towers.find((candidate) => candidate.id === selectedTowerId);
  if (!tower) {
    setSelection();
    return;
  }
  towerPanel.hidden = false;
  buildUnitInfo.hidden = true;
  towerEmptyState.hidden = true;
  query<HTMLElement>(".tower-name").textContent = DEFENDER_CONFIG[tower.type].name;
  towerPortrait.textContent = "";
  towerPortrait.style.backgroundImage = `url("${defenderPortrait(tower.type)}")`;
  towerLevel.textContent = `Level ${tower.level}`;
  const isSovereign = tower.type === "sovereign";
  towerStandardStats.hidden = isSovereign;
  towerSovereignProfiles.hidden = !isSovereign;
  if (isSovereign) renderSovereignProfiles(towerSovereignProfiles, tower.level);
  towerDamage.textContent = String(tower.damage);
  towerRange.textContent = tower.rangeMode === "adjacent8"
    ? "1 Tile"
    : `${Number((tower.range / WORLD_UNITS_PER_CELL).toFixed(1))} Tiles`;
  towerFireRate.textContent = `${tower.fireRate.toFixed(2)}/s`;
  towerKills.textContent = String(tower.combatStats.kills);
  towerDamageDone.textContent = tower.combatStats.damageDone.toLocaleString("en-US");
  const sellRefund = getTowerSellRefund(tower);
  const awaitingSellConfirmation = pendingSellTowerId === tower.id;
  sellButton.textContent = awaitingSellConfirmation ? `CONFIRM · +${sellRefund}G` : `SELL · +${sellRefund}G`;
  sellButton.setAttribute("aria-label", awaitingSellConfirmation
    ? `Confirm selling for ${sellRefund} gold`
    : `Sell tower for ${sellRefund} gold`);
  sellButton.classList.toggle("is-confirming", awaitingSellConfirmation);
  const nextLevel = getTowerLevelStats(tower.level + 1, tower.type);
  const upgradeCost = nextLevel.level === tower.level + 1 ? nextLevel.upgradeCost : null;
  const maxLevel = upgradeCost === null;
  upgradeButton.textContent = maxLevel ? "MAX LEVEL" : `UPGRADE · ${upgradeCost}G`;
  upgradeButton.disabled = maxLevel || state.gold < (upgradeCost ?? 0);
  const tooltipLines: string[] = [];
  if (!maxLevel) {
    tooltipLines.push(`Upgrade to Level ${nextLevel.level}`);
    if (isSovereign) {
      const profiles = DEFENDER_CONFIG.sovereign.attackProfiles!;
      for (const [mode, label] of [["antiAir", "Anti-Air"], ["rapid", "Rapid"], ["heavy", "Heavy"]] as const) {
        const current = profiles[mode][tower.level - 1];
        const next = profiles[mode][nextLevel.level - 1];
        tooltipLines.push(`${label}: ${current.damage} -> ${next.damage} damage · ${current.fireRate.toFixed(2)} -> ${next.fireRate.toFixed(2)}/s`);
      }
    } else {
      tooltipLines.push(`Damage: ${tower.damage} -> ${nextLevel.damage}`);
      tooltipLines.push(`Attack Rate: ${tower.fireRate.toFixed(2)} -> ${nextLevel.fireRate.toFixed(2)} attacks/sec`);
      tooltipLines.push(`DPS: ${formatBalanceNumber(getTowerDps(tower))} -> ${formatBalanceNumber(getTowerDps(nextLevel))}`);
    }
    tooltipLines.push(`Upgrade Cost: ${upgradeCost} gold`);
    tooltipLines.push(`Total Invested After Upgrade: ${getTotalTowerInvestment(nextLevel.level, tower.type)} gold`);
  } else {
    tooltipLines.push("MAX LEVEL - no further upgrade");
  }
  upgradeTooltip.textContent = tooltipLines.join("\n");
  towerMessage.textContent = selectionMessage;
}

function renderBuildUnitInfo(): void {
  towerPanel.hidden = true;
  if (!selectedBuildType) {
    buildUnitInfo.hidden = true;
    towerEmptyState.hidden = false;
    return;
  }
  towerEmptyState.hidden = true;
  if (!buildUnitInfo.hidden && buildUnitInfo.dataset.unitType === selectedBuildType) return;

  const defender = DEFENDER_CONFIG[selectedBuildType];
  const stats = defender.levels[0];
  buildUnitInfo.dataset.unitType = selectedBuildType;
  buildUnitInfo.hidden = false;
  const isSovereign = selectedBuildType === "sovereign";
  query<HTMLElement>(".build-unit-info-stats").hidden = isSovereign;
  buildSovereignProfiles.hidden = !isSovereign;
  if (isSovereign) renderSovereignProfiles(buildSovereignProfiles, 1, true);
  buildUnitInfoImage.src = defenderPortrait(selectedBuildType);
  buildUnitInfoName.textContent = defender.name;
  buildUnitInfoRole.textContent = (selectedBuildType === "sovereign"
    ? defender.roleLabel ?? defender.specializationLabel
    : defender.specializationLabel ?? defender.roleLabel)
    ?? (defender.rangeMode === "adjacent8" ? "Melee Defender" : "Ranged Defender");
  buildUnitInfoDamage.textContent = String(stats.damage);
  buildUnitInfoRange.textContent = defender.rangeMode === "adjacent8"
    ? "Adjacent 8"
    : `${(stats.range / WORLD_UNITS_PER_CELL).toFixed(1)} Tiles`;
  buildUnitInfoRate.textContent = `${stats.fireRate.toFixed(2)}/s`;
  buildUnitInfoCost.textContent = `${defender.buildCost} Gold`;
}

function renderSovereignProfiles(target: HTMLElement, level: number, includeBuildCost = false): void {
  const profiles = DEFENDER_CONFIG.sovereign.attackProfiles!;
  target.replaceChildren();
  for (const [mode, label] of [["antiAir", "Anti-Air"], ["rapid", "Rapid"], ["heavy", "Heavy"]] as const) {
    const profile = profiles[mode][level - 1];
    const row = document.createElement("span");
    row.className = "profile-mode";
    row.innerHTML = `<strong>${label}</strong><small>${profile.damage} dmg · ${profile.fireRate.toFixed(2)}/s</small>`;
    target.append(row);
  }
  const range = document.createElement("span");
  range.className = "profile-summary";
  range.innerHTML = `<strong>Range</strong><small>${(DEFENDER_CONFIG.sovereign.levels[level - 1].range / WORLD_UNITS_PER_CELL).toFixed(1)} Tiles</small>`;
  target.append(range);
  if (includeBuildCost) {
    const cost = document.createElement("span");
    cost.className = "profile-summary";
    cost.innerHTML = `<strong>Build Cost</strong><small>${DEFENDER_CONFIG.sovereign.buildCost} Gold</small>`;
    target.append(cost);
  }
}

function hideUpgradeTooltip(): void {
  upgradeActionWrap.classList.remove("is-open");
  upgradeInfoButton.setAttribute("aria-expanded", "false");
  upgradeTooltip.hidden = true;
}

function showUpgradeTooltip(): void {
  if (selectedTowerId === undefined) return;
  upgradeTooltip.hidden = false;
}

function renderPauseButton(paused: boolean): void {
  pauseButton.innerHTML = `<span aria-hidden="true">${paused ? "▶" : "Ⅱ"}</span>${paused ? "Resume" : "Pause"}`;
  pauseButton.setAttribute("aria-pressed", String(paused));
}

function openResetConfirmation(): void {
  if (!resetConfirmation.hidden) return;
  resetMenuWasPaused = renderer.isPaused();
  renderer.setPaused(true);
  renderPauseButton(true);
  resetConfirmation.hidden = false;
  confirmResetButton.focus();
}

function closeResetConfirmation(restorePreviousPause = true, returnFocus = true): void {
  resetConfirmation.hidden = true;
  if (restorePreviousPause) {
    renderer.setPaused(resetMenuWasPaused);
    renderPauseButton(resetMenuWasPaused);
  }
  if (returnFocus && resetMenuButton.isConnected) resetMenuButton.focus();
}

function cancelResetMenu(): void {
  closeResetConfirmation(true, true);
}

function clearRunFeedback(): void {
  cancelSellConfirmation();
  activeWarningWave = undefined;
  if (warningHideTimer !== undefined) window.clearTimeout(warningHideTimer);
  warningHideTimer = undefined;
  hpScalingWarning.hidden = true;
  hpScalingWarning.classList.remove("is-visible", "is-hiding");
}

function resetRun(): void {
  clearRunFeedback();
  renderer.resetRunPresentation();
  setSelection();
  gameState.resetGame("try-again");
  minimap.refresh(gameState, renderer.getApproximateMinimapView());
  renderPauseButton(false);
  speedButton.textContent = "1×";
  speedButton.classList.remove("is-fast");
  speedButton.setAttribute("aria-pressed", "false");
}

function returnToMapSelect(): void {
  closeResetConfirmation(false, false);
  clearRunFeedback();
  gameState.resetGame("try-again");
  renderer.selectTower(undefined);
  setSelection();
  disposeBuildTrayObservers();
  minimap.dispose();
  minimapPanel.remove();
  pendingRendererDisposal = renderer.dispose();
  ui.remove();
  canvas.remove();

  const debugWindow = window as Window & {
    __towerDefenceGameState?: GameState;
    __towerDefenceUi?: object;
    __towerDefenceInputDebug?: unknown;
    __towerDefenceMinimapDebug?: unknown;
  };
  delete debugWindow.__towerDefenceGameState;
  delete debugWindow.__towerDefenceUi;
  delete debugWindow.__towerDefenceInputDebug;
  delete debugWindow.__towerDefenceMinimapDebug;

  const selectedCard = mapSelect.querySelector<HTMLButtonElement>(`[data-map-id="${gameState.map.id}"]`);
  if (!selectedCard) return;
  selectMap(gameState.map, selectedCard);
  mapStartButton.disabled = false;
  mapSelect.classList.remove("is-starting");
  app!.append(mapSelect);
  selectedCard.focus({ preventScroll: true });
}

function renderHpScalingWarning(warning: GameState["hpTierWarning"]): void {
  if (warning) {
    if (activeWarningWave === warning.completedWave) return;
    activeWarningWave = warning.completedWave;
    if (warningHideTimer !== undefined) window.clearTimeout(warningHideTimer);
    warningHideTimer = undefined;
    hpScalingWarning.hidden = false;
    hpScalingWarning.classList.remove("is-hiding", "is-visible");
    void hpScalingWarning.offsetWidth;
    hpScalingWarning.classList.add("is-visible");
    return;
  }
  if (activeWarningWave === undefined) return;
  activeWarningWave = undefined;
  hpScalingWarning.classList.remove("is-visible");
  hpScalingWarning.classList.add("is-hiding");
  warningHideTimer = window.setTimeout(() => {
    hpScalingWarning.hidden = true;
    hpScalingWarning.classList.remove("is-hiding");
    warningHideTimer = undefined;
  }, 420);
}

function formatBalanceNumber(value: number): string {
  return String(Number(value.toFixed(2)));
}

function defenderPortrait(type: DefenderType): string {
  switch (type) {
    case "blue-wizard": return resolveAssetUrl("assets/ui/defenders/wizard.png");
    case "holy-knight": return resolveAssetUrl("assets/ui/defenders/knight.png");
    case "green-archer": return resolveAssetUrl("assets/ui/defenders/green-archer.png");
    case "battlemage": return resolveAssetUrl("assets/ui/defenders/battlemage.png");
    case "sovereign": return resolveAssetUrl("assets/ui/defenders/sovereign.png");
  }
}
}
