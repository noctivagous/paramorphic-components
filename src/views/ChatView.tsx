// Chat: one interpretation of threads-over-occupants. Threads are regions,
// messages are occupants, posting is placing. The wire panel encodes the
// thread with the length-prefix framing codec and decodes it back, proving
// the Protocol framing half. Delivery (socket, queue, bus) is a platform
// adapter and stays out — this file is the local-first half.
import React, { useMemo, useState } from "react";
import type { Occupant } from "../framework";
import { decodeStream, encodeFrame, makeId, toHex, upsertOccupant } from "../framework";

export function ChatView({
  occupants,
  setOccupants,
}: {
  occupants: Occupant[];
  setOccupants: (o: Occupant[]) => void;
}) {
  const threads = useMemo(() => {
    const seen: string[] = [];
    for (const o of occupants) {
      const t = String((o.data as any)?.thread ?? "general");
      if (!seen.includes(t)) seen.push(t);
    }
    return seen.length > 0 ? seen : ["general"];
  }, [occupants]);
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const thread = active && threads.includes(active) ? active : threads[0];
  const messages = useMemo(
    () =>
      occupants
        .filter(o => String((o.data as any)?.thread) === thread)
        .sort((a, b) => Number((a.data as any)?.ts ?? 0) - Number((b.data as any)?.ts ?? 0)),
    [occupants, thread]
  );

  const wire = useMemo(() => {
    const frames = messages.map(m =>
      encodeFrame(JSON.stringify({ t: (m.data as any)?.thread, a: (m.data as any)?.author, x: (m.data as any)?.text }))
    );
    const bytes = frames.reduce((n, f) => n + f.length, 0);
    const joined = new Uint8Array(bytes);
    let off = 0;
    for (const f of frames) {
      joined.set(f, off);
      off += f.length;
    }
    const back = decodeStream(joined);
    return { bytes, hex: toHex(joined), ok: back.messages.length === messages.length && back.rest.length === 0 };
  }, [messages]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const maxQ = occupants.reduce((m, o) => Math.max(m, o.anchor.q), -1);
    setOccupants(
      upsertOccupant(occupants, {
        id: makeId(),
        anchor: { q: maxQ + 1, r: 0 },
        span: [],
        type: "message",
        data: { thread, author: "you", text, ts: Date.now() },
        tags: [],
      })
    );
    setDraft("");
  };

  return (
    <div className="flex gap-2">
      <div className="w-32 shrink-0">
        <div className="text-[9px] tracking-[0.18em] text-[var(--text-faint)]">THREADS</div>
        <div className="mt-1 flex flex-col gap-1">
          {threads.map(t => (
            <button
              key={t}
              onClick={() => setActive(t)}
              className={`px-2 py-1.5 rounded-[8px] text-[10px] border text-left ${
                t === thread
                  ? "bg-[var(--accent)] text-black border-[var(--accent)] font-bold"
                  : "bg-[var(--bg-3)] border-[var(--border)]"
              }`}
            >
              #{t}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-col gap-1 max-h-[300px] overflow-auto">
          {messages.map(m => (
            <div key={m.id} className="px-2 py-1.5 rounded-[8px] bg-[var(--bg-3)] border border-[var(--border)]">
              <span className="text-[10px] font-bold text-[var(--accent)]">{String((m.data as any)?.author)} </span>
              <span className="text-[11px]">{String((m.data as any)?.text)}</span>
            </div>
          ))}
          {messages.length === 0 && <div className="text-[10px] text-[var(--text-faint)]">No messages yet — say hi.</div>}
        </div>
        <div className="mt-2 flex gap-1">
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") send();
            }}
            placeholder={`message #${thread}...`}
            spellCheck={false}
            className="flex-1 px-2 py-1.5 rounded-[8px] bg-[var(--bg-3)] border border-[var(--border)] text-[10px] outline-none"
          />
          <button
            onClick={send}
            className="px-3 py-1 rounded-full bg-[var(--accent)] text-black text-[10px] font-bold"
          >
            SEND
          </button>
        </div>
        <div className="mt-2 p-2 rounded-[8px] bg-[var(--bg-3)] border border-[var(--border)] text-[9px] text-[var(--text-dim)]">
          <div className="font-bold text-[var(--text)]">
            WIRE — length-prefix framing {wire.ok ? "round-trips OK" : "MISMATCH"}
          </div>
          <div className="mt-1">
            {wire.bytes} bytes, {messages.length} frames. first bytes: {wire.hex || "—"}
          </div>
          <div className="mt-1 text-[var(--text-faint)]">
            Framing is the Protocol substrate; delivery (socket, queue, bus) is a platform adapter and deferred.
          </div>
        </div>
      </div>
    </div>
  );
}
