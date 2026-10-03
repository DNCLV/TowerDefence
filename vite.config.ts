import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // Vite serves the app at / in development, but Pages hosts this project below
  // the repository path. Keep that deployment path in every production build.
  base: command === "serve" ? "/" : "/TowerDefence/",
  server: {
    host: true,
    // OneDrive may lock large imported models while syncing; Vite does not need
    // to recursively watch binary model sources for code HMR.
    watch: { ignored: ["**/*.glb", "**/*.gltf", "**/*.fbx", "**/*.obj"] },
  },
}));
