<script lang="ts">
  import { buildEml, copyFormatted, mailHtml, mailtoUrl, openDraft, plainText } from "../lib/mail";
  import { openExternal, platform } from "../lib/native";

  interface Props {
    /** Note title, used as the subject. */
    title: string;
    /** Rendered note (as in the preview, queries included). */
    html: string;
    /** Proposed recipient (e.g. the person of a one-on-one). */
    to: string;
    /** Known addresses: people of one-on-ones and recent recipients. */
    suggestions: string[];
    onClose: () => void;
  }
  let { title, html, to: initialTo, suggestions, onClose }: Props = $props();

  const RECENT_KEY = "zeolite.mail.recent";
  function recent(): string[] {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  }
  function remember(addr: string) {
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
  let message = $state<{ ok: boolean; text: string } | null>(null);
  const known = $derived([...new Set([...suggestions, ...recent()])]);

  const body = $derived(mailHtml(html, subject));
  const windows = platform() === "tauri";

  async function draft() {
    message = null;
    try {
      remember(to.trim());
      await openDraft(buildEml(to.trim(), subject, body, plainText(body)));
      message = { ok: true, text: "The message opens in your mail app (Outlook or Windows Mail): check it and press Send." };
    } catch (e) {
      message = { ok: false, text: `Could not open the mail app: ${(e as Error).message}. Use “Copy formatted” and paste into a new message.` };
    }
  }
  async function mailApp() {
    message = null;
    remember(to.trim());
    const { url, cut } = mailtoUrl(to.trim(), subject, plainText(body));
    await openExternal(url);
    message = cut
      ? { ok: false, text: "The note is long: the message holds the beginning only. For the whole note with its formatting, use “Copy formatted” and paste it into the message." }
      : { ok: true, text: "Opened in your mail app (as plain text). For the formatting, use “Copy formatted” and paste it into the message instead." };
  }
  async function copy() {
    message = null;
    try {
      const formatted = await copyFormatted(body, plainText(body));
      message = { ok: true, text: formatted ? "Copied with its formatting: paste it into a new message (Ctrl+V)." : "Copied as plain text." };
    } catch (e) {
      message = { ok: false, text: (e as Error).message };
    }
  }
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
    <p class="hint">The note is sent as you see it in the preview, query results included (internal links become plain text).</p>
    {#if message}<p class={message.ok ? "ok" : "warn"}>{message.text}</p>{/if}
    <div class="actions">
      <button onclick={onClose}>Close</button>
      <span class="spacer"></span>
      <button onclick={copy} title="Copy the note with its formatting, to paste into any mail">Copy formatted</button>
      {#if windows}
        <button onclick={mailApp} title="mailto: link, plain text">Mail app (text)</button>
        <button class="primary" onclick={draft} title="Opens a new formatted message in Outlook or Windows Mail">Create the message</button>
      {:else}
        <button class="primary" onclick={mailApp} title="Opens your mail app with the note as text">Open in mail app</button>
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
