// Unit tests for src/parser.js. Run with `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseOrg, inlineText } from "../src/parser.js";

const types = (nodes) => nodes.map((n) => n.t);

test("inline: emphasis markers", () => {
  const n = parseInline("a *bold* /it/ _un_ +del+ =verb= ~code~ z");
  assert.deepEqual(types(n).filter((t) => t !== "text"), ["bold", "italic", "underline", "strike", "verbatim", "code"]);
  assert.equal(inlineText(n), "a bold it un del verb code z");
});

test("inline: markers need word boundaries and non-space content", () => {
  assert.deepEqual(types(parseInline("2 * 3 * 4")), ["text"]);
  assert.deepEqual(types(parseInline("a*b*c")), ["text"]);
  assert.deepEqual(types(parseInline("path/to/file and a/b")), ["text"]);
  assert.deepEqual(types(parseInline("** not bold **")), ["text"]);
});

test("inline: nesting and verbatim content is not parsed", () => {
  const n = parseInline("*bold /and italic/*");
  assert.equal(n[0].t, "bold");
  assert.deepEqual(types(n[0].c), ["text", "italic"]);
  assert.equal(parseInline("=*not bold*=")[0].v, "*not bold*");
});

test("inline: links with and without description, escaped brackets", () => {
  const [a, b] = parseInline("[[https://x.org][the *site*]] and [[file:a.org]]");
  assert.equal(a.target, "https://x.org");
  assert.deepEqual(types(a.desc), ["text", "bold"]);
  assert.equal(b.t, "text");
  const l = parseInline("[[file:a.org]]")[0];
  assert.deepEqual([l.t, l.target, l.desc], ["link", "file:a.org", null]);
});

test("inline: bare URLs lose trailing punctuation", () => {
  const n = parseInline("see https://example.com/a?b=1, ok");
  assert.equal(n[1].target, "https://example.com/a?b=1");
  assert.equal(n[2].v, ", ok");
});

test("inline: timestamps, ranges, footnote refs, cookies, line breaks", () => {
  assert.deepEqual(parseInline("<2026-10-20 Tue 10:00>")[0], { t: "timestamp", v: "<2026-10-20 Tue 10:00>", active: true });
  assert.equal(parseInline("[2026-10-20 Tue]")[0].active, false);
  const r = parseInline("<2026-10-20 Tue>--<2026-10-22 Thu>");
  assert.equal(r.length, 1);
  assert.equal(r[0].v, "<2026-10-20 Tue>--<2026-10-22 Thu>");
  assert.equal(parseInline("x[fn:1]")[1].label, "1");
  assert.deepEqual(parseInline("[2/5] [40%]").filter((n) => n.t === "cookie").map((n) => n.v), ["2/5", "40%"]);
  assert.deepEqual(types(parseInline("one\\\\\ntwo")), ["text", "br", "text"]);
});

test("headings: keyword, priority, tags, nesting and slugs", () => {
  const d = parseOrg("* TODO [#A] Write *docs* :work:home:\n** DONE Sub\n* Plain\n** Plain\n");
  const [a, b] = d.children;
  assert.deepEqual([a.todo.keyword, a.todo.done, a.priority, a.tags, a.titleText], ["TODO", false, "A", ["work", "home"], "Write docs"]);
  assert.equal(a.children[0].todo.done, true);
  assert.deepEqual([a.slug, b.slug, b.children[0].slug], ["write-docs", "plain", "plain-1"]);
});

test("headings: custom TODO keywords and COMMENT", () => {
  const d = parseOrg("#+TODO: NEXT WAIT | FINISHED\n* NEXT a\n* FINISHED b\n* TODO c\n* COMMENT d\n");
  assert.deepEqual(d.children.map((s) => s.todo && s.todo.keyword), ["NEXT", "FINISHED", null, null]);
  assert.equal(d.children[1].todo.done, true);
  assert.equal(d.children[3].comment, true);
});

test("headings: stars inside a block or without a space are not headings", () => {
  const d = parseOrg("* A\n#+BEGIN_SRC org\n* not a heading\n#+END_SRC\n*bold* text\n");
  assert.equal(d.children.length, 1);
  assert.equal(d.children[0].blocks[0].type, "src");
  assert.equal(d.children[0].blocks[1].type, "paragraph");
});

test("sections: planning and property drawer", () => {
  const d = parseOrg("* T\nSCHEDULED: <2026-10-20 Tue> DEADLINE: <2026-10-25 Sun>\n:PROPERTIES:\n:CUSTOM_ID: my-id\n:Effort: 2h\n:END:\nBody\n");
  const s = d.children[0];
  assert.deepEqual(s.planning.map((p) => p.kind), ["SCHEDULED", "DEADLINE"]);
  assert.deepEqual(s.properties, { CUSTOM_ID: "my-id", EFFORT: "2h" });
  assert.equal(s.slug, "my-id");
  assert.equal(s.blocks[0].type, "paragraph");
});

test("document keywords and startup", () => {
  const d = parseOrg("#+TITLE: Notes\n#+STARTUP: overview hidestars\n#+AUTHOR: Me\n\nIntro\n* H\n");
  assert.equal(d.title, "Notes");
  assert.deepEqual(d.startup, ["overview", "hidestars"]);
  assert.equal(d.keywords.AUTHOR[0], "Me");
  assert.equal(d.blocks[0].type, "paragraph");
});

test("paragraphs: soft line breaks stay inside one paragraph", () => {
  const d = parseOrg("one\ntwo\n\nthree\n");
  assert.equal(d.blocks.length, 2);
  assert.equal(inlineText(d.blocks[0].inline), "one\ntwo");
});

test("lists: bullets, ordered, checkboxes, descriptions", () => {
  const d = parseOrg("- [ ] a\n- [X] b\n- [-] c\n\n1. one\n2) two\n\n- term :: meaning\n");
  const [l1, l2, l3] = d.blocks;
  assert.deepEqual(l1.items.map((i) => i.checkbox), ["off", "on", "partial"]);
  assert.equal(l2.ordered, true);
  assert.equal(l2.items.length, 2);
  assert.equal(l3.description, true);
  assert.equal(inlineText(l3.items[0].term), "term");
  assert.equal(inlineText(l3.items[0].children[0].inline), "meaning");
});

test("lists: nesting by indentation, continuation lines and paragraphs", () => {
  const d = parseOrg("- a\n  continued\n  - nested 1\n  - nested 2\n- b\n\n  second paragraph\n");
  const list = d.blocks[0];
  assert.equal(list.items.length, 2);
  const a = list.items[0].children;
  assert.equal(inlineText(a[0].inline), "a\ncontinued");
  assert.equal(a[1].type, "list");
  assert.equal(a[1].items.length, 2);
  assert.equal(list.items[1].children.length, 2);
});

test("lists: a '*' bullet needs indentation, '-----' is a rule", () => {
  const d = parseOrg("* H\n  * item\n-----\n");
  assert.equal(d.children[0].blocks[0].type, "list");
  assert.equal(d.children[0].blocks[1].type, "hr");
});

test("tables: header row before the rule", () => {
  const d = parseOrg("| a | b |\n|---+---|\n| 1 | *2* |\n#+TBLFM: $1=1\n");
  const t = d.blocks[0];
  assert.equal(t.type, "table");
  assert.equal(t.header.length, 1);
  assert.equal(t.body.length, 1);
  assert.equal(t.body[0][1][0].t, "bold");
  assert.equal(parseOrg("| a | b |\n| 1 | 2 |\n").blocks[0].header.length, 0);
});

test("blocks: src, example, quote, verse, center, special, comment", () => {
  const d = parseOrg([
    "#+CAPTION: demo", "#+BEGIN_SRC python :results output", "print(1)", "#+END_SRC",
    "#+begin_example", "raw *text*", "#+end_example",
    "#+BEGIN_QUOTE", "quoted *b*", "#+END_QUOTE",
    "#+BEGIN_VERSE", "line 1", "  line 2", "#+END_VERSE",
    "#+BEGIN_CENTER", "mid", "#+END_CENTER",
    "#+BEGIN_NOTE", "careful", "#+END_NOTE",
    "#+BEGIN_COMMENT", "hidden", "#+END_COMMENT",
  ].join("\n"));
  assert.deepEqual(d.blocks.map((b) => b.type), ["src", "example", "quote", "verse", "center", "special", "comment"]);
  assert.deepEqual([d.blocks[0].lang, d.blocks[0].text, d.blocks[0].caption], ["python", "print(1)", "demo"]);
  assert.equal(d.blocks[1].text, "raw *text*");
  assert.equal(d.blocks[2].children[0].inline[1].t, "bold");
  assert.deepEqual(d.blocks[3].lines, ["line 1", "  line 2"]);
  assert.equal(d.blocks[5].name, "note");
});

test("blocks: indented blocks are dedented, unterminated blocks run to the end", () => {
  const d = parseOrg("  #+BEGIN_SRC js\n  let a;\n  #+END_SRC\n#+BEGIN_SRC sh\nls\n");
  assert.equal(d.blocks[0].text, "let a;");
  assert.equal(d.blocks[1].text, "ls");
});

test("drawers, comments, fixed-width and footnotes", () => {
  const d = parseOrg(":LOGBOOK:\n- State \"DONE\"\n:END:\n# a comment\n: fixed\n: width\nText[fn:1]\n\n[fn:1] The note.\n");
  assert.deepEqual(d.blocks.map((b) => b.type), ["drawer", "comment", "fixed", "paragraph"]);
  assert.equal(d.blocks[0].name, "LOGBOOK");
  assert.equal(d.blocks[2].text, "fixed\nwidth");
  assert.equal(d.footnotes[0].label, "1");
  assert.equal(inlineText(d.footnotes[0].children[0].inline), "The note.");
});

test("robust: empty input, CRLF, only stars", () => {
  assert.deepEqual(parseOrg("").children, []);
  assert.equal(parseOrg("* A\r\n\r\ntext\r\n").children[0].blocks[0].type, "paragraph");
  assert.equal(parseOrg("*\n").children[0].titleText, "");
});

test("math: inline and display fragments", () => {
  const m = (s) => parseInline(s).filter((n) => n.t === "math");
  assert.deepEqual(m("a $x^2$ b").map((n) => [n.v, n.display]), [["x^2", false]]);
  assert.deepEqual(m("a \\(x_1\\) b").map((n) => [n.v, n.display]), [["x_1", false]]);
  assert.deepEqual(m("a \\[x+y\\] b").map((n) => [n.v, n.display]), [["x+y", true]]);
  assert.deepEqual(m("a $$x=1$$ b").map((n) => [n.v, n.display]), [["x=1", true]]);
  assert.equal(m("$a$")[0].raw, "$a$");
  assert.equal(inlineText(parseInline("sum $a_i$ here")), "sum a_i here");
});

test("math: Org's $ rules keep prices and stray dollars as text", () => {
  for (const s of ["costs $5 and $10 today", "a $ b $ c", "only $one dollar", "$ spaced$", "x$.", "$$unclosed"]) {
    assert.deepEqual(parseInline(s).filter((n) => n.t === "math"), [], s);
  }
  assert.equal(parseInline("($x$)").filter((n) => n.t === "math").length, 1);
});

test("math: fragments span lines, and markup around them still works", () => {
  const n = parseInline("*bold* and \\[a\n+ b\\] then =$not$= end");
  assert.deepEqual(types(n).filter((t) => t !== "text"), ["bold", "math", "verbatim"]);
  assert.equal(n[2].v, "a\n+ b");
});

test("math: environments are display blocks and interrupt paragraphs", () => {
  const d = parseOrg("text\n\\begin{equation}\nE = mc^2\n\\end{equation}\nafter\n\n  \\begin{align*}\na &= b\n  \\end{align*}\n\\begin{unclosed}\n");
  assert.deepEqual(d.blocks.map((b) => b.type), ["paragraph", "math", "paragraph", "math", "paragraph"]);
  assert.equal(d.blocks[1].text, "\\begin{equation}\nE = mc^2\n\\end{equation}");
  assert.match(d.blocks[3].text, /^\\begin\{align\*\}\na &= b\n/);
  assert.equal(inlineText(d.blocks[4].inline), "\\begin{unclosed}");
});

test("math: headings and list items can contain fragments", () => {
  const d = parseOrg("* Energy $E=mc^2$\n- item with $x$\n");
  assert.equal(d.children[0].title.filter((n) => n.t === "math").length, 1);
  assert.equal(d.children[0].blocks[0].items[0].children[0].inline.filter((n) => n.t === "math").length, 1);
});
