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
logo is a rough crystal, like a stone just picked up.

## The PARA method

PARA, proposed by Tiago Forte, sorts information by **how actionable it is**,
not by subject. Everything fits in four places:

| | What goes there | Example |
| --- | --- | --- |
| **Projects** | Short efforts with a goal and an end date | Prepare the New transistor review |
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
- **Tabs**, like in Obsidian: clicking a note in the Files list replaces
  the note of the current tab. To keep it and open another one, press
  **＋** in the tab bar, then pick the note (or Ctrl+click it in the Files
  list). **✕** on a tab closes it; ← and → work within each tab. Open tabs
  come back when you reopen the vault.
- Drag the edge of the sidebar, or the separator between editor and
  preview in Split view, to resize them (double-click: back to default).
- **«** at the top of the left panel (or Ctrl+\\) hides it for more room;
  **☰** (top left of the note) shows it again. On phones, ☰ opens it as a menu.
- One Enter is a new line; leave an empty line to start a new paragraph.
- On Android, the system back key closes an open window or the menu;
  press it twice to close Zeolite.

## Creating notes

**＋ New note** (Ctrl+N) offers five kinds of notes:

| Kind | What it is |
| ---- | ---------- |
| PARA note | A numbered note `XX.YY.ZZ.NNN Title`: choose PARA, Category and Sub-PARA, Zeolite picks the next number. |
| One-on-One | A meeting note with one of your direct reports, numbered `02.02.01.NNN` (see below). |
| Journal | Today's note in `Journal/YYYY-MM-DD.md` (also 📓). |
| Inbox | A quick note to sort later. |
| Free note | Any name, any folder, no number. |

**＋ New** next to PARA, Category and Sub-PARA adds a value to the
taxonomy without leaving the dialog: type the tag (the code is proposed;
for a PARA, optionally its folder) and press **Add**. A new PARA appears
in the list once it has a Sub-PARA.

A **template** is suggested when one fits; 📄 in the sidebar manages
templates.

**Journal:** a new entry ends with a **Past notes** section listing what
is still open in the other entries: open actions, decisions to take, open
Attn points. The lists are live: tick an old action there and it is ticked
in its own entry.

### One-on-one meetings

1. **＋ New note → One-on-One**, choose the **Person** (**＋ New** adds
   someone, with an optional e-mail address for ✉), **Create**.
2. The note is named `02.02.01.NNN 2026-10-09 Anna Smith`, titled
   `# 2026-10-09 Anna Smith-DZ`, and tagged with the taxonomy tags and
   `#Anna_Smith`.
3. It ends with **Past meetings**: open actions, decisions to take and
   open Attn points from the other one-on-ones with the same person (live,
   as for the journal).

The layout comes from the template `_system/Templates/One-on-One.md`,
written with the first meeting note: edit it to change the sections or the
title (`{{date}}`, `{{person}}`, `{{persontag}}` are filled in). The ID
prefix and the list of people (names, e-mails) are in **⚙ Settings → One-on-one
meetings**.

**👥 One-on-one dashboard** (top of the Tasks tab) shows, for each person:
open actions, Attn points, decisions to take, recent decisions and
meetings. It covers their one-on-ones and anything assigned to them with
`[owner:: Name]` in any note. **Save as note** keeps it as a note in
Searches.

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
- **Collapse all / Expand all** (next to New folder) folds or opens every
  folder at once; Zeolite remembers which folders are folded.
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
- **People:** `@name` mentions someone. To *assign* a task, use **👤
  Owner** instead (see Tasks).
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
| `![[Note]]` | show another note inside this one (`![[Note#Heading]]`: one section) |

A grey link points to a note that does not exist yet: clicking it creates
the note.

## Tasks

Tasks are list items starting with a box:

```markdown
- [ ] open task
- [x] done
- [-] cancelled
- [>] deferred
- [ ] call the supplier [owner:: Anna] [due:: 2026-10-15]
```

- **☐ Task** turns the line into a task, **✔ State** cycles its state.
- **📅 Due** adds a deadline. You can type "friday", "next week" or
  "in 3 days": Zeolite writes the date as `2026-10-15`.
- **👤 Owner** assigns the line to a person: it writes `[owner:: Anna]`
  (pick a name already used, or type a new one). Plain lines become tasks;
  Attn points and decisions can have an owner too. Inside `[owner:: ` the
  editor suggests known names. Dataview finds them, in Zeolite and in
  Obsidian: `TASK WHERE owner = "Anna"`. The query builder's **Person**
  filter uses it (and still finds older `@Anna` mentions).
- Tick tasks directly in the preview.
- The **Tasks** tab lists every open task, soonest deadline first, with
  its owner.

## Attn points

An Attn point marks something to keep an eye on:

```markdown
Attn:: the budget must be approved before the review [owner:: Marc]
Inline form: [Attn:: check the drawings]
```

The **⚠ Attn** button inserts one, resolves it (adds `[resolved:: date]`)
or converts it to a task. Open Attn points are listed in the Tasks tab.

## Decisions

Two markers keep track of decisions:

```markdown
Decide:: choose the supplier for lot 3 [owner:: Marc]
Decision:: keep the current supplier [decided:: 2026-10-05]
Inline form: we agreed to [Decision:: freeze the design] [decided:: 2026-10-05]
```

- **❓ Decision rqd** turns the current line into `Decide::`: a decision
  still to take.
- **⚖ Decision** records it: `Decide::` becomes `Decision::` with today's
  date. On a plain line it writes a decision taken today.

Decisions still to take are listed in the Tasks tab. **🔍 Query → ⚖
Decisions** lists them across notes (`LIST Decide` or `LIST Decision`), for
example all the decisions taken in a project.

## Searching

- The **Search** tab searches all notes. Click a tag in the **Tags** tab to
  find its notes.
- **🔍 Query** (Ctrl+Shift+Q) builds a Dataview query with a form: tasks,
  Attn points, decisions, lists or tables of notes, filtered by tag, folder, date or person. Insert
  it in a note, or save it as a search note in `Searches/`. The results are
  live.

## Related notes and AI

The **Related** tab (left panel) shows, for the open note:

- **Mentioned here, not linked**: other notes whose title appears in this
  note as plain text. **🔗 Link** turns the text into a link.
- **Notes naming this one**: notes that write this note's title without
  linking it; **🔗 Link** links them.
- **Related notes**: notes about the same things (shared rare words, and
  meaning when enabled). **＋** inserts a link at the cursor.
- **Possible duplicates** (with meaning on) and **suggested tags** (tags
  of closely related notes; click to add).
- **Search by meaning** (or by words when meaning is off), and the list of
  **notes with no links**.

**Meaning** (⚙ Settings → AI, per device): *On this device* downloads a
small model once (from huggingface.co); it runs on the device and nothing
leaves it. Choose the model under **Model on this device**: Multilingual E5
small (120 MB, the default, French and English), Multilingual MiniLM
(faster), Multilingual E5 base (better, 280 MB), MiniLM (English only,
23 MB), BGE-M3 (best, 570 MB), or any other Transformers.js model by its
Hugging Face ID. Changing the model re-indexes the vault. *From the AI server* asks your server
instead (useful when a work PC blocks the download). The index is kept per
device in `.zeolite/` and only changed sections are re-read.

**AI server** (optional, ⚙ Settings → AI): Ollama (or any OpenAI-compatible
server) on your Docker server or PC. The Related tab then offers
**Summarise**, **Review**, **Find actions** (as tasks you can insert) and
**Ask your notes** (answers from your most relevant notes, with the
sources linked). Notes go only to that server.

To run Ollama on the Docker server: `docker run -d -p 11434:11434 -e
'OLLAMA_ORIGINS=*' -v ollama:/root/.ollama ollama/ollama`, then `docker exec
<container> ollama pull llama3.2` (chat) and `ollama pull nomic-embed-text`
(meaning). In Zeolite: server `http://<server>:11434`, type Ollama, **Test
the server**.

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

## Sending a note by e-mail

**✉** in the top bar sends the note as it looks in the preview (query
results included). The recipient is proposed for a one-on-one (the
person's e-mail from Settings).

- **Windows app: Create the message** opens a new formatted message in
  Outlook (or Windows Mail): check it and press Send.
- **Open in mail app** (Android, browser): the note as plain text. Very
  long notes are cut: then use the next option.
- **Copy formatted**: paste the note with its formatting into any mail
  (Ctrl+V).

## Syncing your PC, phone and tablet

Zeolite can keep the same vault on all your devices through a folder on
your own server (for example a Docker server at home) or in **OneDrive**
(see "Syncing through OneDrive" below). Each device keeps a full copy of
the notes, works offline, and exchanges its changes with the server.

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
2. In the sidebar, press **⇅ Set up sync…**.
3. Enter the address, user name and password.
4. Press **Test connection**: it should say "Connected" (the first time:
   "the sync folder … has been created").
5. Press **Save and sync**. The sidebar shows "… sent" when it is done.

### Step 4 – Phone or tablet (Android)

1. Install `Zeolite-android.apk` (allow "install unknown apps" once).
2. Open Zeolite and press 📂. The first time, allow **All files access**
   in the Android settings screen that opens, then come back. It is a
   *special* access: the app's **Permissions** page shows nothing to grant.
   If needed, find it in **Settings → Apps → Special app access → All files
   access → Zeolite** (Samsung: **Apps → ⋮ → Special access**).
3. In the folder browser, go to a place such as **Documents**, press
   **＋ New folder**, name it (for example `Zeolite`), then press
   **Use "Zeolite"**.
4. Zeolite says the folder is empty: press **Keep it empty** (do **not**
   choose "Set up the vault": your notes come from the server).
5. Press **⇅ Set up sync…**, enter the **same** address, user
   name and password, then **Save and sync**. All your notes arrive
   ("… received").

Tablets work the same way. (iPad is not supported.)

### Step 5 – Another PC (home or work)

1. Use `Zeolite.exe` (no installation needed) or `Zeolite.html` opened in
   Edge or Chrome.
2. Create an **empty** folder for the vault, for example
   `Documents\Zeolite`, and open it with 📂. Choose **Keep it empty**.
3. **⇅ Set up sync…** with the same address, user name and
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

### Syncing directly over Wi-Fi (no server)

Two devices on the same Wi-Fi (or on a phone's hotspot) sync directly: one
**shares** its vault, the other connects to it. No server, no internet.

**Which device shares?** Usually the **phone or tablet**: it needs no
permission. A Windows PC can share too, but Windows Firewall then asks to
allow Zeolite, which needs **administrator rights** (often not available
on a work PC).

1. **On the sharing device** (phone, tablet, or PC): open the vault, **⇅ →
   Share this vault**. Zeolite shows the **address** (e.g.
   `192.168.1.37:47123`; several if the device has more than one network)
   and a **pairing code**.
2. **On the other device**: open the vault (a new device: an empty folder,
   **Keep it empty**), **⇅ → Another device on this Wi-Fi**, enter the
   address exactly as shown and the code (dashes and case do not matter),
   **Save and sync**.

Keep Zeolite open on the sharing device while the other one syncs. It
shares again whenever the vault is opened there (**Stop sharing** ends it).
Changes arrive on the sharing device at once; if the same note was being
edited there, the other version is kept as a conflict copy. Notes deleted
on one device go to the `.trash` folder of the other, so nothing is lost.
**New code**
replaces the pairing code. After 20 wrong codes, sharing stops until you
start it again.

**If the other device cannot connect:**

- Check the address: the one shown by Zeolite on the sharing device (or
  the Wi-Fi "IPv4 address" from `ipconfig` on a PC), with `:47123`.
- Open `http://<address>:47123/zeolite/v1/info` in the other device's
  browser: "Wrong pairing code" means the network is fine; no answer means
  the network or a firewall blocks it.
- A sharing Windows PC: allow Zeolite when Windows asks (administrator), or
  share from the phone or tablet instead.
- Company or guest Wi-Fi often keeps devices apart: use a phone's hotspot.

### Syncing through OneDrive

Instead of your own server, the vault can sync with a folder in your
OneDrive. Zeolite talks to OneDrive itself: no OneDrive app is needed on
the phone or tablet.

**Once: register Zeolite with Microsoft** (free, about 5 minutes). Zeolite
needs an "application ID" to be allowed to use OneDrive:

1. Open **entra.microsoft.com** (or portal.azure.com) and sign in with
   your Microsoft account.
2. **App registrations → New registration**. Name: `Zeolite`. Supported
   account types: **Accounts in any organizational directory and personal
   Microsoft accounts**. Leave the redirect URI empty. **Register**.
3. Copy the **Application (client) ID** shown on the app's page (keep it:
   every device uses the same one).
4. **Authentication → Allow public client flows → Yes → Save.**

**On each device** (Windows or Android app; a web browser cannot sign
in):

1. Open the vault (on a new device: an empty folder, **Keep it empty**).
2. **⇅ Set up sync… → OneDrive.** Folder in your OneDrive: for example
   `Zeolite/My notes` (created if missing). Paste the application ID.
3. **Sign in to Microsoft…** shows a code. Press **Open the Microsoft
   page** (or open microsoft.com/devicelogin on any device), enter the
   code and sign in. Zeolite then shows "Signed in as …".
4. **Save and sync.**

The sign-in is remembered on the device; Zeolite renews it by itself.
Everything else works as with your own server: conflict copies,
deletions to `.trash`, automatic syncs.

Work or school accounts: your organisation may block apps it has not
approved. If sign-in says an administrator must approve, ask your IT
team, or use your personal OneDrive.

| Problem | Solution |
| ------- | -------- |
| "does not recognise this application ID" | Check the ID, and that the registration allows personal accounts. |
| "must allow public client flows" | Step 4 of the registration. |
| "sign-in expired" | ⇅ dialog → **Sign in to Microsoft…** again. |
| "not possible from a web page" | Set up OneDrive sync in the Windows or Android app. |

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
| Ctrl+\\ | Hide or show the left panel |
| Ctrl+P | Export to PDF |
| Ctrl+Shift+Q | Query builder |
| F2 | Rename or move the note |
| Alt+← / Alt+→ | Back / forward (in the current tab) |
| Ctrl+T / Ctrl+W / Ctrl+Tab | New tab / close tab / next tab (Windows app) |
| F1 | This guide |

## Using your Obsidian vault

Nothing needs converting: open the vault folder with 📂. Zeolite follows
Obsidian's settings for templates, daily notes and attachments. The only
Zeolite-specific file is `_system/Taxonomy.md`, needed for numbering.
