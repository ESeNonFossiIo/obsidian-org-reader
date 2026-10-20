// Pure editing operations on Org text, one function per command. They work on arrays of
// lines (no CodeMirror, no Obsidian), so they are unit-tested; editor.js applies them.

const HEADING = /^(\*+)([ \t]+.*|)$/;
const ITEM = /^(\s*)([-+*]|\d+[.)])(\s+|$)/;

/**
 * @param {string} line
 * @returns {number} number of stars of a heading line, 0 for any other line
 */
export function headingLevel(line) {
  const m = HEADING.exec(line);
  return m ? m[1].length : 0;
}

/**
 * @param {string} line
 * @returns {?{indent: number, bullet: string, textStart: number, checkbox: ?string}} a list item
 *   line (a `*` bullet needs indentation, otherwise it is a heading), or null
 */
export function itemInfo(line) {
  const m = ITEM.exec(line);
  if (!m || (m[2] === "*" && m[1].length === 0) || /^\s*-{5,}\s*$/.test(line)) return null;
  const textStart = m[0].length;
  const cb = /^\[([ Xx-])\]/.exec(line.slice(textStart));
  return { indent: m[1].length, bullet: m[2], textStart, checkbox: cb ? cb[1] : null };
}

/**
 * Next or previous TODO state of a heading line: none -> first TODO ... -> last DONE -> none.
 * @param {string} line a heading line
 * @param {1|-1} dir
 * @param {{todo: string[], done: string[]}} kw the document's keyword sets
 * @returns {?string} the new line, or null if `line` is not a heading
 */
export function cycleTodo(line, dir, kw) {
  const m = /^(\*+[ \t]+)(.*)$/.exec(line);
  if (!m) return null;
  const states = [...kw.todo, ...kw.done];
  if (!states.length) return null;
  const word = /^(\S+)(?:[ \t]+|$)/.exec(m[2]);
  const cur = word && states.includes(word[1]) ? states.indexOf(word[1]) : -1;
  const rest = cur >= 0 ? m[2].slice(word[0].length) : m[2];
  const idx = cur + dir;
  const next = idx < 0 ? (cur < 0 ? states.length - 1 : -1) : idx >= states.length ? -1 : idx;
  return m[1] + (next < 0 ? rest : `${states[next]} ${rest}`.trimEnd());
}

/**
 * Index of the last line of the subtree whose heading is at `i` (up to the next heading
 * of the same or a higher level).
 * @param {string[]} lines
 * @param {number} i
 * @returns {number} inclusive
 */
export function subtreeEnd(lines, i) {
  const level = headingLevel(lines[i]);
  let j = i + 1;
  while (j < lines.length && !(headingLevel(lines[j]) && headingLevel(lines[j]) <= level)) j++;
  return j - 1;
}

/**
 * Index of the last line of the list item at `i`: the item line plus the lines indented
 * deeper (blank lines only count when followed by deeper-indented text).
 * @param {string[]} lines
 * @param {number} i
 * @returns {number} inclusive
 */
export function itemEnd(lines, i) {
  const base = itemInfo(lines[i]).indent;
  const indentOf = (l) => /^\s*/.exec(l)[0].length;
  let end = i;
  for (let j = i + 1; j < lines.length; j++) {
    if (/^\s*$/.test(lines[j])) continue;
    if (indentOf(lines[j]) > base) end = j;
    else break;
  }
  return end;
}

/**
 * Promote (`delta` -1) or demote (+1) headings in a line range.
 * @param {string[]} lines the whole document
 * @param {number} a first line
 * @param {number} b last line (inclusive)
 * @param {number} delta
 * @returns {?string[]} the changed lines `a..b`, or null if a heading would drop below level 1
 */
export function shiftHeadings(lines, a, b, delta) {
  const out = [];
  for (let k = a; k <= b; k++) {
    const level = headingLevel(lines[k]);
    if (!level) { out.push(lines[k]); continue; }
    if (level + delta < 1) return null;
    out.push(delta > 0 ? "*".repeat(delta) + lines[k] : lines[k].slice(-delta));
  }
  return out;
}

/**
 * Indent (`delta` +1) or dedent (-1) lines by two spaces.
 * @param {string[]} lines
 * @param {number} a
 * @param {number} b inclusive
 * @param {number} delta
 * @returns {?string[]} the changed lines `a..b`, or null if the first line cannot be dedented
 */
export function shiftIndent(lines, a, b, delta) {
  if (delta < 0 && !/^ {1,}/.test(lines[a])) return null;
  const out = [];
  for (let k = a; k <= b; k++) {
    if (delta > 0) out.push(/^\s*$/.test(lines[k]) ? lines[k] : "  " + lines[k]);
    else out.push(lines[k].replace(/^ {1,2}/, ""));
  }
  return out;
}

/**
 * Swap the block `[a, b]` with the neighbouring block of the same kind and level.
 * @param {string[]} lines
 * @param {number} a first line of the block
 * @param {number} b last line of the block (inclusive)
 * @param {-1|1} dir up or down
 * @param {"heading"|"item"} kind
 * @returns {?{lines: string[], start: number}} the new document lines and where the moved
 *   block now starts, or null if there is no neighbour to swap with
 */
export function moveBlock(lines, a, b, dir, kind) {
  const same = (k, ref) => (kind === "heading" ? headingLevel(lines[k]) === headingLevel(lines[ref]) : !!itemInfo(lines[k]) && itemInfo(lines[k]).indent === itemInfo(lines[ref]).indent);
  const stop = (k, ref) => (kind === "heading" ? headingLevel(lines[k]) && headingLevel(lines[k]) < headingLevel(lines[ref]) : !!itemInfo(lines[k]) && itemInfo(lines[k]).indent < itemInfo(lines[ref]).indent);
  const end = (k) => (kind === "heading" ? subtreeEnd(lines, k) : itemEnd(lines, k));
  let na, nb;
  if (dir > 0) {
    na = b + 1;
    while (na < lines.length && /^\s*$/.test(lines[na])) na++;
    if (na >= lines.length || !same(na, a)) return null;
    nb = end(na);
  } else {
    let k = a - 1;
    while (k >= 0 && !same(k, a)) { if (stop(k, a)) return null; k--; }
    if (k < 0) return null;
    na = k;
    nb = end(na);
    if (nb >= a) return null;
  }
  const lo = Math.min(a, na), hi = Math.max(b, nb);
  const first = dir > 0 ? lines.slice(a, b + 1) : lines.slice(na, nb + 1);
  const second = dir > 0 ? lines.slice(na, nb + 1) : lines.slice(a, b + 1);
  const gap = dir > 0 ? lines.slice(b + 1, na) : lines.slice(nb + 1, a);
  const merged = [...second, ...gap, ...first];
  const out = [...lines.slice(0, lo), ...merged, ...lines.slice(hi + 1)];
  const start = dir > 0 ? lo + second.length + gap.length : lo;
  return { lines: out, start };
}

/**
 * Toggle the checkbox of a list item line: unchecked or partial becomes checked, checked becomes unchecked.
 * @param {string} line
 * @returns {?string} the new line, or null if the line has no checkbox
 */
export function toggleCheckbox(line) {
  const info = itemInfo(line);
  if (!info || !info.checkbox) return null;
  const at = info.textStart + 1;
  return line.slice(0, at) + (info.checkbox === " " || info.checkbox === "-" ? "X" : " ") + line.slice(at + 1);
}

/**
 * The text to insert for "new heading / new item" (Alt-Enter) after the block that contains
 * the line `i`.
 * @param {string[]} lines
 * @param {number} i the cursor line
 * @returns {?{after: number, text: string}} insert `text` as a new line after line `after`; null
 *   if the line is neither a heading nor a list item
 */
export function newSibling(lines, i) {
  const level = headingLevel(lines[i]);
  if (level) return { after: subtreeEnd(lines, i), text: "*".repeat(level) + " " };
  const info = itemInfo(lines[i]);
  if (!info) return null;
  const bullet = /\d/.test(info.bullet[0]) ? `${parseInt(info.bullet, 10) + 1}${info.bullet.slice(-1)}` : info.bullet;
  return { after: itemEnd(lines, i), text: " ".repeat(info.indent) + bullet + " " + (info.checkbox ? "[ ] " : "") };
}
