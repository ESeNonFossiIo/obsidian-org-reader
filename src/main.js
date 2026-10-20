// Org Reader: opens .org files in a clean rendered view (parser.js -> render.js -> view.js)
// with a switch to the plain-text source. Independent of other Org plugins, but only one
// plugin can own the "org" file extension: disable Orgmode (cm6) to use this one.
import { Plugin, Notice } from "obsidian";
import { DEFAULTS } from "./settings-defaults.js";
import { OrgReaderSettings } from "./settings.js";
import { OrgView, VIEW_TYPE } from "./view.js";

export default class OrgReaderPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new OrgView(leaf, this));
    try {
      this.registerExtensions(["org"], VIEW_TYPE);
    } catch (err) {
      console.error("Org Reader: cannot register the .org extension:", err);
      new Notice(`Org Reader: cannot take over .org files (${err && err.message ? err.message : err}). If Orgmode (cm6) was just disabled, restart Obsidian.`, 15000);
    }
    this.addSettingTab(new OrgReaderSettings(this.app, this));
    this.addCommand({ id: "toggle-mode", name: "Toggle reading and source view", checkCallback: (checking) => this.withView(checking, (v) => v.setReaderMode(v.readerMode === "read" ? "source" : "read")) });
    this.addCommand({ id: "fold-all", name: "Fold all headings", checkCallback: (checking) => this.withView(checking, (v) => v.fold("overview")) });
    this.addCommand({ id: "show-headings", name: "Show headings only", checkCallback: (checking) => this.withView(checking, (v) => v.fold("content")) });
    this.addCommand({ id: "unfold-all", name: "Unfold all headings", checkCallback: (checking) => this.withView(checking, (v) => v.fold("all")) });
  }

  /**
   * Run `fn` on the active Org view, for commands that only apply there.
   * @param {boolean} checking true when Obsidian only asks whether the command is available
   * @param {(view: OrgView) => void} fn
   * @returns {boolean}
   */
  withView(checking, fn) {
    const view = this.app.workspace.getActiveViewOfType(OrgView);
    if (!view) return false;
    if (!checking) fn(view);
    return true;
  }

  /** Redraw every open Org view (after a setting changed). */
  redraw() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof OrgView) leaf.view.applyMode();
    }
  }

  async loadSettings() { this.settings = Object.assign({}, DEFAULTS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }
}
