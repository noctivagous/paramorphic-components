// ---------- Audio trigger adapter (platform layer, not core) ----------
// Core emits trigger hits (traversal.ts); this adapter turns them into sound.
// Vocabulary — which datum means which pitch — arrives as plan data through
// PitchMapping, never as adapter code. The framework core never imports
// AudioContext; the demo shell (or a hardware transport) owns the context.
export type PitchMapping =
  | { kind: "fixed"; hz: number }
  | { kind: "semitone"; attr: string; baseHz: number };

export function resolveFrequency(data: any, mapping: PitchMapping): number {
  if (mapping.kind === "fixed") return mapping.hz;
  const n = Number(data?.[mapping.attr]);
  if (!Number.isFinite(n)) {
    throw new Error(
      `[audio] cannot resolve pitch: data.${mapping.attr} is not a number`
    );
  }
  return mapping.baseHz * Math.pow(2, n / 12);
}

export type ToneTrigger = (freqHz: number, durSec?: number, velocity?: number) => void;

export function createToneTrigger(ctx: AudioContext): ToneTrigger {
  return (freqHz: number, durSec = 0.25, velocity = 0.8) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freqHz;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, velocity), t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + durSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + durSec + 0.05);
  };
}
