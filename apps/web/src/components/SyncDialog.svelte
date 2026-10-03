<script lang="ts">
  import type { SyncSettings } from "../lib/sync";
  import { WebDavClient } from "../lib/webdav";

  interface Props {
    vaultName: string;
    settings: SyncSettings | null;
    /** Summary of the last sync, if any. */
    last: string;
    onSave: (s: SyncSettings) => void;
    onRemove: () => void;
    onClose: () => void;
  }
  let { vaultName, settings, last, onSave, onRemove, onClose }: Props = $props();

  // svelte-ignore state_referenced_locally
  const init = settings ?? { url: "", username: "", password: "", every: 5 };
  let url = $state(init.url);
  let username = $state(init.username);
  let password = $state(init.password);
  let every = $state(init.every);
  let showPassword = $state(false);
  let testing = $state(false);
  let result = $state<{ ok: boolean; text: string } | null>(null);

  const insecure = $derived(/^http:\/\//i.test(url.trim()) && !/^http:\/\/(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.trim()));

  async function test() {
    testing = true;
    result = null;
    try {
      const r = await new WebDavClient(url, username, password).test();
      result = { ok: true, text: r === "created" ? "Connected. The sync folder did not exist and has been created." : "Connected." };
    } catch (e) {
      result = { ok: false, text: (e as Error).message };
    }
    testing = false;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    testing = true;
    result = null;
    try {
      await new WebDavClient(url, username, password).test();
    } catch (err) {
      result = { ok: false, text: (err as Error).message };
      testing = false;
      return;
    }
    onSave({ url: url.trim(), username: username.trim(), password, every });
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <form class="dialog" onsubmit={submit}>
    <h2>Sync with your server</h2>
    <p class="intro">
      Keeps “{vaultName}” in sync with a folder on a WebDAV server, for example the Docker container described below. Each
      device with Zeolite syncs with the same folder. Changes made on both sides are kept as conflict copies, deletions go to
      <code>.trash</code>.
    </p>
    <label>Server address (WebDAV folder)
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={url} placeholder="https://dav.example.com/zeolite/" autocomplete="url" autofocus={!settings} required />
    </label>
    {#if insecure}<p class="warn">⚠ http:// sends your password unencrypted over the internet: use https:// outside your home network.</p>{/if}
    <div class="row">
      <label>User name <input bind:value={username} autocomplete="username" /></label>
      <label>Password
        <span class="pw">
          <input type={showPassword ? "text" : "password"} bind:value={password} autocomplete="current-password" />
          <button type="button" class="eye" onclick={() => (showPassword = !showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "🙈" : "👁"}</button>
        </span>
      </label>
    </div>
    <label>Sync automatically
      <select bind:value={every}>
        <option value={0}>Only when opening the vault and with the ⇅ button</option>
        <option value={1}>Every minute</option>
        <option value={5}>Every 5 minutes</option>
        <option value={15}>Every 15 minutes</option>
        <option value={60}>Every hour</option>
      </select>
    </label>
    <p class="hint">Settings are kept on this device only. Zeolite also syncs when it opens the vault and when you switch away from the app.</p>
    {#if result}<p class={result.ok ? "ok" : "error"}>{result.ok ? "✓" : "⚠"} {result.text}</p>{/if}
    {#if last}<p class="hint">Last sync: {last}</p>{/if}

    <details>
      <summary>Setting up the server (Docker)</summary>
      <p>On your Docker server, create a folder with these two files, then run <code>docker compose up -d</code>:</p>
      <p class="file">compose.yml</p>
      <pre>services:
  webdav:
    image: ghcr.io/hacdias/webdav:latest
    restart: unless-stopped
    ports:
      - "6065:6065"
    volumes:
      - ./config.yml:/config.yml:ro
      - ./vault:/data
    command: -c /config.yml</pre>
      <p class="file">config.yml</p>
      <pre>address: 0.0.0.0
port: 6065
directory: /data
permissions: CRUD
cors:
  enabled: true
  credentials: false
  allowed_hosts: ['*']
  allowed_headers: [Authorization, Content-Type, Depth, Destination, Overwrite]
  allowed_methods: [GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY, PROPFIND, OPTIONS]
  exposed_headers: [ETag, Last-Modified]
users:
  - username: me
    password: change-this-password</pre>
      <p>
        The address is then <code>http://&lt;server&gt;:6065/</code> at home. From outside, put it behind your HTTPS reverse
        proxy (or use a VPN such as Tailscale) and use the https:// address. Any WebDAV server works if it allows CORS
        requests (Nextcloud needs a CORS-enabled proxy in front). Full guide: <code>docs/sync.md</code> in the Zeolite
        repository.
      </p>
    </details>

    <div class="actions">
      {#if settings}<button type="button" class="danger" onclick={onRemove}>Stop syncing</button>{/if}
      <span class="spacer"></span>
      <button type="button" onclick={test} disabled={testing || !url.trim()}>Test connection</button>
      <button type="button" onclick={onClose}>Cancel</button>
      <button type="submit" class="primary" disabled={testing || !url.trim()}>{testing ? "Connecting…" : "Save and sync"}</button>
    </div>
  </form>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgb(0 0 0 / 0.35);
  }
  .dialog {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(560px, 100%);
    max-height: calc(100vh - 32px);
    overflow: auto;
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
  .intro,
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }
  label {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    font-size: 13px;
    color: var(--muted);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .pw {
    display: flex;
  }
  .pw input {
    flex: 1;
    border-radius: 6px 0 0 6px;
  }
  .eye {
    padding: 0 8px;
    border: 1px solid var(--border);
    border-left: none;
    border-radius: 0 6px 6px 0;
    background: var(--bg);
    cursor: pointer;
  }
  input,
  select {
    min-width: 0;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 14px;
  }
  .ok,
  .error,
  .warn {
    margin: 0;
    font-size: 13.5px;
    overflow-wrap: anywhere;
  }
  .ok {
    color: var(--ok);
  }
  .error,
  .warn {
    color: var(--danger);
  }
  details {
    font-size: 13px;
  }
  summary {
    color: var(--accent-strong);
    cursor: pointer;
  }
  details p {
    margin: 8px 0 4px;
    color: var(--muted);
  }
  .file {
    font-weight: 600;
    color: var(--fg);
  }
  pre {
    margin: 0;
    padding: 8px 10px;
    overflow: auto;
    border-radius: 6px;
    background: var(--bg);
    font-family: var(--mono);
    font-size: 12px;
    user-select: all;
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
  .actions .danger {
    border-color: var(--danger);
    color: var(--danger);
  }
  .actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
