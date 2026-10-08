import { Color3, DynamicTexture, Matrix, Mesh, MeshBuilder, PBRMaterial, Quaternion, Scene, Texture, VertexData, Vector3 } from "@babylonjs/core";
import type { Cell } from "../../core/types";
import type { TerrainRegion } from "../config/MapConfig";
import { VISUAL_CONFIG } from "./VisualConfig";

export type TerrainOutlinePoint = { x: number; z: number };
type Point = TerrainOutlinePoint;
type Edge = { from: Point; to: Point };

// A low visual rise makes blocked cells legible without obscuring units on the field.
// The top and base contours still use the exact blocked-cell union.
export const TERRAIN_PLATEAU_HEIGHT = 0.72;
const TERRAIN_TOP = TERRAIN_PLATEAU_HEIGHT;
const TERRAIN_BASE = -0.04;
const ROCK_REPEAT_DISTANCE = 2.4;
const GRASS_EDGE_HEIGHT = 0.085;
const ROCK_BASE_BAND_HEIGHT = 0.18;
const CLIFF_BEVEL_HEIGHT = 0.11;
const CLIFF_BEVEL_INSET = 0.10;

export interface TerrainRenderStats {
  formationCount: number;
  meshCount: number;
  plateauHeight: number;
  groundTextureNames: { albedo: string; roughness: string };
  cliffTextureNames: { albedo: string; roughness: string };
}

/** Presentation only: each plateau and base face follows the exact blocked-cell outline. */
export class TerrainCliffRenderer {
  private readonly topMaterial: PBRMaterial;
  private readonly lipMaterial: PBRMaterial;
  private readonly faceMaterial: PBRMaterial;
  private readonly rubbleMaterial: PBRMaterial;
  private readonly rockAlbedo: Texture;

  constructor(
    private readonly scene: Scene,
    private readonly groundAlbedo: Texture,
    private readonly groundNormal: Texture,
    private readonly mapWidth: number,
    private readonly mapDepth: number,
    private readonly style: "castle" | "forest" = "castle",
  ) {
    this.rockAlbedo = style === "forest" ? this.createForestRockTexture() : this.createCastleStoneTexture();
    this.rockAlbedo.wrapU = this.rockAlbedo.wrapV = Texture.WRAP_ADDRESSMODE;

    const plateauStone = this.createTerrainTopTexture();
    plateauStone.name = style === "forest" ? "forest-mossy-rock-top" : "kenney-castle-plateau-stone";
    plateauStone.uScale = this.mapWidth / 4;
    plateauStone.vScale = this.mapDepth / 4;
    plateauStone.wrapU = plateauStone.wrapV = Texture.WRAP_ADDRESSMODE;
    this.topMaterial = new PBRMaterial(style === "forest" ? "forest-rock-ridge-top" : "royal-cliff-stone-top", scene);
    // Bias reflected light slightly toward the muted highland greens below.
    this.topMaterial.albedoColor = new Color3(1.08, 1.12, 1.02);
    this.topMaterial.albedoTexture = plateauStone;
    this.topMaterial.bumpTexture = this.groundNormal;
    this.topMaterial.bumpTexture.level = 0.06;
    this.topMaterial.emissiveColor = new Color3(0.045, 0.065, 0.025);
    this.topMaterial.roughness = 0.97;
    this.lipMaterial = new PBRMaterial(style === "forest" ? "forest-rock-earth-edge" : "royal-cliff-earth-edge", scene);
    // A pale cut-stone coping makes the raised lawn read as a landscaped rampart.
    this.lipMaterial.albedoColor = style === "forest" ? new Color3(0.30, 0.29, 0.20) : new Color3(0.76, 0.70, 0.58);
    this.lipMaterial.roughness = 0.97;
    this.lipMaterial.metallic = 0;
    this.faceMaterial = new PBRMaterial(style === "forest" ? "forest-natural-boulder-face" : "royal-cliff-natural-rock-face", scene);
    this.faceMaterial.albedoColor = style === "forest" ? new Color3(0.72, 0.76, 0.66) : VISUAL_CONFIG.royalCliffTint;
    this.faceMaterial.albedoTexture = this.rockAlbedo;
    this.faceMaterial.metallic = 0;
    this.faceMaterial.roughness = 0.98;
    this.faceMaterial.backFaceCulling = false;

    this.rubbleMaterial = new PBRMaterial(style === "forest" ? "forest-ridge-stones-material" : "royal-cliff-top-rubble-material", scene);
    this.rubbleMaterial.albedoColor = style === "forest" ? new Color3(0.39, 0.45, 0.34) : new Color3(0.55, 0.48, 0.39);
    this.rubbleMaterial.roughness = 0.98;
    this.rubbleMaterial.metallic = 0;
  }

  render(regions: readonly TerrainRegion[]): TerrainRenderStats {
    const cells = new Map<string, Cell>();
    for (const region of regions) for (const cell of region.cells) cells.set(`${cell.x},${cell.y}`, cell);
    const remaining = new Set(cells.keys());
    let formationCount = 0;
    let meshCount = 0;
    while (remaining.size > 0) {
      const first = remaining.values().next().value as string;
      const pending = [first];
      const component: Cell[] = [];
      remaining.delete(first);
      for (let index = 0; index < pending.length; index += 1) {
        const cell = cells.get(pending[index])!;
        component.push(cell);
        for (const [x, y] of [[cell.x - 1, cell.y], [cell.x + 1, cell.y], [cell.x, cell.y - 1], [cell.x, cell.y + 1]]) {
          const key = `${x},${y}`;
          if (remaining.delete(key)) pending.push(key);
        }
      }
      const outline = traceBoundary(component);
      if (outline.length < 3) continue;
      const meshTotal = this.renderFormation(`snow-cliff-formation-${formationCount}`, outline);
      if (meshTotal > 0) {
        formationCount += 1;
        meshCount += meshTotal;
      }
    }
    const rubbleMeshCount = this.createTopRubble([...cells.values()]) + this.createBasePebbles([...cells.values()]);
    return {
      formationCount,
      meshCount: meshCount + rubbleMeshCount,
      plateauHeight: TERRAIN_TOP,
      groundTextureNames: { albedo: this.groundAlbedo.name, roughness: "packed-pbr-roughness" },
      cliffTextureNames: { albedo: this.rockAlbedo.name, roughness: "constant-roughness" },
    };
  }

  private renderFormation(name: string, outline: Point[]): number {
    const triangles = triangulate(outline);
    if (triangles.length < 3) return 0;

    const top = new Mesh(`${name}-${this.style === "forest" ? "mossy-rock-top" : "castle-stone-top"}`, this.scene);
    const topPositions: number[] = [];
    const topUvs: number[] = [];
    for (const point of outline) {
      topPositions.push(point.x, TERRAIN_TOP, point.z);
      // Ground and plateau UVs use the same normalized world map, so the material tile
      // frequency is continuous at the exact terrain edge.
      topUvs.push(point.x / this.mapWidth, point.z / this.mapDepth);
    }
    const topData = new VertexData();
    topData.positions = topPositions;
    topData.indices = triangles;
    topData.uvs = topUvs;
    topData.normals = outline.flatMap(() => [0, 1, 0]);
    topData.applyToMesh(top, true);
    top.material = this.topMaterial;
    top.material.backFaceCulling = false;
    top.isPickable = false;
    // Avoid the shadow-map darkening the broad top planes into black slabs.
    top.receiveShadows = false;
    top.freezeWorldMatrix();

    const facePositions: number[] = [];
    const faceUvs: number[] = [];
    const faceIndices: number[] = [];
    const faceColors: number[] = [];
    const lipPositions: number[] = [];
    const lipUvs: number[] = [];
    const lipIndices: number[] = [];
    const normalSign = signedArea(outline) >= 0 ? 1 : -1;
    let perimeterDistance = 0;
    for (let index = 0; index < outline.length; index += 1) {
      const current = outline[index];
      const following = outline[(index + 1) % outline.length];
      const edgeLength = Math.hypot(following.x - current.x, following.z - current.z);
      const bandY = Math.min(TERRAIN_TOP - GRASS_EDGE_HEIGHT - 0.02, TERRAIN_BASE + ROCK_BASE_BAND_HEIGHT);
      const shade = 0.93 + ((index * 37) % 9) / 100;
      const inwardX = -((following.z - current.z) / edgeLength) * normalSign * CLIFF_BEVEL_INSET;
      const inwardZ = ((following.x - current.x) / edgeLength) * normalSign * CLIFF_BEVEL_INSET;
      const insetCurrent = [current.x + inwardX, current.z + inwardZ];
      const insetFollowing = [following.x + inwardX, following.z + inwardZ];
      const bevelY = TERRAIN_TOP - CLIFF_BEVEL_HEIGHT;
      const midShade = shade * 0.90;
      addQuadWithUvs(facePositions, faceUvs, faceIndices,
        [insetCurrent[0], bevelY, insetCurrent[1]], [insetFollowing[0], bevelY, insetFollowing[1]],
        [insetFollowing[0], bandY, insetFollowing[1]], [insetCurrent[0], bandY, insetCurrent[1]],
        [perimeterDistance / ROCK_REPEAT_DISTANCE, 0.82, (perimeterDistance + edgeLength) / ROCK_REPEAT_DISTANCE, 0.82,
          (perimeterDistance + edgeLength) / ROCK_REPEAT_DISTANCE, 0.24, perimeterDistance / ROCK_REPEAT_DISTANCE, 0.24]);
      faceColors.push(midShade, midShade * 0.99, midShade * 0.96, 1, midShade, midShade * 0.99, midShade * 0.96, 1,
        midShade, midShade * 0.99, midShade * 0.96, 1, midShade, midShade * 0.99, midShade * 0.96, 1);
      const toeShade = shade * 0.82;
      addQuadWithUvs(facePositions, faceUvs, faceIndices,
        [insetCurrent[0], bandY, insetCurrent[1]], [insetFollowing[0], bandY, insetFollowing[1]],
        [following.x, TERRAIN_BASE, following.z], [current.x, TERRAIN_BASE, current.z],
        [perimeterDistance / ROCK_REPEAT_DISTANCE, 0.24, (perimeterDistance + edgeLength) / ROCK_REPEAT_DISTANCE, 0.24,
          (perimeterDistance + edgeLength) / ROCK_REPEAT_DISTANCE, 0, perimeterDistance / ROCK_REPEAT_DISTANCE, 0]);
      faceColors.push(toeShade, toeShade * 0.99, toeShade * 0.95, 1, toeShade, toeShade * 0.99, toeShade * 0.95, 1,
        toeShade, toeShade * 0.99, toeShade * 0.95, 1, toeShade, toeShade * 0.99, toeShade * 0.95, 1);
      // A thin light line follows the bevel without protruding into the buildable field.
      addQuadWithUvs(lipPositions, lipUvs, lipIndices,
        [current.x, TERRAIN_TOP, current.z], [following.x, TERRAIN_TOP, following.z],
        [insetFollowing[0], bevelY, insetFollowing[1]], [insetCurrent[0], bevelY, insetCurrent[1]],
        [perimeterDistance / ROCK_REPEAT_DISTANCE, 1, (perimeterDistance + edgeLength) / ROCK_REPEAT_DISTANCE, 1,
          (perimeterDistance + edgeLength) / ROCK_REPEAT_DISTANCE, 0.82, perimeterDistance / ROCK_REPEAT_DISTANCE, 0.82]);
      perimeterDistance += edgeLength;
    }
    this.createMesh(`${name}-rock-side`, facePositions, faceUvs, faceIndices, this.faceMaterial, faceColors);
    this.createMesh(`${name}-earth-lip`, lipPositions, lipUvs, lipIndices, this.lipMaterial);
    return 3;
  }

  /** Sparse low-profile rubble sits only within blocked terrain cells; it uses one instanced mesh. */
  private createTopRubble(cells: readonly Cell[]): number {
    if (cells.length === 0) return 0;
    const occupied = new Set(cells.map(({ x, y }) => `${x},${y}`));
    const matrices: number[] = [];
    for (const cell of cells) {
      const key = `${cell.x},${cell.y}`;
      const boundary = [[cell.x - 1, cell.y], [cell.x + 1, cell.y], [cell.x, cell.y - 1], [cell.x, cell.y + 1]]
        .some(([x, y]) => !occupied.has(`${x},${y}`));
      if (!boundary || Math.abs((cell.x * 47 + cell.y * 83 + 29) % 100) > 49) continue;
      const hash = Math.abs(cell.x * 7919 + cell.y * 1049 + 101);
      const x = cell.x + 0.5 + ((hash % 13) / 100 - 0.06);
      const z = cell.y + 0.5 + (((hash >> 3) % 13) / 100 - 0.06);
      const scale = new Vector3(0.095 + (hash % 7) * 0.009, 0.04 + (hash % 5) * 0.006, 0.09 + (hash % 11) * 0.009);
      const position = new Vector3(x, TERRAIN_TOP + 0.035 + 100, z);
      Matrix.Compose(scale, Quaternion.RotationYawPitchRoll(hash % 6, 0, 0), position).copyToArray(matrices, matrices.length);
    }
    if (matrices.length === 0) return 0;
    const rubble = MeshBuilder.CreateIcoSphere("terrain-top-rubble", { radius: 1, subdivisions: 1 }, this.scene);
    rubble.position.y = -100;
    rubble.material = this.rubbleMaterial;
    rubble.isPickable = false;
    rubble.receiveShadows = false;
    rubble.thinInstanceSetBuffer("matrix", new Float32Array(matrices), 16, true);
    rubble.computeWorldMatrix(true);
    rubble.freezeWorldMatrix();
    return 1;
  }

  /** Pebbles share one thin-instanced mesh and stay entirely within terrain cells. */
  private createBasePebbles(cells: readonly Cell[]): number {
    const occupied = new Set(cells.map(({ x, y }) => `${x},${y}`));
    const matrices: number[] = [];
    for (const cell of cells) {
      const boundary = [[cell.x - 1, cell.y], [cell.x + 1, cell.y], [cell.x, cell.y - 1], [cell.x, cell.y + 1]]
        .some(([x, y]) => !occupied.has(`${x},${y}`));
      const hash = Math.abs(cell.x * 1013 + cell.y * 7919 + 211);
      if (!boundary || hash % 3 !== 0) continue;
      const x = cell.x + 0.5 + ((hash % 17) / 100 - 0.08);
      const z = cell.y + 0.5 + (((hash >> 4) % 17) / 100 - 0.08);
      const scale = new Vector3(0.07 + (hash % 7) * 0.011, 0.022 + (hash % 5) * 0.005, 0.065 + (hash % 11) * 0.008);
      const position = new Vector3(x, TERRAIN_BASE + 0.04 + 100, z);
      Matrix.Compose(scale, Quaternion.RotationYawPitchRoll((hash % 8) * Math.PI / 4, 0, 0), position).copyToArray(matrices, matrices.length);
    }
    if (matrices.length === 0) return 0;
    const pebbles = MeshBuilder.CreateIcoSphere("cliff-base-pebbles", { radius: 1, subdivisions: 1 }, this.scene);
    pebbles.position.y = -100;
    pebbles.material = this.rubbleMaterial;
    pebbles.isPickable = false;
    pebbles.receiveShadows = false;
    pebbles.thinInstanceSetBuffer("matrix", new Float32Array(matrices), 16, true);
    pebbles.computeWorldMatrix(true);
    pebbles.freezeWorldMatrix();
    return 1;
  }

  private createMesh(name: string, positions: number[], uvs: number[], indices: number[], material: PBRMaterial, colors?: number[]): void {
    if (positions.length === 0) return;
    const mesh = new Mesh(name, this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.uvs = uvs;
    data.colors = colors ?? null;
    data.normals = [];
    VertexData.ComputeNormals(positions, indices, data.normals);
    data.applyToMesh(mesh, true);
    mesh.useVertexColors = colors !== undefined;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.freezeWorldMatrix();
  }

  /** Repeating ashlar blocks turn the exact blocked-cell outline into a retaining wall. */
  private createCastleStoneTexture(): DynamicTexture {
    const texture = new DynamicTexture("kenney-castle-cliff-stone", { width: 256, height: 256 }, this.scene, true);
    const ctx = texture.getContext();
    ctx.fillStyle = "#716b61";
    ctx.fillRect(0, 0, 256, 256);
    const palette = ["#a8a393", "#b1ac9b", "#9c988a", "#b8b19f", "#a29e90", "#ada999"];
    const blockWidth = 64, courseHeight = 64;
    for (let course = 0; course < 4; course += 1) {
      const offset = course % 2 === 0 ? 0 : -blockWidth / 2;
      for (let column = -1; column < 5; column += 1) {
        const x = offset + column * blockWidth + 2;
        const y = course * courseHeight + 2;
        const width = blockWidth - 4;
        const height = courseHeight - 4;
        const colorIndex = (course * 3 + column * 5 + 24) % palette.length;
        ctx.fillStyle = palette[colorIndex];
        ctx.fillRect(x, y, width, height);
        ctx.strokeStyle = "rgba(61,59,54,0.36)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.75, y + 0.75, width - 1.5, height - 1.5);
        ctx.strokeStyle = "rgba(244,237,217,0.16)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 4, y + 3);
        ctx.lineTo(x + width - 4, y + 3);
        ctx.stroke();
      }
    }
    texture.update(false);
    return texture;
  }

  private createForestRockTexture(): DynamicTexture {
    const texture = new DynamicTexture("forest-natural-rock", { width: 256, height: 256 }, this.scene, true);
    const ctx = texture.getContext();
    ctx.fillStyle = "#696f63";
    ctx.fillRect(0, 0, 256, 256);
    let seed = 0x71f03;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let index = 0; index < 54; index += 1) {
      const x = random() * 256, y = random() * 256;
      const radius = 8 + random() * 34;
      const gradient = ctx.createRadialGradient(x, y, 1, x, y, radius);
      gradient.addColorStop(0, index % 3 === 0 ? "rgba(91,126,66,0.30)" : "rgba(190,190,169,0.18)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    for (let index = 0; index < 110; index += 1) {
      const x = random() * 256, y = random() * 256;
      ctx.strokeStyle = index % 2 ? "rgba(48,52,45,0.16)" : "rgba(209,213,188,0.10)";
      ctx.lineWidth = 0.6 + random() * 1.2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + random() * 18 - 9, y + random() * 10 - 5); ctx.stroke();
    }
    texture.update(false);
    return texture;
  }

  private createTerrainTopTexture(): DynamicTexture {
    const texture = new DynamicTexture("castle-terrain-top-earth-stone", { width: 512, height: 512 }, this.scene, true);
    const ctx = texture.getContext();
    // The base tone establishes green as the dominant top-surface color;
    // restrained earth and exposed-stone patches provide the remaining variation.
    ctx.fillStyle = "#a8cc78";
    ctx.fillRect(0, 0, 512, 512);
    const patches = [
      "rgba(82,145,58,0.11)",
      "rgba(188,213,132,0.15)",
      "rgba(72,125,48,0.06)",
      "rgba(221,224,166,0.10)",
    ];
    for (let i = 0; i < 30; i += 1) {
      const x = (i * 173 + 41) % 512, y = (i * 257 + 89) % 512;
      const radius = 22 + ((i * 37) % 58);
      const gradient = ctx.createRadialGradient(x, y, radius * 0.04, x, y, radius);
      gradient.addColorStop(0, patches[i % patches.length]);
      gradient.addColorStop(0.68, patches[i % patches.length].replace(/0\.\d+\)/, "0.035)"));
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    // Muted moss and grass islands make blocked plateaus feel alive without
    // changing their outline. Wrapped copies keep this shared texture seamless.
    let seed = 0x5a17;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const mossPalette = [
      "rgba(119,166,74,0.16)",
      "rgba(151,190,91,0.16)",
      "rgba(181,204,112,0.14)",
      "rgba(93,147,57,0.14)",
    ];
    for (let i = 0; i < 42; i += 1) {
      const x = random() * 512;
      const y = random() * 512;
      const radius = 13 + random() * 23;
      const color = mossPalette[i % mossPalette.length];
      for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) {
        const px = x + ox, py = y + oy;
        if (px < -radius || px > 512 + radius || py < -radius || py > 512 + radius) continue;
        const gradient = ctx.createRadialGradient(px, py, radius * 0.06, px, py, radius);
        gradient.addColorStop(0, color);
        gradient.addColorStop(0.62, color.replace(/0\.\d+\)/, "0.10)"));
        gradient.addColorStop(1, "rgba(82,123,49,0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
      }
    }

    // Short, low-contrast brush strokes suggest sparse grass blades at close zoom.
    for (let i = 0; i < 430; i += 1) {
      const x = random() * 512;
      const y = random() * 512;
      const length = 2 + random() * 4;
      ctx.strokeStyle = i % 4 === 0 ? "rgba(72,125,43,0.13)" : "rgba(184,207,119,0.18)";
      ctx.lineWidth = 0.7 + random() * 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (random() - 0.5) * 2.2, y - length);
      ctx.stroke();
    }

    for (let i = 0; i < 1050; i += 1) {
      const x = (i * 73 + 17) % 512, y = (i * 151 + 43) % 512;
      ctx.fillStyle = i % 3 === 0 ? "rgba(239,239,196,0.11)" : "rgba(55,91,42,0.018)";
      ctx.fillRect(x, y, 1 + i % 2, 1);
    }
    texture.update(false);
    return texture;
  }
}

/** Trace the exact union of grid squares into one simple perimeter per formation. */
export function traceBoundary(cells: readonly Cell[]): Point[] {
  const occupied = new Set(cells.map(({ x, y }) => `${x},${y}`));
  const edges: Edge[] = [];
  for (const { x, y } of cells) {
    if (!occupied.has(`${x},${y - 1}`)) edges.push({ from: { x, z: y }, to: { x: x + 1, z: y } });
    if (!occupied.has(`${x + 1},${y}`)) edges.push({ from: { x: x + 1, z: y }, to: { x: x + 1, z: y + 1 } });
    if (!occupied.has(`${x},${y + 1}`)) edges.push({ from: { x: x + 1, z: y + 1 }, to: { x, z: y + 1 } });
    if (!occupied.has(`${x - 1},${y}`)) edges.push({ from: { x, z: y + 1 }, to: { x, z: y } });
  }

  const byStart = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const key = pointKey(edge.from);
    byStart.set(key, [...(byStart.get(key) ?? []), index]);
  });
  const first = edges[0];
  const outline = [first.from];
  const used = new Set<number>();
  let edgeIndex = 0;
  while (!used.has(edgeIndex)) {
    const edge = edges[edgeIndex];
    used.add(edgeIndex);
    outline.push(edge.to);
    if (samePoint(edge.to, first.from)) break;
    const candidates = (byStart.get(pointKey(edge.to)) ?? []).filter((candidate) => !used.has(candidate));
    if (candidates.length === 0) break;
    edgeIndex = candidates.reduce((best, candidate) => {
      const bestTurn = turnRank(edge, edges[best]);
      const candidateTurn = turnRank(edge, edges[candidate]);
      return candidateTurn < bestTurn ? candidate : best;
    }, candidates[0]);
  }

  if (outline.length > 1 && samePoint(outline[0], outline[outline.length - 1])) outline.pop();
  return simplifyCollinear(outline);
}

/** Ear clipping for the simple, hole-free contours generated by the cell-union tracer. */
export function triangulate(points: readonly Point[]): number[] {
  const order = points.map((_, index) => index);
  if (signedArea(points) < 0) order.reverse();
  const indices: number[] = [];
  let guard = points.length * points.length;
  while (order.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let position = 0; position < order.length; position += 1) {
      const previous = order[(position + order.length - 1) % order.length];
      const current = order[position];
      const next = order[(position + 1) % order.length];
      if (cross(points[previous], points[current], points[next]) <= 1e-7) continue;
      if (order.some((candidate) => candidate !== previous && candidate !== current && candidate !== next
        && pointInTriangle(points[candidate], points[previous], points[current], points[next]))) continue;
      // World Y is the vertical axis, so reverse the X/Z winding for an upward normal.
      indices.push(previous, next, current);
      order.splice(position, 1);
      clipped = true;
      break;
    }
    if (!clipped) return [];
  }
  if (order.length === 3) indices.push(order[0], order[1], order[2]);
  return indices;
}

function addQuadWithUvs(positions: number[], uvs: number[], indices: number[], a: number[], b: number[], c: number[], d: number[], quadUvs: number[]): void {
  const offset = positions.length / 3;
  positions.push(...a, ...b, ...c, ...d);
  uvs.push(...quadUvs);
  indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
}

function signedArea(points: readonly Point[]): number {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.z - next.x * point.z;
  }, 0) / 2;
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function pointInTriangle(point: Point, a: Point, b: Point, c: Point): boolean {
  const ab = cross(a, b, point), bc = cross(b, c, point), ca = cross(c, a, point);
  return ab >= -1e-7 && bc >= -1e-7 && ca >= -1e-7;
}

function simplifyCollinear(points: Point[]): Point[] {
  return points.filter((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    const next = points[(index + 1) % points.length];
    return Math.abs(cross(previous, point, next)) > 1e-7;
  });
}

function turnRank(incoming: Edge, outgoing: Edge): number {
  const inX = incoming.to.x - incoming.from.x, inZ = incoming.to.z - incoming.from.z;
  const outX = outgoing.to.x - outgoing.from.x, outZ = outgoing.to.z - outgoing.from.z;
  const crossValue = inX * outZ - inZ * outX;
  const dotValue = inX * outX + inZ * outZ;
  if (crossValue < 0) return 0; // keep the same outside boundary when diagonal cells touch
  if (dotValue > 0) return 1;
  if (crossValue > 0) return 2;
  return 3;
}

function pointKey(point: Point): string { return `${point.x},${point.z}`; }
function samePoint(a: Point, b: Point): boolean { return a.x === b.x && a.z === b.z; }
