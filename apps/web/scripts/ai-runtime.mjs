/**
 * The Transformers.js browser build shipped with the apps (`ai/`), taken
 * from the npm package at build time and cached in node_modules/.cache.
 * Only the package archive is downloaded (`npm pack`, integrity-checked by
 * npm): installing the package would also pull in `onnxruntime-node` and
 * `sharp`, native modules the apps do not need. Apache-2.0.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export const TRANSFORMERS_VERSION = "4.3.1";
const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, "../../../node_modules/.cache/zeolite-ai");

/** One file out of a .tgz (ustar, as npm writes it). */
function untarFile(tgz, wanted) {
  const tar = gunzipSync(tgz);
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, len) => header.subarray(start, start + len).toString("utf8").replace(/\0.*$/s, "");
    const name = [field(345, 155), field(0, 100)].filter(Boolean).join("/");
    const size = parseInt(field(124, 12).trim() || "0", 8);
    if (name === wanted) return tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${wanted} not found in the package`);
}

/** Path of transformers.min.js, downloaded on first use. */
export function transformersFile() {
  const file = join(cache, `transformers-${TRANSFORMERS_VERSION}.min.js`);
  if (existsSync(file)) return file;
  mkdirSync(cache, { recursive: true });
  const tmp = join(cache, "pack");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp);
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", `@huggingface/transformers@${TRANSFORMERS_VERSION}`, "--silent"], {
    cwd: tmp,
    stdio: ["ignore", "ignore", "inherit"],
    shell: process.platform === "win32",
  });
  const tgz = readdirSync(tmp).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error("npm pack produced no archive");
  writeFileSync(file, untarFile(readFileSync(join(tmp, tgz)), "package/dist/transformers.min.js"));
  rmSync(tmp, { recursive: true, force: true });
  return file;
}
