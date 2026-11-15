// ---------- HostSurface: the reference host renderer ----------
// The data-surface seam's reference implementation, backwards-derived
// from Flat Space's data frames (treemap, sunburst, horizon monitor,
// flow graph): surfaces that are laid out by a data layer, not by a
// widget grid, and so cannot be registry controls. A host app writes
// a runtime GuiDocument whose node type is "host:surface", registers
// this component for it through GuiRenderer's `components` map, and
// passes the live surface element through the values channel as the
// node's `surface` prop patch:
//
//   <GuiRenderer document={doc} components={{ "host:surface": HostSurface }}
//     values={{ [nodeId]: { surface: <MySurface/> } }} />
//
// The document supplies placement, theming tokens and the addressing
// layer's hosting; the surface itself stays the host's own rendering.
import React from "react";
import type { ControlProps } from "./types";

export function HostSurface({ props }: ControlProps) {
  return <>{(props.surface as React.ReactNode) ?? null}</>;
}
