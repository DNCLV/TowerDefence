import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { listFiles, toPosix } from "./asset-manifest-utils.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");
const MiB = 1024 * 1024;
const warningBytes = 75 * MiB;
const failureBytes = 100 * MiB;
const format = (bytes) => `${(bytes / MiB).toFixed(2)} MiB`;
const ancientGrove = new Set([
  "treant.glb", "thorn-owl.glb", "druid.glb", "seer.glb", "bark-titan.glb", "thorn-dancer.glb",
]);
const royalGuard = new Set(["blue-wizard.glb", "holy-knight.glb", "green-archer.glb", "battlemage.glb", "sovereign.glb", "holy-emperor.glb"]);
const modelExtensions = new Set([".glb", ".gltf", ".bin", ".fbx"]);
const textureExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".ktx", ".ktx2"]);
const audioExtensions = new Set([".mp3", ".ogg", ".wav", ".m4a", ".aac"]);

function groupFor(relative) {
  const lower = relative.toLowerCase();
  const basename = path.posix.basename(lower);
  const extension = path.posix.extname(lower);
  if (extension === ".js") return "JavaScript";
  if (extension === ".css") return "CSS";
  if (lower.startsWith("assets/ui/")) return "UI";
  if (audioExtensions.has(extension)) return "Audio";
  if (lower.startsWith("assets/models/enemies/") || lower.startsWith("assets/models/animated-monsters/")) return "Enemies";
  if (lower.startsWith("assets/models/defenders/") && ancientGrove.has(basename)) return "Ancient Grove";
  if (lower.startsWith("assets/models/defenders/") && royalGuard.has(basename)) return "Royal Guard";
  if (lower.startsWith("assets/environment/forest/")) return "Forest environment";
  if (lower.startsWith("assets/environment/kenney-castle/") || lower.startsWith("assets/environment/medieval/")) return "Castle environment";
  if (lower.startsWith("assets/animations/") || lower.startsWith("assets/models/quaternius/")) return "Fallback + animation";
  return "Miscellaneous";
}

function optimizationNote(relative, bytes) {
  const lower = relative.toLowerCase();
  if (lower.includes("ual1_standard.glb")) return "Fallback animation library; clip extraction needs dedicated animation regression tests.";
  if (lower.includes("holy-emperor.glb")) return "Hero outlier (78k tris); retain quality and consider a future mobile LOD.";
  if (lower.includes("t_woodtrim_")) return "Shared 1024px texture for small Castle props; full-resolution source remains outside runtime.";
  if (lower.includes("babylongamerenderer")) return "Lazy Babylon gameplay chunk; not referenced by initial HTML.";
  if (bytes > 2 * MiB) return "Large but manifest-referenced; optimize only with visual/runtime evidence.";
  return "Within current runtime budget.";
}

const groups = new Map();
const hashes = new Map();
const files = [];
let totalBytes = 0;
let jsRawBytes = 0;
let jsGzipBytes = 0;
let cssBytes = 0;
let modelBytes = 0;
let textureBytes = 0;
let audioBytes = 0;

for (const absolute of await listFiles(distRoot)) {
  const bytes = (await stat(absolute)).size;
  const relative = toPosix(path.relative(distRoot, absolute));
  const extension = path.posix.extname(relative).toLowerCase();
  const content = await readFile(absolute);
  const group = groupFor(relative);
  totalBytes += bytes;
  groups.set(group, (groups.get(group) ?? 0) + bytes);
  if (extension === ".js") { jsRawBytes += bytes; jsGzipBytes += gzipSync(content, { level: 9 }).length; }
  if (extension === ".css") cssBytes += bytes;
  if (modelExtensions.has(extension)) modelBytes += bytes;
  if (textureExtensions.has(extension)) textureBytes += bytes;
  if (audioExtensions.has(extension)) audioBytes += bytes;
  const hash = createHash("sha256").update(content).digest("hex");
  const duplicates = hashes.get(hash) ?? [];
  duplicates.push(relative);
  hashes.set(hash, duplicates);
  files.push({ relative, bytes, group, extension });
}

const runtimeAssetBytes = totalBytes - jsRawBytes - cssBytes;
console.info("Production size report");
console.info(`  TOTAL DIST             ${format(totalBytes)}`);
console.info(`  Runtime assets         ${format(runtimeAssetBytes)}`);
console.info(`  Models                 ${format(modelBytes)}`);
console.info(`  Textures               ${format(textureBytes)}`);
console.info(`  Audio                  ${format(audioBytes)}`);
console.info(`  JavaScript raw         ${format(jsRawBytes)}`);
console.info(`  JavaScript gzip        ${format(jsGzipBytes)}`);
console.info(`  CSS                    ${format(cssBytes)}`);
console.info("Production categories");
for (const [group, bytes] of [...groups].sort((a, b) => b[1] - a[1])) console.info(`  ${group.padEnd(22)} ${format(bytes)}`);

console.info("Top 20 production files");
for (const file of [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 20)) {
  console.info(`  ${format(file.bytes).padStart(10)}  ${file.relative}  [${file.group}]  ${optimizationNote(file.relative, file.bytes)}`);
}

const duplicateGroups = [...hashes.entries()].filter(([, paths]) => paths.length > 1);
if (duplicateGroups.length) {
  console.warn("Byte-identical production duplicates:");
  for (const [hash, paths] of duplicateGroups) console.warn(`  ${hash.slice(0, 12)}: ${paths.join(", ")}`);
} else console.info("Byte-identical production duplicates: none.");

const largeFiles = files.filter(({ relative, bytes }) => {
  if (/\.glb$/i.test(relative)) return bytes > 6 * MiB;
  if (textureExtensions.has(path.posix.extname(relative).toLowerCase())) return bytes > 2 * MiB;
  return false;
}).sort((a, b) => b.bytes - a.bytes);
for (const file of largeFiles) console.warn(`Asset budget warning: ${file.relative} is ${format(file.bytes)}.`);

if (totalBytes > failureBytes) {
  console.error(`Production dist exceeds the ${format(failureBytes)} hard budget: ${format(totalBytes)}.`);
  process.exitCode = 1;
} else if (totalBytes > warningBytes) {
  console.warn(`Production dist exceeds the ${format(warningBytes)} warning budget: ${format(totalBytes)}.`);
} else console.info(`Production dist is within the ${format(warningBytes)} preferred budget.`);

console.info("PNG/JPG/GLB transfer size does not represent decoded GPU memory; texture dimensions and render targets remain separate mobile constraints.");
