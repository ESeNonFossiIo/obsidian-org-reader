// Unit tests for src/highlight.js. Run with `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import { scanDocument, scanInline } from "../src/highlight.js";

const pieces = (text, marks) => marks.map((m) => `${m.cls}:${text.slice(m.from, m.to)}`);

test("headings: stars, keyword, priority, tags", () => {
  const t = "** TODO [#A] Write *docs* :work:";
  const [h] = scanDocument([t]);
  assert.equal(h.cls, "org-hl-heading org-hl-h2");
  assert.deepEqual(pieces(t, h.marks).sort(), [
    "org-hl-bold:*docs*", "org-hl-marker:*", "org-hl-marker:*", "org-hl-priority:[#A]", "org-hl-stars:**", "org-hl-tags::work:", "org-hl-todo:TODO",
  ].sort());
});

test("headings: DONE and custom keywords", () => {
  const lines = ["#+TODO: NEXT | FINISHED", "* FINISHED a", "* NEXT b", "* TODO c"];
  const r = scanDocument(lines);
  assert.ok(r[1].marks.some((m) => m.cls === "org-hl-done"));
  assert.ok(r[2].marks.some((m) => m.cls === "org-hl-todo"));
  assert.ok(!r[3].marks.some((m) => m.cls === "org-hl-todo"));
});

test("inline: nested emphasis, links, timestamps, math, urls", () => {
  const t = "*a /b/* [[x][y]] <2026-10-20 Tue> $x$ https://e.org/a. [fn:1] [2/3]";
  const marks = [];
  scanInline(t, 0, marks);
  const p = pieces(t, marks);
  for (const want of ["org-hl-bold:*a /b/*", "org-hl-italic:/b/", "org-hl-link:[[x][y]]", "org-hl-timestamp:<2026-10-20 Tue>", "org-hl-math:$x$", "org-hl-link:https://e.org/a", "org-hl-footref:[fn:1]", "org-hl-cookie:[2/3]"]) {
    assert.ok(p.includes(want), want);
  }
});

test("inline: verbatim content is not scanned, prices are not math", () => {
  const marks = [];
  scanInline("=*no*= costs $5 and $6", 0, marks);
  assert.deepEqual(marks.map((m) => m.cls).filter((c) => c !== "org-hl-marker"), ["org-hl-verbatim"]);
});

test("blocks: src content is raw, quote content is scanned, edges are marked", () => {
  const r = scanDocument(["#+BEGIN_SRC js", "let *a*;", "#+END_SRC", "#+BEGIN_QUOTE", "*b*", "#+END_QUOTE", "after"]);
  assert.deepEqual(r.map((l) => l.cls), ["org-hl-block-edge", "org-hl-block org-hl-block-src", "org-hl-block-edge", "org-hl-block-edge", "org-hl-block org-hl-block-quote", "org-hl-block-edge", ""]);
  assert.equal(r[1].marks.length, 0);
  assert.ok(r[4].marks.some((m) => m.cls === "org-hl-bold"));
});

test("a heading inside a src block is not a heading", () => {
  const r = scanDocument(["#+BEGIN_SRC org", "* not a heading", "#+END_SRC"]);
  assert.equal(r[1].cls, "org-hl-block org-hl-block-src");
});

test("lists, checkboxes, tables, drawers, planning, comments, keywords, rules", () => {
  const r = scanDocument(["- [X] done", "  1. [ ] open", "- term :: text", "| a | *b* |", "|---+---|", ":PROPERTIES:", ":ID: 1", ":END:", "SCHEDULED: <2026-10-20 Tue>", "# comment", "#+TITLE: x", "-----", ": fixed", "* heading"]);
  assert.deepEqual(r[0].marks.map((m) => m.cls).slice(0, 2), ["org-hl-bullet", "org-hl-checkbox org-hl-checkbox-on"]);
  assert.ok(r[1].marks.some((m) => m.cls === "org-hl-checkbox org-hl-checkbox-off"));
  assert.ok(r[2].marks.some((m) => m.cls === "org-hl-term"));
  assert.equal(r[3].cls, "org-hl-table");
  assert.equal(r[4].cls, "org-hl-table org-hl-table-rule");
  assert.deepEqual(r.slice(5, 8).map((l) => l.cls), ["org-hl-drawer", "org-hl-drawer", "org-hl-drawer"]);
  assert.equal(r[8].cls, "org-hl-planning");
  assert.deepEqual([r[9].cls, r[10].cls, r[11].cls, r[12].cls, r[13].cls.split(" ")[0]], ["org-hl-comment", "org-hl-keyword", "org-hl-rule", "org-hl-fixed", "org-hl-heading"]);
});

test("a '*' at column 0 is a heading, an indented one is a bullet", () => {
  const r = scanDocument(["* a", " * b"]);
  assert.match(r[0].cls, /org-hl-heading/);
  assert.equal(r[1].marks[0].cls, "org-hl-bullet");
});
