import { Color3, MeshBuilder, Scene, ShadowGenerator, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { VISUAL_CONFIG } from "./VisualConfig";

/** Babylon-only handles for a stationary Elven Archer defender. */
export interface ArcherVisual {
  root: TransformNode;
  bodyRoot: TransformNode;
  arrowOrigin: TransformNode;
  level: number;
}

/** Creates original, low-poly fantasy archers while sharing all materials. */
export class ArcherMeshFactory {
  private readonly skin: StandardMaterial;
  private readonly cloth: StandardMaterial;
  private readonly accent: StandardMaterial;
  private readonly armor: StandardMaterial;
  private readonly leather: StandardMaterial;
  private readonly gold: StandardMaterial;

  constructor(private readonly scene: Scene, private readonly shadows: ShadowGenerator) {
    this.skin = this.material("elfSkin", new Color3(0.77, 0.85, 0.7));
    this.cloth = this.material("elfCloth", new Color3(0.08, 0.33, 0.27));
    this.accent = this.material("elfAccent", new Color3(0.08, 0.48, 0.63));
    this.armor = this.material("elfArmor", new Color3(0.55, 0.64, 0.67));
    this.leather = this.material("elfLeather", new Color3(0.22, 0.12, 0.06));
    this.gold = this.material("elfGold", new Color3(0.78, 0.59, 0.19), new Color3(0.18, 0.11, 0.01));
  }

  create(id: number, level: number): ArcherVisual {
    const root = new TransformNode(`archer-${id}`, this.scene);
    // Keep the primitive fallback equally readable if the imported ranger is unavailable.
    root.scaling.setAll(1.25 * VISUAL_CONFIG.allyScaleMultiplier * VISUAL_CONFIG.defenderVisualScaleMultiplier);
    const bodyRoot = new TransformNode(`archer-body-${id}`, this.scene); bodyRoot.parent = root; bodyRoot.rotation.x = -0.09;
    this.legs(id, bodyRoot);
    const waist = MeshBuilder.CreateCylinder(`archer-waist-${id}`, { height: 0.14, diameter: 0.24, tessellation: 6 }, this.scene);
    waist.parent = bodyRoot; waist.position.y = 0.93; waist.material = this.leather;
    const torso = MeshBuilder.CreateCylinder(`archer-torso-${id}`, { height: 0.64, diameterTop: 0.4, diameterBottom: 0.25, tessellation: 6 }, this.scene);
    torso.parent = bodyRoot; torso.position.y = 1.27; torso.material = this.cloth;
    const chest = MeshBuilder.CreateCylinder(`archer-chest-${id}`, { height: 0.2, diameterTop: 0.33, diameterBottom: 0.29, tessellation: 6 }, this.scene);
    chest.parent = bodyRoot; chest.position.set(0, 1.32, 0.16); chest.material = this.armor;
    const belt = MeshBuilder.CreateTorus(`archer-belt-${id}`, { diameter: 0.26, thickness: 0.035, tessellation: 6 }, this.scene);
    belt.parent = bodyRoot; belt.position.y = 0.93; belt.material = this.leather;

    const hoodBack = MeshBuilder.CreateCylinder(`archer-hood-back-${id}`, { height: 0.52, diameterTop: 0.2, diameterBottom: 0.43, tessellation: 6 }, this.scene);
    hoodBack.parent = bodyRoot; hoodBack.position.set(0, 1.85, -0.1); hoodBack.material = level >= 2 ? this.accent : this.cloth;
    const face = MeshBuilder.CreateSphere(`archer-face-${id}`, { diameter: 0.29, segments: 6 }, this.scene);
    face.parent = bodyRoot; face.position.set(0, 1.82, 0.16); face.scaling.set(0.76, 1.16, 0.66); face.material = this.skin;
    const chin = MeshBuilder.CreateCylinder(`archer-chin-${id}`, { height: 0.13, diameterTop: 0.06, diameterBottom: 0.12, tessellation: 5 }, this.scene);
    chin.parent = bodyRoot; chin.position.set(0, 1.63, 0.17); chin.material = this.skin;
    this.ear(`archer-ear-left-${id}`, bodyRoot, -0.25); this.ear(`archer-ear-right-${id}`, bodyRoot, 0.25);

    const bowRoot = new TransformNode(`archer-bow-${id}`, this.scene); bowRoot.parent = bodyRoot; bowRoot.position.set(0.33, 1.34, 0.36);
    this.arms(id, bodyRoot, bowRoot);
    this.longbow(id, bowRoot, level);
    const arrowOrigin = new TransformNode(`archer-arrow-origin-${id}`, this.scene); arrowOrigin.parent = bowRoot; arrowOrigin.position.set(0, 0, 0.08);
    this.quiver(id, bodyRoot, level);
    if (level >= 2) this.shoulders(id, bodyRoot, level === 3 ? this.gold : this.armor);
    if (level === 3) this.eliteDetails(id, bodyRoot);

    root.getChildMeshes().forEach((mesh) => this.shadows.addShadowCaster(mesh));
    return { root, bodyRoot, arrowOrigin, level };
  }

  private shoulders(id: number, parent: TransformNode, material: StandardMaterial): void {
    for (const x of [-0.28, 0.28]) {
      const shoulder = MeshBuilder.CreateSphere(`archer-shoulder-${id}-${x}`, { diameter: 0.25, segments: 4 }, this.scene);
      shoulder.parent = parent; shoulder.position.set(x, 1.55, 0); shoulder.material = material;
    }
  }

  private eliteDetails(id: number, parent: TransformNode): void {
    const cloak = MeshBuilder.CreateCylinder(`archer-cloak-${id}`, { height: 0.72, diameterTop: 0.25, diameterBottom: 0.58, tessellation: 5 }, this.scene);
    cloak.parent = parent; cloak.position.set(0, 1.08, -0.16); cloak.material = this.accent;
    const crest = MeshBuilder.CreateCylinder(`archer-crest-${id}`, { height: 0.18, diameterTop: 0, diameterBottom: 0.16, tessellation: 4 }, this.scene);
    crest.parent = parent; crest.position.y = 2.13; crest.material = this.gold;
  }

  private arms(id: number, parent: TransformNode, bow: TransformNode): void {
    const forwardArm = new TransformNode(`archer-forward-arm-${id}`, this.scene); forwardArm.parent = parent; forwardArm.position.set(0.24, 1.52, 0.1); forwardArm.rotation.z = -0.82;
    this.armSegment(`archer-forward-upper-${id}`, forwardArm, 0, -0.22, this.skin);
    this.armSegment(`archer-forward-bracer-${id}`, forwardArm, 0.1, -0.43, this.armor);
    const drawArm = new TransformNode(`archer-draw-arm-${id}`, this.scene); drawArm.parent = parent; drawArm.position.set(-0.23, 1.5, 0.04); drawArm.rotation.z = 0.95;
    this.armSegment(`archer-draw-upper-${id}`, drawArm, 0, -0.21, this.skin);
    this.armSegment(`archer-draw-bracer-${id}`, drawArm, -0.08, -0.42, this.armor);
    bow.rotation.z = -0.08;
  }

  private armSegment(name: string, parent: TransformNode, x: number, y: number, material: StandardMaterial): void {
    const segment = MeshBuilder.CreateCylinder(name, { height: 0.34, diameter: 0.09, tessellation: 5 }, this.scene);
    segment.parent = parent; segment.position.set(x, y, 0); segment.material = material;
  }

  private legs(id: number, parent: TransformNode): void {
    for (const x of [-0.17, 0.17]) {
      const thigh = MeshBuilder.CreateCylinder(`archer-thigh-${id}-${x}`, { height: 0.46, diameterTop: 0.13, diameterBottom: 0.15, tessellation: 5 }, this.scene);
      thigh.parent = parent; thigh.position.set(x, 0.74, x < 0 ? -0.08 : 0.08); thigh.rotation.z = x * 0.58; thigh.material = this.cloth;
      const shin = MeshBuilder.CreateCylinder(`archer-shin-${id}-${x}`, { height: 0.43, diameter: 0.1, tessellation: 5 }, this.scene);
      shin.parent = parent; shin.position.set(x * 1.28, 0.34, x < 0 ? -0.16 : 0.16); shin.rotation.z = -x * 0.32; shin.material = this.armor;
      const boot = MeshBuilder.CreateBox(`archer-boot-${id}-${x}`, { width: 0.15, height: 0.12, depth: 0.24 }, this.scene);
      boot.parent = parent; boot.position.set(x * 1.42, 0.06, 0.18); boot.material = this.leather;
    }
  }

  private longbow(id: number, parent: TransformNode, level: number): void {
    const material = level === 3 ? this.gold : this.leather;
    const size = level === 3 ? 0.62 : 0.55;
    for (const [side, tilt] of [[-1, -0.42], [1, 0.42]] as const) {
      const limb = MeshBuilder.CreateCylinder(`archer-bow-limb-${id}-${side}`, { height: size, diameter: 0.045, tessellation: 5 }, this.scene);
      limb.parent = parent; limb.position.set(side * 0.08, side * size * 0.45, 0); limb.rotation.z = tilt; limb.material = material;
    }
    const string = MeshBuilder.CreateLines(`archer-bow-string-${id}`, { points: [new Vector3(-0.17, -size * 0.83, 0), new Vector3(0, 0, -0.015), new Vector3(0.17, size * 0.83, 0)] }, this.scene);
    string.parent = parent; string.color = new Color3(0.76, 0.68, 0.52);
  }

  private quiver(id: number, parent: TransformNode, level: number): void {
    const quiver = MeshBuilder.CreateCylinder(`archer-quiver-${id}`, { height: level >= 2 ? 0.52 : 0.45, diameterTop: 0.13, diameterBottom: 0.18, tessellation: 5 }, this.scene);
    quiver.parent = parent; quiver.position.set(-0.22, 1.42, -0.24); quiver.rotation.z = 0.42; quiver.material = this.leather;
    for (let index = 0; index < 4; index += 1) {
      const shaft = MeshBuilder.CreateCylinder(`archer-quiver-arrow-${id}-${index}`, { height: 0.32, diameter: 0.018, tessellation: 4 }, this.scene);
      shaft.parent = parent; shaft.position.set(-0.22 + (index - 1.5) * 0.035, 1.74, -0.24); shaft.rotation.z = 0.42; shaft.material = this.leather;
    }
  }

  private ear(name: string, parent: TransformNode, x: number): void {
    const ear = MeshBuilder.CreateCylinder(name, { height: 0.34, diameterTop: 0, diameterBottom: 0.13, tessellation: 4 }, this.scene);
    ear.parent = parent; ear.position.set(x, 1.84, 0.03); ear.rotation.z = x < 0 ? Math.PI / 2.65 : -Math.PI / 2.65; ear.rotation.x = -0.24; ear.material = this.skin;
  }

  private material(name: string, color: Color3, emissive?: Color3): StandardMaterial {
    const material = new StandardMaterial(name, this.scene); material.diffuseColor = color;
    if (emissive) material.emissiveColor = emissive;
    return material;
  }
}
