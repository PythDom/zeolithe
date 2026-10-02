import { describe, expect, it } from "vitest";
import {
  convertAttnToTask,
  convertDueFields,
  cycleTaskStatus,
  makeAttn,
  makeTask,
  parseAttnPoints,
  parseTasks,
  setDue,
  toggleAttnResolved,
  toggleTaskDone,
} from "../src/tasks";

const today = new Date(2026, 9, 2);

describe("parseTasks", () => {
  const md = [
    "---",
    "tags: [x]",
    "---",
    "- [ ] Draft F35 report @alice #F35 [due:: 2026-10-15]",
    "- [x] Send invoice [done:: 2026-10-02]",
    "  1. [-] Old idea",
    "* [>] Book venue",
    "Not a task [ ] here",
    "```",
    "- [ ] in code",
    "```",
  ].join("\n");
  const tasks = parseTasks(md);

  it("finds tasks only at the start of list items, outside code", () => {
    expect(tasks.map((t) => t.status)).toEqual(["open", "done", "cancelled", "deferred"]);
  });
  it("extracts fields, assignees and tags", () => {
    expect(tasks[0]).toMatchObject({
      line: 3,
      text: "Draft F35 report @alice #F35",
      due: "2026-10-15",
      assignees: ["alice"],
      tags: ["F35"],
    });
    expect(tasks[1]!.done).toBe("2026-10-02");
  });
});

describe("task transforms", () => {
  it("makeTask converts plain, list and numbered lines", () => {
    expect(makeTask("Call supplier")).toBe("- [ ] Call supplier");
    expect(makeTask("  - Call supplier")).toBe("  - [ ] Call supplier");
    expect(makeTask("3. Call")).toBe("3. [ ] Call");
    expect(makeTask("")).toBe("- [ ] ");
    expect(makeTask("- [x] done")).toBe("- [x] done");
  });
  it("cycles open → done → cancelled → deferred → open", () => {
    let l = "- [ ] Task";
    l = cycleTaskStatus(l, today);
    expect(l).toBe("- [x] Task [done:: 2026-10-02]");
    l = cycleTaskStatus(l, today);
    expect(l).toBe("- [-] Task");
    l = cycleTaskStatus(l, today);
    expect(l).toBe("- [>] Task");
    l = cycleTaskStatus(l, today);
    expect(l).toBe("- [ ] Task");
  });
  it("toggles done from the preview", () => {
    expect(toggleTaskDone("- [ ] A", today)).toBe("- [x] A [done:: 2026-10-02]");
    expect(toggleTaskDone("- [x] A [done:: 2026-10-02]", today)).toBe("- [ ] A");
  });
  it("sets and converts due dates", () => {
    expect(setDue("Report", "2026-10-15")).toBe("- [ ] Report [due:: 2026-10-15]");
    expect(setDue("- [ ] Report [due:: 2026-01-01]", "2026-10-15")).toBe("- [ ] Report [due:: 2026-10-15]");
    expect(convertDueFields("- [ ] Report [due:: friday]", today)).toBe("- [ ] Report [due:: 2026-10-09]");
    expect(convertDueFields("- [ ] Report [due:: someday]", today)).toBe("- [ ] Report [due:: someday]");
  });
});

describe("Attn points", () => {
  const md = [
    "Attn:: Check budget with Alice @alice",
    "- Meeting went well, but [Attn:: supplier delay on T601] needs follow-up",
    "Attn:: Confirm venue [resolved:: 2026-10-03]",
  ].join("\n");

  it("parses line and inline forms", () => {
    const a = parseAttnPoints(md);
    expect(a).toHaveLength(3);
    expect(a[0]).toMatchObject({ text: "Check budget with Alice @alice", inline: false, assignees: ["alice"] });
    expect(a[1]).toMatchObject({ text: "supplier delay on T601", inline: true });
    expect(a[2]).toMatchObject({ text: "Confirm venue", resolved: "2026-10-03" });
  });
  it("makeAttn and resolve toggle", () => {
    expect(makeAttn("Check budget")).toBe("Attn:: Check budget");
    expect(makeAttn("- [ ] Check budget")).toBe("Attn:: Check budget");
    expect(toggleAttnResolved("Attn:: X", today)).toBe("Attn:: X [resolved:: 2026-10-02]");
    expect(toggleAttnResolved("Attn:: X [resolved:: 2026-10-02]", today)).toBe("Attn:: X");
  });
  it("converts to tasks", () => {
    expect(convertAttnToTask("Attn:: Check budget @alice")).toBe("- [ ] Check budget @alice");
    expect(convertAttnToTask("  - Attn:: Check [resolved:: 2026-10-01]")).toBe("  - [ ] Check");
    expect(convertAttnToTask("- Went well, but [Attn:: supplier delay] needs work")).toBe(
      "- Went well, but supplier delay needs work\n- [ ] supplier delay",
    );
    expect(makeTask("Attn:: Call")).toBe("- [ ] Call");
  });
});
