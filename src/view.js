// The view for .org files: a rendered "reading" mode and a plain-text "source" mode.
// The file content lives in `this.data` (TextFileView); edits are saved through requestSave().
import { TextFileView, renderMath, finishRenderMath, loadMathJax } from "obsidian";
import { parseOrg } from "./parser.js";
import { renderDocument, setFold } from "./render.js";

export const VIEW_TYPE = "org-reader";

/** Reading/source view of one Org file. */
export class OrgView extends TextFileView {
  /**
   * @param {import("obsidian").WorkspaceLeaf} leaf
   * @param {import("./main.js").default} plugin supplies the settings
   */
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.readerMode = plugin.settings.defaultMode;
  }

  /** @returns {string} */
  getViewType() { return VIEW_TYPE; }
  /** @returns {string} */
  getDisplayText() { return this.file ? this.file.basename : "Org"; }
  /** @returns {string} */
  getIcon() { return "file-text"; }

  /** Build the two panes and the mode switch in the view header. */
  async onOpen() {
    this.readerEl = this.contentEl.createDiv({ cls: "org-reader markdown-rendered" });
    this.sourceEl = this.contentEl.createEl("textarea", { cls: "org-reader-source", attr: { spellcheck: "false" } });
    this.sourceEl.addEventListener("input", () => { this.data = this.sourceEl.value; this.requestSave(); });
    this.modeAction = this.addAction("pencil", "Edit source", () => this.setReaderMode(this.readerMode === "read" ? "source" : "read"));
    this.applyMode();
  }

  /**
   * Called by Obsidian when the file content is loaded or changed on disk.
   * @param {string} data
   * @param {boolean} clear true when a different file replaces the old one
   */
  setViewData(data, clear) {
    this.data = data;
    if (clear) this.readerMode = this.plugin.settings.defaultMode;
    if (this.sourceEl && this.sourceEl.value !== data) this.sourceEl.value = data;
    this.applyMode();
  }

  /** @returns {string} the content to save */
  getViewData() { return this.data; }

  /** Empty both panes. */
  clear() {
    this.data = "";
    if (this.sourceEl) this.sourceEl.value = "";
    if (this.readerEl) this.readerEl.empty();
  }

  /** @returns {object} view state, so the mode survives a restart */
  getState() { return { ...super.getState(), readerMode: this.readerMode }; }

  /**
   * @param {object} state
   * @param {import("obsidian").ViewStateResult} result
   * @returns {Promise<void>}
   */
  async setState(state, result) {
    if (state && (state.readerMode === "read" || state.readerMode === "source")) this.readerMode = state.readerMode;
    await super.setState(state, result);
    this.applyMode();
  }

  /**
   * Switch between reading and source mode.
   * @param {"read"|"source"} mode
   * @returns {void}
   */
  setReaderMode(mode) {
    this.readerMode = mode;
    this.applyMode();
    this.app.workspace.requestSaveLayout();
  }

  /** Show the pane for the current mode and (re)render the reading pane. */
  applyMode() {
    if (!this.readerEl) return;
    const reading = this.readerMode === "read";
    this.readerEl.toggleClass("is-hidden", !reading);
    this.sourceEl.toggleClass("is-hidden", reading);
    if (this.modeAction) {
      this.modeAction.setAttribute("aria-label", reading ? "Edit source" : "Read");
      this.modeAction.empty();
      this.modeAction.createSpan({ text: reading ? "Edit" : "Read" });
    }
    if (reading) this.render();
    else this.sourceEl.focus();
  }

  /** Parse the file and draw it, keeping the scroll position. */
  render() {
    const top = this.readerEl.scrollTop;
    const s = this.plugin.settings;
    // MathJax is loaded lazily by Obsidian; until it is there, formulas show as written
    const math = s.renderMath && typeof globalThis.MathJax !== "undefined";
    if (s.renderMath && !math && !this.mathLoading) {
      this.mathLoading = loadMathJax().then(() => this.render()).catch((err) => console.error("Org Reader: MathJax failed to load:", err));
    }
    try {
      renderDocument(parseOrg(this.data || ""), this.readerEl, {
        showProperties: s.showProperties,
        showComments: s.showComments,
        honorStartup: s.honorStartup,
        onLink: (link) => this.followLink(link),
        imageSrc: (path) => this.imageUrl(path),
        renderMath: math ? (source, display) => this.typeset(source, display) : null,
      });
      if (math) finishRenderMath();
    } catch (err) {
      // show the problem instead of a blank pane, and keep the source reachable
      console.error("Org Reader:", err);
      this.readerEl.empty();
      this.readerEl.createDiv({ cls: "org-error", text: `Org Reader could not render this file: ${err && err.message ? err.message : err}` });
    }
    this.readerEl.scrollTop = top;
  }

  /**
   * Typeset one LaTeX fragment; if MathJax rejects it, show the source instead.
   * @param {string} source
   * @param {boolean} display true for a display (block) formula
   * @returns {HTMLElement}
   */
  typeset(source, display) {
    try {
      return renderMath(source, display);
    } catch (err) {
      console.error("Org Reader: cannot typeset", source, err);
      const el = document.createElement("code");
      el.className = "org-math-source";
      el.textContent = source;
      return el;
    }
  }

  /**
   * Fold every section, or open them all.
   * @param {"overview"|"content"|"all"} mode
   * @returns {void}
   */
  fold(mode) { if (this.readerEl) setFold(this.readerEl, mode); }

  /**
   * Open the target of an internal link: a file in the vault, or a heading in this file.
   * @param {{kind: string, path?: string, slug?: string, title?: string}} link
   * @returns {void}
   */
  followLink(link) {
    if (link.kind === "file") {
      this.app.workspace.openLinkText(link.path, this.file ? this.file.path : "", false);
      return;
    }
    const secs = Array.from(this.readerEl.querySelectorAll(".org-section"));
    const target = link.slug
      ? secs.find((el) => el.dataset.slug === link.slug)
      : secs.find((el) => el.dataset.title === link.title) || secs.find((el) => el.dataset.title.includes(link.title));
    if (!target) return;
    for (let el = target.parentElement; el; el = el.parentElement) el.classList.remove("is-folded", "is-body-folded");
    target.classList.remove("is-folded", "is-body-folded");
    target.scrollIntoView({ block: "start" });
  }

  /**
   * @param {string} path image path as written in the link (vault-relative or relative to this file)
   * @returns {?string} a URL Obsidian can load, or null if the image is not in the vault
   */
  imageUrl(path) {
    const file = this.app.metadataCache.getFirstLinkpathDest(path, this.file ? this.file.path : "");
    return file ? this.app.vault.getResourcePath(file) : null;
  }
}
