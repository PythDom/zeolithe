/**
 * Sending a note by e-mail: its rendered preview (queries included) as
 * formatted HTML or plain text, through the mail app (mailto:), the
 * clipboard, or on Windows an Outlook/Windows Mail draft (.eml).
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
    "ul{padding-left:22px}li.task,li.attn-row,li.decision-row{list-style:none;margin-left:-18px}",
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

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/.{76}/g, "$&\r\n");
};
const encodedWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s).replace(/\r\n/g, "")}?=`);

/** An unsent e-mail (Outlook and Windows Mail open it as a new message). */
export function buildEml(to: string, subject: string, html: string, text: string): string {
  const boundary = `zeolite-${Math.random().toString(36).slice(2)}`;
  return [
    "X-Unsent: 1",
    `To: ${to}`,
    `Subject: ${encodedWord(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
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
