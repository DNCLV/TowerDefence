import { createHash } from "node:crypto";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listFiles, loadManifest, readSourceForAudit, toPosix } from "./asset-manifest-utils.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicAssetsRoot = path.join(projectRoot, "public", "assets");
const distRoot = path.join(projectRoot, "dist");
const readU32 = (b, o) => b.readUInt32BE(o);

function pngInfo(bytes) {
  if (bytes.length < 26 || bytes.toString("ascii", 1, 4) !== "PNG") return undefined;
  const colorType = bytes[25];
  return { width: readU32(bytes, 16), height: readU32(bytes, 20), alpha: colorType === 4 || colorType === 6, colorType };
}

function jpegInfo(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = bytes.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5), alpha: false };
    }
    offset += 2 + length;
  }
  return undefined;
}

function webpInfo(bytes) {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return undefined;
  const kind = bytes.toString("ascii", 12, 16);
  if (kind === "VP8X" && bytes.length >= 30) {
    return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3), alpha: Boolean(bytes[20] & 0x10) };
  }
  return undefined;
}

function parseGlb(bytes) {
  if (bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(4) !== 2) return undefined;
  let gltf;
  let binaryChunk;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + length > bytes.length) break;
    if (type === 0x4e4f534a) gltf = JSON.parse(bytes.toString("utf8", offset + 8, offset + 8 + length).trim());
    if (type === 0x004e4942) binaryChunk = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length;
  }
  if (!gltf) return undefined;
  let triangles = 0;
  let vertices = 0;
  for (const mesh of gltf.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
    const mode = primitive.mode ?? 4;
    if (mode !== 4) continue;
    const indexCount = primitive.indices === undefined ? undefined : gltf.accessors?.[primitive.indices]?.count;
    const positionCount = gltf.accessors?.[primitive.attributes?.POSITION]?.count ?? 0;
    vertices += positionCount;
    triangles += Math.floor((indexCount ?? positionCount) / 3);
  }
  let embeddedTextureBytes = 0;
  const embeddedImages = [];
  for (const image of gltf.images ?? []) {
    if (image.bufferView !== undefined) {
      const view = gltf.bufferViews?.[image.bufferView];
      const imageBytes = view && binaryChunk
        ? binaryChunk.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
        : undefined;
      embeddedTextureBytes += view?.byteLength ?? 0;
      const dimensionInfo = imageBytes && (pngInfo(imageBytes) ?? jpegInfo(imageBytes) ?? webpInfo(imageBytes));
      embeddedImages.push({ name: image.name ?? "(unnamed)", format: image.mimeType ?? "unknown", bytes: view?.byteLength ?? 0, ...dimensionInfo });
    } else if (image.uri?.startsWith("data:")) {
      embeddedTextureBytes += Math.floor((image.uri.split(",")[1]?.length ?? 0) * 0.75);
    }
  }
  return {
    meshes: gltf.meshes?.length ?? 0,
    materials: gltf.materials?.length ?? 0,
    vertices,
    triangles,
    skins: gltf.skins?.length ?? 0,
    joints: (gltf.skins ?? []).reduce((sum, skin) => sum + (skin.joints?.length ?? 0), 0),
    animations: (gltf.animations ?? []).map((animation) => animation.name ?? "(unnamed)"),
    images: (gltf.images ?? []).length,
    embeddedTextureBytes,
    embeddedImages,
    extensions: gltf.extensionsUsed ?? [],
  };
}

function parseGltfMetadata(gltf) {
  let triangles = 0;
  let vertices = 0;
  for (const mesh of gltf.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
    if ((primitive.mode ?? 4) !== 4) continue;
    const indexCount = primitive.indices === undefined ? undefined : gltf.accessors?.[primitive.indices]?.count;
    const positionCount = gltf.accessors?.[primitive.attributes?.POSITION]?.count ?? 0;
    vertices += positionCount;
    triangles += Math.floor((indexCount ?? positionCount) / 3);
  }
  return {
    meshes: gltf.meshes?.length ?? 0,
    materials: gltf.materials?.length ?? 0,
    vertices,
    triangles,
    skins: gltf.skins?.length ?? 0,
    joints: (gltf.skins ?? []).reduce((sum, skin) => sum + (skin.joints?.length ?? 0), 0),
    animations: (gltf.animations ?? []).map((animation) => animation.name ?? "(unnamed)"),
    images: (gltf.images ?? []).length,
    embeddedTextureBytes: 0,
    embeddedImages: [],
    extensions: gltf.extensionsUsed ?? [],
  };
}

function sizeMiB(bytes) { return Number((bytes / 1024 / 1024).toFixed(2)); }
function formatBytes(bytes) { return `${sizeMiB(bytes).toFixed(2)} MiB`; }

function furtherPotential(file) {
  if (file.path === "assets/animations/quaternius/UAL1_Standard.glb") {
    return "Only Idle_Loop and Spell_Simple_Shoot are used; extract those clips while preserving the 65-joint hierarchy (requires animation regression checks).";
  }
  if (file.path.endsWith("Female_Ranger.bin")) {
    return "65-joint emergency fallback geometry; optional mesh quantization could trim it, but preserve skin weights and rig names.";
  }
  if (file.image) {
    if (file.path.startsWith("assets/ui/")) return "Already a small transparent UI portrait; optional alpha-WebP comparison only if it saves meaningful bytes without edge artifacts.";
    return "Already 512px fallback texture; little value in further downscaling.";
  }
  if (file.model) {
    const dimensions = file.model.embeddedImages.map((image) => Math.max(image.width ?? 0, image.height ?? 0));
    if (dimensions.some((dimension) => dimension >= 2048)) return "2K embedded maps dominate this model; a 1K variant can save payload but may soften close-up detail.";
    return "Already reduced to 1K embedded maps and low-poly geometry; 512px could save more, with visible close-up texture softness. Keep current version unless device screenshots support it.";
  }
  return "Required by the current runtime; retain unless its feature/load phase changes.";
}

function category(relative, extension) {
  const lower = relative.toLowerCase();
  if (lower.startsWith("ui/")) return "UI images";
  if (lower.startsWith("models/defenders/")) return "Defender models";
  if (lower.startsWith("models/enemies/")) return "Enemy models";
  if (lower.startsWith("environment/")) return [".png", ".jpg", ".jpeg", ".webp"].includes(extension) ? "Environment textures" : "Environment models";
  if (lower.startsWith("animations/")) return "Animations";
  if (lower.startsWith("models/quaternius/")) return [".png", ".jpg", ".jpeg", ".webp"].includes(extension) ? "Character textures" : "Character fallback";
  if (lower.startsWith("models/")) return "Other models/source";
  return "Other";
}

function loadPhase(relative, manifestInfo) {
  const lower = relative.toLowerCase();
  const referencedBy = manifestInfo?.referencedBy ? [...manifestInfo.referencedBy] : [];
  if (referencedBy.some((ref) => ref.endsWith(".gltf"))) return `GLTF dependency of ${referencedBy.join(", ")}`;
  if (lower.startsWith("ui/")) return "map/faction UI and selected-tower panel";
  if (lower.startsWith("models/defenders/optimized/")) return "battlefield defender preload";
  if (lower.startsWith("models/enemies/optimized/")) return "current + near-future wave preload";
  if (lower.startsWith("environment/kenney-castle/")) return "battlefield environment initialization";
  if (lower.startsWith("animations/")) return "emergency ranger visual fallback / attack animation";
  if (lower.startsWith("models/quaternius/")) return "emergency ranger visual fallback";
  if (lower.includes("/optimized/")) return "optimized runtime model (not current manifest)";
  if (/models\/(defenders|enemies)\//.test(lower)) return "development-only high-resolution fallback";
  return "unreferenced/source/preview candidate";
}

async function main() {
  const args = process.argv.slice(2);
  const outputArgIndex = args.indexOf("--write");
  const outputName = outputArgIndex >= 0 ? (args[outputArgIndex + 1] ?? "reports/asset-inventory.md") : undefined;
  const { manifest, keep } = await loadManifest(projectRoot);
  const sources = await readSourceForAudit(projectRoot);
  const sourceReferences = new Map();
  for (const assetFile of await listFiles(publicAssetsRoot)) {
    const relative = toPosix(path.relative(publicAssetsRoot, assetFile));
    const basename = path.posix.basename(relative).toLowerCase();
    const refs = sources.filter((entry) => entry.text.toLowerCase().includes(basename)).map((entry) => entry.relative);
    const manifestEntry = keep.get(`assets/${relative}`);
    sourceReferences.set(relative, { refs, manifestEntry });
  }

  const publicFiles = [];
  const hashGroups = new Map();
  for (const absolute of await listFiles(publicAssetsRoot)) {
    const relative = toPosix(path.relative(publicAssetsRoot, absolute));
    const ext = path.extname(relative).toLowerCase();
    const bytes = await readFile(absolute);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const info = ext === ".glb" ? parseGlb(bytes)
      : ext === ".gltf" ? parseGltfMetadata(JSON.parse(bytes.toString("utf8")))
        : [".png", ".jpg", ".jpeg", ".webp"].includes(ext) ? (pngInfo(bytes) ?? jpegInfo(bytes) ?? webpInfo(bytes)) : undefined;
    let gltfJson;
    if (ext === ".gltf") {
      try { gltfJson = JSON.parse(bytes.toString("utf8")); } catch { /* malformed source is identified by missing info */ }
    }
    const fileRefs = sourceReferences.get(relative);
    const manifestEntry = fileRefs?.manifestEntry;
    const record = {
      path: `assets/${relative}`,
      type: ext.slice(1).toUpperCase(),
      bytes: bytes.length,
      sizeMiB: sizeMiB(bytes.length),
      sha256: hash,
      referenced: Boolean(fileRefs?.refs.length || manifestEntry),
      whereReferenced: fileRefs?.refs ?? [],
      loadPhase: loadPhase(relative, manifestEntry),
      productionIncluded: keep.has(`assets/${relative}`),
      duplicateHashGroup: null,
      image: [".png", ".jpg", ".jpeg", ".webp"].includes(ext) ? info : undefined,
      model: ext === ".glb" || ext === ".gltf" ? info : undefined,
      gltfDependencies: gltfJson ? [...(gltfJson.buffers ?? []), ...(gltfJson.images ?? [])].map(({ uri }) => uri).filter(Boolean) : undefined,
    };
    publicFiles.push(record);
    const group = hashGroups.get(hash) ?? [];
    group.push(record);
    hashGroups.set(hash, group);
  }
  const duplicates = [...hashGroups.values()].filter((group) => group.length > 1);
  duplicates.forEach((group, index) => group.forEach((record) => { record.duplicateHashGroup = index + 1; }));

  const sourceDirs = ["3D", "Background", "Quaternius", "Quaternius Characters", "Universal Animation Library[Standard]", "public/assets", "dist", ".git"];
  const directorySizes = {};
  for (const name of sourceDirs) {
    try {
      const root = path.join(projectRoot, name);
      const items = await listFiles(root);
      let total = 0;
      for (const file of items) total += (await stat(file)).size;
      directorySizes[name] = total;
    } catch { /* optional/source folder not present */ }
  }

  const formatTotals = new Map();
  const categoryTotals = new Map();
  const productionCategoryTotals = new Map();
  const productionFormatTotals = new Map();
  for (const file of publicFiles) {
    const ext = `.${file.type.toLowerCase()}`;
    const format = formatTotals.get(ext) ?? { count: 0, bytes: 0 };
    format.count += 1; format.bytes += file.bytes; formatTotals.set(ext, format);
    const group = category(file.path.slice("assets/".length), ext);
    const total = categoryTotals.get(group) ?? { count: 0, bytes: 0 };
    total.count += 1; total.bytes += file.bytes; categoryTotals.set(group, total);
    if (file.productionIncluded) {
      const productionFormat = productionFormatTotals.get(ext) ?? { count: 0, bytes: 0 };
      productionFormat.count += 1; productionFormat.bytes += file.bytes; productionFormatTotals.set(ext, productionFormat);
      const productionGroup = productionCategoryTotals.get(group) ?? { count: 0, bytes: 0 };
      productionGroup.count += 1; productionGroup.bytes += file.bytes; productionCategoryTotals.set(group, productionGroup);
    }
  }

  const distFiles = await listFiles(distRoot);
  const distAssetRecords = [];
  for (const absolute of distFiles) {
    const relative = toPosix(path.relative(distRoot, absolute));
    if (!relative.startsWith("assets/")) continue;
    const bytes = (await stat(absolute)).size;
    const ext = path.extname(relative).toLowerCase();
    distAssetRecords.push({ path: relative, bytes, extension: ext });
  }
  let fullDistBytes = 0;
  for (const file of distFiles) fullDistBytes += (await stat(file)).size;

  const beforeDistBytes = Number(process.env.ASSET_AUDIT_BEFORE_DIST_BYTES ?? 0);
  const beforePublicBytes = Number(process.env.ASSET_AUDIT_BEFORE_PUBLIC_BYTES ?? 0);
  const afterProductionAssetsBytes = [...keep.keys()].reduce((sum, key) => {
    const record = publicFiles.find((file) => file.path === key);
    return sum + (record?.bytes ?? 0);
  }, 0);
  const totals = {
    publicAssetsBytes: publicFiles.reduce((sum, file) => sum + file.bytes, 0),
    productionAssetsBytes: afterProductionAssetsBytes,
    distBytes: fullDistBytes,
    distAssetBytes: distAssetRecords.reduce((sum, file) => sum + file.bytes, 0),
    beforeDistBytes,
    beforePublicBytes,
  };
  const top50 = [...publicFiles].sort((a, b) => b.bytes - a.bytes).slice(0, 50);
  const top20Production = publicFiles.filter((file) => file.productionIncluded).sort((a, b) => b.bytes - a.bytes).slice(0, 20);
  const highResolutionImages = publicFiles.filter((file) => file.image?.width >= 2048 || file.image?.height >= 2048)
    .sort((a, b) => b.bytes - a.bytes);
  const glbRecords = publicFiles.filter((file) => file.model);
  const inventory = {
    generatedAt: new Date().toISOString(),
    root: projectRoot,
    manifest: manifest.groups,
    totals,
    directorySizes,
    formatTotals: Object.fromEntries([...formatTotals].map(([key, value]) => [key, { ...value, MiB: sizeMiB(value.bytes) }])),
    categoryTotals: Object.fromEntries([...categoryTotals].map(([key, value]) => [key, { ...value, MiB: sizeMiB(value.bytes) }])),
    productionFormatTotals: Object.fromEntries([...productionFormatTotals].map(([key, value]) => [key, { ...value, MiB: sizeMiB(value.bytes) }])),
    productionCategoryTotals: Object.fromEntries([...productionCategoryTotals].map(([key, value]) => [key, { ...value, MiB: sizeMiB(value.bytes) }])),
    fileCount: publicFiles.length,
    duplicateGroups: duplicates.map((group) => ({ sha256: group[0].sha256, files: group.map((file) => file.path), bytesEach: group[0].bytes })),
    highResolutionImages,
    glbRecords,
    top50,
    top20Production,
    files: publicFiles,
  };

  const lines = [
    "# Runtime Asset Inventory",
    "",
    `Generated: ${inventory.generatedAt}`,
    "",
    "## Size summary",
    "",
    `- public/assets: ${formatBytes(totals.publicAssetsBytes)} across ${publicFiles.length} files.`,
    `- Manifest-selected production assets: ${formatBytes(totals.productionAssetsBytes)} across ${keep.size} files (GLTF sidecars included).`,
    `- Current generated dist: ${formatBytes(totals.distBytes)}; assets subtree ${formatBytes(totals.distAssetBytes)}.`,
    ...(beforeDistBytes ? [`- Prior build baseline: ${formatBytes(beforeDistBytes)}; current savings: ${formatBytes(beforeDistBytes - totals.distBytes)} (${(((beforeDistBytes - totals.distBytes) / beforeDistBytes) * 100).toFixed(1)}%).`] : []),
    ...(beforePublicBytes ? [`- Prior public/assets baseline: ${formatBytes(beforePublicBytes)}; originals are retained.`] : []),
    "",
    "## By asset category",
    "",
    "| Category | Files | MiB |",
    "|---|---:|---:|",
    ...[...categoryTotals].sort((a, b) => b[1].bytes - a[1].bytes).map(([name, value]) => `| ${name} | ${value.count} | ${sizeMiB(value.bytes)} |`),
    "",
    "## Production breakdown by category",
    "",
    "| Category | Files | MiB |",
    "|---|---:|---:|",
    ...[...productionCategoryTotals].sort((a, b) => b[1].bytes - a[1].bytes).map(([name, value]) => `| ${name} | ${value.count} | ${sizeMiB(value.bytes)} |`),
    "",
    "## By file format",
    "",
    "| Format | Files | MiB |",
    "|---|---:|---:|",
    ...[...formatTotals].sort((a, b) => b[1].bytes - a[1].bytes).map(([name, value]) => `| ${name} | ${value.count} | ${sizeMiB(value.bytes)} |`),
    "",
    "## Exact duplicate hashes",
    "",
    ...(duplicates.length ? duplicates.map((group) => `- SHA-256 ${group[0].sha256}, ${formatBytes(group[0].bytes)} each: ${group.map((file) => file.path).join(", ")}`) : ["- None detected."]),
    "",
    "## Images at 2K or above",
    "",
    ...(highResolutionImages.length ? highResolutionImages.map((file) => `- ${file.path}: ${file.image.width}x${file.image.height}, alpha=${file.image.alpha}, ${formatBytes(file.bytes)}, ${file.productionIncluded ? "production" : "source/dev-only"}.`) : ["- None detected."]),
    "",
    "## Top 50 largest source/runtime files",
    "",
    "| Path | Type | MiB | Referenced | Load phase | Production | Details |",
    "|---|---|---:|:---:|---|:---:|---|",
    ...top50.map((file) => `| ${file.path} | ${file.type} | ${file.sizeMiB} | ${file.referenced ? "yes" : "no"} | ${file.loadPhase.replaceAll("|", "/")} | ${file.productionIncluded ? "yes" : "no"} | ${file.model ? `${file.model.triangles.toLocaleString()} tris; ${file.model.materials} mats; ${file.model.images} imgs; ${file.model.skins} skins/${file.model.joints} joints; ${formatBytes(file.model.embeddedTextureBytes)} embedded; ${file.model.embeddedImages.map((image) => `${image.name}:${image.width ?? "?"}x${image.height ?? "?"}`).join(", ")}; anim=${file.model.animations.join("/") || "none"}` : file.image ? `${file.image.width}x${file.image.height}; alpha=${file.image.alpha}` : ""} |`),
    "",
    "## Top 20 largest production assets",
    "",
    "| Path | MiB | Purpose/load phase | Further potential |",
    "|---|---:|---|---|",
    ...top20Production.map((file) => `| ${file.path} | ${file.sizeMiB} | ${file.loadPhase} | ${furtherPotential(file)} |`),
    "",
    "## Models and reference evidence",
    "",
    "Every inventory file records its SHA-256, static source files that mention its basename, manifest inclusion, load phase, image dimensions/alpha or GLB geometry/material/image/skeleton/animation metadata. GLTF URI dependencies are followed from the manifest roots.",
    "",
  ];
  const markdown = lines.join("\n");
  if (outputName) {
    const outputPath = path.resolve(projectRoot, outputName);
    if (!outputPath.startsWith(`${projectRoot}${path.sep}`)) throw new Error("Audit output must remain inside the project root.");
    await mkdir(path.dirname(outputPath), { recursive: true });
    const jsonPath = outputPath.replace(/\.md$/i, ".json");
    await writeFile(outputPath, markdown, "utf8");
    await writeFile(jsonPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
    console.info(`Asset inventory written: ${outputName} and ${path.relative(projectRoot, jsonPath)}`);
  } else console.info(markdown);
  console.info(`Sizes: public/assets ${formatBytes(totals.publicAssetsBytes)}; manifest production assets ${formatBytes(totals.productionAssetsBytes)}; dist ${formatBytes(totals.distBytes)}.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
