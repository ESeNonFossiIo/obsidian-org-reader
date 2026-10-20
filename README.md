# Org Reader

[![CI](https://github.com/ESeNonFossiIo/obsidian-org-reader/actions/workflows/ci.yml/badge.svg)](https://github.com/ESeNonFossiIo/obsidian-org-reader/actions/workflows/ci.yml)

Obsidian plugin that opens `.org` files in a clean, easy-to-read view. It has its own
Org parser and renderer, so it does not depend on any other Org plugin. A button in the
view header switches to the plain-text source for editing.

> Only one plugin can handle the `.org` extension. If you use
> [Orgmode (cm6)](https://github.com/bbazard/obsidian-orgmode-cm6), disable it first
> (Settings → Community plugins) and reload Obsidian. Org Reader shows a notice on
> startup when the extension is already taken.

## What it renders

| Org | Shown as |
| :--- | :--- |
| `* Heading`, `** Sub` | Collapsible headings with a size per level |
| `TODO` / `DONE`, custom `#+TODO:` words | Coloured keyword badges |
| `[#A]`, `:tag1:tag2:` | Priority and tag pills |
| `SCHEDULED:`, `DEADLINE:`, `CLOSED:`, `<2026-10-20 Tue>` | Date badges |
| `:PROPERTIES:` drawers | Hidden by default (setting); other drawers are collapsed |
| `*bold*` `/italic/` `_underline_` `+strike+` `=verbatim=` `~code~` | Inline formatting |
| `[[url][text]]`, `[[file:note.org]]`, `[[*Heading]]`, bare URLs | Links; file and heading links work inside Obsidian |
| `[[file:image.png]]` | The image from your vault |
| `- item`, `1. item`, `- [X] task`, `- term :: text` | Lists, nested lists, checkboxes, description lists |
| `\| a \| b \|` | Tables (rows above the `\|---+---\|` rule are the header) |
| `#+BEGIN_SRC`, `_EXAMPLE`, `_QUOTE`, `_VERSE`, `_CENTER`, `_COMMENT`, others | Code and text blocks |
| `[fn:1]` and `[fn:1] text` | Footnotes collected at the end |
| `#+TITLE`, `#+AUTHOR`, `#+DATE` | Page header |
| `#+STARTUP: overview` / `content` | Opens folded |
| `#+CAPTION:` | Figure captions for tables and blocks |

Not rendered: LaTeX fragments, sub/superscripts, inline source blocks, the agenda, table
formulas and Babel execution. Unknown syntax is shown as plain text, never dropped.
See [`examples/showcase.org`](examples/showcase.org) for a tour.

## Commands

Run from the command palette (`Ctrl+P`, prefix "Org Reader: ").

- **Toggle reading and source view**
- **Fold all headings** / **Show headings only** / **Unfold all headings**

## Settings

- **Open files in**: reading or source.
- **Show property drawers**, **Show comments**.
- **Follow #+STARTUP**: open folded when the file says `overview` or `content`.

## Install

Until the plugin is in the community list, install it with
[BRAT](https://github.com/TfTHacker/obsidian42-brat): add `ESeNonFossiIo/obsidian-org-reader`.
Or copy `main.js`, `manifest.json` and `styles.css` from the
[latest release](https://github.com/ESeNonFossiIo/obsidian-org-reader/releases/latest) into
`<vault>/.obsidian/plugins/org-reader/`.

## Development

```
npm ci
npm test         # parser unit tests (node --test, Node 22)
npm run build    # bundles src/main.js to main.js
npm run dev      # rebuild on change
```

The code is split in three, and only `view.js` and `main.js` use the Obsidian API:

- `src/parser.js`: Org text to a document tree. Pure, unit-tested.
- `src/render.js`: tree to DOM (no `innerHTML`). Links and images go through callbacks.
- `src/view.js`, `src/main.js`, `src/settings.js`: the view, plugin and settings tab.

To try changes in a vault, put the vault's plugin folder (a real folder, not a symlink) in a
one-line `.deploy-target` file, or set `OBSIDIAN_PLUGIN_DIR`; every build then copies
`main.js`, `manifest.json` and `styles.css` there.

### Releasing

With a clean `master` that is pushed, run `npm version X.Y.Z` (or `patch`, `minor`,
`major`). It runs the tests, bumps `package.json`, `package-lock.json`, `manifest.json`
and `versions.json`, commits, tags `X.Y.Z` (no `v`) and pushes. The Release workflow then
builds and publishes `main.js`, `manifest.json` and `styles.css` with provenance
attestations.

## License

MIT
