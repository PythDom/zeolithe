# Zeolite: feasibility study and specification

Status: specification agreed, no code written yet.

Zeolite is a note-taking and note-collecting app in the spirit of Obsidian.
Notes are plain Markdown files in a folder (the *vault*), shared between a
Windows PC and an Android phone, and compatible with existing Obsidian vaults.

## 1. Verdict

Feasible. Every requirement is covered by mature open-source building blocks.
The real work is in the task and query layer, the numbering system, and
polishing the editor.

Main risks:

1. Folder access on Android: prove it with a prototype first.
2. Implementing the Dataview query subset correctly.
3. Getting live preview in the editor to feel good (deferred, see phases).

Estimated effort for one developer: about 8–12 weeks to a usable MVP on both
platforms.

## 2. Architecture

```
                 Shared code (TypeScript, ~90%)
   editor · markdown rendering · TOC · task/Attn parser · Dataview subset
   numbering · tag management · search index (SQLite WASM) · UI
                              │
                    Storage interface (small)
               ┌──────────────┴──────────────┐
          Windows: Tauri 2               Android: Capacitor
          native file access,            real folder via Android
          file watching                  storage access
                              │
                 Sync: Syncthing (outside the app)
```

| Layer          | Choice                                                         |
| -------------- | -------------------------------------------------------------- |
| Language       | TypeScript                                                     |
| UI framework   | Svelte or React (to be chosen at scaffolding)                  |
| Editor         | CodeMirror 6 (edits raw Markdown; never reformats files)       |
| Markdown       | unified / remark + GFM, frontmatter, wiki-link extensions      |
| Search / index | Official SQLite WebAssembly build with FTS5, same on both OSes |
| Windows shell  | Tauri 2                                                        |
| Android shell  | Capacitor                                                      |
| Sync           | Syncthing (Syncthing-Fork on Android; official app discontinued) |

Portable use on a locked-down PC (no install, no admin rights) is covered
two ways: the single-file `Zeolite.html` opened in Edge/Chrome (folder access
through the File System Access API, last vault remembered), available now;
and later a portable `Zeolite.exe` from the Tauri build (no installer; uses the
WebView2 runtime that ships with Windows 10/11).

Rejected options:

- Pure PWA: Android browsers can't reliably reach a real folder, so notes
  would be trapped in browser storage.
- ProseMirror-based WYSIWYG editors: they rewrite Markdown on save.
- Electron: much larger install than Tauri.

The index is only a cache. It can always be deleted and rebuilt from the
`.md` files, which are the only source of truth.

## 3. Vault layout

```
vault/
├── 01 Projets/
├── 02 Areas/
├── 03 References/
├── 04 Archives/
├── Journal/            daily notes, e.g. Journal/2026-10-02.md
├── Inbox/              quick capture, no ID
├── attachments/        pasted / dropped images and files
├── _system/
│   └── Taxonomy.md     codes and tags (see docs/taxonomy.md)
└── .obsidian/          left untouched
```

Default (open to change): within each PARA folder, notes are stored flat and
not split into Sub-PARA subfolders, because the ID prefix already sorts them.

## 4. Editor and viewing

- Markdown editing: headings, bold, italic, strikethrough, highlight
  (`==text==`), bullet lists, numbered lists, quotes, inline code, code blocks
  with highlighting, tables, links, horizontal rules, footnotes.
- Modes: edit, read-only view, and split view. Live preview (syntax hidden
  while typing) comes in a later phase.
- Images: pasting or dropping copies the file into `attachments/` and inserts
  `![[name.png]]`. Standard `![](path)` is also supported.
- Table of contents:
  - a dynamic ```` ```toc ```` block, computed whenever the note renders;
  - a command that writes a static list of links into the note.
- Toolbar: at the top on Windows and above the keyboard on Android. It has
  formatting buttons plus the task and Attn buttons from section 7.

## 5. Obsidian compatibility

| Feature                                              | Status        |
| ---------------------------------------------------- | ------------- |
| `[[wiki links]]`, `[[note#heading]]`, `[[note\|alias]]` | Supported  |
| `![[embeds]]` (images, notes)                         | Supported     |
| YAML frontmatter properties                          | Supported     |
| Inline and frontmatter tags, nested tags (`#a/b`)     | Supported     |
| Callouts (`> [!note]`), highlights, comments (`%% %%`) | Supported    |
| Dataview inline fields (`key:: value`, `[key:: value]`) | Supported   |
| Dataview query blocks (subset, see §9)               | Supported     |
| `.obsidian/`, community plugins, Canvas              | Ignored, left untouched |

## 6. Note numbering

### 6.1 Identifier

`XX.YY.ZZ.NNN` = PARA . Category . Sub-PARA . Sequential. Codes come from
`_system/Taxonomy.md` ([docs/taxonomy.md](taxonomy.md)).

### 6.2 Creating a note

1. Press "New note" and choose a type: **PARA note**, **Journal**, **Inbox**
   or **Free note**.
2. For a PARA note, choose the PARA, then the Category, then the Sub-PARA
   (the list depends on the PARA), in the order of the ID `XX.YY.ZZ`.
3. The generator finds the highest existing `NNN` for that `XX.YY.ZZ` prefix
   and adds 1, giving `001` if there is none.
4. The file `01 Projets/01.02.05.001 Title.md` is created with:

   ```yaml
   ---
   id: 01.02.05.001
   tags: [Projets, SAS, Typhoon]
   created: 2026-10-02T14:31
   ---
   ```

### 6.3 Rules

- **IDs never change**, including when a note is archived.
- `NNN` restarts for each `XX.YY.ZZ` combination (001–999).
- Only PARA notes get an ID. Journal, Inbox and Free notes have none, and
  Free notes may use any filename.
- New notes can't be created with an ID under 04 Archives, which has no
  Sub-PARAs.
- **Archiving** moves the file to `04 Archives/` and adds `#Archives`. The ID
  and the other tags are kept.
- **Collisions:** two devices can create the same ID while offline. When the
  index detects a duplicate, the app offers to renumber the note with the
  later `created` timestamp, then updates links pointing to it.

### 6.4 Generator

Version 1 is driven entirely by the taxonomy note and templates, with no user
code. User scripts (Templater-like) are possible later, run in a sandbox.

### 6.5 Daily journal

`Journal/YYYY-MM-DD.md`, created from a template. This is the same format as
Obsidian's Daily Notes plugin.

## 7. Tasks and Attn points

Keywords are English only.

### 7.1 Tasks

A task is recognised only at the start of a list item.

| Syntax       | State     |
| ------------ | --------- |
| `- [ ] text` | open      |
| `- [x] text` | done      |
| `- [-] text` | cancelled |
| `- [>] text` | deferred  |

Fields on a task line:

- `[due:: 2026-10-15]` sets a deadline. Typed natural-language dates
  ("friday", "next week") are converted to ISO dates as you type.
- `[done:: 2026-10-02]` is added automatically when the task is marked done.
- `@person` sets an assignee. Autocomplete offers people already used in the
  vault.
- `#tag` attaches a tag.

Example:

```markdown
- [ ] Draft Typhoon report @alice #Typhoon [due:: 2026-10-15]
- [x] Send invoice [done:: 2026-10-02]
```

### 7.2 Attn points

Attn points mark something that needs attention.

```markdown
Attn:: Check budget with Alice @alice
- Meeting went well, but [Attn:: supplier delay on T601] needs follow-up
Attn:: Confirm venue [resolved:: 2026-10-03]
```

- An Attn point can be on its own line (`Attn:: …`) or inside a line
  (`[Attn:: …]`).
- `@person` is optional. Attn points have no due date.
- It can be resolved. Resolving adds `[resolved:: date]`, so the history
  stays in the file.
- It can be converted into a task: `Attn:: X` becomes `- [ ] X`.

### 7.3 Toolbar buttons

| Button                 | Action                                                     |
| ---------------------- | ---------------------------------------------------------- |
| ☐ Task                 | Inserts `- [ ] `, or turns the current line into a task    |
| 📅 Task with deadline  | Same, plus `[due:: …]` with a date picker                   |
| ✔ Toggle state         | Cycles open → done → cancelled → deferred; adds or removes `done::` |
| 👤 Assignee            | Inserts `@` with autocomplete                               |
| ⚠ Attn                 | Inserts `Attn:: `, or turns the current line into an Attn point |
| ⚠ → Resolve            | Adds or removes `[resolved:: date]`                         |
| ⚠ → Convert to task    | `Attn:: X` becomes `- [ ] X`                                |

## 8. Tag management

- A tag panel lists every tag with its note count. It is grouped by the
  taxonomy (PARA, Sub-PARA, Category) and also shows nested tags.
- Typing `#` in the editor opens autocomplete, with taxonomy tags first.
- A tag can be renamed or merged across the vault. The files are rewritten
  after a preview of the changes, and the taxonomy note is updated too.
- Consistency checks flag:
  - tags that aren't in the taxonomy (likely typos);
  - tags no note uses;
  - notes whose ID prefix doesn't match their tags.

## 9. Search and queries

### 9.1 Index

The index uses the official SQLite WebAssembly build, which includes FTS5. It
runs in the web view on both platforms.

- **Tables:** notes, ids, tags, tasks, attn, links, frontmatter fields.
- **Updates:** the index is built at startup, then updated incrementally when
  files change. Those changes come from file watching on Windows, and from
  rescanning on resume plus the app's own writes on Android.
- **Scale:** about 100 notes today, so a full rebuild takes under a second.
  The design comfortably handles thousands of notes.

### 9.2 Full-text search

There is a search panel with filters for path, tag, type, ID prefix and date,
plus a quick switcher that opens a note by title or ID.

### 9.3 Dataview-compatible queries

Queries use a subset of Dataview's own query language (DQL), so existing
query blocks keep rendering in both apps.

````markdown
```dataview
TASK
FROM #Typhoon
WHERE !completed AND due <= date(today) + dur(7 days)
SORT due ASC
GROUP BY file.link
```
````

Supported:

- **Query types:** `TASK`, `LIST` and `TABLE`.
- **Clauses:**
  - `FROM` with tags, folders, `[[links]]`, `AND`/`OR` and negation;
  - `WHERE`, `SORT`, `GROUP BY` and `LIMIT`.
- **Fields:**
  - `file.*` fields;
  - frontmatter properties;
  - inline fields, including `due`, `done`, `Attn` and `resolved`.
- **Functions:** a small set of common ones (`date`, `dur`, `contains`, …).

Ticking a checkbox in a query result writes the change back to the source
file.

The **query builder** (🔍 Query in the toolbar, or Search → Build a Dataview
query) generates these blocks from a form, so queries never have to be typed
by hand:

- **Find:** tasks, Attn points, notes or a table.
- **Where:** tags, folder, skip Archives, status, deadline, person, text, ID
  prefix and table columns.
- **Show:** sort, group and limit.

It shows the generated query (editable) with live results. The query can be
inserted at the cursor or saved as a search note in `Searches/`; saved
searches are listed in the Search tab.

Example of open Attn points:

````markdown
```dataview
LIST Attn
WHERE Attn AND !resolved
SORT file.mtime DESC
```
````

## 10. Sync and conflicts

- Syncthing syncs the vault folder. The app does no syncing itself.
- Files named `*.sync-conflict-*.md` are left out of the index and shown in a
  "Conflicts to resolve" list, with a side-by-side comparison.
- If a note changes on disk while it's open, the app reloads it silently when
  there are no unsaved edits. Otherwise it shows a warning and lets you choose
  which version to keep.

## 11. Phases

| Phase | Content | Estimate |
| ----- | ------- | -------- |
| 0 | **Android risk spike:** Capacitor app that opens a real folder, lists, reads and writes `.md` files, keeps permission across restarts, and works alongside Syncthing-Fork | 2–3 days |
| 1 | Core: Tauri + Capacitor shells, storage interface, file tree, CodeMirror editor, view and split modes, images, TOC | 2–3 weeks |
| 2 | Index and search: SQLite WASM, incremental indexing, search panel, quick switcher, tag panel | 1–2 weeks |
| 3 | Numbering: taxonomy parser, new-note dialog, generator, archiving, collision detection, journal | 1–2 weeks |
| 4 | Tasks and Attn: parser, toolbar buttons, date conversion, Dataview subset, writing ticks back from results | 2–3 weeks |
| 5 | Polish: live preview, tag rename/merge, consistency checks, conflict view, themes | ongoing |
| 6 | Local AI assistant (on request): see [ai-assistant.md](ai-assistant.md) | 3–8 weeks by step |

## 12. Decision log

| # | Topic | Decision |
| - | ----- | -------- |
| 1 | Platforms | Shared TS code; Tauri (Windows), Capacitor (Android) |
| 2 | Search | SQLite WASM with FTS5, identical on both platforms |
| 3 | Compatibility | Obsidian vault reuse; Dataview query subset |
| 4 | ID stability | IDs never change, including on archive |
| 5 | Sequence scope | `NNN` restarts per `XX.YY.ZZ` |
| 6 | Collisions | Detect; offer to renumber the note created last |
| 7 | Notes with ID | PARA notes only; Journal, Inbox, Free notes have none |
| 8 | Journal | `Journal/YYYY-MM-DD.md` |
| 9 | Archives | No Sub-PARAs; archiving moves to `04 Archives/` and adds `#Archives` |
| 10 | Deadline syntax | `[due:: date]` |
| 11 | Natural dates | Converted to ISO as you type |
| 12 | Task states | `[ ]` `[x]` `[-]` `[>]`, plus `@person` |
| 13 | Task position | Start of a list item only |
| 14 | Attn | Own line or inline; resolvable (`resolved::`); optional `@person`; convertible to task |
| 15 | Insertion | Tasks and Attn inserted through toolbar buttons |
| 16 | Language | English-only keywords and interface |
| 17 | Sync | Syncthing (Syncthing-Fork on Android) |
| 18 | Vault size | About 75–100 notes today |
| 19 | Local AI | Designed in [ai-assistant.md](ai-assistant.md); deferred until requested |
