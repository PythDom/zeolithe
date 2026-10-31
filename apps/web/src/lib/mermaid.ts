/**
 * Mermaid diagrams (```mermaid blocks, as in Obsidian): drawn as SVG in the
 * preview, saved as .svg files, and turned into pictures for the PDF export
 * and e-mails. Mermaid is loaded only when a note has a diagram: bundled in
 * the apps (works offline), from the CDN in the single-file build.
 */

type Mermaid = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
};

const CDN = "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.esm.min.mjs";

let loading: Promise<Mermaid> | null = null;
function load(): Promise<Mermaid> {
  loading ??= (async () => {
    // The single-file build would carry 5 MB of Mermaid: it loads it from the CDN instead.
    const mod = import.meta.env.MODE === "single" ? await import(/* @vite-ignore */ CDN) : await import("mermaid");
    return (mod.default ?? mod) as Mermaid;
  })().catch((e) => {
    loading = null;
    throw new Error(`Cannot load the diagram engine (${(e as Error).message}).`);
  });
  return loading;
}

/** True when the app shows its dark theme. */
export function isDark(): boolean {
  const bg = getComputedStyle(document.body).backgroundColor;
  const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(bg);
  return !!m && Number(m[1]) * 0.3 + Number(m[2]) * 0.59 + Number(m[3]) * 0.11 < 110;
}

let counter = 0;
let theme = "";
const cache = new Map<string, Promise<string>>();
// One diagram at a time: Mermaid keeps global state while drawing.
let queue: Promise<unknown> = Promise.resolve();

/**
 * The SVG of a diagram (cached by source and theme). Labels are plain SVG
 * text, not HTML, so that the picture converts well for PDF and e-mail.
 * Throws an Error with Mermaid's message for a syntax error.
 */
export function renderDiagram(source: string, dark = false): Promise<string> {
  const key = `${dark ? "d" : "l"}\n${source}`;
  let svg = cache.get(key);
  if (!svg) {
    svg = (queue = queue.catch(() => undefined).then(async () => {
      const mermaid = await load();
      const wanted = dark ? "dark" : "default";
      if (theme !== wanted) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: wanted,
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          suppressErrorRendering: true,
          fontFamily: "Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        });
        theme = wanted;
      }
      try {
        return (await mermaid.render(`zeolite-mermaid-${++counter}`, source)).svg;
      } catch (e) {
        throw new Error((e as Error)?.message?.split("\n").slice(0, 6).join("\n") || String(e));
      } finally {
        // Mermaid may leave its temporary element behind after an error.
        document.getElementById(`dzeolite-mermaid-${counter}`)?.remove();
      }
    })) as Promise<string>;
    svg.catch(() => cache.delete(key));
    cache.set(key, svg);
    if (cache.size > 60) cache.delete(cache.keys().next().value!);
  }
  return svg;
}

/** Natural size of an SVG (its viewBox, else width/height). */
function svgSize(svg: string): { width: number; height: number } {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  const vb = (doc.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const w = vb.length === 4 && vb[2]! > 0 ? vb[2]! : parseFloat(doc.getAttribute("width") ?? "") || 600;
  const h = vb.length === 4 && vb[3]! > 0 ? vb[3]! : parseFloat(doc.getAttribute("height") ?? "") || 400;
  return { width: w, height: h };
}

/** An SVG with explicit width and height (Mermaid writes width="100%"), for files and pictures. */
export function standaloneSvg(svg: string): string {
  const { width, height } = svgSize(svg);
  return svg
    .replace(/<svg\b([^>]*?)\swidth="[^"]*"/, "<svg$1")
    .replace(/<svg\b([^>]*?)\sheight="[^"]*"/, "<svg$1")
    .replace(/<svg\b/, `<svg width="${Math.round(width)}" height="${Math.round(height)}"`)
    .replace(/<svg\b([^>]*?)\sstyle="[^"]*"/, "<svg$1");
}

/** A PNG of an SVG (at `scale` times its size, white background), for PDF and e-mail. */
export async function svgToPng(svg: string, scale = 2): Promise<{ dataUrl: string; width: number; height: number }> {
  const fixed = standaloneSvg(svg);
  const { width, height } = svgSize(fixed);
  const url = URL.createObjectURL(new Blob([fixed], { type: "image/svg+xml" }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("The diagram could not be converted to a picture."));
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL("image/png"), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** File name for a saved diagram: the note's name and the diagram's number. */
export const diagramFileName = (note: string, n: number) => `${note.replace(/[\\/:*?"<>|]/g, "-")} diagram ${n}.svg`;

/**
 * Rendered note HTML (from the preview renderer) with each diagram turned into
 * a picture (light theme), for e-mail. Diagrams with errors become their code.
 */
export async function diagramsToImages(html: string): Promise<string> {
  if (!html.includes("mermaid-block")) return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(".mermaid-block[data-src]"))) {
    const source = decodeURIComponent(el.dataset.src ?? "");
    try {
      const png = await svgToPng(await renderDiagram(source, false));
      const img = doc.createElement("img");
      img.src = png.dataUrl;
      img.alt = "Diagram";
      el.replaceWith(img);
    } catch {
      const pre = doc.createElement("pre");
      pre.textContent = source;
      el.replaceWith(pre);
    }
  }
  return root.innerHTML;
}
