import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const MANIFEST_PATH = path.join("scripts", "runtime-asset-manifest.json");

export function isInside(parent, target) {
  const relative = path.relative(parent, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function toPosix(value) { return value.split(path.sep).join("/"); }

export async function listFiles(directory) {
  const entries = await (await import("node:fs/promises")).readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const itemPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(itemPath) : [itemPath];
  }));
  return nested.flat();
}

function parseGlbJson(buffer) {
  if (buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "glTF") return undefined;
  if (buffer.readUInt32LE(4) !== 2) return undefined;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > buffer.length) throw new Error("Invalid GLB chunk bounds");
    if (chunkType === 0x4e4f534a) return JSON.parse(buffer.toString("utf8", chunkStart, chunkEnd).trim());
    offset = chunkEnd;
  }
  return undefined;
}

export async function loadManifest(projectRoot) {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, MANIFEST_PATH), "utf8"));
  const roots = Object.entries(manifest.groups).flatMap(([group, files]) => files.map((file) => ({ group, file })));
  const rootSet = new Set(roots.map(({ file }) => file));
  if (rootSet.size !== roots.length) throw new Error("runtime-asset-manifest.json lists a production asset more than once");

  const keep = new Map();
  const pending = roots.map(({ group, file }) => visit(file, group));
  async function visit(assetPath, group, referencedBy = "manifest") {
    const normalized = path.posix.normalize(assetPath.replaceAll("\\", "/"));
    if (!normalized.startsWith("assets/") || normalized.startsWith("../") || normalized.includes("/../")) {
      throw new Error(`Asset path escapes public/assets/: ${assetPath}`);
    }
    if (!keep.has(normalized)) keep.set(normalized, { groups: new Set(), referencedBy: new Set() });
    const details = keep.get(normalized);
    details.groups.add(group);
    details.referencedBy.add(referencedBy);
    if (details.visited) return;
    details.visited = true;

    const absolute = path.resolve(projectRoot, "public", normalized);
    if (!isInside(path.resolve(projectRoot, "public", "assets"), absolute)) throw new Error(`Asset path escapes public/assets/: ${assetPath}`);
    try { await stat(absolute); } catch { throw new Error(`Manifest asset is missing: public/${normalized}`); }
    const ext = path.extname(normalized).toLowerCase();
    if (ext !== ".gltf" && ext !== ".glb") return;
    const bytes = await readFile(absolute);
    const gltf = ext === ".glb" ? parseGlbJson(bytes) : JSON.parse(bytes.toString("utf8"));
    if (!gltf) return;
    for (const dependency of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
      const uri = dependency.uri;
      if (!uri || uri.startsWith("data:") || /^[a-z]+:/i.test(uri) || uri.startsWith("/")) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(normalized), decodeURIComponent(uri.split("?")[0])));
      await visit(resolved, group, normalized);
    }
  }
  await Promise.all(pending);
  return { manifest, roots, keep };
}

export async function readSourceForAudit(projectRoot) {
  const srcRoot = path.join(projectRoot, "src");
  const sourceFiles = (await listFiles(srcRoot)).filter((file) => /\.(ts|tsx|js|jsx|css|html)$/.test(file));
  const entries = await Promise.all(sourceFiles.map(async (absolute) => ({
    absolute,
    relative: toPosix(path.relative(projectRoot, absolute)),
    text: (await readFile(absolute, "utf8")).replaceAll("\\", "/"),
  })));
  return entries;
}

export function validateSourceManifest({ manifest, roots }, sources) {
  const production = new Set(roots.map(({ file }) => file.toLowerCase()));
  const development = new Set(manifest.developmentOnly.map((file) => file.toLowerCase()));
  const configFiles = [
    "src/game/rendering3d/DefenderVisualConfig.ts",
    "src/game/rendering3d/EnemyVisualConfig.ts",
  ];
  const problems = [];
  for (const relative of configFiles) {
    const source = sources.find((entry) => entry.relative === relative)?.text;
    if (!source) { problems.push(`Could not inspect ${relative}`); continue; }
    const regex = /(?:assetPath|fallbackAssetPath):\s*"(\/assets\/[^\"]+)"/g;
    for (const match of source.matchAll(regex)) {
      const asset = match[1].replace(/^\//, "").toLowerCase();
      const field = match[0].startsWith("assetPath:") ? "primary" : "fallback";
      const declared = field === "primary" ? production.has(asset) : development.has(asset);
      if (!declared) problems.push(`${relative} ${field} asset is missing from the matching manifest set: ${asset}`);
    }
  }

  if (!production.has("assets/models/quaternius/runtime/female_ranger.gltf")) {
    problems.push("Optimized Quaternius Ranger fallback is missing from the production manifest.");
  }
  const uiSource = sources.find((entry) => entry.relative === "src/main.ts")?.text;
  if (!uiSource) problems.push("Could not inspect main.ts for UI image paths");
  else {
    const uiRegex = /assets\/ui\/defenders\/([a-z0-9-]+\.png)/gi;
    for (const match of uiSource.matchAll(uiRegex)) {
      const asset = `assets/ui/defenders/${match[1]}`.toLowerCase();
      if (!production.has(asset)) problems.push(`main.ts UI portrait is missing from production manifest: ${asset}`);
    }
  }

  const environmentSource = sources.find((entry) => entry.relative === "src/game/rendering3d/EnvironmentAssetLibrary.ts")?.text;
  if (!environmentSource) problems.push("Could not inspect EnvironmentAssetLibrary.ts");
  else {
    const regex = /rootUrl:\s*"(\/assets\/[^\"]+)"\s*,\s*fileName:\s*"([^\"]+)"/g;
    for (const match of environmentSource.matchAll(regex)) {
      const asset = `${match[1].replace(/^\//, "")}${match[2]}`.toLowerCase();
      if (!production.has(asset)) problems.push(`EnvironmentAssetLibrary asset is missing from production manifest: ${asset}`);
    }
  }
  return problems;
}
