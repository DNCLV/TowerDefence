import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outputRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const prefix = "/TowerDefence/";
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".gltf": "model/gltf+json",
  ".glb": "model/gltf-binary",
  ".bin": "application/octet-stream",
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === prefix.slice(0, -1)) {
    response.writeHead(308, { Location: prefix });
    response.end();
    return;
  }
  if (!url.pathname.startsWith(prefix)) {
    response.writeHead(404);
    response.end("This preview only serves the /TowerDefence/ repo subpath.");
    return;
  }

  let relativePath;
  try {
    relativePath = decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    response.writeHead(400);
    response.end("Invalid URL encoding.");
    return;
  }
  const filePath = path.resolve(outputRoot, relativePath || "index.html");
  if (!filePath.startsWith(`${outputRoot}${path.sep}`)) {
    response.writeHead(403);
    response.end();
    return;
  }

  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] ?? "application/octet-stream",
      "Content-Length": stats.size,
      "Cache-Control": "no-cache",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end();
  }
});

const port = Number(process.env.PORT ?? 5177);
server.listen(port, "127.0.0.1", () => {
  console.log(`Pages subpath preview: http://127.0.0.1:${port}${prefix}`);
});
