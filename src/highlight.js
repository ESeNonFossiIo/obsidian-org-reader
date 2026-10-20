// Syntax highlighting for the editor, as plain data (no CodeMirror): `scanDocument` returns,
// for every line, a line class and character ranges with classes. editor.js turns them into
// decorations. Reuses the inline rules of parser.js so the editor and the reading view agree.
import { MARKERS, PRE, LINK, TIMESTAMP, FOOTREF, COOKIE, URL_RE, matchMath, closingMarker, scanKeywords } from "./parser.js";

const KIND = { "*": "bold", "/": "italic", "_": "underline", "+": "strike", "=": "verbatim", "~": "code" };
const RAW_BLOCKS = new Set(["src", "example", "export", "comment"]);

/**
 * Character ranges of the inline markup in `text`.
 * @param {string} text
 * @param {number} base offset added to every range (for text inside a line)
 * @param {Array<{from: number, to: number, cls: string}>} out ranges are appended here
 * @returns {void}
 */
export function scanInline(text, base, out) {
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    let m;
    if (c === "[" && text[i + 1] === "[") {
      LINK.lastIndex = i;
      if ((m = LINK.exec(text))) { out.push({ from: base + i, to: base + i + m[0].length, cls: "org-hl-link" }); i += m[0].length; continue; }
    }
    if (c === "<" || c === "[") {
      TIMESTAMP.lastIndex = i;
      if ((m = TIMESTAMP.exec(text))) { out.push({ from: base + i, to: base + i + m[0].length, cls: "org-hl-timestamp" }); i += m[0].length; continue; }
      FOOTREF.lastIndex = i;
      if ((m = FOOTREF.exec(text))) { out.push({ from: base + i, to: base + i + m[0].length, cls: "org-hl-footref" }); i += m[0].length; continue; }
      COOKIE.lastIndex = i;
      if ((m = COOKIE.exec(text))) { out.push({ from: base + i, to: base + i + m[0].length, cls: "org-hl-cookie" }); i += m[0].length; continue; }
    }
    if ((c === "h" || c === "f" || c === "m") && (i === 0 || !/\w/.test(text[i - 1]))) {
      URL_RE.lastIndex = i;
      if ((m = URL_RE.exec(text))) {
        const len = m[0].replace(/[.,;:!?'"]+$/, "").length;
        out.push({ from: base + i, to: base + i + len, cls: "org-hl-link" });
        i += len;
        continue;
      }
    }
    if (c === "$" || (c === "\\" && (text[i + 1] === "(" || text[i + 1] === "["))) {
      const math = matchMath(text, i);
      if (math) { out.push({ from: base + i, to: base + math.end, cls: "org-hl-math" }); i = math.end; continue; }
    }
    const kind = MARKERS[c] && KIND[c];
    if (kind && (i === 0 || PRE.test(text[i - 1])) && i + 1 < text.length && !/\s/.test(text[i + 1]) && text[i + 1] !== c) {
      const end = closingMarker(text, i);
      if (end > 0) {
        out.push({ from: base + i, to: base + end + 1, cls: `org-hl-${kind}` });
        out.push({ from: base + i, to: base + i + 1, cls: "org-hl-marker" }, { from: base + end, to: base + end + 1, cls: "org-hl-marker" });
        if (kind !== "verbatim" && kind !== "code") scanInline(text.slice(i + 1, end), base + i + 1, out);
        i = end + 1;
        continue;
      }
    }
    i++;
  }
}

/**
 * Highlight data for a whole document.
 * @param {string[]} lines
 * @returns {Array<{cls: string, marks: Array<{from: number, to: number, cls: string}>}>} one entry
 *   per line: `cls` is a line class (may be empty), `marks` are ranges inside the line
 */
export function scanDocument(lines) {
  const doc = { keywords: {}, startup: [], todo: { todo: ["TODO"], done: ["DONE"] } };
  scanKeywords(lines, doc);
  const states = new Set([...doc.todo.todo, ...doc.todo.done]);
  const out = [];
  let block = null;       // lowercase name of the open #+BEGIN_x block
  let drawer = false;
  for (const text of lines) {
    const marks = [];
    let cls = "";
    let m;
    if (block) {
      if ((m = /^\s*#\+END_(\S+)/i.exec(text)) && m[1].toLowerCase() === block) {
        cls = "org-hl-block-edge";
        block = null;
      } else {
        cls = `org-hl-block org-hl-block-${block}`;
        if (!RAW_BLOCKS.has(block)) scanInline(text, 0, marks);
      }
    } else if ((m = /^\s*#\+BEGIN_(\S+)/i.exec(text))) {
      block = m[1].toLowerCase();
      cls = "org-hl-block-edge";
    } else if (drawer) {
      cls = "org-hl-drawer";
      if (text.trim().toUpperCase() === ":END:") drawer = false;
    } else if (/^\s*:[\w-]+:\s*$/.test(text) && text.trim().toUpperCase() !== ":END:") {
      cls = "org-hl-drawer";
      drawer = true;
    } else if ((m = /^(\*+)(?:[ \t]+(.*))?$/.exec(text))) {
      cls = `org-hl-heading org-hl-h${Math.min(m[1].length, 8)}`;
      marks.push({ from: 0, to: m[1].length, cls: "org-hl-stars" });
      let pos = m[1].length;
      let rest = m[2] || "";
      pos = text.length - rest.length;
      const tm = /(?:^|\s+)(:[^\s:]+(?::[^\s:]+)*:)\s*$/.exec(rest);
      if (tm) {
        const tagStart = pos + tm.index + tm[0].indexOf(tm[1]);
        marks.push({ from: tagStart, to: tagStart + tm[1].length, cls: "org-hl-tags" });
        rest = rest.slice(0, tm.index);
      }
      const km = /^(\S+)(?:\s+|$)/.exec(rest);
      let off = 0;
      if (km && states.has(km[1])) {
        marks.push({ from: pos, to: pos + km[1].length, cls: doc.todo.done.includes(km[1]) ? "org-hl-done" : "org-hl-todo" });
        off = km[0].length;
      }
      const pm = /^\[#[A-Za-z0-9]+\]/.exec(rest.slice(off));
      if (pm) { marks.push({ from: pos + off, to: pos + off + pm[0].length, cls: "org-hl-priority" }); off += pm[0].length; }
      scanInline(rest.slice(off), pos + off, marks);
    } else if (/^\s*#(\s|$)/.test(text)) {
      cls = "org-hl-comment";
    } else if ((m = /^\s*#\+(\w+):/.exec(text))) {
      cls = "org-hl-keyword";
    } else if (/^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(text)) {
      cls = "org-hl-planning";
      scanInline(text, 0, marks);
      for (const k of text.matchAll(/(SCHEDULED|DEADLINE|CLOSED):/g)) marks.push({ from: k.index, to: k.index + k[0].length, cls: "org-hl-planning-kind" });
    } else if (/^\s*-{5,}\s*$/.test(text)) {
      cls = "org-hl-rule";
    } else if (/^\s*:(\s|$)/.test(text)) {
      cls = "org-hl-fixed";
    } else if (/^\s*\|/.test(text)) {
      cls = /^\s*\|[-+]+\|?\s*$/.test(text) ? "org-hl-table org-hl-table-rule" : "org-hl-table";
      for (const b of text.matchAll(/\|/g)) marks.push({ from: b.index, to: b.index + 1, cls: "org-hl-marker" });
      scanInline(text, 0, marks);
    } else if ((m = /^(\s*)([-+*]|\d+[.)])(\s+|$)/.exec(text)) && !(m[2] === "*" && m[1].length === 0)) {
      const start = m[1].length;
      marks.push({ from: start, to: start + m[2].length, cls: "org-hl-bullet" });
      let at = m[0].length;
      const cb = /^\[([ Xx-])\]/.exec(text.slice(at));
      if (cb) {
        marks.push({ from: at, to: at + 3, cls: `org-hl-checkbox org-hl-checkbox-${cb[1] === " " ? "off" : cb[1] === "-" ? "partial" : "on"}` });
        at += 3;
      }
      const dm = /\s::(\s|$)/.exec(text.slice(at));
      if (dm) marks.push({ from: at, to: at + dm.index, cls: "org-hl-term" });
      scanInline(text.slice(at), at, marks);
    } else {
      scanInline(text, 0, marks);
    }
    out.push({ cls, marks });
  }
  return out;
}
