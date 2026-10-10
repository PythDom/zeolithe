import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { transformersFile } from "./scripts/ai-runtime.mjs";

const ortDist = dirname(createRequire(import.meta.url).resolve("onnxruntime-web")).replace(/[\\/]dist[\\/]?.*$/, "/dist");

/**
 * The on-device AI runtime, shipped in `ai/` so that the Windows and Android
 * apps need no CDN (Transformers.js and the onnxruntime wasm it uses).
 * Not in the single-file builds: those load it from cdn.jsdelivr.net.
 */
const AI_FILES: Record<string, string | (() => string)> = {
  "transformers.min.js": transformersFile,
  "ort-wasm-simd-threaded.asyncify.mjs": join(ortDist, "ort-wasm-simd-threaded.asyncify.mjs"),
  "ort-wasm-simd-threaded.asyncify.wasm": join(ortDist, "ort-wasm-simd-threaded.asyncify.wasm"),
};

const aiFile = (name: string) => {
  const f = AI_FILES[name];
  return typeof f === "function" ? f() : f;
};

function aiRuntime(): Plugin {
  const type = (name: string) => (name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
  return {
    name: "zeolite-ai-runtime",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split("?")[0].match(/^\/ai\/([\w.-]+)$/)?.[1];
        if (!name || !AI_FILES[name]) return next();
        res.setHeader("Content-Type", type(name));
        res.end(readFileSync(aiFile(name)));
      });
    },
    generateBundle() {
      for (const name of Object.keys(AI_FILES)) this.emitFile({ type: "asset", fileName: `ai/${name}`, source: readFileSync(aiFile(name)) });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // `--mode single` inlines everything into one HTML file (shareable test build).
  plugins: mode === "single" ? [svelte(), viteSingleFile()] : [svelte(), aiRuntime()],
  // Relative asset paths so the same build loads inside Tauri and Capacitor.
  base: "./",
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 2000 },
}));
