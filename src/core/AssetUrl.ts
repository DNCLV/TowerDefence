/// <reference types="vite/client" />

/** Resolve a public asset path using Vite's configured deployment base. */
export function resolveAssetUrl(path: string): string {
  const relativePath = path.replace(/^\/+/, "");
  return `${import.meta.env.BASE_URL}${relativePath}`;
}
