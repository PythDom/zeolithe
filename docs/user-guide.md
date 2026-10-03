# Zeolite user guide

> [!note] About this note
> The ❓ Help button writes this guide into your vault and opens it. It is
> rewritten each time, so keep your own notes elsewhere. You can delete it at
> any time.

```toc
```

## The basics

- Your **vault** is a plain folder of Markdown (`.md`) files. It works with
  Obsidian and syncs with Syncthing like any other folder.
- 📂 opens a vault folder. Zeolite reopens it by itself next time.
- Changes are **saved automatically** as you type.
- The top bar shows the open note. **Edit**, **Split** and **View** switch
  between the editor, editor plus preview, and the preview only (Ctrl+E
  toggles Edit/View).
- **←** and **→** in the top bar go back and forward between the notes you
  opened, like in a web browser (Alt+← / Alt+→).
- **✕** closes the note, **🗑** moves it to the vault's `.trash` folder.

## Creating notes

**＋ New note** (Ctrl+N) offers four kinds of notes:

| Kind | What it is |
| ---- | ---------- |
| PARA note | A numbered note `XX.YY.ZZ.NNN Title`: choose PARA, Category and Sub-PARA, Zeolite picks the next number. |
| Journal | Today's note in `Journal/YYYY-MM-DD.md` (also 📓). |
| Inbox | A quick note to sort later. |
| Free note | Any name, any folder, no number. |

A **template** is suggested when one fits; 📄 in the sidebar manages
templates.

IDs never change. Click the **ID badge** in the top bar to change it on
purpose, or **＋ Assign ID** to number a free note. **Archive** moves a
note to `04 Archives` and tags it `#Archives`.

## Organising notes

- **Rename or move:** click the note's path in the top bar (or press F2).
- **Move by drag & drop:** drag a note from the Files list onto a folder,
  or onto "vault root" below the list.
- **New folder:** 📁＋ New folder at the top of the Files list, or ＋ next to
  a folder for a sub-folder. `Projects/2026` creates both levels.
- **Delete a folder:** 🗑 next to its name; everything goes to `.trash`.
- Links to a note are **updated automatically** when it is renamed or moved.

## Writing

The toolbar formats the line or the selection: headings, **bold**,
*italic*, ~~strikethrough~~, ==highlight==, `code`, lists, quotes, tables.

- **Images:** paste or drop them into the editor.
- **Tags:** `#tag`. Typing `#` suggests existing tags.
- **People:** `@name`. Typing `@` suggests people already mentioned.
- **Table of contents:** **TOC** inserts one that updates itself, **TOC⇣**
  writes a fixed one.

### Links between notes

Press **[[ ]]** in the toolbar (or Ctrl+K): search a note by name, title,
ID or folder, choose an optional heading or display text, then **Insert
link**. Typing `[[` in the editor also suggests notes.

| Write | Result |
| ----- | ------ |
| `[[Note]]` | link to a note |
| `[[Note#Heading]]` | link to a heading in that note |
| `[[Note\|text]]` | link shown as "text" |
| `![[image.png]]` | show an image |
| `![[Note]]` | show another note inside this one |

A grey link points to a note that does not exist yet: clicking it creates
the note.

## Tasks

Tasks are list items starting with a box:

```markdown
- [ ] open task
- [x] done
- [-] cancelled
- [>] deferred
- [ ] call the supplier @Anna [due:: 2026-10-15]
```

- **☐ Task** turns the line into a task, **✔ State** cycles its state.
- **📅 Due** adds a deadline. You can type "friday", "next week" or
  "in 3 days": Zeolite writes the date as `2026-10-15`.
- Tick tasks directly in the preview.
- The **Tasks** tab lists every open task, soonest deadline first.

## Attn points

An Attn point marks something to keep an eye on:

```markdown
Attn:: the budget must be approved before the review @Marc
Inline form: [Attn:: check the drawings]
```

The **⚠ Attn** button inserts one, resolves it (adds `[resolved:: date]`)
or converts it to a task. Open Attn points are listed in the Tasks tab.

## Searching

- The **Search** tab searches all notes. Click a tag in the **Tags** tab to
  find its notes.
- **🔍 Query** (Ctrl+Shift+Q) builds a Dataview query with a form: tasks,
  lists or tables of notes, filtered by tag, folder, date or person. Insert
  it in a note, or save it as a search note in `Searches/`. The results are
  live.

## Numbering and taxonomy

Numbers follow `PARA.Category.Sub-PARA.Sequence`, defined in
`_system/Taxonomy.md`. Manage it from **Tags → ⚙ Manage taxonomy**. If two
notes end up with the same ID (for instance after a sync), Zeolite warns
you and offers to renumber the newer one.

## Chord sheets

Put songs in a ` ```chords ` block, with chords above the lyrics or inline
in `[brackets]`. In the preview: chord diagrams, ♭/♯ to transpose, ▶
autoscroll for playing, and PDF export with aligned chords.

## PDF export

**PDF** in the top bar (Ctrl+P) exports the note or its whole folder, with
a clickable table of contents and page numbers.

## Keyboard shortcuts

| Keys | Action |
| ---- | ------ |
| Ctrl+N | New note |
| Ctrl+K | Insert a link |
| Ctrl+E | Switch between Edit and View |
| Ctrl+P | Export to PDF |
| Ctrl+Shift+Q | Query builder |
| F2 | Rename or move the note |
| Alt+← / Alt+→ | Back / forward |
| F1 | This guide |

## Using your Obsidian vault

Nothing needs converting: open the vault folder with 📂. Zeolite follows
Obsidian's settings for templates, daily notes and attachments. The only
Zeolite-specific file is `_system/Taxonomy.md`, needed for numbering.
