import { Color3, DynamicTexture, Mesh, PBRMaterial, Scene, Texture, Vector3, VertexData } from "@babylonjs/core";
import { resolveAssetUrl } from "../../core/AssetUrl";
import type { Cell } from "../../core/types";
import type { TerrainRegion } from "../config/MapConfig";

export type TerrainOutlinePoint = { x: number; z: number };
type Point = TerrainOutlinePoint;
type Edge = { from: Point; to: Point };

const TERRAIN_TOP = 0.50;
const SNOW_LIP_Y = 0.40;
const TERRAIN_FOOT = 0.02;
const SNOW_LIP_WIDTH = 0.12;
const ROCK_FOOT_WIDTH = 0.035;

/**
 * Presentation-only terrain. Exact grid cells still define blocking/build rules;
 * the visible perimeter is simplified and softly chamfered to hide cell-by-cell steps.
 */
export class TerrainCliffRenderer {
  private readonly topMaterial: PBRMaterial;
  private readonly lipMaterial: PBRMaterial;
  private readonly faceMaterial: PBRMaterial;
  private readonly snowTexture: DynamicTexture;
  private readonly rockAlbedo: Texture;
  private readonly rockNormal: Texture;
  private readonly rockOrm: Texture;

  constructor(private readonly scene: Scene) {
    this.snowTexture = this.createSnowTexture();
    this.rockAlbedo = new Texture(resolveAssetUrl("assets/environment/medieval/T_RockTrim_BaseColor.png"), scene, true, false);
    this.rockNormal = new Texture(resolveAssetUrl("assets/environment/medieval/T_RockTrim_Normal.png"), scene, true, false);
    this.rockOrm = new Texture(resolveAssetUrl("assets/environment/medieval/T_RockTrim_ORM.png"), scene, true, false);
    for (const texture of [this.rockAlbedo, this.rockNormal, this.rockOrm]) {
      texture.uScale = 2.2;
      texture.vScale = 2.2;
      texture.wrapU = Texture.WRAP_ADDRESSMODE;
      texture.wrapV = Texture.WRAP_ADDRESSMODE;
    }

    this.topMaterial = this.snowMaterial("snow-cliff-plateau-top", new Color3(0.94, 0.975, 0.99));
    this.lipMaterial = this.snowMaterial("snow-cliff-beveled-lip", new Color3(0.82, 0.91, 0.95));
    this.faceMaterial = new PBRMaterial("snow-cliff-rock-face-material", scene);
    this.faceMaterial.albedoColor = new Color3(0.78, 0.83, 0.88);
    this.faceMaterial.emissiveColor = new Color3(0.055, 0.075, 0.095);
    this.faceMaterial.albedoTexture = this.rockAlbedo;
    this.faceMaterial.bumpTexture = this.rockNormal;
    this.faceMaterial.metallicTexture = this.rockOrm;
    this.faceMaterial.useRoughnessFromMetallicTextureGreen = true;
    this.faceMaterial.useMetallnessFromMetallicTextureBlue = true;
    this.faceMaterial.metallic = 0;
    this.faceMaterial.roughness = 0.9;
    this.faceMaterial.backFaceCulling = false;
  }

  render(regions: readonly TerrainRegion[]): void {
    const cells = new Map<string, Cell>();
    for (const region of regions) for (const cell of region.cells) cells.set(`${cell.x},${cell.y}`, cell);
    const remaining = new Set(cells.keys());
    let formation = 0;
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
      const outline = smoothOutline(traceBoundary(component));
      if (outline.length < 3) continue;
      this.renderFormation(`snow-cliff-formation-${formation++}`, outline);
    }
  }

  private renderFormation(name: string, outline: Point[]): void {
    const triangles = triangulate(outline);
    if (triangles.length < 3) return;

    const top = new Mesh(`${name}-snow-top`, this.scene);
    const topPositions: number[] = [];
    const topUvs: number[] = [];
    for (const point of outline) {
      topPositions.push(point.x, TERRAIN_TOP, point.z);
      topUvs.push(point.x / 5, point.z / 5);
    }
    const topData = new VertexData();
    topData.positions = topPositions;
    topData.indices = triangles;
    topData.uvs = topUvs;
    // Plateau tops are horizontal by design; explicit up normals also avoid winding quirks
    // from the X/Z map plane in different Babylon WebGL backends.
    topData.normals = outline.flatMap(() => [0, 1, 0]);
    topData.applyToMesh(top, true);
    top.material = this.topMaterial;
    top.material.backFaceCulling = false;
    top.isPickable = false;
    top.receiveShadows = true;
    top.freezeWorldMatrix();

    const normals = outlineNormals(outline);
    const lipPositions: number[] = [];
    const lipIndices: number[] = [];
    const facePositions: number[] = [];
    const faceIndices: number[] = [];
    for (let index = 0; index < outline.length; index += 1) {
      const next = (index + 1) % outline.length;
      const current = outline[index];
      const following = outline[next];
      const normal = normals[index];
      const nextNormal = normals[next];
      const lipA = offset(current, normal, SNOW_LIP_WIDTH);
      const lipB = offset(following, nextNormal, SNOW_LIP_WIDTH);
      addQuad(lipPositions, lipIndices,
        [current.x, TERRAIN_TOP, current.z], [following.x, TERRAIN_TOP, following.z],
        [lipB.x, SNOW_LIP_Y, lipB.z], [lipA.x, SNOW_LIP_Y, lipA.z]);

      const footA = offset(lipA, normal, ROCK_FOOT_WIDTH);
      const footB = offset(lipB, nextNormal, ROCK_FOOT_WIDTH);
      addQuad(facePositions, faceIndices,
        [lipA.x, SNOW_LIP_Y, lipA.z], [lipB.x, SNOW_LIP_Y, lipB.z],
        [footB.x, TERRAIN_FOOT, footB.z], [footA.x, TERRAIN_FOOT, footA.z]);
    }
    this.createMesh(`${name}-beveled-snow-lip`, lipPositions, lipIndices, this.lipMaterial);
    this.createMesh(`${name}-rock-side`, facePositions, faceIndices, this.faceMaterial);
  }

  private createMesh(name: string, positions: number[], indices: number[], material: PBRMaterial): void {
    if (positions.length === 0) return;
    const mesh = new Mesh(name, this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.uvs = positions.flatMap((value, index) => index % 3 === 1 ? [] : [value * 0.4]);
    data.normals = [];
    VertexData.ComputeNormals(positions, indices, data.normals);
    data.applyToMesh(mesh, true);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.freezeWorldMatrix();
  }

  private snowMaterial(name: string, albedo: Color3): PBRMaterial {
    const material = new PBRMaterial(name, this.scene);
    material.albedoColor = albedo;
    material.albedoTexture = this.snowTexture;
    material.roughness = 0.96;
    material.metallic = 0;
    return material;
  }

  private createSnowTexture(): DynamicTexture {
    const size = 256;
    const texture = new DynamicTexture("snow-cliff-subtle-albedo", { width: size, height: size }, this.scene, true);
    const context = texture.getContext();
    context.fillStyle = "#e8f0f3";
    context.fillRect(0, 0, size, size);
    for (let i = 0; i < 24; i += 1) {
      const x = (i * 73 + 19) % size;
      const y = (i * 109 + 37) % size;
      const radius = 22 + (i % 4) * 8;
      const shade = i % 3 === 0 ? "rgba(255,255,255,0.25)" : "rgba(124,162,180,0.11)";
      const gradient = context.createRadialGradient(x, y, 1, x, y, radius);
      gradient.addColorStop(0, shade);
      gradient.addColorStop(1, "rgba(220,235,241,0)");
      context.fillStyle = gradient;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    // Fine, low-contrast grain breaks up the flat color without obscuring the grid.
    for (let i = 0; i < 650; i += 1) {
      const x = (i * 97 + 13) % size;
      const y = (i * 149 + 41) % size;
      context.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.12)" : "rgba(76,112,132,0.045)";
      context.fillRect(x, y, 1, 1);
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

export function smoothOutline(points: Point[]): Point[] {
  // One restrained pass chamfers the silhouette while keeping the visual shift under 0.2 tile.
  let smooth = points;
  for (let pass = 0; pass < 1 && smooth.length >= 4; pass += 1) {
    const next: Point[] = [];
    for (let index = 0; index < smooth.length; index += 1) {
      const a = smooth[index];
      const b = smooth[(index + 1) % smooth.length];
      next.push({ x: a.x * 0.84 + b.x * 0.16, z: a.z * 0.84 + b.z * 0.16 });
      next.push({ x: a.x * 0.16 + b.x * 0.84, z: a.z * 0.16 + b.z * 0.84 });
    }
    smooth = next;
  }
  return smooth;
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

function outlineNormals(points: readonly Point[]): Point[] {
  const winding = Math.sign(signedArea(points)) || 1;
  return points.map((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    const next = points[(index + 1) % points.length];
    const before = edgeOutward(previous, point, winding);
    const after = edgeOutward(point, next, winding);
    const length = Math.hypot(before.x + after.x, before.z + after.z) || 1;
    return { x: (before.x + after.x) / length, z: (before.z + after.z) / length };
  });
}

function edgeOutward(a: Point, b: Point, winding: number): Point {
  const dx = b.x - a.x, dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: winding * dz / length, z: -winding * dx / length };
}

function addQuad(positions: number[], indices: number[], a: number[], b: number[], c: number[], d: number[]): void {
  const offset = positions.length / 3;
  positions.push(...a, ...b, ...c, ...d);
  indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
}

function offset(point: Point, direction: Point, distance: number): Point {
  return { x: point.x + direction.x * distance, z: point.z + direction.z * distance };
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
