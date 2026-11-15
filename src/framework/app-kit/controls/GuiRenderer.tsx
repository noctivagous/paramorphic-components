// ---------- GuiRenderer: run a GUI document anywhere ----------
// Renders a GuiDocument with the control registry + the pure layout
// resolvers — the same code path the builder's preview mode uses, exported
// so any app can host a builder-made GUI. Interactive by default; pass
// values/onValueChange to lift control state into the host (values are
// per-node prop patches: values[nodeId] merges over node.props).
import React from "react";
import type { GuiDocument, GuiNode } from "../gui-document";
import { guiChildren, resolvedRects } from "../gui-layout";
import type { ControlComponent, Device } from "./types";
import { getControlDef } from "./registry";

export function GuiRenderer({ document, device, values, onValueChange, onNodeSubmit, components, width, height }: {
  document: GuiDocument;
  device: Device;
  values?: Record<string, Record<string, unknown>>;
  onValueChange?: (nodeId: string, patch: Record<string, unknown>) => void;
  /** A field control's submission gesture (Enter in an input-field),
      reported per node — see ControlProps.onSubmit. */
  onNodeSubmit?: (nodeId: string) => void;
  /** Host-supplied renderers for node types the registry does not
      know — the data-surface seam. A host app whose surfaces are not
      widget grids (a treemap, a chart, a graph) registers them here
      under `host:`-prefixed types and carries the live surface in
      the node's props through the values channel (see HostSurface).
      The registry wins for its own types only when the host does not
      override them; hosts should stick to `host:` types. Such
      documents are runtime-generated — the builder's validator
      rightly rejects unknown types in authored documents. */
  components?: Record<string, ControlComponent>;
  width?: number;
  height?: number;
}) {
  const rects = resolvedRects(document, device);
  const byId = new Map(document.nodes.map(n => [n.id, n]));
  const rootSize = { w: width ?? Math.max(0, ...document.nodes.filter(n => !n.parentId).map(n => { const r = rects.get(n.id); return r ? r.absX + r.w : 0; })), h: height ?? Math.max(0, ...document.nodes.filter(n => !n.parentId).map(n => { const r = rects.get(n.id); return r ? r.absY + r.h : 0; })) };
  const defOf = (type: string) => components?.[type] ? { component: components[type] } : getControlDef(type);

  const renderNode = (node: GuiNode): React.ReactNode => {
    const rect = rects.get(node.id);
    const def = defOf(node.type);
    if (!rect || !def || node.visible === false) return null;
    const Comp = def.component;
    const props = { ...node.props, ...(values?.[node.id] ?? {}) };
    const kids = guiChildren(document, node.id);
    return <div key={node.id} className="gui-node" data-gui-node={node.id}
      style={{ position: "absolute", left: rect.absX, top: rect.absY, width: rect.w, height: rect.h }}>
      <Comp props={props} interactive onChange={patch => onValueChange?.(node.id, patch)} onSubmit={() => onNodeSubmit?.(node.id)} />
      {kids.map(k => { const kr = rects.get(k.id); if (!kr) return null; return renderNodeAt(k, kr.absX - rect.absX, kr.absY - rect.absY); })}
    </div>;
  };
  // Children render inside their parent's box (positions relative to it),
  // so nested overflow/clipping matches the design canvas.
  const renderNodeAt = (node: GuiNode, relX: number, relY: number): React.ReactNode => {
    const rect = rects.get(node.id);
    const def = defOf(node.type);
    if (!rect || !def || node.visible === false) return null;
    const Comp = def.component;
    const props = { ...node.props, ...(values?.[node.id] ?? {}) };
    const kids = guiChildren(document, node.id);
    return <div key={node.id} className="gui-node" data-gui-node={node.id}
      style={{ position: "absolute", left: relX, top: relY, width: rect.w, height: rect.h }}>
      <Comp props={props} interactive onChange={patch => onValueChange?.(node.id, patch)} onSubmit={() => onNodeSubmit?.(node.id)} />
      {kids.map(k => { const kr = rects.get(k.id); if (!kr) return null; return renderNodeAt(k, kr.absX - rect.absX, kr.absY - rect.absY); })}
    </div>;
  };

  return <div className="gui-root" style={{ position: "relative", width: rootSize.w, height: rootSize.h, overflow: "hidden" }}>
    {guiChildren(document, null).map(renderNode)}
  </div>;
}
