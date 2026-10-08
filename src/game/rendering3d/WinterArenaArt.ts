import { Color3, DynamicTexture, MeshBuilder, PBRMaterial, PointLight, Scene, ShadowGenerator, StandardMaterial, Texture, TransformNode, Vector3 } from "@babylonjs/core";
import { EnvironmentAssetKey, EnvironmentAssetLibrary } from "./EnvironmentAssetLibrary";
import { EnvironmentTheme } from "./EnvironmentThemes";
import { VISUAL_CONFIG } from "./VisualConfig";
import type { TerrainRegion } from "../config/MapConfig";

export interface EnvironmentCompositionStats {
  theme: EnvironmentTheme["style"];
  trees: number;
  rocks: number;
  vegetation: number;
  importedModels: number;
}

/** Static presentation only: shared materials, bounded props, no gameplay cells. */
export class WinterArenaArt {
  private readonly stone: StandardMaterial;
  private readonly soil: StandardMaterial;
  private readonly safeStone: StandardMaterial;
  private readonly contactSoilMaterial: StandardMaterial;
  private readonly outskirtsTextures = new Map<string, DynamicTexture>();
  private readonly playableTextures = new Map<EnvironmentTheme["style"], DynamicTexture>();
  private readonly playableNormals = new Map<EnvironmentTheme["style"], Texture>();
  private readonly playableRoughnessTextures = new Map<EnvironmentTheme["style"], DynamicTexture>();
  private readonly roadMaterial: PBRMaterial;
  private protectedGateZones: Array<{ x: number; z: number; side: "north" | "south" | "east" | "west" }> = [];
  private forestBorderTreeCount = 0;
  private forestBorderRockCount = 0;
  private forestBorderVegetationCount = 0;
  private forestClusterStats = { trees: 0, rocks: 0, vegetation: 0 };
  constructor(private readonly scene: Scene, private readonly assets: EnvironmentAssetLibrary,
    private readonly shadows: ShadowGenerator, private readonly width: number, private readonly depth: number) {
    this.stone = this.material("royal-guard-weathered-stone", new Color3(0.54, 0.43, 0.34));
    this.soil = this.material("royal-guard-packed-earth", new Color3(0.27, 0.28, 0.20));
    this.contactSoilMaterial = this.createContactSoilMaterial();
    this.safeStone = this.material("royal-guard-cut-stone", new Color3(0.68, 0.56, 0.43));
    this.roadMaterial = new PBRMaterial("royal-gate-cobblestone-road", scene);
    this.roadMaterial.albedoTexture = this.createPavingTexture("castle-gate-paving", 256, 256, 5, 5, 0x5147);
    this.roadMaterial.bumpTexture = this.playableGroundNormal({ style: "castle" });
    this.roadMaterial.roughness = 0.94;
    this.roadMaterial.metallic = 0;
    this.roadMaterial.albedoColor = new Color3(0.92, 0.88, 0.78);
  }

  /** Only preload assets that this Royal Guard arena can actually instantiate. */
  requiredAssetKeys(theme: EnvironmentTheme): EnvironmentAssetKey[] {
    if (theme.style === "forest") {
      return [...new Set<EnvironmentAssetKey>([
        ...theme.treeAssets, ...theme.rockAssets, ...theme.propAssets, "forest-rocks-ramp",
      ])];
    }
    return [...new Set<EnvironmentAssetKey>([
      "castle-wall", "castle-corner", "castle-gate", "castle-tower-base", "castle-tower-roof",
      "castle-flag", "castle-fence", "castle-ballista", "castle-rock", "castle-ground-hills",
      "medieval-wagon", "medieval-crate",
      ...theme.treeAssets,
      ...theme.rockAssets,
      ...theme.propAssets,
    ])];
  }

  /** Baked, map-sized courtyard paving; every logical tile remains the same size. */
  playableGroundTexture(theme: EnvironmentTheme): DynamicTexture {
    const cached = this.playableTextures.get(theme.style);
    if (cached) return cached;
    const longest = Math.max(this.width, this.depth);
    const textureWidth = Math.max(512, Math.round((1024 * this.width / longest) / 64) * 64);
    const textureHeight = Math.max(512, Math.round((1024 * this.depth / longest) / 64) * 64);
    const texture = theme.style === "forest"
      ? this.createForestFloorTexture("ancient-grove-clearing-albedo", textureWidth, textureHeight, 0x6f3a21)
      : this.createPavingTexture("kenney-castle-courtyard-albedo", textureWidth, textureHeight,
        this.width, this.depth, 0x71c3);
    texture.uScale = texture.vScale = 1;
    texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 8;
    this.playableTextures.set(theme.style, texture);
    return texture;
  }

  /** Procedural normal detail avoids dependencies on any non-Kenney source textures. */
  playableGroundNormal(theme: Pick<EnvironmentTheme, "style">): Texture {
    const cached = this.playableNormals.get(theme.style);
    if (cached) return cached;
    const texture = new DynamicTexture(theme.style === "forest" ? "forest-floor-normal" : "kenney-castle-paving-normal",
      { width: 128, height: 128 }, this.scene, false);
    const context = texture.getContext();
    context.fillStyle = "#8080ff";
    context.fillRect(0, 0, 128, 128);
    if (theme.style === "forest") {
      for (let index = 0; index < 96; index += 1) {
        const x = (index * 47 + 13) % 128, y = (index * 83 + 29) % 128;
        context.fillStyle = index % 2 === 0 ? "#7d7df8" : "#8484ff";
        context.fillRect(x, y, 2, 2);
      }
    } else {
      context.strokeStyle = "#7777ed";
      context.lineWidth = 2;
      for (let i = 0; i <= 128; i += 32) {
        context.beginPath(); context.moveTo(i, 0); context.lineTo(i, 128); context.stroke();
        context.beginPath(); context.moveTo(0, i); context.lineTo(128, i); context.stroke();
      }
    }
    texture.update(false);
    texture.gammaSpace = false;
    texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.uScale = this.width / 4;
    texture.vScale = this.depth / 4;
    texture.anisotropicFilteringLevel = 8;
    this.playableNormals.set(theme.style, texture);
    return texture;
  }

  /** Subtle surface breakup for PBR lighting; it does not alter tile geometry. */
  playableGroundRoughness(theme: EnvironmentTheme): DynamicTexture {
    const cached = this.playableRoughnessTextures.get(theme.style);
    if (cached) return cached;
    const texture = new DynamicTexture(theme.style === "forest" ? "forest-floor-roughness" : "kenney-castle-paving-roughness",
      { width: 256, height: 256 }, this.scene, false);
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
    this.playableRoughnessTextures.set(theme.style, texture);
    return texture;
  }

  private createPavingTexture(name: string, width: number, height: number, columns: number, rows: number, seed: number): DynamicTexture {
    const texture = new DynamicTexture(name, { width, height }, this.scene, true);
    const context = texture.getContext();
    context.fillStyle = "#d7d0c1";
    context.fillRect(0, 0, width, height);
    let state = seed >>> 0;
    const random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const stepX = width / columns, stepY = height / rows;
    const palette = ["#e5dfd1", "#ded8ca", "#ebe5d8", "#d9d3c5", "#e4dece"];
    // Large, low-opacity color washes break up the repeated paving without looking like
    // a second grid or introducing a painted-on noise pattern.
    for (let i = 0; i < 22; i += 1) {
      const x = (i * 173 + 37) % width, y = (i * 257 + 71) % height;
      const radius = Math.max(stepX, stepY) * (1.4 + (i % 4) * 0.42);
      const tone = i % 3 === 0 ? "rgba(133,151,108,0.035)" : i % 3 === 1 ? "rgba(250,241,219,0.10)" : "rgba(85,70,53,0.022)";
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
      context.fillStyle = "rgba(255,248,225,0.13)";
      context.fillRect(x + inset, y + inset, stepX - inset * 2, Math.max(1, stepY * 0.1));
      context.fillStyle = "rgba(73,64,53,0.045)";
      context.fillRect(x + inset, y + stepY * 0.76, stepX - inset * 2, stepY * 0.16);
    }
    for (let i = 0; i < width * height / 28; i += 1) {
      context.fillStyle = random() < 0.5 ? "rgba(52,45,39,0.045)" : "rgba(255,248,225,0.10)";
      context.fillRect(random() * width, random() * height, 1.2, 1.2);
    }
    texture.update(false);
    return texture;
  }

  /** Baked grass-and-earth clearing. The separate grid overlay remains the placement authority. */
  private createForestFloorTexture(name: string, width: number, height: number, seed: number): DynamicTexture {
    const texture = new DynamicTexture(name, { width, height }, this.scene, true);
    const context = texture.getContext();
    context.fillStyle = "#78a84e";
    context.fillRect(0, 0, width, height);
    let state = seed >>> 0;
    const random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const palette = [
      "rgba(67,125,49,0.20)", "rgba(144,181,87,0.18)", "rgba(85,145,54,0.13)",
      "rgba(143,108,61,0.16)", "rgba(102,76,43,0.10)",
    ];
    for (let index = 0; index < 88; index += 1) {
      const x = random() * width, y = random() * height;
      const radius = Math.min(width, height) * (0.025 + random() * 0.075);
      const gradient = context.createRadialGradient(x, y, radius * 0.08, x, y, radius);
      gradient.addColorStop(0, palette[index % palette.length]);
      gradient.addColorStop(0.72, palette[index % palette.length].replace(/0\.\d+\)/, "0.045)"));
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = gradient;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    // A few broad, softly broken earth lanes keep the clearing readable without
    // turning it into paving. Their seeded placement is presentation-only.
    for (let index = 0; index < 6; index += 1) {
      const startX = random() * width;
      const startY = index % 2 === 0 ? -height * 0.08 : random() * height;
      const endX = index % 2 === 0 ? startX + (random() - 0.5) * width * 0.24 : width * 1.08;
      const endY = index % 2 === 0 ? height * 1.08 : startY + (random() - 0.5) * height * 0.18;
      context.strokeStyle = index % 2 === 0 ? "rgba(111,77,42,0.30)" : "rgba(145,101,56,0.24)";
      context.lineWidth = Math.max(18, Math.min(width, height) * (0.035 + random() * 0.025));
      context.beginPath(); context.moveTo(startX, startY);
      context.quadraticCurveTo((startX + endX) / 2 + (random() - 0.5) * width * 0.12, (startY + endY) / 2, endX, endY);
      context.stroke();
    }
    for (let index = 0; index < Math.floor(width * height / 38); index += 1) {
      const x = random() * width, y = random() * height;
      context.strokeStyle = index % 4 === 0 ? "rgba(207,223,133,0.15)" : "rgba(43,91,37,0.10)";
      context.lineWidth = 0.7;
      context.beginPath(); context.moveTo(x, y); context.lineTo(x + random() * 2 - 1, y - 1.5 - random() * 2.5); context.stroke();
    }
    texture.update(false);
    return texture;
  }

  private createContactSoilMaterial(): StandardMaterial {
    const texture = new DynamicTexture("outskirts-soft-earth-contact", { width: 128, height: 128 }, this.scene, true);
    const context = texture.getContext();
    context.clearRect(0, 0, 128, 128);
    const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 63);
    gradient.addColorStop(0, "rgba(128,116,74,0.15)");
    gradient.addColorStop(0.42, "rgba(137,127,82,0.11)");
    gradient.addColorStop(0.78, "rgba(145,138,91,0.045)");
    gradient.addColorStop(1, "rgba(145,138,91,0)");
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
    const isOutskirts = name.startsWith("outskirts");
    const palette = isOutskirts
      ? ["rgba(190,204,123,0.14)", "rgba(77,119,57,0.085)", "rgba(163,145,91,0.065)"]
      : ["rgba(146,150,105,0.12)", "rgba(48,60,39,0.13)", "rgba(137,116,80,0.09)"];
    for (let i = 0; i < (isOutskirts ? 58 : 46); i += 1) {
      const x = random() * size;
      const y = random() * size;
      const radius = isOutskirts ? 26 + random() * 54 : 32 + random() * 64;
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
      ctx.fillStyle = isOutskirts
        ? i % 3 === 0 ? "rgba(235,235,179,0.065)" : "rgba(46,76,39,0.032)"
        : i % 3 === 0 ? "rgba(220,218,174,0.055)" : "rgba(27,40,24,0.065)";
      ctx.fillRect(x, y, 1 + (i % 3), 1);
    }
    for (let i = 0; i < 230; i += 1) {
      const x = random() * size, y = random() * size;
      ctx.strokeStyle = isOutskirts
        ? i % 2 === 0 ? "rgba(205,199,137,0.075)" : "rgba(55,86,42,0.045)"
        : i % 2 === 0 ? "rgba(202,198,145,0.08)" : "rgba(35,51,30,0.09)";
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

  perimeter(theme: EnvironmentTheme, gates: Array<{ x: number; z: number; side: "north" | "south" | "east" | "west" }> = []): void {
    this.protectedGateZones = gates.map((gate) => ({
      x: gate.side === "west" ? -0.9 : gate.side === "east" ? this.width + 0.9 : gate.x + 0.5,
      z: gate.side === "north" ? -0.9 : gate.side === "south" ? this.depth + 0.9 : gate.z + 0.5,
      side: gate.side,
    }));
    if (theme.style === "forest") {
      this.forestPerimeter(theme, gates);
      return;
    }
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

  /** A tightly layered, visual-only tree wall replaces every castle perimeter module. */
  private forestPerimeter(theme: EnvironmentTheme,
    gates: Array<{ x: number; z: number; side: "north" | "south" | "east" | "west" }>): void {
    this.forestBorderTreeCount = 0;
    this.forestBorderRockCount = 0;
    this.forestBorderVegetationCount = 0;
    const sides = [
      { side: "north" as const, length: this.width, fixed: -0.95 },
      { side: "south" as const, length: this.width, fixed: this.depth + 0.95 },
      { side: "west" as const, length: this.depth, fixed: -0.95 },
      { side: "east" as const, length: this.depth, fixed: this.width + 0.95 },
    ];
    const gateCoordinate = (gate: typeof gates[number]) => gate.side === "north" || gate.side === "south"
      ? gate.x + 0.5 : gate.z + 0.5;
    for (const [sideIndex, boundary] of sides.entries()) {
      const sideGates = gates.filter((gate) => gate.side === boundary.side);
      for (let row = 0; row < 2; row += 1) {
        const spacing = row === 0 ? 1.02 : 1.18;
        const count = Math.ceil((boundary.length + 2.4) / spacing);
        for (let index = 0; index <= count; index += 1) {
          const hash = Math.abs((sideIndex + 1) * 1543 + row * 3571 + index * 7919);
          const along = -1.2 + index * spacing + ((hash % 17) - 8) * 0.018;
          const openingRadius = 1.35 + row * 0.52;
          if (sideGates.some((gate) => Math.abs(along - gateCoordinate(gate)) < openingRadius)) continue;
          const outward = 0.92 + row * 1.03 + ((hash >> 3) % 11) * 0.025;
          const x = boundary.side === "west" ? -outward : boundary.side === "east" ? this.width + outward : along;
          const z = boundary.side === "north" ? -outward : boundary.side === "south" ? this.depth + outward : along;
          const key = theme.treeAssets[hash % theme.treeAssets.length];
          const scale = 1.28 + (hash % 9) * 0.055 + row * 0.10;
          const root = this.assets.instantiate(key, `forest-border-${sideIndex}-${row}-${index}`,
            new Vector3(x, 0, z), (hash % 24) * Math.PI / 12, scale, row === 0 && index % 9 === 0,
            { maxWidth: 2.2, maxHeight: 4.3, maxDepth: 2.2 });
          if (!root) continue;
          root.getChildMeshes().forEach((mesh) => { mesh.isPickable = false; mesh.receiveShadows = false; });
          root.freezeWorldMatrix();
          this.forestBorderTreeCount += 1;
        }
      }
    }
    // Ground patches and low stones frame entrances without occupying a playable cell.
    gates.forEach((gate, gateIndex) => {
      const horizontal = gate.side === "north" || gate.side === "south";
      const outwardX = gate.side === "west" ? -1 : gate.side === "east" ? 1 : 0;
      const outwardZ = gate.side === "north" ? -1 : gate.side === "south" ? 1 : 0;
      const centerX = horizontal ? gate.x + 0.5 : gate.side === "west" ? -0.8 : this.width + 0.8;
      const centerZ = horizontal ? gate.side === "north" ? -0.8 : this.depth + 0.8 : gate.z + 0.5;
      this.assets.instantiate("forest-patch-dirt", `forest-entry-trail-${gateIndex}`,
        new Vector3(centerX + outwardX * 1.4, -0.01, centerZ + outwardZ * 1.4), horizontal ? 0 : Math.PI / 2, 2.1, false);
      this.forestBorderVegetationCount += 1;
      for (const direction of [-1, 1]) {
        const tangentX = horizontal ? direction : 0, tangentZ = horizontal ? 0 : direction;
        this.assets.instantiate("forest-stones", `forest-entry-stones-${gateIndex}-${direction}`,
          new Vector3(centerX + tangentX * 1.72 + outwardX * 0.55, 0, centerZ + tangentZ * 1.72 + outwardZ * 0.55),
          direction * 0.42, 0.72, false);
        this.forestBorderRockCount += 1;
      }
    });
  }

  private createGateApproach(index: number, side: "north" | "south" | "east" | "west", gateX: number, gateZ: number): void {
    const horizontal = side === "north" || side === "south";
    const distance = 1.85;
    const outward = side === "north" || side === "west" ? -1 : 1;
    const outwardX = horizontal ? 0 : outward;
    const outwardZ = horizontal ? outward : 0;
    const x = horizontal ? gateX : side === "west" ? -distance : this.width + distance;
    const z = horizontal ? side === "north" ? -distance : this.depth + distance : gateZ;
    const apron = MeshBuilder.CreateDisc(`royal-gate-earth-apron-${index}`, { radius: 2.45, tessellation: 24 }, this.scene);
    apron.rotation.x = Math.PI / 2;
    apron.position.set(horizontal ? x : x + outward * 3.35, -0.022, horizontal ? z + outward * 3.35 : z);
    apron.material = this.contactSoilMaterial;
    apron.isPickable = false;
    apron.receiveShadows = false;
    apron.freezeWorldMatrix();
    // One continuous, straight shared-material surface runs from the threshold
    // through the gate and out into the scenery. A single mesh prevents seams.
    const roadLength = 8.4;
    const road = MeshBuilder.CreateGround(`royal-gate-road-${index}`, {
      width: 2.5,
      height: roadLength,
      subdivisions: 1,
    }, this.scene);
    road.position.set(
      gateX + outwardX * roadLength / 2,
      -0.008,
      gateZ + outwardZ * roadLength / 2,
    );
    road.rotation.y = horizontal ? 0 : Math.PI / 2;
    road.material = this.roadMaterial;
    road.isPickable = false;
    road.receiveShadows = false;
    road.freezeWorldMatrix();
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

  clusters(theme: EnvironmentTheme, seed: number, terrainRegions: readonly TerrainRegion[] = []): TransformNode[] {
    if (theme.style === "forest") return this.forestClusters(theme, seed, terrainRegions);
    const roots: TransformNode[] = [];
    const addOutskirtsAsset = (key: EnvironmentAssetKey, name: string, x: number, z: number,
      rotation: number, scale: number): void => {
      const root = this.assets.instantiate(key, name, new Vector3(x, 0, z), rotation, scale, false,
        { maxWidth: VISUAL_CONFIG.outskirtsMaxPropWidth, maxHeight: VISUAL_CONFIG.outskirtsMaxPropHeight,
          maxDepth: VISUAL_CONFIG.outskirtsMaxPropDepth });
      if (!root) return;
      const bounds = root.getHierarchyBoundingVectors(true);
      if (bounds.max.x > 0 && bounds.min.x < this.width && bounds.max.z > 0 && bounds.min.z < this.depth) {
        root.dispose(false, false);
        return;
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
    };
    // Dress both shoulders of each gate while leaving the cobblestone approach open.
    this.protectedGateZones.forEach((gate, gateIndex) => {
      const horizontal = gate.side === "north" || gate.side === "south";
      const outwardX = gate.side === "west" ? -1 : gate.side === "east" ? 1 : 0;
      const outwardZ = gate.side === "north" ? -1 : gate.side === "south" ? 1 : 0;
      for (const direction of [-1, 1]) {
        const tangentX = horizontal ? direction : 0;
        const tangentZ = horizontal ? 0 : direction;
        addOutskirtsAsset("castle-rock-large", `gate-shoulder-rock-${gateIndex}-${direction}`,
          gate.x + tangentX * 2.35 + outwardX * 2.35, gate.z + tangentZ * 2.35 + outwardZ * 2.35,
          (gateIndex + direction) * 0.31, 0.86);
        addOutskirtsAsset("castle-rock", `gate-shoulder-stones-${gateIndex}-${direction}`,
          gate.x + tangentX * 3.55 + outwardX * 3.25, gate.z + tangentZ * 3.55 + outwardZ * 3.25,
          (gateIndex - direction) * 0.47, 0.76);
        addOutskirtsAsset("castle-fence", `gate-approach-fence-${gateIndex}-${direction}`,
          gate.x + tangentX * 4.0 + outwardX * 2.8, gate.z + tangentZ * 4.0 + outwardZ * 2.8,
          horizontal ? 0 : Math.PI / 2, 0.56);
        addOutskirtsAsset("medieval-crate", `gate-supply-crate-${gateIndex}-${direction}`,
          gate.x + tangentX * 3.15 + outwardX * 4.35, gate.z + tangentZ * 3.15 + outwardZ * 4.35,
          (gateIndex * 3 + direction) * 0.38, 0.56);
      }
    });
    // Low Kenney hill meshes break up the flat outer plane while staying clear of the map.
    const hillAnchors: Array<[number, number, number]> = [
      [-4.7, -4.7, Math.PI / 4], [this.width + 4.7, -4.7, 3 * Math.PI / 4],
      [-4.7, this.depth + 4.7, -Math.PI / 4], [this.width + 4.7, this.depth + 4.7, -3 * Math.PI / 4],
    ];
    hillAnchors.forEach(([x, z, rotation], index) => {
      const hill = this.assets.instantiate("castle-ground-hills", `royal-outskirts-hill-${index}`,
        new Vector3(x, -0.06, z), rotation, 2.8, false,
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
    // Bounded edge pockets enrich the outer ring while leaving the central maze clear.
    const edgeFractions = this.width > 30
      ? [1 / 7, 2 / 7, 3 / 7, 4 / 7, 5 / 7, 6 / 7]
      : [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6];
    const sideFractions = this.width > 30 ? [0.15, 0.38, 0.62, 0.85] : [0.2, 0.5, 0.8];
    const anchors: Array<[number, number]> = [
      ...edgeFractions.map((fraction) => [this.width * fraction, -4.2] as [number, number]),
      ...sideFractions.map((fraction) => [-4.2, this.depth * fraction] as [number, number]),
      ...sideFractions.map((fraction) => [this.width + 4.2, this.depth * fraction] as [number, number]),
      ...edgeFractions.map((fraction) => [this.width * fraction, this.depth + 4.2] as [number, number]),
    ];
    // Structured scene pockets add settlement detail outside the battlefield only.
    const forest = [["tree", -0.82, -0.2], ["tree", 0.95, 0.55], ["rockLarge", 1.25, -1.05],
      ["rock", -0.1, 1.28], ["rock", 1.75, 1.05], ["rock", -1.55, -1.2]] as const;
    const rocks = [["rockLarge", -0.1, 0], ["rock", -1.15, 0.58], ["rock", 1.1, 0.7],
      ["rock", 0.2, -1.25], ["rock", 1.7, -1.05], ["tree", -1.55, 1.25], ["fence", 0.05, 1.7]] as const;
    const camp = [["ballista", -0.45, 0], ["flag", 0.95, -0.45], ["fence", 0.75, 1.2],
      ["tree", -1.35, -1.2], ["rock", 1.7, 1.2], ["rock", -1.8, 0.9]] as const;
    const storage = [["wagon", 0.1, 0], ["crate", -1.4, 0.45], ["crate", 1.25, 0.9],
      ["fence", -0.25, 1.6], ["rock", 1.65, -1.25], ["tree", -1.65, -1.4]] as const;
    const sceneKinds = theme.clusters.slice(0, anchors.length);
    sceneKinds.forEach((kind, index) => {
      const [cx, cz] = anchors[index];
      // Keep the visual corridor behind each spawn and the shared castle gate clear.
      if (this.protectedGateZones.some((gate) => Math.hypot(cx - gate.x, cz - gate.z) < 3.8)) return;
      if (kind === "village" || kind === "outpost") {
        if (this.protectedGateZones.some((gate) => Math.hypot(cx - gate.x, cz - gate.z) < 5.6)) return;
        const rotation = (index % 4) * Math.PI / 2;
        const cottage = this.createVillageCottage(index, cx, cz, rotation);
        roots.push(cottage);
        const place = (key: EnvironmentAssetKey, label: string, offsetX: number, offsetZ: number,
          itemRotation: number, scale: number): void => {
          const cos = Math.cos(rotation), sin = Math.sin(rotation);
          addOutskirtsAsset(key, `settlement-${index}-${label}`,
            cx + offsetX * cos - offsetZ * sin, cz + offsetX * sin + offsetZ * cos,
            itemRotation + rotation, scale);
        };
        if (kind === "village") {
          // A lived-in support building gets a small supply yard and greenery.
          place("medieval-wagon", "supply-wagon", 2.05, 0.35, Math.PI / 2, 0.52);
          place("medieval-crate", "crate-a", 1.45, 1.55, 0.2, 0.55);
          place("medieval-crate", "crate-b", 2.15, 1.45, -0.25, 0.48);
          place("castle-fence", "yard-fence-a", -1.9, 1.6, 0, 0.58);
          place("castle-fence", "yard-fence-b", 0.1, 2.15, Math.PI / 2, 0.58);
          place("castle-tree", "yard-tree", -2.25, -1.55, 0.3, 0.78);
          place("castle-rock", "yard-stones", 1.9, -1.55, -0.2, 0.72);
        } else {
          // A compact watch post pairs a ballista with heraldry and a fenced apron.
          place("castle-ballista", "guard-ballista", 2.0, 0.25, -Math.PI / 2, 0.54);
          place("castle-flag", "guard-banner", -1.65, -1.7, 0, 0.72);
          place("castle-fence", "guard-fence-a", -1.85, 1.55, 0, 0.6);
          place("castle-fence", "guard-fence-b", 0.05, 2.1, Math.PI / 2, 0.6);
          place("medieval-crate", "guard-supplies", 2.0, 1.45, 0.35, 0.5);
          place("castle-rock-large", "guard-stones", -2.2, -1.55, 0.4, 0.7);
        }
      } else {
        const composition = kind === "forest" ? forest : kind === "rocks" ? rocks : kind === "storage" ? storage : camp;
        composition.forEach(([category, dx, dz], part) => {
          const variation = Math.abs(seed + index * 7 + part * 11);
          const key: EnvironmentAssetKey = category === "tree" ? theme.treeAssets[variation % theme.treeAssets.length]
            : category === "rock" ? "castle-rock"
              : category === "rockLarge" ? "castle-rock-large"
            : category === "flag" ? theme.propAssets[variation % theme.propAssets.length]
            : category === "fence" ? "castle-fence"
              : category === "wagon" ? "medieval-wagon" : category === "crate" ? "medieval-crate" : "castle-ballista";
          const scale = category === "tree" ? VISUAL_CONFIG.outskirtsTreeScale
            : category === "rock" || category === "rockLarge"
              ? VISUAL_CONFIG.outskirtsRockScale * (0.84 + (variation % 5) * 0.08)
            : category === "ballista" || category === "wagon" ? VISUAL_CONFIG.outskirtsWagonScale
              : category === "crate" ? VISUAL_CONFIG.outskirtsCrateScale
                : category === "fence" ? VISUAL_CONFIG.outskirtsFenceScale : VISUAL_CONFIG.outskirtsCrateScale;
          const rotation = category === "fence" ? (variation % 2) * Math.PI / 2
            : (variation % 12) * Math.PI / 6;
          const root = this.assets.instantiate(key, `cluster-${index}-${part}`, new Vector3(cx + dx, 0, cz + dz),
            rotation,
            scale, false,
            { maxWidth: category === "wagon" ? 4 : VISUAL_CONFIG.outskirtsMaxPropWidth,
              maxHeight: VISUAL_CONFIG.outskirtsMaxPropHeight,
              maxDepth: category === "wagon" ? 4 : VISUAL_CONFIG.outskirtsMaxPropDepth });
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

  private forestClusters(theme: EnvironmentTheme, seed: number, terrainRegions: readonly TerrainRegion[]): TransformNode[] {
    const roots: TransformNode[] = [];
    this.forestClusterStats = { trees: 0, rocks: 0, vegetation: 0 };
    const place = (key: EnvironmentAssetKey, name: string, x: number, z: number, rotation: number, scale: number,
      category: keyof typeof this.forestClusterStats, allowInsideBlockedTerrain = false, elevation = 0): void => {
      const root = this.assets.instantiate(key, name, new Vector3(x, elevation, z), rotation, scale, false,
        { maxWidth: 2.6, maxHeight: 5.2, maxDepth: 2.6 });
      if (!root) return;
      const bounds = root.getHierarchyBoundingVectors(true);
      if (category === "trees" && !allowInsideBlockedTerrain && bounds.max.x > -0.12 && bounds.min.x < this.width + 0.12
        && bounds.max.z > -0.12 && bounds.min.z < this.depth + 0.12) {
        root.dispose(false, false);
        return;
      }
      root.getChildMeshes().forEach((mesh) => { mesh.isPickable = false; mesh.receiveShadows = false; });
      root.freezeWorldMatrix();
      roots.push(root);
      this.forestClusterStats[category] += 1;
    };
    const inGateCorridor = (side: "north" | "south" | "east" | "west", coordinate: number, radius: number) =>
      this.protectedGateZones.some((gate) => gate.side === side
        && Math.abs(coordinate - (side === "north" || side === "south" ? gate.x : gate.z)) < radius);
    const sides = [
      { side: "north" as const, length: this.width }, { side: "south" as const, length: this.width },
      { side: "west" as const, length: this.depth }, { side: "east" as const, length: this.depth },
    ];
    for (const [sideIndex, side] of sides.entries()) {
      for (let row = 0; row < 2; row += 1) {
        const spacing = 1.30 + row * 0.22;
        const count = Math.ceil((side.length + 5) / spacing);
        for (let index = 0; index <= count; index += 1) {
          const hash = Math.abs(seed + sideIndex * 104729 + row * 1543 + index * 7919);
          const along = -2.5 + index * spacing + ((hash % 19) - 9) * 0.027;
          if (inGateCorridor(side.side, along, 1.75 + row * 0.40)) continue;
          const distance = 3.05 + row * 1.48 + ((hash >> 4) % 13) * 0.035;
          const x = side.side === "west" ? -distance : side.side === "east" ? this.width + distance : along;
          const z = side.side === "north" ? -distance : side.side === "south" ? this.depth + distance : along;
          const tree = theme.treeAssets[hash % theme.treeAssets.length];
          place(tree, `forest-depth-tree-${sideIndex}-${row}-${index}`, x, z,
            (hash % 32) * Math.PI / 16, 1.40 + (hash % 11) * 0.055 + row * 0.12, "trees");
          if (index % 3 === 0) {
            const tangent = ((hash >> 3) % 9 - 4) * 0.08;
            const prop = index % 6 === 0 ? "forest-rocks-low" : "forest-plant";
            const px = side.side === "west" || side.side === "east" ? x + tangent : x + 0.48;
            const pz = side.side === "north" || side.side === "south" ? z + tangent : z + 0.48;
            place(prop, `forest-depth-detail-${sideIndex}-${row}-${index}`, px, pz,
              (hash % 20) * Math.PI / 10, prop === "forest-plant" ? 0.82 : 0.62,
              prop === "forest-plant" ? "vegetation" : "rocks");
          }
        }
      }
    }
    // Every blocked region keeps its exact GameState footprint; small real boulders sit inside boundary cells only.
    for (const [regionIndex, region] of terrainRegions.entries()) {
      const occupied = new Set(region.cells.map(({ x, y }) => `${x},${y}`));
      const boundary = region.cells.filter(({ x, y }) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
        .some(([nx, ny]) => !occupied.has(`${nx},${ny}`)));
      const stride = Math.max(1, Math.ceil(boundary.length / Math.max(8, Math.sqrt(region.cells.length) * 3.2)));
      for (let index = 0; index < boundary.length; index += stride) {
        const cell = boundary[index];
        const hash = Math.abs(seed + regionIndex * 65537 + cell.x * 7919 + cell.y * 1049);
        const rock = hash % 4 === 0 ? "forest-rocks-high" : hash % 3 === 0 ? "forest-stones" : "forest-rocks-low";
        place(rock, `forest-terrain-rock-${regionIndex}-${index}`, cell.x + 0.5, cell.y + 0.5,
          (hash % 16) * Math.PI / 8, rock === "forest-rocks-high" ? 0.82 : 0.72, "rocks", true, 0.72);
      }
      // Edge-connected blocked masses visually continue the surrounding woodland.
      // Trees stay at least one full blocked cell away from a walkable cell, so their crowns never hide placement lanes.
      const touchesMapEdge = region.cells.some(({ x, y }) => x === 0 || y === 0 || x === this.width - 1 || y === this.depth - 1);
      const deepCells = region.cells.filter(({ x, y }) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
        .every(([nx, ny]) => occupied.has(`${nx},${ny}`)));
      for (const [index, cell] of deepCells.entries()) {
        const hash = Math.abs(seed + regionIndex * 99991 + cell.x * 3571 + cell.y * 6271);
        if (touchesMapEdge ? hash % 3 === 0 : hash % 5 !== 0) continue;
        const key = theme.treeAssets[hash % theme.treeAssets.length];
        place(key, `forest-blocked-woodland-${regionIndex}-${index}`,
          cell.x + 0.5 + ((hash % 9) - 4) * 0.025,
          cell.y + 0.5 + (((hash >> 4) % 9) - 4) * 0.025,
          (hash % 24) * Math.PI / 12, 1.12 + (hash % 8) * 0.055, "trees", true, 0.72);
        if (hash % 7 === 0) {
          place("forest-plant", `forest-blocked-understory-${regionIndex}-${index}`,
            cell.x + 0.22, cell.y + 0.70, (hash % 12) * Math.PI / 6, 0.58, "vegetation", true, 0.72);
        }
      }
    }
    return roots;
  }

  compositionStats(theme: EnvironmentTheme): EnvironmentCompositionStats {
    if (theme.style !== "forest") {
      return { theme: "castle", trees: theme.treeCount, rocks: theme.rockCount,
        vegetation: theme.propCount, importedModels: this.requiredAssetKeys(theme).length };
    }
    return {
      theme: "forest",
      trees: this.forestBorderTreeCount + this.forestClusterStats.trees,
      rocks: this.forestBorderRockCount + this.forestClusterStats.rocks,
      vegetation: this.forestBorderVegetationCount + this.forestClusterStats.vegetation,
      importedModels: this.requiredAssetKeys(theme).length,
    };
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
