// ---------- GUI control contract: types shared by registry, document, renderer ----------
// ONE interactive contract for every control in the app-kit:
//
//   ControlProps = { props, onChange?, interactive? }
//
// - `props` is the node's full prop record (from the GUI document). Values
//   live IN props: a slider's value is props.value, a toggle's state is
//   props.checked, a list's selection is props.selected. There is no
//   separate value channel, so a document fully describes a live GUI.
// - `onChange(patch)` merges a prop patch ({value: 42}) — the host (builder
//   canvas, GuiRenderer consumer, an app) decides what a change means.
// - `interactive: false` renders the control inert (design-canvas mode: the
//   builder drags nodes by their body, so inner controls must not capture
//   the pointer). Preview and real apps render interactive controls.
import type React from "react";

export type Device = "desktop" | "tablet" | "phone";
export const DEVICES: Device[] = ["desktop", "tablet", "phone"];

export type LayoutRect = { x: number; y: number; w: number; h: number };

/** Stack container configuration (from the grid-systems lab). */
export type StackCfg = {
  direction: "vertical" | "horizontal";
  /** Gap between children, in px — or in baseline units when spacingBaselineUnits. */
  spacing: number;
  spacingBaselineUnits?: boolean;
  distribution: "leading" | "center" | "trailing" | "spaceBetween" | "fill";
  alignment: "top" | "center" | "baseline" | "bottom";
};

/** Grid container configuration (column grid with gutters + baseline rows). */
export type GridCfg = {
  columns: number;
  gutter: number;
  rowHeight: number;
  rowGutter: number;
  baselineUnit: number;
};

/** Classic springs & struts: pinned edges stay fixed; springs flex. */
export type Struts = {
  top: boolean; bottom: boolean; left: boolean; right: boolean;
  hSpring: boolean; vSpring: boolean;
};

/** One editable prop in a control's schema. The Inspector renders from this. */
export type PropSchemaField = {
  key: string;
  label: string;
  kind: "text" | "number" | "slider" | "boolean" | "select" | "color" | "stringList";
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** Value used when the prop is absent (defaults also live in defaultProps). */
  default?: unknown;
};

export type ControlProps = {
  props: Record<string, unknown>;
  onChange?: (patch: Record<string, unknown>) => void;
  interactive?: boolean;
};

export type ControlComponent = React.ComponentType<ControlProps>;

export type ControlDef = {
  type: string;
  family: string;
  label: string;
  icon?: string;
  defaultSize: { w: number; h: number };
  defaultProps: Record<string, unknown>;
  propSchema: PropSchemaField[];
  component: ControlComponent;
  /** Nodes of this type may parent children on the canvas. */
  container?: boolean;
};
