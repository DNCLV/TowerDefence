import {
  AbstractMesh, ArcRotateCamera, Color3, Color4, DirectionalLight, DynamicTexture, Engine, HemisphericLight, Matrix, Mesh, MeshBuilder,
  PBRMaterial, PointLight, Scene, ShadowGenerator, StandardMaterial, Texture, TransformNode, Vector3, VertexBuffer,
} from "@babylonjs/core";
import { MAPS, MapDefinition } from "../config/MapConfig";
import { resolveAssetUrl } from "../../core/AssetUrl";
import { gridToWorld3D, TILE_SIZE_3D, worldToGrid3D } from "./Grid3D";
import { WORLD_UNITS_PER_CELL } from "../../core/GameConstants";
import type { DefenderType } from "../config/DefenderConfig";
import { DEFENDER_CONFIG } from "../config/DefenderConfig";
import type { FactionId } from "../config/FactionConfig";
import type { EnemyType } from "../config/EnemyConfig";
import { AFFIXES } from "../config/EnemyAffixConfig";
import type { EnemyAffixId } from "../config/EnemyAffixConfig";
import { getSpecialization, TOWER_SPECIALIZATIONS } from "../config/SpecializationConfig";
import type { TowerSpecializationId } from "../config/SpecializationConfig";
import { FORMATIONS } from "../config/FormationConfig";
import { getWaveComposition } from "../config/WaveConfig";
import type { FormationId } from "../config/FormationConfig";
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
import { DEFENDER_VISUAL_CONFIG } from "./DefenderVisualConfig";
import { getCommanderAuraMultiplier, getEnemySpeedMultiplier } from "../enemies/EnemyAffixSystem";
import { EnvironmentAssetLibrary } from "./EnvironmentAssetLibrary";
import { VISUAL_CONFIG } from "./VisualConfig";
import { ACTIVE_RENDERING_QUALITY } from "./RenderingQualityConfig";
import { EnvironmentTheme, themeForRun } from "./EnvironmentThemes";
import { WinterArenaArt } from "./WinterArenaArt";
import { TERRAIN_PLATEAU_HEIGHT, TerrainCliffRenderer } from "./TerrainCliffRenderer";
import { GameSpeedMultiplier, SimulationClock } from "../SimulationClock";
import type { MinimapCameraView } from "../minimap/MinimapRenderer";
import { groundPointToLogicalMap } from "../minimap/MinimapCoordinates";
import type { LinesMesh } from "@babylonjs/core";
import { getVeteranProgress } from "../FactionBonusSystem";
import type { VeteranRank } from "../config/FactionBonusConfig";

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
  activeMeshes: number;
  drawCalls: number;
  skeletons: number;
  animationGroups: number;
  activeAnimationGroups: number;
  combatEffects: number;
  projectiles: number;
  hpBars: number;
  shadowCasters: number;
  environmentProps: number;
  environmentTemplateMeshes: number;
  environmentInstances: number;
}

function createPresentationSeed(): number {
  const debugSeed = Number.parseInt(new URLSearchParams(window.location.search).get("themeSeed") ?? "", 10);
  return Number.isFinite(debugSeed) ? debugSeed : Math.floor(Math.random() * 0x7fffffff);
}

function stablePresentationSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Merges the exact blocked-cell lattice into contiguous elevated top-grid segments. */
function mergeTerrainGridLines(cells: readonly { x: number; y: number }[], height: number): Vector3[][] {
  const horizontal = new Map<number, Set<number>>();
  const vertical = new Map<number, Set<number>>();
  const add = (lines: Map<number, Set<number>>, fixed: number, start: number) => {
    const segments = lines.get(fixed) ?? new Set<number>();
    segments.add(start);
    lines.set(fixed, segments);
  };
  for (const cell of cells) {
    add(horizontal, cell.y, cell.x);
    add(horizontal, cell.y + 1, cell.x);
    add(vertical, cell.x, cell.y);
    add(vertical, cell.x + 1, cell.y);
  }

  const result: Vector3[][] = [];
  const merge = (lines: Map<number, Set<number>>, isHorizontal: boolean) => {
    for (const [fixed, segments] of lines) {
      const starts = [...segments].sort((a, b) => a - b);
      let from = starts[0];
      let previous = from;
      const emit = (start: number, end: number) => {
        result.push(isHorizontal
          ? [new Vector3(start, height, fixed), new Vector3(end + 1, height, fixed)]
          : [new Vector3(fixed, height, start), new Vector3(fixed, height, end + 1)]);
      };
      for (let index = 1; index < starts.length; index += 1) {
        const current = starts[index];
        if (current === previous + 1) previous = current;
        else { emit(from, previous); from = previous = current; }
      }
      if (starts.length > 0) emit(from, previous);
    }
  };
  merge(horizontal, true);
  merge(vertical, false);
  return result;
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
  private readonly gridLayers: Array<{ mesh: LinesMesh; vertexColors: number[] }> = [];
  private gridOpacity: number = VISUAL_CONFIG.gridAlpha;
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
  /** Visual-only corpses; they never exist in GameState and are tightly capped. */
  private readonly enemyDeathVisuals = new Map<number, EnemyVisual>();
  private readonly maxEnemyDeathVisuals = 12;
  private readonly activeEnemyIds = new Set<number>();
  private readonly enemyVisualDebug = new URLSearchParams(window.location.search).get("enemyVisualDebug") === "1";
  private readonly enemyAnimationDebug = new URLSearchParams(window.location.search).get("enemyAnimationDebug") === "1";
  private readonly enemyGroundDebug = new URLSearchParams(window.location.search).get("enemyGroundDebug") === "1";
  private readonly enemyVisualDebugReportedTypes = new Set<EnemyType>();
  private readonly enemyVisualDebugLabels = new Map<number, Mesh>();
  private readonly enemyVisualDebugMaterials = new Map<string, StandardMaterial>();
  private enemyGroundDebugMaterial?: StandardMaterial;
  private readonly towerVisuals = new Map<number, TowerVisual>();
  private readonly activeTowerIds = new Set<number>();
  private readonly formationVisuals = new Map<number, { id: FormationId; meshes: AbstractMesh[] }>();
  private readonly activeFormationIds = new Set<number>();
  private readonly formationMaterials = new Map<FormationId, StandardMaterial>();
  private readonly specializationVisuals = new Map<number, { id: TowerSpecializationId; mesh: AbstractMesh }>();
  private readonly activeSpecializationIds = new Set<number>();
  private readonly specializationMaterials = new Map<TowerSpecializationId, StandardMaterial>();
  private readonly veteranVisuals = new Map<number, { rank: VeteranRank; meshes: AbstractMesh[] }>();
  private readonly veteranMaterials = new Map<VeteranRank, StandardMaterial>();
  private readonly livingMazeVisuals = new Map<string, AbstractMesh>();
  private readonly livingMazeMaterial: StandardMaterial;
  private livingMazeVisualSignature = "";
  private readonly affixMaterials = new Map<EnemyAffixId, StandardMaterial>();
  private readonly shieldBackMaterial: StandardMaterial;
  private readonly shieldFillMaterial: StandardMaterial;
  private readonly enemyAffixVisuals = new Map<number, { signature: string; icons: Mesh[] }>();
  private readonly enemyShieldBars = new Map<number, { back: Mesh; fill: Mesh }>();
  private readonly enemySlowIndicators = new Map<number, Mesh>();
  private readonly enemySlowMaterial: StandardMaterial;
  private readonly enemyMazeSlowMaterial: StandardMaterial;
  private readonly combatEffects: CombatEffects3D;
  private readonly simulationClock = new SimulationClock();
  private readonly environmentAssets: EnvironmentAssetLibrary;
  private readonly inputAbortController = new AbortController();
  private readonly pendingInitialization: Promise<void>[] = [];
  private readonly requestedEnemyVisualTypes = new Set<EnemyType>();
  private lastEnemyPreloadWave = 0;
  private readonly pendingEnemyPreloads = new Set<Promise<void>>();
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
  private readonly terrainArtDebug = new URLSearchParams(window.location.search).get("terrainArtDebug") === "1";
  // Dynamic skinned shadows are opt-in. They were disproportionately expensive
  // compared with their small visual contribution on mobile.
  private readonly enemyShadowsEnabled = new URLSearchParams(window.location.search).get("enemyShadows") === "1"
    && !this.disableEnemyShadows;
  private readonly waveDebug = new URLSearchParams(window.location.search).get("waveDebug") === "1";
  private currentTheme: EnvironmentTheme;
  private defenderAssetsReady = false;
  private themeRunOrdinal = 0;
  private environmentReady = false;
  private wasGameOver = false;
  private firstEnemyCameraLogged = false;
  private playableGroundMaterial?: PBRMaterial;
  private outskirtsGroundMaterial?: StandardMaterial;
  private spawnAccentMaterial?: StandardMaterial;
  private exitAccentMaterial?: StandardMaterial;
  private spawnZoneMaterial?: StandardMaterial;
  private exitZoneMaterial?: StandardMaterial;
  private readonly spawnLights: PointLight[] = [];
  private exitLight?: PointLight;
  private gameState?: GameState;
  private selectedTowerId?: number;
  private buildDefenderType: DefenderType | undefined;
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
  private readonly frameTimeSamples = new Float32Array(120);
  private frameTimeSampleCount = 0;
  private frameTimeSampleCursor = 0;
  private frameTimeSampleSum = 0;
  private perfOverlay?: HTMLPreElement;
  private lastPerfOverlayAt = 0;
  private lastEnemyStatsAt = 0;
  private lastMidWaveSnapshotAt = 0;
  private previousWaveActive = false;
  private simulationTimeSeconds = 0;
  private disposed = false;
  private hasRenderedFirstFrame = false;

  constructor(private readonly canvas: HTMLCanvasElement, map: MapDefinition = MAPS["single-spawn"],
    private readonly factionId: FactionId = "arcane-kingdom") {
    this.map = map;
    this.currentTheme = themeForRun(this.presentationSeed, this.factionId);
    this.engine = new Engine(canvas, ACTIVE_RENDERING_QUALITY.antialias);
    this.engine.setHardwareScalingLevel(ACTIVE_RENDERING_QUALITY.hardwareScalingLevel);
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
    this.sky = new HemisphericLight("sky", new Vector3(0, 1, 0), this.scene); this.sky.intensity = VISUAL_CONFIG.royalAmbientIntensity; this.sky.groundColor = VISUAL_CONFIG.royalShadowColor;
    const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, 0.35), this.scene); sun.position = new Vector3(15, 30, -10);
    sun.intensity = VISUAL_CONFIG.royalDirectionalIntensity;
    sun.diffuse.copyFrom(VISUAL_CONFIG.royalSunColor);
    this.shadowGenerator = new ShadowGenerator(ACTIVE_RENDERING_QUALITY.shadowMapSize, sun); this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.enemyFactory = new EnemyMeshFactory(this.scene, this.shadowGenerator, this.enemyShadowsEnabled);
    this.quaterniusEnemyFactory = new QuaterniusEnemyFactory(this.scene, this.shadowGenerator, this.enemyShadowsEnabled);
    this.archerFactory = new ArcherMeshFactory(this.scene, this.shadowGenerator);
    this.quaterniusFactory = new QuaterniusArcherFactory(this.scene, this.shadowGenerator);
    this.blueWizardFactory = new BlueWizardFactory(this.scene, this.shadowGenerator);
    this.holyKnightFactory = new HolyKnightFactory(this.scene, this.shadowGenerator);
    this.quaterniusDefenderFactory = new QuaterniusDefenderFactory(this.scene, this.shadowGenerator, this.factionId);
    this.combatEffects = new CombatEffects3D(this.scene);
    for (const formation of FORMATIONS) {
      const material = new StandardMaterial(`formation-${formation.id}`, this.scene);
      const color = Color3.FromHexString(formation.visualColor);
      material.diffuseColor = color;
      material.emissiveColor = color.scale(0.48);
      material.alpha = 0.64; material.disableLighting = true;
      this.formationMaterials.set(formation.id, material);
    }
    for (const [id, config] of Object.entries(TOWER_SPECIALIZATIONS) as [TowerSpecializationId, typeof TOWER_SPECIALIZATIONS[TowerSpecializationId]][]) {
      const color = Color3.FromHexString(config.visualColor);
      const material = new StandardMaterial(`specialization-${id}`, this.scene);
      material.diffuseColor = color; material.emissiveColor = color.scale(0.7); material.alpha = 0.75; material.disableLighting = true;
      this.specializationMaterials.set(id, material);
    }
    for (const [id, config] of Object.entries(AFFIXES) as [EnemyAffixId, typeof AFFIXES[EnemyAffixId]][]) {
      const color = Color3.FromHexString(config.color);
      const texture = new DynamicTexture(`enemy-affix-icon-${id}`, { width: 64, height: 64 }, this.scene, true);
      const context = texture.getContext() as unknown as CanvasRenderingContext2D;
      context.clearRect(0, 0, 64, 64);
      context.beginPath(); context.arc(32, 32, 29, 0, Math.PI * 2);
      context.fillStyle = config.color; context.fill(); context.strokeStyle = "rgba(255,255,255,.9)"; context.lineWidth = 4; context.stroke();
      context.fillStyle = "#101923"; context.font = "bold 24px Arial"; context.textAlign = "center"; context.textBaseline = "middle";
      context.fillText(config.name.split(" ").map((part) => part[0]).join("").slice(0, 2), 32, 33);
      texture.update(false);
      const material = new StandardMaterial(`enemy-affix-material-${id}`, this.scene);
      material.diffuseTexture = texture; material.opacityTexture = texture; material.emissiveColor = color.scale(0.35);
      material.disableLighting = true; material.backFaceCulling = false;
      this.affixMaterials.set(id, material);
    }
    this.enemySlowMaterial = new StandardMaterial("enemy-frost-slow-indicator", this.scene);
    this.enemySlowMaterial.diffuseColor = Color3.FromHexString("#a9eaff");
    this.enemySlowMaterial.emissiveColor = Color3.FromHexString("#64cfff");
    this.enemySlowMaterial.alpha = 0.42; this.enemySlowMaterial.disableLighting = true;
    this.enemyMazeSlowMaterial = new StandardMaterial("enemy-living-maze-indicator", this.scene);
    this.enemyMazeSlowMaterial.diffuseColor = Color3.FromHexString("#83e3a5");
    this.enemyMazeSlowMaterial.emissiveColor = Color3.FromHexString("#3aaa70");
    this.enemyMazeSlowMaterial.alpha = 0.48; this.enemyMazeSlowMaterial.disableLighting = true;
    this.shieldBackMaterial = new StandardMaterial("enemy-shield-bar-back", this.scene);
    this.shieldBackMaterial.diffuseColor = Color3.FromHexString("#173149"); this.shieldBackMaterial.emissiveColor = Color3.FromHexString("#102c43");
    this.shieldBackMaterial.disableLighting = true; this.shieldBackMaterial.alpha = 0.78;
    this.shieldFillMaterial = new StandardMaterial("enemy-shield-bar-fill", this.scene);
    this.shieldFillMaterial.diffuseColor = Color3.FromHexString("#74dcff"); this.shieldFillMaterial.emissiveColor = Color3.FromHexString("#329bff");
    this.shieldFillMaterial.disableLighting = true;
    this.environmentAssets = new EnvironmentAssetLibrary(this.scene, this.shadowGenerator);
    this.arenaArt = new WinterArenaArt(this.scene, this.environmentAssets, this.shadowGenerator, this.map.width, this.map.height);
    this.applyThemeMaterials();
    const selectedFactionLoads: Promise<void | undefined>[] = [
      this.quaterniusDefenderFactory.load().catch((error: unknown) => {
        if (!this.disposed) console.warn("Selected-faction defender GLB preload failed.", error);
      }),
    ];
    // Ancient Grove has its own complete roster. Avoid fetching/parsing Royal
    // Guard-only Wizard/Knight assets before the selected battlefield is ready.
    if (this.factionId === "arcane-kingdom") {
      selectedFactionLoads.push(
        this.blueWizardFactory.load().catch((error: unknown) => {
          if (this.disposed) return;
          console.warn("Blue Wizard failed to load; using a lightweight fallback visual.", error);
          if (!import.meta.env.DEV) return;
          return this.quaterniusFactory.load().catch((fallbackError: unknown) => {
            if (!this.disposed) console.warn("Quaternius ranger fallback failed to load; using primitive archer.", fallbackError);
          });
        }),
        this.holyKnightFactory.load().catch((error: unknown) => {
          if (this.disposed) return;
          console.warn("Holy Knight failed to load; using a lightweight fallback visual.", error);
          if (!import.meta.env.DEV) return;
          return this.quaterniusFactory.load().catch((fallbackError: unknown) => {
            if (!this.disposed) console.warn("Quaternius ranger fallback failed to load for Holy Knight.", fallbackError);
          });
        }),
      );
    }
    const defenderAssetInitialization = Promise.all(selectedFactionLoads).then(() => {
      if (this.disposed) return;
      this.defenderAssetsReady = true;
      this.rebuildTowerVisuals();
    });
    this.pendingInitialization.push(defenderAssetInitialization);
    // Diagnostic runs deliberately load the complete visual roster. A normal
    // run starts with only Waves 1-5; later archetypes are requested ahead.
    if (this.waveDebug || this.enemyVisualDebug) {
      this.requestEnemyVisualTypes(Object.keys(ENEMY_VISUAL_CONFIG) as EnemyType[]);
    } else {
      this.preloadEnemyAssetsForWave(1);
    }
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
    for (const [rank, color] of [[1, "#7ab8e8"], [2, "#83d6c2"], [3, "#f0cf72"]] as const) {
      const material = new StandardMaterial(`veteran-rank-${rank}`, this.scene);
      material.diffuseColor = Color3.FromHexString(color);
      material.emissiveColor = material.diffuseColor.scale(0.8);
      material.alpha = 0.82; material.disableLighting = true;
      this.veteranMaterials.set(rank, material);
    }
    this.livingMazeMaterial = new StandardMaterial("living-maze-path-influence", this.scene);
    this.livingMazeMaterial.diffuseColor = Color3.FromHexString("#64c58b");
    this.livingMazeMaterial.emissiveColor = Color3.FromHexString("#2d8e62");
    this.livingMazeMaterial.alpha = 0.14; this.livingMazeMaterial.disableLighting = true;
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
      const realDeltaSeconds = Math.max(0, (now - this.lastFrameTime) / 1000);
      this.recordFrameTime(realDeltaSeconds * 1000);
      // Keep gameplay integration capped after a long frame, but pass true wall-clock
      // time separately so UI/warning gates expire after their intended duration.
      const simulationDeltaSeconds = this.simulationClock.toSimulationDelta(Math.min(realDeltaSeconds, 0.1));
      if (!this.simulationClock.isPaused) gameState.update(simulationDeltaSeconds, realDeltaSeconds);
      this.simulationTimeSeconds += simulationDeltaSeconds;
      this.lastFrameTime = now;
      this.sync(gameState, simulationDeltaSeconds, !this.simulationClock.isPaused);
      this.updateBuildVisual(now, Math.min(realDeltaSeconds, 0.1));
      this.enforceCameraSafety();
      this.updateCameraDebugOverlay();
      onSync?.(gameState);
      this.scene.render();
      if (!this.hasRenderedFirstFrame) {
        this.hasRenderedFirstFrame = true;
        performance.mark("tower-defence-first-battlefield-frame");
      }
      this.updatePerformanceDebug(gameState, now);
    });
  }

  getGameSpeedMultiplier(): GameSpeedMultiplier { return this.simulationClock.speedMultiplier; }
  get areDefenderAssetsReady(): boolean { return this.defenderAssetsReady; }
  isPaused(): boolean { return this.simulationClock.isPaused; }
  setPaused(paused: boolean): void { this.simulationClock.setPaused(paused); }

  /** Projects the visible ground footprint into logical grid space for the minimap. */
  getApproximateMinimapView(): MinimapCameraView {
    const renderWidth = this.engine.getRenderWidth();
    const renderHeight = this.engine.getRenderHeight();
    // The camera target is the actual center of the view. Using the center ray here
    // made the minimap susceptible to backend ray/projection differences and could
    // mirror the marker horizontally at the fixed RTS camera angle.
    const logicalCenter = groundPointToLogicalMap(this.camera.target, TILE_SIZE_3D);
    const screenCorners = [
      [0, 0], [renderWidth, 0], [renderWidth, renderHeight], [0, renderHeight],
    ] as const;
    const groundCorners = screenCorners
      .map(([x, y]) => this.groundPointAtRenderPoint(x, y))
      .filter((point): point is Vector3 => point !== undefined)
      .map(({ x, z }) => ({ x, z }));
    // The corners provide the visible ground footprint without the large
    // perspective overestimate produced by extending a single edge ray.
    const bounds = groundCorners.length === screenCorners.length
      ? (() => {
        const rawX = groundCorners.map(({ x }) => x / TILE_SIZE_3D);
        const rawY = groundCorners.map(({ z }) => z / TILE_SIZE_3D);
        const minX = Math.max(0, Math.min(this.map.width, Math.min(...rawX)));
        const maxX = Math.max(0, Math.min(this.map.width, Math.max(...rawX)));
        const minY = Math.max(0, Math.min(this.map.height, Math.min(...rawY)));
        const maxY = Math.max(0, Math.min(this.map.height, Math.max(...rawY)));
        return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
      })()
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
    await Promise.allSettled([...this.pendingInitialization, ...this.pendingEnemyPreloads]);
    this.combatEffects.clear();
    for (const visual of this.towerVisuals.values()) this.disposeTowerVisual(visual);
    this.towerVisuals.clear();
    for (const visual of this.enemyVisuals.values()) this.disposeEnemyVisual(visual);
    this.enemyVisuals.clear();
    for (const visual of this.enemyDeathVisuals.values()) this.disposeEnemyVisual(visual);
    this.enemyDeathVisuals.clear();
    for (const label of this.enemyVisualDebugLabels.values()) label.dispose();
    this.enemyVisualDebugLabels.clear();
    for (const visual of this.veteranVisuals.values()) visual.meshes.forEach((mesh) => mesh.dispose(false, false));
    this.veteranVisuals.clear();
    for (const mesh of this.livingMazeVisuals.values()) mesh.dispose(false, false);
    this.livingMazeVisuals.clear();
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

  setBuildDefenderType(type: DefenderType | undefined): void {
    this.buildDefenderType = type;
    if (type !== undefined) return;
    this.highlight.isVisible = false;
    this.highlightOutline.isVisible = false;
    this.buildVisualUntil = 0;
    this.lastPreviewCellKey = "";
  }

  /** Preloads only enemy visuals used now or in the next four scheduled waves. */
  private preloadEnemyAssetsForWave(wave: number): void {
    if (wave <= this.lastEnemyPreloadWave) return;
    this.lastEnemyPreloadWave = wave;
    const types = new Set<EnemyType>();
    for (let upcomingWave = wave; upcomingWave < wave + 5; upcomingWave += 1) {
      for (const entry of getWaveComposition(upcomingWave).entries) types.add(entry.type);
    }
    this.requestEnemyVisualTypes([...types]);
  }

  private requestEnemyVisualTypes(types: readonly EnemyType[]): void {
    const missing = types.filter((type) => !this.requestedEnemyVisualTypes.has(type));
    if (missing.length === 0) return;
    for (const type of missing) this.requestedEnemyVisualTypes.add(type);
    const pending = this.quaterniusEnemyFactory.load(missing).catch((error: unknown) => {
      if (!this.disposed) console.warn("Enemy visual preload failed; primitive visuals will be used.", { types: missing, error });
    });
    this.pendingEnemyPreloads.add(pending);
    void pending.then(() => this.pendingEnemyPreloads.delete(pending));
  }

  /** Keeps renderer and UI selection in sync for pointer input and explicit UI deselection. */
  selectTower(towerId?: number): void {
    const exists = towerId === undefined || this.gameState?.towers.some((tower) => tower.id === towerId);
    this.selectedTowerId = exists ? towerId : undefined;
    if (this.selectedTowerId === undefined) {
      this.selectedTowerRing.isVisible = false;
      this.selectedTowerMarker.isVisible = false;
    } else if (this.gameState) {
      this.updateSelectedTowerIndicator(this.gameState);
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

  /** Small presentation audit hook used by the browser smoke test. */
  getFormationVisualDebug(): Array<{ towerId: number; formationId: FormationId; markerCount: number; hasGroundRing: boolean }> {
    return [...this.formationVisuals].map(([towerId, visual]) => ({
      towerId,
      formationId: visual.id,
      markerCount: visual.meshes.length,
      hasGroundRing: visual.meshes.some((mesh) => mesh.name.startsWith("formation-rune-")),
    }));
  }

  getEnemyAnimationDebugState(): object {
    const animated = (id: number, visual: EnemyVisual) => "animation" in visual && visual.animation ? {
      id, type: visual.animation.enemyType, assetPath: visual.animation.assetPath,
      state: visual.animation.currentState, clip: visual.animation.currentClipName,
      speed: visual.animation.currentPlaybackSpeed,
      effectiveGameplaySpeedCellsPerSecond: visual.animation.effectiveGameplaySpeedCellsPerSecond,
      frame: visual.animation.currentFrame, isPlaying: visual.animation.isPlaying, loops: visual.animation.isLooping,
      activeGroups: visual.animation.activeGroupCount,
      rotationY: visual.root.rotation.y,
      position: { x: visual.root.position.x, y: visual.root.position.y, z: visual.root.position.z },
    } : undefined;
    const enemyTypesById = new Map(this.gameState?.enemies.map((enemy) => [enemy.id, enemy.type]));
    return {
      active: [...this.enemyVisuals].map(([id, visual]) => animated(id, visual)).filter(Boolean),
      dying: [...this.enemyDeathVisuals].map(([id, visual]) => animated(id, visual)).filter(Boolean),
      activeVisuals: [...this.enemyVisuals].map(([id, visual]) => {
        const type = enemyTypesById.get(id);
        return {
          id, type, assetPath: type ? this.quaterniusEnemyFactory.getLoadedAssetPath(type) : undefined,
          animated: "animation" in visual && Boolean(visual.animation),
        };
      }),
      skeletons: this.scene.skeletons.length,
      animationGroups: this.scene.animationGroups.length,
      activeAnimationGroups: this.scene.animationGroups.filter((group) => group.isStarted).length,
      meshCount: this.scene.meshes.length,
      affixIconCount: [...this.enemyAffixVisuals.values()].reduce((count, visual) => count + visual.icons.length, 0),
      shieldBarCount: this.enemyShieldBars.size,
      slowIndicatorCount: this.enemySlowIndicators.size,
      fps: Math.round(this.engine.getFps()),
      frameTimeMs: Number(this.averageFrameTimeMs().toFixed(2)),
    };
  }

  /** Test-only, presentation-only death trigger available under ?enemyAnimationDebug=1. */
  debugBeginEnemyDeathVisual(id: number): boolean {
    return this.enemyAnimationDebug && this.beginEnemyDeathVisual(id);
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
      buildMode: this.gameState?.waveActive ? `LOCKED · ${this.buildDefenderType ?? "SELECT"}` : this.buildDefenderType ?? "SELECT",
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
    for (const visual of this.enemyDeathVisuals.values()) this.disposeEnemyVisual(visual);
    this.enemyDeathVisuals.clear();
    this.resetCameraView();
    void this.selectNextEnvironmentTheme();
  }

  /** Mirrors portable Enemy state into Babylon meshes without changing gameplay state. */
  sync(gameState: GameState, deltaSeconds = 0, processAttackEvents = true): void {
    this.preloadEnemyAssetsForWave(gameState.currentWave);
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
    this.syncFormationVisuals(gameState);
    this.syncSpecializationVisuals(gameState);
    this.syncVeteranVisuals(gameState);
    this.syncLivingMazeVisuals(gameState);
    this.updateSelectedTowerRange(gameState);
    this.updateSelectedTowerIndicator(gameState);
    if (processAttackEvents) this.beginEnemyDeathVisuals(gameState);
    const activeIds = this.activeEnemyIds;
    activeIds.clear();
    for (const enemy of gameState.enemies) {
      if (!enemy.alive) continue;
      activeIds.add(enemy.id);
      if (this.disableEnemyVisuals) continue;
      let visual = this.enemyVisuals.get(enemy.id);
      if (!visual) {
        const waitingForImportedEnemy = !this.quaterniusEnemyFactory.hasTemplate(enemy.type)
          && !this.quaterniusEnemyFactory.isTypeLoadCompleted(enemy.type);
        if (waitingForImportedEnemy) this.requestEnemyVisualTypes([enemy.type]);
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
        visual.root.scaling.scaleInPlace(VISUAL_CONFIG.unitVisualScaleMultiplier);
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
      const speedMultiplier = getEnemySpeedMultiplier(enemy) * getCommanderAuraMultiplier(enemy, gameState.enemies)
        * this.simulationClock.speedMultiplier;
      const effectiveGameplaySpeed = enemy.speed * speedMultiplier;
      this.updateEnemyVisual(visual, enemy, speedMultiplier, effectiveGameplaySpeed);
      if ("animation" in visual) visual.animation?.setPaused(this.simulationClock.isPaused);
      this.syncEnemyAffixVisual(enemy.id, enemy, visual.root, visual.healthBack.position.y);
    }
    for (const [id, visual] of this.enemyVisuals) {
      if (activeIds.has(id)) continue;
      this.disposeEnemyVisual(visual);
      this.enemyVisuals.delete(id);
      this.enemyAffixVisuals.delete(id);
      this.enemyShieldBars.delete(id);
      this.enemySlowIndicators.get(id)?.dispose(false, false);
      this.enemySlowIndicators.delete(id);
      this.enemyVisualDebugLabels.get(id)?.dispose();
      this.enemyVisualDebugLabels.delete(id);
      if (this.enemyVisualDebug) {
        const debugWindow = window as Window & { __enemyVisualDebugLabels?: Record<number, string> };
        if (debugWindow.__enemyVisualDebugLabels) delete debugWindow.__enemyVisualDebugLabels[id];
      }
    }
    for (const [id, visual] of this.enemyDeathVisuals) {
      if ("animation" in visual) visual.animation?.setPaused(this.simulationClock.isPaused);
      if (!("animation" in visual) || !visual.animation?.isFinished) continue;
      this.disposeEnemyVisual(visual);
      this.enemyDeathVisuals.delete(id);
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
    const frameTimeMs = this.averageFrameTimeMs();
    const defenderTriangles: Partial<Record<DefenderType, number>> = {};
    for (const tower of gameState.towers) {
      const visual = this.towerVisuals.get(tower.id);
      if (!visual) continue;
      const triangles = visual.root.getChildMeshes().reduce((sum, mesh) => sum + (mesh.getTotalIndices() ?? 0) / 3, 0);
      defenderTriangles[tower.type] = (defenderTriangles[tower.type] ?? 0) + triangles;
    }
    const debugWindow = window as Window & { __enemySceneStats?: object };
    debugWindow.__enemySceneStats = {
      sceneMeshes: this.scene.meshes.length,
      materials: this.scene.materials.length,
      textures: this.scene.textures.length,
      enemyVisuals: this.enemyVisuals.size,
      visibleByType,
      modelMeshCount,
      trianglesByType,
      totalEnemyTriangles: Object.values(trianglesByType).reduce((sum, value) => sum + value, 0),
      defenderTriangles,
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
    const activeIds = this.activeTowerIds;
    activeIds.clear();
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

  private syncFormationVisuals(gameState: GameState): void {
    const activeIds = this.activeFormationIds;
    activeIds.clear();
    for (const tower of gameState.towers) {
      const visual = this.towerVisuals.get(tower.id);
      const existing = this.formationVisuals.get(tower.id);
      if (!visual || !tower.formationId) {
      existing?.meshes.forEach((mesh) => mesh.dispose(false, false));
        this.formationVisuals.delete(tower.id);
        continue;
      }
      activeIds.add(tower.id);
      if (existing?.id === tower.formationId && existing.meshes.every((mesh) => mesh.parent === visual.root)) continue;
      existing?.meshes.forEach((mesh) => mesh.dispose(false, false));
      const material = this.formationMaterials.get(tower.formationId)!;
      // Four tiny, formation-colored jewels keep the buff local without painting
      // a large circle across the build grid or competing with the selection ring.
      const marks = [0, 1, 2, 3].map((index) => {
        const angle = index * Math.PI / 2;
        const mark = MeshBuilder.CreatePolyhedron(`formation-mark-${tower.id}-${index}`, { type: 1, size: 0.085 }, this.scene);
        mark.parent = visual.root;
        mark.position.set(Math.cos(angle) * 0.27, 0.045, Math.sin(angle) * 0.27);
        mark.rotation.y = angle;
        mark.material = material;
        mark.isPickable = false;
        mark.renderingGroupId = 1;
        return mark;
      });
      this.formationVisuals.set(tower.id, { id: tower.formationId, meshes: marks });
    }
    for (const [id, visual] of this.formationVisuals) {
      if (activeIds.has(id)) continue;
      visual.meshes.forEach((mesh) => mesh.dispose(false, false));
      this.formationVisuals.delete(id);
    }
  }

  private syncSpecializationVisuals(gameState: GameState): void {
    const activeIds = this.activeSpecializationIds;
    activeIds.clear();
    for (const tower of gameState.towers) {
      const specialization = getSpecialization(tower.specializationId);
      const visual = this.towerVisuals.get(tower.id);
      const existing = this.specializationVisuals.get(tower.id);
      if (!specialization || !visual) {
        existing?.mesh.dispose(false, false); this.specializationVisuals.delete(tower.id); continue;
      }
      activeIds.add(tower.id);
      if (existing?.id === specialization.id && existing.mesh.parent === visual.root) continue;
      existing?.mesh.dispose(false, false);
      const aura = MeshBuilder.CreateTorus(`specialization-aura-${tower.id}`, { diameter: 0.57, thickness: 0.045, tessellation: 24 }, this.scene);
      aura.parent = visual.root; aura.position.y = 0.044; aura.material = this.specializationMaterials.get(specialization.id)!; aura.isPickable = false;
      this.specializationVisuals.set(tower.id, { id: specialization.id, mesh: aura });
    }
    for (const [id, visual] of this.specializationVisuals) {
      if (activeIds.has(id)) continue;
      visual.mesh.dispose(false, false); this.specializationVisuals.delete(id);
    }
  }

  private syncVeteranVisuals(gameState: GameState): void {
    const activeIds = new Set<number>();
    for (const tower of gameState.towers) {
      const visual = this.towerVisuals.get(tower.id);
      const rank = gameState.factionId === "arcane-kingdom" ? getVeteranProgress(gameState.factionId, tower).rank : 0;
      const existing = this.veteranVisuals.get(tower.id);
      if (!visual || rank === 0) {
        existing?.meshes.forEach((mesh) => mesh.dispose(false, false));
        this.veteranVisuals.delete(tower.id);
        continue;
      }
      activeIds.add(tower.id);
      if (existing?.rank === rank && existing.meshes.every((mesh) => mesh.parent === visual.root)) continue;
      existing?.meshes.forEach((mesh) => mesh.dispose(false, false));
      const marks = Array.from({ length: rank }, (_, index) => {
        const mark = MeshBuilder.CreatePolyhedron(`veteran-mark-${tower.id}-${index}`, { type: 1, size: 0.105 }, this.scene);
        mark.parent = visual.root;
        mark.position.set((index - (rank - 1) / 2) * 0.15, 0.52 + rank * 0.025, 0);
        mark.material = this.veteranMaterials.get(rank)!;
        mark.isPickable = false;
        mark.renderingGroupId = 2;
        return mark;
      });
      this.veteranVisuals.set(tower.id, { rank, meshes: marks });
    }
    for (const [id, visual] of this.veteranVisuals) {
      if (activeIds.has(id)) continue;
      visual.meshes.forEach((mesh) => mesh.dispose(false, false));
      this.veteranVisuals.delete(id);
    }
  }

  private syncLivingMazeVisuals(gameState: GameState): void {
    const cells = gameState.factionId === "ancient-grove" ? gameState.factionBonuses.getLivingMazeInfluencedCells() : [];
    const signature = cells.map(({ x, y }) => `${x},${y}`).sort().join("|");
    if (signature === this.livingMazeVisualSignature) return;
    this.livingMazeVisualSignature = signature;
    for (const mesh of this.livingMazeVisuals.values()) mesh.dispose(false, false);
    this.livingMazeVisuals.clear();
    for (const cell of cells) {
      const point = gridToWorld3D(cell);
      const mesh = MeshBuilder.CreateGround(`living-maze-cell-${cell.x}-${cell.y}`, { width: 0.76, height: 0.76 }, this.scene);
      mesh.position.set(point.x, 0.024, point.z);
      mesh.material = this.livingMazeMaterial;
      mesh.isPickable = false;
      mesh.renderingGroupId = 1;
      this.livingMazeVisuals.set(`${cell.x},${cell.y}`, mesh);
    }
  }

  private syncEnemyAffixVisual(enemyId: number, enemy: GameState["enemies"][number], root: TransformNode, hpBarY: number): void {
    const signature = enemy.affixes.map(({ id, tier }) => `${id}:${tier}`).join("|");
    let visual = this.enemyAffixVisuals.get(enemyId);
    if (visual?.signature !== signature) {
      visual?.icons.forEach((icon) => icon.dispose(false, false));
      const icons = enemy.affixes.slice(0, 2).map(({ id }, index) => {
        const icon = MeshBuilder.CreatePlane(`enemy-affix-${id}-${enemyId}`, { width: 0.22, height: 0.22 }, this.scene);
        icon.parent = root; icon.position.set((index - (Math.min(enemy.affixes.length, 2) - 1) / 2) * 0.26, hpBarY + 0.25, 0);
        icon.billboardMode = Mesh.BILLBOARDMODE_ALL; icon.material = this.affixMaterials.get(id)!; icon.isPickable = false; icon.renderingGroupId = 2;
        return icon;
      });
      visual = { signature, icons };
      this.enemyAffixVisuals.set(enemyId, visual);
    }
    if (enemy.maxShield > 0 && !this.enemyShieldBars.has(enemyId)) {
      const back = MeshBuilder.CreatePlane(`enemy-shield-back-${enemyId}`, { width: 0.72, height: 0.055 }, this.scene);
      const fill = MeshBuilder.CreatePlane(`enemy-shield-fill-${enemyId}`, { width: 0.68, height: 0.035 }, this.scene);
      back.parent = root; fill.parent = root;
      back.position.set(0, hpBarY + 0.11, 0.005); fill.position.set(0, hpBarY + 0.11, -0.006);
      back.billboardMode = Mesh.BILLBOARDMODE_ALL; fill.billboardMode = Mesh.BILLBOARDMODE_ALL;
      back.material = this.shieldBackMaterial; fill.material = this.shieldFillMaterial;
      back.isPickable = false; fill.isPickable = false; back.renderingGroupId = 1; fill.renderingGroupId = 2;
      this.enemyShieldBars.set(enemyId, { back, fill });
    }
    const shield = this.enemyShieldBars.get(enemyId);
    if (shield) {
      const ratio = enemy.maxShield > 0 ? Math.max(0, Math.min(1, enemy.shield / enemy.maxShield)) : 0;
      shield.fill.setEnabled(ratio > 0);
      shield.fill.scaling.x = ratio;
      shield.fill.position.x = -0.34 + ratio * 0.34;
    }
    let slowIndicator = this.enemySlowIndicators.get(enemyId);
    const livingMazeSlowed = enemy.livingMazeExposureSeconds > 0;
    if (enemy.slowSecondsRemaining > 0 || livingMazeSlowed) {
      if (!slowIndicator) {
        slowIndicator = MeshBuilder.CreateTorus(`enemy-frost-slow-${enemyId}`, { diameter: 0.64, thickness: 0.035, tessellation: 20 }, this.scene);
        slowIndicator.parent = root; slowIndicator.position.y = 0.045;
        slowIndicator.isPickable = false; slowIndicator.renderingGroupId = 1;
        this.enemySlowIndicators.set(enemyId, slowIndicator);
      }
      slowIndicator.material = livingMazeSlowed ? this.enemyMazeSlowMaterial : this.enemySlowMaterial;
      slowIndicator.setEnabled(true);
    } else if (slowIndicator) {
      slowIndicator.setEnabled(false);
    }
  }

  private updateSelectedTowerRange(gameState: GameState): void {
    const selected = gameState.towers.find((tower) => tower.id === this.selectedTowerId);
    const showCircle = Boolean(selected && !DEFENDER_CONFIG[selected.type].supportsMapWideTargeting
      && (selected.rangeMode === "circular" || selected.rangeMode === "hybrid"));
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
      const specialization = event.specializationId ? TOWER_SPECIALIZATIONS[event.specializationId] : undefined;
      if (event.effectKind === "chain") {
        const source = gridToWorld3D({ x: event.sourceX, y: event.sourceY });
        this.combatEffects.showLightningArc(new Vector3(source.x, 0.82, source.z), targetPosition, specialization?.visualColor);
        continue;
      }
      if (event.isSplash) {
        if (event.defenderType === "holy-emperor") this.combatEffects.showWarImpact(targetPosition, false);
        else this.combatEffects.showSplashHit(targetPosition);
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
      if (event.defenderType === "holy-emperor") {
        this.combatEffects.showWarImpact(targetPosition, event.enemyDied);
        continue;
      }
      const attackOrigin = "attackOrigin" in tower ? tower.attackOrigin : "arrowOrigin" in tower ? tower.arrowOrigin : undefined;
      if (!attackOrigin) continue;
      const originPosition = attackOrigin.getAbsolutePosition();
      if (event.defenderType === "green-archer") {
        const trail = specialization?.id === "dragon-slayer"
          ? { color: specialization.visualColor, alpha: 0.92 }
          : specialization?.id === "ranger"
            ? { color: specialization.visualColor, alpha: 0.48 }
            : undefined;
        this.combatEffects.showShot(originPosition, targetPosition, event.enemyDied, trail);
        if (specialization?.mark) this.combatEffects.showArcherMark(targetPosition);
        continue;
      }
      if (event.defenderType === "battlemage" && event.attackMode === "melee") {
        this.combatEffects.showMeleeHit(targetPosition, event.enemyDied);
        continue;
      }
      if (specialization?.id === "war-sovereign") this.combatEffects.showWarImpact(targetPosition, event.enemyDied);
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

  private updateEnemyVisual(
    visual: EnemyVisual,
    enemy: GameState["enemies"][number],
    speedMultiplier = 1,
    effectiveGameplaySpeed = enemy.speed * speedMultiplier,
  ): void {
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

    if ("animation" in visual && visual.animation) {
      const isMoving = enemy.speed * speedMultiplier > 0.005 && Boolean(next);
      visual.animation.setState(isMoving ? "moving" : "idle", speedMultiplier, effectiveGameplaySpeed);
    }

    if (this.disableHpBars) return;
    const hpRatio = Math.max(0, Math.min(1, enemy.hp / enemy.maxHp));
    if (!visual.healthBack.isEnabled()) visual.healthBack.setEnabled(true);
    if (!visual.healthFill.isEnabled()) visual.healthFill.setEnabled(true);
    if (Math.abs(visual.lastHpRatio - hpRatio) < 0.0001) return;
    visual.lastHpRatio = hpRatio;
    visual.healthFill.scaling.x = hpRatio;
    visual.healthFill.position.x = -0.34 + hpRatio * 0.34;
  }

  private beginEnemyDeathVisuals(gameState: GameState): void {
    for (const event of gameState.attackEvents) {
      if (!event.enemyDied) continue;
      this.beginEnemyDeathVisual(event.targetEnemyId);
    }
  }

  private beginEnemyDeathVisual(id: number): boolean {
    const visual = this.enemyVisuals.get(id);
    if (!visual || !("animation" in visual) || !visual.animation) return false;
    visual.animation.setState("dying");
    if (visual.animation.currentState !== "dying" || visual.animation.isFinished) return false;
    this.enemyVisuals.delete(id);
    visual.healthBack.setEnabled(false);
    visual.healthFill.setEnabled(false);
    this.enemyDeathVisuals.set(id, visual);
    const affixes = this.enemyAffixVisuals.get(id);
    affixes?.icons.forEach((icon) => icon.dispose());
    this.enemyAffixVisuals.delete(id);
    const shield = this.enemyShieldBars.get(id);
    shield?.back.dispose(); shield?.fill.dispose();
    this.enemyShieldBars.delete(id);
    this.enemySlowIndicators.get(id)?.dispose(false, false);
    this.enemySlowIndicators.delete(id);
    this.enemyVisualDebugLabels.get(id)?.dispose();
    this.enemyVisualDebugLabels.delete(id);
    while (this.enemyDeathVisuals.size > this.maxEnemyDeathVisuals) {
      const oldest = this.enemyDeathVisuals.entries().next().value as [number, EnemyVisual] | undefined;
      if (!oldest) break;
      this.disposeEnemyVisual(oldest[1]);
      this.enemyDeathVisuals.delete(oldest[0]);
    }
    return true;
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
    this.gridOpacity = this.currentTheme.style === "forest" ? 0.19 : VISUAL_CONFIG.gridAlpha;
    const width = this.map.width * TILE_SIZE_3D; const depth = this.map.height * TILE_SIZE_3D;
    const outskirts = MeshBuilder.CreateGround("outskirts-ground", { width: width + 72, height: depth + 72, subdivisions: 1 }, this.scene);
    outskirts.position = new Vector3(width / 2, -0.035, depth / 2);
    const outskirtsMaterial = new StandardMaterial("royal-meadow-outskirts", this.scene);
    outskirtsMaterial.diffuseColor = Color3.White();
    outskirtsMaterial.diffuseTexture = this.arenaArt.outskirtsTexture(this.currentTheme);
    outskirtsMaterial.specularColor = Color3.Black();
    outskirts.material = outskirtsMaterial;
    this.outskirtsGroundMaterial = outskirtsMaterial;
    const ground = MeshBuilder.CreateGround("snowGround", { width, height: depth, subdivisions: 1 }, this.scene);
    ground.position = new Vector3(width / 2, 0, depth / 2);
    const grassAlbedo = this.arenaArt.playableGroundTexture(this.currentTheme);
    const grass = new PBRMaterial(this.currentTheme.style === "forest" ? "forest-clearing-grass-earth-pbr" : "royal-grass-packed-earth-pbr", this.scene);
    const grassNormal = this.arenaArt.playableGroundNormal(this.currentTheme);
    grass.albedoColor = this.currentTheme.playableGround;
    grass.albedoTexture = grassAlbedo;
    grass.bumpTexture = grassNormal;
    grass.bumpTexture.level = 0.12;
    grass.metallicTexture = this.arenaArt.playableGroundRoughness(this.currentTheme);
    grass.useRoughnessFromMetallicTextureGreen = true;
    grass.useMetallnessFromMetallicTextureBlue = true;
    grass.roughness = 0.96;
    grass.metallic = 0;
    ground.material = grass;
    ground.receiveShadows = true;
    this.playableGroundMaterial = grass;
    const lines: Vector3[][] = [];
    for (let x = 0; x <= this.map.width; x += 1) lines.push([new Vector3(x, 0.012, 0), new Vector3(x, 0.012, depth)]);
    for (let z = 0; z <= this.map.height; z += 1) lines.push([new Vector3(0, 0.012, z), new Vector3(width, 0.012, z)]);
    this.createGridLayer("grid", lines);
    const raisedGridLines = mergeTerrainGridLines(this.map.terrainRegions.flatMap((region) => region.cells), TERRAIN_PLATEAU_HEIGHT + 0.008);
    this.createGridLayer("terrain-grid-top", raisedGridLines);

    const terrain = new TerrainCliffRenderer(this.scene, grassAlbedo, grassNormal, width, depth, this.currentTheme.style);
    const terrainStats = terrain.render(this.map.terrainRegions);
    if (this.terrainArtDebug) {
      const report: {
        map: MapDefinition["id"];
        themeId: string;
        themeStyle: EnvironmentTheme["style"];
        groundMaterial: string;
        cliffTopMaterial: string;
        cliffSideMaterial: string;
        cliffLipMaterial: string;
        terrainRegionCount: number;
        renderedFormationCount: number;
        terrainMeshCount: number;
        plateauHeight: number;
        gridLineCount: number;
        terrainGridLineCount: number;
        gridOpacity: number;
        buildGridOpacity: number;
        texturesReady: boolean;
        environmentReady: boolean;
        environmentComposition?: ReturnType<WinterArenaArt["compositionStats"]>;
        groundTextures: typeof terrainStats.groundTextureNames;
        cliffTextures: typeof terrainStats.cliffTextureNames;
        terrainMeshes: Array<{ name: string; enabled: boolean; visible: boolean; vertices: number }>;
      } = {
        map: this.map.id,
        themeId: this.currentTheme.id,
        themeStyle: this.currentTheme.style,
        groundMaterial: grass.name,
        cliffTopMaterial: this.currentTheme.style === "forest" ? "forest-rock-ridge-top" : "royal-cliff-stone-top",
        cliffSideMaterial: this.currentTheme.style === "forest" ? "forest-natural-boulder-face" : "royal-cliff-natural-rock-face",
        cliffLipMaterial: this.currentTheme.style === "forest" ? "forest-rock-earth-edge" : "royal-cliff-earth-edge",
        terrainRegionCount: this.map.terrainRegions.length,
        renderedFormationCount: terrainStats.formationCount,
        terrainMeshCount: terrainStats.meshCount,
        plateauHeight: terrainStats.plateauHeight,
        gridLineCount: lines.length,
        terrainGridLineCount: raisedGridLines.length,
        gridOpacity: this.gridOpacity,
        buildGridOpacity: VISUAL_CONFIG.buildGridAlpha,
        texturesReady: grassAlbedo.isReady(),
        environmentReady: false,
        groundTextures: terrainStats.groundTextureNames,
        cliffTextures: terrainStats.cliffTextureNames,
        terrainMeshes: this.scene.meshes.filter((mesh) => mesh.name.startsWith("snow-cliff-formation-")).map((mesh) => ({
          name: mesh.name,
          enabled: mesh.isEnabled(),
          visible: mesh.isVisible,
          vertices: mesh.getTotalVertices(),
        })),
      };
      (window as Window & { __terrainArtDebug?: typeof report }).__terrainArtDebug = report;
      console.info("Terrain art debug", report);
      const readyObserver = this.scene.onAfterRenderObservable.add(() => {
        if (!grassAlbedo.isReady()) return;
        report.texturesReady = true;
        this.scene.onAfterRenderObservable.remove(readyObserver);
        console.info("Terrain textures ready", report);
      });
    }
  }

  /** Places cached glTF environment art; a per-asset primitive remains only as a load-failure fallback. */
  private async createArenaArt(): Promise<void> {
    await this.environmentAssets.preload(this.arenaArt.requiredAssetKeys(this.currentTheme));
    if (this.disposed) return;
    this.arenaArt.perimeter(this.currentTheme, [
      ...this.map.layout.activeSpawns.map(({ gateCell, side }) => ({ x: gateCell.x, z: gateCell.y, side })),
      { x: this.map.layout.castle.gateCell.x, z: this.map.layout.castle.gateCell.y, side: this.map.layout.castle.side },
    ]);
    if (this.currentTheme.style === "castle") this.arenaArt.warmOutskirtsAccents();
    const red = this.material("spawn-ember", this.currentTheme.spawnAccent,
      this.currentTheme.spawnAccent.scale(VISUAL_CONFIG.spawnGlowStrength));
    const gold = this.material("exit-gold", this.currentTheme.exitAccent,
      this.currentTheme.exitAccent.scale(VISUAL_CONFIG.exitGlowStrength));
    this.spawnAccentMaterial = red; this.exitAccentMaterial = gold;
    red.backFaceCulling = false; red.alpha = 0.36;
    gold.backFaceCulling = false; gold.alpha = 0.5;
    this.spawnZoneMaterial = this.material("spawn-zone-material", this.currentTheme.spawnAccent);
    for (const spawn of this.map.layout.activeSpawns) {
      const point = gridToWorld3D(spawn.entryCell);
      this.zoneMarker(`spawn-zone-${spawn.id}`, point.x, point.z, this.currentTheme.spawnAccent, this.spawnZoneMaterial);
      this.createEndpointVisual(`spawn-${spawn.id}`, point.x, point.z, red, this.currentTheme.spawnAccent, spawn.side);
    }
    const goal = gridToWorld3D(this.map.layout.castle.approachCell);
    this.exitZoneMaterial = this.zoneMarker("castle-zone", goal.x, goal.z, this.currentTheme.exitAccent);
    this.createEndpointVisual("exit", goal.x, goal.z, gold, this.currentTheme.exitAccent, this.map.layout.castle.side);
    this.environmentReady = true;
    if (this.terrainArtDebug) {
      const terrainDebug = (window as Window & { __terrainArtDebug?: {
        environmentReady: boolean;
        environmentComposition?: ReturnType<WinterArenaArt["compositionStats"]>;
        environmentRendering?: ReturnType<EnvironmentAssetLibrary["renderingStats"]>;
      } }).__terrainArtDebug;
      if (terrainDebug) {
        terrainDebug.environmentReady = true;
        terrainDebug.environmentComposition = this.arenaArt.compositionStats(this.currentTheme);
        terrainDebug.environmentRendering = this.environmentAssets.renderingStats();
      }
    }
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
    this.currentTheme = themeForRun(this.presentationSeed + this.themeRunOrdinal, this.factionId);
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
    this.sky.diffuse.copyFrom(Color3.Lerp(theme.ambientTint, VISUAL_CONFIG.royalAmbientColor, 0.24));
    this.playableGroundMaterial?.albedoColor.copyFrom(theme.playableGround);
    if (this.playableGroundMaterial) {
      this.playableGroundMaterial.albedoTexture = this.arenaArt.playableGroundTexture(theme);
      this.playableGroundMaterial.bumpTexture = this.arenaArt.playableGroundNormal(theme);
      this.playableGroundMaterial.metallicTexture = this.arenaArt.playableGroundRoughness(theme);
    }
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

    // Forest scenery stays identical for a given map across reloads and run resets.
    // Castle keeps its existing run-to-run presentation variation.
    const compositionSeed = this.currentTheme.style === "forest"
      ? stablePresentationSeed(`forest:${this.map.id}`)
      : this.presentationSeed + this.themeRunOrdinal;
    this.themeProps.push(...this.arenaArt.clusters(this.currentTheme,
      compositionSeed, this.map.terrainRegions));
    if (this.terrainArtDebug) {
      const report = (window as Window & { __terrainArtDebug?: {
        environmentComposition?: ReturnType<WinterArenaArt["compositionStats"]>;
        environmentRendering?: ReturnType<EnvironmentAssetLibrary["renderingStats"]>;
      } }).__terrainArtDebug;
      if (report) {
        report.environmentComposition = this.arenaArt.compositionStats(this.currentTheme);
        report.environmentRendering = this.environmentAssets.renderingStats();
      }
    }
  }

  /** One thin vertex-alpha line overlay for the playfield and one for raised blocked cells. */
  private createGridLayer(name: string, lines: Vector3[][]): void {
    if (lines.length === 0) return;
    const color = VISUAL_CONFIG.gridColor;
    const colors = lines.map((line) => line.map(() => new Color4(color.r, color.g, color.b, this.gridOpacity)));
    const mesh = MeshBuilder.CreateLineSystem(name, { lines, colors, useVertexAlpha: true }, this.scene);
    mesh.isPickable = false;
    mesh.setEnabled(true);
    this.gridLayers.push({ mesh, vertexColors: Array.from(mesh.getVerticesData(VertexBuffer.ColorKind) ?? []) });
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
    if (!start.startTarget) return;
    // Project both points through the camera pose from pointer-down. Recomputing
    // the current ray from the already-panned camera would damp long drags.
    const liveTarget = this.camera.target.clone();
    this.camera.target.copyFrom(start.startTarget);
    this.camera.computeWorldMatrix();
    const current = this.groundPointAt(clientX, clientY);
    this.camera.target.copyFrom(liveTarget);
    this.camera.computeWorldMatrix();
    const zoomScale = this.camera.radius / VISUAL_CONFIG.defaultCameraRadius;
    const panScale = VISUAL_CONFIG.cameraPanSpeed * Math.pow(zoomScale, VISUAL_CONFIG.cameraPanZoomMultiplier);
    if (anchor && current) {
      this.camera.target.x = start.startTarget.x + (anchor.x - current.x) * panScale;
      this.camera.target.z = start.startTarget.z + (anchor.z - current.z) * panScale;
    } else {
      // Some mobile browsers cannot intersect the touch ray with the ground
      // near the edge of the canvas or while crossing elevated terrain. Keep
      // one-finger navigation usable by deriving a stable world-space delta
      // from the camera basis instead of dropping the gesture entirely.
      const bounds = this.canvas.getBoundingClientRect();
      const renderHeight = Math.max(1, this.engine.getRenderHeight());
      const cssHeight = Math.max(1, bounds.height);
      const pixelsPerWorldUnit = renderHeight / (2 * this.camera.radius * Math.tan(this.camera.fov / 2));
      const worldUnitsPerCssPixel = 1 / Math.max(1, pixelsPerWorldUnit * renderHeight / cssHeight);
      const deltaX = clientX - start.startX;
      const deltaY = clientY - start.startY;
      const right = this.camera.getDirection(Vector3.Right());
      const up = this.camera.getDirection(Vector3.Up());
      right.y = 0;
      up.y = 0;
      if (right.lengthSquared() > 1e-6) right.normalize();
      if (up.lengthSquared() > 1e-6) up.normalize();
      this.camera.target.x = start.startTarget.x + (-right.x * deltaX - up.x * deltaY) * worldUnitsPerCssPixel * panScale;
      this.camera.target.z = start.startTarget.z + (-right.z * deltaX - up.z * deltaY) * worldUnitsPerCssPixel * panScale;
    }
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
    if (this.gridLayers.length > 0) {
      const idleGridAlpha = this.currentTheme.style === "forest" ? 0.19 : VISUAL_CONFIG.gridAlpha;
      const target = this.isBuildModeVisual ? VISUAL_CONFIG.buildGridAlpha : idleGridAlpha;
      const nextOpacity = this.gridOpacity + (target - this.gridOpacity) * Math.min(1, deltaSeconds * 9);
      if (Math.abs(nextOpacity - this.gridOpacity) > 0.0005) {
        this.gridOpacity = nextOpacity;
        for (const layer of this.gridLayers) {
          for (let index = 3; index < layer.vertexColors.length; index += 4) layer.vertexColors[index] = this.gridOpacity;
          layer.mesh.updateVerticesData(VertexBuffer.ColorKind, layer.vertexColors);
        }
      }
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
    if (!this.buildDefenderType) {
      this.selectTower(undefined);
      this.highlight.isVisible = false;
      this.highlightOutline.isVisible = false;
      this.lastPreviewCellKey = "";
      this.buildVisualUntil = 0;
      this.inputLastAction = "Select tool: empty cell ignored";
      return;
    }
    if (!this.defenderAssetsReady) {
      this.inputLastAction = "Defender visuals are loading; placement is temporarily disabled";
      this.refreshInputDebugOverlay();
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
    if (!this.buildDefenderType) {
      this.highlight.isVisible = false;
      this.highlightOutline.isVisible = false;
      this.lastPreviewCellKey = "";
      this.buildVisualUntil = 0;
      return;
    }
    const cell = this.cellAtPointer(clientX, clientY);
    if (!cell || !this.gameState) return;
    this.buildVisualUntil = performance.now() + VISUAL_CONFIG.buildVisualHoldMs;
    const key = `${cell.x}:${cell.y}`;
    if (key === this.lastPreviewCellKey) return;
    this.lastPreviewCellKey = key;
    const point = gridToWorld3D(cell);
    const color = !this.defenderAssetsReady
      ? VISUAL_CONFIG.invalidPlacementColor
      : this.gameState.towerAt(cell)
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
      case "holy-emperor":
        // Each imported defender uses its own GLB and safe neutral fallback; never a different unit's model.
        visual = this.quaterniusDefenderFactory.create(tower.id, tower.type, tower.level);
        break;
      case "treant":
      case "thorn-owl":
      case "druid":
      case "seer":
        visual = this.quaterniusDefenderFactory.create(tower.id, tower.type, tower.level);
        break;
      default: {
        const unreachableType: never = tower.type;
        throw new Error(`No defender visual mapping for ${unreachableType}`);
      }
    }
    // Apply roster-specific breathing room to visuals only. Placement/world
    // coordinates stay on the unchanged outer root at the exact grid center.
    visual.bodyRoot.scaling.scaleInPlace(
      VISUAL_CONFIG.unitVisualScaleMultiplier * DEFENDER_VISUAL_CONFIG[tower.type].visualScaleMultiplier,
    );
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
      `Meshes ${snapshot.activeMeshes}/${snapshot.meshes} | Draws ${snapshot.drawCalls}`,
      `Skeletons ${snapshot.skeletons} | Env instances ${snapshot.environmentInstances}`,
      `Animations ${snapshot.activeAnimationGroups}/${snapshot.animationGroups}`,
      `Effects ${snapshot.combatEffects} | Arrows ${snapshot.projectiles}`,
      `HP bars ${snapshot.hpBars} | Shadows ${snapshot.shadowCasters}`,
      `Environment props ${snapshot.environmentProps}`,
    ].join("\n");
  }

  private recordFrameTime(milliseconds: number): void {
    if (this.frameTimeSampleCount === this.frameTimeSamples.length) {
      this.frameTimeSampleSum -= this.frameTimeSamples[this.frameTimeSampleCursor];
    } else {
      this.frameTimeSampleCount += 1;
    }
    this.frameTimeSamples[this.frameTimeSampleCursor] = milliseconds;
    this.frameTimeSampleSum += milliseconds;
    this.frameTimeSampleCursor = (this.frameTimeSampleCursor + 1) % this.frameTimeSamples.length;
  }

  private averageFrameTimeMs(): number {
    return this.frameTimeSampleCount > 0 ? this.frameTimeSampleSum / this.frameTimeSampleCount : 0;
  }

  private recordPerformanceSnapshot(phase: PerformanceSnapshot["phase"], gameState: GameState): void {
    const snapshot = this.performanceSnapshot(phase, gameState);
    console.info("Performance snapshot", snapshot);
    const debugWindow = window as Window & { __performanceSnapshots?: PerformanceSnapshot[] };
    (debugWindow.__performanceSnapshots ??= []).push(snapshot);
  }

  private performanceSnapshot(phase: PerformanceSnapshot["phase"], gameState: GameState): PerformanceSnapshot {
    const averageFrameTime = this.averageFrameTimeMs();
    const shadowCasters = this.shadowGenerator.getShadowMap()?.renderList?.length ?? 0;
    const drawCalls = (this.engine as Engine & { _drawCalls?: { current?: number } })._drawCalls?.current ?? 0;
    const environmentRendering = this.environmentAssets.renderingStats();
    return {
      phase,
      wave: gameState.currentWave,
      fps: Math.round(this.engine.getFps()),
      frameTimeMs: Number(averageFrameTime.toFixed(2)),
      enemies: gameState.enemies.length,
      allies: gameState.towers.length,
      meshes: this.scene.meshes.length,
      activeMeshes: this.scene.getActiveMeshes().length,
      drawCalls,
      skeletons: this.scene.skeletons.length,
      animationGroups: this.scene.animationGroups.length,
      activeAnimationGroups: this.scene.animationGroups.filter((group) => group.isStarted).length,
      combatEffects: this.combatEffects.activeEffectCount,
      projectiles: this.combatEffects.activeProjectileCount,
      hpBars: this.scene.meshes.filter((mesh) => mesh.name.includes("health-") && mesh.isEnabled()).length,
      shadowCasters,
      environmentProps: this.themeProps.length,
      environmentTemplateMeshes: environmentRendering.templateMeshes,
      environmentInstances: environmentRendering.instances,
    };
  }
}
