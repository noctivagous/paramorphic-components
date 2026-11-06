// Pure save/load assembly for the GUI builder shell: the saved file is a
// paramorphic GUI plan (base + gui.* morph chain + snapshot). Publication
// follows chainForGuiSave: full chain only when a checked replay lands on
// the current document, otherwise an honest snapshot checkpoint. Kept pure
// so verify:gui drives the round trip without React.
import {
  chainForGuiSave,
  loadGuiPlan,
  type GuiDocument,
  type GuiPlanFile,
} from "../../../src/framework/app-kit/gui-document";
import type { ScopedAppliedMorph } from "../../../src/framework/morphs/scoped";

export function buildGuiSave(args: { base: GuiDocument; chain: ScopedAppliedMorph[]; current: GuiDocument }): GuiPlanFile {
  return chainForGuiSave(args);
}

export function parseGuiSave(text: string): ReturnType<typeof loadGuiPlan> {
  let data: unknown;
  try { data = JSON.parse(text); } catch (e) { return { ok: false, errors: [`JSON parse error: ${e instanceof Error ? e.message : String(e)}`] }; }
  return loadGuiPlan(data);
}

/** Source-compatible export shape ({device, separateLayouts, widgets}). */
export function exportSourceJson(doc: GuiDocument): string {
  const widgets = doc.nodes.map(n => ({
    id: n.id, type: n.type,
    x: n.layouts[doc.device].x, y: n.layouts[doc.device].y, w: n.layouts[doc.device].w, h: n.layouts[doc.device].h,
    parentId: n.parentId, props: n.props, layouts: n.layouts,
    ...(n.grid ? { grid: n.grid } : {}), ...(n.layoutMode ? { layoutMode: n.layoutMode } : {}),
    ...(n.stack ? { stack: n.stack } : {}), ...(n.gridCfg ? { gridCfg: n.gridCfg } : {}), ...(n.struts ? { struts: n.struts } : {}),
  }));
  return JSON.stringify({ device: doc.device, separateLayouts: doc.separateLayouts, widgets }, null, 2);
}
