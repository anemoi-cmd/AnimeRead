import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { resolve } from "node:path";
import { cacheDirectory } from "./scripts/tool-paths.mjs";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  publicDir: resolve(cacheDirectory, "frontend/public"),
  cacheDir: resolve(cacheDirectory, "frontend/vite"),
  resolve: {
    alias: { "@vendor": fileURLToPath(new URL("./vendor", import.meta.url)) },
  },
  server: { port: 1420, strictPort: true, host: "127.0.0.1", hmr: false },
  clearScreen: false,
  build: {
    outDir: resolve(cacheDirectory, "frontend/dist"),
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 1000,
  },
  optimizeDeps: { exclude: ["@vendor/foliate-js/view.js"] },
});
