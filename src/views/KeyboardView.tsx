// Keyboard: a Grid interpretation with irregular layout. Wide keys (Space,
// Shift, Enter, Tab, Backspace) are multi-cell occupants via span; staggered
// QWERTY rows are a view-only horizontal offset per row — never state, so
// placement validation and replay stay on dense grid coordinates. Clicking a
// key presses it (flash + tone, session-only, never recorded); EDIT LAYOUT
// mode adds keys on empty slots and removes keys on click, and those edits
// travel through the key.* vocabulary with undo/redo/save/open.
import React, { useMemo, useRef, useState } from "react";
import type { Occupant } from "../framework";
import { cellsOf } from "../framework";
import { createToneTrigger } from "../framework/adapters/audio";

const KEY_W = 44;
const KEY_H = 44;
const GAP = 4;

// View-only stagger per row (px). State keeps dense anchors; the offset only
// renders the familiar QWERTY shift. Indexed by row, extras reuse the last.
const STAGGER = [0, 10, 20, 30, 48];

function staggerFor(r: number): number {
  return STAGGER[Math.min(r, STAGGER.length - 1)];
}

function cellsOfKey(o: Occupant): { q: number; r: number }[] {
  return cellsOf(o);
}

export function KeyboardView({
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
  const [edit, setEdit] = useState(false);
  const [pressed, setPressed] = useState<string | null>(null);
  const [lastPress, setLastPress] = useState<string>("none yet — click a key");
  const ctxRef = useRef<AudioContext | null>(null);
  const trigRef = useRef<ReturnType<typeof createToneTrigger> | null>(null);

  const byCell = useMemo(() => {
    const m = new Map<string, Occupant>();
    for (const o of occupants) for (const c of cellsOfKey(o)) m.set(`${c.q},${c.r}`, o);
    return m;
  }, [occupants]);

  const anchorsByRow = useMemo(() => {
    const rows: Occupant[][] = Array.from({ length: height }, () => []);
    for (const o of occupants) {
      if (o.anchor.r >= 0 && o.anchor.r < height) rows[o.anchor.r].push(o);
    }
    for (const row of rows) row.sort((a, b) => a.anchor.q - b.anchor.q);
    return rows;
  }, [occupants, height]);

  const tone = (freq: number) => {
    try {
      if (!ctxRef.current) {
        ctxRef.current = new AudioContext();
        trigRef.current = createToneTrigger(ctxRef.current);
      }
      trigRef.current?.(freq, 0.15, 0.6);
    } catch {
      /* headless or blocked audio stays silent */
    }
  };

  const press = (o: Occupant) => {
    const n = Number((o.data as any)?.pitch);
    tone(Number.isFinite(n) ? 220 * Math.pow(2, n / 12) : 440);
    setPressed(o.id);
    setLastPress(`${(o.data as any)?.label ?? o.id}`);
    window.setTimeout(() => setPressed(cur => (cur === o.id ? null : cur)), 150);
  };

  const addKey = (q: number, r: number) => {
    const id = `key-${q}-${r}`;
    if (occupants.some(o => o.id === id)) return;
    setOccupants([
      ...occupants,
      { id, anchor: { q, r }, span: [], type: "key", data: { label: `K${q},${r}`, pitch: (r * 2 + q) % 12 }, tags: [] },
    ]);
  };

  const removeKey = (id: string) => {
    setOccupants(occupants.filter(o => o.id !== id));
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[10px]">
        <button
          onClick={() => setEdit(v => !v)}
          className={`px-3 py-1 rounded-full font-bold border ${
            edit
              ? "bg-[var(--accent)] text-black border-[var(--accent)]"
              : "bg-[var(--bg-3)] border-[var(--border)]"
          }`}
        >
          {edit ? "DONE EDITING" : "EDIT LAYOUT"}
        </button>
        <span className="text-[var(--text-dim)]">
          {edit
            ? "click an empty slot to add a key • click a key to remove it"
            : "click a key to press it (flash + tone, not recorded)"}
        </span>
        <span className="text-[var(--text-faint)]">last press: {lastPress}</span>
      </div>
      <div className="flex flex-col gap-[4px]">
        {Array.from({ length: height }, (_, r) => (
          <div key={r} className="flex gap-[4px]" style={{ marginLeft: staggerFor(r) }}>
            {edit
              ? // Edit mode renders every slot so empty cells are clickable.
                Array.from({ length: width }, (_, q) => {
                  const occ = byCell.get(`${q},${r}`);
                  const isAnchor = occ && occ.anchor.q === q && occ.anchor.r === r;
                  const isCovered = occ && !isAnchor;
                  if (isCovered) return null;
                  if (occ && isAnchor) {
                    const w = (occ.span.length + 1) * KEY_W + occ.span.length * GAP - GAP;
                    return (
                      <button
                        key={`${q},${r}`}
                        onClick={() => removeKey(occ.id)}
                        title={`${(occ.data as any)?.label ?? occ.id} — click to remove`}
                        className="rounded-[6px] border border-[#ff8a6b] bg-[rgba(255,90,60,0.15)] text-[11px] font-bold"
                        style={{ width: w, height: KEY_H }}
                      >
                        {(occ.data as any)?.label ?? occ.id} ✕
                      </button>
                    );
                  }
                  return (
                    <button
                      key={`${q},${r}`}
                      onClick={() => addKey(q, r)}
                      title={`empty ${q},${r} — click to add`}
                      className="rounded-[6px] border border-dashed border-[var(--border)] text-[var(--text-faint)] text-[12px]"
                      style={{ width: KEY_W, height: KEY_H }}
                    >
                      +
                    </button>
                  );
                })
              : // Play mode renders anchor keys only; span width shows size,
                // row margin shows stagger.
                anchorsByRow[r].map(o => {
                  const w = (o.span.length + 1) * KEY_W + o.span.length * GAP - GAP;
                  const hot = pressed === o.id;
                  return (
                    <button
                      key={o.id}
                      onClick={() => press(o)}
                      title={`${(o.data as any)?.label ?? o.id}${o.span.length ? ` • ${o.span.length + 1} cells wide` : ""}`}
                      className={`rounded-[6px] border text-[11px] font-bold transition-all ${
                        hot
                          ? "bg-[var(--accent)] text-black border-[var(--accent)]"
                          : "bg-[var(--bg-3)] border-[var(--border)]"
                      }`}
                      style={{ width: w, height: KEY_H }}
                    >
                      {(o.data as any)?.label ?? o.id}
                    </button>
                  );
                })}
          </div>
        ))}
      </div>
    </div>
  );
}
