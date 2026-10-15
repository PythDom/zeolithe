/**
 * Sending a note by e-mail: its rendered preview (queries included) as
 * formatted HTML or plain text, through the mail app (mailto:), the
 * clipboard, or on Windows an Outlook/Windows Mail draft (.eml). Pictures
 * travel with it (inline in the draft, as data in the clipboard), and the
 * note can be attached as a PDF.
 */
import { platform } from "./native";

/** Rendered note HTML made self-contained for a mail: task boxes as ☐/☑, no app-only attributes. */
export function mailHtml(html: string, title: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement;
  for (const box of Array.from(root.querySelectorAll("input[type=checkbox]"))) box.replaceWith(doc.createTextNode((box as HTMLInputElement).hasAttribute("checked") ? "☑ " : "☐ "));
  for (const el of Array.from(root.querySelectorAll("button, script, .chord-tools, .copy-code"))) el.remove();
  for (const el of Array.from(root.querySelectorAll("*"))) {
    for (const a of Array.from(el.attributes)) if (a.name.startsWith("data-") || a.name.startsWith("on")) el.removeAttribute(a.name);
  }
  // Internal links cannot be followed from a mail: plain text.
  for (const a of Array.from(root.querySelectorAll("a"))) {
    const href = a.getAttribute("href") ?? "";
    if (!/^(https?:|mailto:)/i.test(href)) a.replaceWith(doc.createTextNode(a.textContent ?? ""));
  }
  const style = [
    "body{font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.45;color:#1d2525}",
    "h1{font-size:22px}h2{font-size:18px;border-bottom:1px solid #dde4e3}h3{font-size:15px}",
    "table{border-collapse:collapse}td,th{border:1px solid #dde4e3;padding:4px 8px}",
    "code{background:#f0f3f3;padding:0 3px}pre{background:#f0f3f3;padding:8px}",
    "blockquote{border-left:3px solid #0f6f69;margin:0;padding-left:10px;color:#4a5856}",
    ".field,.linefield{background:#f0f3f3;border-radius:4px;padding:0 4px;font-size:12px}",
    "ul{padding-left:22px}li.task,li.attn-row,li.fupi-row,li.decision-row{list-style:none;margin-left:-18px}",
    "p.attn{border-left:3px solid #b45309;background:#fef3c7;padding:4px 8px}",
    "p.decide,p.decision{border-left:3px solid #6d28d9;padding:4px 8px}p.decide{background:#ede9fe}",
    ".query{border:1px solid #dde4e3;border-radius:6px;padding:4px 10px}.query-title{font-size:11px;color:#64716f;text-transform:uppercase}",
  ].join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${style}</style></head><body>${root.innerHTML}</body></html>`;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Plain text of a mail HTML, with line breaks as displayed. */
export function plainText(html: string): string {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:700px;white-space:normal";
  host.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  for (const li of Array.from(host.querySelectorAll("li"))) if (!/^[☐☑]/.test(li.textContent?.trim() ?? "")) li.prepend("• ");
  document.body.append(host);
  const text = host.innerText;
  host.remove();
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** Base64 of bytes (lines of 76 characters when `wrap`). */
export function base64(bytes: Uint8Array, wrap = false): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const out = btoa(bin);
  return wrap ? out.replace(/.{76}/g, "$&\r\n") : out;
}
const b64 = (s: string) => base64(new TextEncoder().encode(s), true);

/** A file carried by the mail: an inline picture (with its Content-ID) or an attachment. */
export interface MailFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
  /** Inline pictures: referenced as cid:… in the HTML. */
  cid?: string;
}

/** The note ready to send: HTML with pictures as cid: (draft) or data: (clipboard), and the pictures. */
export interface MailContent {
  /** For the .eml draft: pictures referenced as cid:…, carried as inline parts. */
  html: string;
  /** For the clipboard: pictures inlined as data: URLs. */
  clipboardHtml: string;
  images: MailFile[];
}

/** Widest picture sent: larger photos are scaled down (mail apps show them at screen width anyway). */
const MAX_WIDTH = 1600;

/** A picture as PNG/JPEG bytes: SVG is rasterised (mail apps rarely show it), large photos scaled down. */
async function mailImage(blob: Blob): Promise<{ bytes: Uint8Array; mime: string; width: number } | null> {
  const type = blob.type || "image/png";
  const raw = new Uint8Array(await blob.arrayBuffer());
  let img: HTMLImageElement;
  const url = URL.createObjectURL(type === "image/svg+xml" || !blob.type ? new Blob([raw], { type }) : blob);
  try {
    img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("unreadable picture"));
      i.src = url;
    });
  } catch {
    URL.revokeObjectURL(url);
    return /^image\/(png|jpe?g|gif|webp)$/.test(type) ? { bytes: raw, mime: type, width: 0 } : null;
  }
  URL.revokeObjectURL(url);
  const w = img.naturalWidth || 600;
  const h = img.naturalHeight || 400;
  const svg = type === "image/svg+xml";
  if (!svg && w <= MAX_WIDTH && /^image\/(png|jpe?g|gif)$/.test(type)) return { bytes: raw, mime: type, width: w };
  const scale = Math.min(1, MAX_WIDTH / w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const jpeg = type === "image/jpeg";
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, jpeg ? "image/jpeg" : "image/png", 0.88));
  if (!out) return null;
  return { bytes: new Uint8Array(await out.arrayBuffer()), mime: out.type, width: canvas.width };
}

/**
 * Make a mail HTML (from mailHtml) self-contained: every picture is read
 * and carried with the message. Pictures that cannot be read are left out.
 */
export async function withPictures(html: string): Promise<MailContent> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const images: MailFile[] = [];
  const clip = doc.cloneNode(true) as Document;
  const imgs = Array.from(doc.querySelectorAll("img"));
  const clipImgs = Array.from(clip.querySelectorAll("img"));
  for (const [i, el] of imgs.entries()) {
    const src = el.getAttribute("src") ?? "";
    let picture: Awaited<ReturnType<typeof mailImage>> = null;
    try {
      if (src && !/^https?:/i.test(src)) picture = await mailImage(await (await fetch(src)).blob());
    } catch {
      picture = null;
    }
    if (/^https?:/i.test(src)) continue; // Web pictures: the mail app loads them.
    if (!picture) {
      el.remove();
      clipImgs[i]?.remove();
      continue;
    }
    const cid = `img${i + 1}.${Date.now().toString(36)}@zeolite`;
    const ext = picture.mime.split("/")[1]!.replace("jpeg", "jpg");
    images.push({ name: `picture-${i + 1}.${ext}`, mime: picture.mime, bytes: picture.bytes, cid });
    el.setAttribute("src", `cid:${cid}`);
    clipImgs[i]?.setAttribute("src", `data:${picture.mime};base64,${base64(picture.bytes)}`);
    // Outlook ignores max-width: give wide pictures a width that fits a mail.
    for (const e of [el, clipImgs[i]]) {
      if (!e) continue;
      if (picture.width > 640) e.setAttribute("width", "640");
      e.removeAttribute("srcset");
      e.setAttribute("style", "max-width:100%;height:auto");
    }
  }
  const serialise = (d: Document) => `<!DOCTYPE html>${d.documentElement.outerHTML}`;
  return { html: serialise(doc), clipboardHtml: serialise(clip), images };
}
const encodedWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s).replace(/\r\n/g, "")}?=`);

/**
 * An unsent e-mail (Outlook and Windows Mail open it as a new message):
 * text and HTML versions, the pictures the HTML shows (cid:), and attachments.
 */
export function buildEml(to: string, subject: string, html: string, text: string, images: MailFile[] = [], attachments: MailFile[] = []): string {
  const id = Math.random().toString(36).slice(2);
  const part = (headers: string[], body: string) => [...headers, "", body].join("\r\n");
  const multipart = (kind: string, boundary: string, parts: string[]) =>
    part([`Content-Type: multipart/${kind}; boundary="${boundary}"`], `${parts.map((p) => `--${boundary}\r\n${p}`).join("\r\n")}\r\n--${boundary}--`);
  const fileName = (n: string) => encodedWord(n).replace(/"/g, "");
  const filePart = (f: MailFile, inline: boolean) =>
    part(
      [
        `Content-Type: ${f.mime}; name="${fileName(f.name)}"`,
        "Content-Transfer-Encoding: base64",
        ...(inline ? [`Content-ID: <${f.cid}>`, `Content-Disposition: inline; filename="${fileName(f.name)}"`] : [`Content-Disposition: attachment; filename="${fileName(f.name)}"`]),
      ],
      base64(f.bytes, true),
    );

  let body = multipart("alternative", `alt-${id}`, [
    part(["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"], b64(text)),
    part(["Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64"], b64(html)),
  ]);
  const inline = images.filter((i) => i.cid);
  if (inline.length) body = multipart("related", `rel-${id}`, [body, ...inline.map((i) => filePart(i, true))]);
  if (attachments.length) body = multipart("mixed", `mix-${id}`, [body, ...attachments.map((a) => filePart(a, false))]);
  return [["X-Unsent: 1", `To: ${to}`, `Subject: ${encodedWord(subject)}`, "MIME-Version: 1.0"].join("\r\n"), body, ""].join("\r\n");
}

/** Some mail apps refuse long mailto: links; past this, the body is cut. */
const MAILTO_LIMIT = 1800;

export function mailtoUrl(to: string, subject: string, body: string): { url: string; cut: boolean } {
  const limit = platform() === "android" ? 20000 : MAILTO_LIMIT;
  const cut = body.length > limit;
  const text = cut ? `${body.slice(0, limit)}\n\n[…]` : body;
  const recipients = to.split(/[;,]\s*/).filter(Boolean).map((r) => encodeURIComponent(r.trim()).replace(/%40/g, "@")).join(",");
  return { url: `mailto:${recipients}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`, cut };
}

/** Copy formatted (pastes with formatting into Outlook, Gmail…), plain text as fallback. */
export async function copyFormatted(html: string, text: string): Promise<boolean> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) }),
    ]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return false;
    } catch {
      throw new Error("The clipboard is not available here.");
    }
  }
}

/** Windows app: open the draft in the default mail app. */
export async function openDraft(eml: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("open_mail_draft", { eml });
  } catch (e) {
    // Tauri rejects with the Rust error as plain text.
    throw new Error(typeof e === "string" ? e : ((e as Error)?.message ?? String(e)));
  }
}
