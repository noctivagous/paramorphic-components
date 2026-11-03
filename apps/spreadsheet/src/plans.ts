// This app's morph-plans. Each app owns its plans; the registry is just
// the list the shell can open.
import sheet from "../morph-plans/spreadsheet.json";

export type StoredPlan = { name: string; label: string; data: any };

export const PLANS: StoredPlan[] = [
  { name: "spreadsheet", label: "Spreadsheet", data: sheet },
];
