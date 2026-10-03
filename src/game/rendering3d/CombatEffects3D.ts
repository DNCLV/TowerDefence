import { AbstractMesh, Color3, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { VISUAL_CONFIG } from "./VisualConfig";

interface TimedEffect {
  mesh: AbstractMesh;
  remaining: number;
  duration: number;
  grows: boolean;
}

interface ArrowEffect {
  root: TransformNode;
  from: Vector3;
  target: Vector3;
  remaining: number;
  duration: number;
}

interface ArcaneProjectile {
  root: TransformNode;
  from: Vector3;
  control: Vector3;
  target: Vector3;
  tangent: Vector3;
  remaining: number;
  duration: number;
  enemyDied: boolean;
}

interface ArcaneBurstParticle {
  mesh: AbstractMesh;
  direction: Vector3;
}

interface ArcaneBurst {
  root: TransformNode;
  ring: AbstractMesh;
  particles: ArcaneBurstParticle[];
  remaining: number;
  duration: number;
}

/** Visual-only, short-lived combat feedback. It never reads or alters gameplay. */
export class CombatEffects3D {
  private readonly effects: TimedEffect[] = [];
  private readonly arrows: ArrowEffect[] = [];
  private readonly arcaneProjectiles: ArcaneProjectile[] = [];
  private readonly arcaneBursts: ArcaneBurst[] = [];
  private readonly hitMaterial: StandardMaterial;
  private readonly meleeMaterial: StandardMaterial;
  private readonly deathMaterial: StandardMaterial;
  private readonly arrowWood: StandardMaterial;
  private readonly arrowMetal: StandardMaterial;
  private readonly arcaneCore: StandardMaterial;
  private readonly arcaneGlow: StandardMaterial;
  private readonly arcaneHalo: StandardMaterial;
  private readonly arcaneTrail: StandardMaterial;
  private readonly arcaneRing: StandardMaterial;
  private arcaneProjectilesCreated = 0;
  private arcaneBurstsCreated = 0;

  constructor(private readonly scene: Scene) {
    this.hitMaterial = this.material("icyHit", new Color3(0.5, 0.85, 1));
    this.meleeMaterial = this.glowMaterial("holyKnightImpact", new Color3(1, 0.78, 0.28), 0.9);
    this.deathMaterial = this.material("enemyDeath", new Color3(0.28, 0.16, 0.13));
    this.arrowWood = this.material("arrowWood", new Color3(0.27, 0.16, 0.07));
    this.arrowMetal = this.material("arrowMetal", new Color3(0.62, 0.7, 0.73));
    this.arcaneCore = this.glowMaterial("arcaneProjectileCore", VISUAL_CONFIG.arcaneCoreColor, 1);
    this.arcaneGlow = this.glowMaterial("arcaneProjectileGlow", VISUAL_CONFIG.arcaneGlowColor, 0.45);
    this.arcaneHalo = this.glowMaterial("arcaneProjectileHalo", VISUAL_CONFIG.arcaneHighlightColor, 0.17);
    this.arcaneTrail = this.glowMaterial("arcaneProjectileTrail", VISUAL_CONFIG.arcaneGlowColor, 0.48);
    this.arcaneRing = this.glowMaterial("arcaneImpactRing", VISUAL_CONFIG.arcaneHighlightColor, 0.78);
  }

  get activeEffectCount(): number { return this.effects.length + this.arcaneBursts.length; }
  get activeProjectileCount(): number { return this.arrows.length + this.arcaneProjectiles.length; }
  get activeArcaneProjectileCount(): number { return this.arcaneProjectiles.length; }
  get activeArcaneBurstCount(): number { return this.arcaneBursts.length; }
  get totalArcaneProjectilesCreated(): number { return this.arcaneProjectilesCreated; }
  get totalArcaneBurstsCreated(): number { return this.arcaneBurstsCreated; }

  showShot(from: Vector3, target: Vector3, enemyDied: boolean): void {
    this.createArrow(from, target);
    this.addBurst(target, this.hitMaterial, 0.11, 0.12, false);
    if (enemyDied) this.addBurst(target, this.deathMaterial, 0.22, 0.22, true);
  }

  /** Short contact flash only; Holy Knight attacks do not create a projectile. */
  showMeleeHit(target: Vector3, enemyDied: boolean): void {
    this.addBurst(target, this.meleeMaterial, 0.16, 0.1, false);
    if (enemyDied) this.addBurst(target, this.deathMaterial, 0.2, 0.18, true);
  }

  /** Small secondary-target cue for splash; it carries no gameplay timing. */
  showSplashHit(target: Vector3): void {
    this.addBurst(target, this.hitMaterial, 0.085, 0.075, false);
  }

  /** Arcane bolt is presentation-only; GameState has already applied its attack event. */
  showArcaneShot(from: Vector3, target: Vector3, enemyDied: boolean): void {
    if (this.arcaneProjectiles.length >= VISUAL_CONFIG.arcaneMaxProjectiles) {
      this.disposeArcaneProjectile(this.arcaneProjectiles.shift()!);
    }
    const id = ++this.nextArcaneId;
    this.arcaneProjectilesCreated += 1;
    const root = new TransformNode(`arcane-projectile-${id}`, this.scene);
    root.position.copyFrom(from);
    this.addArcaneOrbMeshes(root, id);
    const distance = Vector3.Distance(from, target);
    const duration = Math.min(VISUAL_CONFIG.arcaneMaxFlightSeconds, Math.max(
      VISUAL_CONFIG.arcaneMinFlightSeconds,
      distance * VISUAL_CONFIG.arcaneFlightSecondsPerUnit,
    ));
    const control = Vector3.Lerp(from, target, 0.5);
    // A quadratic Bezier reaches half of its control-point offset at the midpoint.
    control.y += VISUAL_CONFIG.arcaneArcHeight * 2;
    this.arcaneProjectiles.push({
      root, from: from.clone(), control, target: target.clone(), tangent: target.clone(),
      remaining: duration, duration, enemyDied,
    });
  }

  update(deltaSeconds: number): void {
    for (let index = this.arrows.length - 1; index >= 0; index -= 1) {
      const arrow = this.arrows[index];
      arrow.remaining -= deltaSeconds;
      const progress = 1 - Math.max(0, arrow.remaining) / arrow.duration;
      Vector3.LerpToRef(arrow.from, arrow.target, progress, arrow.root.position);
      if (arrow.remaining > 0) continue;
      arrow.root.dispose(false, false);
      this.arrows.splice(index, 1);
    }
    for (let index = this.effects.length - 1; index >= 0; index -= 1) {
      const effect = this.effects[index];
      effect.remaining -= deltaSeconds;
      const progress = 1 - Math.max(0, effect.remaining) / effect.duration;
      effect.mesh.visibility = 1 - progress;
      if (effect.grows) effect.mesh.scaling.setAll(1 + progress * 1.4);
      if (effect.remaining > 0) continue;
      effect.mesh.dispose(false, false);
      this.effects.splice(index, 1);
    }
    this.updateArcaneProjectiles(deltaSeconds);
    this.updateArcaneBursts(deltaSeconds);
  }

  clear(): void {
    this.effects.forEach((effect) => effect.mesh.dispose(false, false));
    this.effects.length = 0;
    this.arrows.forEach((arrow) => arrow.root.dispose(false, false));
    this.arrows.length = 0;
    this.arcaneProjectiles.forEach((projectile) => this.disposeArcaneProjectile(projectile));
    this.arcaneProjectiles.length = 0;
    this.arcaneBursts.forEach((burst) => burst.root.dispose(false, false));
    this.arcaneBursts.length = 0;
  }

  private createArrow(from: Vector3, target: Vector3): void {
    const root = new TransformNode("archer-arrow", this.scene);
    root.position.copyFrom(from);
    root.rotation.y = Math.atan2(target.x - from.x, target.z - from.z);
    const shaft = MeshBuilder.CreateCylinder("arrow-shaft", { height: 0.42, diameter: 0.028, tessellation: 5 }, this.scene);
    shaft.parent = root; shaft.rotation.x = Math.PI / 2; shaft.position.z = 0.05; shaft.material = this.arrowWood;
    const tip = MeshBuilder.CreateCylinder("arrow-tip", { height: 0.1, diameterTop: 0, diameterBottom: 0.06, tessellation: 4 }, this.scene);
    tip.parent = root; tip.rotation.x = Math.PI / 2; tip.position.z = 0.29; tip.material = this.arrowMetal;
    const duration = 0.18;
    if (this.arrows.length >= VISUAL_CONFIG.arcaneMaxProjectiles) {
      this.arrows.shift()?.root.dispose(false, false);
    }
    this.arrows.push({ root, from: from.clone(), target: target.clone(), remaining: duration, duration });
  }

  private addBurst(position: Vector3, material: StandardMaterial, size: number, duration: number, grows: boolean): void {
    const burst = MeshBuilder.CreateSphere("combat-burst", { diameter: size, segments: 4 }, this.scene);
    burst.position.copyFrom(position);
    burst.material = material;
    this.effects.push({ mesh: burst, remaining: duration, duration, grows });
  }

  private material(name: string, color: Color3): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = color;
    material.emissiveColor = color;
    return material;
  }

  private glowMaterial(name: string, color: Color3, alpha: number): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = color;
    material.emissiveColor = color;
    material.specularColor = Color3.Black();
    material.alpha = alpha;
    material.disableLighting = true;
    material.backFaceCulling = false;
    return material;
  }

  private addArcaneOrbMeshes(root: TransformNode, id: number): void {
    const core = MeshBuilder.CreateSphere(`arcane-core-${id}`, {
      diameter: VISUAL_CONFIG.arcaneProjectileDiameter, segments: 8,
    }, this.scene);
    core.parent = root;
    core.material = this.arcaneCore;
    core.isPickable = false;

    const innerGlow = MeshBuilder.CreateSphere(`arcane-inner-glow-${id}`, {
      diameter: VISUAL_CONFIG.arcaneProjectileDiameter * 1.55, segments: 8,
    }, this.scene);
    innerGlow.parent = root;
    innerGlow.material = this.arcaneGlow;
    innerGlow.isPickable = false;

    const halo = MeshBuilder.CreateSphere(`arcane-halo-${id}`, {
      diameter: VISUAL_CONFIG.arcaneHaloDiameter, segments: 8,
    }, this.scene);
    halo.parent = root;
    halo.material = this.arcaneHalo;
    halo.isPickable = false;

    // Three tiny spheres trail behind the moving orb; all share one material.
    [0.11, 0.21, 0.30].forEach((offset, index) => {
      const particle = MeshBuilder.CreateSphere(`arcane-trail-${id}-${index}`, {
        diameter: 0.065 - index * 0.014, segments: 5,
      }, this.scene);
      particle.parent = root;
      particle.position.z = -offset;
      particle.material = this.arcaneTrail;
      particle.isPickable = false;
    });
  }

  private updateArcaneProjectiles(deltaSeconds: number): void {
    for (let index = this.arcaneProjectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.arcaneProjectiles[index];
      projectile.remaining -= deltaSeconds;
      const progress = Math.min(1, 1 - Math.max(0, projectile.remaining) / projectile.duration);
      this.bezierPoint(projectile, progress, projectile.root.position);
      this.bezierPoint(projectile, Math.min(1, progress + 0.035), projectile.tangent);
      projectile.root.lookAt(projectile.tangent);
      if (projectile.remaining > 0) continue;

      this.addArcaneBurst(projectile.target);
      if (projectile.enemyDied) this.addBurst(projectile.target, this.deathMaterial, 0.18, 0.18, true);
      this.disposeArcaneProjectile(projectile);
      this.arcaneProjectiles.splice(index, 1);
    }
  }

  private bezierPoint(projectile: ArcaneProjectile, t: number, out: Vector3): void {
    const inverse = 1 - t;
    out.set(
      inverse * inverse * projectile.from.x + 2 * inverse * t * projectile.control.x + t * t * projectile.target.x,
      inverse * inverse * projectile.from.y + 2 * inverse * t * projectile.control.y + t * t * projectile.target.y,
      inverse * inverse * projectile.from.z + 2 * inverse * t * projectile.control.z + t * t * projectile.target.z,
    );
  }

  private addArcaneBurst(position: Vector3): void {
    if (this.arcaneBursts.length >= VISUAL_CONFIG.arcaneMaxBursts) {
      this.arcaneBursts.shift()?.root.dispose(false, false);
    }
    const id = ++this.nextArcaneId;
    this.arcaneBurstsCreated += 1;
    const root = new TransformNode(`arcane-impact-${id}`, this.scene);
    root.position.copyFrom(position);

    const ring = MeshBuilder.CreateTorus(`arcane-impact-ring-${id}`, {
      diameter: 0.28, thickness: 0.035, tessellation: 12,
    }, this.scene);
    ring.parent = root;
    ring.position.y = 0.015;
    ring.scaling.set(0.35, 0.65, 0.35);
    ring.material = this.arcaneRing;
    ring.isPickable = false;

    const particles: ArcaneBurstParticle[] = [];
    for (let index = 0; index < 6; index += 1) {
      const angle = (Math.PI * 2 * index) / 6;
      const direction = new Vector3(Math.cos(angle), 0.25 + (index % 2) * 0.14, Math.sin(angle));
      const particle = MeshBuilder.CreateSphere(`arcane-impact-particle-${id}-${index}`, {
        diameter: index % 2 === 0 ? 0.075 : 0.055, segments: 5,
      }, this.scene);
      particle.parent = root;
      particle.position.set(direction.x * 0.06, direction.y * 0.03, direction.z * 0.06);
      particle.material = index % 2 === 0 ? this.arcaneGlow : this.arcaneHalo;
      particle.isPickable = false;
      particles.push({ mesh: particle, direction });
    }
    const duration = VISUAL_CONFIG.arcaneBurstDuration;
    this.arcaneBursts.push({ root, ring, particles, remaining: duration, duration });
  }

  private updateArcaneBursts(deltaSeconds: number): void {
    for (let index = this.arcaneBursts.length - 1; index >= 0; index -= 1) {
      const burst = this.arcaneBursts[index];
      burst.remaining -= deltaSeconds;
      const progress = Math.min(1, 1 - Math.max(0, burst.remaining) / burst.duration);
      const fade = 1 - progress;
      const ringScale = 0.35 + progress * 1.45;
      burst.ring.scaling.set(ringScale, 0.65, ringScale);
      burst.ring.visibility = fade;
      for (const particle of burst.particles) {
        const distance = 0.06 + progress * 0.24;
        particle.mesh.position.set(
          particle.direction.x * distance,
          0.03 + progress * 0.15 * particle.direction.y,
          particle.direction.z * distance,
        );
        particle.mesh.visibility = fade;
      }
      if (burst.remaining > 0) continue;
      burst.root.dispose(false, false);
      this.arcaneBursts.splice(index, 1);
    }
  }

  private disposeArcaneProjectile(projectile: ArcaneProjectile): void {
    projectile.root.dispose(false, false);
  }

  private nextArcaneId = 0;
}
