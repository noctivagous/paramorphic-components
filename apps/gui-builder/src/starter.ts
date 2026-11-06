// Seeded starter document: exercises every layout system on first open —
// a toolbar strip, a stack-laid-out panel (slider/knob/toggle), an
// absolutely-positioned panel, a grid-laid-out container, and standalone
// audio-lab controls (fader bank, XY pad, ADSR + EQ curve editors).
import type { Device, GuiDocument, GuiNode, LayoutRect } from "../../../src/framework";

const rect = (x: number, y: number, w: number, h: number): LayoutRect => ({ x, y, w, h });
/** Desktop rect plus derived tablet/phone rects (clamped into the smaller canvas). */
function layouts(d: LayoutRect, inside = false): Record<Device, LayoutRect> {
  const clampW = inside ? 300 : 358;
  return {
    desktop: d,
    tablet: { ...d, x: Math.min(d.x, 500), w: Math.min(d.w, 460) },
    phone: { ...d, x: inside ? Math.min(d.x, 24) : 16, w: Math.min(d.w, clampW) },
  };
}
let seq = 0;
function node(partial: Partial<GuiNode> & { id: string; type: string; desktop: LayoutRect; inside?: boolean }): GuiNode {
  const { desktop, inside, ...rest } = partial;
  return {
    parentId: null, props: {}, layouts: layouts(desktop, inside),
    ...rest,
  } as GuiNode;
}

export function starterDocument(): GuiDocument {
  seq++;
  const nodes: GuiNode[] = [
    node({ id: "toolbar", type: "toolbar-strip", desktop: rect(0, 0, 960, 38), props: { title: "Main Toolbar" }, layoutMode: "absolute" }),
    node({
      id: "channel", type: "panel", desktop: rect(32, 64, 300, 230), props: { title: "Channel Strip", radius: 8, opacity: 1 },
      layoutMode: "stack", stack: { direction: "vertical", spacing: 10, distribution: "leading", alignment: "top" },
    }),
    node({ id: "ch-slider", type: "slider", parentId: "channel", desktop: rect(0, 0, 260, 30), inside: true, props: { title: "Volume", value: 58 } }),
    node({ id: "ch-knob", type: "knob", parentId: "channel", desktop: rect(0, 0, 64, 72), inside: true, props: { title: "Pan", value: 30, variant: "bipolar" } }),
    node({ id: "ch-toggle", type: "toggle", parentId: "channel", desktop: rect(0, 0, 54, 28), inside: true, props: { checked: true, title: "" } }),
    node({
      id: "actions", type: "panel", desktop: rect(364, 64, 300, 230), props: { title: "Actions (absolute)", radius: 8, opacity: 1 }, layoutMode: "absolute",
    }),
    node({ id: "act-run", type: "pro-button", parentId: "actions", desktop: rect(18, 36, 110, 26), inside: true, props: { title: "Action", styleVariant: "blue", radius: 14 }, struts: { top: true, bottom: false, left: true, right: false, hSpring: false, vSpring: false } }),
    node({ id: "act-cancel", type: "pro-button", parentId: "actions", desktop: rect(142, 36, 110, 26), inside: true, props: { title: "Cancel", styleVariant: "default", radius: 14 }, struts: { top: true, bottom: false, left: false, right: true, hSpring: false, vSpring: false } }),
    node({ id: "act-led", type: "led-button", parentId: "actions", desktop: rect(18, 84, 44, 52), inside: true, props: { title: "Armed", checked: true, color: "#f2c94c" } }),
    node({ id: "act-check", type: "checkbox", parentId: "actions", desktop: rect(90, 92, 150, 20), inside: true, props: { title: "Enable Option", checked: false } }),
    node({
      id: "gridbox", type: "grid-container", desktop: rect(32, 326, 424, 180), props: { title: "Grid Section" },
      layoutMode: "grid", gridCfg: { columns: 4, gutter: 8, rowHeight: 36, rowGutter: 8, baselineUnit: 8 },
    }),
    node({ id: "g-btn", type: "pro-button", parentId: "gridbox", desktop: rect(0, 0, 100, 36), inside: true, props: { title: "Grid Btn", styleVariant: "default", radius: 8 }, grid: { colStart: 0, colSpan: 1, rowStart: 0, rowSpan: 1 } }),
    node({ id: "g-check", type: "checkbox", parentId: "gridbox", desktop: rect(0, 0, 100, 36), inside: true, props: { title: "Grid Check", checked: true }, grid: { colStart: 1, colSpan: 2, rowStart: 0, rowSpan: 1 } }),
    node({ id: "g-prog", type: "progress", parentId: "gridbox", desktop: rect(0, 0, 100, 14), inside: true, props: { value: 68 }, grid: { colStart: 0, colSpan: 3, rowStart: 1, rowSpan: 1 } }),
    node({ id: "g-label", type: "text-label", parentId: "gridbox", desktop: rect(0, 0, 180, 18), inside: true, props: { title: "Placed by span" }, grid: { colStart: 3, colSpan: 1, rowStart: 0, rowSpan: 1 } }),
    node({ id: "faders", type: "fader-bank", desktop: rect(712, 64, 220, 140), props: { title: "Faders", values: "70,55,80,40" } }),
    node({ id: "xypad", type: "xy-pad", desktop: rect(712, 228, 150, 150), props: { title: "Filter", x: 35, y: 60, spring: false } }),
    node({ id: "adsr", type: "adsr-editor", desktop: rect(488, 326, 220, 110), props: { title: "Envelope", attack: 20, decay: 30, sustain: 60, release: 40 } }),
    node({ id: "eq", type: "eq-curve", desktop: rect(732, 326, 200, 110), props: { title: "EQ", low: 55, mid: 70, high: 45 } }),
  ];
  return { schema: "paramorphic-gui/1", device: "desktop", separateLayouts: true, nodes };
}
