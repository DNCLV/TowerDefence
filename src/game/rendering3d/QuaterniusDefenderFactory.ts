import "@babylonjs/loaders/glTF";
import { AbstractMesh, AssetContainer, Color3, MeshBuilder, Scene, SceneLoader, ShadowGenerator, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import type { DefenderType } from "../config/DefenderConfig";
import { DEFENDER_VISUAL_CONFIG } from "./DefenderVisualConfig";
import { VISUAL_CONFIG } from "./VisualConfig";
import { resolveAssetUrl } from "../../core/AssetUrl";

export interface QuaterniusDefenderVisual {
  root: TransformNode;
  bodyRoot: TransformNode;
  attackOrigin: TransformNode;
  level: number;
  dispose(): void;
}

type ImportedDefenderType = "green-archer" | "battlemage" | "sovereign" | "holy-emperor";
type DefenderTemplateAudit = { type: ImportedDefenderType; assetPath?: string; optimized: boolean; triangleCount: number; textures: number; materials: number };

/** Loads each imported defender once. Pending loads stay visually quiet; only a small neutral marker is used on failure. */
export class QuaterniusDefenderFactory {
  private readonly templates = new Map<ImportedDefenderType, AssetContainer>();
  private readonly loadedPaths = new Map<ImportedDefenderType, string>();
  private readonly debug = new URLSearchParams(window.location.search).get("defenderVisualDebug") === "1";
  private readonly reportedTypes = new Set<DefenderType>();
  private loadingComplete = false;
  private readonly neutralFallbackMaterial: StandardMaterial;
  private readonly unavailableReported = new Set<DefenderType>();

  constructor(private readonly scene: Scene, private readonly shadows: ShadowGenerator) {
    this.neutralFallbackMaterial = this.material("defender-neutral-fallback", new Color3(0.38, 0.5, 0.53), new Color3(0.06, 0.09, 0.1));
  }

  private readonly importedTypes: ImportedDefenderType[] = ["green-archer", "battlemage", "sovereign", "holy-emperor"];
  get ready(): boolean { return this.templates.size === this.importedTypes.length; }
  get cachedModelCount(): number { return this.templates.size; }
  hasTemplate(type: DefenderType): boolean { return this.templates.has(type as ImportedDefenderType); }
  getLoadedAssetPath(type: DefenderType): string | undefined { return this.loadedPaths.get(type as ImportedDefenderType); }

  dispose(): void {
    this.templates.forEach((template) => template.dispose());
    this.templates.clear();
    this.loadedPaths.clear();
    this.neutralFallbackMaterial.dispose();
  }

  async load(): Promise<void> {
    const types = this.importedTypes;
    await Promise.all(types.map((type) => this.loadType(type)));
    this.loadingComplete = true;
    for (const type of types) this.reportResolution(type, this.loadedPaths.get(type), !this.templates.has(type));
    if (this.debug) {
      const audit: DefenderTemplateAudit[] = types.map((type) => {
        const container = this.templates.get(type);
        return {
          type,
          assetPath: this.loadedPaths.get(type),
          optimized: this.loadedPaths.get(type) === DEFENDER_VISUAL_CONFIG[type].assetPath,
          triangleCount: container?.meshes.reduce((sum, mesh) => sum + (mesh.getTotalIndices() ?? 0) / 3, 0) ?? 0,
          textures: container?.textures.length ?? 0,
          materials: container?.materials.length ?? 0,
        };
      });
      (window as Window & { __defenderTemplateAudit?: DefenderTemplateAudit[] }).__defenderTemplateAudit = audit;
    }
  }

  /** Keeps towers visually quiet while loading; failed assets use a small neutral marker, never a large proxy body. */
  create(id: number, type: ImportedDefenderType, level: number): QuaterniusDefenderVisual {
    const definition = DEFENDER_VISUAL_CONFIG[type];
    const template = this.templates.get(type);
    if (!template) {
      return this.loadingComplete
        ? this.createNeutralFallback(id, type, level)
        : this.createPendingVisual(id, type, level);
    }

    const instance = template.instantiateModelsToScene((name) => `defender-${id}-${name}`, false);
    const root = new TransformNode(`defender-root-${id}`, this.scene);
    const bodyRoot = new TransformNode(`defender-body-root-${id}`, this.scene);
    bodyRoot.parent = root;
    const modelRoot = new TransformNode(`defender-model-root-${id}`, this.scene);
    modelRoot.parent = bodyRoot;
    instance.rootNodes.forEach((node) => { node.parent = modelRoot; });
    const levelScale = VISUAL_CONFIG.towerLevelScaleMultipliers[level as 1 | 2 | 3] ?? 1;
    modelRoot.scaling.set(
      (definition.modelScaleX ?? definition.modelScale) * levelScale,
      definition.modelScale * levelScale,
      (definition.modelScaleZ ?? definition.modelScale) * levelScale,
    );
    modelRoot.rotation.y = definition.rotationY;

    const meshes = root.getChildMeshes();
    const rawBounds = this.measureWorldBounds(meshes);
    if (rawBounds) modelRoot.position.y -= rawBounds.min.y;
    bodyRoot.computeWorldMatrix(true);
    this.addShadowCasters(meshes);
    const bounds = this.measureWorldBounds(meshes);
    const attackOrigin = new TransformNode(`defender-attack-origin-${id}`, this.scene);
    attackOrigin.parent = modelRoot;
    // Keep the firing origin in the model's local frame so model-scale tuning
    // moves it together with the defender without changing tower coordinates.
    attackOrigin.position.set(0, definition.sourceBounds.height * 0.68, type === "green-archer" ? 0.18 : 0.2);
    instance.animationGroups.forEach((animation) => { animation.stop(); animation.dispose(); });
    this.reportResolution(type, this.loadedPaths.get(type), false);
    this.recordInstance(id, type, level, this.loadedPaths.get(type), bounds, modelRoot.position.y);
    return {
      root, bodyRoot, attackOrigin, level,
      dispose: () => {
        meshes.forEach((mesh) => this.shadows.removeShadowCaster(mesh));
        instance.skeletons.forEach((skeleton) => skeleton.dispose());
      },
    };
  }

  private async loadType(type: ImportedDefenderType): Promise<void> {
    const definition = DEFENDER_VISUAL_CONFIG[type];
    try {
      this.templates.set(type, await this.loadContainer(definition.assetPath!));
      this.loadedPaths.set(type, definition.assetPath!);
      return;
    } catch (optimizedError) {
      if (!import.meta.env.DEV || !definition.fallbackAssetPath) throw optimizedError;
      console.warn("Optimized defender visual failed; trying its own source GLB:", {
        type, optimizedPath: definition.assetPath, fallbackPath: definition.fallbackAssetPath,
        reason: optimizedError instanceof Error ? optimizedError.message : String(optimizedError),
      });
    }

    try {
      this.templates.set(type, await this.loadContainer(definition.fallbackAssetPath!));
      this.loadedPaths.set(type, definition.fallbackAssetPath!);
    } catch (fallbackError) {
      console.warn("Defender source GLB failed; using a small neutral fallback marker:", {
        type, fallbackPath: definition.fallbackAssetPath,
        reason: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });
    }
  }

  private createPendingVisual(id: number, _type: ImportedDefenderType, level: number): QuaterniusDefenderVisual {
    const root = new TransformNode(`defender-root-${id}`, this.scene);
    const bodyRoot = new TransformNode(`defender-body-root-${id}`, this.scene);
    bodyRoot.parent = root;
    const attackOrigin = new TransformNode(`defender-attack-origin-${id}`, this.scene);
    attackOrigin.parent = bodyRoot;
    attackOrigin.position.set(0, 0.9, 0.18);
    return {
      root, bodyRoot, attackOrigin, level,
      dispose: () => undefined,
    };
  }

  private createNeutralFallback(id: number, type: DefenderType, level: number): QuaterniusDefenderVisual {
    const root = new TransformNode(`defender-root-${id}`, this.scene);
    const bodyRoot = new TransformNode(`defender-body-root-${id}`, this.scene);
    bodyRoot.parent = root;
    const marker = MeshBuilder.CreatePolyhedron(`defender-neutral-marker-${id}`, { type: 1, size: 0.22 }, this.scene);
    marker.parent = bodyRoot;
    marker.position.y = 0.17;
    marker.material = this.neutralFallbackMaterial;
    marker.isPickable = false;
    bodyRoot.scaling.setAll(VISUAL_CONFIG.towerLevelScaleMultipliers[level as 1 | 2 | 3] ?? 1);
    const attackOrigin = new TransformNode(`defender-attack-origin-${id}`, this.scene);
    attackOrigin.parent = bodyRoot;
    attackOrigin.position.set(0, 0.72, 0.18);
    if (!this.unavailableReported.has(type)) {
      this.unavailableReported.add(type);
      console.warn("Defender visual unavailable after preload; showing small neutral marker.", { type });
    }
    this.recordInstance(id, type, level, undefined, undefined, 0);
    this.reportResolution(type, undefined, true);
    return { root, bodyRoot, attackOrigin, level, dispose: () => undefined };
  }

  private reportResolution(type: DefenderType, assetPath: string | undefined, primitive: boolean): void {
    if (!this.debug || this.reportedTypes.has(type)) return;
    this.reportedTypes.add(type);
    const config = DEFENDER_VISUAL_CONFIG[type];
    console.info("Defender visual:", {
      type, config: type, asset: assetPath ?? "primitive fallback", fallback: primitive || assetPath !== config.assetPath,
    });
  }

  private recordInstance(id: number, type: DefenderType, level: number, assetPath: string | undefined,
    bounds: { min: Vector3; max: Vector3 } | undefined, groundOffset: number): void {
    if (!this.debug) return;
    const instances = (window as Window & { __defenderVisualInstances?: object[] }).__defenderVisualInstances ??= [];
    instances.push({
      id, type, config: type, optimized: assetPath !== undefined && assetPath === DEFENDER_VISUAL_CONFIG[type].assetPath,
      assetPath: assetPath ?? null, primitiveFallback: assetPath === undefined, level,
      sourceBounds: DEFENDER_VISUAL_CONFIG[type].sourceBounds,
      visualScaleMultiplier: DEFENDER_VISUAL_CONFIG[type].visualScaleMultiplier,
      scale: {
        x: DEFENDER_VISUAL_CONFIG[type].modelScaleX ?? DEFENDER_VISUAL_CONFIG[type].modelScale,
        y: DEFENDER_VISUAL_CONFIG[type].modelScale,
        z: DEFENDER_VISUAL_CONFIG[type].modelScaleZ ?? DEFENDER_VISUAL_CONFIG[type].modelScale,
      },
      targetVisualHeight: DEFENDER_VISUAL_CONFIG[type].targetVisualHeight,
      groundOffset,
      bounds: bounds ? {
        width: bounds.max.x - bounds.min.x, height: bounds.max.y - bounds.min.y,
        depth: bounds.max.z - bounds.min.z, minY: bounds.min.y,
      } : null,
    });
  }

  private measureWorldBounds(meshes: AbstractMesh[]): { min: Vector3; max: Vector3; height: number } | undefined {
    const renderMeshes = meshes.filter((mesh) => mesh.getTotalVertices() > 0);
    if (!renderMeshes.length) return undefined;
    let min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    let max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
    for (const mesh of renderMeshes) {
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      min = Vector3.Minimize(min, bounds.minimumWorld);
      max = Vector3.Maximize(max, bounds.maximumWorld);
    }
    if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)) return undefined;
    return { min, max, height: max.y - min.y };
  }

  private addShadowCasters(meshes: AbstractMesh[]): void {
    meshes.forEach((mesh) => { mesh.isPickable = false; this.shadows.addShadowCaster(mesh); });
  }

  private async loadContainer(path: string): Promise<AssetContainer> {
    const resolvedPath = resolveAssetUrl(path);
    const separator = resolvedPath.lastIndexOf("/");
    const container = await SceneLoader.LoadAssetContainerAsync(resolvedPath.slice(0, separator + 1), resolvedPath.slice(separator + 1), this.scene);
    if (!container.meshes.some((mesh) => mesh.getTotalVertices() > 0 && mesh.material)) {
      container.dispose();
      throw new Error("GLB has no renderable mesh with material");
    }
    return container;
  }

  private material(name: string, color: Color3, emissive = Color3.Black()): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = color;
    material.emissiveColor = emissive;
    return material;
  }
}
