// ---------- Control registry data: the merged catalogue, without components ----------
// The palette/inspector/document-validation side of the control registry:
// every control the app-kit ships, merged and deduped from the GUI-builder
// source's generic catalogue and the audio control lab's pro catalogue
// (knob variants collapse into the knob's `variant` prop; the lab's tab
// strip, list box, dropdown etc. merge with the builder's equivalents).
// registry.tsx attaches the React component for each entry; a control is
// only "registered" when both halves exist (verify:gui checks the join).
import type { ControlDef, PropSchemaField } from "./types";

export type ControlData = Omit<ControlDef, "component">;

const title: PropSchemaField = { key: "title", label: "Title", kind: "text" };
const radius: PropSchemaField = { key: "radius", label: "Corner radius", kind: "number", min: 0, max: 40, step: 1 };
const value01 = (label = "Value"): PropSchemaField => ({ key: "value", label, kind: "slider", min: 0, max: 100, step: 1 });
const variant: PropSchemaField = { key: "variant", label: "Variant", kind: "select", options: ["standard", "endless", "detented", "bipolar"] };

function def(partial: ControlData): ControlData { return partial; }

export const CONTROL_DATA: ControlData[] = [
  // ----- Generic controls (GUI-builder source) -----
  def({ type: "pro-button", family: "Controls", label: "Pro Button", icon: "◫", defaultSize: { w: 110, h: 26 }, defaultProps: { title: "Button", styleVariant: "default", radius: 14 }, propSchema: [title, { key: "styleVariant", label: "Style", kind: "select", options: ["default", "blue", "danger"] }, radius] }),
  def({ type: "icon-button", family: "Controls", label: "Icon Button", icon: "◈", defaultSize: { w: 32, h: 32 }, defaultProps: { title: "★", radius: 6 }, propSchema: [title, radius] }),
  def({ type: "segmented-control", family: "Controls", label: "Segmented Control", icon: "⧉", defaultSize: { w: 180, h: 26 }, defaultProps: { segments: ["One", "Two", "Three"], selectedSegment: 0, multi: false }, propSchema: [{ key: "segments", label: "Segments", kind: "stringList" }, { key: "selectedSegment", label: "Selected", kind: "number", min: 0, step: 1 }, { key: "multi", label: "Multi-select", kind: "boolean" }] }),
  def({ type: "slider", family: "Controls", label: "Slider", icon: "—◉—", defaultSize: { w: 140, h: 26 }, defaultProps: { title: "Level", value: 42 }, propSchema: [title, value01()] }),
  def({ type: "knob", family: "Controls", label: "Knob / Dial", icon: "◎", defaultSize: { w: 56, h: 64 }, defaultProps: { title: "Gain", value: 65, variant: "standard" }, propSchema: [title, value01(), variant] }),
  def({ type: "toggle", family: "Controls", label: "Toggle Switch", icon: "◐", defaultSize: { w: 54, h: 28 }, defaultProps: { checked: true, title: "" }, propSchema: [{ key: "checked", label: "On", kind: "boolean" }, title] }),
  def({ type: "progress", family: "Media", label: "Progress Bar", icon: "▬", defaultSize: { w: 140, h: 14 }, defaultProps: { value: 68 }, propSchema: [value01()] }),
  def({ type: "text-label", family: "Inputs", label: "Text Label", icon: "T", defaultSize: { w: 90, h: 18 }, defaultProps: { title: "Label Text" }, propSchema: [title] }),
  def({ type: "input-field", family: "Inputs", label: "Input Field", icon: "▭", defaultSize: { w: 160, h: 24 }, defaultProps: { title: "", placeholder: "Enter text" }, propSchema: [title, { key: "placeholder", label: "Placeholder", kind: "text" }] }),
  def({ type: "text-area", family: "Inputs", label: "Text Area", icon: "☰", defaultSize: { w: 180, h: 90 }, defaultProps: { title: "Text…", placeholder: "" }, propSchema: [{ key: "title", label: "Text", kind: "text" }, { key: "placeholder", label: "Placeholder", kind: "text" }] }),
  def({ type: "checkbox", family: "Inputs", label: "Checkbox", icon: "☑", defaultSize: { w: 130, h: 20 }, defaultProps: { title: "Enable Option", checked: false }, propSchema: [title, { key: "checked", label: "Checked", kind: "boolean" }] }),
  def({ type: "panel", family: "Containers", label: "Panel / Container", icon: "▣", container: true, defaultSize: { w: 260, h: 180 }, defaultProps: { title: "Panel", radius: 8, opacity: 1 }, propSchema: [title, radius, { key: "opacity", label: "Opacity", kind: "slider", min: 0, max: 1, step: 0.05 }] }),
  def({ type: "stack", family: "Containers", label: "Stack Container", icon: "≣", container: true, defaultSize: { w: 260, h: 180 }, defaultProps: { title: "Stack" }, propSchema: [title] }),
  def({ type: "grid-container", family: "Containers", label: "Grid Container", icon: "▦", container: true, defaultSize: { w: 320, h: 200 }, defaultProps: { title: "Grid" }, propSchema: [title] }),
  def({ type: "tab-bar", family: "Containers", label: "Tab Bar", icon: "⧂", defaultSize: { w: 260, h: 34 }, defaultProps: { tabs: ["Mix", "Edit", "Browser"], selectedTab: 0 }, propSchema: [{ key: "tabs", label: "Tabs", kind: "stringList" }, { key: "selectedTab", label: "Selected", kind: "number", min: 0, step: 1 }] }),
  def({ type: "toolbar-strip", family: "Containers", label: "Toolbar Strip", icon: "⬒", container: true, defaultSize: { w: 480, h: 38 }, defaultProps: { title: "Toolbar" }, propSchema: [title] }),
  def({ type: "list-box", family: "Lists", label: "List Box", icon: "☷", defaultSize: { w: 180, h: 140 }, defaultProps: { title: "Library", rows: ["Kick 01.wav", "Snare Tight.aif", "HiHat Closed", "Bass Synth", "Pad Warm", "Lead Sine"], selected: 0 }, propSchema: [title, { key: "rows", label: "Rows", kind: "stringList" }, { key: "selected", label: "Selected", kind: "number", min: 0, step: 1 }] }),
  def({ type: "image-well", family: "Media", label: "Image Well", icon: "▧", defaultSize: { w: 120, h: 90 }, defaultProps: { title: "Drop Image" }, propSchema: [title] }),
  def({ type: "separator", family: "Media", label: "Separator", icon: "―", defaultSize: { w: 120, h: 2 }, defaultProps: {}, propSchema: [] }),
  // ----- Range (audio control lab) -----
  def({ type: "tall-slider", family: "Range", label: "Tall Frame Slider", icon: "↕", defaultSize: { w: 48, h: 160 }, defaultProps: { title: "Cutoff", value: 55 }, propSchema: [title, value01()] }),
  def({ type: "dual-range", family: "Range", label: "Dual Range", icon: "⇹", defaultSize: { w: 160, h: 30 }, defaultProps: { title: "Range", low: 20, high: 80 }, propSchema: [title, { key: "low", label: "Low", kind: "slider", min: 0, max: 100 }, { key: "high", label: "High", kind: "slider", min: 0, max: 100 }] }),
  def({ type: "fader-bank", family: "Range", label: "Fader Bank", icon: "☰", defaultSize: { w: 200, h: 130 }, defaultProps: { title: "Faders", values: "70,55,80,40" }, propSchema: [title, { key: "values", label: "Values (csv)", kind: "text" }] }),
  def({ type: "xy-pad", family: "Range", label: "XY Pad", icon: "⊞", defaultSize: { w: 150, h: 150 }, defaultProps: { title: "Filter", x: 35, y: 60, spring: false }, propSchema: [title, { key: "x", label: "X", kind: "slider", min: 0, max: 100 }, { key: "y", label: "Y", kind: "slider", min: 0, max: 100 }, { key: "spring", label: "Spring to centre", kind: "boolean" }] }),
  def({ type: "value-scrub", family: "Mod", label: "Value Scrub", icon: "↔", defaultSize: { w: 110, h: 30 }, defaultProps: { title: "Tempo", value: 120 }, propSchema: [title, { key: "value", label: "Value", kind: "number", step: 1 }] }),
  def({ type: "jog-wheel", family: "Mod", label: "Jog Wheel", icon: "◉", defaultSize: { w: 72, h: 72 }, defaultProps: { title: "Jog", value: 0 }, propSchema: [title, { key: "value", label: "Position", kind: "number", step: 1 }] }),
  // ----- Toggles & gates (audio control lab) -----
  def({ type: "led-button", family: "Toggles", label: "LED Button", icon: "●", defaultSize: { w: 44, h: 44 }, defaultProps: { title: "On", checked: false, color: "#4a8af4" }, propSchema: [title, { key: "checked", label: "Lit", kind: "boolean" }, { key: "color", label: "Colour", kind: "color" }] }),
  def({ type: "drum-pad", family: "Toggles", label: "Drum Pad", icon: "▣", defaultSize: { w: 52, h: 52 }, defaultProps: { title: "Kick", velocity: 0 }, propSchema: [title, { key: "velocity", label: "Last velocity", kind: "number", min: 0, max: 127 }] }),
  def({ type: "rocker-switch", family: "Toggles", label: "Rocker Switch", icon: "⏚", defaultSize: { w: 30, h: 52 }, defaultProps: { title: "Power", checked: false }, propSchema: [title, { key: "checked", label: "On", kind: "boolean" }] }),
  def({ type: "radio-group", family: "Toggles", label: "Radio Group", icon: "◉", defaultSize: { w: 130, h: 90 }, defaultProps: { title: "Mode", options: ["A", "B", "C"], selected: 0 }, propSchema: [title, { key: "options", label: "Options", kind: "stringList" }, { key: "selected", label: "Selected", kind: "number", min: 0, step: 1 }] }),
  def({ type: "matrix-2d", family: "Toggles", label: "Matrix 2D", icon: "▦", defaultSize: { w: 120, h: 120 }, defaultProps: { title: "Matrix", cells: "0,0;1,1;2,2" }, propSchema: [title, { key: "cells", label: "Lit cells (x,y;…)", kind: "text" }] }),
  def({ type: "matrix-buttons", family: "Lists", label: "Matrix Buttons", icon: "▤", defaultSize: { w: 132, h: 132 }, defaultProps: { title: "Functions", selected: 0 }, propSchema: [title, { key: "selected", label: "Selected", kind: "number", min: 0, step: 1 }] }),
  def({ type: "dropdown", family: "Lists", label: "Dropdown", icon: "▾", defaultSize: { w: 150, h: 26 }, defaultProps: { title: "", options: ["Sine", "Saw", "Square", "Noise"], selected: 0 }, propSchema: [title, { key: "options", label: "Options", kind: "stringList" }, { key: "selected", label: "Selected", kind: "number", min: 0, step: 1 }] }),
  // ----- Sequencer grids (audio control lab) -----
  def({ type: "step-sequencer", family: "Sequencer", label: "Step Sequencer", icon: "▦", defaultSize: { w: 264, h: 60 }, defaultProps: { title: "Steps", pattern: "x...x...x...x..." }, propSchema: [title, { key: "pattern", label: "Pattern (x = on)", kind: "text" }] }),
  def({ type: "piano-roll", family: "Sequencer", label: "Piano Roll Mini", icon: "🎹", defaultSize: { w: 264, h: 96 }, defaultProps: { title: "Roll", notes: "0,7;2,5;4,4;6,5" }, propSchema: [title, { key: "notes", label: "Notes (step,row;…)", kind: "text" }] }),
  def({ type: "clip-launcher", family: "Sequencer", label: "Clip Launcher", icon: "▶", defaultSize: { w: 200, h: 120 }, defaultProps: { title: "Clips", rows: ["Intro", "Verse", "Chorus", "Bridge"], playing: 0 }, propSchema: [title, { key: "rows", label: "Clips", kind: "stringList" }, { key: "playing", label: "Playing", kind: "number", min: 0, step: 1 }] }),
  def({ type: "mini-piano", family: "Meters", label: "Mini Piano", icon: "🎹", defaultSize: { w: 210, h: 60 }, defaultProps: { title: "Keys", note: -1 }, propSchema: [title, { key: "note", label: "Last note", kind: "number", min: -1, max: 20 }] }),
  // ----- Curve editors (audio control lab) -----
  def({ type: "adsr-editor", family: "Curves", label: "ADSR Editor", icon: "∿", defaultSize: { w: 220, h: 110 }, defaultProps: { title: "Envelope", attack: 20, decay: 30, sustain: 60, release: 40 }, propSchema: [title, { key: "attack", label: "Attack", kind: "slider", min: 0, max: 100 }, { key: "decay", label: "Decay", kind: "slider", min: 0, max: 100 }, { key: "sustain", label: "Sustain", kind: "slider", min: 0, max: 100 }, { key: "release", label: "Release", kind: "slider", min: 0, max: 100 }] }),
  def({ type: "eq-curve", family: "Curves", label: "EQ Curve", icon: "∿", defaultSize: { w: 220, h: 110 }, defaultProps: { title: "EQ", low: 55, mid: 70, high: 45 }, propSchema: [title, { key: "low", label: "Low", kind: "slider", min: 0, max: 100 }, { key: "mid", label: "Mid", kind: "slider", min: 0, max: 100 }, { key: "high", label: "High", kind: "slider", min: 0, max: 100 }] }),
  def({ type: "automation-curve", family: "Curves", label: "Automation Curve", icon: "∿", defaultSize: { w: 220, h: 100 }, defaultProps: { title: "Automation", p1: 20, p2: 70, p3: 40, p4: 85 }, propSchema: [title, { key: "p1", label: "Point 1", kind: "slider", min: 0, max: 100 }, { key: "p2", label: "Point 2", kind: "slider", min: 0, max: 100 }, { key: "p3", label: "Point 3", kind: "slider", min: 0, max: 100 }, { key: "p4", label: "Point 4", kind: "slider", min: 0, max: 100 }] }),
  def({ type: "lfo-editor", family: "Curves", label: "LFO Editor", icon: "∿", defaultSize: { w: 220, h: 100 }, defaultProps: { title: "LFO", rate: 30, depth: 65, shape: "sine" }, propSchema: [title, { key: "rate", label: "Rate", kind: "slider", min: 0, max: 100 }, { key: "depth", label: "Depth", kind: "slider", min: 0, max: 100 }, { key: "shape", label: "Shape", kind: "select", options: ["sine", "triangle", "square", "saw"] }] }),
  // ----- Meters & displays (audio control lab) -----
  def({ type: "vu-meter", family: "Meters", label: "VU Meter", icon: "▌", defaultSize: { w: 36, h: 140 }, defaultProps: { title: "Out", value: 62 }, propSchema: [title, value01("Level")] }),
  def({ type: "bar-meter", family: "Meters", label: "Bar Meter", icon: "▬", defaultSize: { w: 160, h: 18 }, defaultProps: { title: "Level", value: 45 }, propSchema: [title, value01("Level")] }),
  def({ type: "wave-scrubber", family: "Meters", label: "Wave Scrubber", icon: "∿", defaultSize: { w: 220, h: 60 }, defaultProps: { title: "Wave", position: 25 }, propSchema: [title, { key: "position", label: "Position", kind: "slider", min: 0, max: 100 }] }),
  // ----- Mod & patching (audio control lab) -----
  def({ type: "mod-matrix", family: "Mod", label: "Mod Matrix", icon: "⎔", defaultSize: { w: 180, h: 130 }, defaultProps: { title: "Mod", cells: "0,0;1,2;2,1" }, propSchema: [title, { key: "cells", label: "Routed cells (src,dst;…)", kind: "text" }] }),
];

const byType = new Map(CONTROL_DATA.map(d => [d.type, d]));
export function getControlData(type: string): ControlData | undefined { return byType.get(type); }
export function listControlData(): ControlData[] { return CONTROL_DATA; }
