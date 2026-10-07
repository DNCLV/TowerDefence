import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isInside, listFiles, loadManifest, readSourceForAudit, toPosix, validateSourceManifest } from "./asset-manifest-utils.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.resolve(projectRoot, "public");
const publicAssetsRoot = path.join(publicRoot, "assets");
const distRoot = path.resolve(projectRoot, "dist");

async function main() {
  if (!isInside(projectRoot, distRoot) || path.basename(distRoot) !== "dist") {
    throw new Error(`Refusing to prune unexpected build directory: ${distRoot}`);
  }
  const { manifest, roots, keep } = await loadManifest(projectRoot);
  const sources = await readSourceForAudit(projectRoot);
  const sourceIssues = validateSourceManifest({ manifest, roots }, sources);
  if (sourceIssues.length) throw new Error(`Runtime asset manifest drift:\n${sourceIssues.map((issue) => `- ${issue}`).join("\n")}`);

  const publicFiles = await listFiles(publicAssetsRoot);
  const publicRelative = new Set(publicFiles.map((file) => `assets/${toPosix(path.relative(publicAssetsRoot, file))}`));
  for (const asset of keep.keys()) {
    if (!publicRelative.has(asset)) throw new Error(`Manifest dependency not found under public/assets/: ${asset}`);
  }

  const publicAssetsInDist = new Set((await listFiles(path.join(distRoot, "assets")))
    .map((file) => toPosix(path.relative(distRoot, file)))
    .filter((relative) => publicRelative.has(relative)));
  let removedBytes = 0;
  let removedFiles = 0;
  const removedByDirectory = new Map();
  const unclassifiedOmissions = [];
  const intentionallyExcluded = (relative) => manifest.developmentOnly.includes(relative)
    || manifest.sourceOnlyRoots.some((root) => relative.startsWith(root));
  for (const relative of publicAssetsInDist) {
    if (keep.has(relative)) continue;
    const target = path.resolve(distRoot, relative);
    if (!isInside(distRoot, target) || !target.startsWith(`${path.join(distRoot, "assets")}${path.sep}`)) {
      throw new Error(`Refusing to prune path outside dist/assets/: ${relative}`);
    }
    let details;
    try { details = await stat(target); } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (!details.isFile()) continue;
    await rm(target);
    removedFiles += 1;
    removedBytes += details.size;
    if (!intentionallyExcluded(relative)) unclassifiedOmissions.push({ relative, bytes: details.size });
    const directory = path.posix.dirname(relative).replace(/^assets\//, "");
    removedByDirectory.set(directory, (removedByDirectory.get(directory) ?? 0) + details.size);
  }

  const requiredBytesByGroup = new Map();
  for (const [relative, details] of keep) {
    const size = (await stat(path.join(distRoot, relative))).size;
    for (const group of details.groups) requiredBytesByGroup.set(group, (requiredBytesByGroup.get(group) ?? 0) + size);
  }
  console.info(`Manifest production assets: kept ${keep.size} required files (${(Array.from(requiredBytesByGroup.values()).reduce((a, b) => a + b, 0) / 1024 / 1024).toFixed(2)} MiB including GLTF dependencies).`);
  console.info(`Production-only asset pruning: omitted ${removedFiles} public files (${(removedBytes / 1024 / 1024).toFixed(2)} MiB); originals under public/assets were preserved.`);
  console.info("Largest omitted public groups:", [...removedByDirectory].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, bytes]) => `${name}: ${(bytes / 1024 / 1024).toFixed(2)} MiB`).join(" | "));
  if (unclassifiedOmissions.length) {
    console.warn("Build-only orphan assets omitted (review whether one should be added to the runtime manifest):",
      unclassifiedOmissions.map(({ relative, bytes }) => `${relative} (${(bytes / 1024 / 1024).toFixed(2)} MiB)`).join("; "));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
