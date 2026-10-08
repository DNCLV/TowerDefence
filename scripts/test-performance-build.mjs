import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listFiles, loadManifest, readSourceForAudit, validateSourceManifest, toPosix } from "./asset-manifest-utils.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");
const MiB = 1024 * 1024;
const DIST_WARNING_BYTES = 75 * MiB;
const DIST_FAILURE_BYTES = 100 * MiB;
const readDir = (directory) => readdir(directory, { withFileTypes: true });
const requireFile = async (file) => access(file).catch(() => { throw new Error(`Required file is missing: ${path.relative(projectRoot, file)}`); });

async function main() {
  const html = await readFile(path.join(distRoot, "index.html"), "utf8");
  if (!/<meta\s+name="viewport"/i.test(html)) throw new Error("Production HTML is missing the mobile viewport meta tag.");
  const initialBundlePath = html.match(/src="([^"]+\.js)"/)?.[1];
  if (!initialBundlePath) throw new Error("Could not find the production entry JavaScript bundle.");
  const initialBundle = path.join(distRoot, initialBundlePath.replace(/^\//, "").replace(/^TowerDefence\//, ""));
  await requireFile(initialBundle);
  const initialBytes = (await stat(initialBundle)).size;
  if (initialBytes > 512 * 1024) throw new Error(`Initial UI bundle is unexpectedly large: ${initialBytes} bytes.`);

  const chunks = await readDir(path.join(distRoot, "assets"));
  const rendererChunk = chunks.find((entry) => entry.isFile() && /^BabylonGameRenderer-.*\.js$/.test(entry.name));
  if (!rendererChunk) throw new Error("Expected the Babylon renderer to be a separate lazy-loaded chunk.");
  if (html.includes(rendererChunk.name)) throw new Error("Babylon renderer is referenced by production HTML and would load at boot.");

  const { manifest, roots, keep } = await loadManifest(projectRoot);
  const sourceIssues = validateSourceManifest({ manifest, roots }, await readSourceForAudit(projectRoot));
  if (sourceIssues.length) throw new Error(`Runtime asset manifest drift:\n${sourceIssues.map((issue) => `- ${issue}`).join("\n")}`);
  const publicFiles = await listFiles(path.join(projectRoot, "public", "assets"));
  const distFiles = await listFiles(distRoot);
  const distBytes = (await Promise.all(distFiles.map(async (file) => (await stat(file)).size))).reduce((sum, bytes) => sum + bytes, 0);
  if (distBytes > DIST_FAILURE_BYTES) {
    throw new Error(`Production dist exceeds the ${(DIST_FAILURE_BYTES / MiB).toFixed(0)} MiB hard budget: ${(distBytes / MiB).toFixed(2)} MiB.`);
  }
  if (distBytes > DIST_WARNING_BYTES) {
    console.warn(`Production dist exceeds the ${(DIST_WARNING_BYTES / MiB).toFixed(0)} MiB warning budget: ${(distBytes / MiB).toFixed(2)} MiB.`);
  }
  const publicPaths = new Set(publicFiles.map((file) => toPosix(path.relative(path.join(projectRoot, "public"), file))));
  const distPaths = new Set((await listFiles(path.join(distRoot, "assets"))).map((file) => toPosix(path.relative(distRoot, file))));
  const missing = [...keep.keys()].filter((file) => !distPaths.has(file));
  if (missing.length) throw new Error(`Required manifest assets are missing from dist/: ${missing.join(", ")}`);
  const leaked = [...publicPaths].filter((file) => !keep.has(file) && distPaths.has(file));
  if (leaked.length) throw new Error(`Unmanifested public assets leaked into dist/: ${leaked.join(", ")}`);
  const preservedSource = [...keep.keys()].filter((file) => !publicPaths.has(file));
  if (preservedSource.length) throw new Error(`Manifest assets must remain available under public/assets/: ${preservedSource.join(", ")}`);
  console.info(`Performance build checks passed: dist ${(distBytes / MiB).toFixed(2)} MiB (warning 75 / fail 100 MiB); initial UI JS ${(initialBytes / 1024).toFixed(1)} KiB; Babylon renderer lazy chunk ${((await stat(path.join(distRoot, "assets", rendererChunk.name))).size / MiB).toFixed(2)} MiB; production contains exactly ${keep.size} manifest files and their glTF dependencies, with public source assets preserved.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
