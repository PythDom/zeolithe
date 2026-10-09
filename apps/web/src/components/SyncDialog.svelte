<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { makeRemote, type SyncSettings } from "../lib/sync";
  import { DEFAULT_CLIENT_ID, signedInAccount, signOut, startSignIn, type DeviceCode } from "../lib/onedrive";
  import { openExternal } from "../lib/native";
  import { formatCode, lanAddress, type SharingInfo } from "../lib/lan";

  interface Props {
    vaultName: string;
    settings: SyncSettings | null;
    /** Summary of the last sync, if any. */
    last: string;
    onSave: (s: SyncSettings) => void;
    onRemove: () => void;
    onClose: () => void;
    /** Windows app: share this vault with a phone or tablet on the local network. */
    canShare?: boolean;
    sharing?: SharingInfo | null;
    sharingCode?: string;
    sharingError?: string;
    onShare?: (on: boolean, newCode?: boolean) => void;
  }
  let { vaultName, settings, last, onSave, onRemove, onClose, canShare = false, sharing = null, sharingCode = "", sharingError = "", onShare }: Props = $props();

  // svelte-ignore state_referenced_locally
  const init = settings ?? { url: "", username: "", password: "", every: 5 };
  let kind = $state<"webdav" | "onedrive" | "lan">(init.kind ?? "webdav");
  let url = $state(init.url);
  let username = $state(init.username);
  let password = $state(init.password);
  // svelte-ignore state_referenced_locally
  let folder = $state(init.folder ?? `Zeolite/${vaultName}`);
  let clientId = $state(init.clientId ?? DEFAULT_CLIENT_ID);
  let every = $state(init.every);
  let showPassword = $state(false);
  let testing = $state(false);
  let result = $state<{ ok: boolean; text: string } | null>(null);

  // OneDrive sign-in.
  let account = $state("");
  let code = $state<DeviceCode | null>(null);
  let copied = $state(false);
  $effect(() => {
    account = signedInAccount(clientId.trim());
  });
  onDestroy(() => code?.cancel());

  async function signIn() {
    result = null;
    let started = false;
    try {
      code = await startSignIn(clientId);
      started = true;
      account = await code.done;
      result = { ok: true, text: `Signed in as ${account}.` };
    } catch (e) {
      // Cancelling (code already cleared) stops quietly.
      if (code || !started) result = { ok: false, text: (e as Error).message };
    }
    code = null;
  }
  function cancelSignIn() {
    code?.cancel();
    code = null;
  }
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code!.userCode);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      /* the code stays visible */
    }
  }

  const insecure = $derived(kind === "webdav" && /^http:\/\//i.test(url.trim()) && !/^http:\/\/(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.trim()));
  const current = (): SyncSettings =>
    kind === "onedrive"
      ? { kind, url: "", username: "", password: "", folder: folder.trim().replace(/^\/+|\/+$/g, ""), clientId: clientId.trim(), every }
      : kind === "lan"
        ? { kind, url: lanAddress(url), username: "", password: password.trim(), every }
        : { kind, url: url.trim(), username: username.trim(), password, every };
  const ready = $derived(kind === "onedrive" ? !!(account && folder.trim()) : kind === "lan" ? !!(url.trim() && password.trim()) : !!url.trim());
  // Switching to the PC option: the WebDAV address is not a PC address.
  let lastKind = untrack(() => kind);
  $effect(() => {
    if (kind !== lastKind && (kind === "lan" || lastKind === "lan")) (url = ""), (password = "");
    lastKind = kind;
  });

  async function check(): Promise<boolean> {
    testing = true;
    result = null;
    try {
      const r = await makeRemote(current()).test();
      result = { ok: true, text: r === "created" ? "Connected. The sync folder did not exist and has been created." : "Connected." };
      return true;
    } catch (e) {
      result = { ok: false, text: (e as Error).message };
      return false;
    } finally {
      testing = false;
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (await check()) onSave(current());
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <form class="dialog" onsubmit={submit}>
    <h2>Sync</h2>
    <p class="intro">
      Keeps “{vaultName}” in sync with a folder on your own WebDAV server, in OneDrive, or directly with a PC on the same Wi-Fi.
      Each device with Zeolite syncs with the same place. Changes made on both sides are kept as conflict copies, deletions go to <code>.trash</code>.
    </p>
    <div class="seg" role="radiogroup" aria-label="Sync with">
      <label class:active={kind === "webdav"}><input type="radio" bind:group={kind} value="webdav" />WebDAV server</label>
      <label class:active={kind === "onedrive"}><input type="radio" bind:group={kind} value="onedrive" />OneDrive</label>
      <label class:active={kind === "lan"}><input type="radio" bind:group={kind} value="lan" />PC on this Wi-Fi</label>
    </div>

    {#if kind === "webdav"}
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
    {:else if kind === "lan"}
      <p class="hint">Syncs directly with Zeolite on a PC on the same Wi-Fi (or your phone's hotspot), no server or internet needed. On the PC: ⇅ → <b>Share with a phone or tablet</b> shows the address and the pairing code.</p>
      <div class="row">
        <label>PC address
          <!-- svelte-ignore a11y_autofocus -->
          <input bind:value={url} placeholder="192.168.1.20:47123" inputmode="url" autocomplete="off" autofocus={!settings} />
        </label>
        <label>Pairing code
          <input bind:value={password} placeholder="K7P4-QX9M" autocomplete="off" spellcheck="false" style="text-transform: uppercase" />
        </label>
      </div>
    {:else}
      <label>Folder in your OneDrive
        <input bind:value={folder} placeholder="Zeolite/My notes" required />
      </label>
      {#if !DEFAULT_CLIENT_ID || clientId !== DEFAULT_CLIENT_ID}
        <label>Application (client) ID
          <input bind:value={clientId} placeholder="00000000-0000-0000-0000-000000000000" spellcheck="false" autocomplete="off" />
        </label>
        <p class="hint">Zeolite signs in with your own free app registration in Microsoft Entra: see “Setting up OneDrive” below.</p>
      {/if}
      {#if code}
        <div class="code">
          <p>On any device, open <b>{code.url.replace(/^https?:\/\//, "")}</b>, enter this code, then sign in to Microsoft:</p>
          <p class="big">{code.userCode}</p>
          <div class="actions">
            <button type="button" onclick={copyCode}>{copied ? "Copied" : "Copy the code"}</button>
            <button type="button" class="primary" onclick={() => openExternal(code!.url)}>Open the Microsoft page</button>
            <button type="button" onclick={cancelSignIn}>Cancel</button>
          </div>
          <p class="hint">Waiting for you to finish signing in…</p>
        </div>
      {:else if account}
        <p class="ok">✓ Signed in as {account} <button type="button" class="link" onclick={() => (signOut(), (account = ""))}>Sign out</button></p>
      {:else}
        <div class="actions"><button type="button" class="primary" onclick={signIn} disabled={!clientId.trim()}>Sign in to Microsoft…</button></div>
      {/if}
    {/if}

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

    {#if kind === "lan"}
      <!-- no server to set up -->
    {:else if kind === "webdav"}
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
    {:else}
      <details>
        <summary>Setting up OneDrive (once, about 5 minutes)</summary>
        <p>Zeolite needs an “app registration” to be allowed to use your OneDrive. It is free, and only you use it:</p>
        <ol>
          <li>Open <b>entra.microsoft.com</b> (or portal.azure.com) and sign in with your Microsoft account.</li>
          <li><b>App registrations → New registration</b>. Name: <code>Zeolite</code>. Supported account types:
            <b>Accounts in any organizational directory and personal Microsoft accounts</b>. No redirect URI. Register.</li>
          <li>On the app's page, copy the <b>Application (client) ID</b> and paste it above.</li>
          <li><b>Authentication</b> → <b>Allow public client flows</b> → <b>Yes</b> → Save.</li>
          <li><b>API permissions</b>: Microsoft Graph <code>Files.ReadWrite</code> and <code>offline_access</code> (delegated).
            They are also asked for at sign-in, so this step is optional.</li>
        </ol>
        <p>
          Work or school accounts: your organisation may require an administrator to approve the app first. Sign-in works in the
          Windows and Android apps (not in a web browser). Each device signs in once; the same client ID is used everywhere.
        </p>
      </details>
    {/if}

    {#if canShare}
      <section class="share">
        <h3>📶 Share with a phone or tablet</h3>
        {#if sharing}
          <p>Sharing “{vaultName}” on this Wi-Fi. On the phone or tablet: ⇅ → <b>PC on this Wi-Fi</b>, then enter:</p>
          <div class="pair">
            <div><span class="lbl">Address</span><b>{sharing.ip ?? "(not connected to a network)"}:{sharing.port}</b></div>
            <div><span class="lbl">Pairing code</span><b class="mono">{formatCode(sharingCode)}</b></div>
          </div>
          <p class="hint">Zeolite shares the vault whenever it is open on this PC. The first time, allow Zeolite on <b>private networks</b> if Windows asks. Changes from the phone appear here at once.</p>
          <div class="actions">
            <button type="button" onclick={() => onShare?.(true, true)} title="Devices paired with the old code must enter the new one">New code</button>
            <button type="button" class="danger" onclick={() => onShare?.(false)}>Stop sharing</button>
          </div>
        {:else}
          <p class="hint">Lets a phone or tablet on the same Wi-Fi sync directly with this PC: no server, no internet.</p>
          <div class="actions"><button type="button" class="primary" onclick={() => onShare?.(true)}>Share this vault</button></div>
        {/if}
        {#if sharingError}<p class="error">⚠ {sharingError}</p>{/if}
      </section>
    {/if}

    <div class="actions">
      {#if settings}<button type="button" class="danger" onclick={onRemove}>Stop syncing</button>{/if}
      <span class="spacer"></span>
      <button type="button" onclick={check} disabled={testing || !ready}>Test connection</button>
      <button type="button" onclick={onClose}>Cancel</button>
      <button type="submit" class="primary" disabled={testing || !ready}>{testing ? "Connecting…" : "Save and sync"}</button>
    </div>
  </form>
</div>

<style>
  .share {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .share h3 {
    margin: 0;
    font-size: 15px;
  }
  .share p {
    margin: 0;
    font-size: 13.5px;
  }
  .pair {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 24px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--accent-soft);
  }
  .pair div {
    display: flex;
    flex-direction: column;
  }
  .pair .lbl {
    color: var(--muted);
    font-size: 12px;
  }
  .pair b {
    font-size: 20px;
  }
  .mono {
    font-family: var(--mono);
    letter-spacing: 0.08em;
  }
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
  details ol {
    margin: 8px 0;
    padding-left: 20px;
    color: var(--muted);
  }
  details li {
    margin: 4px 0;
  }
  .seg {
    display: flex;
    gap: 6px;
  }
  .seg label {
    flex: 1;
    flex-direction: row;
    justify-content: center;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--fg);
    font-size: 14px;
    cursor: pointer;
  }
  .seg label.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    font-weight: 600;
  }
  .seg input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .code {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--accent);
    border-radius: 8px;
    background: var(--accent-soft);
  }
  .code p {
    margin: 0;
    font-size: 13.5px;
  }
  .code .big {
    font-family: var(--mono);
    font-size: 26px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-align: center;
    user-select: all;
  }
  .link {
    margin-left: 6px;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent-strong);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
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
