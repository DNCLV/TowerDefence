import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

/** Small resolver for Node's built-in TS type stripping; runtime code stays dependency-free. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !extname(specifier)) {
    const baseUrl = new URL(specifier, context.parentURL);
    for (const extension of [".ts", ".js", ".mjs"]) {
      const candidate = new URL(`${baseUrl.href}${extension}`);
      try {
        await access(fileURLToPath(candidate));
        return nextResolve(pathToFileURL(fileURLToPath(candidate)).href, context);
      } catch {
        // Try the next standard source extension.
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith(".ts")) return nextLoad(url, context);
  const source = await readFile(fileURLToPath(url), "utf8");
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: fileURLToPath(url),
  });
  return { format: "module", source: result.outputText, shortCircuit: true };
}
