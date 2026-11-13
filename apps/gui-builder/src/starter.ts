// Seeded starter document: exercises every layout system on first open —
// a toolbar strip, a stack-laid-out panel (slider/knob/toggle), an
// absolutely-positioned panel, a grid-laid-out container, and standalone
// audio-lab controls (fader bank, XY pad, ADSR + EQ curve editors).
//
// Per-device rects are explicit: each device class gets its own hand-laid
// arrangement (desktop: three-column rows; tablet: two columns; phone:
// full-width panels over two-column rows). They were previously derived
// by clamping the desktop rects, which piled every root node onto the
// same spot at phone width (41 overlapping pairs). verify:gui now holds
// the geometry gate: no overlaps, no parent clipping, no past-width
// overflow on any device (see snapshotGuiDocument in app-kit/wireframe).
import type { Device, GuiDocument, GuiNode, LayoutRect } from "../../../src/framework";

const rect = (x: number, y: number, w: number, h: number): LayoutRect => ({ x, y, w, h });
/** Desktop rect plus derived tablet/phone rects (clamped into the smaller canvas).
 *  Fallback for layout-managed children whose stored rect only supplies an
 *  intrinsic size (stack/grid children are placed by their container). */
function layouts(d: LayoutRect, inside = false): Record<Device, LayoutRect> {
  const clampW = inside ? 300 : 358;
  return {
    desktop: d,
    tablet: { ...d, x: Math.min(d.x, 500), w: Math.min(d.w, 460) },
    phone: { ...d, x: inside ? Math.min(d.x, 24) : 16, w: Math.min(d.w, clampW) },
  };
}
let seq = 0;
function node(partial: Partial<GuiNode> & { id: string; type: string; desktop: LayoutRect; tablet?: LayoutRect; phone?: LayoutRect; inside?: boolean }): GuiNode {
  const { desktop, tablet, phone, inside, ...rest } = partial;
  const derived = layouts(desktop, inside);
  return {
    parentId: null, props: {},
    layouts: { desktop, tablet: tablet ?? derived.tablet, phone: phone ?? derived.phone },
    ...rest,
  } as GuiNode;
}

export function starterDocument(): GuiDocument {
  seq++;
  const nodes: GuiNode[] = [
    node({
      id: "toolbar", type: "toolbar-strip", props: { title: "Main Toolbar" }, layoutMode: "absolute",
      desktop: rect(0, 0, 960, 38), tablet: rect(0, 0, 768, 38), phone: rect(0, 0, 390, 38),
    }),
    node({
      id: "channel", type: "panel", props: { title: "Channel Strip", radius: 8, opacity: 1 },
      layoutMode: "stack", stack: { direction: "vertical", spacing: 10, distribution: "leading", alignment: "top" },
      desktop: rect(32, 64, 300, 230), tablet: rect(24, 62, 348, 232), phone: rect(16, 54, 358, 190),
    }),
    node({ id: "ch-slider", type: "slider", parentId: "channel", desktop: rect(0, 0, 260, 30), tablet: rect(0, 0, 316, 30), phone: rect(0, 0, 326, 30), inside: true, props: { title: "Volume", value: 58 } }),
    node({ id: "ch-knob", type: "knob", parentId: "channel", desktop: rect(0, 0, 64, 72), inside: true, props: { title: "Pan", value: 30, variant: "bipolar" } }),
    node({ id: "ch-toggle", type: "toggle", parentId: "channel", desktop: rect(0, 0, 54, 28), inside: true, props: { checked: true, title: "" } }),
    node({
      id: "actions", type: "panel", props: { title: "Actions (absolute)", radius: 8, opacity: 1 }, layoutMode: "absolute",
      desktop: rect(364, 64, 300, 230), tablet: rect(396, 62, 348, 232), phone: rect(16, 260, 358, 190),
    }),
    node({ id: "act-run", type: "pro-button", parentId: "actions", desktop: rect(18, 36, 110, 26), phone: rect(16, 40, 110, 26), inside: true, props: { title: "Action", styleVariant: "blue", radius: 14 }, struts: { top: true, bottom: false, left: true, right: false, hSpring: false, vSpring: false } }),
    node({ id: "act-cancel", type: "pro-button", parentId: "actions", desktop: rect(142, 36, 110, 26), phone: rect(140, 40, 110, 26), inside: true, props: { title: "Cancel", styleVariant: "default", radius: 14 }, struts: { top: true, bottom: false, left: false, right: true, hSpring: false, vSpring: false } }),
    node({ id: "act-led", type: "led-button", parentId: "actions", desktop: rect(18, 84, 44, 52), phone: rect(16, 84, 44, 52), inside: true, props: { title: "Armed", checked: true, color: "#f2c94c" } }),
    node({ id: "act-check", type: "checkbox", parentId: "actions", desktop: rect(90, 92, 150, 20), phone: rect(88, 92, 180, 20), inside: true, props: { title: "Enable Option", checked: false } }),
    node({
      id: "gridbox", type: "grid-container", props: { title: "Grid Section" },
      layoutMode: "grid", gridCfg: { columns: 4, gutter: 8, rowHeight: 36, rowGutter: 8, baselineUnit: 8 },
      desktop: rect(32, 342, 424, 164), tablet: rect(24, 482, 720, 164), phone: rect(16, 622, 358, 164),
    }),
    node({ id: "g-btn", type: "pro-button", parentId: "gridbox", desktop: rect(0, 0, 100, 36), inside: true, props: { title: "Grid Btn", styleVariant: "default", radius: 8 }, grid: { colStart: 0, colSpan: 1, rowStart: 0, rowSpan: 1 } }),
    node({ id: "g-check", type: "checkbox", parentId: "gridbox", desktop: rect(0, 0, 100, 36), inside: true, props: { title: "Grid Check", checked: true }, grid: { colStart: 1, colSpan: 2, rowStart: 0, rowSpan: 1 } }),
    node({ id: "g-prog", type: "progress", parentId: "gridbox", desktop: rect(0, 0, 100, 14), inside: true, props: { value: 68 }, grid: { colStart: 0, colSpan: 3, rowStart: 1, rowSpan: 1 } }),
    node({ id: "g-label", type: "text-label", parentId: "gridbox", desktop: rect(0, 0, 180, 18), inside: true, props: { title: "Placed by span" }, grid: { colStart: 3, colSpan: 1, rowStart: 0, rowSpan: 1 } }),
    node({
      id: "faders", type: "fader-bank", props: { title: "Faders", values: "70,55,80,40" },
      desktop: rect(712, 64, 220, 140), tablet: rect(24, 318, 348, 140), phone: rect(16, 466, 171, 140),
    }),
    node({
      id: "xypad", type: "xy-pad", props: { title: "Filter", x: 35, y: 60, spring: false },
      desktop: rect(712, 224, 220, 94), tablet: rect(396, 318, 348, 140), phone: rect(203, 466, 171, 140),
    }),
    node({
      id: "adsr", type: "adsr-editor", props: { title: "Envelope", attack: 20, decay: 30, sustain: 60, release: 40 },
      desktop: rect(488, 342, 220, 110), tablet: rect(24, 670, 348, 110), phone: rect(16, 802, 171, 110),
    }),
    node({
      id: "eq", type: "eq-curve", props: { title: "EQ", low: 55, mid: 70, high: 45 },
      desktop: rect(732, 342, 200, 110), tablet: rect(396, 670, 348, 110), phone: rect(203, 802, 171, 110),
    }),
  ];
  return { schema: "paramorphic-gui/1", device: "desktop", separateLayouts: true, nodes };
}
