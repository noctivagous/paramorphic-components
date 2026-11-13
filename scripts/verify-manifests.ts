// Manifest verification (D1a): every app under apps/ carries an app.json
// that validates under paramorphic-app/1, every file it references exists
// and loads under its own format's loader, and the data files D1a shipped
// for TS-only documents are *the same documents* the apps build in code
// today (recipe shells, the GUI starter, the supershape plan) — proven by
// loading both and comparing, not by inspection. Negative fixtures pin the
// settled decisions (2026-11-12): refs only, no recipe entries, capability
// declarations explicit, persistence slots resolve. Bare node asserts, one
// summary line — same idiom as verify-relations.ts / verify-gui.ts.
// Host consumption of manifests is D1b/D1c; nothing here boots an app.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  appKit,
  loadGuiDocument,
  loadManifest,
  loadPlan,
  loadShellPlan,
  manifestRefs,
  validateManifest,
  type AppManifest,
} from "../src/framework";
import { starterDocument } from "../apps/gui-builder/src/starter";
import { DEFAULT_VALUES, supershapePlanData } from "../apps/supershape/src/plans";

let checks = 0;
const ok = (cond: unknown, msg: string) => { checks++; assert.ok(cond, msg); };
const eq = (a: unknown, b: unknown, msg: string) => { checks++; assert.deepEqual(a, b, msg); };

const root = process.cwd(); // npm scripts run from the repo root (verify-export idiom)
const appsDir = path.join(root, "apps");
const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));
const jsonRoundTrip = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

function loadRef(format: string, data: unknown): { ok: boolean; errors: string[] } {
  if (format === "paramorphic-plan/1") {
    const r = loadPlan({ data, errors: [] }, null);
    return { ok: r.ok, errors: r.ok ? [] : r.errors };
  }
  if (format === "paramorphic-gui/1") {
    const r = loadGuiDocument(data);
    return { ok: r.ok, errors: r.ok ? [] : r.errors };
  }
  if (format === "paramorphic-shell/1") {
    const r = loadShellPlan(data);
    return { ok: r.ok, errors: r.ok ? [] : r.errors };
  }
  return { ok: false, errors: [`no loader for format "${format}"`] };
}

// ---------- shipped manifests ----------
const appNames = fs.readdirSync(appsDir, { withFileTypes: true })
  .filter(e => e.isDirectory()).map(e => e.name).sort();
eq(appNames, ["browser", "gui-builder", "keyboard", "player", "spreadsheet", "supershape"],
  "the gate knows the six shipped apps (a new app updates this list and brings a manifest)");

const manifests = new Map<string, AppManifest>();
for (const app of appNames) {
  const dir = path.join(appsDir, app);
  const file = path.join(dir, "app.json");
  ok(fs.existsSync(file), `${app}: app.json exists (settled decision 1: one manifest per app directory)`);
  const loaded = loadManifest(readJson(file));
  ok(loaded.ok, `${app}: app.json validates under paramorphic-app/1${loaded.ok ? "" : ` — ${loaded.errors.join("; ")}`}`);
  if (!loaded.ok) continue;
  const manifest = loaded.manifest;
  manifests.set(app, manifest);
  eq(manifest.id, app, `${app}: manifest id matches its directory`);

  // Host resolution step 2: every named file exists and loads.
  for (const ref of manifestRefs(manifest)) {
    if (ref.format === "actions" || ref.format === "theme-plan") {
      // No loader exists for D2's actions format or D8's theme plans yet;
      // a shipped manifest may not rest on one until its slice lands.
      ok(false, `${app}: ${ref.where} references a ${ref.format} document, which has no loader in D1a`);
      continue;
    }
    const target = path.join(dir, ref.ref);
    ok(fs.existsSync(target), `${app}: ${ref.where} ref "${ref.ref}" exists`);
    if (!fs.existsSync(target)) continue;
    const result = loadRef(ref.format, readJson(target));
    ok(result.ok, `${app}: ${ref.where} "${ref.ref}" loads as ${ref.format}${result.ok ? "" : ` — ${result.errors.join("; ")}`}`);
  }
  if (manifest.entry.type === "code") {
    const base = path.join(dir, manifest.entry.module);
    const found = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]
      .some(f => fs.existsSync(f));
    ok(found, `${app}: code entry module "${manifest.entry.module}" exists`);
  }
}

// ---------- shipped data files are the apps' own documents ----------
// Shells: each shipped shell.json loads to exactly the plan its app-kit
// recipe builds in code (with the title the app itself passes).
for (const [app, recipeId, title] of [
  ["browser", "browser", "File browser"],
  ["gui-builder", "gui-builder", "GUI Builder"],
  ["spreadsheet", "spreadsheet", "Spreadsheet"],
] as const) {
  const inst = appKit.instantiate(recipeId, { title });
  ok(inst.ok, `${app}: recipe "${recipeId}" still instantiates`);
  if (!inst.ok) continue;
  const fromFile = loadShellPlan(readJson(path.join(appsDir, app, "shell.json")));
  ok(fromFile.ok, `${app}: shell.json loads`);
  if (fromFile.ok) eq(fromFile.plan, inst.plan, `${app}: shell.json is the recipe's shell plan, as data`);
}

// GUI builder starter: the shipped starter.json is starterDocument().
{
  const fromFile = readJson(path.join(appsDir, "gui-builder", "morph-plans", "starter.json"));
  eq(fromFile, jsonRoundTrip(starterDocument()), "gui-builder: starter.json is the starter document, as data");
}

// Supershape: the shipped plan is supershapePlanData at the default
// values, and both copies load to the same plan.
{
  const fileData = readJson(path.join(appsDir, "supershape", "morph-plans", "supershape.json"));
  const codeData = jsonRoundTrip(supershapePlanData(DEFAULT_VALUES));
  eq(fileData, codeData, "supershape: supershape.json is supershapePlanData(DEFAULT_VALUES), as data");
  const a = loadPlan({ data: fileData, errors: [] }, null);
  const b = loadPlan({ data: codeData, errors: [] }, null);
  ok(a.ok && b.ok, "supershape: both copies of the plan load");
  if (a.ok && b.ok) eq(a.plan, b.plan, "supershape: file and code plans load to identical state");
}

// ---------- validator fixtures: the settled decisions, pinned ----------
const base: Record<string, unknown> = {
  $schema: "paramorphic-app/1", id: "fixture", name: "Fixture", version: "0.1.0",
  kind: "gui", entry: { type: "plan", ref: "morph-plans/fixture.json" },
};
const invalid = (mutate: (m: Record<string, any>) => void, fragment: string, msg: string) => {
  const m = JSON.parse(JSON.stringify(base));
  mutate(m);
  const errors = validateManifest(m);
  ok(errors.some(e => e.includes(fragment)), `${msg} — got: ${errors.join("; ") || "(valid)"}`);
};
const valid = (mutate: (m: Record<string, any>) => void, msg: string) => {
  const m = JSON.parse(JSON.stringify(base));
  mutate(m);
  eq(validateManifest(m), [], msg);
};

invalid(m => { m.entry = { type: "recipe", id: "spreadsheet", params: {} }; }, "recipe",
  "decision 6: a recipe is not an app entry");
invalid(m => { m.entry = { type: "plan", document: { occupants: [] } }; }, "entry.ref",
  "decision 4: documents are referenced, never inlined");
invalid(m => { m.entry = { type: "plan", ref: "../outside.json" }; }, "inside the app directory",
  "refs stay inside the app directory");
invalid(m => { m.persistence = [{ slot: "ghost", via: "file" }]; }, "not a declared document slot",
  "persistence slots must resolve to declared documents");
invalid(m => { m.io = { inputs: [{ name: "x", bind: "stdin" }] }; }, "io is only allowed",
  "io is cli/program only");
invalid(m => { m.capabilities = [{ name: "telepathy", required: true }]; }, "capabilities[0].name",
  "capabilities come from the closed vocabulary");
invalid(m => { m.capabilities = [{ name: "audio" }]; }, "required must be a boolean",
  "decision 5: required/optional is declared explicitly, never defaulted");
invalid(m => { m.persistence = [{ slot: "entry", via: "localStorage" }]; }, "key is required",
  "localStorage persistence names its key");
invalid(m => { m.kind = "daemon"; }, "kind must be one of",
  "the kind vocabulary is gui | cli | program");
invalid(m => { m.futureField = true; }, "unknown field",
  "unknown fields are errors (decision 8: additions teach the validator, they do not ride along)");
invalid(m => { m.documents = [{ slot: "a", format: "paramorphic-plan/1", ref: "a.json" }, { slot: "a", format: "paramorphic-plan/1", ref: "b.json" }]; },
  "duplicated", "document slot names are unique");
valid(m => { m.documents = [{ slot: "sheet", format: "paramorphic-plan/1", ref: "morph-plans/a.json" }]; m.persistence = [{ slot: "sheet", via: "file" }, { slot: "entry", via: "file" }]; },
  "persistence may name document slots and the entry document");
valid(m => { m.kind = "program"; m.entry = { type: "code", module: "src/main.ts" }; m.io = { inputs: [{ name: "in", bind: "file", ref: "in.json" }], outputs: [{ name: "out", bind: "stdout" }] }; },
  "a program manifest with a code entry and io ports validates (io shape-only in D1a)");
valid(m => { m.kind = "cli"; m.io = { inputs: [{ name: "cmd", bind: "argv" }] }; },
  "a cli manifest with argv input validates");

console.log(`verify:manifests — ${checks} checks passed (${appNames.length} apps)`);
