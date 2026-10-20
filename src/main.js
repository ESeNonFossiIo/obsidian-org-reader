// Org Reader: opens .org files in a clean rendered view (parser.js -> render.js -> view.js)
// with a CodeMirror editor for editing. Independent of other Org plugins, but only one
// plugin can own the "org" file extension: disable Orgmode (cm6) to use this one.
import { Plugin, Notice, TFolder, normalizePath } from "obsidian";
import { DEFAULTS } from "./settings-defaults.js";
import { OrgReaderSettings } from "./settings.js";
import { OrgView, VIEW_TYPE } from "./view.js";
import { commands as editCommands } from "./editor.js";

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
    this.addRibbonIcon("file-plus", "New Org file", () => this.newOrgFile());
    this.addCommand({ id: "new-file", name: "New Org file", callback: () => this.newOrgFile() });
    // "New Org file" in the file explorer's folder menu
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFolder)) return;
      menu.addItem((item) => item.setTitle("New Org file").setIcon("file-plus").onClick(() => this.newOrgFile(file)));
    }));
    this.addSettingTab(new OrgReaderSettings(this.app, this));
    this.addCommand({ id: "toggle-mode", name: "Toggle reading and editing", checkCallback: (checking) => this.withView(checking, (v) => v.setReaderMode(v.readerMode === "read" ? "edit" : "read")) });
    const editing = [
      ["todo-next", "Next TODO state", "todoNext"],
      ["todo-previous", "Previous TODO state", "todoPrev"],
      ["promote", "Promote heading or item", "promote"],
      ["demote", "Demote heading or item", "demote"],
      ["promote-tree", "Promote subtree", "promoteTree"],
      ["demote-tree", "Demote subtree", "demoteTree"],
      ["move-up", "Move subtree or item up", "moveUp"],
      ["move-down", "Move subtree or item down", "moveDown"],
      ["toggle-checkbox", "Toggle checkbox", "toggleCheckbox"],
      ["new-sibling", "New heading or item", "newSibling"],
      ["toggle-fold", "Fold or unfold at cursor", "toggleFold"],
      ["cycle-fold", "Cycle folding of the whole file", "cycleFold"],
    ];
    for (const [id, name, fn] of editing) {
      this.addCommand({ id, name, checkCallback: (checking) => this.withEditor(checking, (cm) => editCommands[fn](cm)) });
    }
    this.addCommand({ id: "fold-all", name: "Fold all headings", checkCallback: (checking) => this.withView(checking, (v) => v.fold("overview")) });
    this.addCommand({ id: "show-headings", name: "Show headings only", checkCallback: (checking) => this.withView(checking, (v) => v.fold("content")) });
    this.addCommand({ id: "unfold-all", name: "Unfold all headings", checkCallback: (checking) => this.withView(checking, (v) => v.fold("all")) });
  }

  /**
   * Create an empty `.org` file next to the active file (or in the given folder, or where
   * Obsidian puts new notes) and open it for editing.
   * @param {import("obsidian").TFolder} [folder] where to create it
   * @returns {Promise<void>}
   */
  async newOrgFile(folder) {
    const active = this.app.workspace.getActiveFile();
    const parent = folder || this.app.fileManager.getNewFileParent(active ? active.path : "");
    const dir = parent.path === "/" ? "" : parent.path;
    let name = "Untitled";
    let path = normalizePath(`${dir}/${name}.org`);
    for (let n = 1; this.app.vault.getAbstractFileByPath(path); n++) {
      name = `Untitled ${n}`;
      path = normalizePath(`${dir}/${name}.org`);
    }
    try {
      const file = await this.app.vault.create(path, `#+TITLE: ${name}\n\n`);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      if (leaf.view instanceof OrgView) leaf.view.setReaderMode("edit");
      // let the user name it right away, like a new note
      if (typeof this.app.fileManager.promptForFileRename === "function") this.app.fileManager.promptForFileRename(file);
    } catch (err) {
      console.error("Org Reader: cannot create file:", err);
      new Notice(`Org Reader: cannot create ${path}: ${err && err.message ? err.message : err}`);
    }
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

  /**
   * Run `fn` on the editor of the active Org view, when it is in editing mode.
   * @param {boolean} checking true when Obsidian only asks whether the command is available
   * @param {(cm: import("@codemirror/view").EditorView) => void} fn
   * @returns {boolean}
   */
  withEditor(checking, fn) {
    const view = this.app.workspace.getActiveViewOfType(OrgView);
    if (!view || view.readerMode !== "edit" || !view.codeMirror) return false;
    if (!checking) fn(view.codeMirror);
    return true;
  }

  /** Redraw every open Org view (after a setting changed). */
  redraw() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof OrgView) leaf.view.applyMode();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    if (this.settings.defaultMode === "source") this.settings.defaultMode = "edit";   // name used before 0.2
  }
  async saveSettings() { await this.saveData(this.settings); }
}
