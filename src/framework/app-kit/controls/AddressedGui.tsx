// ---------- AddressedGui: key-click addressing for a hosted GUI ----------
// Backwards-derived from Flat Space (demo-de's 2D environment in
// noctivagous-linux), the first app built entirely from this app-kit
// under the rule that gaps become framework features. Flat Space is
// operated by key-clicks: every addressable thing wears a label, a
// typed label targets it, the hovered thing outranks the target, and
// one discrete key (F) activates the addressee. GuiRenderer had no
// way to express any of that, so the addressing layer lives here.
//
// The host owns the addressing STATE (which nodes carry labels, what
// is targeted, what is hovered) and the key handling; this component
// is the render + pointer half of the bridge:
//   - chips render over labelled nodes (positions from the same
//     resolvedRects the renderer uses, so they cannot drift);
//   - target / hover outlines render over the addressed rects;
//   - pointer events are reported back through onAddress, resolved
//     through the renderer's data-gui-node wrappers — GuiRenderer
//     itself is untouched, the bridge uses only its public surface.
//
// A node with no entry in addressing.labels is simply not
// addressable: it renders and behaves exactly as in GuiRenderer.
import React from "react";
import type { GuiDocument } from "../gui-document";
import { resolvedRects } from "../gui-layout";
import type { Device } from "./types";
import { GuiRenderer } from "./GuiRenderer";

export type AddressEvent = "hover" | "leave" | "activate";

export type Addressing = {
  /** nodeId -> label text. Only listed nodes are addressable. */
  labels: Record<string, string>;
  targetId?: string | null;
  hoverId?: string | null;
};

export function AddressedGui({ document, device, values, onValueChange, onNodeSubmit, components, width, height, addressing, onAddress }: {
  document: GuiDocument;
  device: Device;
  values?: Record<string, Record<string, unknown>>;
  onValueChange?: (nodeId: string, patch: Record<string, unknown>) => void;
  onNodeSubmit?: (nodeId: string) => void;
  /** Host renderers for `host:` node types — see GuiRenderer. */
  components?: Record<string, import("./types").ControlComponent>;
  width: number;
  height: number;
  addressing: Addressing;
  onAddress?: (nodeId: string | null, ev: AddressEvent) => void;
}) {
  const rects = resolvedRects(document, device);
  // Pointer events land on the INNERMOST gui-node (a card's text
  // child, say), which is usually not itself addressed: resolve to
  // the nearest ADDRESSED ancestor, the node the user is pointing at.
  const labelled = (e: React.SyntheticEvent): string | null => {
    let el = (e.target as HTMLElement | null)?.closest?.("[data-gui-node]") ?? null;
    while (el) {
      const id = el.getAttribute("data-gui-node");
      if (id && addressing.labels[id]) return id;
      el = el.parentElement?.closest?.("[data-gui-node]") ?? null;
    }
    return null;
  };
  const outline = (id: string | null | undefined, kind: "target" | "hover") => {
    if (!id) return null;
    const r = rects.get(id);
    if (!r) return null;
    return <div key={kind} className={`gui-address-outline ${kind}`}
      style={{ left: r.absX, top: r.absY, width: r.w, height: r.h }} />;
  };
  return (
    <div className="gui-addressed" style={{ width, height }}
      onMouseOver={(e) => { const id = labelled(e); if (id) onAddress?.(id, "hover"); }}
      onMouseLeave={() => onAddress?.(null, "leave")}
      onClick={(e) => { const id = labelled(e); if (id) onAddress?.(id, "activate"); }}>
      <GuiRenderer document={document} device={device} values={values}
        onValueChange={onValueChange} onNodeSubmit={onNodeSubmit} components={components} width={width} height={height} />
      {outline(addressing.hoverId, "hover")}
      {outline(addressing.targetId, "target")}
      {Object.entries(addressing.labels).map(([id, label]) => {
        const r = rects.get(id);
        if (!r) return null;
        const cls = id === addressing.targetId ? "gui-chip is-target" : id === addressing.hoverId ? "gui-chip is-hover" : "gui-chip";
        // The chip straddles the node's top-left corner (the KeyPilot
        // / Flat Space convention) so it never covers node content.
        return <span key={id} className={cls} style={{ left: r.absX - 5, top: r.absY - 5 }}>{label}</span>;
      })}
    </div>
  );
}
