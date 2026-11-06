// ---------- Schema-driven Inspector ----------
// Renders an editing form purely from a control's propSchema — the builder
// contains no per-control inspector code, and any other app that edits
// plan-shaped data can reuse this component. Generalises the shell's
// DialogField idea to the richer prop kinds controls need.
import React from "react";
import type { PropSchemaField } from "./types";

export function InspectorField({ field, value, onChange }: {
  field: PropSchemaField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = <span>{field.label}</span>;
  switch (field.kind) {
    case "boolean":
      return <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>{label}
        <input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} /></label>;
    case "number":
      return <label>{label}
        <input type="number" min={field.min} max={field.max} step={field.step ?? 1}
          value={typeof value === "number" ? value : ""}
          onChange={e => onChange(e.target.value === "" ? field.default ?? 0 : e.target.valueAsNumber)} /></label>;
    case "slider": {
      const v = typeof value === "number" ? value : (field.default as number) ?? field.min ?? 0;
      return <label>{field.label} · {Math.round(v * 100) / 100}
        <input type="range" min={field.min ?? 0} max={field.max ?? 100} step={field.step ?? 1} value={v}
          onChange={e => onChange(e.target.valueAsNumber)} /></label>;
    }
    case "select":
      return <label>{label}
        <select value={typeof value === "string" ? value : field.options?.[0] ?? ""} onChange={e => onChange(e.target.value)}>
          {(field.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select></label>;
    case "color":
      return <label>{label}
        <input type="color" value={typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#4a8af4"}
          onChange={e => onChange(e.target.value)} /></label>;
    case "stringList": {
      const items = Array.isArray(value) ? value.filter(x => typeof x === "string") as string[] : [];
      return <label>{label}
        <textarea rows={Math.min(6, Math.max(2, items.length))} value={items.join("\n")}
          onChange={e => onChange(e.target.value.split("\n"))} />
        <span style={{ fontSize: 9 }}>One per line</span></label>;
    }
    default:
      return <label>{label}
        <input type="text" value={typeof value === "string" ? value : value == null ? "" : String(value)}
          onChange={e => onChange(e.target.value)} /></label>;
  }
}

/** A full inspector form over a prop schema. */
export function Inspector({ schema, props, onChange }: {
  schema: PropSchemaField[];
  props: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return <div className="gui-inspector">
    {schema.map(field => <InspectorField key={field.key} field={field} value={props[field.key]} onChange={v => onChange(field.key, v)} />)}
    {schema.length === 0 && <div style={{ color: "var(--text-faint)" }}>No editable props.</div>}
  </div>;
}
