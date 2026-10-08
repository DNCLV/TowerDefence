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
  | "castle-wall" | "castle-corner" | "castle-gate" | "castle-tower-base" | "castle-tower-roof"
  | "castle-flag" | "castle-tree" | "castle-tree-large" | "castle-rock" | "castle-rock-large"
  | "castle-ground-hills" | "castle-fence" | "castle-ballista" | "medieval-wagon" | "medieval-crate";

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
  "castle-wall": { rootUrl: "/assets/environment/kenney-castle/", fileName: "wall.glb" },
  "castle-corner": { rootUrl: "/assets/environment/kenney-castle/", fileName: "wall-corner-half-tower.glb" },
  "castle-gate": { rootUrl: "/assets/environment/kenney-castle/", fileName: "wall-doorway.glb" },
  "castle-tower-base": { rootUrl: "/assets/environment/kenney-castle/", fileName: "tower-square-base.glb" },
  "castle-tower-roof": { rootUrl: "/assets/environment/kenney-castle/", fileName: "tower-square-roof.glb" },
  "castle-flag": { rootUrl: "/assets/environment/kenney-castle/", fileName: "flag-banner-short.glb" },
  "castle-tree": { rootUrl: "/assets/environment/kenney-castle/", fileName: "tree-small.glb" },
  "castle-tree-large": { rootUrl: "/assets/environment/kenney-castle/", fileName: "tree-large.glb" },
  "castle-rock": { rootUrl: "/assets/environment/kenney-castle/", fileName: "rocks-small.glb" },
  "castle-rock-large": { rootUrl: "/assets/environment/kenney-castle/", fileName: "rocks-large.glb" },
  "castle-ground-hills": { rootUrl: "/assets/environment/kenney-castle/", fileName: "ground-hills.glb" },
  "castle-fence": { rootUrl: "/assets/environment/kenney-castle/", fileName: "wall-narrow-wood-fence.glb" },
  "castle-ballista": { rootUrl: "/assets/environment/kenney-castle/", fileName: "siege-ballista.glb" },
  "medieval-wagon": { rootUrl: "/assets/environment/medieval/", fileName: "Prop_Wagon.gltf" },
  "medieval-crate": { rootUrl: "/assets/environment/medieval/", fileName: "Prop_Crate.gltf" },
};

// Only the environment pieces already verified in the original arena cast shadows.
// Nature Kit foliage contains large/double-sided surfaces whose shadow silhouettes
// become solid slabs in Babylon's shadow pass.
const SHADOW_SAFE_ASSETS = new Set<EnvironmentAssetKey>([
  // Current Kenney castle set uses generated/soft shadows; imported foliage is not a caster.
]);

/**
 * Loads each static environment model once and creates lightweight scene instances.
 * Templates remain outside the scene, so their materials and textures are shared by
 * every wall, tree and prop instance.
 */
export class EnvironmentAssetLibrary {
  private readonly templates = new Map<EnvironmentAssetKey, AssetContainer>();
  private readonly pendingLoads = new Map<EnvironmentAssetKey, Promise<AssetContainer>>();
  private readonly debugEnvironment = new URLSearchParams(window.location.search).has("debugEnvironment");

  constructor(private readonly scene: Scene, private readonly shadows: ShadowGenerator) {}

  async preload(keys: readonly EnvironmentAssetKey[] = Object.keys(ASSETS) as EnvironmentAssetKey[]): Promise<void> {
    await Promise.all([...new Set(keys)].map(async (key) => {
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
      mesh.freezeWorldMatrix();
    });
    return root;
  }

  removeFromShadows(root: TransformNode): void {
    root.getChildMeshes().forEach((mesh) => this.shadows.removeShadowCaster(mesh));
  }

  dispose(): void {
    this.templates.forEach((template) => template.dispose());
    this.templates.clear();
    this.pendingLoads.clear();
  }

  private async load(key: EnvironmentAssetKey): Promise<void> {
    if (this.templates.has(key)) return;
    let pending = this.pendingLoads.get(key);
    if (!pending) {
      const asset = ASSETS[key];
      pending = SceneLoader.LoadAssetContainerAsync(resolveAssetUrl(asset.rootUrl), asset.fileName, this.scene)
        .then((template) => {
          this.templates.set(key, template);
          return template;
        })
        .finally(() => this.pendingLoads.delete(key));
      this.pendingLoads.set(key, pending);
    }
    await pending;
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
