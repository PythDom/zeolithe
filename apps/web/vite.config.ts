import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  // Relative asset paths so the same build loads inside Tauri and Capacitor.
  base: "./",
  server: { port: 5173 },
});
