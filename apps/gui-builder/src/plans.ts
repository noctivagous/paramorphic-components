// The builder's shell comes from the app-kit gui-builder recipe; the
// document itself is a paramorphic GUI plan (see starter.ts / save.ts).
import { starterDocument } from "./starter";

export const PLANS = [{ id: "starter", label: "Starter document", data: starterDocument() }];
