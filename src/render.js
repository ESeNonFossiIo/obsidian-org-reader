// Turns the parsed document (parser.js) into DOM. Only DOM APIs and textContent are used,
// never innerHTML. Links and images are resolved through callbacks so this file does not
// depend on Obsidian.
const IMAGE = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i;
const EXTERNAL = /^(https?|ftp|mailto):/i;

/**
 * @typedef {object} RenderOptions
 * @property {boolean} showProperties show `:PROPERTIES:` drawers
 * @property {boolean} showComments show `#` comments and COMMENT blocks
 * @property {boolean} honorStartup apply `#+STARTUP: overview|content` when opening
 * @property {(link: {kind: "file"|"heading", path?: string, search?: string, slug?: string, title?: string}) => void} onLink
 * @property {(path: string) => ?string} imageSrc URL for a local image path, or null
 * @property {?((source: string, display: boolean) => HTMLElement)} renderMath typesets a LaTeX
 *   fragment; when null, fragments are shown as written
 */

/**
 * Create an element.
 * @param {string} tag
 * @param {string} [cls] space-separated classes
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * Render a whole document into `root` (which is emptied first).
 * @param {object} doc result of parseOrg
 * @param {HTMLElement} root
 * @param {RenderOptions} opts
 * @returns {void}
 */
export function renderDocument(doc, root, opts) {
  root.replaceChildren();
  const ctx = { opts, doc };
  if (doc.title) root.append(h("h1", "org-doc-title", doc.title));
  const meta = ["AUTHOR", "DATE", "EMAIL"].flatMap((k) => (doc.keywords[k] || []).slice(-1));
  if (meta.length) root.append(h("div", "org-doc-meta", meta.join(" · ")));
  renderBlocks(doc.blocks, root, ctx);
  for (const s of doc.children) root.append(renderSection(s, ctx));
  if (doc.footnotes.length) {
    const box = h("section", "org-footnotes");
    box.append(h("h2", "org-footnotes-title", "Footnotes"));
    for (const f of doc.footnotes) {
      const row = h("div", "org-footnote");
      row.id = `org-fn-${f.label}`;
      row.append(h("sup", "org-footnote-label", f.label));
      const body = h("div", "org-footnote-body");
      renderBlocks(f.children, body, ctx);
      row.append(body);
      box.append(row);
    }
    root.append(box);
  }
  if (opts.honorStartup) {
    if (doc.startup.includes("overview")) setFold(root, "overview");
    else if (doc.startup.includes("content")) setFold(root, "content");
  }
}

/**
 * Fold or unfold every section.
 * @param {HTMLElement} root the element holding the rendered document
 * @param {"overview"|"content"|"all"} mode overview: top-level headings only; content: all
 *   headings, no text; all: everything open
 * @returns {void}
 */
export function setFold(root, mode) {
  for (const sec of root.querySelectorAll(".org-section")) {
    sec.classList.remove("is-folded", "is-body-folded");
    if (mode === "overview" && sec.classList.contains("org-level-1")) sec.classList.add("is-folded");
    if (mode === "content") sec.classList.add("is-body-folded");
  }
}

/**
 * @param {object} sec parsed section
 * @param {{opts: RenderOptions}} ctx
 * @returns {HTMLElement}
 */
function renderSection(sec, ctx) {
  const el = h("section", `org-section org-level-${Math.min(sec.level, 8)}`);
  el.dataset.slug = sec.slug;
  el.dataset.title = sec.titleText.toLowerCase();
  if (sec.comment) el.classList.add("is-comment");
  const head = h(`h${Math.min(sec.level, 6)}`, "org-heading");
  head.id = `org-${sec.slug}`;
  const fold = h("button", "org-fold clickable-icon");
  fold.type = "button";
  fold.setAttribute("aria-label", "Fold or unfold");
  fold.addEventListener("click", () => {
    if (el.classList.contains("is-folded")) el.classList.remove("is-folded");
    else if (el.classList.contains("is-body-folded")) el.classList.remove("is-body-folded");
    else el.classList.add("is-folded");
  });
  head.append(fold);
  if (sec.todo) head.append(h("span", `org-todo ${sec.todo.done ? "is-done" : "is-todo"} org-kw-${sec.todo.keyword.toLowerCase()}`, sec.todo.keyword));
  if (sec.priority) head.append(h("span", `org-priority org-priority-${sec.priority.toLowerCase()}`, sec.priority));
  const title = h("span", "org-title");
  renderInline(sec.title, title, ctx);
  head.append(title);
  if (sec.tags.length) {
    const tags = h("span", "org-tags");
    for (const t of sec.tags) tags.append(h("span", "org-tag", t));
    head.append(tags);
  }
  el.append(head);
  if (sec.planning.length) {
    const row = h("div", "org-planning");
    for (const p of sec.planning) {
      const item = h("span", "org-planning-item");
      item.append(h("span", "org-planning-kind", p.kind.toLowerCase()), h("span", `org-timestamp${p.active ? " is-active" : ""}`, p.ts.slice(1, -1)));
      row.append(item);
    }
    el.append(row);
  }
  const body = h("div", "org-body");
  const props = Object.entries(sec.properties);
  if (ctx.opts.showProperties && props.length) {
    const t = h("table", "org-properties");
    for (const [k, v] of props) { const tr = h("tr"); tr.append(h("th", "", k), h("td", "", v)); t.append(tr); }
    body.append(t);
  }
  renderBlocks(sec.blocks, body, ctx);
  el.append(body);
  if (sec.children.length) {
    const kids = h("div", "org-children");
    for (const c of sec.children) kids.append(renderSection(c, ctx));
    el.append(kids);
  }
  return el;
}

/**
 * @param {object[]} blocks
 * @param {HTMLElement} parent
 * @param {{opts: RenderOptions}} ctx
 * @returns {void}
 */
function renderBlocks(blocks, parent, ctx) {
  for (const b of blocks) {
    const el = renderBlock(b, ctx);
    if (el) parent.append(el);
  }
}

/**
 * @param {object} b parsed block
 * @param {{opts: RenderOptions}} ctx
 * @returns {?HTMLElement} null for blocks that are hidden by the settings
 */
function renderBlock(b, ctx) {
  switch (b.type) {
    case "paragraph": { const p = h("p", "org-paragraph"); renderInline(b.inline, p, ctx); return captioned(b, p, "figure"); }
    case "hr": return h("hr", "org-hr");
    case "comment": {
      if (!ctx.opts.showComments) return null;
      return h("pre", "org-comment", b.text);
    }
    case "fixed": return h("pre", "org-fixed", b.text);
    case "math": {
      const d = h("div", "org-math");
      d.append(ctx.opts.renderMath ? ctx.opts.renderMath(b.text, true) : h("pre", "org-math-source", b.text));
      return d;
    }
    case "example": return captioned(b, h("pre", "org-example", b.text), "figure");
    case "src": {
      const pre = h("pre", "org-src");
      if (b.lang) { pre.dataset.lang = b.lang; pre.append(h("span", "org-src-lang", b.lang)); }
      pre.append(h("code", b.lang ? `language-${b.lang}` : "", b.text));
      return captioned(b, pre, "figure");
    }
    case "quote": { const q = h("blockquote", "org-quote"); renderBlocks(b.children, q, ctx); return q; }
    case "center": { const c = h("div", "org-center"); renderBlocks(b.children, c, ctx); return c; }
    case "special": {
      const d = h("div", `org-special org-special-${b.name}`);
      d.append(h("div", "org-special-name", b.name));
      renderBlocks(b.children, d, ctx);
      return d;
    }
    case "verse": {
      const v = h("div", "org-verse");
      for (const line of b.lines) v.append(h("div", "org-verse-line", line.trim() === "" ? " " : line));
      return v;
    }
    case "drawer": {
      const d = h("details", "org-drawer");
      d.append(h("summary", "", b.name.toLowerCase()));
      renderBlocks(b.children, d, ctx);
      return d;
    }
    case "list": return renderList(b, ctx);
    case "table": return renderTable(b, ctx);
    default: return null;
  }
}

/**
 * Wrap an element in a figure with a caption when the block had `#+CAPTION:`.
 * @param {object} b
 * @param {HTMLElement} el
 * @param {string} tag
 * @returns {HTMLElement}
 */
function captioned(b, el, tag) {
  if (!b.caption) return el;
  const fig = h(tag, "org-figure");
  fig.append(el, h("figcaption", "org-caption", b.caption));
  return fig;
}

/**
 * @param {object} list
 * @param {{opts: RenderOptions}} ctx
 * @returns {HTMLElement}
 */
function renderList(list, ctx) {
  const el = h(list.description ? "dl" : list.ordered ? "ol" : "ul", `org-list${list.description ? " org-dl" : ""}`);
  for (const it of list.items) {
    if (list.description) {
      const dt = h("dt", "org-dt");
      renderInline(it.term || [], dt, ctx);
      const dd = h("dd", "org-dd");
      renderBlocks(it.children, dd, ctx);
      el.append(dt, dd);
      continue;
    }
    const li = h("li", "org-item");
    if (it.checkbox) {
      li.classList.add("org-task", `is-${it.checkbox}`);
      const box = h("input", "org-checkbox task-list-item-checkbox");
      box.type = "checkbox";
      box.disabled = true;
      box.checked = it.checkbox === "on";
      box.indeterminate = it.checkbox === "partial";
      li.append(box);
    }
    const body = h("div", "org-item-body");
    renderBlocks(it.children, body, ctx);
    li.append(body);
    el.append(li);
  }
  return el;
}

/**
 * @param {object} t table block
 * @param {{opts: RenderOptions}} ctx
 * @returns {HTMLElement}
 */
function renderTable(t, ctx) {
  const table = h("table", "org-table");
  const rows = (list, tag, into) => {
    for (const row of list) {
      const tr = h("tr");
      for (const cell of row) { const c = h(tag); renderInline(cell, c, ctx); tr.append(c); }
      into.append(tr);
    }
  };
  if (t.header.length) { const head = h("thead"); rows(t.header, "th", head); table.append(head); }
  const body = h("tbody");
  rows(t.body, "td", body);
  table.append(body);
  if (!t.caption) return wrapScroll(table);
  const fig = h("figure", "org-figure");
  fig.append(wrapScroll(table), h("figcaption", "org-caption", t.caption));
  return fig;
}

/**
 * @param {HTMLElement} table
 * @returns {HTMLElement} a horizontally scrollable wrapper (wide tables on phones)
 */
function wrapScroll(table) {
  const w = h("div", "org-table-wrap");
  w.append(table);
  return w;
}

/**
 * Render inline nodes into `parent`.
 * @param {object[]} nodes
 * @param {HTMLElement} parent
 * @param {{opts: RenderOptions}} ctx
 * @returns {void}
 */
function renderInline(nodes, parent, ctx) {
  for (const n of nodes) {
    switch (n.t) {
      case "text": parent.append(document.createTextNode(n.v.replace(/\n/g, " "))); break;
      case "bold": { const e = h("strong"); renderInline(n.c, e, ctx); parent.append(e); break; }
      case "italic": { const e = h("em"); renderInline(n.c, e, ctx); parent.append(e); break; }
      case "underline": { const e = h("span", "org-underline"); renderInline(n.c, e, ctx); parent.append(e); break; }
      case "strike": { const e = h("s"); renderInline(n.c, e, ctx); parent.append(e); break; }
      case "code": parent.append(h("code", "org-code", n.v)); break;
      case "verbatim": parent.append(h("code", "org-verbatim", n.v)); break;
      case "br": parent.append(h("br")); break;
      case "math": parent.append(ctx.opts.renderMath ? ctx.opts.renderMath(n.v, n.display) : h("code", "org-math-source", n.raw)); break;
      case "cookie": parent.append(h("span", "org-cookie", `[${n.v}]`)); break;
      case "timestamp": parent.append(h("span", `org-timestamp${n.active ? " is-active" : ""}`, n.v.replace(/[<>[\]]/g, ""))); break;
      case "footref": {
        const sup = h("sup", "org-footref");
        const a = h("a", "org-footref-link", n.label || "*");
        a.href = `#org-fn-${n.label}`;
        a.addEventListener("click", (e) => { e.preventDefault(); const t = document.getElementById(`org-fn-${n.label}`); if (t) t.scrollIntoView({ block: "center" }); });
        sup.append(a);
        parent.append(sup);
        break;
      }
      case "link": parent.append(renderLink(n, ctx)); break;
      default: break;
    }
  }
}

/**
 * Decide what a link target means.
 * @param {string} target
 * @returns {{kind: "external", url: string}|{kind: "file", path: string, search?: string}|{kind: "heading", slug?: string, title?: string}}
 */
export function resolveLink(target) {
  if (EXTERNAL.test(target)) return { kind: "external", url: target };
  let m;
  if ((m = /^file:(.*?)(?:::(.*))?$/.exec(target))) return { kind: "file", path: m[1], search: m[2] };
  if (target.startsWith("#")) return { kind: "heading", slug: target.slice(1) };
  if (target.startsWith("*")) return { kind: "heading", title: target.slice(1).trim().toLowerCase() };
  if (/^(\.{0,2}\/|~\/)|\.[A-Za-z0-9]{1,5}(::.*)?$/.test(target) && !/\s{2,}/.test(target)) {
    const [path, search] = target.split("::");
    return { kind: "file", path, search };
  }
  return { kind: "heading", title: target.trim().toLowerCase() };
}

/**
 * @param {{target: string, desc: ?object[]}} n link node
 * @param {{opts: RenderOptions}} ctx
 * @returns {HTMLElement}
 */
function renderLink(n, ctx) {
  const r = resolveLink(n.target);
  if (!n.desc && r.kind === "file" && IMAGE.test(r.path)) {
    const src = ctx.opts.imageSrc(r.path);
    if (src) { const img = h("img", "org-image"); img.src = src; img.alt = r.path; return img; }
  }
  const a = h("a", r.kind === "external" ? "org-link external-link" : "org-link internal-link");
  if (n.desc) renderInline(n.desc, a, ctx);
  else a.textContent = r.kind === "file" ? r.path : n.target.replace(/^[#*]/, "");
  if (r.kind === "external") {
    a.href = r.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  } else {
    a.href = "#";
    a.addEventListener("click", (e) => { e.preventDefault(); ctx.opts.onLink(r); });
  }
  return a;
}
