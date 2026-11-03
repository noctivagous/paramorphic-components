// Spreadsheet: one interpretation of a generic grid. Same occupants, rules
// and regions as any board — rendered as an editable sheet. Formulas live in
// data.formula, source values in data.value, results in data.computed, all
// recomputed by the applyFormulas morph on every render.
import React, { useMemo } from "react";
import type { Occupant } from "../framework";
import { applyFormulas } from "../framework";
import { removeOccupant, upsertOccupant } from "../framework";

export function colName(q: number): string {
  let n = q + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function blankCell(q: number, r: number): Occupant {
  return { id: `c-${q}-${r}`, anchor: { q, r }, span: [], type: "cell", data: {}, tags: [] };
}

export function SpreadsheetView({
  occupants,
  setOccupants,
  width,
  height,
}: {
  occupants: Occupant[];
  setOccupants: (o: Occupant[]) => void;
  width: number;
  height: number;
}) {
  const { occupants: shown, errors } = useMemo(() => applyFormulas(occupants), [occupants]);
  const byKey = useMemo(() => {
    const m = new Map<string, Occupant>();
    for (const o of shown) m.set(`${o.anchor.q},${o.anchor.r}`, o);
    return m;
  }, [shown]);
  const errIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of errors) {
      const id = e.split(":")[0];
      if (id) s.add(id);
    }
    return s;
  }, [errors]);

  const commit = (q: number, r: number, text: string) => {
    const t = text.trim();
    const existing = occupants.find(o => o.anchor.q === q && o.anchor.r === r);
    if (t === "") {
      if (existing) setOccupants(removeOccupant(occupants, existing.id));
      return;
    }
    const base = existing ?? blankCell(q, r);
    if (t.startsWith("=")) {
      setOccupants(upsertOccupant(occupants, { ...base, data: { ...(base.data as any), formula: t } }));
    } else {
      const n = Number(t);
      setOccupants(
        upsertOccupant(occupants, {
          ...base,
          data: { ...(base.data as any), value: t !== "" && Number.isFinite(n) ? n : t, formula: undefined },
        })
      );
    }
  };

  const cols = Array.from({ length: width }, (_, q) => q);
  const rows = Array.from({ length: height }, (_, r) => r);
  return (
    <div>
      <table className="border-collapse">
        <thead>
          <tr>
            <th className="w-8 px-1 py-1 text-[9px] text-[var(--text-faint)] font-normal" />
            {cols.map(q => (
              <th key={q} className="px-1 py-1 text-[9px] text-[var(--text-faint)] font-normal text-center min-w-[72px]">
                {colName(q)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r}>
              <td className="px-1 py-1 text-[9px] text-[var(--text-faint)] text-right">{r + 1}</td>
              {cols.map(q => {
                const o = byKey.get(`${q},${r}`);
                const formula = (o?.data as any)?.formula as string | undefined;
                const shown_val =
                  o == null
                    ? ""
                    : formula
                      ? errIds.has(o.id)
                        ? "#ERR"
                        : ((o.data as any)?.computed ?? "")
                      : ((o.data as any)?.value ?? "");
                return (
                  <td key={q} className="p-0 border border-[var(--border)]">
                    <input
                      key={`${o?.id ?? `empty-${q}-${r}`}:${String(shown_val)}`}
                      defaultValue={formula ?? String(shown_val)}
                      spellCheck={false}
                      onBlur={e => {
                        if (e.target.value !== (formula ?? String(shown_val))) commit(q, r, e.target.value);
                      }}
                      onKeyDown={e => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      title={formula ? `${colName(q)}${r + 1}: ${formula}` : `${colName(q)}${r + 1}`}
                      className={`w-full px-1 py-1 bg-[var(--bg-3)] text-[11px] outline-none focus:bg-[var(--bg-4)] ${
                        formula ? "text-[var(--accent)]" : "text-[var(--text)]"
                      } ${o && errIds.has(o.id) ? "text-[#ff8a6b]" : ""}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {errors.length > 0 && (
        <div className="mt-2 p-2 rounded-[8px] bg-[rgba(90,255,140,0.06)] border border-[var(--border)] text-[9px] text-[var(--text-dim)]">
          <div className="font-bold text-[#ff8a6b]">SHEET ERRORS</div>
          {errors.map((err, i) => (
            <div key={i} className="mt-1">
              • {err}
            </div>
          ))}
        </div>
      )}
      <div className="mt-1 text-[9px] text-[var(--text-faint)]">
        Type a number, text, or =formula. Formulas recompute through the derivation DAG on every edit.
      </div>
    </div>
  );
}
