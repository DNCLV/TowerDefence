import "./style.css";
import type { BabylonGameRenderer } from "./game/rendering3d/BabylonGameRenderer";
import { GameState } from "./game/GameState";
import { createEnemy } from "./game/enemies/Enemy";
import type { EnemyType } from "./game/config/EnemyConfig";
import { getTotalTowerInvestment, getTowerDps, getTowerLevelStats, getTowerSellRefund } from "./game/towers/Tower";
import { DEFENDER_CONFIG, DefenderType } from "./game/config/DefenderConfig";
import { WORLD_UNITS_PER_CELL } from "./core/GameConstants";
import { resolveAssetUrl } from "./core/AssetUrl";
import { MAP_CHOICES, MapDefinition } from "./game/config/MapConfig";
import { FACTION_CHOICES, FactionDefinition } from "./game/config/FactionConfig";
import { getMapPreviewGeometry } from "./game/config/MapPreview";
import { MinimapRenderer } from "./game/minimap/MinimapRenderer";
import { SPECIALIZATIONS_BY_DEFENDER, TOWER_SPECIALIZATIONS } from "./game/config/SpecializationConfig";
import type { TowerSpecializationId } from "./game/config/SpecializationConfig";
import { FORMATION_BY_ID } from "./game/config/FormationConfig";
import { AFFIXES, AFFIX_MILESTONES } from "./game/config/EnemyAffixConfig";
import { getEnemyHpMultiplier } from "./game/enemies/Enemy";
import { getVeteranProgress } from "./game/FactionBonusSystem";
import { BuildCarousel } from "./BuildCarousel";
import { FACTION_BONUS_CONFIG } from "./game/config/FactionBonusConfig";
import type { Tower } from "./game/towers/Tower";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app root element");

function defenderPortrait(type: DefenderType): string | undefined {
  switch (type) {
    case "blue-wizard": return resolveAssetUrl("assets/ui/defenders/wizard.png");
    case "holy-knight": return resolveAssetUrl("assets/ui/defenders/knight.png");
    case "green-archer": return resolveAssetUrl("assets/ui/defenders/green-archer.png");
    case "battlemage": return resolveAssetUrl("assets/ui/defenders/battlemage.png");
    case "sovereign": return resolveAssetUrl("assets/ui/defenders/sovereign.png");
    case "holy-emperor": return resolveAssetUrl("assets/ui/defenders/holy-emperor.jpg");
  }
}

function defenderGlyph(type: DefenderType): string {
  return type === "treant" ? "♣" : type === "thorn-owl" ? "✦" : type === "druid" ? "❧" : type === "seer" ? "☾" : "✦";
}

function defenderPortraitMarkup(type: DefenderType, fallbackClassName: string): string {
  const portrait = defenderPortrait(type);
  if (!portrait && (type === "treant" || type === "thorn-owl" || type === "druid" || type === "seer")) {
    return `<span class="${fallbackClassName} grove-unit-glyph" aria-label="${DEFENDER_CONFIG[type].name} icon">${defenderGlyph(type)}</span>`;
  }
  return portrait
    ? `<img src="${portrait}" alt="" draggable="false">`
    : `<span class="${fallbackClassName}" aria-label="Portrait unavailable">✦</span>`;
}

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
let selectedFaction: FactionDefinition = FACTION_CHOICES[0];
let pendingRendererDisposal: Promise<void> = Promise.resolve();
let factionSelect: HTMLElement | undefined;
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
    <footer class="map-select-footer"><span id="map-select-hint">${selectedMap.name} · ${selectedMap.startingGold} Gold</span><button id="start-selected-map" type="button">CONTINUE <span aria-hidden="true">→</span></button></footer>
  </section>`;
app.append(mapSelect);
performance.mark("tower-defence-app-shell-ready");

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
function renderFactionUnits(faction: FactionDefinition): string {
  return faction.units.map((type) => {
    const defender = DEFENDER_CONFIG[type];
    return `<span class="faction-unit"><span class="faction-unit-portrait">${defenderPortraitMarkup(type, "faction-unit-portrait-fallback")}</span><strong>${defender.name.replace("Blue ", "")}</strong></span>`;
  }).join("");
}

function getFactionPresentation(faction: FactionDefinition): { bonusName: string; bonusSummary: string; description: string } {
  const [bonus, ...descriptionParts] = faction.description.split(" · ");
  const sentenceEnd = bonus?.indexOf(". ") ?? -1;
  const bonusSummary = sentenceEnd < 0 ? bonus : bonus.slice(0, sentenceEnd + 1);
  return {
    bonusName: sentenceEnd < 0 ? "FACTION BONUS" : bonus.slice(0, sentenceEnd),
    bonusSummary: bonusSummary || faction.description,
    description: [...(sentenceEnd < 0 ? [] : [bonus.slice(sentenceEnd + 2)]), ...descriptionParts].filter(Boolean).join(" "),
  };
}

function showFactionSelect(map: MapDefinition): void {
  factionSelect?.remove();
  factionSelect = document.createElement("main");
  factionSelect.className = "map-select-screen faction-select-screen";
  factionSelect.innerHTML = `
    <section class="map-select-panel faction-select-panel" aria-labelledby="faction-select-title">
      <header class="map-select-heading">
        <p class="map-select-eyebrow">${map.name.toUpperCase()} · COMMAND ALIGNMENT</p>
        <h1 id="faction-select-title">CHOOSE FACTION</h1>
        <p class="map-select-tagline">CHOOSE YOUR BANNER <i></i> SHAPE YOUR DEFENSE</p>
        <p class="map-select-intro">Every faction brings a different answer to the enemy threat.</p>
      </header>
      <div class="faction-choice-grid" role="radiogroup" aria-label="Choose a faction">
        ${FACTION_CHOICES.map((faction) => {
          const presentation = getFactionPresentation(faction);
          const selected = faction.id === selectedFaction.id;
          return `<article class="faction-choice-card${selected ? " is-selected" : ""}" data-faction-id="${faction.id}" role="radio" aria-checked="${selected}" tabindex="${selected ? 0 : -1}">
            <span class="faction-card-crest" aria-hidden="true">✦</span>
            <span class="faction-choice-copy"><strong>${faction.name}</strong><small>${faction.tagline}</small></span>
            <span class="faction-card-bonus"><strong>${presentation.bonusName}</strong><span>${presentation.bonusSummary}</span></span>
            <span class="faction-card-details"${selected ? "" : " hidden"}>
              <span class="faction-card-description">${presentation.description || faction.description}</span>
              <span class="faction-bonus-explanation"><strong>${presentation.bonusName}:</strong> ${presentation.bonusSummary}</span>
              <span class="faction-unit-heading">AVAILABLE UNITS</span>
              <span class="faction-unit-list">${renderFactionUnits(faction)}</span>
            </span>
          </article>`;
        }).join("")}
      </div>
      <footer class="map-select-footer faction-select-footer"><span>${map.name} · ${map.startingGold} Gold</span><button id="start-battlefield" class="faction-select-button" type="button" data-select-faction="${selectedFaction.id}">CONTINUE WITH ${selectedFaction.name.toUpperCase()} <span aria-hidden="true">→</span></button><button id="back-to-map-select" type="button" class="setup-back-button">← BACK TO MAPS</button></footer>
    </section>`;
  app!.append(factionSelect);
  const screen = factionSelect;
  const cards = Array.from(screen.querySelectorAll<HTMLElement>("[data-faction-id]"));
  const continueButton = screen.querySelector<HTMLButtonElement>("#start-battlefield")!;
  const selectFaction = (card: HTMLElement): void => {
    const faction = FACTION_CHOICES.find((choice) => choice.id === card.dataset.factionId);
    if (!faction) return;
    selectedFaction = faction;
    cards.forEach((candidate) => {
      const isSelected = candidate === card;
      candidate.classList.toggle("is-selected", isSelected);
      candidate.setAttribute("aria-checked", String(isSelected));
      candidate.tabIndex = isSelected ? 0 : -1;
      const details = candidate.querySelector<HTMLElement>(".faction-card-details");
      if (details) details.hidden = !isSelected;
    });
    continueButton.dataset.selectFaction = faction.id;
    continueButton.innerHTML = `CONTINUE WITH ${faction.name.toUpperCase()} <span aria-hidden="true">→</span>`;
  };
  cards.forEach((card, index) => {
    card.addEventListener("click", () => selectFaction(card));
    card.addEventListener("keydown", (event: KeyboardEvent) => {
      let nextIndex: number | undefined;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = (index + 1) % cards.length;
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = (index - 1 + cards.length) % cards.length;
      if (nextIndex !== undefined) {
        event.preventDefault();
        const nextCard = cards[nextIndex];
        selectFaction(nextCard);
        nextCard.focus();
      } else if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        selectFaction(card);
      }
    });
  });
  continueButton.addEventListener("click", () => {
    const faction = FACTION_CHOICES.find((choice) => choice.id === continueButton.dataset.selectFaction);
    if (!faction || screen.classList.contains("is-starting")) return;
    selectedFaction = faction;
    continueButton.disabled = true;
    screen.classList.add("is-starting");
    window.setTimeout(() => {
      if (!screen.isConnected) return;
      screen.remove();
      factionSelect = undefined;
      startGame(map, faction);
    }, 260);
  });
  screen.querySelector<HTMLButtonElement>("#back-to-map-select")?.addEventListener("click", () => {
    screen.remove();
    factionSelect = undefined;
    mapStartButton.disabled = false;
    mapSelect.classList.remove("is-starting");
    app!.append(mapSelect);
  });
}

mapStartButton.addEventListener("click", () => {
  if (mapStartButton.disabled || mapSelect.classList.contains("is-starting")) return;
  const mapToStart = selectedMap;
  mapStartButton.disabled = true;
  mapSelect.remove();
  showFactionSelect(mapToStart);
});

async function startGame(map: MapDefinition, faction: FactionDefinition): Promise<void> {
performance.mark("tower-defence-battlefield-load-requested");
const loadingOverlay = document.createElement("div");
loadingOverlay.className = "battlefield-loading-overlay";
loadingOverlay.setAttribute("role", "status");
loadingOverlay.innerHTML = `<span class="battlefield-loading-mark" aria-hidden="true"></span><strong>PREPARING BATTLEFIELD</strong><small>Loading the 3D renderer…</small>`;
app?.append(loadingOverlay);

// Babylon is only needed after the player has selected a map and faction. Keep
// its sizeable renderer and engine out of the first-load Map Select bundle.
let BabylonGameRendererModule: typeof import("./game/rendering3d/BabylonGameRenderer");
try {
  BabylonGameRendererModule = await import("./game/rendering3d/BabylonGameRenderer");
} catch (error) {
  console.error("Battlefield renderer failed to load.", error);
  loadingOverlay.innerHTML = `<strong>COULD NOT LOAD BATTLEFIELD</strong><small>Please refresh and try again.</small>`;
  return;
}
performance.mark("tower-defence-renderer-module-ready");
loadingOverlay.remove();

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
    <button id="battlefield-info-toggle" class="battlefield-info-toggle" type="button" aria-label="Battlefield info" aria-expanded="false">i</button>
    <section id="battlefield-info-panel" class="battlefield-info-panel ui-panel" aria-labelledby="battlefield-info-title" hidden>
      <div class="battlefield-info-heading"><h2 id="battlefield-info-title">BATTLEFIELD INFO</h2><button id="battlefield-info-close" type="button" aria-label="Close battlefield info">×</button></div>
      <div id="battlefield-info-content" class="battlefield-info-content"></div>
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

  <div id="campaign-victory" class="reset-confirmation" role="dialog" aria-modal="true" aria-labelledby="campaign-victory-title" hidden>
    <section class="reset-confirmation-card campaign-victory-card">
      <h2 id="campaign-victory-title">VICTORY</h2>
      <p>You have completed the current campaign! Continue into Free Play and see how long your defenses can survive.</p>
      <div class="reset-confirmation-actions">
        <button id="continue-free-play-button" class="action-button confirm-reset-button" type="button">CONTINUE TO FREE PLAY</button>
        <button id="end-campaign-button" class="action-button return-map-select-button" type="button">END / RETURN</button>
      </div>
    </section>
  </div>

  <aside id="hp-scaling-warning" class="hp-scaling-warning" role="status" aria-live="polite" hidden>
    <span class="hp-warning-sigil" aria-hidden="true">⚔</span>
    <div class="hp-warning-copy">
      <strong id="wave-warning-title">THE HORDE GROWS STRONGER</strong>
      <p id="wave-warning-body">Dark forces gather beyond the gates.<br>Stronger enemies are approaching.</p>
      <div id="wave-warning-affixes" class="wave-warning-affixes" hidden></div>
      <small id="wave-warning-footer">Prepare your defenses.</small>
    </div>
  </aside>

  <div id="minimap-dock" class="minimap-dock"><section id="minimap-panel" class="minimap-panel" aria-label="Tactical map overview">
    <div class="minimap-heading"><span>FIELD MAP</span><span aria-hidden="true">N ↑</span></div>
    <canvas id="game-minimap" class="game-minimap" role="img" aria-label="Map overview"></canvas>
  </section><button id="minimap-toggle" class="minimap-toggle" type="button" aria-label="Collapse minimap" aria-expanded="true" title="Collapse minimap"><span aria-hidden="true">‹</span></button></div>

  <footer class="bottom-hud-bar">
    <section class="build-unit-section" aria-label="Build units">
      <div class="bottom-section-heading"><span>BUILD UNITS</span></div>
      <div class="build-carousel-shell">
        <button id="carousel-previous" class="carousel-arrow" type="button" aria-label="Previous unit" title="Previous unit">‹</button>
  <nav class="defender-choice-panel" aria-label="Choose defender to build">
    <button id="select-tool-button" class="defender-choice select-tool is-selected" type="button" aria-label="Select tool" aria-pressed="true">
      <span class="select-tool-icon" aria-hidden="true">↖</span><span class="unit-card-copy"><strong>SELECT</strong><small>TOOL</small></span><span class="unit-card-selection">ACTIVE</span>
    </button>
    ${faction.units.map((type) => {
      const defender = DEFENDER_CONFIG[type];
      return `<button id="build-${type}-button" class="defender-choice${type === "holy-emperor" ? " is-ultimate" : ""}" type="button" aria-label="Select ${defender.name}" aria-pressed="false">
        <span class="unit-portrait-frame">${defenderPortraitMarkup(type, "unit-portrait-fallback")}</span>
        <span class="unit-card-copy"><strong>${defender.name}</strong><small class="unit-card-cost">${defender.buildCost}G</small></span>
        <span class="unit-card-selection">SELECTED</span>
      </button>`;
    }).join("")}
  </nav>
        <button id="carousel-next" class="carousel-arrow" type="button" aria-label="Next unit" title="Next unit">›</button>
      </div>
      <small id="carousel-selection-summary" class="carousel-selection-summary" aria-live="polite">SELECT TOOL</small>
    </section>
    <section class="tower-info-section" aria-label="Selected tower and actions">
      <div id="tower-empty-state" class="tower-empty-state">
        <span class="empty-state-icon" aria-hidden="true">✥</span>
        <strong>Select a unit or tower</strong>
        <small>Details will appear here</small>
      </div>
      <section id="build-unit-info" class="build-unit-info" aria-label="Selected unit for building" hidden>
        <div class="build-unit-info-heading">
          <span class="build-unit-info-portrait"><img id="build-unit-info-image" alt="" draggable="false" hidden><span id="build-unit-info-fallback" class="portrait-placeholder" aria-label="Portrait unavailable" hidden>✦</span></span>
          <span class="build-unit-info-name-wrap"><strong id="build-unit-info-name"></strong><small id="build-unit-info-role"></small></span>
        </div>
        <div class="build-unit-info-stats">
          <span>Damage <strong id="build-unit-info-damage"></strong></span>
          <span>Range <strong id="build-unit-info-range"></strong></span>
          <span>Attack Rate <strong id="build-unit-info-rate"></strong></span>
          <span>Build Cost <strong id="build-unit-info-cost"></strong></span>
        </div>
        <small id="build-unit-info-capabilities" class="build-unit-info-capabilities" hidden></small>
        <div id="build-sovereign-profiles" class="sovereign-profile-list" hidden></div>
        <small class="build-unit-info-hint" aria-live="polite">Loading defender visuals…</small>
      </section>
  <section id="tower-panel" class="tower-panel" aria-label="Selected defender" hidden>
    <button id="close-tower-panel" class="panel-close" type="button" aria-label="Deselect tower">×</button>
    <div class="tower-identity">
      <div class="tower-portrait" aria-hidden="true">✦</div>
      <div><div class="tower-name">Blue Wizard</div><div id="tower-level" class="tower-level">Level 1</div><div id="tower-specialization" class="tower-specialization" hidden></div></div>
    </div>
    <small id="tower-specialization-detail" class="tower-specialization-detail" hidden></small>
    <div class="tower-stat-group">
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
      <div class="tower-secondary-bonuses">
        <div id="tower-veteran" class="tower-veteran" hidden></div>
        <div class="tower-buff-row"><strong>BUFFS</strong><div id="tower-buff-icons" class="tower-buff-icons" aria-label="Active tower buffs"></div></div>
      </div>
    </div>
    <div class="tower-actions">
      <div id="upgrade-action-wrap" class="upgrade-action-wrap">
        <div id="upgrade-tooltip" class="upgrade-tooltip" role="tooltip" hidden></div>
        <button id="upgrade-button" class="action-button upgrade-button" type="button">UPGRADE</button>
        <button id="upgrade-info-button" class="upgrade-info-button" type="button" aria-label="Show upgrade details" aria-expanded="false">i</button>
      </div>
      <button id="sell-button" class="action-button sell-button" type="button">SELL</button>
    </div>
    <section id="specialization-choice" class="specialization-choice" aria-label="Choose tower specialization" hidden>
      <div class="specialization-choice-heading"><strong>CHOOSE SPECIALIZATION</strong><button id="cancel-specialization" type="button" aria-label="Cancel specialization choice">×</button></div>
      <div id="specialization-options" class="specialization-options"></div>
    </section>
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

const gameState = new GameState(map, faction.id);
const { BabylonGameRenderer } = BabylonGameRendererModule;
const renderer = new BabylonGameRenderer(canvas, map, faction.id);
const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
console.info("APPLICATION BOOT", { navigationType: navigation?.type ?? "unknown" });
const debugParams = new URLSearchParams(window.location.search);
if (debugParams.get("waveDebug") === "1" || debugParams.get("perfDebug") === "1" || debugParams.get("enemyAnimationDebug") === "1") {
  (window as Window & { __towerDefenceGameState?: GameState }).__towerDefenceGameState = gameState;
}

if (debugParams.get("enemyAnimationDebug") === "1") {
  let enemyAnimationTestSet = 0;
  (window as Window & { __towerDefenceEnemyAnimationTest?: {
    spawn: (count: number, type?: EnemyType) => object[];
    kill: (id?: number) => number | undefined;
    snapshot: () => object;
  } }).__towerDefenceEnemyAnimationTest = {
    /** Test-only presentation stress hook; does not call or alter tower/combat systems. */
    spawn: (requestedCount, type: EnemyType = "skeletonKing") => {
      const route = gameState.path.length > 1 ? gameState.path : gameState.spawnPaths.values().next().value;
      if (!route || route.length < 2) return [];
      const count = Math.max(1, Math.min(100, Math.floor(requestedCount)));
      const testBaseId = -9300 - enemyAnimationTestSet++ * 100;
      gameState.waveActive = false;
      gameState.attackEvents.length = 0;
      gameState.enemies = Array.from({ length: count }, (_, index) => {
        const enemy = createEnemy(testBaseId - index, type, route, Math.max(1, gameState.currentWave));
        enemy.x = route[0].x + (index % 10) * 0.03;
        enemy.y = route[0].y + (Math.floor(index / 10) % 10) * 0.03;
        enemy.speed = 0.25;
        return enemy;
      });
      return gameState.enemies.map(({ id, type }) => ({ id, type }));
    },
    kill: (requestedId) => {
      const enemy = gameState.enemies.find((candidate) => requestedId === undefined || candidate.id === requestedId);
      if (!enemy) return undefined;
      enemy.alive = false;
      enemy.hp = 0;
      gameState.attackEvents.push({ targetEnemyId: enemy.id, targetX: enemy.x, targetY: enemy.y, enemyDied: true } as GameState["attackEvents"][number]);
      gameState.enemies = gameState.enemies.filter((candidate) => candidate.id !== enemy.id);
      renderer.debugBeginEnemyDeathVisual(enemy.id);
      return enemy.id;
    },
    snapshot: () => renderer.getEnemyAnimationDebugState(),
  };
}

const query = <T extends HTMLElement>(selector: string): T => {
  const element = ui.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
};
const minimapPanel = query<HTMLElement>("#minimap-panel");
const minimapDock = query<HTMLElement>("#minimap-dock");
const minimapToggle = query<HTMLButtonElement>("#minimap-toggle");
const minimapCanvas = query<HTMLCanvasElement>("#game-minimap");
const minimap = new MinimapRenderer(minimapPanel, minimapCanvas, map);
let minimapCloseTimer: number | undefined;
const setMinimapOpen = (open: boolean): void => {
  // Read size only on explicit user toggles; the minimap renderer/data stays mounted.
  const panelHeight = minimapPanel.getBoundingClientRect().height;
  const tabWidth = minimapToggle.getBoundingClientRect().width;
  minimapDock.style.width = open ? "" : `${tabWidth}px`;
  minimapDock.style.height = open ? "" : `${panelHeight}px`;
  minimapDock.classList.toggle("is-collapsed", !open);
  if (minimapCloseTimer !== undefined) window.clearTimeout(minimapCloseTimer);
  minimapCloseTimer = undefined;
  if (open) minimapPanel.style.visibility = "";
  else {
    minimapPanel.style.visibility = "";
    minimapCloseTimer = window.setTimeout(() => {
      if (minimapDock.classList.contains("is-collapsed")) minimapPanel.style.visibility = "hidden";
      minimapCloseTimer = undefined;
    }, 220);
  }
  minimapToggle.setAttribute("aria-expanded", String(open));
  minimapToggle.setAttribute("aria-label", open ? "Collapse minimap" : "Expand minimap");
  minimapToggle.title = open ? "Collapse minimap" : "Expand minimap";
  minimapToggle.firstElementChild!.textContent = open ? "‹" : "›";
};
minimapToggle.addEventListener("click", () => setMinimapOpen(minimapDock.classList.contains("is-collapsed")));
const bottomHudBar = query<HTMLElement>(".bottom-hud-bar");
const syncMinimapDock = (): void => {
  ui.style.setProperty("--game-bottom-hud-height", `${bottomHudBar.getBoundingClientRect().height}px`);
};
const minimapDockObserver = new ResizeObserver(syncMinimapDock);
minimapDockObserver.observe(bottomHudBar);
requestAnimationFrame(syncMinimapDock);
const buildUnitSection = query<HTMLElement>(".build-unit-section");
const defenderChoicePanel = query<HTMLElement>(".defender-choice-panel");
const carouselSummary = query<HTMLElement>("#carousel-selection-summary");
const infoToggle = query<HTMLButtonElement>("#battlefield-info-toggle");
const infoPanel = query<HTMLElement>("#battlefield-info-panel");
const infoContent = query<HTMLElement>("#battlefield-info-content");
let buildCarousel: BuildCarousel | undefined;
const updateBuildTrayOverflow = (): void => {
  buildUnitSection.classList.toggle("has-overflow", defenderChoicePanel.scrollWidth > defenderChoicePanel.clientWidth + 1);
};
defenderChoicePanel.addEventListener("scroll", updateBuildTrayOverflow, { passive: true });
const handleBuildTrayResize = (): void => {
  updateBuildTrayOverflow();
  buildCarousel?.refresh();
  // ResizeObserver normally keeps the minimap dock in sync; this rAF fallback
  // also handles viewport/orientation changes before the observer callback.
  requestAnimationFrame(syncMinimapDock);
};
const buildTrayResizeObserver = new ResizeObserver(handleBuildTrayResize);
const buildTrayMutationObserver = new MutationObserver(handleBuildTrayResize);
const uiLifecycle = new AbortController();
window.addEventListener("resize", handleBuildTrayResize, { passive: true });
buildTrayResizeObserver.observe(defenderChoicePanel);
buildTrayMutationObserver.observe(defenderChoicePanel, { childList: true });
const disposeBuildTrayObservers = (): void => {
  uiLifecycle.abort();
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
const campaignVictory = query<HTMLElement>("#campaign-victory");
const continueFreePlayButton = query<HTMLButtonElement>("#continue-free-play-button");
const endCampaignButton = query<HTMLButtonElement>("#end-campaign-button");
const hpScalingWarning = query<HTMLElement>("#hp-scaling-warning");
const waveWarningTitle = query<HTMLElement>("#wave-warning-title");
const waveWarningBody = query<HTMLElement>("#wave-warning-body");
const waveWarningAffixes = query<HTMLElement>("#wave-warning-affixes");
const waveWarningFooter = query<HTMLElement>("#wave-warning-footer");
const towerPanel = query<HTMLElement>("#tower-panel");
const towerEmptyState = query<HTMLElement>("#tower-empty-state");
const buildUnitInfo = query<HTMLElement>("#build-unit-info");
const buildUnitInfoImage = query<HTMLImageElement>("#build-unit-info-image");
const buildUnitInfoFallback = query<HTMLElement>("#build-unit-info-fallback");
const buildUnitInfoCapabilities = query<HTMLElement>("#build-unit-info-capabilities");
const buildUnitInfoName = query<HTMLElement>("#build-unit-info-name");
const buildUnitInfoRole = query<HTMLElement>("#build-unit-info-role");
const buildUnitInfoDamage = query<HTMLElement>("#build-unit-info-damage");
const buildUnitInfoRange = query<HTMLElement>("#build-unit-info-range");
const buildUnitInfoRate = query<HTMLElement>("#build-unit-info-rate");
const buildUnitInfoCost = query<HTMLElement>("#build-unit-info-cost");
const buildUnitInfoHint = query<HTMLElement>(".build-unit-info-hint");
const buildSovereignProfiles = query<HTMLElement>("#build-sovereign-profiles");
const towerPortrait = query<HTMLElement>(".tower-portrait");
const towerBuffRow = query<HTMLElement>(".tower-buff-row");
const towerPortraitStack = document.createElement("div");
towerPortraitStack.className = "tower-portrait-stack";
towerPortrait.before(towerPortraitStack);
towerPortraitStack.append(towerPortrait, towerBuffRow);
const towerLevel = query<HTMLElement>("#tower-level");
const towerDamage = query<HTMLElement>("#tower-damage");
const towerRange = query<HTMLElement>("#tower-range");
const towerFireRate = query<HTMLElement>("#tower-fire-rate");
const towerStandardStats = query<HTMLElement>(".tower-stats");
const towerSovereignProfiles = query<HTMLElement>("#tower-sovereign-profiles");
const towerKills = query<HTMLElement>("#tower-kills");
const towerDamageDone = query<HTMLElement>("#tower-damage-done");
const towerSpecialization = query<HTMLElement>("#tower-specialization");
const towerSpecializationDetail = query<HTMLElement>("#tower-specialization-detail");
const towerVeteran = query<HTMLElement>("#tower-veteran");
const towerBuffIcons = query<HTMLElement>("#tower-buff-icons");
const specializationChoice = query<HTMLElement>("#specialization-choice");
const specializationOptions = query<HTMLElement>("#specialization-options");
const upgradeButton = query<HTMLButtonElement>("#upgrade-button");
const upgradeInfoButton = query<HTMLButtonElement>("#upgrade-info-button");
const upgradeActionWrap = query<HTMLElement>("#upgrade-action-wrap");
const upgradeTooltip = query<HTMLElement>("#upgrade-tooltip");
const towerMessage = query<HTMLElement>("#tower-message");
const sellButton = query<HTMLButtonElement>("#sell-button");
let pendingSellTowerId: number | undefined;
let sellConfirmationTimer: number | undefined;
let activeWarningKey: string | undefined;
let warningHideTimer: number | undefined;
let selectedTowerId: number | undefined;
let lastSelectedTowerRenderKey = "";
let lastSelectedVeteranRank: number | undefined;
let specializationChoiceTowerId: number | undefined;
let selectedBuildType: DefenderType | undefined;
let selectionMessage = "";
let resetMenuWasPaused = false;

const cancelSellConfirmation = (): void => {
  if (sellConfirmationTimer !== undefined) window.clearTimeout(sellConfirmationTimer);
  sellConfirmationTimer = undefined;
  pendingSellTowerId = undefined;
};

query<HTMLElement>("#tower-fire-rate").parentElement!.firstChild!.textContent = "Attack Speed ";

const setSelection = (towerId?: number): void => {
  if (towerId !== selectedTowerId) {
    cancelSellConfirmation();
    lastSelectedTowerRenderKey = "";
    lastSelectedVeteranRank = undefined;
  }
  selectedTowerId = towerId;
  if (specializationChoiceTowerId !== towerId) closeSpecializationChoice();
  selectionMessage = "";
  if (towerId === undefined) hideUpgradeTooltip();
  renderSelectedTower(gameState);
};

const buildButtons = Object.fromEntries(faction.units.map((type) => [
  type, query<HTMLButtonElement>(`#build-${type}-button`),
])) as Record<DefenderType, HTMLButtonElement>;
const selectToolButton = query<HTMLButtonElement>("#select-tool-button");
const carouselItems = [selectToolButton, ...faction.units.map((type) => buildButtons[type])];
for (const button of Object.values(buildButtons)) button.disabled = true;
startButton.disabled = true;
let previousDefenderAssetsReady: boolean | undefined;
const updateCarouselSummary = (type?: DefenderType): void => {
  if (!type) {
    carouselSummary.textContent = "SELECT TOOL";
    return;
  }
  const defender = DEFENDER_CONFIG[type];
  const range = defender.supportsMapWideTargeting ? "MAP WIDE"
    : defender.rangeMode === "adjacent8" ? "MELEE" : defender.rangeMode === "hybrid" ? "HYBRID" : "RANGED";
  const targets = defender.targetTypes.includes("air") ? "GROUND + AIR" : "GROUND";
  carouselSummary.textContent = `${range} · ${targets}`;
};
const chooseBuildType = (type: DefenderType): void => {
  selectedBuildType = type;
  renderer.setBuildDefenderType(type);
  selectToolButton.classList.remove("is-selected");
  selectToolButton.setAttribute("aria-pressed", "false");
  for (const [buttonType, button] of Object.entries(buildButtons) as [DefenderType, HTMLButtonElement][]) {
    button.classList.toggle("is-selected", buttonType === type);
    button.setAttribute("aria-pressed", String(buttonType === type));
  }
  buildCarousel?.setSelected(faction.units.indexOf(type) + 1);
  updateCarouselSummary(type);
  if (selectedTowerId === undefined) renderBuildUnitInfo();
};
const chooseSelectTool = (): void => {
  selectedBuildType = undefined;
  renderer.setBuildDefenderType(undefined);
  selectToolButton.classList.add("is-selected");
  selectToolButton.setAttribute("aria-pressed", "true");
  for (const button of Object.values(buildButtons)) {
    button.classList.remove("is-selected");
    button.setAttribute("aria-pressed", "false");
  }
  buildCarousel?.setSelected(0);
  updateCarouselSummary();
  if (selectedTowerId === undefined) renderBuildUnitInfo();
};
selectToolButton.addEventListener("click", chooseSelectTool);
for (const type of faction.units) buildButtons[type].addEventListener("click", () => chooseBuildType(type));
buildCarousel = new BuildCarousel(
  defenderChoicePanel, carouselItems,
  query<HTMLButtonElement>("#carousel-previous"), query<HTMLButtonElement>("#carousel-next"),
  (index) => index === 0 ? chooseSelectTool() : chooseBuildType(faction.units[index - 1]), uiLifecycle.signal,
);
buildCarousel.setSelected(0, false);

const setInfoPanelOpen = (open: boolean): void => {
  infoPanel.hidden = !open;
  infoToggle.setAttribute("aria-expanded", String(open));
  if (open) renderBattlefieldInfo(gameState);
};
infoToggle.addEventListener("click", () => setInfoPanelOpen(infoPanel.hidden));
query<HTMLButtonElement>("#battlefield-info-close").addEventListener("click", () => setInfoPanelOpen(false));
towerBuffIcons.addEventListener("click", (event) => {
  if (!(event.target instanceof Element) || !event.target.closest(".tower-buff-icon")) return;
  setInfoPanelOpen(true);
  infoContent.querySelector("#active-buffs-info")?.scrollIntoView({ block: "nearest" });
});
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !resetConfirmation.hidden) return;
  if (selectedBuildType !== undefined) {
    chooseSelectTool();
    return;
  }
  if (!infoPanel.hidden) {
    setInfoPanelOpen(false);
    infoToggle.focus({ preventScroll: true });
  } else if (!specializationChoice.hidden) closeSpecializationChoice();
}, { signal: uiLifecycle.signal });

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
  if (result === "specialization-required") {
    openSpecializationChoice(selectedTowerId);
    return;
  }
  selectionMessage = result === "upgraded" ? "" : result === "not-enough-gold" ? "Not enough gold" : result === "max-level" ? "Max level reached" : "Upgrade unavailable";
  renderSelectedTower(gameState);
});
query<HTMLButtonElement>("#cancel-specialization").addEventListener("click", closeSpecializationChoice);
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
  if (!renderer.areDefenderAssetsReady) return;
  renderer.logCameraState("BEFORE START WAVE");
  if (gameState.startWave()) {
    renderer.logCameraState("AFTER startWave()");
    console.log("Wave started", { wave: gameState.currentWave, enemies: gameState.enemiesRemaining });
  }
});
autoButton.addEventListener("click", () => gameState.toggleAutoRun());
continueFreePlayButton.addEventListener("click", () => {
  if (gameState.continueFreePlay()) campaignVictory.hidden = true;
});
endCampaignButton.addEventListener("click", () => {
  campaignVictory.hidden = true;
  returnToMapSelect();
});
tryAgainButton.addEventListener("click", () => {
  resetRun();
});

renderer.start(gameState, (state) => {
  loadingOverlay.remove();
  minimap.update(state, renderer.getApproximateMinimapView());
  goldValue.textContent = String(state.gold);
  livesValue.textContent = String(state.lives);
  waveValue.textContent = String(state.currentWave);
  enemiesValue.textContent = String(state.enemiesRemaining);
  const defenderAssetsReady = renderer.areDefenderAssetsReady;
  if (previousDefenderAssetsReady !== defenderAssetsReady) {
    previousDefenderAssetsReady = defenderAssetsReady;
    if (defenderAssetsReady) performance.mark("tower-defence-defender-assets-ready");
    ui.dataset.defenderAssetsReady = String(defenderAssetsReady);
    for (const button of Object.values(buildButtons)) button.disabled = !defenderAssetsReady;
    buildUnitInfoHint.textContent = defenderAssetsReady ? "Click or tap a tile to place" : "Loading defender visuals…";
  }
  startButton.disabled = !defenderAssetsReady || state.waveActive || state.gameOver || Boolean(state.hpTierWarning) || Boolean(state.affixWarning);
  autoButton.textContent = `AUTO: ${state.autoRun ? "ON" : "OFF"}`;
  autoButton.classList.toggle("is-on", state.autoRun);
  autoButton.disabled = state.gameOver;
  startButton.hidden = state.gameOver;
  autoButton.hidden = state.gameOver;
  tryAgainButton.hidden = !state.gameOver;
  if (state.campaignVictoryPending && campaignVictory.hidden) {
    campaignVictory.hidden = false;
    continueFreePlayButton.focus({ preventScroll: true });
  }
  renderWaveWarning(state);
  if (!infoPanel.hidden) renderBattlefieldInfo(state);
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
    formationVisuals: () => ReturnType<BabylonGameRenderer["getFormationVisualDebug"]>;
    projectCell: (cell: { x: number; y: number }) => ReturnType<BabylonGameRenderer["getCellClientPosition"]>;
    expectedAffixRoll: () => { id: keyof typeof AFFIXES; name: string }[];
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
    formationVisuals: () => renderer.getFormationVisualDebug(),
    projectCell: (cell: { x: number; y: number }) => renderer.getCellClientPosition(cell),
    expectedAffixRoll: () => gameState.affixWarning?.affixes.map((id) => ({ id, name: AFFIXES[id].name })) ?? [],
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

type TowerBuff = { icon: string; name: string; detail: string };

function formatCompactDamage(value: number): string {
  if (value < 1_000) return String(value);
  return `${Number((Math.floor(value / 100) / 10).toFixed(1))}K`;
}

function getTowerBuffs(state: GameState, tower: Tower): TowerBuff[] {
  const buffs: TowerBuff[] = [];
  const veteran = getVeteranProgress(state.factionId, tower);
  if (veteran.rank > 0) {
    buffs.push({ icon: "★", name: veteran.label,
      detail: `Veteran Corps rank ${veteran.rank}; +${Math.round(veteran.damageBonus * 100)}% damage and +${Math.round(veteran.attackSpeedBonus * 100)}% attack speed.` });
    if (veteran.damageBonus > 0) buffs.push({ icon: "⚔", name: "Veteran damage", detail: `+${Math.round(veteran.damageBonus * 100)}% damage from Veteran Corps.` });
    if (veteran.attackSpeedBonus > 0) buffs.push({ icon: "ϟ", name: "Veteran attack speed", detail: `+${Math.round(veteran.attackSpeedBonus * 100)}% attack speed from Veteran Corps.` });
  }
  if (tower.formationId) {
    const formation = FORMATION_BY_ID[tower.formationId];
    buffs.push({ icon: "◇", name: formation.name, detail: formation.description });
  }
  const specialization = tower.specializationId ? TOWER_SPECIALIZATIONS[tower.specializationId] : undefined;
  if (specialization) {
    const icon = specialization.slow ? "❄" : specialization.mark ? "◎" : specialization.chain ? "ϟ"
      : specialization.bonusDamageClasses ? "◆" : specialization.targetDamageMultipliers?.air ? "✦"
        : specialization.splashRatio ? "✺" : specialization.meleeDamageMultiplier ? "⚔" : "✧";
    buffs.push({ icon, name: specialization.name, detail: specialization.description });
  } else {
    const splashRatio = DEFENDER_CONFIG[tower.type].splashDamageRatios?.[tower.level] ?? 0;
    if (splashRatio > 0) buffs.push({ icon: "✺", name: "Splash",
      detail: `${Math.round(splashRatio * 100)}% damage within ${formatBalanceNumber(DEFENDER_CONFIG[tower.type].splashRadiusTiles?.[tower.level] ?? 1.5)} tiles.` });
  }
  if (DEFENDER_CONFIG[tower.type].supportsMapWideTargeting) {
    buffs.push({ icon: "◉", name: "Map-wide targeting", detail: "Can acquire Ground and Air enemies anywhere on the map." });
  }
  if (state.factionId === FACTION_BONUS_CONFIG.ancientGroveId) {
    buffs.push({ icon: "❧", name: "Living Maze", detail: `Ground enemies on influenced paths slow by up to ${Math.round(FACTION_BONUS_CONFIG.livingMaze.maxSlow * 100)}%. Flying enemies are unaffected.` });
  }
  return buffs;
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
  const renderKey = [
    tower.id, tower.type, tower.level, tower.damage, tower.range, tower.fireRate,
    tower.specializationId, tower.formationId, tower.combatStats.kills, tower.combatStats.damageDone,
    state.factionId, state.gold, pendingSellTowerId, selectionMessage,
  ].join("|");
  if (renderKey === lastSelectedTowerRenderKey) return;
  lastSelectedTowerRenderKey = renderKey;
  const veteran = getVeteranProgress(state.factionId, tower);
  const veteranRankedUp = state.factionId === "arcane-kingdom"
    && lastSelectedVeteranRank !== undefined && veteran.rank > lastSelectedVeteranRank;
  lastSelectedVeteranRank = veteran.rank;
  towerPanel.hidden = false;
  buildUnitInfo.hidden = true;
  towerEmptyState.hidden = true;
  query<HTMLElement>(".tower-name").textContent = DEFENDER_CONFIG[tower.type].name;
  const portrait = defenderPortrait(tower.type);
  towerPortrait.textContent = portrait ? "" : "✦";
  towerPortrait.textContent = portrait ? "" : defenderGlyph(tower.type);
  towerPortrait.classList.toggle("has-placeholder", !portrait);
  towerPortrait.style.backgroundImage = portrait ? `url("${portrait}")` : "none";
  towerLevel.textContent = `Level ${tower.level}`;
  const specialization = tower.specializationId ? TOWER_SPECIALIZATIONS[tower.specializationId] : undefined;
  towerSpecialization.hidden = !specialization;
  towerSpecialization.textContent = specialization ? specialization.name.toUpperCase() : "";
  const mapWide = DEFENDER_CONFIG[tower.type].supportsMapWideTargeting === true;
  towerSpecializationDetail.hidden = true;
  towerSpecializationDetail.textContent = specialization?.description ?? (mapWide ? getDefenderCapabilitySummary(tower.type, tower.level) : "");
  towerSpecializationDetail.style.setProperty("--specialization-color", specialization?.visualColor ?? (mapWide ? "#e9cf84" : "#bcf0f6"));
  const buffs = getTowerBuffs(state, tower);
  const buffSignature = buffs.map(({ name, detail }) => `${name}:${detail}`).join("|");
  if (towerBuffIcons.dataset.signature !== buffSignature) {
    towerBuffIcons.dataset.signature = buffSignature;
    towerBuffIcons.replaceChildren(...buffs.map((buff) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tower-buff-icon";
      button.textContent = buff.icon;
      button.title = `${buff.name} — ${buff.detail}`;
      button.setAttribute("aria-label", `${buff.name}: ${buff.detail}. Open details`);
      return button;
    }));
  }
  if (state.factionId === "arcane-kingdom") {
    towerVeteran.hidden = false;
    const title = veteran.rank === 0 ? "VETERAN" : veteran.label.toUpperCase();
    const damage = `${formatCompactDamage(veteran.damage)} DMG`;
    const remaining = veteran.next
      ? `${formatCompactDamage(Math.max(0, veteran.next.requiredDamage - veteran.damage))} TO ${veteran.next.label.toUpperCase()}`
      : "MAX";
    towerVeteran.replaceChildren();
    const rankLabel = document.createElement("strong");
    rankLabel.textContent = title;
    const progressLabel = document.createElement("small");
    progressLabel.textContent = `${damage} · ${remaining}`;
    towerVeteran.append(rankLabel, progressLabel);
    towerVeteran.setAttribute("aria-label", `${title}, ${veteran.damage.toLocaleString("en-US")} damage done, ${veteran.next ? `${Math.max(0, veteran.next.requiredDamage - veteran.damage).toLocaleString("en-US")} damage to ${veteran.next.label}` : "maximum rank"}`);
    if (veteranRankedUp) {
      towerVeteran.classList.remove("is-ranking-up");
      void towerVeteran.offsetWidth;
      towerVeteran.classList.add("is-ranking-up");
    }
  } else {
    towerVeteran.hidden = true;
    towerVeteran.replaceChildren();
    towerVeteran.classList.remove("is-ranking-up");
  }
  if (specializationChoiceTowerId !== undefined && specializationChoiceTowerId !== tower.id) closeSpecializationChoice();
  const isSovereign = tower.type === "sovereign";
  towerStandardStats.hidden = isSovereign;
  towerSovereignProfiles.hidden = !isSovereign;
  if (isSovereign) renderSovereignProfiles(towerSovereignProfiles, tower.level);
  towerDamage.textContent = String(tower.damage);
  towerRange.textContent = mapWide ? "MAP WIDE" : tower.rangeMode === "adjacent8"
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
    const nextSplashRatio = DEFENDER_CONFIG[tower.type].splashDamageRatios?.[nextLevel.level] ?? 0;
    const nextSplashRadius = DEFENDER_CONFIG[tower.type].splashRadiusTiles?.[nextLevel.level];
    if (nextSplashRatio > 0 && nextSplashRadius !== undefined) {
      const splashLabel = DEFENDER_CONFIG[tower.type].splashLabel ?? "Splash";
      tooltipLines.push(`${splashLabel}: ${Math.round(nextSplashRatio * 100)}% within ${formatBalanceNumber(nextSplashRadius)} tiles`);
    }
    tooltipLines.push(`Upgrade Cost: ${upgradeCost} gold`);
    tooltipLines.push(`Total Invested After Upgrade: ${getTotalTowerInvestment(nextLevel.level, tower.type)} gold`);
    if (nextLevel.level === 3 && SPECIALIZATIONS_BY_DEFENDER[tower.type]) {
      tooltipLines.push("Choose one specialization for this Level 3 upgrade.");
      for (const id of SPECIALIZATIONS_BY_DEFENDER[tower.type]!) {
        const choice = TOWER_SPECIALIZATIONS[id];
        tooltipLines.push(`${choice.name}: ${choice.description}`);
      }
    }
  } else {
    tooltipLines.push("MAX LEVEL - no further upgrade");
  }
  upgradeTooltip.textContent = tooltipLines.join("\n");
  towerMessage.textContent = selectionMessage;
}

function openSpecializationChoice(towerId: number): void {
  const tower = gameState.towers.find((candidate) => candidate.id === towerId);
  if (!tower) return;
  const choices = SPECIALIZATIONS_BY_DEFENDER[tower.type];
  const next = getTowerLevelStats(3, tower.type);
  const cost = next.upgradeCost;
  if (!choices || cost === null) return;
  specializationChoiceTowerId = towerId;
  specializationOptions.replaceChildren();
  for (const id of choices) {
    const choice = TOWER_SPECIALIZATIONS[id];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "specialization-option";
    button.disabled = gameState.gold < cost;
    const name = document.createElement("strong"); name.textContent = choice.name;
    const role = document.createElement("small"); role.textContent = choice.role;
    const description = document.createElement("span"); description.textContent = choice.description;
    const price = document.createElement("em"); price.textContent = `Level 3 · ${cost} Gold`;
    button.append(name, role, description, price);
    button.addEventListener("click", () => {
      const result = gameState.upgradeBasicTower(towerId, id as TowerSpecializationId);
      if (result === "upgraded") {
        selectionMessage = `${choice.name} selected.`;
        closeSpecializationChoice();
      } else {
        selectionMessage = result === "not-enough-gold" ? "Not enough gold" : "Specialization unavailable";
      }
      renderSelectedTower(gameState);
    });
    specializationOptions.append(button);
  }
  specializationChoice.hidden = false;
}

function closeSpecializationChoice(): void {
  specializationChoice.hidden = true;
  specializationChoiceTowerId = undefined;
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
  const isMapWide = defender.supportsMapWideTargeting === true;
  query<HTMLElement>(".build-unit-info-stats").hidden = isSovereign;
  buildSovereignProfiles.hidden = !isSovereign;
  if (isSovereign) renderSovereignProfiles(buildSovereignProfiles, 1, true);
  const portrait = defenderPortrait(selectedBuildType);
  buildUnitInfoImage.hidden = !portrait;
  buildUnitInfoFallback.hidden = Boolean(portrait);
  if (portrait) buildUnitInfoImage.src = portrait;
  else { buildUnitInfoImage.removeAttribute("src"); buildUnitInfoFallback.textContent = defenderGlyph(selectedBuildType); }
  buildUnitInfoCapabilities.hidden = !isMapWide;
  buildUnitInfoCapabilities.textContent = isMapWide ? getDefenderCapabilitySummary(selectedBuildType, 1) : "";
  buildUnitInfoName.textContent = defender.name;
  buildUnitInfoRole.textContent = (selectedBuildType === "sovereign"
    ? defender.roleLabel ?? defender.specializationLabel
    : defender.specializationLabel ?? defender.roleLabel)
    ?? (defender.rangeMode === "adjacent8" ? "Melee Defender" : "Ranged Defender");
  buildUnitInfoDamage.textContent = String(stats.damage);
  buildUnitInfoRange.textContent = isMapWide ? "MAP WIDE" : defender.rangeMode === "adjacent8"
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
  campaignVictory.hidden = true;
  cancelSellConfirmation();
  activeWarningKey = undefined;
  if (warningHideTimer !== undefined) window.clearTimeout(warningHideTimer);
  warningHideTimer = undefined;
  hpScalingWarning.hidden = true;
  hpScalingWarning.classList.remove("is-visible", "is-hiding");
}

function resetRun(): void {
  clearRunFeedback();
  chooseSelectTool();
  setInfoPanelOpen(false);
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
  minimapDock.remove();
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

function renderWaveWarning(state: GameState): void {
  const affixWarning = state.affixWarning;
  const hpWarning = state.hpTierWarning;
  const key = affixWarning ? `affix-${affixWarning.wave}` : hpWarning ? `hp-${hpWarning.completedWave}` : undefined;
  if (key) {
    if (activeWarningKey === key && !hpScalingWarning.hidden) return;
    activeWarningKey = key;
    if (warningHideTimer !== undefined) window.clearTimeout(warningHideTimer);
    warningHideTimer = undefined;
    if (affixWarning) {
      const warningCopy = {
        1: {
          title: "ENEMY AFFIXES AWAKEN",
          body: "Dark enchantments now empower the horde. Affixed enemies may appear from this wave onward.",
          footer: "This escalation remains active for the rest of the run.",
        },
        2: {
          title: "THE HORDE GROWS DEADLIER",
          body: "Stronger affixes now enter the battlefield and may affect eligible enemies from this point onward.",
          footer: "Tier I remains unlocked; this stronger tier persists through the run.",
        },
        3: {
          title: "THE CURSE DEEPENS",
          body: "The affix pool intensifies again. Deadlier empowered enemies may continue to appear for the rest of the run.",
          footer: "All unlocked affixes remain available through run end.",
        },
      } as const;
      const copy = warningCopy[affixWarning.tier];
      waveWarningTitle.textContent = copy.title;
      waveWarningBody.textContent = copy.body;
      waveWarningAffixes.replaceChildren(...affixWarning.affixes.map((id) => {
        const item = document.createElement("span");
        item.className = "wave-warning-affix";
        const name = document.createElement("strong"); name.textContent = AFFIXES[id].name.toUpperCase();
        const description = document.createElement("small"); description.textContent = formatAffixEffect(id, affixWarning.tier);
        item.append(name, description);
        return item;
      }));
      waveWarningAffixes.hidden = false;
      waveWarningFooter.textContent = copy.footer;
    } else if (hpWarning) {
      waveWarningTitle.textContent = "THE HORDE GROWS STRONGER";
      waveWarningBody.textContent = "Dark forces gather beyond the gates. Stronger enemies are approaching.";
      waveWarningAffixes.hidden = true;
      waveWarningFooter.textContent = `Wave ${hpWarning.nextWave} health multiplier: ${hpWarning.nextMultiplier}×`;
    }
    hpScalingWarning.hidden = false;
    hpScalingWarning.classList.remove("is-hiding", "is-visible");
    void hpScalingWarning.offsetWidth;
    hpScalingWarning.classList.add("is-visible");
    return;
  }
  if (activeWarningKey === undefined) return;
  activeWarningKey = undefined;
  hpScalingWarning.classList.remove("is-visible");
  hpScalingWarning.classList.add("is-hiding");
  warningHideTimer = window.setTimeout(() => {
    hpScalingWarning.hidden = true;
    hpScalingWarning.classList.remove("is-hiding");
    warningHideTimer = undefined;
  }, 420);
}

function formatAffixEffect(id: keyof typeof AFFIXES, tier: 1 | 2 | 3): string {
  const value = AFFIXES[id].values[tier];
  const percent = `${Number((value * 100).toFixed(2))}%`;
  switch (id) {
    case "armored": return `${percent} physical resistance`;
    case "arcane-ward": return `${percent} magic resistance`;
    case "swift": return `+${percent} movement speed`;
    case "fortified": return `+${percent} maximum health`;
    case "regenerator": return `${percent} max HP restored / sec`;
    case "shielded": return `${percent} max HP as shield`;
    case "commander": return `+${percent} nearby enemy speed`;
    case "frenzied": return `+${percent} speed below 35% HP`;
  }
}

function renderBattlefieldInfo(state: GameState): void {
  const wave = state.currentWave;
  const hpMultiplier = getEnemyHpMultiplier(wave);
  const nextHpWave = (Math.floor((wave - 1) / 10) + 1) * 10 + 1;
  const milestones = Object.entries(AFFIX_MILESTONES).map(([milestone, tier]) => ({ wave: Number(milestone), tier }));
  const nextAffix = milestones.find(({ wave: milestone }) => milestone > wave);
  const activeTier = wave >= 45 ? 3 : wave >= 30 ? 2 : wave >= 15 ? 1 : undefined;
  const romanTier = { 1: "I", 2: "II", 3: "III" } as const;
  const progression = state.affixSystem.getProgression();
  const parts: string[] = [
    `<section class="battlefield-info-block"><h3>CURRENT WAVE</h3><p>Wave ${wave}</p></section>`,
    `<section class="battlefield-info-block"><h3>ENEMY HP SCALING</h3><p>Current multiplier <strong>×${hpMultiplier}</strong></p><small>HP multiplier changes at each 10-wave tier. Next change: Wave ${nextHpWave} → ×${getEnemyHpMultiplier(nextHpWave)}.</small></section>`,
  ];
  const activeAffixStatus = activeTier
    ? `<strong>Tier ${romanTier[activeTier]} — active from Wave ${activeTier * 15} onward.</strong>`
    : "Not unlocked yet — Tier I unlocks at Wave 15.";
  parts.push(`<section class="battlefield-info-block"><h3>ENEMY AFFIXES</h3><p>${activeAffixStatus}</p><small>Eligible enemies may receive any affix unlocked this run. Each milestone expands the pool and increases affix strength; unlocked affixes remain available for the rest of the run.</small></section>`);
  parts.push(`<section class="battlefield-info-block"><h3>AFFIXES UNLOCKED THIS RUN</h3><ul>${milestones.map(({ wave: milestone, tier }) => {
    const rolled = progression[tier];
    const contents = rolled?.length && wave >= milestone
      ? rolled.map((id) => `<li><strong>${AFFIXES[id].name}</strong><small>${AFFIXES[id].description}</small></li>`).join("")
      : `<li class="info-muted">${milestone > wave ? `Unlocks at Wave ${milestone}` : "No affixes recorded"}</li>`;
    const status = milestone <= wave ? "UNLOCKED" : "UNLOCKS";
    return `<li class="info-milestone"><strong>TIER ${romanTier[tier]} · ${status} AT WAVE ${milestone}</strong><ul>${contents}</ul></li>`;
  }).join("")}</ul>${nextAffix ? `<p class="info-next-milestone">NEXT AFFIX TIER <strong>Tier ${romanTier[nextAffix.tier]} · Wave ${nextAffix.wave}</strong></p>` : "<p class=\"info-muted\">All affix tiers are unlocked for this run.</p>"}</section>`);
  parts.push(`<section class="battlefield-info-block"><h3>RUN</h3><p>Map: ${state.map.name}<br>Faction: ${state.faction.name}</p></section>`);
  const factionBonus = state.factionId === "arcane-kingdom"
    ? `<strong>VETERAN CORPS</strong><br><small>Royal Guard towers gain ranks through combat experience.</small>`
    : `<strong>LIVING MAZE</strong><br><small>Ground enemies are slowed on Grove-influenced paths. Current maximum slow: <strong>20%</strong>. Flying enemies are unaffected.</small>`;
  parts.push(`<section class="battlefield-info-block"><h3>FACTION BONUS</h3><p>${factionBonus}</p></section>`);
  const selectedTower = state.towers.find((tower) => tower.id === selectedTowerId);
  if (selectedTower) {
    const buffs = getTowerBuffs(state, selectedTower);
    parts.push(`<section id="active-buffs-info" class="battlefield-info-block"><h3>ACTIVE BUFFS · ${DEFENDER_CONFIG[selectedTower.type].name}</h3><ul class="active-buff-details">${buffs.length
      ? buffs.map(({ icon, name, detail }) => `<li><span aria-hidden="true">${icon}</span><div><strong>${name}</strong><small>${detail}</small></div></li>`).join("")
      : "<li class=\"info-muted\">No active buffs yet.</li>"}</ul></section>`);
    if (selectedTower.specializationId) {
      const specialization = TOWER_SPECIALIZATIONS[selectedTower.specializationId];
      parts.push(`<section class="battlefield-info-block"><h3>SPECIALIZATION</h3><p>${specialization.name}</p><small>${specialization.description}</small></section>`);
    }
  } else if (selectedBuildType) {
    const defender = DEFENDER_CONFIG[selectedBuildType];
    const stats = defender.levels[0];
    parts.push(`<section class="battlefield-info-block"><h3>SELECTED UNIT</h3><p>${defender.name} · ${defender.buildCost} Gold</p><small>${stats.damage} damage · ${stats.fireRate.toFixed(2)} attacks/sec · ${defender.supportsMapWideTargeting ? "Map-wide" : defender.rangeMode === "adjacent8" ? "Adjacent melee" : `${formatBalanceNumber(stats.range / WORLD_UNITS_PER_CELL)} tile range`} · Targets ${defender.targetTypes.join(" + ")}</small></section>`);
  }
  const signature = parts.join("");
  if (infoContent.dataset.signature === signature) return;
  infoContent.dataset.signature = signature;
  infoContent.innerHTML = signature;
}

function formatBalanceNumber(value: number): string {
  return String(Number(value.toFixed(2)));
}

function getDefenderCapabilitySummary(type: DefenderType, level: number): string {
  const defender = DEFENDER_CONFIG[type];
  const targets = defender.targetTypes.map((target) => target === "air" ? "Air" : "Ground").join(" + ");
  const parts = [defender.supportsMapWideTargeting ? "Map-wide" : "", targets ? `Targets ${targets}` : ""].filter(Boolean);
  const splashRatio = defender.splashDamageRatios?.[level] ?? 0;
  const splashRadius = defender.splashRadiusTiles?.[level];
  if (splashRatio > 0 && splashRadius !== undefined) {
    parts.push(`${defender.splashLabel ?? "Splash"} ${Math.round(splashRatio * 100)}% within ${formatBalanceNumber(splashRadius)} tiles`);
  }
  return parts.join(" · ").toUpperCase();
}
}
