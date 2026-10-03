# Syncing with your own server (WebDAV)

Zeolite can sync a vault with a folder on a WebDAV server, for example a
small container on your Docker server. Every device with Zeolite (Windows,
Android, the portable HTML) syncs with that folder; nothing else needs to
be installed on the devices. Syncthing keeps working as before if you
prefer it: the two are independent.

## 1. Run the server

The files are in [`server/webdav`](../server/webdav) in this repository.

1. Copy the folder `server/webdav` to your Docker server.
2. Edit `config.yml`: choose a user name and a password (a hashed password
   is better, see the comment in the file).
3. Start it:

   ```sh
   docker compose up -d
   ```

The vault is stored as plain files in `./vault` next to `compose.yml`, so
it is easy to back up.

To check it: open `http://<server>:6065/` in a browser, log in, and you
should see an empty folder listing (or an XML page).

## 2. Reach it from your devices

| Where | Address to use in Zeolite |
| ----- | ------------------------- |
| At home only | `http://<server-ip>:6065/zeolite/` |
| Also outside, with a reverse proxy (Traefik, Caddy, Nginx Proxy Manager…) | `https://dav.example.com/zeolite/` |
| Also outside, with Tailscale or another VPN | `http://<tailscale-name>:6065/zeolite/` |

The last part of the address (`zeolite/` here) is the folder for this
vault on the server; Zeolite creates it. Use another folder name for
another vault.

Outside your home network use **https** (or a VPN): with plain http the
password travels unencrypted. With a reverse proxy, forward everything
(including `OPTIONS` requests) to port 6065, raise the upload size limit
if your proxy has one (Nginx: `client_max_body_size 100m;`), and set
`behindProxy: true` in `config.yml`.

A work PC's network may block other servers: test the address in the
browser there first.

## 3. Set up Zeolite

On each device, open the vault, then in the sidebar press
**⇅ Sync with your server…**:

- server address, user name and password;
- how often to sync automatically.

**Test connection** checks the address and the password. **Save and
sync** runs the first sync. Settings stay on that device (in the app's
storage, password included).

Order for a first setup: sync the device that has the complete vault
first; the others then receive it. If two devices already hold copies of
the same vault, that is fine too: identical files are recognised, and
files that differ are kept in both versions.

## How syncing works

- Zeolite syncs when it opens the vault, every few minutes (as set), when
  you switch away from the app, and when you press **⇅ Sync**.
- Only files changed since the last sync are transferred.
- A note changed on **one** side is copied to the other side.
- A note deleted on one side and unchanged on the other is deleted there
  too. Deleted files go to the vault's `.trash` folder on the device
  (`.trash/deleted by sync <date>/…`), so nothing is lost.
- A note changed on **both** sides keeps both versions: yours stays the
  note, the server's version is saved next to it as
  `Note.sync-conflict-<date>-SERVER.md` (the same naming as Syncthing).
  Zeolite lists conflicts at the top of the Files panel; merge them by
  hand and delete the copy.
- An edit always wins over a deletion.
- If a sync would delete many files at once (for example after opening
  the wrong folder), Zeolite asks first; **Keep them** copies them back.

Not synced: hidden folders (`.obsidian`, `.trash`, `.git`…), Zeolite's
own sync state (`.zeolite/sync.json`, one per device), and empty folders
(a folder is created on the other devices with its first file).

## Using another WebDAV server

Any WebDAV server works if it allows requests from the app (CORS):
it must answer `OPTIONS` requests without asking for a password, send
`Access-Control-Allow-Origin`, allow the `Authorization`, `Depth` and
`Content-Type` headers and the WebDAV methods, and expose the `ETag`
header. Nextcloud's WebDAV does not do this by itself; put a proxy that
adds these headers in front of it, or use the container above.

## Troubleshooting

| Message | What to check |
| ------- | ------------- |
| Cannot reach the server | Address, network, VPN; CORS enabled on the server; an `http://` server cannot be used from the `https://` test page. |
| The server refused the user name or password | `users` in `config.yml` (restart the container after a change). |
| The server does not allow this | The user needs `permissions: CRUD`. |
