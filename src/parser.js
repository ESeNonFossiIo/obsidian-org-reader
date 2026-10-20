// Pure Org parser, independent of Obsidian and the DOM:
//   parseInline(text) -> inline nodes (emphasis, links, timestamps, footnote refs...)
//   parseOrg(text)    -> document tree: preamble blocks plus nested sections
// Covers the everyday syntax; anything it does not know is kept as plain text.

const MARKERS = { "*": "bold", "/": "italic", "_": "underline", "+": "strike", "=": "verbatim", "~": "code" };
const PRE = /[\s\-({'"]/;                 // what may precede an opening emphasis marker
const POST = /[\s\-.,;:!?')}["\\\]]/;     // what may follow a closing one
const LINK = /\[\[((?:\\.|[^\]\\])+)\](?:\[((?:\\.|[^\]\\])+)\])?\]/y;
const TIMESTAMP = /[<[](\d{4}-\d{2}-\d{2})(?: [A-Za-zÀ-ÿ.]+)?(?: \d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?)?(?: [.+]{0,2}[+-]\d+[hdwmy](?:\/\d+[hdwmy])?)*[>\]]/y;
const FOOTREF = /\[fn:([\w-]*)(?::([^\]]*))?\]/y;
const COOKIE = /\[(\d*\/\d*|\d*%)\]/y;
const URL_RE = /(?:https?|ftp):\/\/[^\s<>[\]()]+|mailto:[^\s<>[\]()]+/y;

/**
 * Parse Org inline markup.
 * @param {string} src text of one paragraph, heading title or table cell
 * @returns {Array<object>} nodes: `{t: "text", v}`, `{t: "bold"|"italic"|"underline"|"strike", c}`,
 *   `{t: "code"|"verbatim", v}`, `{t: "link", target, desc}`, `{t: "timestamp", v, active}`,
 *   `{t: "footref", label}`, `{t: "cookie", v}`, `{t: "math", v, display, raw}`, `{t: "br"}`
 */
export function parseInline(src) {
  const out = [];
  let buf = "";
  let i = 0;
  const flush = () => { if (buf) { out.push({ t: "text", v: buf }); buf = ""; } };
  while (i < src.length) {
    const c = src[i];
    let m;
    if (c === "[" && src[i + 1] === "[") {
      LINK.lastIndex = i;
      if ((m = LINK.exec(src))) {
        flush();
        const unesc = (s) => s.replace(/\\([[\]\\])/g, "$1");
        out.push({ t: "link", target: unesc(m[1]), desc: m[2] ? parseInline(unesc(m[2])) : null });
        i += m[0].length;
        continue;
      }
    }
    if (c === "<" || c === "[") {
      TIMESTAMP.lastIndex = i;
      if ((m = TIMESTAMP.exec(src))) {
        let end = i + m[0].length;
        let v = m[0];
        if (src.startsWith("--", end)) {   // a range: <a>--<b>
          TIMESTAMP.lastIndex = end + 2;
          const m2 = TIMESTAMP.exec(src);
          if (m2) { v += "--" + m2[0]; end += 2 + m2[0].length; }
        }
        flush();
        out.push({ t: "timestamp", v, active: c === "<" });
        i = end;
        continue;
      }
    }
    if (c === "[") {
      FOOTREF.lastIndex = i;
      if ((m = FOOTREF.exec(src))) { flush(); out.push({ t: "footref", label: m[1] || m[2] || "" }); i += m[0].length; continue; }
      COOKIE.lastIndex = i;
      if ((m = COOKIE.exec(src))) { flush(); out.push({ t: "cookie", v: m[1] }); i += m[0].length; continue; }
    }
    if ((c === "h" || c === "f" || c === "m") && (i === 0 || !/\w/.test(src[i - 1]))) {
      URL_RE.lastIndex = i;
      if ((m = URL_RE.exec(src))) {
        const url = m[0].replace(/[.,;:!?'"]+$/, "");
        flush();
        out.push({ t: "link", target: url, desc: null });
        i += url.length;
        continue;
      }
    }
    if (c === "$" || (c === "\\" && (src[i + 1] === "(" || src[i + 1] === "["))) {
      const math = matchMath(src, i);
      if (math) {
        flush();
        out.push(math.node);
        i = math.end;
        continue;
      }
    }
    if (c === "\\" && src[i + 1] === "\\" && (i + 2 === src.length || src[i + 2] === "\n")) {
      flush();
      out.push({ t: "br" });
      i += src[i + 2] === "\n" ? 3 : 2;
      continue;
    }
    const kind = MARKERS[c];
    if (kind && (i === 0 || PRE.test(src[i - 1])) && i + 1 < src.length && !/\s/.test(src[i + 1]) && src[i + 1] !== c) {
      const end = closingMarker(src, i);
      if (end > 0) {
        flush();
        const inner = src.slice(i + 1, end);
        out.push(kind === "verbatim" || kind === "code" ? { t: kind, v: inner } : { t: kind, c: parseInline(inner) });
        i = end + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/**
 * Match a LaTeX fragment starting at `i`: `\(..\)`, `\[..\]`, `$$..$$` or `$..$`. The `$..$`
 * form follows Org's rules (no space inside the borders, so "$5 and $6" is not math).
 * @param {string} src
 * @param {number} i
 * @returns {?{node: object, end: number}} the math node and the index after it
 */
function matchMath(src, i) {
  const make = (inner, end, display) => {
    const v = inner.trim();
    return v ? { node: { t: "math", v, display, raw: src.slice(i, end) }, end } : null;
  };
  if (src[i] === "\\") {
    const close = src[i + 1] === "(" ? "\\)" : "\\]";
    const e = src.indexOf(close, i + 2);
    return e < 0 ? null : make(src.slice(i + 2, e), e + 2, src[i + 1] === "[");
  }
  if (src[i + 1] === "$") {
    const e = src.indexOf("$$", i + 2);
    return e < 0 ? null : make(src.slice(i + 2, e), e + 2, true);
  }
  if ((i > 0 && src[i - 1] === "$") || i + 1 >= src.length || /[\s.,;$]/.test(src[i + 1])) return null;
  let breaks = 0;
  for (let j = i + 2; j < src.length; j++) {
    if (src[j] === "\n" && ++breaks > 2) return null;
    if (src[j] === "$" && !/[\s.,$]/.test(src[j - 1]) && (j + 1 === src.length || /[\s.,?;:'")-]/.test(src[j + 1]))) {
      return make(src.slice(i + 1, j), j + 1, false);
    }
  }
  return null;
}

/**
 * Index of the marker closing the emphasis opened at `open`, or -1. The text between may
 * span at most one line break.
 * @param {string} src
 * @param {number} open
 * @returns {number}
 */
function closingMarker(src, open) {
  const c = src[open];
  let breaks = 0;
  for (let j = open + 2; j < src.length; j++) {
    if (src[j] === "\n" && ++breaks > 1) return -1;
    if (src[j] === c && !/\s/.test(src[j - 1]) && (j + 1 === src.length || POST.test(src[j + 1]))) return j;
  }
  return -1;
}

/**
 * Plain text of inline nodes (no markup).
 * @param {Array<object>} nodes
 * @returns {string}
 */
export function inlineText(nodes) {
  return nodes.map((n) => {
    if (n.t === "text" || n.t === "code" || n.t === "verbatim") return n.v;
    if (n.t === "link") return n.desc ? inlineText(n.desc) : n.target;
    if (n.t === "timestamp" || n.t === "cookie" || n.t === "math") return n.v;
    if (n.c) return inlineText(n.c);
    return n.t === "br" ? " " : "";
  }).join("");
}

const HEADING = /^(\*+)(?:[ \t]+(.*))?$/;
const BEGIN = /^(\s*)#\+BEGIN_(\S+)(?:[ \t]+(.*))?$/i;
const ITEM = /^(\s*)([-+*]|\d+[.)])(?:[ \t]+(.*))?$/;
const PLANNING = /^\s*(?:(?:SCHEDULED|DEADLINE|CLOSED):\s*[<[][^>\]]*[>\]]\s*)+$/;
const BLANK = /^\s*$/;
const indentOf = (l) => /^\s*/.exec(l)[0].length;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Remove the common leading indentation of the non-blank lines.
 * @param {string[]} lines
 * @param {number} [fixed] strip exactly up to this many leading spaces instead
 * @returns {string[]}
 */
function dedent(lines, fixed) {
  const n = fixed ?? Math.min(Infinity, ...lines.filter((l) => !BLANK.test(l)).map(indentOf));
  if (!Number.isFinite(n) || n === 0) return lines;
  return lines.map((l) => l.replace(new RegExp(`^\\s{0,${n}}`), ""));
}

/**
 * Parse an Org document.
 * @param {string} text the whole file
 * @returns {{keywords: Object<string, string[]>, title: string, startup: string[],
 *   todo: {todo: string[], done: string[]}, blocks: object[], children: object[],
 *   footnotes: Array<{label: string, children: object[]}>}}
 *   `children` are level-1 sections; each section is `{type: "section", level, todo, priority,
 *   comment, title, titleText, tags, planning, properties, blocks, children, slug}`
 */
export function parseOrg(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const doc = { keywords: {}, title: "", startup: [], todo: { todo: ["TODO"], done: ["DONE"] }, blocks: [], children: [], footnotes: [] };
  scanKeywords(lines, doc);
  doc.title = (doc.keywords.TITLE || []).slice(-1)[0] || "";

  // split into sections, never treating a line inside #+BEGIN/#+END as a heading
  const root = { level: 0, lines: [], children: [] };
  const stack = [root];
  let inBlock = null;
  for (const line of lines) {
    let m;
    if (!inBlock && (m = HEADING.exec(line))) {
      const sec = { level: m[1].length, raw: m[2] || "", lines: [], children: [] };
      while (stack[stack.length - 1].level >= sec.level) stack.pop();
      stack[stack.length - 1].children.push(sec);
      stack.push(sec);
      continue;
    }
    if (!inBlock && (m = /^\s*#\+BEGIN_(\S+)/i.exec(line))) inBlock = m[1].toUpperCase();
    else if (inBlock && (m = /^\s*#\+END_(\S+)/i.exec(line)) && m[1].toUpperCase() === inBlock) inBlock = null;
    stack[stack.length - 1].lines.push(line);
  }
  doc.blocks = parseBody(root.lines, doc);
  doc.children = root.children.map((s) => finishSection(s, doc));
  assignSlugs(doc.children, new Map());
  return doc;
}

/**
 * Collect `#+KEY: value` lines (outside blocks) into `doc.keywords`, plus the TODO
 * keyword sets and `#+STARTUP` options.
 * @param {string[]} lines
 * @param {object} doc filled in place
 * @returns {void}
 */
function scanKeywords(lines, doc) {
  let inBlock = null;
  const todo = [], done = [];
  for (const line of lines) {
    let m;
    if (!inBlock && (m = /^\s*#\+BEGIN_(\S+)/i.exec(line))) { inBlock = m[1].toUpperCase(); continue; }
    if (inBlock) { if ((m = /^\s*#\+END_(\S+)/i.exec(line)) && m[1].toUpperCase() === inBlock) inBlock = null; continue; }
    if (!(m = /^\s*#\+(\w+):[ \t]*(.*)$/.exec(line))) continue;
    const key = m[1].toUpperCase();
    (doc.keywords[key] ||= []).push(m[2].trim());
    if (key === "STARTUP") doc.startup.push(...m[2].trim().toLowerCase().split(/\s+/));
    if (key === "TODO" || key === "SEQ_TODO" || key === "TYP_TODO") {
      const words = m[2].trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/\(.*\)$/, ""));
      const bar = words.indexOf("|");
      if (bar >= 0) { todo.push(...words.slice(0, bar)); done.push(...words.slice(bar + 1)); }
      else if (words.length) { todo.push(...words.slice(0, -1)); done.push(words[words.length - 1]); }
    }
  }
  if (todo.length || done.length) doc.todo = { todo, done };
}

/**
 * Turn a raw section (heading text and body lines) into the final section node.
 * @param {{level: number, raw: string, lines: string[], children: object[]}} raw
 * @param {object} doc
 * @returns {object}
 */
function finishSection(raw, doc) {
  const head = parseHeading(raw.raw, doc);
  const sec = { type: "section", level: raw.level, ...head, planning: [], properties: {}, blocks: [], children: [], slug: "" };
  let body = raw.lines;
  let k = 0;
  if (body[0] !== undefined && PLANNING.test(body[0])) {
    for (const m of body[0].matchAll(/(SCHEDULED|DEADLINE|CLOSED):\s*([<[][^>\]]*[>\]])/g)) {
      sec.planning.push({ kind: m[1], ts: m[2], active: m[2][0] === "<" });
    }
    k = 1;
  }
  if (body[k] !== undefined && body[k].trim().toUpperCase() === ":PROPERTIES:") {
    let e = k + 1;
    while (e < body.length && body[e].trim().toUpperCase() !== ":END:") e++;
    for (const l of body.slice(k + 1, e)) {
      const m = /^\s*:([^:\s]+)\+?:\s*(.*)$/.exec(l);
      if (m) sec.properties[m[1].toUpperCase()] = m[2].trim();
    }
    k = Math.min(e + 1, body.length);
  }
  body = body.slice(k);
  sec.blocks = parseBody(body, doc);
  sec.children = raw.children.map((s) => finishSection(s, doc));
  return sec;
}

/**
 * Split the text after the stars into keyword, priority, title and tags.
 * @param {string} rest
 * @param {object} doc parsed document, for its TODO keyword sets (`doc.todo`)
 * @returns {{todo: ?{keyword: string, done: boolean}, priority: ?string, comment: boolean,
 *   title: object[], titleText: string, tags: string[]}}
 */
function parseHeading(rest, doc) {
  let s = rest;
  let tags = [];
  const tm = /(?:^|\s+)(:[^\s:]+(?::[^\s:]+)*:)\s*$/.exec(s);
  if (tm) { tags = tm[1].slice(1, -1).split(":"); s = s.slice(0, tm.index); }
  s = s.trim();
  let todo = null;
  const km = /^(\S+)(?:\s+|$)/.exec(s);
  if (km && (doc.todo.todo.includes(km[1]) || doc.todo.done.includes(km[1]))) {
    todo = { keyword: km[1], done: doc.todo.done.includes(km[1]) };
    s = s.slice(km[0].length);
  }
  let priority = null;
  const pm = /^\[#([A-Za-z0-9]+)\]\s*/.exec(s);
  if (pm) { priority = pm[1]; s = s.slice(pm[0].length); }
  let comment = false;
  const cm = /^COMMENT(?:\s+|$)/.exec(s);
  if (cm) { comment = true; s = s.slice(cm[0].length); }
  const title = parseInline(s);
  return { todo, priority, comment, title, titleText: inlineText(title), tags };
}

/**
 * Give every section a unique, URL-safe id (the CUSTOM_ID property wins).
 * @param {object[]} sections
 * @param {Map<string, number>} seen
 * @returns {void}
 */
function assignSlugs(sections, seen) {
  for (const s of sections) {
    const base = s.properties.CUSTOM_ID || (s.titleText.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "section");
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    s.slug = n ? `${base}-${n}` : base;
    assignSlugs(s.children, seen);
  }
}

/**
 * Parse body lines (between headings) into blocks.
 * @param {string[]} lines
 * @param {object} doc receives footnote definitions
 * @returns {object[]} blocks: paragraph, list, table, src, example, quote, center, verse,
 *   comment, drawer, special, fixed, math, hr
 */
function parseBody(lines, doc) {
  const blocks = [];
  let affil = {};
  let i = 0;
  const take = (block) => { blocks.push(Object.keys(affil).length ? { ...block, ...affil } : block); affil = {}; };
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (BLANK.test(line)) { i++; continue; }

    if ((m = /^\s*#\+(\w+):[ \t]*(.*)$/.exec(line))) {
      const key = m[1].toLowerCase();
      if (key === "caption" || key === "name") affil[key] = m[2].trim();
      i++;
      continue;
    }
    if ((m = BEGIN.exec(line))) {
      const end = new RegExp(`^\\s*#\\+END_${escapeRe(m[2])}\\s*$`, "i");
      let j = i + 1;
      while (j < lines.length && !end.test(lines[j])) j++;
      const inner = dedent(lines.slice(i + 1, j), m[1].length);
      while (inner.length && BLANK.test(inner[inner.length - 1])) inner.pop();
      const params = (m[3] || "").trim();
      const name = m[2].toLowerCase();
      if (name === "src") take({ type: "src", lang: params.split(/\s+/)[0] || "", params, text: inner.join("\n") });
      else if (name === "example" || name === "export") take({ type: "example", text: inner.join("\n") });
      else if (name === "quote" || name === "center") take({ type: name, children: parseBody(inner, doc) });
      else if (name === "verse") take({ type: "verse", lines: inner });
      else if (name === "comment") take({ type: "comment", text: inner.join("\n") });
      else take({ type: "special", name, children: parseBody(inner, doc) });
      i = j + 1;
      continue;
    }
    if ((m = /^\s*:([\w-]+):\s*$/.exec(line)) && m[1].toUpperCase() !== "END") {
      let j = i + 1;
      while (j < lines.length && lines[j].trim().toUpperCase() !== ":END:") j++;
      if (j < lines.length) {
        take({ type: "drawer", name: m[1], children: parseBody(dedent(lines.slice(i + 1, j)), doc) });
        i = j + 1;
        continue;
      }
    }
    if (/^\s*#(\s|$)/.test(line)) {
      const text = [];
      while (i < lines.length && /^\s*#(\s|$)/.test(lines[i])) text.push(lines[i++].replace(/^\s*#\s?/, ""));
      take({ type: "comment", text: text.join("\n") });
      continue;
    }
    if (/^\s*-{5,}\s*$/.test(line)) { take({ type: "hr" }); i++; continue; }
    if (/^\s*:(\s|$)/.test(line)) {
      const text = [];
      while (i < lines.length && /^\s*:(\s|$)/.test(lines[i])) text.push(lines[i++].replace(/^\s*:\s?/, ""));
      take({ type: "fixed", text: text.join("\n") });
      continue;
    }
    if ((m = /^\s*\\begin\{([A-Za-z]+\*?)\}/.exec(line))) {
      const end = new RegExp(`^\\s*\\\\end\\{${escapeRe(m[1])}\\}`);
      let j = i + 1;
      while (j < lines.length && !end.test(lines[j])) j++;
      if (j < lines.length) {
        take({ type: "math", text: dedent(lines.slice(i, j + 1), indentOf(line)).join("\n") });
        i = j + 1;
        continue;
      }
    }
    if ((m = /^\[fn:([\w-]+)\][ \t]*(.*)$/.exec(line))) {
      const body = [m[2]];
      i++;
      while (i < lines.length && !BLANK.test(lines[i]) && !/^\[fn:[\w-]+\]/.test(lines[i])) body.push(lines[i++]);
      doc.footnotes.push({ label: m[1], children: parseBody(body, doc) });
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*(\||#\+TBLFM)/i.test(lines[i])) { if (lines[i].trim()[0] === "|") rows.push(lines[i]); i++; }
      take(parseTable(rows));
      continue;
    }
    if (isItem(line)) {
      const r = parseList(lines, i, doc);
      take(r.block);
      i = r.next;
      continue;
    }
    const para = [line.trimStart()];
    i++;
    while (i < lines.length && !BLANK.test(lines[i]) && !interrupts(lines[i])) para.push(lines[i++].trimStart());
    take({ type: "paragraph", inline: parseInline(para.join("\n")) });
  }
  return blocks;
}

/**
 * @param {string} line
 * @returns {boolean} true if the line starts a list item (a `*` bullet needs indentation,
 *   otherwise it is a heading)
 */
function isItem(line) {
  const m = ITEM.exec(line);
  return !!m && !(m[2] === "*" && m[1].length === 0) && !/^\s*-{5,}\s*$/.test(line);
}

/**
 * @param {string} line
 * @returns {boolean} true if the line ends a running paragraph
 */
function interrupts(line) {
  return isItem(line) || /^\s*(\||#\+|:[\w-]+:\s*$|-{5,}\s*$|\\begin\{)|^\[fn:[\w-]+\]/.test(line);
}

/**
 * Parse the `|`-lines of a table. Rows before the first `|---+---|` rule are the header.
 * @param {string[]} rows
 * @returns {{type: "table", header: object[][][], body: object[][][]}} rows of cells of inline nodes
 */
function parseTable(rows) {
  const data = [];
  let rule = -1;
  for (const r of rows) {
    if (/^\s*\|[-+]+\|?\s*$/.test(r)) { if (rule < 0) rule = data.length; continue; }
    const cells = r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => parseInline(c.trim()));
    data.push(cells);
  }
  return rule > 0 ? { type: "table", header: data.slice(0, rule), body: data.slice(rule) } : { type: "table", header: [], body: data };
}

/**
 * Parse one list starting at `lines[i]` (items at the same indentation, with nested content).
 * @param {string[]} lines
 * @param {number} i index of the first item
 * @param {object} doc
 * @returns {{block: object, next: number}} the list block and the index after it
 */
function parseList(lines, i, doc) {
  const first = ITEM.exec(lines[i]);
  const base = first[1].length;
  const ordered = /\d/.test(first[2][0]);
  const items = [];
  let j = i;
  while (j < lines.length) {
    const m = ITEM.exec(lines[j]);
    if (!m || m[1].length !== base || (m[2] === "*" && base === 0) || /\d/.test(m[2][0]) !== ordered) break;
    const body = [];
    let k = j + 1;
    while (k < lines.length) {
      const l = lines[k];
      if (BLANK.test(l)) {
        let n = k + 1;
        while (n < lines.length && BLANK.test(lines[n])) n++;
        if (n < lines.length && indentOf(lines[n]) > base) { body.push(l); k++; continue; }
        break;
      }
      if (indentOf(l) > base) { body.push(l); k++; continue; }
      break;
    }
    let text = m[3] || "";
    let checkbox = null;
    const cb = /^\[([ Xx-])\](?:\s+|$)/.exec(text);
    if (cb) { checkbox = cb[1] === " " ? "off" : cb[1] === "-" ? "partial" : "on"; text = text.slice(cb[0].length); }
    let term = null;
    const dm = /^(.*?)\s+::(?:\s+(.*))?$/.exec(text);
    if (dm && !/\d/.test(m[2][0])) { term = parseInline(dm[1]); text = dm[2] || ""; }
    items.push({ checkbox, term, children: parseBody([text, ...dedent(body)], doc) });
    let n = k;
    while (n < lines.length && BLANK.test(lines[n])) n++;
    const nm = n < lines.length ? ITEM.exec(lines[n]) : null;
    // like Org, two blank lines end a list; a different bullet kind starts a new one
    if (nm && n - k < 2 && nm[1].length === base && !(nm[2] === "*" && base === 0) && /\d/.test(nm[2][0]) === ordered) j = n;
    else { j = k; break; }
  }
  return { block: { type: "list", ordered, description: items.some((it) => it.term), items }, next: j };
}
