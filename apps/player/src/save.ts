// Pure save-plan assembly for the player shell: settings travel with the
// opened file (never the seed), and the chain is verified before publishing.
// Mirrors the spreadsheet helper; kept pure for the verify round trip.
import { chainForSave, type PlanBase } from "../../../src/framework/plan";
import type { AppliedMorph } from "../../../src/framework/morphs/registry";
import type { HistoryStep } from "../../../src/framework/history";
import type { Occupant } from "../../../src/framework/types";
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
  const stepped = args.past.map(e => e.morph).filter((m): m is AppliedMorph => m !== null);
  const saved = chainForSave(
    args.base,
    [...args.adopted, ...stepped],
    args.occupants,
    args.size.w,
    args.size.h
  );
  return {
    checkpointed: saved.checkpointed,
    plan: {
      $schema: "paramorphic-plan/1",
      component: "Grid",
      tilingId: args.settings.tilingId,
      presetId: args.settings.presetId,
      width: args.size.w,
      height: args.size.h,
      ruleSet: args.settings.ruleSet,
      occupants: args.occupants,
      regions: args.settings.regions,
      turns: args.settings.ruleSet.turns,
      outcomes: args.settings.ruleSet.outcomes,
      interpretation: args.settings.interpretation,
      base: saved.base,
      morphs: saved.morphs,
    },
  };
}
