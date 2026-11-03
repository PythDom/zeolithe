# Taxonomy

This file defines the codes used to build note identifiers. In the final app
it lives in the vault as `_system/Taxonomy.md` and is parsed at startup: edit
a table here to add a PARA, Sub-PARA or Category. It is an ordinary note, so it
also renders normally in Obsidian.

## Identifier format

```
XX . YY . ZZ . NNN
│    │    │    └── Sequential number, restarts for each XX.YY.ZZ combination (001–999)
│    │    └─────── Sub-PARA, meaning depends on XX (see tables below)
│    └──────────── Category, shared by all PARAs
└───────────────── PARA
```

Example: `01.02.05.001` → #Projets / #SAS / #Typhoon / first note.

Parsing rules:

- Each table row is `| code | #tag |`. Codes are two digits.
- Empty codes are simply not listed; gaps are allowed.
- Tags follow Obsidian rules (letters, digits, `_`, `-`, `/`; not purely numeric).

## PARA (XX)

| Code | Tag          | Folder          |
| ---- | ------------ | --------------- |
| 01   | #Projets     | `01 Projets/`   |
| 02   | #Areas       | `02 Areas/`     |
| 03   | #References  | `03 References/`|
| 04   | #Archives    | `04 Archives/`  |

## Categories (YY)

| Code | Tag         |
| ---- | ----------- |
| 00   | #General    |
| 01   | #Exec       |
| 02   | #SAS        |
| 03   | #SES        |
| 04   | #Space      |
| 05   | #Systems    |
| 06   | #Programs   |
| 07   | #Defense    |
| 08   | #Bids       |
| 09   | #AAM        |
| 10   | #Training   |
| 11   | #Quality    |
| 13   | #Sonair     |
| 50   | #Music      |
| 51   | #Literature |
| 52   | #IT         |
| 53   | #FSM        |
| 54   | #Cinema     |
| 55   | #Finance    |
| 99   | #Personal   |

## Sub-PARA (ZZ)

### 01 Projets

| Code | Tag          |
| ---- | ------------ |
| 00   | #Budget      |
| 01   | #Repairs     |
| 02   | #SOFAIR      |
| 03   | #PC-XX       |
| 04   | #Wisk        |
| 05   | #Typhoon     |
| 06   | #Planview    |
| 07   | #T601        |
| 50   | #Liquidation |
| 51   | #Mariages    |

### 02 Areas

| Code | Tag                   |
| ---- | --------------------- |
| 00   | #Team_meetings        |
| 01   | #One-on-One_Meetings  |
| 02   | #HR                   |
| 03   | #Plans                |
| 50   | #Guitartabs           |

### 03 References

| Code | Tag         |
| ---- | ----------- |
| 00   | #Notes      |
| 01   | #Lists      |
| 50   | #Quotes     |
| 51   | #Tablet     |
| 52   | #Linux      |
| 53   | #Software   |
| 54   | #Analyses   |
| 55   | #Docker     |

### 04 Archives

No Sub-PARAs. Archiving a note moves it to `04 Archives/` and adds the
`#Archives` tag; its identifier is unchanged.

## Changes from the original table

- `#Progams` corrected to `#Programs`.
- Placeholder rows (`XX.`, repeated `55.`) and empty codes removed.
- The combined table was split into one table per axis, so it can be parsed
  without ambiguity.
