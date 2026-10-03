import "@babylonjs/loaders/glTF";
import {
  AbstractMesh,
  AssetContainer,
  Scene,
  SceneLoader,
  ShadowGenerator,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { VISUAL_CONFIG } from "./VisualConfig";
import { DEFENDER_VISUAL_CONFIG } from "./DefenderVisualConfig";
import { resolveAssetUrl } from "../../core/AssetUrl";

export interface BlueWizardVisual {
  root: TransformNode;
  /** Renderer-controlled root for facing enemies; model correction remains on its child. */
  bodyRoot: TransformNode;
  /** Generic attack origin, independent from the model's staff/hand layout. */
  attackOrigin: TransformNode;
  level: number;
  dispose(): void;
}

/** Loads the static wizard GLB once and creates lightweight scene instances for defenders. */
export class BlueWizardFactory {
  private template?: AssetContainer;
  private rawBounds?: { min: Vector3; max: Vector3 };
  private boundsLogged = false;
  private readonly visualDebug = new URLSearchParams(window.location.search).get("defenderVisualDebug") === "1";

  constructor(private readonly scene: Scene, private readonly shadows: ShadowGenerator) {}

  get ready(): boolean { return this.template !== undefined; }

  async load(): Promise<void> {
    const path = DEFENDER_VISUAL_CONFIG["blue-wizard"].assetPath;
    const resolvedPath = resolveAssetUrl(path);
    const separator = resolvedPath.lastIndexOf("/");
    this.template = await SceneLoader.LoadAssetContainerAsync(resolvedPath.slice(0, separator + 1), resolvedPath.slice(separator + 1), this.scene);
    const bounds = this.measureTemplateBounds(this.template);
    if (!bounds || !(bounds.max.y > bounds.min.y)) {
      this.template.dispose();
      this.template = undefined;
      throw new Error("Blue Wizard GLB has no measurable render bounds.");
    }
    this.rawBounds = bounds;
    this.logAssetAudit(this.template, bounds);
    if (this.visualDebug) console.info("Defender visual:", {
      type: "blue-wizard", config: "blue-wizard", asset: DEFENDER_VISUAL_CONFIG["blue-wizard"].assetPath, fallback: false,
    });
  }

  create(id: number, level: number): BlueWizardVisual {
    if (!this.template || !this.rawBounds) throw new Error("Blue Wizard template has not loaded.");
    const entries = this.template.instantiateModelsToScene((name) => `blue-wizard-${id}-${name}`, false);
    const root = new TransformNode(`blue-wizard-placement-${id}`, this.scene);
    const bodyRoot = new TransformNode(`blue-wizard-facing-${id}`, this.scene);
    bodyRoot.parent = root;
    const modelRoot = new TransformNode(`blue-wizard-model-${id}`, this.scene);
    modelRoot.parent = bodyRoot;
    entries.rootNodes.forEach((node) => { node.parent = modelRoot; });

    const levelScale = VISUAL_CONFIG.towerLevelScaleMultipliers[level as 1 | 2 | 3] ?? 1;
    const scale = DEFENDER_VISUAL_CONFIG["blue-wizard"].modelScale * levelScale;
    modelRoot.scaling.setAll(scale);
    // GLB coordinates are Y-up; measured raw bounds place the boots exactly on the tile surface.
    modelRoot.position.y = -this.rawBounds.min.y * scale;
    const meshes = root.getChildMeshes(false);
    const shadowCasters: AbstractMesh[] = [];
    for (const mesh of meshes) {
      mesh.isPickable = false;
      if (mesh.getTotalVertices() <= 0) continue;
      this.shadows.addShadowCaster(mesh);
      shadowCasters.push(mesh);
    }

    const attackOrigin = new TransformNode(`blue-wizard-attack-origin-${id}`, this.scene);
    attackOrigin.parent = modelRoot;
    const rawHeight = this.rawBounds.max.y - this.rawBounds.min.y;
    // Convert the desired model-local chest height back through the model's ground offset.
    attackOrigin.position.set(0, this.rawBounds.min.y + rawHeight * 0.68, 0.22);
    if (!this.boundsLogged) {
      this.boundsLogged = true;
      console.info("Blue Wizard placement bounds", {
        rawHeight: Number((this.rawBounds.max.y - this.rawBounds.min.y).toFixed(3)),
        visualHeight: Number(((this.rawBounds.max.y - this.rawBounds.min.y) * scale).toFixed(3)),
        groundOffset: Number((-this.rawBounds.min.y * scale).toFixed(3)),
        scale,
        renderMeshes: shadowCasters.length,
      });
    }
    return {
      root,
      bodyRoot: root,
      attackOrigin,
      level,
      dispose: () => shadowCasters.forEach((mesh) => this.shadows.removeShadowCaster(mesh)),
    };
  }

  private measureTemplateBounds(container: AssetContainer): { min: Vector3; max: Vector3 } | undefined {
    const renderMeshes = container.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
    if (renderMeshes.length === 0) return undefined;
    for (const mesh of renderMeshes) mesh.computeWorldMatrix(true);
    let min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    let max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
    for (const mesh of renderMeshes) {
      const box = mesh.getBoundingInfo().boundingBox;
      min = Vector3.Minimize(min, box.minimumWorld);
      max = Vector3.Maximize(max, box.maximumWorld);
    }
    if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)) return undefined;
    return { min, max };
  }

  private logAssetAudit(container: AssetContainer, bounds: { min: Vector3; max: Vector3 }): void {
    const meshes = container.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
    const triangleCount = meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0);
    const audit = {
      asset: "/assets/models/defenders/blue-wizard.glb",
      meshNames: meshes.map((mesh) => mesh.name),
      rootNames: container.rootNodes.map((node) => node.name),
      materialNames: container.materials.map((material) => material.name),
      vertices: meshes.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0),
      triangles: triangleCount,
      bounds: {
        width: Number((bounds.max.x - bounds.min.x).toFixed(3)),
        height: Number((bounds.max.y - bounds.min.y).toFixed(3)),
        depth: Number((bounds.max.z - bounds.min.z).toFixed(3)),
        min: bounds.min.asArray(),
        max: bounds.max.asArray(),
      },
      nodeTransforms: container.rootNodes.map((node) => ({
        name: node.name,
        position: node instanceof TransformNode ? node.position.asArray() : null,
        rotation: node instanceof TransformNode ? node.rotation.asArray() : null,
        scaling: node instanceof TransformNode ? node.scaling.asArray() : null,
      })),
      skeletons: container.skeletons.length,
      animations: container.animationGroups.map((group) => group.name),
      cameras: container.cameras.map((camera) => camera.name),
      lights: container.lights.map((light) => light.name),
      embeddedTextures: container.textures.length,
    };
    console.info("Blue Wizard GLB audit", JSON.stringify(audit));
  }
}
