<p align="center"><img src="assets/logo/zeolithe-wordmark.svg" alt="Zeolithe" width="420"></p>

Zeolithe is a note-taking and note-collecting app in the spirit of Obsidian.
Notes are plain Markdown files, compatible with Obsidian vaults, and the app
is shared between Windows and Android.

- Specification: [docs/feasibility.md](docs/feasibility.md)
- Taxonomy and numbering: [docs/taxonomy.md](docs/taxonomy.md)

## Repository layout

| Path | Content |
| ---- | ------- |
| `packages/core` | Shared, platform-independent logic: taxonomy, `XX.YY.ZZ.NNN` IDs, tasks, Attn points, dates, tags, TOC. Unit-tested. |
| `apps/web` | Shared UI (Svelte + CodeMirror 6). It runs in a browser today. The Tauri (Windows) and Capacitor (Android) shells will wrap it. |
| `assets/logo` | Logo: an icon and a wordmark (SVG). |
| `docs` | Specification. |

## Development

```sh
npm install
npm test          # core unit tests
npm run check     # type checks
npm run dev       # UI on http://localhost:5173 (demo vault in memory)
npm run build
```

In the browser the app starts with an in-memory demo vault. **📂 Open folder**
works on a real vault in Chrome or Edge desktop, through the File System
Access API.

## Status

Done:

- Editor with toolbar, plus edit, split and view modes.
- Obsidian-flavoured preview: wiki links, embeds, callouts, highlights,
  inline fields.
- Images by paste or drop.
- Dynamic and static TOC.
- Tasks: toolbar buttons, state cycling, ticking from the preview, `[due:: …]`
  with natural-language dates.
- Attn points: insert, resolve, convert to task.
- New-note dialog: PARA ID generation, Journal, Inbox and Free notes.
- Archiving.
- ID collision detection and renumbering, with link updates.
- Sync-conflict listing.
- Tag panel grouped by the taxonomy.
- Task and Attn panel, simple search.

Next:

- Native shells: Tauri on Windows, Capacitor on Android. Start with the
  Android folder-access spike.
- SQLite WASM index with full-text search.
- Dataview query subset.
- Renaming and merging tags.
- Live preview.
