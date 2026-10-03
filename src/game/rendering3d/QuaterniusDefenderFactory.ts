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

type ImportedDefenderType = "green-archer" | "battlemage" | "sovereign";
type DefenderTemplateAudit = { type: ImportedDefenderType; assetPath?: string; optimized: boolean; triangleCount: number; textures: number; materials: number };

/** Loads each imported defender once; a missing model gets a type-specific primitive, never another defender's model. */
export class QuaterniusDefenderFactory {
  private readonly templates = new Map<ImportedDefenderType, AssetContainer>();
  private readonly loadedPaths = new Map<ImportedDefenderType, string>();
  private readonly debug = new URLSearchParams(window.location.search).get("defenderVisualDebug") === "1";
  private readonly reportedTypes = new Set<ImportedDefenderType>();
  private loadingComplete = false;
  private readonly archerMaterial: StandardMaterial;
  private readonly robeMaterial: StandardMaterial;
  private readonly skinMaterial: StandardMaterial;
  private readonly leatherMaterial: StandardMaterial;
  private readonly arcaneMaterial: StandardMaterial;

  constructor(private readonly scene: Scene, private readonly shadows: ShadowGenerator) {
    this.archerMaterial = this.material("defender-fallback-archer-green", new Color3(0.08, 0.36, 0.25));
    this.robeMaterial = this.material("defender-fallback-battlemage-blue", new Color3(0.16, 0.19, 0.48));
    this.skinMaterial = this.material("defender-fallback-skin", new Color3(0.78, 0.61, 0.45));
    this.leatherMaterial = this.material("defender-fallback-leather", new Color3(0.25, 0.13, 0.07));
    this.arcaneMaterial = this.material("defender-fallback-arcane", new Color3(0.29, 0.66, 1), new Color3(0.22, 0.32, 0.9));
  }

  private readonly importedTypes: ImportedDefenderType[] = ["green-archer", "battlemage", "sovereign"];
  get ready(): boolean { return this.templates.size === this.importedTypes.length; }
  get cachedModelCount(): number { return this.templates.size; }
  hasTemplate(type: DefenderType): boolean { return this.templates.has(type as ImportedDefenderType); }
  getLoadedAssetPath(type: DefenderType): string | undefined { return this.loadedPaths.get(type as ImportedDefenderType); }

  dispose(): void {
    this.templates.forEach((template) => template.dispose());
    this.templates.clear();
    this.loadedPaths.clear();
    this.archerMaterial.dispose();
    this.robeMaterial.dispose();
    this.skinMaterial.dispose();
    this.leatherMaterial.dispose();
    this.arcaneMaterial.dispose();
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

  /** Always returns a visual for valid imported types, even while their GLBs are loading. */
  create(id: number, type: ImportedDefenderType, level: number): QuaterniusDefenderVisual {
    const definition = DEFENDER_VISUAL_CONFIG[type];
    const template = this.templates.get(type);
    if (!template) {
      if (this.loadingComplete) this.reportResolution(type, undefined, true);
      return this.createPrimitiveFallback(id, type, level);
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
    attackOrigin.position.set(0, (bounds?.height ?? 1) * 0.68, type === "green-archer" ? 0.18 : 0.2);
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
      this.templates.set(type, await this.loadContainer(definition.assetPath));
      this.loadedPaths.set(type, definition.assetPath);
      return;
    } catch (optimizedError) {
      if (!definition.fallbackAssetPath) throw optimizedError;
      console.warn("Optimized defender visual failed; trying its own source GLB:", {
        type, optimizedPath: definition.assetPath, fallbackPath: definition.fallbackAssetPath,
        reason: optimizedError instanceof Error ? optimizedError.message : String(optimizedError),
      });
    }

    try {
      this.templates.set(type, await this.loadContainer(definition.fallbackAssetPath!));
      this.loadedPaths.set(type, definition.fallbackAssetPath!);
    } catch (fallbackError) {
      console.warn("Defender source GLB failed; using its type-specific primitive fallback:", {
        type, fallbackPath: definition.fallbackAssetPath,
        reason: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });
    }
  }

  private createPrimitiveFallback(id: number, type: ImportedDefenderType, level: number): QuaterniusDefenderVisual {
    const root = new TransformNode(`defender-root-${id}`, this.scene);
    const bodyRoot = new TransformNode(`defender-body-root-${id}`, this.scene);
    bodyRoot.parent = root;
    const add = (mesh: AbstractMesh, material: StandardMaterial) => {
      mesh.parent = bodyRoot;
      mesh.material = material;
      mesh.isPickable = false;
      this.shadows.addShadowCaster(mesh);
      return mesh;
    };

    if (type === "green-archer") {
      const tunic = add(MeshBuilder.CreateCylinder(`fallback-archer-tunic-${id}`, { height: 0.62, diameterTop: 0.25, diameterBottom: 0.48, tessellation: 7 }, this.scene), this.archerMaterial);
      tunic.position.y = 0.52;
      const head = add(MeshBuilder.CreateSphere(`fallback-archer-head-${id}`, { diameter: 0.27, segments: 8 }, this.scene), this.skinMaterial);
      head.position.y = 0.98;
      const bowPath = [new Vector3(0.3, 0.46, 0.02), new Vector3(0.48, 0.78, 0.02), new Vector3(0.3, 1.04, 0.02)];
      const bow = MeshBuilder.CreateTube(`fallback-archer-bow-${id}`, { path: bowPath, radius: 0.025, tessellation: 5 }, this.scene);
      add(bow, this.leatherMaterial);
    } else if (type === "battlemage") {
      const robe = add(MeshBuilder.CreateCylinder(`fallback-battlemage-robe-${id}`, { height: 0.82, diameterTop: 0.24, diameterBottom: 0.72, tessellation: 8 }, this.scene), this.robeMaterial);
      robe.position.y = 0.53;
      const head = add(MeshBuilder.CreateSphere(`fallback-battlemage-head-${id}`, { diameter: 0.28, segments: 8 }, this.scene), this.skinMaterial);
      head.position.y = 1.08;
      const staff = add(MeshBuilder.CreateCylinder(`fallback-battlemage-staff-${id}`, { height: 1.16, diameter: 0.045, tessellation: 6 }, this.scene), this.leatherMaterial);
      staff.position.set(0.43, 0.62, 0.02);
      const orb = add(MeshBuilder.CreateSphere(`fallback-battlemage-orb-${id}`, { diameter: 0.2, segments: 8 }, this.scene), this.arcaneMaterial);
      orb.position.set(0.43, 1.25, 0.02);
    } else {
      const armor = add(MeshBuilder.CreateCylinder(`fallback-sovereign-armor-${id}`, { height: 0.9, diameterTop: 0.36, diameterBottom: 0.72, tessellation: 8 }, this.scene), this.leatherMaterial);
      armor.position.y = 0.56;
      const helm = add(MeshBuilder.CreateSphere(`fallback-sovereign-helm-${id}`, { diameter: 0.34, segments: 8 }, this.scene), this.skinMaterial);
      helm.position.y = 1.16;
      const crest = add(MeshBuilder.CreateCylinder(`fallback-sovereign-crest-${id}`, { height: 0.64, diameter: 0.08, tessellation: 5 }, this.scene), this.arcaneMaterial);
      crest.position.set(0, 1.55, 0.04);
      const sword = add(MeshBuilder.CreateBox(`fallback-sovereign-sword-${id}`, { width: 0.12, height: 0.75, depth: 0.06 }, this.scene), this.leatherMaterial);
      sword.position.set(0.44, 0.68, 0.04);
    }

    const levelScale = VISUAL_CONFIG.towerLevelScaleMultipliers[level as 1 | 2 | 3] ?? 1;
    bodyRoot.scaling.setAll(levelScale);
    const attackOrigin = new TransformNode(`defender-attack-origin-${id}`, this.scene);
    attackOrigin.parent = bodyRoot;
    attackOrigin.position.set(0, type === "green-archer" ? 0.95 : type === "sovereign" ? 1.15 : 1.05, 0.18);
    this.recordInstance(id, type, level, undefined, undefined, 0);
    this.reportResolution(type, undefined, true);
    return {
      root, bodyRoot, attackOrigin, level,
      dispose: () => {
        root.getChildMeshes(false).forEach((mesh) => this.shadows.removeShadowCaster(mesh));
      },
    };
  }

  private reportResolution(type: ImportedDefenderType, assetPath: string | undefined, primitive: boolean): void {
    if (!this.debug || this.reportedTypes.has(type)) return;
    this.reportedTypes.add(type);
    const config = DEFENDER_VISUAL_CONFIG[type];
    console.info("Defender visual:", {
      type, config: type, asset: assetPath ?? "primitive fallback", fallback: primitive || assetPath !== config.assetPath,
    });
  }

  private recordInstance(id: number, type: ImportedDefenderType, level: number, assetPath: string | undefined,
    bounds: { min: Vector3; max: Vector3 } | undefined, groundOffset: number): void {
    if (!this.debug) return;
    const instances = (window as Window & { __defenderVisualInstances?: object[] }).__defenderVisualInstances ??= [];
    instances.push({
      id, type, config: type, optimized: assetPath === DEFENDER_VISUAL_CONFIG[type].assetPath,
      assetPath: assetPath ?? null, primitiveFallback: assetPath === undefined, level,
      sourceBounds: DEFENDER_VISUAL_CONFIG[type].sourceBounds,
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
