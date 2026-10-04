import {
  AbstractMesh, ArcRotateCamera, Color3, Color4, DirectionalLight, DynamicTexture, Engine, HemisphericLight, Matrix, Mesh, MeshBuilder,
  PointLight, Scene, ShadowGenerator, StandardMaterial, TransformNode, Vector3,
} from "@babylonjs/core";
import { MAPS, MapDefinition } from "../config/MapConfig";
import { gridToWorld3D, TILE_SIZE_3D, worldToGrid3D } from "./Grid3D";
import { WORLD_UNITS_PER_CELL } from "../../core/GameConstants";
import type { DefenderType } from "../config/DefenderConfig";
import type { EnemyType } from "../config/EnemyConfig";
import { GameState } from "../GameState";
import { EnemyMeshFactory, GoblinVisual } from "./EnemyMeshFactory";
import { Tower } from "../towers/Tower";
import { CombatEffects3D } from "./CombatEffects3D";
import { ArcherMeshFactory, ArcherVisual } from "./ArcherMeshFactory";
import { QuaterniusArcherFactory, QuaterniusArcherVisual } from "./QuaterniusArcherFactory";
import { BlueWizardFactory, BlueWizardVisual } from "./BlueWizardFactory";
import { HolyKnightFactory, HolyKnightVisual } from "./HolyKnightFactory";
import { QuaterniusEnemyFactory, QuaterniusEnemyVisual } from "./QuaterniusEnemyFactory";
import { QuaterniusDefenderFactory, QuaterniusDefenderVisual } from "./QuaterniusDefenderFactory";
import { ENEMY_VISUAL_CONFIG } from "./EnemyVisualConfig";
import { EnvironmentAssetLibrary } from "./EnvironmentAssetLibrary";
import { VISUAL_CONFIG } from "./VisualConfig";
import { EnvironmentTheme, themeForRun } from "./EnvironmentThemes";
import { WinterArenaArt } from "./WinterArenaArt";
import { TerrainCliffRenderer } from "./TerrainCliffRenderer";
import { GameSpeedMultiplier, SimulationClock } from "../SimulationClock";
import type { MinimapCameraView } from "../minimap/MinimapRenderer";
import { groundFootprintToLogicalBounds, groundPointToLogicalMap } from "../minimap/MinimapCoordinates";
import type { LinesMesh } from "@babylonjs/core";

type TowerVisual = ArcherVisual | QuaterniusArcherVisual | BlueWizardVisual | HolyKnightVisual | QuaterniusDefenderVisual;
type EnemyVisual = GoblinVisual | QuaterniusEnemyVisual;
interface CameraState { alpha: number; beta: number; radius: number; target: Vector3; }
interface PointerPoint { x: number; y: number; pointerType: string; }
interface PerformanceSnapshot {
  phase: "before-wave" | "mid-wave" | "after-wave";
  wave: number;
  fps: number;
  frameTimeMs: number;
  enemies: number;
  allies: number;
  meshes: number;
  skeletons: number;
  animationGroups: number;
  activeAnimationGroups: number;
  combatEffects: number;
  projectiles: number;
  hpBars: number;
  shadowCasters: number;
  environmentProps: number;
}

function createPresentationSeed(): number {
  const debugSeed = Number.parseInt(new URLSearchParams(window.location.search).get("themeSeed") ?? "", 10);
  return Number.isFinite(debugSeed) ? debugSeed : Math.floor(Math.random() * 0x7fffffff);
}

export class BabylonGameRenderer {
  private static readonly CAMERA_OUTSKIRTS_MARGIN = 1.5;
  private static readonly CAMERA_MIN_HEIGHT = 8.5;
  private readonly engine: Engine;
  private readonly map: MapDefinition;
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly highlight;
  private readonly arenaArt: WinterArenaArt;
  private gridLines?: LinesMesh;
  private isBuildModeVisual = false;
  private buildVisualUntil = 0;
  private readonly highlightOutline;
  private readonly selectionMaterial: StandardMaterial;
  private readonly selectedTowerRing: AbstractMesh;
  private readonly selectedTowerRingMaterial: StandardMaterial;
  private readonly selectedTowerMarker: AbstractMesh;
  private readonly selectedTowerMarkerMaterial: StandardMaterial;
  private readonly rangeMaterial: StandardMaterial;
  private readonly circularRangeMarker: AbstractMesh;
  private readonly adjacentRangeMarkers: AbstractMesh[] = [];
  private readonly allyAccentMaterial: StandardMaterial;
  private readonly shadowGenerator: ShadowGenerator;
  private readonly enemyFactory: EnemyMeshFactory;
  private readonly quaterniusEnemyFactory: QuaterniusEnemyFactory;
  private readonly archerFactory: ArcherMeshFactory;
  private readonly quaterniusFactory: QuaterniusArcherFactory;
  private readonly blueWizardFactory: BlueWizardFactory;
  private readonly holyKnightFactory: HolyKnightFactory;
  private readonly quaterniusDefenderFactory: QuaterniusDefenderFactory;
  private readonly enemyVisuals = new Map<number, EnemyVisual>();
  private readonly enemyVisualDebug = new URLSearchParams(window.location.search).get("enemyVisualDebug") === "1";
  private readonly enemyGroundDebug = new URLSearchParams(window.location.search).get("enemyGroundDebug") === "1";
  private readonly enemyVisualDebugReportedTypes = new Set<EnemyType>();
  private readonly enemyVisualDebugLabels = new Map<number, Mesh>();
  private readonly enemyVisualDebugMaterials = new Map<string, StandardMaterial>();
  private enemyGroundDebugMaterial?: StandardMaterial;
  private readonly towerVisuals = new Map<number, TowerVisual>();
  private readonly combatEffects: CombatEffects3D;
  private readonly simulationClock = new SimulationClock();
  private readonly environmentAssets: EnvironmentAssetLibrary;
  private readonly inputAbortController = new AbortController();
  private readonly pendingInitialization: Promise<void>[] = [];
  private readonly sky: HemisphericLight;
  private readonly themeProps: TransformNode[] = [];
  private readonly presentationSeed = createPresentationSeed();
  private readonly environmentSafeMode = new URLSearchParams(window.location.search).get("environmentSafeMode") === "1";
  private readonly shouldDumpSceneMeshes = new URLSearchParams(window.location.search).get("dumpSceneMeshes") === "1";
  private readonly disableEnemyVisuals = new URLSearchParams(window.location.search).get("disableEnemyVisuals") === "1";
  private readonly disableEnemyAnimations = new URLSearchParams(window.location.search).get("disableEnemyAnimations") === "1";
  private readonly disableCombatEffects = new URLSearchParams(window.location.search).get("disableCombatEffects") === "1";
  private readonly disableEnemyShadows = new URLSearchParams(window.location.search).get("disableEnemyShadows") === "1";
  private readonly disableHpBars = new URLSearchParams(window.location.search).get("disableHpBars") === "1";
  private readonly disableEnvironmentProps = new URLSearchParams(window.location.search).get("disableEnvironmentProps") === "1";
  private readonly perfDebug = new URLSearchParams(window.location.search).get("perfDebug") === "1";
  // Dynamic skinned shadows are opt-in. They were disproportionately expensive
  // compared with their small visual contribution on mobile.
  private readonly enemyShadowsEnabled = new URLSearchParams(window.location.search).get("enemyShadows") === "1"
    && !this.disableEnemyShadows;
  private readonly waveDebug = new URLSearchParams(window.location.search).get("waveDebug") === "1";
  private currentTheme: EnvironmentTheme;
  private themeRunOrdinal = 0;
  private environmentReady = false;
  private wasGameOver = false;
  private firstEnemyCameraLogged = false;
  private playableGroundMaterial?: StandardMaterial;
  private outskirtsGroundMaterial?: StandardMaterial;
  private spawnAccentMaterial?: StandardMaterial;
  private exitAccentMaterial?: StandardMaterial;
  private spawnZoneMaterial?: StandardMaterial;
  private exitZoneMaterial?: StandardMaterial;
  private readonly spawnLights: PointLight[] = [];
  private exitLight?: PointLight;
  private gameState?: GameState;
  private selectedTowerId?: number;
  private buildDefenderType: DefenderType = "blue-wizard";
  private onTowerSelectionChange?: (towerId?: number) => void;
  private lastFrameTime = performance.now();
  private lastValidCameraState: CameraState;
  private gesture?: { pointerId: number; startX: number; startY: number; pointerType: string; dragging: boolean; multiTouch: boolean; panAnchor?: Vector3; startTarget?: Vector3 };
  private readonly activePointers = new Map<number, PointerPoint>();
  private pinchDistance = 0;
  private readonly inputDebug = new URLSearchParams(window.location.search).get("inputDebug") === "1";
  private readonly minimapDebug = new URLSearchParams(window.location.search).get("minimapDebug") === "1";
  private inputDebugOverlay?: HTMLPreElement;
  private inputGestureLabel = "IDLE";
  private inputMovementDistance = 0;
  private inputCellLabel = "—";
  private inputLastAction = "Waiting for battlefield input";
  private cameraDebugOverlay?: HTMLPreElement;
  private readonly cameraDebug = new URLSearchParams(window.location.search).get("cameraDebug") === "1";
  private lastCameraGestureAt = 0;
  private lastPreviewCellKey = "";
  private readonly frameTimeSamples: number[] = [];
  private perfOverlay?: HTMLPreElement;
  private lastPerfOverlayAt = 0;
  private lastEnemyStatsAt = 0;
  private lastMidWaveSnapshotAt = 0;
  private previousWaveActive = false;
  private simulationTimeSeconds = 0;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, map: MapDefinition = MAPS["single-spawn"]) {
    this.map = map;
    this.currentTheme = themeForRun(this.presentationSeed);
    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor.set(0.08, 0.12, 0.16, 1);
    const center = new Vector3(this.map.width / 2, 0, this.map.height / 2);
    this.camera = new ArcRotateCamera("rtsCamera", VISUAL_CONFIG.defaultCameraAlpha, VISUAL_CONFIG.defaultCameraBeta, VISUAL_CONFIG.defaultCameraRadius, center, this.scene);
    this.camera.lowerAlphaLimit = VISUAL_CONFIG.defaultCameraAlpha; this.camera.upperAlphaLimit = VISUAL_CONFIG.defaultCameraAlpha;
    this.camera.lowerBetaLimit = VISUAL_CONFIG.defaultCameraBeta; this.camera.upperBetaLimit = VISUAL_CONFIG.defaultCameraBeta;
    this.camera.lowerRadiusLimit = VISUAL_CONFIG.minCameraRadius; this.camera.upperRadiusLimit = VISUAL_CONFIG.maxCameraRadius;
    // Do not attach Babylon's ArcRotate controls: its defaults orbit/pan unpredictably across pointer types.
    this.camera.computeWorldMatrix();
    this.lastValidCameraState = this.captureCameraState();
    this.sky = new HemisphericLight("sky", new Vector3(0, 1, 0), this.scene); this.sky.intensity = VISUAL_CONFIG.ambientIntensity; this.sky.groundColor = new Color3(0.11, 0.15, 0.2);
    const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, 0.35), this.scene); sun.position = new Vector3(15, 30, -10); sun.intensity = VISUAL_CONFIG.directionalIntensity;
    this.shadowGenerator = new ShadowGenerator(1024, sun); this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.enemyFactory = new EnemyMeshFactory(this.scene, this.shadowGenerator, this.enemyShadowsEnabled);
    this.quaterniusEnemyFactory = new QuaterniusEnemyFactory(this.scene, this.shadowGenerator, this.enemyShadowsEnabled);
    this.archerFactory = new ArcherMeshFactory(this.scene, this.shadowGenerator);
    this.quaterniusFactory = new QuaterniusArcherFactory(this.scene, this.shadowGenerator);
    this.blueWizardFactory = new BlueWizardFactory(this.scene, this.shadowGenerator);
    this.holyKnightFactory = new HolyKnightFactory(this.scene, this.shadowGenerator);
    this.quaterniusDefenderFactory = new QuaterniusDefenderFactory(this.scene, this.shadowGenerator);
    this.combatEffects = new CombatEffects3D(this.scene);
    this.environmentAssets = new EnvironmentAssetLibrary(this.scene, this.shadowGenerator);
    this.arenaArt = new WinterArenaArt(this.scene, this.environmentAssets, this.shadowGenerator, this.map.width, this.map.height);
    this.applyThemeMaterials();
    this.pendingInitialization.push(this.blueWizardFactory.load().then(() => {
      if (!this.disposed) this.rebuildTowerVisuals();
    }).catch((error: unknown) => {
      if (this.disposed) return;
      console.warn("Blue Wizard failed to load; loading the existing Quaternius archer fallback.", error);
      return this.quaterniusFactory.load().then(() => {
        if (!this.disposed) this.rebuildTowerVisuals();
      }).catch((fallbackError: unknown) => {
        if (!this.disposed) console.warn("Quaternius ranger fallback failed to load; using primitive archer.", fallbackError);
      });
    }));
    this.pendingInitialization.push(this.holyKnightFactory.load().then(() => {
      if (!this.disposed) this.rebuildTowerVisuals();
    }).catch((error: unknown) => {
      if (this.disposed) return;
      console.warn("Holy Knight failed to load; using the existing ranger fallback.", error);
      return this.quaterniusFactory.load().then(() => {
        if (!this.disposed) this.rebuildTowerVisuals();
      }).catch((fallbackError: unknown) => {
        if (!this.disposed) console.warn("Quaternius ranger fallback failed to load for Holy Knight.", fallbackError);
      });
    }));
    this.pendingInitialization.push(this.quaterniusDefenderFactory.load().then(() => {
      if (!this.disposed) this.rebuildTowerVisuals();
    }).catch((error: unknown) => {
      if (!this.disposed) console.warn("New defender GLBs failed to load; using existing presentation fallback.", error);
    }));
    this.pendingInitialization.push(this.quaterniusEnemyFactory.load().then(() => {
      if (this.disposed) return;
      for (const visual of this.enemyVisuals.values()) this.disposeEnemyVisual(visual);
      this.enemyVisuals.clear();
      for (const label of this.enemyVisualDebugLabels.values()) label.dispose();
      this.enemyVisualDebugLabels.clear();
      if (this.enemyVisualDebug) {
        const debugWindow = window as Window & { __enemyVisualDebugLabels?: Record<number, string> };
        debugWindow.__enemyVisualDebugLabels = {};
      }
    }).catch((error: unknown) => {
      if (!this.disposed) console.warn("Quaternius enemy failed to load; using primitive goblin fallback.", error);
    }));
    this.createGroundAndGrid();
    this.pendingInitialization.push(this.createArenaArt());
    this.highlight = MeshBuilder.CreateGround("selection", { width: 0.92, height: 0.92 }, this.scene);
    this.selectionMaterial = new StandardMaterial("selectionMaterial", this.scene);
    this.selectionMaterial.diffuseColor = VISUAL_CONFIG.validPlacementColor;
    this.selectionMaterial.emissiveColor = VISUAL_CONFIG.validPlacementColor.scale(0.22);
    this.selectionMaterial.alpha = VISUAL_CONFIG.placementAlpha;
    this.highlight.material = this.selectionMaterial; this.highlight.position.y = 0.021; this.highlight.isVisible = false;
    this.rangeMaterial = new StandardMaterial("tower-range-material", this.scene);
    this.rangeMaterial.diffuseColor = new Color3(0.95, 0.78, 0.32);
    this.rangeMaterial.emissiveColor = new Color3(0.38, 0.28, 0.08);
    this.rangeMaterial.alpha = 0.14;
    this.rangeMaterial.disableLighting = true;
    this.circularRangeMarker = MeshBuilder.CreateDisc("tower-circular-range", { radius: 1, tessellation: 48 }, this.scene);
    this.circularRangeMarker.rotation.x = Math.PI / 2;
    this.circularRangeMarker.position.y = 0.017;
    this.circularRangeMarker.material = this.rangeMaterial;
    this.circularRangeMarker.isPickable = false;
    this.circularRangeMarker.setEnabled(false);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const marker = MeshBuilder.CreateGround(`tower-adjacent-range-${dx}-${dy}`, {
          width: 0.94, height: 0.94,
        }, this.scene);
        marker.position.y = 0.018;
        marker.material = this.rangeMaterial;
        marker.isPickable = false;
        marker.setEnabled(false);
        this.adjacentRangeMarkers.push(marker);
      }
    }
    this.highlightOutline = MeshBuilder.CreateLines("selection-outline", {
      points: [
        new Vector3(-0.46, 0, -0.46), new Vector3(0.46, 0, -0.46),
        new Vector3(0.46, 0, 0.46), new Vector3(-0.46, 0, 0.46), new Vector3(-0.46, 0, -0.46),
      ],
    }, this.scene);
    this.highlightOutline.color = VISUAL_CONFIG.validPlacementColor;
    this.highlightOutline.position.y = 0.026;
    this.highlightOutline.isVisible = false;
    this.selectedTowerRing = MeshBuilder.CreateTorus("selected-tower-ring", {
      diameter: VISUAL_CONFIG.selectedTowerRingDiameter,
      thickness: VISUAL_CONFIG.selectedTowerRingThickness,
      tessellation: 48,
    }, this.scene);
    this.selectedTowerRing.rotation.x = Math.PI / 2;
    this.selectedTowerRing.position.y = 0.045;
    this.selectedTowerRing.isPickable = false;
    this.selectedTowerRing.isVisible = false;
    this.selectedTowerRingMaterial = new StandardMaterial("selected-tower-ring-material", this.scene);
    this.selectedTowerRingMaterial.diffuseColor.copyFrom(VISUAL_CONFIG.selectedTowerRingColor);
    this.selectedTowerRingMaterial.emissiveColor.copyFrom(VISUAL_CONFIG.selectedTowerRingColor);
    this.selectedTowerRingMaterial.disableLighting = true;
    this.selectedTowerRingMaterial.alpha = VISUAL_CONFIG.selectedTowerRingBaseAlpha;
    this.selectedTowerRing.material = this.selectedTowerRingMaterial;
    // A single reusable, non-pickable diamond makes selected defenders readable
    // even when their ground ring is partially hidden by dense neighboring units.
    this.selectedTowerMarker = MeshBuilder.CreatePolyhedron("selected-tower-marker", {
      type: 1,
      size: VISUAL_CONFIG.selectedTowerMarkerSize,
    }, this.scene);
    this.selectedTowerMarker.isPickable = false;
    this.selectedTowerMarker.isVisible = false;
    this.selectedTowerMarkerMaterial = new StandardMaterial("selected-tower-marker-material", this.scene);
    this.selectedTowerMarkerMaterial.diffuseColor.copyFrom(VISUAL_CONFIG.selectedTowerRingColor);
    this.selectedTowerMarkerMaterial.emissiveColor.copyFrom(VISUAL_CONFIG.selectedTowerRingColor);
    this.selectedTowerMarkerMaterial.disableLighting = true;
    this.selectedTowerMarkerMaterial.alpha = 0.96;
    this.selectedTowerMarker.material = this.selectedTowerMarkerMaterial;
    this.allyAccentMaterial = new StandardMaterial("allyFactionAccent", this.scene);
    this.allyAccentMaterial.diffuseColor = VISUAL_CONFIG.allyAccentColor;
    this.allyAccentMaterial.emissiveColor = VISUAL_CONFIG.allyAccentColor.scale(0.32);
    this.allyAccentMaterial.alpha = 0.72;
    this.installGestureInput();
    if (this.inputDebug) this.createInputDebugOverlay();
    if (this.cameraDebug) this.createCameraDebugOverlay();
    if (this.perfDebug) this.createPerformanceOverlay();
    window.addEventListener("resize", () => this.engine.resize(), { signal: this.inputAbortController.signal });
  }

  /** Babylon render loop; GameState remains the sole gameplay owner. */
  start(
    gameState: GameState,
    onSync?: (state: GameState) => void,
    onSelectionChange?: (towerId?: number) => void,
  ): void {
    if (this.disposed) return;
    this.gameState = gameState;
    this.onTowerSelectionChange = onSelectionChange;
    if (this.waveDebug) {
      const debugWindow = window as Window & { __combatVisualDebug?: () => {
        projectiles: number; arcaneProjectiles: number; arcaneBursts: number;
        totalArcaneProjectiles: number; totalArcaneBursts: number;
      } };
      debugWindow.__combatVisualDebug = () => ({
        projectiles: this.combatEffects.activeProjectileCount,
        arcaneProjectiles: this.combatEffects.activeArcaneProjectileCount,
        arcaneBursts: this.combatEffects.activeArcaneBurstCount,
        totalArcaneProjectiles: this.combatEffects.totalArcaneProjectilesCreated,
        totalArcaneBursts: this.combatEffects.totalArcaneBurstsCreated,
      });
    }
    console.log("GameState bridge active");
    this.engine.runRenderLoop(() => {
      const now = performance.now();
      const realDeltaSeconds = Math.min((now - this.lastFrameTime) / 1000, 0.1);
      this.frameTimeSamples.push(realDeltaSeconds * 1000);
      if (this.frameTimeSamples.length > 120) this.frameTimeSamples.shift();
      const simulationDeltaSeconds = this.simulationClock.toSimulationDelta(realDeltaSeconds);
      if (!this.simulationClock.isPaused) gameState.update(simulationDeltaSeconds, realDeltaSeconds);
      this.simulationTimeSeconds += simulationDeltaSeconds;
      this.lastFrameTime = now;
      this.sync(gameState, simulationDeltaSeconds, !this.simulationClock.isPaused);
      this.updateBuildVisual(now, realDeltaSeconds);
      this.enforceCameraSafety();
      this.updateCameraDebugOverlay();
      onSync?.(gameState);
      this.scene.render();
      this.updatePerformanceDebug(gameState, now);
    });
  }

  getGameSpeedMultiplier(): GameSpeedMultiplier { return this.simulationClock.speedMultiplier; }
  isPaused(): boolean { return this.simulationClock.isPaused; }
  setPaused(paused: boolean): void { this.simulationClock.setPaused(paused); }

  /** Projects the actual screen corners onto the ground, then maps those points to logical grid space. */
  getApproximateMinimapView(): MinimapCameraView {
    const renderWidth = this.engine.getRenderWidth();
    const renderHeight = this.engine.getRenderHeight();
    const screenCorners = [
      [0, 0], [renderWidth, 0], [renderWidth, renderHeight], [0, renderHeight],
    ] as const;
    const groundCorners = screenCorners
      .map(([x, y]) => this.groundPointAtRenderPoint(x, y))
      .filter((point): point is Vector3 => point !== undefined)
      .map(({ x, z }) => ({ x, z }));
    const center = this.groundPointAtRenderPoint(renderWidth / 2, renderHeight / 2) ?? this.camera.target;
    const logicalCenter = groundPointToLogicalMap(center, TILE_SIZE_3D);
    // If a backend cannot intersect one of the viewport rays with the ground plane,
    // show the whole logical map rather than inventing a potentially mirrored box.
    const bounds = groundCorners.length === screenCorners.length
      ? groundFootprintToLogicalBounds(groundCorners, TILE_SIZE_3D)
      : { x: 0, y: 0, width: this.map.width, height: this.map.height };
    return {
      ...bounds,
      cameraTargetWorldX: this.camera.target.x,
      cameraTargetWorldZ: this.camera.target.z,
      centerGridX: logicalCenter.x,
      centerGridY: logicalCenter.y,
    };
  }

  /** Debug-only camera positioning for reproducible top/center/bottom minimap checks. */
  setMinimapDebugTarget(logicalGridX: number, logicalGridY: number): boolean {
    if (!this.minimapDebug || !Number.isFinite(logicalGridX) || !Number.isFinite(logicalGridY)) return false;
    this.camera.target.x = logicalGridX * TILE_SIZE_3D;
    this.camera.target.z = logicalGridY * TILE_SIZE_3D;
    this.clampCameraToMap();
    this.camera.computeWorldMatrix();
    return true;
  }

  getMinimapDebugState(): { targetWorld: { x: number; z: number }; logicalCenter: { x: number; y: number }; view: MinimapCameraView; map: { width: number; height: number } } {
    const view = this.getApproximateMinimapView();
    return {
      targetWorld: { x: this.camera.target.x, z: this.camera.target.z },
      logicalCenter: { x: view.centerGridX!, y: view.centerGridY! },
      view,
      map: { width: this.map.width, height: this.map.height },
    };
  }

  /** Releases renderer resources and global input listeners before changing maps. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.inputAbortController.abort();
    this.engine.stopRenderLoop();
    this.activePointers.clear();
    this.gesture = undefined;
    this.onTowerSelectionChange = undefined;

    // Let in-flight GLB/environment loads settle while the scene still exists,
    // then release their templates before destroying the WebGL engine.
    await Promise.allSettled(this.pendingInitialization);
    this.combatEffects.clear();
    for (const visual of this.towerVisuals.values()) this.disposeTowerVisual(visual);
    this.towerVisuals.clear();
    for (const visual of this.enemyVisuals.values()) this.disposeEnemyVisual(visual);
    this.enemyVisuals.clear();
    for (const label of this.enemyVisualDebugLabels.values()) label.dispose();
    this.enemyVisualDebugLabels.clear();
    this.environmentAssets.dispose();
    this.blueWizardFactory.dispose();
    this.holyKnightFactory.dispose();
    this.quaterniusFactory.dispose();
    this.quaterniusDefenderFactory.dispose();
    this.quaterniusEnemyFactory.dispose();
    this.inputDebugOverlay?.remove();
    this.cameraDebugOverlay?.remove();
    this.perfOverlay?.remove();
    this.scene.dispose();
    this.engine.dispose();
  }

  setBuildDefenderType(type: DefenderType): void {
    this.buildDefenderType = type;
  }

  /** Keeps renderer and UI selection in sync for pointer input and explicit UI deselection. */
  selectTower(towerId?: number): void {
    const exists = towerId === undefined || this.gameState?.towers.some((tower) => tower.id === towerId);
    this.selectedTowerId = exists ? towerId : undefined;
    if (this.selectedTowerId === undefined) {
      this.selectedTowerRing.isVisible = false;
      this.selectedTowerMarker.isVisible = false;
    }
    this.onTowerSelectionChange?.(this.selectedTowerId);
  }

  getSelectionVisualDebug(): {
    selectedTowerId?: number;
    visible: boolean;
    diameter: number;
    center: { x: number; z: number };
    markerVisible: boolean;
    markerPosition: { x: number; y: number; z: number };
  } {
    return {
      selectedTowerId: this.selectedTowerId,
      visible: this.selectedTowerRing.isVisible,
      diameter: VISUAL_CONFIG.selectedTowerRingDiameter,
      center: { x: this.selectedTowerRing.position.x, z: this.selectedTowerRing.position.z },
      markerVisible: this.selectedTowerMarker.isVisible,
      markerPosition: {
        x: this.selectedTowerMarker.position.x,
        y: this.selectedTowerMarker.position.y,
        z: this.selectedTowerMarker.position.z,
      },
    };
  }

  /** Debug-only callers use this to drive precise touch-picking smoke tests. */
  getCellClientPosition(cell: { x: number; y: number }): { x: number; y: number } {
    const point = gridToWorld3D(cell);
    const renderWidth = this.engine.getRenderWidth();
    const renderHeight = this.engine.getRenderHeight();
    const viewport = this.camera.viewport.toGlobal(renderWidth, renderHeight);
    const projected = Vector3.Project(
      new Vector3(point.x, 0, point.z),
      Matrix.Identity(),
      this.scene.getTransformMatrix(),
      viewport,
    );
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: bounds.left + projected.x / renderWidth * bounds.width,
      y: bounds.top + projected.y / renderHeight * bounds.height,
    };
  }

  /** Optional input telemetry for mobile smoke tests; it never feeds gameplay. */
  getInputDebugState(): {
    pointerCount: number;
    gesture: string;
    movementDistance: number;
    selectedCell: string;
    buildMode: string;
    lastAction: string;
    cameraRadius: number;
    cameraTarget: { x: number; z: number };
  } {
    return {
      pointerCount: this.activePointers.size,
      gesture: this.inputGestureLabel,
      movementDistance: Number(this.inputMovementDistance.toFixed(1)),
      selectedCell: this.inputCellLabel,
      buildMode: this.gameState?.waveActive ? `LOCKED · ${this.buildDefenderType}` : this.buildDefenderType,
      lastAction: this.inputLastAction,
      cameraRadius: Number(this.camera.radius.toFixed(2)),
      cameraTarget: { x: Number(this.camera.target.x.toFixed(2)), z: Number(this.camera.target.z.toFixed(2)) },
    };
  }

  toggleGameSpeed(): GameSpeedMultiplier {
    const multiplier = this.simulationClock.toggleSpeed();
    return multiplier;
  }

  togglePause(): boolean {
    const paused = this.simulationClock.togglePause();
    return paused;
  }

  /** Presentation reset paired with GameState.resetGame; no scene or page reload. */
  resetRunPresentation(): void {
    this.simulationClock.reset();
    this.combatEffects.clear();
    this.selectTower(undefined);
    this.selectedTowerRing.isVisible = false;
    this.selectedTowerMarker.isVisible = false;
    this.highlight.isVisible = false;
    this.highlightOutline.isVisible = false;
    this.lastPreviewCellKey = "";
    this.buildVisualUntil = 0;
    this.wasGameOver = false;
    this.resetCameraView();
    void this.selectNextEnvironmentTheme();
  }

  /** Mirrors portable Enemy state into Babylon meshes without changing gameplay state. */
  sync(gameState: GameState, deltaSeconds = 0, processAttackEvents = true): void {
    if (!gameState.waveActive && gameState.enemies.length === 0) this.firstEnemyCameraLogged = false;
    if (this.wasGameOver && !gameState.gameOver) {
      this.highlight.isVisible = false;
      this.highlightOutline.isVisible = false;
      this.lastPreviewCellKey = "";
      this.resetCameraView();
      void this.selectNextEnvironmentTheme();
    }
    this.wasGameOver = gameState.gameOver;
    this.syncTowers(gameState);
    this.updateSelectedTowerRange(gameState);
    this.updateSelectedTowerIndicator(gameState);
    const activeIds = new Set<number>();
    for (const enemy of gameState.enemies) {
      if (!enemy.alive) continue;
      activeIds.add(enemy.id);
      if (this.disableEnemyVisuals) continue;
      let visual = this.enemyVisuals.get(enemy.id);
      if (!visual) {
        const waitingForImportedEnemy = !this.quaterniusEnemyFactory.hasTemplate(enemy.type)
          && !this.quaterniusEnemyFactory.isLoadCompleted;
        // Do not disguise an in-flight model load as a permanent placeholder.
        // Once preload resolves, a real GLB is used or the failure is reported.
        if (waitingForImportedEnemy) continue;
        let usedFallback = true;
        let fallbackReason = "GLB template is not loaded";
        if (this.quaterniusEnemyFactory.hasTemplate(enemy.type)) {
          try {
            visual = this.quaterniusEnemyFactory.create(enemy.id, enemy.type);
            if (visual) usedFallback = false;
          } catch (error) {
            fallbackReason = error instanceof Error ? error.message : String(error);
            this.quaterniusEnemyFactory.reportFallback(enemy.type, fallbackReason);
          }
          if (!visual) {
            fallbackReason = "model instantiation or bounds validation failed";
            this.quaterniusEnemyFactory.reportFallback(enemy.type, fallbackReason);
          }
        }
        if (!visual && this.quaterniusEnemyFactory.isLoadCompleted) {
          this.quaterniusEnemyFactory.reportFallback(enemy.type, fallbackReason);
        }
        visual ??= this.enemyFactory.create(enemy.id, enemy.type);
        this.enemyVisuals.set(enemy.id, visual);
        if (this.enemyGroundDebug) this.addEnemyGroundMarker(visual.root, enemy.id);
        this.reportEnemyVisualSpawn(enemy.id, enemy.type, usedFallback);
        if (this.enemyVisualDebug && (enemy.type === "ghoul" || enemy.type === "wraith")) {
          this.createEnemyVisualDebugLabel(enemy.id, enemy.type, usedFallback, visual.root);
        }
        if (!this.firstEnemyCameraLogged) {
          this.firstEnemyCameraLogged = true;
          this.logCameraState(`AFTER first enemy visual ${enemy.id} created`);
          if (this.waveDebug) this.scene.onAfterRenderObservable.addOnce(() => this.dumpRuntimeMeshes());
        }
      }
      this.updateEnemyVisual(visual, enemy);
    }
    for (const [id, visual] of this.enemyVisuals) {
      if (activeIds.has(id)) continue;
      this.disposeEnemyVisual(visual);
      this.enemyVisuals.delete(id);
      this.enemyVisualDebugLabels.get(id)?.dispose();
      this.enemyVisualDebugLabels.delete(id);
      if (this.enemyVisualDebug) {
        const debugWindow = window as Window & { __enemyVisualDebugLabels?: Record<number, string> };
        if (debugWindow.__enemyVisualDebugLabels) delete debugWindow.__enemyVisualDebugLabels[id];
      }
    }
    if (processAttackEvents) this.syncCombatEvents(gameState);
    this.combatEffects.update(deltaSeconds);
    if (!gameState.waveActive && gameState.towers.length === 0 && gameState.enemies.length === 0) this.combatEffects.clear();
    this.updateEnemyVisualStats(gameState);
  }

  private addEnemyGroundMarker(root: TransformNode, id: number): void {
    this.enemyGroundDebugMaterial ??= new StandardMaterial("enemy-ground-debug-material", this.scene);
    this.enemyGroundDebugMaterial.diffuseColor = new Color3(0.25, 1, 0.8);
    this.enemyGroundDebugMaterial.emissiveColor = new Color3(0.1, 0.55, 0.4);
    this.enemyGroundDebugMaterial.disableLighting = true;
    const marker = MeshBuilder.CreateTorus(`enemy-ground-contact-${id}`, { diameter: 0.68, thickness: 0.025, tessellation: 20 }, this.scene);
    marker.parent = root;
    marker.position.y = -0.012;
    marker.rotation.x = Math.PI / 2;
    marker.material = this.enemyGroundDebugMaterial;
    marker.isPickable = false;
  }

  private updateEnemyVisualStats(gameState: GameState): void {
    if (!this.waveDebug || performance.now() - this.lastEnemyStatsAt < 1000) return;
    this.lastEnemyStatsAt = performance.now();
    const visibleByType: Record<EnemyType, number> = { goblin: 0, goblinBrute: 0, goblinRider: 0, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 0, skeletonKing: 0, skeletalCommander: 0 };
    const trianglesByType: Record<EnemyType, number> = { goblin: 0, goblinBrute: 0, goblinRider: 0, giantGoblin: 0, ghoul: 0, wraith: 0, undeadDragon: 0, skeletonKing: 0, skeletalCommander: 0 };
    let modelMeshCount = 0;
    for (const enemy of gameState.enemies) {
      if (!enemy.alive || !this.enemyVisuals.has(enemy.id)) continue;
      visibleByType[enemy.type] += 1;
      const visual = this.enemyVisuals.get(enemy.id)!;
      for (const mesh of visual.root.getChildMeshes()) {
        if (mesh.getTotalVertices() <= 0 || mesh.name.includes("enemy-health-")) continue;
        modelMeshCount += 1;
        trianglesByType[enemy.type] += (mesh.getTotalIndices() ?? 0) / 3;
      }
    }
    const frameTimeMs = this.frameTimeSamples.length > 0
      ? this.frameTimeSamples.reduce((sum, value) => sum + value, 0) / this.frameTimeSamples.length
      : 0;
    const debugWindow = window as Window & { __enemySceneStats?: object };
    debugWindow.__enemySceneStats = {
      sceneMeshes: this.scene.meshes.length,
      enemyVisuals: this.enemyVisuals.size,
      visibleByType,
      modelMeshCount,
      trianglesByType,
      totalEnemyTriangles: Object.values(trianglesByType).reduce((sum, value) => sum + value, 0),
      totalSceneTriangles: this.scene.meshes.reduce((sum, mesh) => sum + (mesh.getTotalIndices() ?? 0) / 3, 0),
      activeSceneMeshes: this.scene.getActiveMeshes().length,
      activeSceneTriangles: this.scene.getActiveIndices() / 3,
      fps: Math.round(this.engine.getFps()),
      frameTimeMs: Number(frameTimeMs.toFixed(2)),
      skeletons: this.scene.skeletons.length,
      animationGroups: this.scene.animationGroups.length,
      cachedModels: this.quaterniusEnemyFactory.cachedModelCount,
    };
  }

  private syncTowers(gameState: GameState): void {
    if (this.selectedTowerId !== undefined && !gameState.towers.some((tower) => tower.id === this.selectedTowerId)) {
      this.selectTower(undefined);
    }
    const activeIds = new Set<number>();
    for (const tower of gameState.towers) {
      activeIds.add(tower.id);
      const existing = this.towerVisuals.get(tower.id);
      if (existing?.level === tower.level) {
        existing.bodyRoot.position.y = Math.sin(performance.now() * 0.002 + tower.id) * 0.012;
      } else {
        if (existing) this.disposeTowerVisual(existing);
        this.towerVisuals.set(tower.id, this.createTowerVisual(tower));
      }
    }
    for (const [id, visual] of this.towerVisuals) {
      if (activeIds.has(id)) continue;
      this.disposeTowerVisual(visual);
      this.towerVisuals.delete(id);
    }
  }

  private updateSelectedTowerRange(gameState: GameState): void {
    const selected = gameState.towers.find((tower) => tower.id === this.selectedTowerId);
    const showCircle = selected?.rangeMode === "circular" || selected?.rangeMode === "hybrid";
    this.circularRangeMarker.setEnabled(showCircle);
    if (showCircle && selected) {
      const point = gridToWorld3D(selected.cell);
      this.circularRangeMarker.position.x = point.x;
      this.circularRangeMarker.position.z = point.z;
      const radiusInTiles = selected.range / WORLD_UNITS_PER_CELL;
      this.circularRangeMarker.scaling.set(radiusInTiles, radiusInTiles, 1);
    }

    let markerIndex = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const marker = this.adjacentRangeMarkers[markerIndex++];
        const visible = selected?.rangeMode === "adjacent8" || selected?.rangeMode === "hybrid";
        marker.setEnabled(visible);
        if (!visible || !selected) continue;
        const point = gridToWorld3D({ x: selected.cell.x + dx, y: selected.cell.y + dy });
        marker.position.x = point.x;
        marker.position.z = point.z;
      }
    }
  }

  private updateSelectedTowerIndicator(gameState: GameState): void {
    const selected = gameState.towers.find((tower) => tower.id === this.selectedTowerId);
    if (!selected) {
      this.selectedTowerRing.isVisible = false;
      this.selectedTowerMarker.isVisible = false;
      return;
    }
    const point = gridToWorld3D(selected.cell);
    this.selectedTowerRing.position.set(point.x, 0.045, point.z);
    const phase = (performance.now() / 1000) * (Math.PI * 2 / VISUAL_CONFIG.selectedTowerRingPulseSeconds);
    const pulse = Math.sin(phase);
    this.selectedTowerRingMaterial.alpha = VISUAL_CONFIG.selectedTowerRingBaseAlpha
      + VISUAL_CONFIG.selectedTowerRingPulseAlpha * pulse;
    this.selectedTowerRingMaterial.emissiveColor.copyFrom(
      VISUAL_CONFIG.selectedTowerRingColor.scale(0.95 + (pulse + 1) * 0.12),
    );
    this.selectedTowerRing.isVisible = true;

    const towerVisual = this.towerVisuals.get(selected.id);
    let modelTopY = Number.NEGATIVE_INFINITY;
    if (towerVisual) {
      towerVisual.root.computeWorldMatrix(true);
      for (const mesh of towerVisual.root.getChildMeshes(false)) {
        mesh.computeWorldMatrix(true);
        modelTopY = Math.max(modelTopY, mesh.getBoundingInfo().boundingBox.maximumWorld.y);
      }
    }
    if (!Number.isFinite(modelTopY)) {
      modelTopY = VISUAL_CONFIG.selectedTowerMarkerFallbackHeight;
    }
    this.selectedTowerMarker.position.set(
      point.x,
      modelTopY + VISUAL_CONFIG.selectedTowerMarkerOffset
        + Math.sin(phase * 1.5) * VISUAL_CONFIG.selectedTowerMarkerBobAmplitude,
      point.z,
    );
    this.selectedTowerMarker.rotation.y = phase * 0.35;
    const markerScale = 1 + pulse * 0.07;
    this.selectedTowerMarker.scaling.setAll(markerScale);
    this.selectedTowerMarkerMaterial.emissiveColor.copyFrom(
      VISUAL_CONFIG.selectedTowerRingColor.scale(0.9 + (pulse + 1) * 0.12),
    );
    this.selectedTowerMarker.isVisible = true;
  }

  private syncCombatEvents(gameState: GameState): void {
    if (this.disableCombatEffects) return;
    for (const event of gameState.attackEvents) {
      const tower = this.towerVisuals.get(event.towerId);
      if (!tower) continue;
      const target = gridToWorld3D({ x: event.targetX, y: event.targetY });
      const targetPosition = new Vector3(target.x, 0.82, target.z);
      if (event.isSplash) {
        this.combatEffects.showSplashHit(targetPosition);
        continue;
      }
      const desiredRotation = Math.atan2(target.x - tower.root.position.x, target.z - tower.root.position.z);
      const rotationDelta = Math.atan2(Math.sin(desiredRotation - tower.bodyRoot.rotation.y), Math.cos(desiredRotation - tower.bodyRoot.rotation.y));
      tower.bodyRoot.rotation.y += rotationDelta * 0.6;
      tower.bodyRoot.computeWorldMatrix(true);
      if (event.defenderType === "holy-knight") {
        this.combatEffects.showMeleeHit(targetPosition, event.enemyDied);
        continue;
      }
      const attackOrigin = "attackOrigin" in tower ? tower.attackOrigin : "arrowOrigin" in tower ? tower.arrowOrigin : undefined;
      if (!attackOrigin) continue;
      const originPosition = attackOrigin.getAbsolutePosition();
      if (event.defenderType === "green-archer") {
        this.combatEffects.showShot(originPosition, targetPosition, event.enemyDied);
        continue;
      }
      if (event.defenderType === "battlemage" && event.attackMode === "melee") {
        this.combatEffects.showMeleeHit(targetPosition, event.enemyDied);
        continue;
      }
      // Skeletal ranger playback controls only the presentation release moment; GameState already dealt damage.
      if ("attack" in tower) tower.attack(() => this.combatEffects.showShot(
        originPosition, targetPosition, event.enemyDied,
      ));
      else if ("attackOrigin" in tower) this.combatEffects.showArcaneShot(
        originPosition, targetPosition, event.enemyDied,
      );
      else this.combatEffects.showShot(originPosition, targetPosition, event.enemyDied);
    }
  }

  private updateEnemyVisual(visual: EnemyVisual, enemy: GameState["enemies"][number]): void {
    const world = gridToWorld3D({ x: enemy.x, y: enemy.y });
    const walkTime = this.simulationTimeSeconds * 12 + enemy.id;
    const visualHeight = enemy.movementType === "flying"
      ? ENEMY_VISUAL_CONFIG[enemy.type].yOffset + Math.sin(walkTime) * 0.06
      : 0.015;
    visual.root.position.set(world.x, visualHeight, world.z);
    if ("leftArm" in visual) {
      visual.leftArm.rotation.z = Math.sin(walkTime) * 0.25;
      visual.rightArm.rotation.z = -Math.sin(walkTime) * 0.25;
    }

    const next = enemy.path[enemy.currentPathIndex + 1];
    if (next) visual.root.rotation.y = Math.atan2(next.x - enemy.x, next.y - enemy.y);

    if (this.disableHpBars) return;
    const hpRatio = Math.max(0, Math.min(1, enemy.hp / enemy.maxHp));
    const damaged = hpRatio < 0.999;
    if (visual.healthBack.isEnabled() !== damaged) {
      visual.healthBack.setEnabled(damaged);
      visual.healthFill.setEnabled(damaged);
    }
    if (Math.abs(visual.lastHpRatio - hpRatio) < 0.0001) return;
    visual.lastHpRatio = hpRatio;
    visual.healthFill.scaling.x = hpRatio;
    visual.healthFill.position.x = -0.34 + hpRatio * 0.34;
  }

  private reportEnemyVisualSpawn(id: number, type: EnemyType, fallback: boolean): void {
    if (!this.enemyVisualDebug || !this.quaterniusEnemyFactory.isLoadCompleted || this.enemyVisualDebugReportedTypes.has(type)) return;
    const config = ENEMY_VISUAL_CONFIG[type];
    const visual = this.enemyVisuals.get(id);
    const renderableMeshes = visual?.root.getChildMeshes(false).filter((mesh) => mesh.getTotalVertices() > 0) ?? [];
    const materials = [...new Set(renderableMeshes.flatMap((mesh) => mesh.material ? [mesh.material.name] : []))];
    const detail = {
      type,
      resolvedVisualConfigId: type,
      assetPath: config.assetPath,
      loadedAssetPath: this.quaterniusEnemyFactory.getLoadedAssetPath(type),
      optimized: this.quaterniusEnemyFactory.getLoadedAssetPath(type) === config.assetPath,
      fallback,
      factory: fallback ? "EnemyMeshFactory" : "QuaterniusEnemyFactory",
      instanceId: id,
      renderableMeshCount: renderableMeshes.length,
      materials,
    };
    this.enemyVisualDebugReportedTypes.add(type);
    console.info("Enemy visual spawn:", detail);
    const debugWindow = window as Window & { __enemyVisualSpawnAudit?: typeof detail[] };
    (debugWindow.__enemyVisualSpawnAudit ??= []).push(detail);
  }

  private createEnemyVisualDebugLabel(id: number, type: "ghoul" | "wraith", fallback: boolean, root: TransformNode): void {
    const status = fallback ? "FALLBACK" : "GLB";
    const materialKey = `${type}:${status}`;
    let material = this.enemyVisualDebugMaterials.get(materialKey);
    if (!material) {
      const texture = new DynamicTexture(`enemy-visual-debug-texture-${materialKey}`, { width: 240, height: 64 }, this.scene, false);
      texture.hasAlpha = true;
      texture.drawText(
        `${type.toUpperCase()}  ·  ${status}`,
        null,
        43,
        "bold 23px Arial",
        fallback ? "#ffc2b6" : "#c9ffe5",
        "#16212ddd",
        true,
      );
      material = new StandardMaterial(`enemy-visual-debug-material-${materialKey}`, this.scene);
      material.diffuseTexture = texture;
      material.opacityTexture = texture;
      material.emissiveColor = Color3.White();
      material.disableLighting = true;
      material.backFaceCulling = false;
      this.enemyVisualDebugMaterials.set(materialKey, material);
    }
    const label = MeshBuilder.CreatePlane(`enemy-visual-debug-label-${id}`, { width: 1.5, height: 0.4 }, this.scene);
    label.parent = root;
    label.position.y = ENEMY_VISUAL_CONFIG[type].hpBarOffsetY + 0.52;
    label.billboardMode = Mesh.BILLBOARDMODE_ALL;
    label.material = material;
    label.isPickable = false;
    this.enemyVisualDebugLabels.set(id, label);
    const debugWindow = window as Window & { __enemyVisualDebugLabels?: Record<number, string> };
    (debugWindow.__enemyVisualDebugLabels ??= {})[id] = `${type.toUpperCase()} · ${status}`;
  }

  private createGroundAndGrid(): void {
    const width = this.map.width * TILE_SIZE_3D; const depth = this.map.height * TILE_SIZE_3D;
    const outskirts = MeshBuilder.CreateGround("outskirts-ground", { width: width + 12, height: depth + 12, subdivisions: 1 }, this.scene);
    outskirts.position = new Vector3(width / 2, -0.035, depth / 2);
    const outskirtsMaterial = new StandardMaterial("outskirts-snow", this.scene);
    outskirtsMaterial.diffuseColor = Color3.White();
    outskirtsMaterial.diffuseTexture = this.arenaArt.outskirtsTexture(this.currentTheme);
    outskirtsMaterial.specularColor = Color3.Black();
    outskirts.material = outskirtsMaterial;
    this.outskirtsGroundMaterial = outskirtsMaterial;
    const ground = MeshBuilder.CreateGround("snowGround", { width, height: depth, subdivisions: 2 }, this.scene);
    ground.position = new Vector3(width / 2, 0, depth / 2);
    const snow = new StandardMaterial("snow", this.scene); snow.diffuseColor = this.currentTheme.playableGround; snow.specularColor = VISUAL_CONFIG.snowSpecularColor; snow.specularPower = VISUAL_CONFIG.snowSpecularPower; ground.material = snow; ground.receiveShadows = true;
    this.playableGroundMaterial = snow;
    snow.diffuseTexture = this.arenaArt.snowTexture();
    const lines: Vector3[][] = [];
    for (let x = 0; x <= this.map.width; x += 1) lines.push([new Vector3(x, 0.012, 0), new Vector3(x, 0.012, depth)]);
    for (let z = 0; z <= this.map.height; z += 1) lines.push([new Vector3(0, 0.012, z), new Vector3(width, 0.012, z)]);
    const gridColor = VISUAL_CONFIG.gridColor;
    const vertexColors = lines.map(line => line.map(() => new Color4(gridColor.r, gridColor.g, gridColor.b, 1)));
    // LinesMesh only blends alpha through vertex alpha; its visibility scalar alone
    // is ignored by its default material.
    const grid = MeshBuilder.CreateLineSystem("grid", { lines, colors: vertexColors, useVertexAlpha: true }, this.scene);
    grid.alpha = VISUAL_CONFIG.gridAlpha;
    grid.isPickable = false;
    grid.setEnabled(false);
    this.gridLines = grid;

    new TerrainCliffRenderer(this.scene).render(this.map.terrainRegions);
  }

  /** Places cached glTF environment art; a per-asset primitive remains only as a load-failure fallback. */
  private async createArenaArt(): Promise<void> {
    await this.environmentAssets.preload();
    if (this.disposed) return;
    this.arenaArt.perimeter([
      ...this.map.layout.activeSpawns.map(({ gateCell, side }) => ({ x: gateCell.x, z: gateCell.y, side })),
      { x: this.map.layout.castle.gateCell.x, z: this.map.layout.castle.gateCell.y, side: this.map.layout.castle.side },
    ]);
    this.arenaArt.warmOutskirtsAccents();
    const red = this.material("spawn-ember", new Color3(0.65, 0.12, 0.035), new Color3(0.5, 0.055, 0.012));
    const blue = this.material("exit-cyan", new Color3(0.13, 0.62, 0.8), new Color3(0.055, 0.35, 0.5));
    this.spawnAccentMaterial = red; this.exitAccentMaterial = blue;
    red.backFaceCulling = false; red.alpha = 0.36;
    blue.backFaceCulling = false; blue.alpha = 0.5;
    this.spawnZoneMaterial = this.material("spawn-zone-material", this.currentTheme.spawnAccent);
    for (const spawn of this.map.layout.activeSpawns) {
      const point = gridToWorld3D(spawn.entryCell);
      this.zoneMarker(`spawn-zone-${spawn.id}`, point.x, point.z, this.currentTheme.spawnAccent, this.spawnZoneMaterial);
      this.createEndpointVisual(`spawn-${spawn.id}`, point.x, point.z, red, this.currentTheme.spawnAccent, spawn.side);
    }
    const goal = gridToWorld3D(this.map.layout.castle.approachCell);
    this.exitZoneMaterial = this.zoneMarker("castle-zone", goal.x, goal.z, this.currentTheme.exitAccent);
    this.createEndpointVisual("exit", goal.x, goal.z, blue, this.currentTheme.exitAccent, this.map.layout.castle.side);
    this.environmentReady = true;
    if (!this.disableEnvironmentProps) this.rebuildThemeProps();
    if (this.environmentSafeMode) this.applyEnvironmentSafeMode();
    if (this.environmentSafeMode || this.shouldDumpSceneMeshes) {
      this.scene.onAfterRenderObservable.addOnce(() => this.dumpRuntimeMeshes());
    }
    console.info(`Environment theme: ${this.currentTheme.label}`, { seed: this.presentationSeed + this.themeRunOrdinal });
  }

  private applyEnvironmentSafeMode(): void {
    const coreEnvironment = /^(snowGround|outskirts-ground|ice-patch-|snow-drift-|grid|map-wall-|.*-snow-top|.*-beveled-snow-lip|.*-rock-side|.*-rock-faces|selection|spawn-zone|castle-zone|north-wall-|south-wall-|west-wall-|east-wall-|wall-corner-|spawn-gate|exit-gate)/;
    for (const mesh of this.scene.meshes) {
      if (!coreEnvironment.test(mesh.name)) mesh.setEnabled(false);
    }
    console.info("Environment safe mode active", { enabledMeshes: this.scene.meshes.filter((mesh) => mesh.isEnabled()).map((mesh) => mesh.name) });
  }

  private dumpRuntimeMeshes(): void {
    const mapWidth = this.map.width * TILE_SIZE_3D;
    const mapDepth = this.map.height * TILE_SIZE_3D;
    const report = this.scene.meshes.map((mesh) => {
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      const dimensions = bounds.maximumWorld.subtract(bounds.minimumWorld);
      const material = mesh.material;
      const inFrustum = this.scene.frustumPlanes ? mesh.isInFrustum(this.scene.frustumPlanes) : false;
      const oversized = dimensions.x > mapWidth * 0.5 || dimensions.z > mapDepth * 0.5 || dimensions.y > 8;
      return {
        name: mesh.name,
        id: mesh.id,
        parent: mesh.parent?.name ?? null,
        sourceAsset: mesh.metadata?.environmentSource ?? "procedural/runtime",
        enabled: mesh.isEnabled(),
        visible: mesh.isVisible,
        visibility: mesh.visibility,
        position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
        absolutePosition: { x: mesh.absolutePosition.x, y: mesh.absolutePosition.y, z: mesh.absolutePosition.z },
        rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
        scaling: { x: mesh.scaling.x, y: mesh.scaling.y, z: mesh.scaling.z },
        dimensions: { width: dimensions.x, height: dimensions.y, depth: dimensions.z },
        boundsMin: { x: bounds.minimumWorld.x, y: bounds.minimumWorld.y, z: bounds.minimumWorld.z },
        boundsMax: { x: bounds.maximumWorld.x, y: bounds.maximumWorld.y, z: bounds.maximumWorld.z },
        material: material?.name ?? null,
        backFaceCulling: material?.backFaceCulling ?? null,
        receiveShadows: mesh.receiveShadows,
        isPickable: mesh.isPickable,
        inCameraFrustum: inFrustum,
        oversized,
        maxDimension: Math.max(dimensions.x, dimensions.y, dimensions.z),
        volume: dimensions.x * dimensions.y * dimensions.z,
      };
    }).sort((a, b) => b.maxDimension - a.maxDimension);
    console.table(report);
    for (const mesh of report) {
      if (mesh.oversized && mesh.inCameraFrustum) console.warn("Large mesh entering camera frustum", mesh);
    }
    (window as Window & { __environmentMeshDump?: typeof report }).__environmentMeshDump = report;
    let output = document.querySelector<HTMLScriptElement>("#environment-mesh-dump");
    if (!output) {
      output = document.createElement("script");
      output.id = "environment-mesh-dump";
      output.type = "application/json";
      document.body.append(output);
    }
    output.textContent = JSON.stringify(report);
  }

  /** Presentation-only reset hook. Gameplay grid and state are deliberately untouched. */
  public async selectNextEnvironmentTheme(): Promise<void> {
    this.themeRunOrdinal += 1;
    this.currentTheme = themeForRun(this.presentationSeed + this.themeRunOrdinal);
    this.applyThemeMaterials();
    if (this.environmentReady) {
      if (!this.disableEnvironmentProps) this.rebuildThemeProps();
      if (this.environmentSafeMode) this.applyEnvironmentSafeMode();
    }
    console.info(`Environment theme: ${this.currentTheme.label}`, { seed: this.presentationSeed + this.themeRunOrdinal });
  }

  private applyThemeMaterials(): void {
    const theme = this.currentTheme;
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = VISUAL_CONFIG.fogDensity;
    this.scene.fogColor = theme.fogColor;
    this.scene.clearColor.set(theme.fogColor.r * 0.28, theme.fogColor.g * 0.32, theme.fogColor.b * 0.38, 1);
    this.sky.diffuse = theme.ambientTint;
    this.playableGroundMaterial?.diffuseColor.copyFrom(theme.playableGround);
    if (this.outskirtsGroundMaterial) {
      this.outskirtsGroundMaterial.diffuseColor.copyFrom(Color3.White());
      this.outskirtsGroundMaterial.diffuseTexture = this.arenaArt.outskirtsTexture(theme);
    }
    if (this.spawnAccentMaterial) {
      this.spawnAccentMaterial.diffuseColor.copyFrom(theme.spawnAccent);
      this.spawnAccentMaterial.emissiveColor.copyFrom(theme.spawnAccent.scale(VISUAL_CONFIG.spawnGlowStrength));
    }
    if (this.exitAccentMaterial) {
      this.exitAccentMaterial.diffuseColor.copyFrom(theme.exitAccent);
      this.exitAccentMaterial.emissiveColor.copyFrom(theme.exitAccent.scale(VISUAL_CONFIG.exitGlowStrength));
    }
    if (this.spawnZoneMaterial) {
      this.spawnZoneMaterial.diffuseColor.copyFrom(theme.spawnAccent);
      this.spawnZoneMaterial.emissiveColor.copyFrom(theme.spawnAccent.scale(0.16));
    }
    if (this.exitZoneMaterial) {
      this.exitZoneMaterial.diffuseColor.copyFrom(theme.exitAccent);
      this.exitZoneMaterial.emissiveColor.copyFrom(theme.exitAccent.scale(0.16));
    }
    for (const spawnLight of this.spawnLights) spawnLight.diffuse.copyFrom(theme.spawnAccent);
    if (this.exitLight) this.exitLight.diffuse.copyFrom(theme.exitAccent);
  }

  private rebuildThemeProps(): void {
    for (const root of this.themeProps) {
      this.environmentAssets.removeFromShadows(root);
      root.dispose(false, false);
    }
    this.themeProps.length = 0;

    this.themeProps.push(...this.arenaArt.clusters(this.currentTheme, this.presentationSeed + this.themeRunOrdinal));
  }

  private material(name: string, color: Color3, emissive?: Color3): StandardMaterial {
    const material = new StandardMaterial(name, this.scene); material.diffuseColor = color; if (emissive) material.emissiveColor = emissive; return material;
  }

  private zoneMarker(name: string, x: number, z: number, color: Color3, sharedMaterial?: StandardMaterial): StandardMaterial {
    const markerSize = VISUAL_CONFIG.spawnGoalMarkerSize;
    const marker = MeshBuilder.CreateGround(name, { width: markerSize, height: markerSize }, this.scene);
    marker.position.set(x, 0.018, z);
    const material = sharedMaterial ?? new StandardMaterial(`${name}-material`, this.scene);
    material.diffuseColor = color; material.emissiveColor = color.scale(0.16); material.alpha = 0.1;
    marker.material = material;
    return material;
  }

  /** Compact endpoint portal that follows the selected map instead of fixed classic coordinates. */
  private createEndpointVisual(name: string, x: number, z: number, material: StandardMaterial, lightColor: Color3, side: "north" | "south" | "east" | "west"): void {
    const ring = MeshBuilder.CreateTorus(`${name}-ring`, { diameter: 0.88, thickness: 0.075, tessellation: 24 }, this.scene);
    ring.position.set(x, 0.065, z);
    ring.rotation.x = Math.PI / 2;
    ring.material = material;
    ring.isPickable = false;
    const arch = MeshBuilder.CreatePlane(`${name}-portal`, { width: 0.7, height: 1.35 }, this.scene);
    arch.position.set(x, 0.72, z);
    arch.rotation.y = side === "east" || side === "west" ? Math.PI / 2 : 0;
    arch.material = material;
    arch.isPickable = false;
    const light = new PointLight(`${name}-light`, new Vector3(x, 1.1, z), this.scene);
    light.diffuse = lightColor;
    light.intensity = VISUAL_CONFIG.gateLightRange * 0.06;
    light.range = 4;
    if (name.startsWith("spawn-")) this.spawnLights.push(light);
    if (name === "exit") this.exitLight = light;
  }

  private installGestureInput(): void {
    this.canvas.addEventListener("pointerleave", () => { this.buildVisualUntil = 0; this.lastPreviewCellKey = ""; }, { signal: this.inputAbortController.signal });
    this.canvas.addEventListener("pointermove", (event) => {
      if (event.pointerType === "mouse" && !this.activePointers.has(event.pointerId)) {
        this.previewCell(event.clientX, event.clientY);
      }
    }, { signal: this.inputAbortController.signal });
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      this.preventNativeTouchGesture(event);
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY, pointerType: event.pointerType });
      try {
        this.canvas.setPointerCapture(event.pointerId);
      } catch {
        // Window-level move/up listeners below keep the gesture alive if capture is unavailable.
      }
      if (this.gesture) {
        this.gesture.dragging = true;
        this.gesture.multiTouch = true;
        this.pinchDistance = this.pointerDistance();
        this.inputGestureLabel = "PINCH";
        this.inputLastAction = "Pinch started; pending tap cancelled";
        this.refreshInputDebugOverlay();
        return;
      }
      this.gesture = {
        pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, pointerType: event.pointerType,
        dragging: false, multiTouch: this.activePointers.size > 1,
        panAnchor: this.groundPointAt(event.clientX, event.clientY), startTarget: this.camera.target.clone(),
      };
      this.inputGestureLabel = "TAP";
      this.inputMovementDistance = 0;
      this.inputCellLabel = this.cellLabelAtPointer(event.clientX, event.clientY);
      this.inputLastAction = "Tap pending";
      this.refreshInputDebugOverlay();
    }, { signal: this.inputAbortController.signal });
    window.addEventListener("pointermove", (event) => {
      const previous = this.activePointers.get(event.pointerId);
      if (!previous) return;
      this.preventNativeTouchGesture(event);
      this.activePointers.set(event.pointerId, { ...previous, x: event.clientX, y: event.clientY });
      if (this.activePointers.size >= 2) {
        const nextDistance = this.pointerDistance();
        const distanceChange = this.pinchDistance > 0 && nextDistance > 0 ? Math.abs(nextDistance - this.pinchDistance) : 0;
        if (this.pinchDistance > 0 && nextDistance > 0) {
          this.camera.radius = this.clamp(this.camera.radius * this.pinchDistance / nextDistance, VISUAL_CONFIG.minCameraRadius, VISUAL_CONFIG.maxCameraRadius);
        }
        this.pinchDistance = nextDistance;
        this.lastCameraGestureAt = performance.now();
        this.inputGestureLabel = "PINCH";
        this.inputMovementDistance += distanceChange;
        this.inputLastAction = "Pinching to zoom";
        this.refreshInputDebugOverlay();
        return;
      }
      if (!this.gesture) return;
      if (event.pointerId !== this.gesture.pointerId) return;
      const movement = Math.hypot(event.clientX - this.gesture.startX, event.clientY - this.gesture.startY);
      this.inputMovementDistance = movement;
      this.inputCellLabel = this.cellLabelAtPointer(event.clientX, event.clientY);
      const threshold = this.gesture.pointerType === "touch"
        ? VISUAL_CONFIG.touchDragThreshold
        : VISUAL_CONFIG.desktopDragThreshold;
      if (movement > threshold) {
        this.gesture.dragging = true;
        this.inputGestureLabel = "PAN";
        this.inputLastAction = "Panning camera";
        this.panFromScreenPoint(event.clientX, event.clientY);
      }
      this.refreshInputDebugOverlay();
    }, { signal: this.inputAbortController.signal });
    const finishGesture = (event: PointerEvent, cancelled: boolean) => {
      if (!this.activePointers.has(event.pointerId)) return;
      this.preventNativeTouchGesture(event);
      this.activePointers.delete(event.pointerId);
      try {
        if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      } catch {
        // The browser may already have released capture for pointerup/pointercancel.
      }
      if (this.activePointers.size < 2) this.pinchDistance = 0;
      if (cancelled) {
        if (this.gesture?.pointerId === event.pointerId) this.gesture = undefined;
        this.inputGestureLabel = "CANCELLED";
        this.inputLastAction = "Pointer cancelled; no tap action";
        this.lastCameraGestureAt = performance.now();
        this.refreshInputDebugOverlay();
        return;
      }
      if (!this.gesture || event.pointerId !== this.gesture.pointerId) {
        this.refreshInputDebugOverlay();
        return;
      }
      const gesture = this.gesture;
      this.gesture = undefined;
      if (gesture.dragging || gesture.multiTouch || this.activePointers.size > 0) {
        this.inputGestureLabel = gesture.multiTouch ? "PINCH" : "PAN";
        this.inputLastAction = gesture.multiTouch ? "Pinch ended; placement skipped" : "Pan ended; placement skipped";
        this.lastCameraGestureAt = performance.now();
        this.refreshInputDebugOverlay();
        return;
      }
      if (performance.now() - this.lastCameraGestureAt < 75) {
        this.inputLastAction = "Tap ignored after camera gesture";
        this.refreshInputDebugOverlay();
        return;
      }
      this.pickCell(event.clientX, event.clientY);
      this.refreshInputDebugOverlay();
    };
    window.addEventListener("pointerup", (event) => finishGesture(event, false), { signal: this.inputAbortController.signal });
    window.addEventListener("pointercancel", (event) => finishGesture(event, true), { signal: this.inputAbortController.signal });
    window.addEventListener("lostpointercapture", (event) => finishGesture(event, true), { signal: this.inputAbortController.signal });
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.camera.radius = this.clamp(this.camera.radius * Math.exp(event.deltaY * 0.001), VISUAL_CONFIG.minCameraRadius, VISUAL_CONFIG.maxCameraRadius);
    }, { passive: false, signal: this.inputAbortController.signal });
  }

  private preventNativeTouchGesture(event: PointerEvent): void {
    if (event.pointerType !== "mouse" && event.cancelable) event.preventDefault();
  }

  private cellLabelAtPointer(clientX: number, clientY: number): string {
    const cell = this.cellAtPointer(clientX, clientY);
    return cell ? `${cell.x},${cell.y}` : "—";
  }

  private refreshInputDebugOverlay(): void {
    if (!this.inputDebugOverlay) return;
    const state = this.getInputDebugState();
    this.inputDebugOverlay.textContent = [
      `POINTERS ${state.pointerCount}  GESTURE ${state.gesture}`,
      `MOVE ${state.movementDistance}px  CELL ${state.selectedCell}`,
      `BUILD ${state.buildMode}`,
      `ACTION ${state.lastAction}`,
    ].join("\n");
  }

  private createInputDebugOverlay(): void {
    const overlay = document.createElement("pre");
    overlay.style.cssText = "position:fixed;left:8px;top:50%;z-index:30;transform:translateY(-50%);margin:0;padding:7px 9px;pointer-events:none;color:#d8f6ff;background:#07111de8;border:1px solid #6896a5;border-radius:5px;font:10px/1.4 ui-monospace,monospace;white-space:pre-wrap";
    document.body.append(overlay);
    this.inputDebugOverlay = overlay;
    this.refreshInputDebugOverlay();
  }

  private pointerDistance(): number {
    const [first, second] = [...this.activePointers.values()];
    return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 0;
  }

  private panFromScreenPoint(clientX: number, clientY: number): void {
    const start = this.gesture;
    if (!start) return;
    const anchor = start.panAnchor;
    if (!anchor || !start.startTarget) return;
    // Project both points through the camera pose from pointer-down. Recomputing
    // the current ray from the already-panned camera would damp long drags.
    const liveTarget = this.camera.target.clone();
    this.camera.target.copyFrom(start.startTarget);
    this.camera.computeWorldMatrix();
    const current = this.groundPointAt(clientX, clientY);
    this.camera.target.copyFrom(liveTarget);
    this.camera.computeWorldMatrix();
    if (!current) return;
    const zoomScale = this.camera.radius / VISUAL_CONFIG.defaultCameraRadius;
    const panScale = VISUAL_CONFIG.cameraPanSpeed * Math.pow(zoomScale, VISUAL_CONFIG.cameraPanZoomMultiplier);
    this.camera.target.x = start.startTarget.x + (anchor.x - current.x) * panScale;
    this.camera.target.z = start.startTarget.z + (anchor.z - current.z) * panScale;
    this.clampCameraToMap();
    this.camera.computeWorldMatrix();
  }

  private groundPointAt(clientX: number, clientY: number): Vector3 | undefined {
    const bounds = this.canvas.getBoundingClientRect();
    const x = (clientX - bounds.left) * this.engine.getRenderWidth() / bounds.width;
    const y = (clientY - bounds.top) * this.engine.getRenderHeight() / bounds.height;
    return this.groundPointAtRenderPoint(x, y);
  }

  private groundPointAtRenderPoint(x: number, y: number): Vector3 | undefined {
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.camera);
    if (Math.abs(ray.direction.y) < 1e-5) return undefined;
    const distance = (this.camera.target.y - ray.origin.y) / ray.direction.y;
    return distance >= 0 ? ray.origin.add(ray.direction.scale(distance)) : undefined;
  }

  private clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }

  private updateBuildVisual(now: number, deltaSeconds: number): void {
    this.isBuildModeVisual = now < this.buildVisualUntil && !this.gesture?.dragging && !this.gameState?.gameOver;
    if (this.gridLines) {
      const target = this.isBuildModeVisual ? VISUAL_CONFIG.buildGridAlpha : VISUAL_CONFIG.gridAlpha;
      this.gridLines.alpha += (target - this.gridLines.alpha) * Math.min(1, deltaSeconds * 9);
      this.gridLines.setEnabled(this.isBuildModeVisual);
    }
    if (!this.isBuildModeVisual) {
      this.highlight.isVisible = false; this.highlightOutline.isVisible = false;
      this.lastPreviewCellKey = "";
    }
  }

  private pickCell(clientX: number, clientY: number): void {
    this.buildVisualUntil = performance.now() + VISUAL_CONFIG.buildVisualHoldMs;
    this.lastPreviewCellKey = "";
    const cell = this.cellAtPointer(clientX, clientY);
    this.inputCellLabel = cell ? `${cell.x},${cell.y}` : "—";
    if (!cell) {
      this.inputLastAction = "Tap missed battlefield grid";
      return;
    }
    const point = gridToWorld3D(cell);
    if (!this.gameState) {
      this.showCellHighlight(point.x, point.z, VISUAL_CONFIG.selectedCellColor);
      this.inputLastAction = "Cell highlighted";
      return;
    }
    const tower = this.gameState.towerAt(cell);
    if (tower) {
      this.selectTower(this.selectedTowerId === tower.id ? undefined : tower.id);
      this.showCellHighlight(point.x, point.z, VISUAL_CONFIG.selectedCellColor);
      this.inputLastAction = this.selectedTowerId === tower.id ? `Tower selected #${tower.id}` : `Tower deselected #${tower.id}`;
      return;
    }
    if (this.selectedTowerId !== undefined) {
      this.selectTower(undefined);
    }
    const result = this.gameState.placeBasicTower(cell, this.buildDefenderType);
    this.inputLastAction = result === "placed" ? `${this.buildDefenderType} placed at ${cell.x},${cell.y}` : `Placement rejected: ${result}`;
    this.showCellHighlight(
      point.x,
      point.z,
      result === "placed" ? VISUAL_CONFIG.validPlacementColor : VISUAL_CONFIG.invalidPlacementColor,
    );
  }

  private previewCell(clientX: number, clientY: number): void {
    const cell = this.cellAtPointer(clientX, clientY);
    if (!cell || !this.gameState) return;
    this.buildVisualUntil = performance.now() + VISUAL_CONFIG.buildVisualHoldMs;
    const key = `${cell.x}:${cell.y}`;
    if (key === this.lastPreviewCellKey) return;
    this.lastPreviewCellKey = key;
    const point = gridToWorld3D(cell);
    const color = this.gameState.towerAt(cell)
      ? VISUAL_CONFIG.selectedCellColor
      : this.gameState.canPlaceBasicTower(cell, this.buildDefenderType) === "placed"
        ? VISUAL_CONFIG.validPlacementColor
        : VISUAL_CONFIG.invalidPlacementColor;
    this.showCellHighlight(point.x, point.z, color);
  }

  private cellAtPointer(clientX: number, clientY: number): { x: number; y: number } | undefined {
    const bounds = this.canvas.getBoundingClientRect();
    const x = (clientX - bounds.left) * (this.engine.getRenderWidth() / bounds.width);
    const y = (clientY - bounds.top) * (this.engine.getRenderHeight() / bounds.height);
    const pick = this.scene.pick(x, y, (mesh) => mesh.name === "snowGround");
    if (!pick?.hit || !pick.pickedPoint) return undefined;
    const cell = worldToGrid3D(pick.pickedPoint.x, pick.pickedPoint.z);
    if (cell.x < 0 || cell.y < 0 || cell.x >= this.map.width || cell.y >= this.map.height) return undefined;
    return cell;
  }

  private showCellHighlight(x: number, z: number, color: Color3): void {
    this.highlight.position.set(x, 0.021, z);
    this.highlightOutline.position.set(x, 0.026, z);
    this.selectionMaterial.diffuseColor.copyFrom(color);
    this.selectionMaterial.emissiveColor.copyFrom(color.scale(0.22));
    this.highlightOutline.color.copyFrom(color);
    this.highlight.isVisible = true;
    this.highlightOutline.isVisible = true;
  }

  /** Keeps both the camera focus and its calculated orbit position near the playable map. */
  private clampCameraToMap(): void {
    const { targetMinX, targetMaxX, targetMinZ, targetMaxZ, positionMinX, positionMaxX, positionMinZ, positionMaxZ } = this.cameraBounds();
    this.camera.computeWorldMatrix();
    const offsetX = this.camera.globalPosition.x - this.camera.target.x;
    const offsetZ = this.camera.globalPosition.z - this.camera.target.z;
    this.camera.target.x = this.clampToIntersection(this.camera.target.x, targetMinX, targetMaxX, positionMinX - offsetX, positionMaxX - offsetX);
    this.camera.target.z = this.clampToIntersection(this.camera.target.z, targetMinZ, targetMaxZ, positionMinZ - offsetZ, positionMaxZ - offsetZ);
  }

  /** Applies hard limits after custom pointer/wheel controls have processed input. */
  private enforceCameraSafety(): void {
    this.camera.beta = Math.min(this.camera.upperBetaLimit!, Math.max(this.camera.lowerBetaLimit!, this.camera.beta));
    this.camera.radius = Math.min(this.camera.upperRadiusLimit!, Math.max(this.camera.lowerRadiusLimit!, this.camera.radius));
    this.clampCameraToMap();
    this.camera.computeWorldMatrix();
    if (!this.isCameraStateValid()) {
      this.restoreCameraState(this.lastValidCameraState);
      return;
    }
    this.lastValidCameraState = this.captureCameraState();
  }

  private isCameraStateValid(): boolean {
    const { targetMinX, targetMaxX, targetMinZ, targetMaxZ, positionMinX, positionMaxX, positionMinZ, positionMaxZ } = this.cameraBounds();
    const position = this.camera.globalPosition;
    return Number.isFinite(this.camera.alpha)
      && this.camera.beta >= this.camera.lowerBetaLimit! && this.camera.beta <= this.camera.upperBetaLimit!
      && this.camera.radius >= this.camera.lowerRadiusLimit! && this.camera.radius <= this.camera.upperRadiusLimit!
      && this.camera.target.x >= targetMinX && this.camera.target.x <= targetMaxX
      && this.camera.target.z >= targetMinZ && this.camera.target.z <= targetMaxZ
      && position.y >= BabylonGameRenderer.CAMERA_MIN_HEIGHT
      && position.x >= positionMinX && position.x <= positionMaxX
      && position.z >= positionMinZ && position.z <= positionMaxZ;
  }

  private cameraBounds(): { targetMinX: number; targetMaxX: number; targetMinZ: number; targetMaxZ: number; positionMinX: number; positionMaxX: number; positionMinZ: number; positionMaxZ: number } {
    const mapWidth = this.map.width * TILE_SIZE_3D;
    const mapDepth = this.map.height * TILE_SIZE_3D;
    const verticalHalfView = this.camera.radius * Math.tan(this.camera.fov / 2);
    const horizontalHalfView = verticalHalfView * this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    const dynamicPanMargin = Math.min(VISUAL_CONFIG.cameraPanMargin * TILE_SIZE_3D, Math.min(verticalHalfView, horizontalHalfView) * 0.08);
    // Target bounds include the corners themselves (plus a zoom/aspect-aware small overscan).
    // Camera position bounds expand with radius because the fixed-angle camera sits behind its target.
    const cameraExtent = this.camera.radius + BabylonGameRenderer.CAMERA_OUTSKIRTS_MARGIN * TILE_SIZE_3D;
    return {
      targetMinX: -dynamicPanMargin, targetMaxX: mapWidth + dynamicPanMargin,
      targetMinZ: -dynamicPanMargin, targetMaxZ: mapDepth + dynamicPanMargin,
      positionMinX: -cameraExtent, positionMaxX: mapWidth + cameraExtent,
      positionMinZ: -cameraExtent, positionMaxZ: mapDepth + cameraExtent,
    };
  }

  private resetCameraView(): void {
    this.camera.alpha = VISUAL_CONFIG.defaultCameraAlpha;
    this.camera.beta = VISUAL_CONFIG.defaultCameraBeta;
    this.camera.radius = VISUAL_CONFIG.defaultCameraRadius;
    this.camera.target.set(this.map.width / 2, 0, this.map.height / 2);
    this.camera.computeWorldMatrix();
    this.lastValidCameraState = this.captureCameraState();
  }

  private createCameraDebugOverlay(): void {
    const overlay = document.createElement("pre");
    overlay.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:20;margin:0;padding:8px;background:#07111ddd;color:#c9f5ff;font:11px/1.35 monospace;pointer-events:none;white-space:pre-wrap";
    document.body.append(overlay);
    this.cameraDebugOverlay = overlay;
  }

  private updateCameraDebugOverlay(): void {
    if (!this.cameraDebugOverlay) return;
    const bounds = this.cameraBounds();
    this.camera.computeWorldMatrix();
    const p = this.camera.globalPosition;
    this.cameraDebugOverlay.textContent = `alpha ${this.camera.alpha.toFixed(3)} beta ${this.camera.beta.toFixed(3)} radius ${this.camera.radius.toFixed(2)}\ntarget ${this.camera.target.x.toFixed(1)}, ${this.camera.target.z.toFixed(1)} position ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}\npan X ${bounds.targetMinX.toFixed(1)}..${bounds.targetMaxX.toFixed(1)} Z ${bounds.targetMinZ.toFixed(1)}..${bounds.targetMaxZ.toFixed(1)}`;
  }

  private captureCameraState(): CameraState {
    return { alpha: this.camera.alpha, beta: this.camera.beta, radius: this.camera.radius, target: this.camera.target.clone() };
  }

  private restoreCameraState(state: CameraState): void {
    this.camera.alpha = state.alpha;
    this.camera.beta = state.beta;
    this.camera.radius = state.radius;
    this.camera.target.copyFrom(state.target);
    this.camera.computeWorldMatrix();
  }

  logCameraState(label: string): void {
    if (!this.waveDebug) return;
    this.camera.computeWorldMatrix();
    const snapshot = {
      label,
      activeCamera: this.scene.activeCamera?.name ?? null,
      expectedCamera: this.camera.name,
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
      target: { x: this.camera.target.x, y: this.camera.target.y, z: this.camera.target.z },
      position: { x: this.camera.globalPosition.x, y: this.camera.globalPosition.y, z: this.camera.globalPosition.z },
      lowerRadiusLimit: this.camera.lowerRadiusLimit,
      upperRadiusLimit: this.camera.upperRadiusLimit,
    };
    console.info(label, snapshot);
    const debugWindow = window as Window & { __cameraDebugHistory?: typeof snapshot[] };
    (debugWindow.__cameraDebugHistory ??= []).push(snapshot);
  }

  private clampToIntersection(value: number, targetMin: number, targetMax: number, positionMin: number, positionMax: number): number {
    const min = Math.max(targetMin, positionMin);
    const max = Math.min(targetMax, positionMax);
    if (min <= max) return Math.min(max, Math.max(min, value));
    // With an extreme orbit angle, prioritize the visible camera position over the requested pan target.
    return Math.min(targetMax, Math.max(targetMin, (positionMin + positionMax) / 2));
  }

  private createTowerVisual(tower: Tower): TowerVisual {
    const world = gridToWorld3D(tower.cell);
    let visual: TowerVisual;
    switch (tower.type) {
      case "blue-wizard":
        visual = this.blueWizardFactory.ready
          ? this.blueWizardFactory.create(tower.id, tower.level)
          : this.quaterniusFactory.ready
            ? this.quaterniusFactory.create(tower.id, tower.level)
            : this.archerFactory.create(tower.id, tower.level);
        break;
      case "holy-knight":
        visual = this.holyKnightFactory.ready
          ? this.holyKnightFactory.create(tower.id, tower.level)
          : this.quaterniusFactory.ready
            ? this.quaterniusFactory.create(tower.id, tower.level)
            : this.archerFactory.create(tower.id, tower.level);
        break;
      case "green-archer":
      case "battlemage":
      case "sovereign":
        // The factory returns that type's own GLB or its own primitive fallback; never Wizard.
        visual = this.quaterniusDefenderFactory.create(tower.id, tower.type, tower.level);
        break;
      default: {
        const unreachableType: never = tower.type;
        throw new Error(`No defender visual mapping for ${unreachableType}`);
      }
    }
    visual.root.position.set(world.x, 0, world.z);
    const factionRing = MeshBuilder.CreateTorus(`ally-faction-ring-${tower.id}`, {
      diameter: 0.68 + tower.level * 0.035,
      thickness: 0.025,
      tessellation: 24,
    }, this.scene);
    factionRing.parent = visual.root;
    factionRing.position.y = 0.018;
    factionRing.material = this.allyAccentMaterial;
    factionRing.isPickable = false;
    return visual;
  }

  private rebuildTowerVisuals(): void {
    for (const visual of this.towerVisuals.values()) this.disposeTowerVisual(visual);
    this.towerVisuals.clear();
  }

  private disposeTowerVisual(visual: TowerVisual): void {
    visual.root.getChildMeshes().forEach((mesh) => this.shadowGenerator.removeShadowCaster(mesh));
    if ("dispose" in visual) visual.dispose();
    visual.root.dispose(false, false);
  }

  private disposeEnemyVisual(visual: EnemyVisual): void {
    visual.root.getChildMeshes().forEach((mesh) => this.shadowGenerator.removeShadowCaster(mesh));
    if ("dispose" in visual) visual.dispose();
    visual.root.dispose(false, false);
  }

  private createPerformanceOverlay(): void {
    this.perfOverlay = document.createElement("pre");
    this.perfOverlay.className = "perf-debug";
    this.perfOverlay.setAttribute("aria-live", "off");
    document.body.append(this.perfOverlay);
  }

  private updatePerformanceDebug(gameState: GameState, now: number): void {
    if (!this.perfDebug) return;
    if (gameState.waveActive && !this.previousWaveActive) this.recordPerformanceSnapshot("before-wave", gameState);
    if (!gameState.waveActive && this.previousWaveActive) this.recordPerformanceSnapshot("after-wave", gameState);
    if (gameState.waveActive && now - this.lastMidWaveSnapshotAt >= 5000) {
      this.lastMidWaveSnapshotAt = now;
      this.recordPerformanceSnapshot("mid-wave", gameState);
    }
    this.previousWaveActive = gameState.waveActive;
    if (!this.perfOverlay || now - this.lastPerfOverlayAt < 500) return;
    this.lastPerfOverlayAt = now;
    const snapshot = this.performanceSnapshot(gameState.waveActive ? "mid-wave" : "after-wave", gameState);
    this.perfOverlay.textContent = [
      `${snapshot.fps} FPS / ${snapshot.frameTimeMs} ms`,
      `Enemies ${snapshot.enemies} | Allies ${snapshot.allies}`,
      `Meshes ${snapshot.meshes} | Skeletons ${snapshot.skeletons}`,
      `Animations ${snapshot.activeAnimationGroups}/${snapshot.animationGroups}`,
      `Effects ${snapshot.combatEffects} | Arrows ${snapshot.projectiles}`,
      `HP bars ${snapshot.hpBars} | Shadows ${snapshot.shadowCasters}`,
      `Environment props ${snapshot.environmentProps}`,
    ].join("\n");
  }

  private recordPerformanceSnapshot(phase: PerformanceSnapshot["phase"], gameState: GameState): void {
    const snapshot = this.performanceSnapshot(phase, gameState);
    console.info("Performance snapshot", snapshot);
    const debugWindow = window as Window & { __performanceSnapshots?: PerformanceSnapshot[] };
    (debugWindow.__performanceSnapshots ??= []).push(snapshot);
  }

  private performanceSnapshot(phase: PerformanceSnapshot["phase"], gameState: GameState): PerformanceSnapshot {
    const averageFrameTime = this.frameTimeSamples.length > 0
      ? this.frameTimeSamples.reduce((sum, value) => sum + value, 0) / this.frameTimeSamples.length
      : 0;
    const shadowCasters = this.shadowGenerator.getShadowMap()?.renderList?.length ?? 0;
    return {
      phase,
      wave: gameState.currentWave,
      fps: Math.round(this.engine.getFps()),
      frameTimeMs: Number(averageFrameTime.toFixed(2)),
      enemies: gameState.enemies.length,
      allies: gameState.towers.length,
      meshes: this.scene.meshes.length,
      skeletons: this.scene.skeletons.length,
      animationGroups: this.scene.animationGroups.length,
      activeAnimationGroups: this.scene.animationGroups.filter((group) => group.isStarted).length,
      combatEffects: this.combatEffects.activeEffectCount,
      projectiles: this.combatEffects.activeProjectileCount,
      hpBars: this.scene.meshes.filter((mesh) => mesh.name.includes("health-") && mesh.isEnabled()).length,
      shadowCasters,
      environmentProps: this.themeProps.length,
    };
  }
}
