import "@babylonjs/loaders/glTF";
import {
  AbstractMesh,
  AssetContainer,
  Mesh,
  Quaternion,
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
  | "castle-ground-hills" | "castle-fence" | "castle-ballista" | "medieval-wagon" | "medieval-crate"
  | "forest-tree" | "forest-tree-high" | "forest-rocks-low" | "forest-rocks-high" | "forest-rocks-ramp"
  | "forest-stones" | "forest-plant" | "forest-patch-grass" | "forest-patch-dirt";

interface AssetSource {
  rootUrl: string;
  fileName: string;
}

interface EnvironmentMeshSource {
  mesh: Mesh;
  position: Vector3;
  rotation: Quaternion;
  scaling: Vector3;
}

interface EnvironmentInstanceTemplate {
  root: TransformNode;
  meshes: EnvironmentMeshSource[];
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
  "forest-tree": { rootUrl: "/assets/environment/forest/", fileName: "tree.glb" },
  "forest-tree-high": { rootUrl: "/assets/environment/forest/", fileName: "tree-high.glb" },
  "forest-rocks-low": { rootUrl: "/assets/environment/forest/", fileName: "rocks-low.glb" },
  "forest-rocks-high": { rootUrl: "/assets/environment/forest/", fileName: "rocks-high.glb" },
  "forest-rocks-ramp": { rootUrl: "/assets/environment/forest/", fileName: "rocks-ramp.glb" },
  "forest-stones": { rootUrl: "/assets/environment/forest/", fileName: "stones.glb" },
  "forest-plant": { rootUrl: "/assets/environment/forest/", fileName: "plant.glb" },
  "forest-patch-grass": { rootUrl: "/assets/environment/forest/", fileName: "patch-grass.glb" },
  "forest-patch-dirt": { rootUrl: "/assets/environment/forest/", fileName: "patch-dirt.glb" },
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
  private readonly instanceTemplates = new Map<EnvironmentAssetKey, EnvironmentInstanceTemplate>();
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

    const root = new TransformNode(name, this.scene);
    const instanceTemplate = this.instanceTemplate(key, template);
    for (const [index, source] of instanceTemplate.meshes.entries()) {
      const mesh = source.mesh.createInstance(`${name}-instance-${index}`);
      mesh.parent = root;
      mesh.position.copyFrom(source.position);
      mesh.rotationQuaternion = source.rotation.clone();
      mesh.scaling.copyFrom(source.scaling);
      mesh.isVisible = true;
      mesh.visibility = 1;
    }
    root.position.copyFrom(position);
    root.rotation.y = rotationY;
    root.scaling.setAll(scale);
    this.placeOnGround(root, position.y);
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
    this.instanceTemplates.forEach(({ root }) => root.dispose(false, false));
    this.instanceTemplates.clear();
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

  /**
   * Builds one invisible render source per mesh in an environment GLB. Every
   * placed prop then becomes a Babylon hardware instance sharing geometry and
   * material with that source instead of another imported mesh clone.
   */
  private instanceTemplate(key: EnvironmentAssetKey, template: AssetContainer): EnvironmentInstanceTemplate {
    const cached = this.instanceTemplates.get(key);
    if (cached) return cached;

    const entries = template.instantiateModelsToScene((sourceName) => `environment-source-${key}-${sourceName}`, false);
    const root = new TransformNode(`environment-source-${key}`, this.scene);
    entries.rootNodes.forEach((node) => { node.parent = root; });
    root.computeWorldMatrix(true);

    const meshes = root.getChildMeshes().filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0)
      .map((mesh) => {
        mesh.computeWorldMatrix(true);
        const scaling = new Vector3();
        const rotation = new Quaternion();
        const position = new Vector3();
        mesh.getWorldMatrix().decompose(scaling, rotation, position);
        mesh.isVisible = false;
        mesh.isPickable = false;
        mesh.receiveShadows = false;
        return { mesh, position, rotation, scaling };
      });
    entries.animationGroups.forEach((group) => { group.stop(); group.dispose(); });

    const result = { root, meshes };
    this.instanceTemplates.set(key, result);
    return result;
  }

  renderingStats(): { templateAssets: number; templateMeshes: number; instances: number } {
    const sources = [...this.instanceTemplates.values()].flatMap((template) => template.meshes.map(({ mesh }) => mesh));
    return {
      templateAssets: this.instanceTemplates.size,
      templateMeshes: sources.length,
      instances: sources.reduce((sum, source) => sum + source.instances.length, 0),
    };
  }

  private placeOnGround(root: TransformNode, targetY: number): void {
    const meshes = root.getChildMeshes();
    let minY = Number.POSITIVE_INFINITY;
    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      minY = Math.min(minY, this.minimumY(mesh));
    }
    if (Number.isFinite(minY)) root.position.y += targetY - minY;
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
