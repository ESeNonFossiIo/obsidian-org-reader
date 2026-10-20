// Unit tests for src/edit.js. Run with `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import { headingLevel, itemInfo, cycleTodo, subtreeEnd, itemEnd, shiftHeadings, shiftIndent, moveBlock, toggleCheckbox, newSibling } from "../src/edit.js";

const KW = { todo: ["TODO", "NEXT"], done: ["DONE"] };

test("headingLevel and itemInfo", () => {
  assert.deepEqual(["* a", "*** b", "*bold*", "text", "  * item"].map(headingLevel), [1, 3, 0, 0, 0]);
  assert.deepEqual(itemInfo("  - [X] done"), { indent: 2, bullet: "-", textStart: 4, checkbox: "X" });
  assert.equal(itemInfo("* heading"), null);
  assert.equal(itemInfo("-----"), null);
  assert.equal(itemInfo("2) two").bullet, "2)");
});

test("cycleTodo steps through the states and back to none", () => {
  assert.equal(cycleTodo("** Title :tag:", 1, KW), "** TODO Title :tag:");
  assert.equal(cycleTodo("** TODO Title", 1, KW), "** NEXT Title");
  assert.equal(cycleTodo("** NEXT Title", 1, KW), "** DONE Title");
  assert.equal(cycleTodo("** DONE Title", 1, KW), "** Title");
  assert.equal(cycleTodo("** Title", -1, KW), "** DONE Title");
  assert.equal(cycleTodo("** TODO Title", -1, KW), "** Title");
  assert.equal(cycleTodo("** TODO", 1, KW), "** NEXT");
  assert.equal(cycleTodo("text", 1, KW), null);
});

test("subtreeEnd and itemEnd", () => {
  const l = ["* A", "text", "** B", "x", "* C"];
  assert.equal(subtreeEnd(l, 0), 3);
  assert.equal(subtreeEnd(l, 2), 3);
  assert.equal(subtreeEnd(l, 4), 4);
  const i = ["- a", "  cont", "  - nested", "", "- b"];
  assert.equal(itemEnd(i, 0), 2);
  assert.equal(itemEnd(i, 4), 4);
});

test("shiftHeadings promotes/demotes a subtree and refuses to go below level 1", () => {
  const l = ["* A", "text", "** B"];
  assert.deepEqual(shiftHeadings(l, 0, 2, 1), ["** A", "text", "*** B"]);
  assert.deepEqual(shiftHeadings(l, 1, 2, -1), ["text", "* B"]);
  assert.equal(shiftHeadings(l, 0, 2, -1), null);
});

test("shiftIndent indents and dedents items", () => {
  assert.deepEqual(shiftIndent(["- a", "  b"], 0, 1, 1), ["  - a", "    b"]);
  assert.deepEqual(shiftIndent(["  - a", "    b"], 0, 1, -1), ["- a", "  b"]);
  assert.equal(shiftIndent(["- a"], 0, 0, -1), null);
});

test("moveBlock swaps sibling subtrees and items", () => {
  const l = ["* A", "a1", "* B", "b1", "** B1", "* C"];
  const down = moveBlock(l, 0, 1, 1, "heading");
  assert.deepEqual(down.lines, ["* B", "b1", "** B1", "* A", "a1", "* C"]);
  assert.equal(down.start, 3);
  const up = moveBlock(l, 2, 4, -1, "heading");
  assert.deepEqual(up.lines, ["* B", "b1", "** B1", "* A", "a1", "* C"]);
  assert.equal(up.start, 0);
  assert.equal(moveBlock(l, 5, 5, 1, "heading"), null);
  assert.equal(moveBlock(l, 0, 1, -1, "heading"), null);
  const it = ["- a", "  x", "- b"];
  assert.deepEqual(moveBlock(it, 0, 1, 1, "item").lines, ["- b", "- a", "  x"]);
  assert.equal(moveBlock(["* P", "** C1", "** C2", "* Q"], 1, 1, 1, "heading").start, 2);
  assert.equal(moveBlock(["* P", "** C", "* Q", "** D"], 1, 1, 1, "heading"), null);
});

test("toggleCheckbox", () => {
  assert.equal(toggleCheckbox("- [ ] a"), "- [X] a");
  assert.equal(toggleCheckbox("- [X] a"), "- [ ] a");
  assert.equal(toggleCheckbox("  1. [-] a"), "  1. [X] a");
  assert.equal(toggleCheckbox("- a"), null);
});

test("newSibling for headings and items", () => {
  assert.deepEqual(newSibling(["** A", "text", "*** B", "* C"], 0), { after: 2, text: "** " });
  assert.deepEqual(newSibling(["- [X] a", "  more", "- b"], 0), { after: 1, text: "- [ ] " });
  assert.deepEqual(newSibling(["1. a", "2. b"], 0), { after: 0, text: "2. " });
  assert.equal(newSibling(["plain"], 0), null);
});
