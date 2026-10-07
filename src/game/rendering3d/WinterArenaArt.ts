import { Color3, DynamicTexture, MeshBuilder, PBRMaterial, PointLight, Scene, ShadowGenerator, StandardMaterial, Texture, TransformNode, Vector3 } from "@babylonjs/core";
import { EnvironmentAssetKey, EnvironmentAssetLibrary } from "./EnvironmentAssetLibrary";
import { EnvironmentTheme } from "./EnvironmentThemes";
import { VISUAL_CONFIG } from "./VisualConfig";

/** Static presentation only: shared materials, bounded props, no gameplay cells. */
export class WinterArenaArt {
  private readonly stone: StandardMaterial;
  private readonly soil: StandardMaterial;
  private readonly safeStone: StandardMaterial;
  private readonly contactSoilMaterial: StandardMaterial;
  private readonly outskirtsTextures = new Map<string, DynamicTexture>();
  private playableTexture?: DynamicTexture;
  private playableNormal?: Texture;
  private playableRoughnessTexture?: DynamicTexture;
  private readonly roadMaterial: PBRMaterial;
  private protectedGateZones: Array<{ x: number; z: number; side: "north" | "south" | "east" | "west" }> = [];
  constructor(private readonly scene: Scene, private readonly assets: EnvironmentAssetLibrary,
    private readonly shadows: ShadowGenerator, private readonly width: number, private readonly depth: number) {
    this.stone = this.material("royal-guard-weathered-stone", new Color3(0.54, 0.43, 0.34));
    this.soil = this.material("royal-guard-packed-earth", new Color3(0.27, 0.28, 0.20));
    this.contactSoilMaterial = this.createContactSoilMaterial();
    this.safeStone = this.material("royal-guard-cut-stone", new Color3(0.68, 0.56, 0.43));
    this.roadMaterial = new PBRMaterial("royal-gate-cobblestone-road", scene);
    this.roadMaterial.albedoTexture = this.createPavingTexture("castle-gate-paving", 256, 256, 5, 5, 0x5147);
    this.roadMaterial.bumpTexture = this.playableGroundNormal();
    this.roadMaterial.roughness = 0.94;
    this.roadMaterial.metallic = 0;
    this.roadMaterial.albedoColor = new Color3(0.92, 0.88, 0.78);
  }

  /** Only preload assets that this Royal Guard arena can actually instantiate. */
  requiredAssetKeys(theme: EnvironmentTheme): EnvironmentAssetKey[] {
    return [...new Set<EnvironmentAssetKey>([
      "castle-wall", "castle-corner", "castle-gate", "castle-tower-base", "castle-tower-roof",
      "castle-flag", "castle-fence", "castle-ballista", "castle-rock", "castle-ground-hills",
      ...theme.treeAssets,
      ...theme.rockAssets,
      ...theme.propAssets,
    ])];
  }

  /** Baked, map-sized courtyard paving; every logical tile remains the same size. */
  playableGroundTexture(): DynamicTexture {
    if (this.playableTexture) return this.playableTexture;
    const longest = Math.max(this.width, this.depth);
    const textureWidth = Math.max(512, Math.round((1024 * this.width / longest) / 64) * 64);
    const textureHeight = Math.max(512, Math.round((1024 * this.depth / longest) / 64) * 64);
    this.playableTexture = this.createPavingTexture("kenney-castle-courtyard-albedo", textureWidth, textureHeight,
      this.width, this.depth, 0x71c3);
    this.playableTexture.uScale = this.playableTexture.vScale = 1;
    this.playableTexture.wrapU = this.playableTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.playableTexture.anisotropicFilteringLevel = 8;
    return this.playableTexture;
  }

  /** Procedural normal detail avoids dependencies on any non-Kenney source textures. */
  playableGroundNormal(): Texture {
    if (this.playableNormal) return this.playableNormal;
    const texture = new DynamicTexture("kenney-castle-paving-normal", { width: 128, height: 128 }, this.scene, false);
    const context = texture.getContext();
    context.fillStyle = "#8080ff";
    context.fillRect(0, 0, 128, 128);
    context.strokeStyle = "#7777ed";
    context.lineWidth = 2;
    for (let i = 0; i <= 128; i += 32) {
      context.beginPath(); context.moveTo(i, 0); context.lineTo(i, 128); context.stroke();
      context.beginPath(); context.moveTo(0, i); context.lineTo(128, i); context.stroke();
    }
    texture.update(false);
    texture.gammaSpace = false;
    texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.uScale = this.width / 4;
    texture.vScale = this.depth / 4;
    texture.anisotropicFilteringLevel = 8;
    this.playableNormal = texture;
    return texture;
  }

  /** Subtle surface breakup for PBR lighting; it does not alter tile geometry. */
  playableGroundRoughness(): DynamicTexture {
    if (this.playableRoughnessTexture) return this.playableRoughnessTexture;
    const texture = new DynamicTexture("kenney-castle-paving-roughness", { width: 256, height: 256 }, this.scene, false);
    const context = texture.getContext();
    // glTF-style packed metallic/roughness channels: G is roughness, B is metallic.
    // Keep blue at zero so the non-metallic stone remains non-metallic.
    const image = new ImageData(256, 256);
    for (let pixel = 0; pixel < image.data.length; pixel += 4) {
      image.data[pixel] = 0;
      image.data[pixel + 1] = 232;
      image.data[pixel + 2] = 0;
      image.data[pixel + 3] = 255;
    }
    for (let i = 0; i < 30; i += 1) {
      const x = (i * 89 + 23) % 256, y = (i * 149 + 47) % 256;
      const radius = 18 + (i * 13) % 37;
      const roughness = i % 2 === 0 ? 211 : 248;
      for (let py = Math.max(0, y - radius); py < Math.min(256, y + radius); py += 1) {
        for (let px = Math.max(0, x - radius); px < Math.min(256, x + radius); px += 1) {
          const distance = Math.hypot(px - x, py - y) / radius;
          if (distance >= 1) continue;
          const blend = (1 - distance) * 0.28;
          const offset = (py * 256 + px) * 4 + 1;
          image.data[offset] = Math.round(image.data[offset] * (1 - blend) + roughness * blend);
        }
      }
    }
    context.putImageData(image, 0, 0);
    texture.update(false);
    texture.gammaSpace = false;
    texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.uScale = this.width / 4;
    texture.vScale = this.depth / 4;
    texture.anisotropicFilteringLevel = 8;
    this.playableRoughnessTexture = texture;
    return texture;
  }

  private createPavingTexture(name: string, width: number, height: number, columns: number, rows: number, seed: number): DynamicTexture {
    const texture = new DynamicTexture(name, { width, height }, this.scene, true);
    const context = texture.getContext();
    context.fillStyle = "#8e806e";
    context.fillRect(0, 0, width, height);
    let state = seed >>> 0;
    const random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const stepX = width / columns, stepY = height / rows;
    const palette = ["#b8ab91", "#afa187", "#c0b297", "#a99c85", "#b4a78e"];
    // Large, low-opacity color washes break up the repeated paving without looking like
    // a second grid or introducing a painted-on noise pattern.
    for (let i = 0; i < 22; i += 1) {
      const x = (i * 173 + 37) % width, y = (i * 257 + 71) % height;
      const radius = Math.max(stepX, stepY) * (1.4 + (i % 4) * 0.42);
      const tone = i % 3 === 0 ? "rgba(91,111,77,0.065)" : i % 3 === 1 ? "rgba(236,219,184,0.12)" : "rgba(85,70,53,0.045)";
      const wash = context.createRadialGradient(x, y, radius * 0.04, x, y, radius);
      wash.addColorStop(0, tone);
      wash.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = wash;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const x = column * stepX, y = row * stepY;
      const inset = Math.max(0.7, Math.min(stepX, stepY) * 0.065);
      context.fillStyle = palette[Math.floor(random() * palette.length)];
      context.fillRect(x + inset, y + inset, stepX - inset * 2, stepY - inset * 2);
      context.fillStyle = "rgba(244,226,186,0.09)";
      context.fillRect(x + inset, y + inset, stepX - inset * 2, Math.max(1, stepY * 0.1));
      context.fillStyle = "rgba(55,45,34,0.08)";
      context.fillRect(x + inset, y + stepY * 0.76, stepX - inset * 2, stepY * 0.16);
    }
    for (let i = 0; i < width * height / 28; i += 1) {
      context.fillStyle = random() < 0.5 ? "rgba(52,45,39,0.08)" : "rgba(241,225,192,0.10)";
      context.fillRect(random() * width, random() * height, 1.2, 1.2);
    }
    texture.update(false);
    return texture;
  }

  private createContactSoilMaterial(): StandardMaterial {
    const texture = new DynamicTexture("outskirts-soft-earth-contact", { width: 128, height: 128 }, this.scene, true);
    const context = texture.getContext();
    context.clearRect(0, 0, 128, 128);
    const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 63);
    gradient.addColorStop(0, "rgba(91,67,45,0.23)");
    gradient.addColorStop(0.42, "rgba(104,79,50,0.17)");
    gradient.addColorStop(0.78, "rgba(110,89,59,0.065)");
    gradient.addColorStop(1, "rgba(110,89,59,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    texture.hasAlpha = true;
    texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    texture.update(false);
    const material = new StandardMaterial("outskirts-soft-earth-contact-material", this.scene);
    material.diffuseTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
    material.alpha = 0.9;
    material.disableDepthWrite = true;
    material.specularColor = Color3.Black();
    material.backFaceCulling = false;
    return material;
  }

  private createGroundTexture(name: string, size: number, base: string, seed: number): DynamicTexture {
    const texture = new DynamicTexture(name, { width: size, height: size }, this.scene, true);
    const ctx = texture.getContext();
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    let state = seed >>> 0;
    const random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const palette = name.startsWith("outskirts")
      ? ["rgba(139,145,91,0.13)", "rgba(35,49,29,0.16)", "rgba(126,105,70,0.11)"]
      : ["rgba(146,150,105,0.12)", "rgba(48,60,39,0.13)", "rgba(137,116,80,0.09)"];
    for (let i = 0; i < 46; i += 1) {
      const x = random() * size;
      const y = random() * size;
      const radius = 32 + random() * 64;
      const color = palette[i % palette.length];
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
        const gx = x + ox, gy = y + oy;
        if (gx < -radius || gx > size + radius || gy < -radius || gy > size + radius) continue;
        const gradient = ctx.createRadialGradient(gx, gy, 1, gx, gy, radius);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(gx - radius, gy - radius, radius * 2, radius * 2);
      }
    }
    for (let i = 0; i < 1800; i += 1) {
      const x = Math.floor(random() * size), y = Math.floor(random() * size);
      ctx.fillStyle = i % 3 === 0 ? "rgba(220,218,174,0.055)" : "rgba(27,40,24,0.065)";
      ctx.fillRect(x, y, 1 + (i % 3), 1);
    }
    for (let i = 0; i < 230; i += 1) {
      const x = random() * size, y = random() * size;
      ctx.strokeStyle = i % 2 === 0 ? "rgba(202,198,145,0.08)" : "rgba(35,51,30,0.09)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (random() - 0.5) * 4, y - 1 - random() * 3);
      ctx.stroke();
    }
    texture.update(false);
    return texture;
  }

  /** Broad, baked meadow color shifts add restrained variation beyond the playfield. */
  outskirtsTexture(theme: EnvironmentTheme): DynamicTexture {
    const cached = this.outskirtsTextures.get(theme.id);
    if (cached) return cached;
    const texture = this.createGroundTexture(`outskirts-${theme.id}`, 512, theme.outskirtsGround.toHexString(), 0x7129);
    texture.uScale = (this.width + 72) / 14;
    texture.vScale = (this.depth + 72) / 14;
    texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
    this.outskirtsTextures.set(theme.id, texture);
    return texture;
  }

  /** Two small, static warm markers soften the cold perimeter without lighting the whole map. */
  warmOutskirtsAccents(): void {
    if (this.protectedGateZones.length === 0) return;
    const iron = this.material("royal-brazier-dark-iron", new Color3(0.16, 0.18, 0.17));
    const ember = this.material("royal-brazier-ember", new Color3(1, 0.39, 0.08));
    ember.emissiveColor = new Color3(0.92, 0.20, 0.025);
    const accentGates = [
      { gate: this.protectedGateZones[0], direction: -1 },
      { gate: this.protectedGateZones[this.protectedGateZones.length - 1], direction: 1 },
    ];
    accentGates.forEach(({ gate, direction }, index) => {
      const horizontal = gate.side === "north" || gate.side === "south";
      const tangentX = horizontal ? direction : 0;
      const tangentZ = horizontal ? 0 : direction;
      this.addBrazier(`royal-gate-brazier-${index}`,
        gate.x + tangentX * 3.05, gate.z + tangentZ * 3.05, iron, ember);
      const light = new PointLight(`royal-gate-brazier-light-${index}`,
        new Vector3(gate.x + tangentX * 3.05, 0.95, gate.z + tangentZ * 3.05), this.scene);
      light.diffuse = new Color3(1, 0.50, 0.20);
      light.intensity = VISUAL_CONFIG.warmOutskirtsLightIntensity;
      light.range = VISUAL_CONFIG.warmOutskirtsLightRange;
    });
  }

  private addBrazier(name: string, x: number, z: number, iron: StandardMaterial, ember: StandardMaterial): void {
    const base = MeshBuilder.CreateCylinder(`${name}-foot`, { height: 0.18, diameterTop: 0.25, diameterBottom: 0.32, tessellation: 7 }, this.scene);
    base.position.set(x, 0.09, z); base.material = iron; base.isPickable = false; base.freezeWorldMatrix();
    const stem = MeshBuilder.CreateCylinder(`${name}-stem`, { height: 0.63, diameter: 0.105, tessellation: 6 }, this.scene);
    stem.position.set(x, 0.46, z); stem.material = iron; stem.isPickable = false; stem.freezeWorldMatrix();
    const bowl = MeshBuilder.CreateCylinder(`${name}-bowl`, { height: 0.17, diameterTop: 0.39, diameterBottom: 0.20, tessellation: 7 }, this.scene);
    bowl.position.set(x, 0.83, z); bowl.material = iron; bowl.isPickable = false; bowl.freezeWorldMatrix();
    const flame = MeshBuilder.CreateSphere(`${name}-flame`, { diameter: 0.19, segments: 6 }, this.scene);
    flame.position.set(x, 0.97, z); flame.scaling.y = 1.35; flame.material = ember; flame.isPickable = false; flame.freezeWorldMatrix();
  }

  /** One baked canvas texture replaces the flat planes. No noise or runtime redraw. */
  snowTexture(): DynamicTexture {
    const texture = new DynamicTexture("snow-clearing-variation", { width: 512, height: 512 }, this.scene, true);
    const ctx = texture.getContext();
    ctx.fillStyle = "#e1e9ec"; ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 22; i++) {
      const x = (i * 137 + 43) % 512, y = (i * 193 + 71) % 512;
      ctx.save(); ctx.translate(x, y); ctx.scale(1.6, 0.75);
      const gradient = ctx.createRadialGradient(0, 0, 2, 0, 0, 130);
      gradient.addColorStop(0, i % 3 === 0 ? "rgba(250,253,253,0.23)" : "rgba(69,105,130,0.12)");
      gradient.addColorStop(0.4, i % 3 === 0 ? "rgba(217,232,237,0.16)" : "rgba(100,137,159,0.09)");
      gradient.addColorStop(1, "rgba(150,180,196,0)");
      ctx.fillStyle = gradient; ctx.fillRect(-130, -130, 260, 260); ctx.restore();
    }
    // Fine, low-contrast grain adds snow surface breakup without competing with the grid.
    for (let i = 0; i < 1400; i++) {
      const x = (i * 97 + 17) % 512;
      const y = (i * 151 + 43) % 512;
      ctx.fillStyle = i % 4 === 0 ? "rgba(255,255,255,0.12)" : "rgba(64,103,128,0.035)";
      ctx.fillRect(x, y, 1, 1);
    }
    texture.update(false);
    return texture;
  }

  perimeter(gates: Array<{ x: number; z: number; side: "north" | "south" | "east" | "west" }> = []): void {
    this.protectedGateZones = gates.map((gate) => ({
      x: gate.side === "west" ? -0.9 : gate.side === "east" ? this.width + 0.9 : gate.x + 0.5,
      z: gate.side === "north" ? -0.9 : gate.side === "south" ? this.depth + 0.9 : gate.z + 0.5,
      side: gate.side,
    }));
    // Open the decorative border exactly where the selected map's gates are located.
    const boundaries = [
      { horizontal: true, x: this.width / 2, z: -0.9, start: -0.5, end: this.width + 0.5, holes: gates.filter((gate) => gate.side === "north").map((gate) => gate.x) },
      { horizontal: true, x: this.width / 2, z: this.depth + 0.9, start: -0.5, end: this.width + 0.5, holes: gates.filter((gate) => gate.side === "south").map((gate) => gate.x) },
      { horizontal: false, x: -0.9, z: this.depth / 2, start: -0.5, end: this.depth + 0.5, holes: gates.filter((gate) => gate.side === "west").map((gate) => gate.z) },
      { horizontal: false, x: this.width + 0.9, z: this.depth / 2, start: -0.5, end: this.depth + 0.5, holes: gates.filter((gate) => gate.side === "east").map((gate) => gate.z) },
    ];
    let run = 0;
    for (const boundary of boundaries) {
      const centers = boundary.holes.map((cell) => cell + 0.5).sort((a, b) => a - b);
      const segments: Array<[number, number]> = [];
      let cursor = boundary.start;
      for (const center of centers) {
        const gapStart = center - 1.15;
        const gapEnd = center + 1.15;
        if (gapStart > cursor) segments.push([cursor, gapStart]);
        cursor = Math.max(cursor, gapEnd);
      }
      if (cursor < boundary.end) segments.push([cursor, boundary.end]);
      for (const [start, end] of segments) {
        const length = end - start;
        if (length < 0.8) continue;
        const midpoint = (start + end) / 2;
        const x = boundary.horizontal ? midpoint : boundary.x;
        const z = boundary.horizontal ? boundary.z : midpoint;
        this.box(`royal-wall-foundation-${run}`, x, 0.13, z, boundary.horizontal ? length : 1.4, 0.32, boundary.horizontal ? 1.4 : length, this.soil);
        this.box(`royal-stone-wall-course-${run}`, x, 0.31, z, boundary.horizontal ? length : 1.3, 0.12, boundary.horizontal ? 1.3 : length, this.safeStone);
        // Native Kenney modules are roughly one tile wide; repeating them keeps
        // battlements readable instead of stretching one mesh into a long strip.
        const pieces = Math.ceil(length / 1.35);
        const pieceLength = length / pieces;
        for (let index = 0; index < pieces; index += 1) {
          const offset = start + pieceLength * (index + 0.5);
          this.fittedAsset("castle-wall", `royal-perimeter-${run}-${index}`, boundary.horizontal ? offset : boundary.x,
            boundary.horizontal ? boundary.z : offset, 0.9, 1.65, pieceLength + 0.035,
            boundary.horizontal ? Math.PI / 2 : 0, undefined, false);
        }
        run += 1;
      }
    }
    gates.forEach((gate, index) => {
      const horizontal = gate.side === "north" || gate.side === "south";
      const x = horizontal ? gate.x + 0.5 : gate.side === "west" ? -0.9 : this.width + 0.9;
      const z = horizontal ? gate.side === "north" ? -0.9 : this.depth + 0.9 : gate.z + 0.5;
      this.fittedAsset("castle-gate", `royal-gatehouse-${index}`, x, z, 0.95, 2.45, 2.65,
        horizontal ? Math.PI / 2 : 0, undefined, true);
      this.createGateApproach(index, gate.side, x, z);
      const rotation = horizontal ? Math.PI / 2 : 0;
      const tangentX = horizontal ? 1 : 0;
      const tangentZ = horizontal ? 0 : 1;
      for (const direction of [-1, 1]) {
        this.fittedAsset("castle-flag", `royal-gate-banner-${index}-${direction}`,
          x + tangentX * direction * 1.7, z + tangentZ * direction * 1.7,
          0.42, 1.55, 0.42, rotation, undefined, false, 1.25);
      }
    });

    // Four ornamental watchtowers frame the outside corners without entering the grid.
    const towers: Array<[number, number]> = [
      [-1.5, -1.5], [this.width + 1.5, -1.5], [-1.5, this.depth + 1.5], [this.width + 1.5, this.depth + 1.5],
    ];
    towers.forEach(([x, z], index) => {
      this.fittedAsset("castle-corner", `royal-watchtower-bastion-${index}`, x, z,
        2.2, 1.2, 2.2, index * Math.PI / 2, undefined, false);
      this.fittedAsset("castle-tower-base", `royal-watchtower-stone-${index}`, x, z, 1.65, 2.15, 1.65, 0, undefined, true);
      this.fittedAsset("castle-tower-roof", `royal-watchtower-roof-${index}`, x, z, 1.9, 1.45, 1.9, 0, undefined, true, 2.1);
      const frontZ = z < 0 ? z + 0.84 : z - 0.84;
      this.fittedAsset("castle-flag", `royal-watchtower-banner-${index}`, x, frontZ,
        0.42, 1.25, 0.42, 0, undefined, false, 2.1);
    });
  }

  private createGateApproach(index: number, side: "north" | "south" | "east" | "west", gateX: number, gateZ: number): void {
    const horizontal = side === "north" || side === "south";
    const distance = 1.85;
    const x = horizontal ? gateX : side === "west" ? -distance : this.width + distance;
    const z = horizontal ? side === "north" ? -distance : this.depth + distance : gateZ;
    const path = MeshBuilder.CreateGround(`royal-cobblestone-approach-${index}`, {
      width: horizontal ? 2.15 : 3.2,
      height: horizontal ? 3.2 : 2.15,
      subdivisions: 1,
    }, this.scene);
    path.position.set(x, -0.008, z);
    path.material = this.roadMaterial;
    path.isPickable = false;
    path.receiveShadows = false;
    path.freezeWorldMatrix();
  }

  landmark(kind: "spawn" | "exit", x: number, z: number, accent: StandardMaterial): void {
    // Gate glTF surfaces were the only registered casters directly over the spawn/goal,
    // producing oversized dark silhouettes on the single-tile markers below.
    this.fittedAsset("castle-gate", `${kind}-hero-gate`, x, z, 2.7, 2.8, 0.85, Math.PI / 2, undefined, false);
    for (const offset of [-2.65, 2.65]) {
      this.fittedAsset("castle-tower-base", `${kind}-buttress-${offset}`, x, z + offset,
        1.08, 2.4, 1.08, 0, undefined, false);
      this.fittedAsset("castle-tower-roof", `${kind}-roof-${offset}`, x, z + offset,
        1.25, 0.86, 1.25, 0, undefined, false, 2.36);
      this.box(`${kind}-crest-${offset}`, x + (kind === "spawn" ? 0.59 : -0.59), 2.1, z + offset,
        0.04, 0.65, 0.38, accent);
    }
    // The separate multi-cell threshold slab was redundant with the entry/goal
    // tile marker and made both endpoints read as broad approach strips.
  }

  clusters(theme: EnvironmentTheme, seed: number): TransformNode[] {
    const roots: TransformNode[] = [];
    // Low Kenney hill meshes break up the flat outer plane while staying clear of the map.
    const hillAnchors: Array<[number, number, number]> = [
      [-5.4, -5.4, 0], [this.width + 5.4, -5.4, Math.PI / 2],
      [-5.4, this.depth + 5.4, -Math.PI / 2], [this.width + 5.4, this.depth + 5.4, Math.PI],
    ];
    hillAnchors.forEach(([x, z, rotation], index) => {
      const hill = this.assets.instantiate("castle-ground-hills", `royal-outskirts-hill-${index}`,
        new Vector3(x, -0.06, z), rotation, 8.2, false,
        { maxWidth: 8.6, maxHeight: 2.6, maxDepth: 8.6 });
      if (!hill) return;
      const bounds = hill.getHierarchyBoundingVectors(true);
      if (bounds.max.x > 0 && bounds.min.x < this.width && bounds.max.z > 0 && bounds.min.z < this.depth) {
        hill.dispose(false, false);
        return;
      }
      hill.getChildMeshes().forEach((mesh) => { mesh.isPickable = false; mesh.receiveShadows = false; mesh.freezeWorldMatrix(); });
      hill.freezeWorldMatrix();
      roots.push(hill);
    });
    // Twelve bounded edge pockets enrich the outer ring while leaving the central maze clear.
    const quarter = this.width / 4;
    const anchors = [
      [quarter, -4.2], [quarter * 2, -4.2], [quarter * 3, -4.2], [this.width - quarter, -4.2],
      [-4.2, this.depth * 0.25], [-4.2, this.depth * 0.75], [this.width + 4.2, this.depth * 0.25], [this.width + 4.2, this.depth * 0.75],
      [quarter, this.depth + 4.2], [quarter * 2, this.depth + 4.2], [quarter * 3, this.depth + 4.2], [this.width - quarter, this.depth + 4.2],
    ];
    const forest = [["tree", -0.72, 0], ["tree", 0.78, 0.5], ["rock", 1.2, -0.95], ["rock", -0.1, 1.15]] as const;
    const rocks = [["wall", -0.75, 0], ["rock", 0.75, 0.55], ["rock", 0.0, -1.1], ["fence", 0.2, 1.05]] as const;
    const camp = [["ballista", -0.45, 0], ["flag", 0.95, -0.45], ["fence", 0.75, 1.05], ["tree", -1.15, -1.05]] as const;
    theme.clusters.forEach((kind, index) => {
      const [cx, cz] = anchors[index % anchors.length];
      // Keep the visual corridor behind each spawn and the shared castle gate clear.
      if (this.protectedGateZones.some((gate) => Math.hypot(cx - gate.x, cz - gate.z) < 3.8)) return;
      if (kind === "village") {
        if (this.protectedGateZones.some((gate) => Math.hypot(cx - gate.x, cz - gate.z) < 5.6)) return;
        const cottage = this.createVillageCottage(index, cx, cz, index % 2 === 0 ? 0 : Math.PI);
        roots.push(cottage);
      } else {
        const composition = kind === "forest" ? forest : kind === "rocks" ? rocks : camp;
        composition.forEach(([category, dx, dz], part) => {
          const variation = Math.abs(seed + index * 7 + part * 11);
          const key: EnvironmentAssetKey = category === "tree" ? theme.treeAssets[variation % theme.treeAssets.length]
            : category === "rock" ? theme.rockAssets[variation % theme.rockAssets.length]
            : category === "flag" ? theme.propAssets[variation % theme.propAssets.length]
            : category === "wall" ? "castle-wall" : category === "fence" ? "castle-fence" : "castle-ballista";
          const scale = category === "tree" ? VISUAL_CONFIG.outskirtsTreeScale
            : category === "rock" ? VISUAL_CONFIG.outskirtsRockScale
              : category === "ballista" ? VISUAL_CONFIG.outskirtsWagonScale
                : category === "fence" ? VISUAL_CONFIG.outskirtsFenceScale
                  : category === "wall" ? VISUAL_CONFIG.outskirtsWallScale : VISUAL_CONFIG.outskirtsCrateScale;
          const rotation = category === "fence" ? 0 : category === "wall" ? (variation % 2) * Math.PI / 2 : (variation % 12) * Math.PI / 6;
          const root = this.assets.instantiate(key, `cluster-${index}-${part}`, new Vector3(cx + dx, 0, cz + dz),
            rotation,
            scale, false,
            { maxWidth: VISUAL_CONFIG.outskirtsMaxPropWidth, maxHeight: VISUAL_CONFIG.outskirtsMaxPropHeight, maxDepth: VISUAL_CONFIG.outskirtsMaxPropDepth });
          if (!root) return;
          const bounds = root.getHierarchyBoundingVectors(true);
          // Reject anything reaching the protected center, including wide imported siblings.
          if (bounds.max.x > 0 && bounds.min.x < this.width && bounds.max.z > 0 && bounds.min.z < this.depth) {
            root.dispose(false, false); return;
          }
          root.getChildMeshes().forEach((mesh) => {
            mesh.isPickable = false;
            mesh.receiveShadows = false;
            mesh.computeWorldMatrix(true);
            mesh.freezeWorldMatrix();
          });
          root.computeWorldMatrix(true);
          root.freezeWorldMatrix();
          roots.push(root);
        });
      }
      const bed = MeshBuilder.CreateDisc(`cluster-ground-${index}`, {
        radius: kind === "village" ? 2.35 : VISUAL_CONFIG.outskirtsClusterBedRadius, tessellation: 16,
      }, this.scene);
      bed.rotation.x = Math.PI / 2; bed.position.set(cx, -0.028, cz); bed.material = this.contactSoilMaterial;
      bed.isPickable = false; bed.receiveShadows = false; bed.freezeWorldMatrix(); roots.push(bed);
    });
    return roots;
  }

  /** Small Kenney watch posts extend the castle silhouette beyond the playable grid. */
  private createVillageCottage(index: number, x: number, z: number, rotation: number): TransformNode {
    const cottage = new TransformNode(`royal-outskirts-cottage-${index}`, this.scene);
    cottage.position.set(x, 0, z);
    cottage.rotation.y = rotation;
    const plinth = this.box(`cottage-${index}-stone-plinth`, 0, 0.09, 0, 2.65, 0.18, 2.65, this.safeStone, cottage);
    plinth.receiveShadows = true;

    this.fittedAsset("castle-tower-base", `cottage-${index}-stone-base`, 0, 0,
      2.1, 2.4, 2.1, 0, undefined, true, 0, cottage);
    this.fittedAsset("castle-tower-roof", `cottage-${index}-blue-roof`, 0, 0,
      2.55, 1.7, 2.55, 0, undefined, true, 2.35, cottage);
    this.fittedAsset("castle-flag", `cottage-${index}-heraldry`, 0, -1.16,
      0.56, 1.35, 0.35, 0, undefined, false, 1.1, cottage);
    plinth.computeWorldMatrix(true);
    plinth.freezeWorldMatrix();
    cottage.computeWorldMatrix(true);
    cottage.freezeWorldMatrix();
    return cottage;
  }

  private fittedAsset(key: EnvironmentAssetKey, name: string, x: number, z: number, width: number,
    height: number, depth: number, rotation: number, material?: StandardMaterial, castsShadows = true,
    verticalOffset = 0, parent?: TransformNode): void {
    const root = this.assets.instantiate(key, name, Vector3.Zero(), 0, 1, false);
    if (!root) {
      this.box(name, x, height / 2 + verticalOffset, z, rotation ? depth : width, height, rotation ? width : depth,
        material ?? this.stone, parent);
      return;
    }
    const bounds = root.getHierarchyBoundingVectors(true);
    const dimensions = bounds.max.subtract(bounds.min);
    if (![dimensions.x, dimensions.y, dimensions.z].every(value => Number.isFinite(value) && value > 0.0001)) {
      root.dispose(false, false); return;
    }
    const wrapper = new TransformNode(`${name}-fitted`, this.scene);
    root.parent = wrapper;
    root.scaling.multiplyInPlace(new Vector3(width / dimensions.x, height / dimensions.y, depth / dimensions.z));
    root.computeWorldMatrix(true);
    const fitted = root.getHierarchyBoundingVectors(true);
    root.position.addInPlace(new Vector3(-(fitted.min.x + fitted.max.x) / 2, -fitted.min.y, -(fitted.min.z + fitted.max.z) / 2));
    wrapper.rotation.y = rotation;
    wrapper.parent = parent ?? null;
    wrapper.position.set(x, verticalOffset, z);
    root.getChildMeshes().forEach(mesh => {
      if (material) mesh.material = material;
      mesh.isPickable = false;
      if (castsShadows) this.shadows.addShadowCaster(mesh);
      mesh.computeWorldMatrix(true);
      mesh.freezeWorldMatrix();
    });
  }
  private box(name: string, x: number, y: number, z: number, width: number, height: number, depth: number,
    material: StandardMaterial, parent?: TransformNode) {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
    mesh.parent = parent ?? null;
    mesh.position.set(x, y, z); mesh.material = material; mesh.isPickable = false;
    return mesh;
  }
  private material(name: string, color: Color3): StandardMaterial {
    const material = new StandardMaterial(name, this.scene); material.diffuseColor = color;
    material.specularColor = Color3.Black(); return material;
  }
}
