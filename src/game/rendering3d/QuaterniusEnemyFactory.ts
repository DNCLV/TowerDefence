import {
  AbstractMesh, AssetContainer, Color3, Mesh, MeshBuilder, Scene, SceneLoader, ShadowGenerator,
  StandardMaterial, TransformNode,
} from "@babylonjs/core";
import type { EnemyType } from "../config/EnemyConfig";
import { ENEMY_VISUAL_CONFIG } from "./EnemyVisualConfig";
import { resolveAssetUrl } from "../../core/AssetUrl";
import { ENEMY_ANIMATION_CONFIG } from "./EnemyAnimationConfig";
import { EnemyAnimationController } from "./EnemyAnimationController";

export interface QuaterniusEnemyVisual {
  /** Stable movement/placement root; never contains imported scale corrections. */
  root: TransformNode;
  healthBack: Mesh;
  healthFill: Mesh;
  lastHpRatio: number;
  animation?: EnemyAnimationController;
  dispose(): void;
}

interface ModelBounds { width: number; height: number; depth: number; minY: number; }

/** Loads each static GLB once and clones its cached geometry/material references per enemy. */
export class QuaterniusEnemyFactory {
  private readonly templates = new Map<EnemyType, AssetContainer>();
  private readonly loadedAssetPaths = new Map<EnemyType, string>();
  private readonly completedTypes = new Set<EnemyType>();
  private readonly pendingTypeLoads = new Map<EnemyType, Promise<void>>();
  private readonly reportedFallbacks = new Set<EnemyType>();
  private readonly reportedOptimizedFailures = new Set<EnemyType>();
  private readonly healthBack: StandardMaterial;
  private readonly healthFront: StandardMaterial;
  private readonly debugVisuals = new URLSearchParams(window.location.search).get("waveDebug") === "1"
    || new URLSearchParams(window.location.search).get("enemyVisualDebug") === "1";

  constructor(
    private readonly scene: Scene,
    private readonly shadows: ShadowGenerator,
    private readonly castEnemyShadows = false,
  ) {
    this.healthBack = this.material("enemyHealthBack", new Color3(0.24, 0.28, 0.26));
    this.healthFront = this.material("enemyHealthFront", new Color3(0.16, 0.88, 0.28));
  }

  get ready(): boolean { return this.completedTypes.size === Object.keys(ENEMY_VISUAL_CONFIG).length; }
  get isLoadCompleted(): boolean { return this.ready; }
  hasTemplate(type: EnemyType): boolean { return this.templates.has(type); }
  isTypeLoadCompleted(type: EnemyType): boolean { return this.completedTypes.has(type); }
  get cachedModelCount(): number { return this.templates.size; }
  getAssetPath(type: EnemyType): string { return ENEMY_ANIMATION_CONFIG[type]?.assetPath ?? ENEMY_VISUAL_CONFIG[type].assetPath; }
  getLoadedAssetPath(type: EnemyType): string | undefined { return this.loadedAssetPaths.get(type); }

  dispose(): void {
    this.templates.forEach((template) => template.dispose());
    this.templates.clear();
    this.loadedAssetPaths.clear();
    this.completedTypes.clear();
    this.pendingTypeLoads.clear();
    this.healthBack.dispose();
    this.healthFront.dispose();
  }

  /** Loads requested GLBs once; callers can preload only the current/upcoming wave roster. */
  async load(types: readonly EnemyType[] = Object.keys(ENEMY_VISUAL_CONFIG) as EnemyType[]): Promise<void> {
    await Promise.all([...new Set(types)].map((type) => this.loadTypeOnce(type)));
  }

  private loadTypeOnce(type: EnemyType): Promise<void> {
    if (this.completedTypes.has(type)) return Promise.resolve();
    const pending = this.pendingTypeLoads.get(type);
    if (pending) return pending;
    const load = this.loadType(type).finally(() => this.pendingTypeLoads.delete(type));
    this.pendingTypeLoads.set(type, load);
    return load;
  }

  private async loadType(type: EnemyType): Promise<void> {
    try {
      const config = ENEMY_VISUAL_CONFIG[type];
      const animationConfig = ENEMY_ANIMATION_CONFIG[type];
      let loadedPath = animationConfig?.assetPath ?? config.assetPath;
      let container: AssetContainer;
      try {
        container = await this.loadRenderableContainer(loadedPath);
        if (animationConfig) this.validateAnimationTemplate(type, container);
      } catch (error) {
        const preferredReason = error instanceof Error ? error.message : String(error);
        if (!this.reportedOptimizedFailures.has(type)) {
          this.reportedOptimizedFailures.add(type);
          const failureDetails = {
            type,
            preferredPath: loadedPath,
            fallbackPath: animationConfig ? config.assetPath : config.fallbackAssetPath,
            reason: preferredReason,
          };
          console.warn(animationConfig ? "Animated enemy visual failed; trying static runtime model:" : "Optimized enemy visual failed:",
            animationConfig ? JSON.stringify(failureDetails) : failureDetails);
        }
        // Animated assets always fall back to the optimized runtime GLB. Other
        // archetypes retain the existing dev-only source fallback behavior.
        if (!animationConfig && !import.meta.env.DEV) {
          this.reportFallback(type, `optimized asset failed (${preferredReason}); original is development-only`);
          return;
        }
        loadedPath = animationConfig ? config.assetPath : config.fallbackAssetPath;
        try {
          container = await this.loadRenderableContainer(loadedPath);
        } catch (fallbackError) {
          const fallbackReason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          this.reportFallback(type, `preferred asset failed (${preferredReason}); fallback asset failed (${fallbackReason})`);
          return;
        }
      }
      this.templates.set(type, container);
      this.loadedAssetPaths.set(type, loadedPath);
      this.reportTemplateLoaded(type, loadedPath, container);
    } finally {
      this.completedTypes.add(type);
    }
  }

  private async loadRenderableContainer(assetPath: string): Promise<AssetContainer> {
    const resolvedPath = resolveAssetUrl(assetPath);
    const separator = resolvedPath.lastIndexOf("/");
    if (resolvedPath.toLowerCase().endsWith(".fbx")) {
      // The FBX loader is fetched only when an FBX-backed enemy enters the
      // progressive preload window; it does not block initial app boot.
      await import("@babylonjs/loaders/FBX/fbxFileLoader.js");
    }
    const container = await SceneLoader.LoadAssetContainerAsync(
      resolvedPath.slice(0, separator + 1), resolvedPath.slice(separator + 1), this.scene, undefined,
      resolvedPath.toLowerCase().endsWith(".fbx") ? ".fbx" : undefined,
    );
    const renderableMeshes = container.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
    if (renderableMeshes.length === 0 || !renderableMeshes.some((mesh) => mesh.material !== null)) {
      container.dispose();
      throw new Error("GLB has no renderable mesh with a material");
    }
    return container;
  }

  private validateAnimationTemplate(type: EnemyType, container: AssetContainer): void {
    const config = ENEMY_ANIMATION_CONFIG[type];
    if (!config) return;
    const missingClips = Object.entries(config.clips).filter(([, suffix]) =>
      !container.animationGroups.some((group) => group.name === suffix || group.name.endsWith(suffix!)),
    ).map(([state]) => state);
    if (container.skeletons.length === 0 || missingClips.length > 0) {
      const details = { skeletonCount: container.skeletons.length, missingClips };
      container.dispose();
      throw new Error(`Animated asset failed rig/clip validation: ${JSON.stringify(details)}`);
    }
  }

  private reportTemplateLoaded(type: EnemyType, assetPath: string, container: AssetContainer): void {
    if (!this.debugVisuals) return;
    const renderableMeshes = container.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
    const audit = {
      type, assetPath, optimized: assetPath === ENEMY_VISUAL_CONFIG[type].assetPath,
      roots: container.rootNodes.map((node) => node.name),
      meshes: renderableMeshes.map((mesh) => ({
        name: mesh.name,
        vertices: mesh.getTotalVertices(),
        triangles: (mesh.getTotalIndices() ?? 0) / 3,
        hasMaterial: mesh.material !== null,
      })),
      materials: container.materials.map((material) => material.name),
      textures: container.textures.length,
      skeletons: container.skeletons.length,
      animations: container.animationGroups.map((group) => group.name),
      cameras: container.cameras.length,
      lights: container.lights.length,
      cachedModelCount: this.templates.size,
    };
    const debugWindow = window as Window & { __enemyTemplateAudit?: object[] };
    (debugWindow.__enemyTemplateAudit ??= []).push(audit);
    console.info("Enemy GLB loaded", audit);
  }

  create(id: number, type: EnemyType): QuaterniusEnemyVisual | undefined {
    const config = ENEMY_VISUAL_CONFIG[type];
    const animationConfig = ENEMY_ANIMATION_CONFIG[type];
    const loadedAssetPath = this.loadedAssetPaths.get(type) ?? config.assetPath;
    const template = this.templates.get(type);
    if (!template) return undefined;

    const entries = template.instantiateModelsToScene((name) => `enemy-${id}-${type}-${name}`, false);
    const root = new TransformNode(`enemy-world-root-${id}`, this.scene);
    const modelRoot = new TransformNode(`enemy-model-root-${id}`, this.scene);
    entries.rootNodes.forEach((node) => { node.parent = modelRoot; });
    modelRoot.parent = root;
    const usingAnimationAsset = Boolean(animationConfig && loadedAssetPath === animationConfig.assetPath);
    modelRoot.scaling.setAll(usingAnimationAsset ? animationConfig!.modelScale : config.scale);
    modelRoot.rotation.y = usingAnimationAsset ? animationConfig!.rotationY : config.rotationY;
    modelRoot.computeWorldMatrix(true);

    const meshes = root.getChildMeshes();
    const renderableMeshes = meshes.filter((mesh) => mesh.getTotalVertices() > 0);
    if (renderableMeshes.length === 0 || !renderableMeshes.some((mesh) => mesh.material !== null)) {
      this.recordVisualAudit({ status: "rejected", id, type, assetPath: loadedAssetPath, reason: "instance has no renderable materialized mesh" });
      this.disposeInstance(root, entries.animationGroups, entries.skeletons);
      this.reportFallback(type, "GLB instance has no renderable mesh with a material");
      return undefined;
    }
    let bounds = this.combinedBounds(meshes);
    // Position the imported model from its actual rotated/scaled lower bound, not a guessed offset.
    if (Number.isFinite(bounds.minY)) modelRoot.position.y += -bounds.minY + (usingAnimationAsset ? animationConfig!.groundOffsetY : config.groundOffsetY);
    modelRoot.computeWorldMatrix(true);
    bounds = this.combinedBounds(meshes);
    const maxDimension = usingAnimationAsset ? animationConfig!.maxDimension : config.maxDimension;
    if (!this.boundsAreSafe(bounds, maxDimension)) {
      this.recordVisualAudit({ status: "rejected", id, type, assetPath: loadedAssetPath, bounds, maxDimension });
      this.disposeInstance(root, entries.animationGroups, entries.skeletons);
      this.reportFallback(type, `scaled world bounds rejected: ${JSON.stringify(bounds)}`);
      return undefined;
    }
    if (this.debugVisuals) {
      const instanceAudit = {
        id, type, assetPath: loadedAssetPath, optimizedPath: config.assetPath,
        optimized: loadedAssetPath === config.assetPath, scale: usingAnimationAsset ? animationConfig!.modelScale : config.scale, yOffset: config.yOffset,
        rotationY: usingAnimationAsset ? animationConfig!.rotationY : config.rotationY,
        groundOffsetY: usingAnimationAsset ? animationConfig!.groundOffsetY : config.groundOffsetY,
        hpBarOffsetY: usingAnimationAsset ? animationConfig!.hpBarOffsetY : config.hpBarOffsetY, maxDimension,
        bounds: { width: bounds.width, height: bounds.height, depth: bounds.depth, minY: bounds.minY },
        meshCount: meshes.filter((mesh) => mesh.getTotalVertices() > 0).length,
        hierarchyMeshCount: meshes.length,
        cachedModelCount: this.templates.size,
      };
      const debugWindow = window as Window & { __enemyVisualInstances?: object[] };
      (debugWindow.__enemyVisualInstances ??= []).push(instanceAudit);
      this.recordVisualAudit({ status: "accepted", ...instanceAudit });
    }

    // One compact bar: a gray background and a green fill whose width is the HP ratio.
    const healthBack = MeshBuilder.CreatePlane(`enemy-health-back-${id}`, { width: 0.72, height: 0.12 }, this.scene);
    healthBack.parent = root;
    const hpBarOffsetY = usingAnimationAsset ? animationConfig!.hpBarOffsetY : config.hpBarOffsetY;
    healthBack.position.set(0, hpBarOffsetY, 0);
    healthBack.billboardMode = Mesh.BILLBOARDMODE_ALL;
    healthBack.material = this.healthBack;
    const healthFill = MeshBuilder.CreatePlane(`enemy-health-fill-${id}`, { width: 0.66, height: 0.075 }, this.scene);
    healthFill.parent = root;
    healthFill.position.set(0, hpBarOffsetY, -0.01);
    healthFill.billboardMode = Mesh.BILLBOARDMODE_ALL;
    healthFill.material = this.healthFront;
    healthBack.renderingGroupId = 1;
    healthFill.renderingGroupId = 2;
    this.healthBack.disableDepthWrite = true;
    this.healthFront.disableDepthWrite = true;
    healthBack.setEnabled(true);
    healthFill.setEnabled(true);

    if (this.castEnemyShadows) {
      meshes.filter((mesh) => mesh !== healthBack && mesh !== healthFill)
        .forEach((mesh) => this.shadows.addShadowCaster(mesh));
    }

    const animation = usingAnimationAsset && animationConfig
      ? new EnemyAnimationController(entries.animationGroups, animationConfig, { enemyId: id, enemyType: type, assetPath: loadedAssetPath })
      : undefined;
    // Static templates should never start unexpected clips implicitly.
    if (!animation) entries.animationGroups.forEach((group) => { group.stop(); group.dispose(); });
    return {
      root, healthBack, healthFill, lastHpRatio: 1, animation,
      dispose: () => {
        animation?.dispose();
        this.disposeInstance(root, [], entries.skeletons);
      },
    };
  }

  reportFallback(type: EnemyType, reason: string): void {
    if (this.reportedFallbacks.has(type)) return;
    this.reportedFallbacks.add(type);
    const config = ENEMY_VISUAL_CONFIG[type];
    console.warn("Enemy visual fallback:", {
      type, optimizedPath: config.assetPath, fallbackPath: config.fallbackAssetPath,
      loadedAssetPath: this.loadedAssetPaths.get(type), reason,
    });
  }

  private recordVisualAudit(entry: object): void {
    if (!this.debugVisuals) return;
    const debugWindow = window as Window & { __enemyVisualAudit?: object[] };
    (debugWindow.__enemyVisualAudit ??= []).push(entry);
  }

  private disposeInstance(root: TransformNode, groups: { stop(): void; dispose(): void }[], skeletons: { dispose(): void }[]): void {
    groups.forEach((group) => { group.stop(); group.dispose(); });
    skeletons.forEach((skeleton) => skeleton.dispose());
    root.dispose(false, false);
  }

  private combinedBounds(meshes: AbstractMesh[]): ModelBounds {
    let minX = Number.POSITIVE_INFINITY; let minY = Number.POSITIVE_INFINITY; let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY; let maxY = Number.NEGATIVE_INFINITY; let maxZ = Number.NEGATIVE_INFINITY;
    for (const mesh of meshes) {
      if (mesh.name.includes("enemy-health-")) continue;
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      minX = Math.min(minX, box.minimumWorld.x); minY = Math.min(minY, box.minimumWorld.y); minZ = Math.min(minZ, box.minimumWorld.z);
      maxX = Math.max(maxX, box.maximumWorld.x); maxY = Math.max(maxY, box.maximumWorld.y); maxZ = Math.max(maxZ, box.maximumWorld.z);
    }
    return Number.isFinite(minX)
      ? { width: maxX - minX, height: maxY - minY, depth: maxZ - minZ, minY }
      : { width: 0, height: 0, depth: 0, minY: Number.NaN };
  }

  private boundsAreSafe(bounds: ModelBounds, maxDimension: number): boolean {
    return [bounds.width, bounds.height, bounds.depth].every((dimension) => Number.isFinite(dimension) && dimension > 0 && dimension <= maxDimension)
      && Number.isFinite(bounds.minY);
  }

  private material(name: string, color: Color3): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = color;
    material.emissiveColor = color;
    return material;
  }
}
