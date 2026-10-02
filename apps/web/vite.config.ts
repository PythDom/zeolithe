import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig(({ mode }) => ({
  // `--mode single` inlines everything into one HTML file (shareable test build).
  plugins: mode === "single" ? [svelte(), viteSingleFile()] : [svelte()],
  // Relative asset paths so the same build loads inside Tauri and Capacitor.
  base: "./",
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 2000 },
}));
