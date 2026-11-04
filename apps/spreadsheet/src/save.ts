// Pure save-plan assembly for the spreadsheet shell: settings travel with the
// opened file (never the seed), and the chain is verified before publishing.
// Thin wrapper over the shared buildAppSave; kept pure so the verify script
// can drive the complete save/reload round trip without React.
import type { AppliedMorph } from "../../../src/framework/morphs/registry";
import type { HistoryStep } from "../../../src/framework/history";
import type { Occupant } from "../../../src/framework/types";
import { buildAppSave, type PlanBase } from "../../../src/framework/save";

export type SheetSettings = {
  tilingId: string;
  presetId: string;
  ruleSet: any;
  regions: any[];
  interpretation: any;
};

export function buildSheetSave(args: {
  settings: SheetSettings;
  size: { w: number; h: number };
  occupants: Occupant[];
  base: PlanBase;
  adopted: AppliedMorph[];
  past: HistoryStep[];
}): { plan: any; checkpointed: boolean } {
  return buildAppSave(args);
}
