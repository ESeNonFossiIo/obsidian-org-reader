// The plugin's settings tab. Every change is saved at once and the open views redraw.
import { PluginSettingTab, Setting } from "obsidian";

/** Settings tab; reads and writes `plugin.settings` (defaults in settings-defaults.js). */
export class OrgReaderSettings extends PluginSettingTab {
  /**
   * @param {import("obsidian").App} app
   * @param {import("./main.js").default} plugin whose `settings` this tab edits
   */
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  /** Build the settings form. Each control saves immediately. */
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const save = async (key, value) => { this.plugin.settings[key] = value; await this.plugin.saveSettings(); this.plugin.redraw(); };
    new Setting(containerEl).setName("Open files in")
      .setDesc("Reading shows the rendered file; source is plain text. You can switch per file with the button in the view header.")
      .addDropdown((d) => d.addOption("read", "Reading").addOption("source", "Source").setValue(this.plugin.settings.defaultMode)
        .onChange((v) => save("defaultMode", v)));
    new Setting(containerEl).setName("Show property drawers")
      .setDesc("Show the :PROPERTIES: drawer under headings.")
      .addToggle((t) => t.setValue(this.plugin.settings.showProperties).onChange((v) => save("showProperties", v)));
    new Setting(containerEl).setName("Show comments")
      .setDesc("Show lines starting with '# ' and #+BEGIN_COMMENT blocks.")
      .addToggle((t) => t.setValue(this.plugin.settings.showComments).onChange((v) => save("showComments", v)));
    new Setting(containerEl).setName("Follow #+STARTUP")
      .setDesc("Open files folded when they say '#+STARTUP: overview' or 'content'.")
      .addToggle((t) => t.setValue(this.plugin.settings.honorStartup).onChange((v) => save("honorStartup", v)));
  }
}
