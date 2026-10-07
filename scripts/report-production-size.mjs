import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listFiles, toPosix } from "./asset-manifest-utils.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");
const MiB = 1024 * 1024;
const groups = new Map();
const files = [];
const format = (bytes) => `${(bytes / MiB).toFixed(2)} MiB`;

function groupFor(relative) {
  if (/^assets\/.*\.(js|css)$/i.test(relative)) return "JavaScript + CSS";
  if (/^assets\/ui\//i.test(relative)) return "UI images";
  if (/^assets\/animations\//i.test(relative)) return "Animation";
  if (/^assets\/environment\//i.test(relative)) return /\.(png|jpe?g|webp)$/i.test(relative) ? "Environment textures" : "Environment models";
  if (/^assets\/models\/defenders\//i.test(relative)) return "Defenders";
  if (/^assets\/models\/enemies\//i.test(relative)) return "Enemies";
  if (/^assets\/models\//i.test(relative)) return "Other models";
  if (/^assets\//i.test(relative)) return "Other assets";
  return "Other";
}

const allFiles = await listFiles(distRoot);
let totalBytes = 0;
for (const absolute of allFiles) {
  const bytes = (await stat(absolute)).size;
  const relative = toPosix(path.relative(distRoot, absolute));
  totalBytes += bytes;
  const group = groupFor(relative);
  groups.set(group, (groups.get(group) ?? 0) + bytes);
  files.push({ relative, bytes, group });
}

console.info(`Production footprint: ${format(totalBytes)} in ${files.length} files.`);
for (const [group, bytes] of [...groups].sort((a, b) => b[1] - a[1])) console.info(`  ${group.padEnd(22)} ${format(bytes)}`);

const largeFiles = files.filter(({ relative, bytes }) => {
  if (/\.glb$/i.test(relative)) return bytes > 12 * MiB;
  if (/\.(png|jpe?g|webp)$/i.test(relative)) return bytes > 2 * MiB;
  return false;
}).sort((a, b) => b.bytes - a.bytes);
if (largeFiles.length) {
  console.warn("Asset budget warnings (advisory; build is not blocked):");
  for (const file of largeFiles) console.warn(`  ${file.relative}: ${format(file.bytes)}`);
}
if (totalBytes > 160 * MiB) console.warn(`Production dist exceeds the 160 MiB soft budget (${format(totalBytes)}); review future asset additions.`);

console.info("Transfer compression caveat: PNG/JPG/GLB are already compressed or contain compressed payloads; gzip/Brotli size is not a proxy for GPU memory or installed app footprint.");
