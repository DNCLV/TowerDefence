import {
  Color3,
  Mesh,
  MeshBuilder,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import { Scene } from "@babylonjs/core/scene";
import type { EnemyType } from "../config/EnemyConfig";
import { ENEMY_VISUAL_CONFIG } from "./EnemyVisualConfig";

/** Babylon-only handles used to animate and dispose a single enemy visual. */
export interface GoblinVisual {
  root: TransformNode;
  leftArm: TransformNode;
  rightArm: TransformNode;
  healthBack: Mesh;
  healthFill: Mesh;
  lastHpRatio: number;
}

/**
 * Builds original, primitive-only goblins. Materials are created once and
 * shared by every instance, keeping spawning inexpensive.
 */
export class EnemyMeshFactory {
  private readonly skin: StandardMaterial;
  private readonly leather: StandardMaterial;
  private readonly metal: StandardMaterial;
  private readonly darkCloth: StandardMaterial;
  private readonly healthBack: StandardMaterial;
  private readonly healthFront: StandardMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly shadows: ShadowGenerator,
    private readonly castEnemyShadows = false,
  ) {
    this.skin = this.createMaterial("goblinSkin", new Color3(0.25, 0.43, 0.22));
    this.leather = this.createMaterial("goblinLeather", new Color3(0.2, 0.11, 0.06));
    this.metal = this.createMaterial("goblinMetal", new Color3(0.33, 0.36, 0.37));
    this.darkCloth = this.createMaterial("goblinDarkCloth", new Color3(0.08, 0.09, 0.1));
    this.healthBack = this.createMaterial("enemyHealthBack", new Color3(0.035, 0.025, 0.03), true);
    this.healthFront = this.createMaterial("enemyHealthFront", new Color3(0.88, 0.10, 0.12), true);
  }

  create(id: number, type: EnemyType = "goblin"): GoblinVisual {
    const root = new TransformNode(`goblin-${id}`, this.scene);
    const visualConfig = ENEMY_VISUAL_CONFIG[type];
    const fallbackScale = visualConfig.sourceDimensions.height * visualConfig.scale / 1.68;
    // A type-sized safe primitive fallback; movement coordinates remain in GameState.
    root.scaling.setAll(fallbackScale);
    const torso = MeshBuilder.CreateCylinder(`goblin-torso-${id}`, { height: 0.7, diameterTop: 0.38, diameterBottom: 0.5, tessellation: 6 }, this.scene);
    torso.parent = root; torso.position.y = 0.68; torso.material = this.leather;
    const head = MeshBuilder.CreateSphere(`goblin-head-${id}`, { diameter: 0.56, segments: 6 }, this.scene);
    head.parent = root; head.position.set(0, 1.22, 0.08); head.material = this.skin;

    const leftArm = new TransformNode(`goblin-left-arm-${id}`, this.scene); leftArm.parent = root; leftArm.position.set(-0.32, 0.88, 0);
    const rightArm = new TransformNode(`goblin-right-arm-${id}`, this.scene); rightArm.parent = root; rightArm.position.set(0.32, 0.88, 0);
    this.limb(`goblin-left-arm-mesh-${id}`, leftArm, this.skin, 0.42, -0.12);
    this.limb(`goblin-right-arm-mesh-${id}`, rightArm, this.skin, 0.42, 0.12);
    this.limb(`goblin-left-leg-${id}`, root, this.darkCloth, 0.4, -0.14, 0.24);
    this.limb(`goblin-right-leg-${id}`, root, this.darkCloth, 0.4, 0.14, 0.24);

    const earLeft = MeshBuilder.CreateCylinder(`goblin-ear-left-${id}`, { height: 0.28, diameterTop: 0, diameterBottom: 0.18, tessellation: 4 }, this.scene);
    earLeft.parent = root; earLeft.position.set(-0.34, 1.24, 0.05); earLeft.rotation.z = Math.PI / 2; earLeft.material = this.skin;
    const earRight = earLeft.clone(`goblin-ear-right-${id}`)!; earRight.parent = root; earRight.position.x = 0.34; earRight.rotation.z = -Math.PI / 2;

    const handle = MeshBuilder.CreateCylinder(`goblin-club-${id}`, { height: 0.58, diameter: 0.06, tessellation: 5 }, this.scene);
    handle.parent = rightArm; handle.position.set(0, -0.3, 0.06); handle.rotation.z = -0.4; handle.material = this.leather;
    const club = MeshBuilder.CreateBox(`goblin-club-head-${id}`, { size: 0.18 }, this.scene);
    club.parent = rightArm; club.position.set(0.11, -0.53, 0.06); club.material = this.metal;

    const healthBack = MeshBuilder.CreatePlane(`goblin-health-back-${id}`, { width: 0.72, height: 0.1 }, this.scene);
    healthBack.parent = root; healthBack.position.set(0, 1.68, 0); healthBack.billboardMode = Mesh.BILLBOARDMODE_ALL; healthBack.material = this.healthBack;
    const healthFill = MeshBuilder.CreatePlane(`goblin-health-fill-${id}`, { width: 0.68, height: 0.06 }, this.scene);
    healthFill.parent = root; healthFill.position.set(0, 1.68, -0.01); healthFill.billboardMode = Mesh.BILLBOARDMODE_ALL; healthFill.material = this.healthFront;
    const barLocalHeight = visualConfig.hpBarOffsetY / fallbackScale;
    healthBack.position.y = barLocalHeight;
    healthFill.position.y = barLocalHeight;
    healthBack.setEnabled(false);
    healthFill.setEnabled(false);

    if (this.castEnemyShadows) {
      root.getChildMeshes().filter((mesh) => mesh !== healthBack && mesh !== healthFill)
        .forEach((mesh) => this.shadows.addShadowCaster(mesh));
    }
    return { root, leftArm, rightArm, healthBack, healthFill, lastHpRatio: 1 };
  }

  private limb(name: string, parent: TransformNode, material: StandardMaterial, height: number, x: number, y = -0.2): void {
    const limb = MeshBuilder.CreateCylinder(name, { height, diameter: 0.13, tessellation: 5 }, this.scene);
    limb.parent = parent; limb.position.set(x, y, 0); limb.material = material;
  }

  private createMaterial(name: string, color: Color3, emissive = false): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = color;
    if (emissive) material.emissiveColor = color;
    return material;
  }
}
