import { Color3, DynamicTexture, MeshBuilder, PointLight, Scene, ShadowGenerator, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { EnvironmentAssetKey, EnvironmentAssetLibrary } from "./EnvironmentAssetLibrary";
import { EnvironmentTheme } from "./EnvironmentThemes";
import { VISUAL_CONFIG } from "./VisualConfig";

/** Static presentation only: shared materials, bounded props, no gameplay cells. */
export class WinterArenaArt {
  private readonly stone: StandardMaterial;
  private readonly snow: StandardMaterial;
  private readonly soil: StandardMaterial;
  private readonly frost: StandardMaterial;
  private readonly safeStone: StandardMaterial;
  private readonly outskirtsTextures = new Map<string, DynamicTexture>();
  constructor(private readonly scene: Scene, private readonly assets: EnvironmentAssetLibrary,
    private readonly shadows: ShadowGenerator, private readonly width: number, private readonly depth: number) {
    this.stone = this.material("arena-cold-stone", new Color3(0.19, 0.25, 0.30));
    this.snow = this.material("arena-bank-snow", new Color3(0.55, 0.65, 0.70));
    this.soil = this.material("arena-frozen-soil", new Color3(0.16, 0.23, 0.25));
    this.frost = this.material("arena-edge-frost", new Color3(0.48, 0.61, 0.67));
    this.safeStone = this.material("arena-sanctuary-stone", new Color3(0.43, 0.53, 0.58));
  }

  /** A few broad, baked frost/snow shifts give the outside plane depth without noisy tiling. */
  outskirtsTexture(theme: EnvironmentTheme): DynamicTexture {
    const cached = this.outskirtsTextures.get(theme.id);
    if (cached) return cached;
    const size = 256;
    const texture = new DynamicTexture(`outskirts-${theme.id}`, { width: size, height: size }, this.scene, false);
    const ctx = texture.getContext();
    ctx.fillStyle = theme.outskirtsGround.toHexString();
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 11; i++) {
      const x = (i * 79 + 31) % size;
      const y = (i * 113 + 47) % size;
      const radius = 34 + (i % 4) * 11;
      const gradient = ctx.createRadialGradient(x, y, 2, x, y, radius);
      const frostPatch = i % 3 === 0;
      gradient.addColorStop(0, frostPatch ? "rgba(190,216,225,0.19)" : "rgba(8,18,24,0.15)");
      gradient.addColorStop(1, "rgba(24,38,46,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    // Sparse, soft snow breaks up the darker soil; the large gradients stay low-frequency.
    for (let i = 0; i < 5; i++) {
      const x = (i * 97 + 26) % size;
      const y = (i * 61 + 172) % size;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((i % 4) * 0.38);
      ctx.scale(1.8, 0.62);
      const patch = ctx.createRadialGradient(0, 0, 2, 0, 0, 25 + (i % 2) * 9);
      patch.addColorStop(0, "rgba(205,225,231,0.23)");
      patch.addColorStop(1, "rgba(190,215,224,0)");
      ctx.fillStyle = patch;
      ctx.fillRect(-38, -38, 76, 76);
      ctx.restore();
    }
    texture.update(false);
    this.outskirtsTextures.set(theme.id, texture);
    return texture;
  }

  /** Two small, static warm markers soften the cold perimeter without lighting the whole map. */
  warmOutskirtsAccents(): void {
    const material = this.material("outskirts-warm-ember", new Color3(0.95, 0.38, 0.08));
    material.emissiveColor = new Color3(0.72, 0.18, 0.035);
    for (const [index, position] of [[0, new Vector3(-1.25, 1.05, 8)], [1, new Vector3(this.width + 1.25, 1.05, 24)]] as const) {
      const orb = MeshBuilder.CreateSphere(`outskirts-ember-${index}`, { diameter: 0.16, segments: 6 }, this.scene);
      orb.position.copyFrom(position);
      orb.material = material;
      orb.isPickable = false;
      const light = new PointLight(`outskirts-ember-light-${index}`, position.clone(), this.scene);
      light.diffuse = new Color3(1, 0.42, 0.12);
      light.intensity = VISUAL_CONFIG.warmOutskirtsLightIntensity;
      light.range = VISUAL_CONFIG.warmOutskirtsLightRange;
    }
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
        this.box(`terrain-bank-${run}`, x, 0.13, z, boundary.horizontal ? length : 1.4, 0.32, boundary.horizontal ? 1.4 : length, this.soil);
        this.box(`terrain-snow-lip-${run}`, x, 0.30, z, boundary.horizontal ? length : 1.3, 0.10, boundary.horizontal ? 1.3 : length, this.frost);
        const pieces = Math.ceil(length / 6);
        const pieceLength = length / pieces;
        for (let index = 0; index < pieces; index += 1) {
          const offset = start + pieceLength * (index + 0.5);
          this.fittedAsset("wall", `perimeter-${run}-${index}`, boundary.horizontal ? offset : boundary.x,
            boundary.horizontal ? boundary.z : offset, pieceLength + 0.035, 1.05, 0.48,
            boundary.horizontal ? 0 : Math.PI / 2, this.stone);
        }
        run += 1;
      }
    }
    for (const [x, z] of [[-0.9, -0.9], [this.width + 0.9, -0.9], [-0.9, this.depth + 0.9], [this.width + 0.9, this.depth + 0.9]]) {
      this.fittedAsset("corner", `perimeter-corner-${x}-${z}`, x, z, 0.9, 1.45, 0.9, 0, this.stone);
      this.box(`corner-snow-${x}-${z}`, x, 1.49, z, 1, 0.12, 1, this.snow);
    }
  }

  landmark(kind: "spawn" | "exit", x: number, z: number, accent: StandardMaterial): void {
    const stone = kind === "spawn" ? this.stone : this.safeStone;
    // Gate glTF surfaces were the only registered casters directly over the spawn/goal,
    // producing oversized dark silhouettes on the single-tile markers below.
    this.fittedAsset("gate", `${kind}-hero-gate`, x, z, 4.8, 3.3, 0.8, Math.PI / 2, stone, false);
    for (const offset of [-2.65, 2.65]) {
      this.box(`${kind}-buttress-${offset}`, x, 1.55, z + offset, 1.15, 3.1, 1.05, stone);
      this.box(`${kind}-snow-cap-${offset}`, x, 3.14, z + offset, 1.27, 0.16, 1.17, this.snow);
      this.box(`${kind}-crest-${offset}`, x + (kind === "spawn" ? 0.59 : -0.59), 2.1, z + offset,
        0.04, 0.65, 0.38, accent);
    }
    // The separate multi-cell threshold slab was redundant with the entry/goal
    // tile marker and made both endpoints read as broad approach strips.
  }

  clusters(theme: EnvironmentTheme, seed: number): TransformNode[] {
    const roots: TransformNode[] = [];
    // Twelve deliberate edge/corner pockets; the gate approaches at the middle of each short edge stay open.
    const quarter = this.width / 4;
    const anchors = [
      [quarter, -3.7], [quarter * 2, -3.7], [quarter * 3, -3.7], [this.width - quarter, -3.7],
      [-3.7, this.depth * 0.25], [-3.7, this.depth * 0.75], [this.width + 3.7, this.depth * 0.25], [this.width + 3.7, this.depth * 0.75],
      [quarter, this.depth + 3.7], [quarter * 2, this.depth + 3.7], [quarter * 3, this.depth + 3.7], [this.width - quarter, this.depth + 3.7],
    ];
    const forest = [["tree", -0.72, 0], ["tree", 0.78, 0.5], ["rock", -0.1, 1.15], ["bush", 1.2, -0.95]] as const;
    const rocks = [["rock", -0.75, 0], ["rock", 0.75, 0.55], ["tree", 0.2, -1.05]] as const;
    const camp = [["fence", -0.65, 0], ["crate", 0.72, 0.42], ["rock", -0.95, 0.9], ["wall", 1.05, -0.9]] as const;
    theme.clusters.forEach((kind, index) => {
      const [cx, cz] = anchors[index % anchors.length];
      const composition = kind === "forest" ? forest : kind === "rocks" ? rocks : camp;
      composition.forEach(([category, dx, dz], part) => {
        const variation = Math.abs(seed + index * 7 + part * 11);
        const key: EnvironmentAssetKey = category === "tree" ? theme.treeAssets[variation % theme.treeAssets.length]
          : category === "rock" ? theme.rockAssets[variation % theme.rockAssets.length]
          : category === "bush" ? theme.propAssets[variation % theme.propAssets.length]
          : category === "wall" ? "wall" : category;
        const scale = category === "tree" ? VISUAL_CONFIG.outskirtsTreeScale
          : category === "rock" ? VISUAL_CONFIG.outskirtsRockScale : VISUAL_CONFIG.outskirtsSmallPropScale;
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
        roots.push(root);
      });
      const bed = MeshBuilder.CreateDisc(`cluster-ground-${index}`, { radius: VISUAL_CONFIG.outskirtsClusterBedRadius, tessellation: 12 }, this.scene);
      bed.rotation.x = Math.PI / 2; bed.position.set(cx, -0.028, cz); bed.material = this.soil;
      bed.isPickable = false; roots.push(bed);
    });
    return roots;
  }

  private fittedAsset(key: EnvironmentAssetKey, name: string, x: number, z: number, width: number,
    height: number, depth: number, rotation: number, material: StandardMaterial, castsShadows = true): void {
    const root = this.assets.instantiate(key, name, Vector3.Zero(), 0, 1, false);
    if (!root) { this.box(name, x, height / 2, z, rotation ? depth : width, height, rotation ? width : depth, material); return; }
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
    wrapper.rotation.y = rotation; wrapper.position.set(x, 0, z);
    root.getChildMeshes().forEach(mesh => {
      mesh.material = material;
      mesh.isPickable = false;
      if (castsShadows) this.shadows.addShadowCaster(mesh);
    });
  }
  private box(name: string, x: number, y: number, z: number, width: number, height: number, depth: number, material: StandardMaterial) {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
    mesh.position.set(x, y, z); mesh.material = material; mesh.isPickable = false;
    return mesh;
  }
  private material(name: string, color: Color3): StandardMaterial {
    const material = new StandardMaterial(name, this.scene); material.diffuseColor = color;
    material.specularColor = Color3.Black(); return material;
  }
}
