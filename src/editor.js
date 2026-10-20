// The CodeMirror 6 editor for .org files: highlighting, folding and Org-style commands.
// Obsidian provides CodeMirror at runtime (see esbuild.config.mjs), so these imports are not
// bundled. Pure logic lives in edit.js and highlight.js; this file applies it to an editor.
import { Annotation, Prec, EditorState } from "@codemirror/state";
import { EditorView, Decoration, ViewPlugin, keymap, drawSelection } from "@codemirror/view";
import { foldService, foldEffect, unfoldEffect, foldedRanges, unfoldAll, codeFolding, foldable } from "@codemirror/language";
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { scanDocument } from "./highlight.js";
import { scanKeywords } from "./parser.js";
import * as E from "./edit.js";

/** Marks transactions that load text from the file, so they are not saved back. */
export const External = Annotation.define();

/**
 * Decorations for the whole document from the highlight scan.
 * @param {import("@codemirror/state").EditorState} state
 * @returns {import("@codemirror/view").DecorationSet}
 */
function buildDecorations(state) {
  const lines = state.doc.toString().split("\n");
  const scan = scanDocument(lines);
  const out = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const l = state.doc.line(n);
    const s = scan[n - 1];
    if (s.cls) out.push(Decoration.line({ class: s.cls }).range(l.from));
    for (const m of s.marks) if (m.to > m.from) out.push(Decoration.mark({ class: m.cls }).range(l.from + m.from, l.from + m.to));
  }
  return Decoration.set(out, true);
}

/** View plugin holding the highlight decorations; rebuilt when the document changes. */
const highlightPlugin = ViewPlugin.fromClass(class {
  /** @param {import("@codemirror/view").EditorView} view */
  constructor(view) { this.decorations = buildDecorations(view.state); }
  /** @param {import("@codemirror/view").ViewUpdate} u */
  update(u) { if (u.docChanged) this.decorations = buildDecorations(u.state); }
}, { decorations: (v) => v.decorations });

/**
 * Where a heading's, block's or drawer's folded text ends: the last non-blank line before
 * the next heading of the same or a higher level (or before the closing line).
 * @param {import("@codemirror/state").EditorState} state
 * @param {number} lineStart
 * @returns {?{from: number, to: number}} the range to hide, or null if there is nothing to fold
 */
function foldRange(state, lineStart) {
  const doc = state.doc;
  const line = doc.lineAt(lineStart);
  const level = E.headingLevel(line.text);
  let last = null;
  if (level) {
    for (let n = line.number + 1; n <= doc.lines; n++) {
      const t = doc.line(n).text;
      const lv = E.headingLevel(t);
      if (lv && lv <= level) break;
      if (t.trim() !== "") last = n;
    }
  } else {
    let end = null;
    const b = /^\s*#\+BEGIN_(\S+)/i.exec(line.text);
    if (b) end = new RegExp(`^\\s*#\\+END_${b[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
    else if (/^\s*:[\w-]+:\s*$/.test(line.text) && line.text.trim().toUpperCase() !== ":END:") end = /^\s*:END:\s*$/i;
    if (!end) return null;
    for (let n = line.number + 1; n <= doc.lines; n++) if (end.test(doc.line(n).text)) { last = n; break; }
  }
  return last ? { from: line.to, to: doc.line(last).to } : null;
}

/**
 * The folded range starting right after `pos`'s line, if any.
 * @param {import("@codemirror/state").EditorState} state
 * @param {{from: number, to: number}} range
 * @returns {boolean} true if exactly this range is folded
 */
function isFolded(state, range) {
  let found = false;
  foldedRanges(state).between(range.from, range.from, (a, b) => { if (a === range.from && b === range.to) found = true; });
  return found;
}

/**
 * Replace lines `a..b` (0-based) and keep the cursor on its line and column.
 * @param {import("@codemirror/view").EditorView} view
 * @param {number} a
 * @param {number} b inclusive
 * @param {string[]} newLines
 * @param {number} [cursorLine] 0-based line the cursor should end up on (default: unchanged)
 * @returns {void}
 */
function replaceLines(view, a, b, newLines, cursorLine) {
  const doc = view.state.doc;
  const head = view.state.selection.main.head;
  const oldLine = doc.lineAt(head);
  const col = head - oldLine.from;
  const from = doc.line(a + 1).from;
  const to = doc.line(b + 1).to;
  const target = cursorLine ?? oldLine.number - 1;
  const rel = Math.min(Math.max(target - a, 0), newLines.length - 1);
  const before = newLines.slice(0, rel).reduce((n, l) => n + l.length + 1, 0);
  const oldText = doc.line(Math.min(Math.max(target + 1, 1), doc.lines)).text;
  const delta = cursorLine === undefined ? newLines[rel].length - oldText.length : 0;
  const newCol = Math.min(Math.max(col + delta, 0), newLines[rel].length);
  view.dispatch({ changes: { from, to, insert: newLines.join("\n") }, selection: { anchor: from + before + newCol }, scrollIntoView: true });
}

/**
 * @param {import("@codemirror/view").EditorView} view
 * @returns {{lines: string[], i: number}} the document lines and the cursor's 0-based line
 */
function ctx(view) {
  return { lines: view.state.doc.toString().split("\n"), i: view.state.doc.lineAt(view.state.selection.main.head).number - 1 };
}

/**
 * TODO keyword sets of the document (`#+TODO:` lines, default TODO/DONE).
 * @param {string[]} lines
 * @returns {{todo: string[], done: string[]}}
 */
function keywordsOf(lines) {
  const d = { keywords: {}, startup: [], todo: { todo: ["TODO"], done: ["DONE"] } };
  scanKeywords(lines, d);
  return d.todo;
}

/** Org commands. Each takes an EditorView and returns true if it did something. */
export const commands = {
  /** Next TODO state on the heading at the cursor. */
  todoNext: (view) => cycleTodoBy(view, 1),
  /** Previous TODO state on the heading at the cursor. */
  todoPrev: (view) => cycleTodoBy(view, -1),
  /** Promote the heading (or dedent the item) at the cursor. */
  promote: (view) => shiftBy(view, -1, false),
  /** Demote the heading (or indent the item) at the cursor. */
  demote: (view) => shiftBy(view, 1, false),
  /** Promote the whole subtree (or the item with its children). */
  promoteTree: (view) => shiftBy(view, -1, true),
  /** Demote the whole subtree (or the item with its children). */
  demoteTree: (view) => shiftBy(view, 1, true),
  /** Move the subtree or item up. */
  moveUp: (view) => moveBy(view, -1),
  /** Move the subtree or item down. */
  moveDown: (view) => moveBy(view, 1),
  /** Toggle the checkbox of the list item at the cursor. */
  toggleCheckbox(view) {
    const { lines, i } = ctx(view);
    const nl = E.toggleCheckbox(lines[i]);
    if (nl === null) return false;
    replaceLines(view, i, i, [nl]);
    return true;
  },
  /** New heading or list item after the current one. */
  newSibling(view) {
    const { lines, i } = ctx(view);
    const s = E.newSibling(lines, i);
    if (!s) return false;
    const at = view.state.doc.line(s.after + 1).to;
    view.dispatch({ changes: { from: at, insert: "\n" + s.text }, selection: { anchor: at + 1 + s.text.length }, scrollIntoView: true });
    return true;
  },
  /** Fold or unfold the heading, block or drawer at the cursor. */
  toggleFold(view) {
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const r = foldable(view.state, line.from, line.to);
    if (!r) return false;
    view.dispatch({ effects: (isFolded(view.state, r) ? unfoldEffect : foldEffect).of(r) });
    return true;
  },
  /** Cycle the whole document: all open -> headings only (overview) -> contents -> all open. */
  cycleFold(view) {
    const next = { all: "overview", overview: "content", content: "all" }[cycleState.get(view) || "all"];
    setFoldLevel(view, next);
    return true;
  },
};

const cycleState = new WeakMap();

/**
 * @param {import("@codemirror/view").EditorView} view
 * @param {1|-1} dir
 * @returns {boolean}
 */
function cycleTodoBy(view, dir) {
  const { lines, i } = ctx(view);
  const nl = E.cycleTodo(lines[i], dir, keywordsOf(lines));
  if (nl === null) return false;
  replaceLines(view, i, i, [nl]);
  return true;
}

/**
 * @param {import("@codemirror/view").EditorView} view
 * @param {1|-1} delta
 * @param {boolean} tree include the subtree / the item's children
 * @returns {boolean}
 */
function shiftBy(view, delta, tree) {
  const { lines, i } = ctx(view);
  if (E.headingLevel(lines[i])) {
    const b = tree ? E.subtreeEnd(lines, i) : i;
    const out = E.shiftHeadings(lines, i, b, delta);
    if (!out) return true;
    replaceLines(view, i, b, out);
    return true;
  }
  if (E.itemInfo(lines[i])) {
    const b = tree ? E.itemEnd(lines, i) : i;
    const out = E.shiftIndent(lines, i, b, delta);
    if (!out) return true;
    replaceLines(view, i, b, out);
    return true;
  }
  return false;
}

/**
 * @param {import("@codemirror/view").EditorView} view
 * @param {-1|1} dir
 * @returns {boolean}
 */
function moveBy(view, dir) {
  const { lines, i } = ctx(view);
  const kind = E.headingLevel(lines[i]) ? "heading" : E.itemInfo(lines[i]) ? "item" : null;
  if (!kind) return false;
  const b = kind === "heading" ? E.subtreeEnd(lines, i) : E.itemEnd(lines, i);
  const r = E.moveBlock(lines, i, b, dir, kind);
  if (!r) return true;
  const lo = Math.min(i, r.start);
  const hi = Math.max(b, r.start + (b - i));
  const rows = r.lines.slice(lo, hi + 1);
  replaceLines(view, lo, hi, rows, r.start);
  return true;
}

/**
 * Fold the whole document to a level.
 * @param {import("@codemirror/view").EditorView} view
 * @param {"overview"|"content"|"all"} mode overview: only top-level headings; content: all
 *   headings, no body text; all: nothing folded
 * @returns {void}
 */
export function setFoldLevel(view, mode) {
  cycleState.set(view, mode);
  unfoldAll(view);
  if (mode === "all") return;
  const state = view.state;
  const effects = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const level = E.headingLevel(line.text);
    if (!level || (mode === "overview" && level !== 1)) continue;
    let r = foldRange(state, line.from);
    if (!r) continue;
    if (mode === "content") {
      // only the text before the first child heading
      let last = null;
      for (let k = n + 1; k <= state.doc.lines; k++) {
        const t = state.doc.line(k).text;
        if (E.headingLevel(t)) break;
        if (t.trim() !== "") last = k;
      }
      if (!last) continue;
      r = { from: line.to, to: state.doc.line(last).to };
    }
    effects.push(foldEffect.of(r));
  }
  if (effects.length) view.dispatch({ effects });
}

/**
 * Run `cmd`, and tell CodeMirror the key was handled whether or not it changed anything.
 * @param {(view: import("@codemirror/view").EditorView) => boolean} cmd
 * @returns {(view: import("@codemirror/view").EditorView) => boolean}
 */
const key = (cmd) => (view) => cmd(view);

/**
 * Tab: fold a heading, indent an item, otherwise insert two spaces.
 * @param {import("@codemirror/view").EditorView} view
 * @returns {boolean}
 */
function tab(view) {
  const { lines, i } = ctx(view);
  if (E.headingLevel(lines[i])) return commands.toggleFold(view) || true;
  if (E.itemInfo(lines[i])) return shiftBy(view, 1, true);
  view.dispatch(view.state.replaceSelection("  "));
  return true;
}

/**
 * Shift-Tab: dedent an item, otherwise cycle the whole document's folding.
 * @param {import("@codemirror/view").EditorView} view
 * @returns {boolean}
 */
function shiftTab(view) {
  const { lines, i } = ctx(view);
  if (E.itemInfo(lines[i]) && !E.headingLevel(lines[i])) return shiftBy(view, -1, true);
  return commands.cycleFold(view);
}

const orgKeymap = Prec.high(keymap.of([
  { key: "Tab", run: tab },
  { key: "Shift-Tab", run: shiftTab },
  { key: "Shift-ArrowRight", run: key(commands.todoNext) },
  { key: "Shift-ArrowLeft", run: key(commands.todoPrev) },
  { key: "Alt-ArrowRight", run: key(commands.demote) },
  { key: "Alt-ArrowLeft", run: key(commands.promote) },
  { key: "Alt-Shift-ArrowRight", run: key(commands.demoteTree) },
  { key: "Alt-Shift-ArrowLeft", run: key(commands.promoteTree) },
  { key: "Alt-ArrowUp", run: key(commands.moveUp) },
  { key: "Alt-ArrowDown", run: key(commands.moveDown) },
  { key: "Alt-Enter", run: key(commands.newSibling) },
  { key: "Ctrl-c Ctrl-c", run: key(commands.toggleCheckbox) },
]));

/**
 * The extensions of an Org editor.
 * @param {import("@codemirror/state").Extension[]} extra extensions supplied by the view (e.g. the change listener)
 * @returns {import("@codemirror/state").Extension[]}
 */
export function orgExtensions(extra) {
  return [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    codeFolding(),
    foldService.of((state, from) => foldRange(state, from)),
    highlightPlugin,
    orgKeymap,
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorState.tabSize.of(2),
    ...extra,
  ];
}
