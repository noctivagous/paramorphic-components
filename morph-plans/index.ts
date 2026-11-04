// Stored plan files: one versioned JSON module per app. Plans are layer-1
// apps, so the registry lives here in the demo, not in src/framework.
// Every entry is validated by loadPlan on use; files carry full occupants
// (the serializer slices to 30 for display, files must not).
import sequencer from "./sequencer.json";
import chat from "./chat.json";
import calendar from "./calendar.json";
import tictactoe from "./tictactoe.json";
import checkers from "./checkers.json";
import chess8 from "./chess8.json";
import painter from "./painter.json";

export type StoredPlan = { name: string; label: string; data: any };

export const STORED_PLANS: StoredPlan[] = [
  { name: "sequencer", label: "Sequencer file — 16x4 timed-toggle grid", data: sequencer },
  { name: "chat", label: "Chat file — threads over framed streams", data: chat },
  { name: "calendar", label: "Calendar file — month grid, same presentations as the sheet", data: calendar },
  { name: "tictactoe", label: "Tic-Tac-Toe — placement, line of 3, alternating turns", data: tictactoe },
  { name: "checkers", label: "Checkers — dark leaps, chain capture, promotion", data: checkers },
  { name: "chess8", label: "Chess 8x8 — simplified rules, promotion choice", data: chess8 },
  { name: "painter", label: "Painter — free placement toggle grid", data: painter },
];

export function getStoredPlan(name: string): any | null {
  return STORED_PLANS.find(p => p.name === name)?.data ?? null;
}
