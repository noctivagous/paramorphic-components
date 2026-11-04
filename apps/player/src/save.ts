// Pure save-plan assembly for the player shell: settings travel with the
// opened file (never the seed), and the chain is verified before publishing.
// Thin wrapper over the shared buildAppSave; kept pure for the verify round
// trip. The pitch mapping rides inside interpretation, not as a top-level key.
import type { AppliedMorph } from "../../../src/framework/morphs/registry";
import type { HistoryStep } from "../../../src/framework/history";
import type { Occupant } from "../../../src/framework/types";
import { buildAppSave, type PlanBase } from "../../../src/framework/save";
import type { PitchMapping } from "../../../src/framework/adapters/audio";

export type PlayerSettings = {
  tilingId: string;
  presetId: string;
  ruleSet: any;
  regions: any[];
  interpretation: any;
  mapping: PitchMapping;
};

const DEFAULT_MAPPING: PitchMapping = { kind: "semitone", attr: "pitch", baseHz: 220 };

export function mappingOf(interpretation: any): PitchMapping {
  return (interpretation as any)?.sound?.pitchMapping ?? DEFAULT_MAPPING;
}

export function buildPlayerSave(args: {
  settings: PlayerSettings;
  size: { w: number; h: number };
  occupants: Occupant[];
  base: PlanBase;
  adopted: AppliedMorph[];
  past: HistoryStep[];
}): { plan: any; checkpointed: boolean } {
  return buildAppSave(args);
}
