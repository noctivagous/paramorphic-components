// Stored plan files: one versioned JSON module per app. Plans are layer-1
// apps, so the registry lives here in the demo, not in src/framework.
// Every entry is validated by loadPlan on use; files carry full occupants
// (the serializer slices to 30 for display, files must not).
import sequencer from "./sequencer.json";

export type StoredPlan = { name: string; label: string; data: any };

export const STORED_PLANS: StoredPlan[] = [
  { name: "sequencer", label: "Sequencer file — 16x4 timed-toggle grid", data: sequencer },
];

export function getStoredPlan(name: string): any | null {
  return STORED_PLANS.find(p => p.name === name)?.data ?? null;
}
