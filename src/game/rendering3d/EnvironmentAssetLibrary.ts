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
import { resolveAssetUrl } from "../../core/AssetUrl";

export type EnvironmentAssetKey =
  | "wall" | "corner" | "gate" | "arch" | "pine" | "rock" | "fence" | "crate"
  | "nature-pine-1" | "nature-pine-3" | "nature-pine-5"
  | "nature-rock-1" | "nature-rock-2" | "nature-rock-3"
  | "nature-flowering-bush" | "nature-mushroom";

interface AssetSource {
  rootUrl: string;
  fileName: string;
}

export interface EnvironmentSizeLimits {
  maxWidth: number;
  maxHeight: number;
  maxDepth: number;
}

const ASSETS: Record<EnvironmentAssetKey, AssetSource> = {
  wall: { rootUrl: "/assets/environment/medieval/", fileName: "Wall_UnevenBrick_Straight.gltf" },
  corner: { rootUrl: "/assets/environment/medieval/", fileName: "Corner_Exterior_Brick.gltf" },
  gate: { rootUrl: "/assets/environment/medieval/", fileName: "Wall_UnevenBrick_Door_Round.gltf" },
  arch: { rootUrl: "/assets/environment/medieval/", fileName: "Wall_Arch.gltf" },
  fence: { rootUrl: "/assets/environment/medieval/", fileName: "Prop_WoodenFence_Single.gltf" },
  crate: { rootUrl: "/assets/environment/medieval/", fileName: "Prop_Crate.gltf" },
  pine: { rootUrl: "/assets/environment/nature/", fileName: "Pine_3.gltf" },
  rock: { rootUrl: "/assets/environment/nature/", fileName: "Rock_Medium_2.gltf" },
  "nature-pine-1": { rootUrl: "/assets/environment/nature-kit/", fileName: "Pine_1.gltf" },
  "nature-pine-3": { rootUrl: "/assets/environment/nature-kit/", fileName: "Pine_3.gltf" },
  "nature-pine-5": { rootUrl: "/assets/environment/nature-kit/", fileName: "Pine_5.gltf" },
  "nature-rock-1": { rootUrl: "/assets/environment/nature-kit/", fileName: "Rock_Medium_1.gltf" },
  "nature-rock-2": { rootUrl: "/assets/environment/nature-kit/", fileName: "Rock_Medium_2.gltf" },
  "nature-rock-3": { rootUrl: "/assets/environment/nature-kit/", fileName: "Rock_Medium_3.gltf" },
  "nature-flowering-bush": { rootUrl: "/assets/environment/nature-kit/", fileName: "Bush_Common_Flowers.gltf" },
  "nature-mushroom": { rootUrl: "/assets/environment/nature-kit/", fileName: "Mushroom_Common.gltf" },
};

// Only the environment pieces already verified in the original arena cast shadows.
// Nature Kit foliage contains large/double-sided surfaces whose shadow silhouettes
// become solid slabs in Babylon's shadow pass.
const SHADOW_SAFE_ASSETS = new Set<EnvironmentAssetKey>([
  "wall", "corner", "gate", "arch", "fence", "crate", "pine", "rock",
]);

/**
 * Loads each static environment model once and creates lightweight scene instances.
 * Templates remain outside the scene, so their materials and textures are shared by
 * every wall, tree and prop instance.
 */
export class EnvironmentAssetLibrary {
  private readonly templates = new Map<EnvironmentAssetKey, AssetContainer>();
  private readonly debugEnvironment = new URLSearchParams(window.location.search).has("debugEnvironment");

  constructor(private readonly scene: Scene, private readonly shadows: ShadowGenerator) {}

  async preload(): Promise<void> {
    await Promise.all((Object.keys(ASSETS) as EnvironmentAssetKey[]).map(async (key) => {
      try {
        await this.load(key);
      } catch (error) {
        console.warn(`Environment asset '${key}' failed to load; its primitive fallback will be used.`, error);
      }
    }));
  }

  isReady(key: EnvironmentAssetKey): boolean {
    return this.templates.has(key);
  }

  instantiate(
    key: EnvironmentAssetKey,
    name: string,
    position: Vector3,
    rotationY = 0,
    scale = 1,
    castsShadows = true,
    limits?: EnvironmentSizeLimits,
  ): TransformNode | undefined {
    const template = this.templates.get(key);
    if (!template) return undefined;

    if (!Number.isFinite(scale) || scale <= 0) {
      console.warn(`Environment asset '${ASSETS[key].fileName}' skipped: invalid scale`, { scale, position, rotationY });
      return undefined;
    }

    const entries = template.instantiateModelsToScene((sourceName) => `${name}-${sourceName}`, false);
    const root = new TransformNode(name, this.scene);
    entries.rootNodes.forEach((node) => { node.parent = root; });
    root.position.copyFrom(position);
    root.rotation.y = rotationY;
    root.scaling.setAll(scale);
    this.placeOnGround(root);
    const dimensions = this.worldDimensions(root);
    const debugInfo = {
      asset: ASSETS[key].fileName,
      root: root.name,
      meshes: root.getChildMeshes().map((mesh) => mesh.name),
      worldScale: { x: root.scaling.x, y: root.scaling.y, z: root.scaling.z },
      boundingBox: dimensions,
      worldPosition: { x: root.position.x, y: root.position.y, z: root.position.z },
      rotationY: root.rotation.y,
      castsShadows: castsShadows && SHADOW_SAFE_ASSETS.has(key),
    };
    if (limits && (dimensions.width > limits.maxWidth || dimensions.height > limits.maxHeight || dimensions.depth > limits.maxDepth)) {
      console.warn(`Environment asset '${ASSETS[key].fileName}' skipped: world bounds exceed safe outskirts limits`, { ...debugInfo, limits });
      root.dispose(false, false);
      return undefined;
    }
    if (this.debugEnvironment) console.info("Environment asset accepted", debugInfo);
    const effectiveShadowCasting = castsShadows && SHADOW_SAFE_ASSETS.has(key);
    root.getChildMeshes().forEach((mesh) => {
      mesh.metadata = { ...mesh.metadata, environmentSource: ASSETS[key].fileName, environmentRoot: name };
      mesh.receiveShadows = false;
      if (effectiveShadowCasting) this.shadows.addShadowCaster(mesh);
    });
    return root;
  }

  removeFromShadows(root: TransformNode): void {
    root.getChildMeshes().forEach((mesh) => this.shadows.removeShadowCaster(mesh));
  }

  dispose(): void {
    this.templates.forEach((template) => template.dispose());
    this.templates.clear();
  }

  private async load(key: EnvironmentAssetKey): Promise<void> {
    if (this.templates.has(key)) return;
    const asset = ASSETS[key];
    const template = await SceneLoader.LoadAssetContainerAsync(resolveAssetUrl(asset.rootUrl), asset.fileName, this.scene);
    this.templates.set(key, template);
  }

  private placeOnGround(root: TransformNode): void {
    const meshes = root.getChildMeshes();
    let minY = Number.POSITIVE_INFINITY;
    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      minY = Math.min(minY, this.minimumY(mesh));
    }
    if (Number.isFinite(minY)) root.position.y -= minY;
  }

  private minimumY(mesh: AbstractMesh): number {
    return mesh.getBoundingInfo().boundingBox.minimumWorld.y;
  }

  private worldDimensions(root: TransformNode): { width: number; height: number; depth: number } {
    let min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    let max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
    for (const mesh of root.getChildMeshes()) {
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      min = Vector3.Minimize(min, bounds.minimumWorld);
      max = Vector3.Maximize(max, bounds.maximumWorld);
    }
    return {
      width: Number.isFinite(min.x) ? max.x - min.x : 0,
      height: Number.isFinite(min.y) ? max.y - min.y : 0,
      depth: Number.isFinite(min.z) ? max.z - min.z : 0,
    };
  }
}
