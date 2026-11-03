// This app's morph-plans. Each app owns its plans; the registry is just
// the list the shell can open.
import player from "../morph-plans/player.json";

export type StoredPlan = { name: string; label: string; data: any };

export const PLANS: StoredPlan[] = [
  { name: "player", label: "Player", data: player },
];
