// This app's morph-plans. Each app owns its plans; the registry is just
// the list the shell can open.
import keyboard from "../morph-plans/keyboard.json";

export type StoredPlan = { name: string; label: string; data: any };

export const PLANS: StoredPlan[] = [
  { name: "keyboard", label: "Keyboard", data: keyboard },
];
