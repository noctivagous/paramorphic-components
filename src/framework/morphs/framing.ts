// ---------- Framing codec (morph vocabulary for the Protocol substrate) ----------
// README 6.5: the Protocol substrate is length-framed message streams. This is
// the framing half — pure encode/decode, no transport. Delivery (socket,
// pipe, queue, in-memory bus) is the platform adapter's job and stays out of
// core, exactly like audio production stays out of the traversal kernel.
export function encodeFrame(payload: string): Uint8Array {
  const body = new TextEncoder().encode(payload);
  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setUint32(0, body.length, false);
  out.set(body, 4);
  return out;
}

export type DecodedStream = { messages: string[]; rest: Uint8Array };

export function decodeStream(chunk: Uint8Array, rest: Uint8Array = new Uint8Array(0)): DecodedStream {
  const buf = new Uint8Array(rest.length + chunk.length);
  buf.set(rest, 0);
  buf.set(chunk, rest.length);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const messages: string[] = [];
  let off = 0;
  while (buf.length - off >= 4) {
    const len = view.getUint32(off, false);
    if (buf.length - off - 4 < len) break;
    messages.push(new TextDecoder().decode(buf.slice(off + 4, off + 4 + len)));
    off += 4 + len;
  }
  return { messages, rest: buf.slice(off) };
}

export function toHex(bytes: Uint8Array, max = 48): string {
  return [...bytes.slice(0, max)].map(b => b.toString(16).padStart(2, "0")).join(" ");
}
