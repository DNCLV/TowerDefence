import "@babylonjs/loaders/glTF";
import {
  AbstractMesh,
  AnimationGroup,
  AssetContainer,
  Color3,
  MeshBuilder,
  Scene,
  SceneLoader,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { VISUAL_CONFIG } from "./VisualConfig";
import { resolveAssetUrl } from "../../core/AssetUrl";

export interface QuaterniusArcherVisual {
  root: TransformNode;
  bodyRoot: TransformNode;
  arrowOrigin: TransformNode;
  level: number;
  /** Presentation-only: the caller supplies the projectile visual release callback. */
  attack(onRelease: () => void): void;
  dispose(): void;
}

/** Loads the Ranger once, then creates independent cloned defender instances. */
export class QuaterniusArcherFactory {
  private static readonly ATTACK_SPEED_RATIO = 1.35;
  private static readonly ATTACK_RELEASE_NORMALIZED = 0.62;
  private template?: AssetContainer;
  private animationTemplate?: AssetContainer;
  private readonly bowMaterial: StandardMaterial;

  constructor(private readonly scene: Scene, private readonly shadows: ShadowGenerator) {
    this.bowMaterial = new StandardMaterial("quaterniusBow", scene);
    this.bowMaterial.diffuseColor = new Color3(0.2, 0.1, 0.04);
  }

  get ready(): boolean { return this.template !== undefined; }

  async load(): Promise<void> {
    this.template = await SceneLoader.LoadAssetContainerAsync(resolveAssetUrl("assets/models/quaternius/"), "Female_Ranger.gltf", this.scene);
    try {
      this.animationTemplate = await SceneLoader.LoadAssetContainerAsync(
        resolveAssetUrl("assets/animations/quaternius/"), "UAL1_Standard.glb", this.scene,
      );
      const names = new Set(this.animationTemplate.animationGroups.map((group) => group.name));
      if (!names.has("Idle_Loop") || !names.has("Spell_Simple_Shoot")) {
        console.warn("UAL1 animation source is missing Idle_Loop or Spell_Simple_Shoot; ranger remains static.");
        this.animationTemplate.dispose();
        this.animationTemplate = undefined;
      }
    } catch (error) {
      console.warn("UAL1 animation source failed to load; ranger remains in a static fallback pose.", error);
    }
  }

  create(id: number, level: number): QuaterniusArcherVisual {
    if (!this.template) throw new Error("Quaternius ranger template has not loaded.");
    const entries = this.template.instantiateModelsToScene((name) => `ranger-${id}-${name}`, false);
    const root = new TransformNode(`ranger-placement-${id}`, this.scene);
    const importedRoot = entries.rootNodes[0];
    const bodyRoot = importedRoot instanceof TransformNode
      ? importedRoot
      : new TransformNode(`ranger-model-${id}`, this.scene);
    if (!(importedRoot instanceof TransformNode)) entries.rootNodes.forEach((node) => { node.parent = bodyRoot; });
    bodyRoot.parent = root;
    // Quaternius exports are character-sized; normalize them to one grid cell and +Z gameplay facing.
    // +25% readability from the normal RTS camera; gameplay still owns one grid cell.
    bodyRoot.scaling.setAll((0.525 + (level - 1) * 0.019) * VISUAL_CONFIG.allyScaleMultiplier * VISUAL_CONFIG.defenderVisualScaleMultiplier);
    bodyRoot.rotation.y = Math.PI;
    this.placeOnGround(bodyRoot, root.getChildMeshes());
    const animatedTargets = this.targetNodes(root, id);
    const hand = animatedTargets.get("hand_r");
    const bow = this.addBow(id, hand ?? bodyRoot, level, hand !== undefined);
    const arrowOrigin = new TransformNode(`ranger-arrow-origin-${id}`, this.scene);
    // The bow is parented to the animated right hand when available, so shots originate from the pose.
    arrowOrigin.parent = bow;
    arrowOrigin.position.set(0, 0, 0.2);
    const meshes = root.getChildMeshes();
    meshes.forEach((mesh) => this.shadows.addShadowCaster(mesh));
    const animationState = this.createAnimationState(id, animatedTargets);
    return {
      root,
      // The placement root is aimed by the renderer; the imported model retains its axis correction below it.
      bodyRoot: root,
      arrowOrigin,
      level,
      attack: animationState.attack,
      dispose: animationState.dispose,
    };
  }

  private createAnimationState(id: number, targets: Map<string, TransformNode>): { attack(onRelease: () => void): void; dispose(): void } {
    const idle = this.cloneAnimation("Idle_Loop", id, targets);
    const attack = this.cloneAnimation("Spell_Simple_Shoot", id, targets);
    if (!idle || !attack) {
      return { attack: (onRelease) => onRelease(), dispose: () => undefined };
    }

    let disposed = false;
    let releaseTimer: number | undefined;
    const startIdle = () => {
      if (disposed) return;
      const offset = ((id * 17) % 100) / 100;
      const from = idle.from + (idle.to - idle.from) * offset;
      idle.start(true, 1, from, idle.to);
    };
    startIdle();
    attack.onAnimationGroupEndObservable.add(() => startIdle());

    return {
      attack: (onRelease) => {
        if (disposed) return;
        if (releaseTimer !== undefined) window.clearTimeout(releaseTimer);
        idle.stop();
        attack.stop();
        attack.start(false, QuaterniusArcherFactory.ATTACK_SPEED_RATIO);
        const duration = this.durationSeconds(attack, QuaterniusArcherFactory.ATTACK_SPEED_RATIO);
        releaseTimer = window.setTimeout(() => {
          releaseTimer = undefined;
          if (!disposed) onRelease();
        }, duration * QuaterniusArcherFactory.ATTACK_RELEASE_NORMALIZED * 1000);
      },
      dispose: () => {
        disposed = true;
        if (releaseTimer !== undefined) window.clearTimeout(releaseTimer);
        idle.stop(); attack.stop();
        idle.dispose(); attack.dispose();
      },
    };
  }

  private cloneAnimation(name: string, id: number, targets: Map<string, TransformNode>): AnimationGroup | undefined {
    const source = this.animationTemplate?.animationGroups.find((group) => group.name === name);
    if (!source) return undefined;
    return source.clone(`ranger-${id}-${name}`, (target) => {
      const targetName = target instanceof TransformNode ? target.name : "";
      return targets.get(targetName) ?? null;
    });
  }

  private targetNodes(root: TransformNode, id: number): Map<string, TransformNode> {
    const prefix = `ranger-${id}-`;
    const targets = new Map<string, TransformNode>();
    for (const node of [root, ...root.getDescendants(false)]) {
      if (!(node instanceof TransformNode)) continue;
      const sourceName = node.name.startsWith(prefix) ? node.name.slice(prefix.length) : node.name;
      targets.set(sourceName, node);
    }
    return targets;
  }

  private durationSeconds(group: AnimationGroup, speedRatio: number): number {
    const animation = group.targetedAnimations[0]?.animation;
    if (!animation || animation.framePerSecond <= 0) return 0.35;
    return Math.max(0.12, (group.to - group.from) / animation.framePerSecond / speedRatio);
  }

  private placeOnGround(bodyRoot: TransformNode, meshes: AbstractMesh[]): void {
    if (meshes.length === 0) return;
    let minimumY = Number.POSITIVE_INFINITY;
    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      minimumY = Math.min(minimumY, mesh.getBoundingInfo().boundingBox.minimumWorld.y);
    }
    if (Number.isFinite(minimumY)) bodyRoot.position.y -= minimumY;
  }

  private addBow(id: number, parent: TransformNode, level: number, followsHand: boolean): TransformNode {
    const bow = new TransformNode(`ranger-bow-${id}`, this.scene); bow.parent = parent;
    bow.position.set(followsHand ? 0.06 : 0.2, followsHand ? 0.03 : 1.1, followsHand ? 0.12 : 0.42);
    const length = level === 3 ? 0.72 : 0.64;
    for (const [side, angle] of [[-1, -0.38], [1, 0.38]] as const) {
      const limb = MeshBuilder.CreateCylinder(`ranger-bow-limb-${id}-${side}`, { height: length * 0.55, diameter: 0.035, tessellation: 5 }, this.scene);
      limb.parent = bow; limb.position.set(side * 0.07, side * length * 0.23, 0); limb.rotation.z = angle; limb.material = this.bowMaterial;
    }
    const string = MeshBuilder.CreateLines(`ranger-bow-string-${id}`, { points: [new Vector3(-0.14, -length * 0.45, 0), new Vector3(0, 0, -0.02), new Vector3(0.14, length * 0.45, 0)] }, this.scene);
    string.parent = bow; string.color = new Color3(0.7, 0.64, 0.52);
    return bow;
  }

}
