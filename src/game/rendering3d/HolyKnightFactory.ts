import "@babylonjs/loaders/glTF";
import { AbstractMesh, AssetContainer, Scene, SceneLoader, ShadowGenerator, TransformNode, Vector3 } from "@babylonjs/core";
import { VISUAL_CONFIG } from "./VisualConfig";
import { DEFENDER_VISUAL_CONFIG } from "./DefenderVisualConfig";
import { resolveAssetUrl } from "../../core/AssetUrl";

export interface HolyKnightVisual {
  root: TransformNode;
  bodyRoot: TransformNode;
  level: number;
  dispose(): void;
}

/** Loads the static Knight once and creates independent, disposable scene instances. */
export class HolyKnightFactory {
  private template?: AssetContainer;
  private rawBounds?: { min: Vector3; max: Vector3 };
  private readonly visualDebug = new URLSearchParams(window.location.search).get("defenderVisualDebug") === "1";

  constructor(private readonly scene: Scene, private readonly shadows: ShadowGenerator) {}

  get ready(): boolean { return this.template !== undefined; }

  async load(): Promise<void> {
    const path = DEFENDER_VISUAL_CONFIG["holy-knight"].assetPath;
    const resolvedPath = resolveAssetUrl(path);
    const separator = resolvedPath.lastIndexOf("/");
    const template = await SceneLoader.LoadAssetContainerAsync(resolvedPath.slice(0, separator + 1), resolvedPath.slice(separator + 1), this.scene);
    const renderMeshes = template.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
    if (renderMeshes.length === 0) {
      template.dispose();
      throw new Error("Holy Knight GLB contains no renderable meshes.");
    }
    for (const mesh of renderMeshes) mesh.computeWorldMatrix(true);
    let min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    let max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
    for (const mesh of renderMeshes) {
      const bounds = mesh.getBoundingInfo().boundingBox;
      min = Vector3.Minimize(min, bounds.minimumWorld);
      max = Vector3.Maximize(max, bounds.maximumWorld);
    }
    if (!(max.y > min.y) || ![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)) {
      template.dispose();
      throw new Error("Holy Knight GLB has invalid combined render bounds.");
    }
    this.template = template;
    this.rawBounds = { min, max };
    this.logAssetAudit(template, renderMeshes, min, max);
    if (this.visualDebug) console.info("Defender visual:", {
      type: "holy-knight", config: "holy-knight", asset: DEFENDER_VISUAL_CONFIG["holy-knight"].assetPath, fallback: false,
    });
  }

  create(id: number, level: number): HolyKnightVisual {
    if (!this.template || !this.rawBounds) throw new Error("Holy Knight template has not loaded.");
    const entries = this.template.instantiateModelsToScene((name) => `holy-knight-${id}-${name}`, false);
    const root = new TransformNode(`holy-knight-placement-${id}`, this.scene);
    const bodyRoot = new TransformNode(`holy-knight-facing-${id}`, this.scene);
    bodyRoot.parent = root;
    const modelRoot = new TransformNode(`holy-knight-model-${id}`, this.scene);
    modelRoot.parent = bodyRoot;
    entries.rootNodes.forEach((node) => { node.parent = modelRoot; });

    const levelScale = VISUAL_CONFIG.towerLevelScaleMultipliers[level as 1 | 2 | 3] ?? 1;
    const scale = DEFENDER_VISUAL_CONFIG["holy-knight"].modelScale * levelScale;
    modelRoot.scaling.setAll(scale);
    modelRoot.position.y = -this.rawBounds.min.y * scale;
    const shadowCasters: AbstractMesh[] = [];
    root.getChildMeshes(false).forEach((mesh) => {
      mesh.isPickable = false;
      if (mesh.getTotalVertices() <= 0) return;
      this.shadows.addShadowCaster(mesh);
      shadowCasters.push(mesh);
    });

    console.info("Holy Knight placement", {
      rawBounds: this.dimensions(this.rawBounds.min, this.rawBounds.max),
      visualScale: scale,
      visualHeight: Number(((this.rawBounds.max.y - this.rawBounds.min.y) * scale).toFixed(3)),
      groundOffset: Number((-this.rawBounds.min.y * scale).toFixed(3)),
      rootOrientationCorrection: [0, 0, 0],
      renderMeshes: shadowCasters.length,
    });
    return {
      root,
      bodyRoot,
      level,
      dispose: () => shadowCasters.forEach((mesh) => this.shadows.removeShadowCaster(mesh)),
    };
  }

  private dimensions(min: Vector3, max: Vector3) {
    return {
      width: Number((max.x - min.x).toFixed(3)),
      height: Number((max.y - min.y).toFixed(3)),
      depth: Number((max.z - min.z).toFixed(3)),
    };
  }

  private logAssetAudit(template: AssetContainer, renderMeshes: AbstractMesh[], min: Vector3, max: Vector3): void {
    const vertices = renderMeshes.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0);
    const triangles = renderMeshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0);
    const audit = {
      asset: "/assets/models/defenders/holy-knight.glb",
      rootNodes: template.rootNodes.map((node) => ({
        name: node.name,
        position: node instanceof TransformNode ? node.position.asArray() : null,
        rotation: node instanceof TransformNode ? node.rotation.asArray() : null,
        quaternion: node instanceof TransformNode ? node.rotationQuaternion?.asArray() ?? null : null,
        scale: node instanceof TransformNode ? node.scaling.asArray() : null,
      })),
      meshNames: renderMeshes.map((mesh) => mesh.name),
      combinedBounds: this.dimensions(min, max),
      vertices,
      triangles,
      materials: template.materials.map((material) => material.name),
      textures: template.textures.length,
      skeletons: template.skeletons.length,
      animations: template.animationGroups.map((group) => group.name),
      cameras: template.cameras.map((camera) => camera.name),
      lights: template.lights.map((light) => light.name),
      rawOrientation: "GLB Y-up; identity root transform; no correction applied.",
    };
    console.info("Holy Knight GLB audit", audit);
    if (triangles > 250_000) console.warn("Holy Knight model is relatively heavy; retained without automatic decimation.", { triangles, vertices });
  }
}
