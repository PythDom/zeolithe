<script lang="ts">
  import { base64, buildEml, copyFormatted, mailHtml, mailtoUrl, openDraft, plainText, withPictures, type MailContent, type MailFile } from "../lib/mail";
  import { androidMail, openExternal, platform } from "../lib/native";

  interface Props {
    /** Note title, used as the subject. */
    title: string;
    /** Rendered note (as in the preview, queries included). */
    html: string;
    /** Proposed recipient (e.g. the person of a one-on-one). */
    to: string;
    /** Known addresses: people of one-on-ones and recent recipients. */
    suggestions: string[];
    /** Make the note's PDF (for "Attach as PDF"). */
    makePdf?: () => Promise<{ blob: Blob; name: string }>;
    /** A PDF already made (from Export to PDF): attached from the start. */
    pdf?: { blob: Blob; name: string } | null;
    onClose: () => void;
  }
  let { title, html, to: initialTo, suggestions, makePdf, pdf: givenPdf = null, onClose }: Props = $props();

  const RECENT_KEY = "zeolite.mail.recent";
  function recent(): string[] {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  }
  function remember(addr: string) {
    if (!addr) return;
    try {
      const list = [addr, ...recent().filter((x) => x !== addr)].slice(0, 12);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch {
      // Not remembered.
    }
  }

  // svelte-ignore state_referenced_locally
  let to = $state(initialTo || recent()[0] || "");
  // svelte-ignore state_referenced_locally
  let subject = $state(title);
  // svelte-ignore state_referenced_locally
  let attachPdf = $state(!!givenPdf);
  let busy = $state(false);
  let message = $state<{ ok: boolean; text: string } | null>(null);
  const known = $derived([...new Set([...suggestions, ...recent()])]);
  const shell = platform();
  const pictures = $derived((html.match(/<img\b/gi) ?? []).length);
  const canPdf = $derived(!!givenPdf || !!makePdf);

  /** The note with its pictures, ready for the draft and the clipboard. */
  const content = (): Promise<MailContent> => withPictures(mailHtml(html, subject));

  let madePdf: { blob: Blob; name: string } | null = null;
  async function pdfFile(): Promise<MailFile | null> {
    if (!attachPdf) return null;
    const p = givenPdf ?? (madePdf ??= (await makePdf?.()) ?? null);
    return p ? { name: p.name, mime: "application/pdf", bytes: new Uint8Array(await p.blob.arrayBuffer()) } : null;
  }

  async function act(fn: () => Promise<void>) {
    busy = true;
    message = null;
    try {
      remember(to.trim());
      await fn();
    } catch (e) {
      message = { ok: false, text: (e as Error).message };
    }
    busy = false;
  }

  /** Windows: an Outlook / Windows Mail draft with pictures and, if asked, the PDF. */
  const draft = () =>
    act(async () => {
      const c = await content();
      const pdf = await pdfFile();
      try {
        await openDraft(buildEml(to.trim(), subject, c.html, plainText(c.html), c.images, pdf ? [pdf] : []));
      } catch (e) {
        throw new Error(`Could not open the mail app: ${(e as Error).message}. Use “Copy formatted” and paste into a new message.`);
      }
      message = { ok: true, text: `The message opens in your mail app (Outlook or Windows Mail)${c.images.length ? `, with its ${c.images.length} picture${c.images.length > 1 ? "s" : ""}` : ""}${pdf ? " and the PDF attached" : ""}: check it and press Send.` };
    });

  /** Android: the mail app with the text, and the PDF or the pictures attached. */
  const android = () =>
    act(async () => {
      const pdf = await pdfFile();
      const files = pdf ? [pdf] : (await content()).images;
      await androidMail(to.trim(), subject, plainText(mailHtml(html, subject)), files.map((f) => ({ name: f.name, data: base64(f.bytes) })));
      message = { ok: true, text: pdf ? "The mail app opens with the PDF attached." : files.length ? `The mail app opens with the text and the ${files.length} picture${files.length > 1 ? "s" : ""} attached.` : "The mail app opens with the note as text." };
    });

  /** mailto: (text only); in the browser, the PDF is downloaded to attach by hand. */
  const mailApp = () =>
    act(async () => {
      const pdf = await pdfFile();
      if (pdf) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([pdf.bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
        a.download = pdf.name;
        a.click();
      }
      const { url, cut } = mailtoUrl(to.trim(), subject, plainText(mailHtml(html, subject)));
      await openExternal(url);
      message = pdf
        ? { ok: true, text: `Opened in your mail app as text; ${pdf.name} was downloaded: attach it to the message.` }
        : cut
          ? { ok: false, text: "The note is long: the message holds the beginning only. For the whole note with its formatting, use “Copy formatted” and paste it into the message." }
          : { ok: true, text: "Opened in your mail app (as plain text). For the formatting and pictures, use “Copy formatted” and paste it into the message instead." };
    });

  const copy = () =>
    act(async () => {
      const c = await content();
      const formatted = await copyFormatted(c.clipboardHtml, plainText(c.html));
      message = { ok: true, text: formatted ? `Copied with its formatting${c.images.length ? " and pictures" : ""}: paste it into a new message (Ctrl+V).` : "Copied as plain text." };
    });
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="dialog" role="dialog" aria-label="Send by e-mail">
    <h2>✉ Send by e-mail</h2>
    <label>To
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={to} type="email" multiple list="mail-known" placeholder="name@example.com" autofocus={!to} />
      <datalist id="mail-known">{#each known as k}<option value={k}></option>{/each}</datalist>
    </label>
    <label>Subject <input bind:value={subject} /></label>
    {#if canPdf}
      <label class="check"><input type="checkbox" bind:checked={attachPdf} /> Attach the note as PDF{givenPdf ? ` (${givenPdf.name})` : ""}</label>
    {/if}
    <p class="hint">
      The note is sent as you see it in the preview, query results and pictures included (internal links become plain text).
      {#if shell === "android" && pictures && !attachPdf}On Android the text goes in the message and the {pictures} picture{pictures > 1 ? "s are" : " is"} attached.{/if}
    </p>
    {#if message}<p class={message.ok ? "ok" : "warn"}>{message.text}</p>{/if}
    <div class="actions">
      <button onclick={onClose}>Close</button>
      <span class="spacer"></span>
      {#if shell !== "android"}<button onclick={copy} disabled={busy} title="Copy the note with its formatting and pictures, to paste into any mail">Copy formatted</button>{/if}
      {#if shell === "tauri"}
        <button onclick={mailApp} disabled={busy} title="mailto: link, plain text">Mail app (text)</button>
        <button class="primary" onclick={draft} disabled={busy} title="Opens a new formatted message in Outlook or Windows Mail">{busy ? "Preparing…" : "Create the message"}</button>
      {:else if shell === "android"}
        <button class="primary" onclick={android} disabled={busy} title="Opens your mail app">{busy ? "Preparing…" : "Open in mail app"}</button>
      {:else}
        <button class="primary" onclick={mailApp} disabled={busy} title="Opens your mail app with the note as text">Open in mail app</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: calc(16px + var(--safe-top)) calc(16px + var(--safe-right)) calc(16px + var(--safe-bottom)) calc(16px + var(--safe-left));
    background: rgb(0 0 0 / 0.35);
  }
  .dialog {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(520px, 100%);
    padding: 20px;
    border-radius: 12px;
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.3);
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
  }
  input {
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 14px;
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    color: var(--fg);
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 12.5px;
  }
  .ok,
  .warn {
    margin: 0;
    font-size: 13.5px;
  }
  .ok {
    color: var(--ok);
  }
  .warn {
    color: var(--danger);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .spacer {
    flex: 1;
  }
  .actions button {
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
  .actions .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
  }
</style>
