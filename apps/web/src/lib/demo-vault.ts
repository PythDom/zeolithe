import taxonomy from "../../../../docs/taxonomy.md?raw";
import logo from "../../../../assets/logo/zeolite-icon.svg?raw";
import { TAXONOMY_PATH, toIsoDate, toIsoMinute } from "@zeolite/core";

/** A small in-memory vault so the app can be tried without opening a folder. */
export function demoVault(now = new Date()): Record<string, string | Blob> {
  const day = toIsoDate(now);
  const plus = (n: number) => toIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  const created = toIsoMinute(now);
  return {
    [TAXONOMY_PATH]: taxonomy,
    "attachments/zeolite-icon.svg": new Blob([logo], { type: "image/svg+xml" }),
    "Welcome.md": `---
created: ${created}
---
# Welcome to Zeolite

This is a **demo vault** kept in memory. Use **Open folder** to work on a real
vault (Chromium/Edge desktop for now; native Windows and Android apps next).

![[zeolite-icon.svg|96]]

\`\`\`toc
\`\`\`

## Writing

Markdown basics: *italic*, **bold**, ~~strike~~, ==highlight==, \`code\`,
[[01.02.05.001 F35 status review|wiki links]], #tags and @people.

> [!tip] Callouts
> Obsidian callouts render too.

## Tasks

Use the toolbar buttons, or type them:

- [ ] Open task
- [ ] Task with a deadline [due:: ${plus(3)}]
- [x] Finished task [done:: ${day}]
- [-] Cancelled task
- [>] Deferred task

Typing \`[due:: friday]\` converts the date to ISO as soon as you close the bracket.

## Attn points

Attn:: Something that needs attention @alice
- Inline form works too: [Attn:: check this sentence]

## Queries

Dataview blocks show live results. Press **🔍 Query** in the toolbar to build
one without writing it by hand.

\`\`\`dataview
TASK
WHERE status = " " AND due AND due <= date(today) + dur(7 days)
SORT due ASC
GROUP BY file.link
\`\`\`

## Numbering

**New note → PARA note** picks PARA, Sub-PARA and Category from
\`_system/Taxonomy.md\` and assigns the next \`XX.YY.ZZ.NNN\` ID.

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
folder: \`01 Projets\`, \`02 Areas\`, \`03 References\` (Resources) and
\`04 Archives\`. The Category and Sub-PARA numbers then refine where the note
belongs, and **Archive** moves a note to \`04 Archives\` in one click.
`,
    "01 Projets/01.02.05.001 F35 status review.md": `---
id: 01.02.05.001
tags: [Projets, SAS, F35]
created: ${created}
---
# F35 status review

## Actions

- [ ] Draft report for the program office @alice #F35 [due:: ${plus(5)}]
- [ ] Review supplier schedule [due:: ${plus(-1)}]
- [x] Send meeting minutes [done:: ${day}]

## Notes

Attn:: Budget overrun risk on lot 3 @bob
- Meeting went well, but [Attn:: supplier delay on T601] needs follow-up
`,
    "02 Areas/02.00.00.001 Weekly team meeting.md": `---
id: 02.00.00.001
tags: [Areas, General, Team_meetings]
created: ${created}
---
# Weekly team meeting

- [ ] Plan training sessions #Training [due:: ${plus(10)}]
- [ ] Update quality dashboard @carol

Attn:: Confirm room booking [resolved:: ${day}]
`,
    "_system/Templates/Journal.md": `---
tags: [Journal]
---
# {{date:dddd D MMMM YYYY}}

## Plan
- [ ] {{cursor}}

## Log

## Attn
`,
    "_system/Templates/Team_meetings.md": `---
type: meeting
---
# {{title}}

**{{id}}** · {{date:dddd D MMMM YYYY}}, {{time}} · #{{subpara}}

## Attendees
- @{{cursor}}

## Agenda
1.

## Decisions

## Actions
- [ ]
`,
    "_system/Templates/Project.md": `---
status: active
---
# {{title}}

\`\`\`toc
\`\`\`

## Goal

{{cursor}}

## Open actions

\`\`\`dataview
TASK
WHERE status = " " AND file.name = this.file.name
\`\`\`

## Notes
`,
    "02 Areas/02.50.50.001 Amazing Grace.md": `---
id: 02.50.50.001
tags: [Areas, Music, Guitartabs]
created: ${created}
---
# Amazing Grace

Traditional (John Newton, 1779). Use **♭ −1 / +1 ♯** to transpose, click a
diagram for another fingering, hover a chord to see its shape.

\`\`\`chords
[Verse 1]
G            G7        C       G
Amazing grace, how sweet the sound
G                      D
That saved a wretch like me
G          G7         C        G
I once was lost, but now am found
G        Em      D      G
Was blind, but now I see

[Verse 2, inline chords]
'Twas [G]grace that taught my [C]heart to [G]fear
And grace my fears re[D]lieved
\`\`\`

Ukulele, with a custom shape:

\`\`\`chords-ukulele
C      F      C      G7    Bbadd9[3213]
Amazing grace, how sweet the sound
\`\`\`
`,
    "Searches/Open Attn points.md": `---
created: ${created}
---
# Open Attn points

\`\`\`dataview
LIST Attn
FROM "" AND -"04 Archives"
WHERE Attn AND !resolved
GROUP BY file.link
\`\`\`
`,
    "Searches/Notes by ID.md": `---
created: ${created}
---
# Notes by ID

\`\`\`dataview
TABLE id, file.tags, created
WHERE id
SORT id ASC
\`\`\`
`,
    [`Journal/${day}.md`]: `---
tags: [Journal]
created: ${created}
---
# ${day}

- Started using Zeolite.
- [ ] Try the new-note dialog
`,
  };
}

/** Files written into an empty folder set up as a new vault: taxonomy, starter templates, a first note. */
export function starterVault(now = new Date()): Record<string, string> {
  const demo = demoVault(now);
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(demo)) {
    if (typeof content === "string" && (path === TAXONOMY_PATH || path.startsWith("_system/Templates/"))) out[path] = content;
  }
  out["Start here.md"] = `---
created: ${toIsoMinute(now)}
---
# Start here

This vault is a folder of plain Markdown files: Zeolite, Obsidian or any text
editor can open it, and Syncthing can keep it in sync.

- **＋ New note** creates numbered PARA notes (\`XX.YY.ZZ.NNN\`), journal, inbox or free notes.
- Your codes are in \`_system/Taxonomy.md\` (Tags → ⚙ Manage taxonomy).
- Templates are in \`_system/Templates/\` (📄 in the sidebar).

- [ ] Create my first note
`;
  return out;
}
