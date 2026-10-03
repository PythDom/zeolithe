# Zeolite user guide

> [!note] About this note
> The ❓ Help button writes this guide into your vault and opens it. It is
> rewritten each time, so keep your own notes elsewhere. You can delete it at
> any time.

```toc
```

## Why “Zeolite”?

A zeolite is a mineral. Its name, given in 1756 by the Swedish chemist
Axel Cronstedt, comes from the Greek *zeō* (to boil) and *lithos* (stone):
when he heated the crystal, it released steam, as if the stone were boiling.

Zeolites are made of a regular framework of tiny cavities, which catch and
sort molecules by size; they are used as filters and “molecular sieves”.
That is the idea behind the app: a solid, orderly structure where every note
finds its place, and where you can sort and filter what you collect. The
logo is a rough crystal, like a stone just picked up. (The project's first
name, *zeolithe*, is the French spelling.)

## The PARA method

PARA, proposed by Tiago Forte, sorts information by **how actionable it is**,
not by subject. Everything fits in four places:

| | What goes there | Example |
| --- | --- | --- |
| **Projects** | Short efforts with a goal and an end date | Prepare the F35 review |
| **Areas** | Ongoing responsibilities, with a standard to keep, no end date | Team management, health, finances |
| **Resources** | Topics and references you may need later | Aviation, chords, recipes |
| **Archives** | Anything no longer active, from the three others | Finished projects |

Notes move as their status changes: a finished project goes to the
Archives, a resource becomes part of a project when you start using it.
The question to ask is never “what is this about?” but “where will I need
it?”.

In Zeolite, the four PARA are the first number of a note's ID and its
folder: `01 Projets`, `02 Areas`, `03 References` (Resources) and
`04 Archives`. The Category and Sub-PARA numbers then refine where the note
belongs, and **Archive** moves a note to `04 Archives` in one click.

## The basics

- **Windows app:** `Zeolite.exe` keeps its settings (last vault, chosen
  folders, sync settings including the password) in a `Zeolite-data`
  folder next to it, and nothing elsewhere: copy both to a USB key to take
  Zeolite with you, delete both to remove it. (If the exe's folder is
  read-only, the settings go to the usual Windows profile folder instead.)

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

IDs never change by themselves. To change one on purpose, click the **ID
badge** in the top bar: choose PARA, Category and Sub-PARA, and the
**Number** (the last three digits, the next free one is proposed; a number
already used is refused). Links to the note are updated. **＋ Assign ID**
numbers a free note the same way. **Archive** moves a note to
`04 Archives` and tags it `#Archives`.

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
- **Attachments** (images, PDFs, documents) are listed in the Files panel
  under their folder, after the notes. Click one to view it (images), see
  which notes use it, link it in the open note, or open it with its usual
  app (Windows app).
- **Tags:** `#tag`. Typing `#` suggests existing tags.
- **People:** `@name`. Typing `@` suggests people already mentioned.
- **Table of contents:** **TOC** inserts one that updates itself, **TOC⇣**
  writes a fixed one. Click an entry to jump to that heading, in the
  preview as well as in the editor (where the TOC shows a clickable
  contents list); **←** brings you back.

### Links between notes

Press **[[ ]]** in the toolbar (or Ctrl+K): search a note by name, title,
ID or folder, choose an optional heading or display text, then **Insert
link**. Typing `[[` in the editor also suggests notes. In the editor,
**Ctrl+click** a link to follow it (in the preview, a simple click). Web
addresses open in your browser the same way.

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

## Syncing your PC, phone and tablet

Zeolite can keep the same vault on all your devices through a folder on
your own server (for example a Docker server at home). Each device keeps
a full copy of the notes, works offline, and exchanges its changes with
the server.

```
   PC (Zeolite.exe) ─┐
 Work PC (portable) ─┼──  your server (WebDAV folder)
 Phone / tablet ─────┘
```

You set it up once on the server, then once on each device.

### Step 1 – Start the server (once)

On the Docker server:

1. Copy the folder `server/webdav` from the Zeolite repository (it holds
   two files, `compose.yml` and `config.yml`). The ⇅ dialog in Zeolite
   also shows both files, ready to copy.
2. In `config.yml`, replace the user name `me` and the password
   `change-this-password` with your own.
3. In that folder, run `docker compose up -d`.
4. Check it: open `http://<server>:6065/` in a browser and log in. You
   should see a page (an empty listing or some XML).

Your notes will be stored as normal `.md` files in the `vault` folder
next to `compose.yml`: back that folder up with the rest of your server.

### Step 2 – Choose the address

All devices must use **exactly the same address**. It ends with a folder
name for the vault (`zeolite/` below); Zeolite creates that folder.

| Your devices reach the server… | Address |
| ------------------------------ | ------- |
| only at home | `http://192.168.1.20:6065/zeolite/` (your server's address) |
| also away from home, through your HTTPS reverse proxy | `https://dav.example.com/zeolite/` |
| also away from home, through Tailscale or another VPN | `http://<server-name>:6065/zeolite/` |

Away from home, always use **https** or a VPN, otherwise your password
travels unencrypted.

### Step 3 – The first device: the one with all your notes

Usually your main PC.

1. Open Zeolite and your vault (📂).
2. In the sidebar, press **⇅ Sync with your server…**.
3. Enter the address, user name and password.
4. Press **Test connection**: it should say "Connected" (the first time:
   "the sync folder … has been created").
5. Press **Save and sync**. The sidebar shows "… sent" when it is done.

### Step 4 – Phone or tablet (Android)

1. Install `Zeolite-android.apk` (allow "install unknown apps" once).
2. Open Zeolite and press 📂. The first time, allow **All files access**
   in the Android settings screen that opens, then come back.
3. In the folder browser, go to a place such as **Documents**, press
   **＋ New folder**, name it (for example `Zeolite`), then press
   **Use "Zeolite"**.
4. Zeolite says the folder is empty: press **Keep it empty** (do **not**
   choose "Set up the vault": your notes come from the server).
5. Press **⇅ Sync with your server…**, enter the **same** address, user
   name and password, then **Save and sync**. All your notes arrive
   ("… received").

Tablets work the same way. (iPad is not supported.)

### Step 5 – Another PC (home or work)

1. Use `Zeolite.exe` (no installation needed) or `Zeolite.html` opened in
   Edge or Chrome.
2. Create an **empty** folder for the vault, for example
   `Documents\Zeolite`, and open it with 📂. Choose **Keep it empty**.
3. **⇅ Sync with your server…** with the same address, user name and
   password, then **Save and sync**.

At work, test the address in the browser first: company networks often
block other servers. If it is blocked, use the VPN address, or keep
Syncthing on that PC instead.

### Every day

- Nothing to do: Zeolite syncs when it opens the vault, every 5 minutes
  (change it in the ⇅ dialog), and when you switch to another app. Press
  **⇅ Sync** in the sidebar to sync right away, for example before
  closing the laptop.
- The text next to ⇅ Sync shows the last result, for example
  "14:05: 2 received". Red text means a problem: click it to see the
  settings and test the connection.
- Without network, keep working: changes are sent at the next sync.
- **The same note edited on two devices** before they synced: both
  versions are kept. Yours stays the note; the other one appears at the
  top of the Files list as "⇄ Sync conflict: … .sync-conflict-…". Open
  it, copy what you need into the note, then delete the conflict copy.
- **A note deleted** on one device is deleted on the others too, but goes
  to the vault's `.trash` folder there, so it can be recovered. If a sync
  would delete many notes at once, Zeolite asks first; when in doubt
  choose **Keep them**.

### Good to know

- Coming from Syncthing: once every device syncs with the server, stop
  syncing this vault folder in Syncthing (two sync systems on the same
  folder can create needless conflict copies).
- One server folder per vault. For a second vault, use another address
  ending, for example `…/work-notes/`.
- The sync settings (password included) are stored on each device only.
  **Stop syncing** in the ⇅ dialog removes them; your notes stay.
- Not synced: Obsidian's settings folder (`.obsidian`), `.trash`, and
  empty folders (a folder appears on the other devices with its first
  note).

| Problem | Solution |
| ------- | -------- |
| "Cannot reach …" | Check the address (http/https, port 6065, the final `/`), the network or VPN, and that the container runs. |
| "refused the user name or password" | Check `users` in `config.yml`, then restart the container (`docker compose restart`). |
| "does not allow this" | In `config.yml`, `permissions: CRUD`. |
| Notes missing on a new device | Check that it uses exactly the same address, then press ⇅ Sync. |

## Sharing a vault with colleagues (SharePoint, OneDrive, Syncthing)

Several people can work in the same vault when its folder is synced by
another app, for example a SharePoint library synced with OneDrive:

1. In SharePoint (or the Files tab of a Teams channel), open the library
   and press **Sync** (or **Add shortcut to My files**).
2. In Zeolite, press 📂 and choose that folder (it appears under your
   company's name in File Explorer).
3. Each colleague does the same on their PC.

> [!note] Switch it on first
> These checks are off by default: turn on **⚙ Settings → This device →
> Notice changes made by other apps or people**. While off, reopen the
> vault (📂) to see colleagues' changes, and avoid working on the same
> notes at the same time.

When switched on, Zeolite notices files changed by others within a few
seconds, while its window is active:

- new, changed and deleted notes appear in the Files list;
- the open note is updated on screen if you have not changed it;
- if you were editing the same note at the same time, nothing is lost:
  your version stays the note and the other one is kept next to it as a
  conflict copy (`….sync-conflict-…-OTHER.md`).

OneDrive's own conflict copies (`Note-COMPUTERNAME.md`) are recognised
too. All conflict copies are listed at the top of the Files panel: open
the copy, merge what you need into the note, then delete the copy.

Tips: avoid editing the same note at the same moment; let one person
maintain `_system/Taxonomy.md`; if two people create a note in the same
series at once, Zeolite warns about the duplicate number and offers to
renumber the newer note.

## Settings

**⚙** next to the Zeolite title opens the settings.

- **This vault** (the same on every device): the folder of each PARA
  (optionally renaming the existing folders with their notes), where pasted
  images and files go, the journal's folder, date format and template, and
  the folders for templates, Inbox notes, saved searches and PDF exports.
  Attachments, templates and journal settings are shared with Obsidian.
- **This device**: theme (light, dark or like the system), text size, the
  view notes open in, and whether Zeolite watches for changes made by other
  apps or people in a shared folder.

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
