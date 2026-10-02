<p align="center"><img src="assets/logo/zeolite-wordmark.svg" alt="Zeolite" width="420"></p>

Zeolite is a note-taking and note-collecting app in the spirit of Obsidian.
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

## Portable use (no install, e.g. a work PC)

`npm run build:portable` produces **one file**: `apps/web/dist-portable/Zeolite.html`
(about 4.6 MB, everything included, works offline).

1. Copy `Zeolite.html` anywhere: your documents, a USB stick, a network share,
   or next to your vault folder.
2. Open it with **Edge** or **Chrome** (double-click, or drag it into the browser).
3. Press 📂 **Open folder** and choose your vault. Next time, press
   **Reopen "<vault>"** and confirm access once.

Nothing is installed and no admin rights are needed; notes stay plain `.md`
files in your folder (Syncthing keeps syncing them as usual). Firefox cannot
open folders. A portable Windows app (`Zeolite.exe`, no installer, using the
WebView2 runtime built into Windows 10/11) will come with the Tauri shell.

## Development

```sh
npm install
npm test          # core unit tests
npm run check     # type checks
npm run dev       # UI on http://localhost:5173 (demo vault in memory)
npm run build
npm run taxonomy -- list --vault "path/to/vault"   # manage the taxonomy (see below)
```

### Taxonomy from the command line

```sh
npm run taxonomy -- add category Aviation            # next free code
npm run taxonomy -- add sub 01 Drones --code 08      # Sub-PARA under PARA 01
npm run taxonomy -- add para Ideas --folder "05 Ideas"
npm run taxonomy -- rename category 06 Programmes --notes   # --notes: also in every note
npm run taxonomy -- remove sub 01 07                 # refused while IDs use it
```

Add `--vault "path/to/vault"` to each command, or run it from inside the
vault folder. In the app, use Tags → ⚙ Manage taxonomy.

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
- Rename or move a note: click its path at the top, or press F2. PARA
  notes keep their ID; links across the vault are updated.
- Delete a note (🗑 in the top bar): it moves to the vault's `.trash`
  folder, like Obsidian; links to it are listed first.
- Opening an Obsidian vault: nothing to convert. Zeolite follows the vault's
  `.obsidian` settings (templates folder, daily notes folder/format/template,
  attachment folder). The only Zeolite file is `_system/Taxonomy.md`, needed
  for numbering only; the app offers to create it (Tags → ⚙ Manage taxonomy).
- Archiving.
- ID collision detection and renumbering, with link updates.
- Sync-conflict listing.
- Tag panel grouped by the taxonomy.
- Task and Attn panel, simple search.
- Dataview queries: the common subset of the query language renders live
  results, and ticking a task in the results updates its note.
- Chord sheets, compatible with Obsidian's Chord Sheets plugin: ```chords
  blocks (also `chords-ukulele`, `chords-mandolin`), chords over lyrics or
  inline in [brackets], custom shapes like `Bbadd13[x13333]`. Diagrams
  (guitar, ukulele; click for other fingerings, hover a chord), transpose
  ♭/♯ in the view (sharps or flats follow the new key), then "Write to
  note". Autoscroll for playing (speed saved in the note as `autoscroll`,
  screen kept awake). PDF export keeps chords aligned (monospaced font) and
  adds the diagrams. Chords highlighted in the editor.
- Templates (Obsidian-compatible variables): pick one in New note
  (auto-suggested by Sub-PARA, PARA or note type), insert one with
  📄 Template, manage them with the 📄 button in the sidebar.
- PDF export (PDF button or Ctrl+P): the note or its whole folder, real
  selectable text, clickable table of contents with page numbers, page
  numbers, images and current Dataview results; download it or save it to
  `exports/` in the vault.
- Taxonomy management in the app (Tags → ⚙ Manage taxonomy) and from the
  command line.
- Query builder (🔍 Query): build a query from a form, insert it in a note or
  save it as a search note in `Searches/`.

Next:

- Native shells: Tauri on Windows, Capacitor on Android. Start with the
  Android folder-access spike.
- SQLite WASM index with full-text search.
- Renaming and merging tags.
- Live preview.
