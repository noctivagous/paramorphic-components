// Player: one interpretation of a timed grid. A traversal cursor walks the
// time axis (top row); each tick collects trigger hits down the entered
// column and sounds them through the platform audio adapter. Notes are
// plain occupants toggled by click; pitch is plan vocabulary in data.pitch.
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Occupant, TilingDef } from "../framework";
import { advanceCursor, collectTriggers, createCursor, createToneTrigger, linePath, makeId, removeOccupant, resolveFrequency, upsertOccupant } from "../framework";
import type { PitchMapping, ToneTrigger } from "../framework";

const SCALE = [0, 2, 4, 7, 9];

const DEFAULT_MAPPING: PitchMapping = { kind: "semitone", attr: "pitch", baseHz: 220 };

export function PlayerView({
  occupants,
  setOccupants,
  tiling,
  width,
  height,
  mapping,
}: {
  occupants: Occupant[];
  setOccupants: (o: Occupant[]) => void;
  tiling: TilingDef;
  width: number;
  height: number;
  mapping?: PitchMapping;
}) {
  const [playing, setPlaying] = useState(false);
  const [tempo, setTempo] = useState(4);
  const [step, setStep] = useState(0);
  const cursorRef = useRef(createCursor({ cells: [] }, { loop: true }));
  const ctxRef = useRef<AudioContext | null>(null);
  const trigRef = useRef<ToneTrigger | null>(null);
  const occRef = useRef(occupants);
  occRef.current = occupants;
  const pitchOf = useMemo(() => mapping ?? DEFAULT_MAPPING, [mapping]);

  useEffect(() => {
    cursorRef.current = createCursor(linePath(tiling, { q: 0, r: 0 }, "E", width, width, height), {
      loop: true,
    });
    setStep(0);
  }, [tiling, width, height]);

  useEffect(() => {
    if (!playing) return;
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
      trigRef.current = createToneTrigger(ctxRef.current);
    }
    const id = setInterval(() => {
      const adv = advanceCursor(cursorRef.current);
      cursorRef.current = adv.cursor;
      if (adv.entered.length === 0) return;
      const q = adv.entered[0].q;
      setStep(q);
      const colCells = Array.from({ length: height }, (_, r) => ({ q, r }));
      for (const hit of collectTriggers(occRef.current, colCells)) {
        const occ = occRef.current.find(o => o.id === hit.occupantId);
        if (!occ) continue;
        try {
          const f = resolveFrequency((occ.data as any) ?? {}, pitchOf);
          trigRef.current?.(f, 60 / tempo / 2, Number((occ.data as any)?.vel ?? 0.8));
        } catch {
          /* unmapped datum stays silent */
        }
      }
    }, 1000 / tempo);
    return () => clearInterval(id);
  }, [playing, tempo, height, pitchOf]);

  const toggle = (q: number, r: number) => {
    const existing = occupants.find(o => o.anchor.q === q && o.anchor.r === r);
    if (existing) {
      setOccupants(removeOccupant(occupants, existing.id));
      return;
    }
    setOccupants(
      upsertOccupant(occupants, {
        id: makeId(),
        anchor: { q, r },
        span: [],
        type: "note",
        data: {
          player: "composer",
          vel: 0.8,
          pitch: SCALE[r % SCALE.length] + 12 * Math.floor(r / SCALE.length),
        },
        tags: [],
      })
    );
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[10px]">
        <button
          onClick={() => setPlaying(p => !p)}
          className={`px-3 py-1 rounded-full font-bold border ${
            playing
              ? "bg-[var(--accent)] text-black border-[var(--accent)]"
              : "bg-[var(--bg-3)] border-[var(--border)]"
          }`}
        >
          {playing ? "STOP" : "PLAY"}
        </button>
        <label className="text-[var(--text-dim)]">
          tempo
          <input
            type="range"
            min={1}
            max={12}
            value={tempo}
            onChange={e => setTempo(Number(e.target.value))}
            className="mx-2 align-middle"
          />
          {tempo}/s
        </label>
        <span className="text-[var(--text-faint)]">step {step + 1}/{width} — click cells to toggle notes (pitch from row)</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${width}, 26px)` }} className="gap-[2px]">
        {Array.from({ length: height }, (_, r) =>
          Array.from({ length: width }, (_, q) => {
            const occ = occupants.find(o => o.anchor.q === q && o.anchor.r === r);
            const hot = q === step && playing;
            return (
              <button
                key={`${q},${r}`}
                onClick={() => toggle(q, r)}
                title={occ ? `note pitch=${(occ.data as any)?.pitch ?? "unmapped"}` : `empty ${q},${r}`}
                className={`h-[26px] rounded-[4px] border ${
                  occ ? "bg-[var(--accent)] border-[var(--accent)]" : "bg-[var(--bg-3)] border-[var(--border)]"
                } ${hot ? "outline outline-1 outline-[var(--text)]" : ""}`}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
