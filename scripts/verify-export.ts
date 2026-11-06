// ---------- verify:export — the standalone gate (README §8.5, plan §6) ----------
// For each fixture: export to a temp dir, prove zero paramorphic
// imports/paths in the emitted sources, typecheck with the output's own
// tsconfig, build with Vite, and check behavior against the framework's
// own oracles (GuiRenderer SSR, the relations conformance cases).
// Emitter coverage is reported for every registry; the gate fails only
// when a FIXTURE uses an uncovered piece.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  exportProject,
  getControlData,
  listControlData,
  listControlEmitters,
  listDefEmitters,
  listMorphEmitters,
  listMorphs,
  listRelationDefs,
  resolvedRects,
  type SourceProvider,
} from "../src/framework";
import { exportGuiDocument, registerExtractionControlEmitters } from "../src/framework/export/gui";
import { defsWithExtraction, exportPlanApp, registerExtractionDefEmitters } from "../src/framework/export/relations";
import { GuiRenderer } from "../src/framework/app-kit/controls/GuiRenderer";
import { starterDocument } from "../apps/gui-builder/src/starter";
import { DEFAULT_VALUES, supershapePlanData } from "../apps/supershape/src/plans";
import { cubicPoint as frameworkCubicPoint, sampleCubic as frameworkSampleCubic, supershapePoints as frameworkSupershapePoints } from "../src/framework/morphs/relation-defs";
import React from "react";
import { renderToString } from "react-dom/server";

let checks = 0;
const check = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

const repoRoot = process.cwd();
const sourceRoots: Record<string, string> = {
  "controls/": "src/framework/app-kit/controls/",
  "app-kit/": "src/framework/app-kit/",
  "morphs/": "src/framework/morphs/",
  "framework/": "src/framework/",
};
const source: SourceProvider = {
  readText(logicalPath) {
    const prefix = Object.keys(sourceRoots).find(p => logicalPath.startsWith(p));
    const relative = prefix ? sourceRoots[prefix] + logicalPath.slice(prefix.length) : logicalPath;
    const file = path.join(repoRoot, relative);
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  },
};

registerExtractionControlEmitters(listControlData().map(d => d.type));
registerExtractionDefEmitters(listRelationDefs());

function exportFixture(name: string, input: unknown): string {
  const result = exportProject(input, {
    source,
    controlTypes: listControlData().map(d => d.type),
    getControlData,
    resolvedRects: (doc, device) => resolvedRects(doc as never, device as never),
    relationDefs: listRelationDefs(),
    guiExporter: (project, raw, doc, shell) => exportGuiDocument(project, raw, doc, shell),
    planExporter: (project, raw, plan) => exportPlanApp(project, raw, plan),
  });
  check(result.manifest.diagnostics.length === 0, `${name}: export is complete (diagnostics: ${result.manifest.diagnostics.join("; ")})`);
  const dir = mkdtempSync(path.join(tmpdir(), `verify-export-${name}-`));
  for (const [file, content] of result.files) {
    const target = path.join(dir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "junction");
  // Zero paramorphic imports/paths anywhere in the emitted project.
  for (const [file, content] of result.files) {
    check(!/paramorphic/i.test(content), `${name}: ${file} contains no paramorphic reference`);
  }
  // Standalone typecheck with the output's own tsconfig (no framework alias).
  execFileSync(process.execPath, [path.join(repoRoot, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", "tsconfig.json"], { cwd: dir, stdio: "pipe" });
  checks++;
  // Standalone Vite build with the repo toolchain pointed at the output.
  execFileSync(process.execPath, [path.join(repoRoot, "node_modules/vite/bin/vite.js"), "build"], { cwd: dir, stdio: "pipe" });
  checks++;
  return dir;
}

function bundleEntry(dir: string, entryName: string, entrySource: string): any {
  const entry = path.join(dir, entryName);
  writeFileSync(entry, entrySource);
  const out = path.join(dir, `${entryName}.cjs`);
  execFileSync(path.join(repoRoot, "node_modules/.bin/esbuild"), [entry, "--bundle", "--platform=node", "--format=cjs", `--outfile=${out}`, "--loader:.css=empty", "--log-level=error"], { stdio: "pipe" });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(out);
}

// ----- fixture 1: GUI starter document -----
const guiDoc = starterDocument();
const guiDir = exportFixture("gui", guiDoc);
{
  // SSR equivalence: exported App vs GuiRenderer, node-for-node.
  const exported = bundleEntry(guiDir, "ssr-entry.tsx", `
import React from "react";
import { renderToString } from "react-dom/server";
import App from "./src/App";
export const html = renderToString(React.createElement(App));
`);
  const reference = renderToString(React.createElement(GuiRenderer, { document: guiDoc, device: guiDoc.device }));
  const pick = (html: string) => [...html.matchAll(/data-gui-node="([^"]+)" style="([^"]*)"/g)].map(m => `${m[1]}|${m[2]}`);
  const a = pick(reference), b = pick(exported.html as string);
  check(a.length === 19, `gui: GuiRenderer renders 19 nodes (got ${a.length})`);
  check(b.length === a.length, `gui: exported App renders ${a.length} nodes (got ${b.length})`);
  check(JSON.stringify(a) === JSON.stringify(b), "gui: exported App is node-for-node equivalent to GuiRenderer (ids + rect styles, in order)");
}

// ----- fixture 2: supershape plan -----
const superDir = exportFixture("supershape", supershapePlanData(DEFAULT_VALUES));
{
  const rel = bundleEntry(superDir, "rel-entry.ts", `export * from "./src/relations";`);
  // Circle identity, the standard cases from verify:relations (1e-6).
  for (const [m, n1] of [[0, 1], [3, 0.5], [5, 1], [8, 4], [12, 17]] as const) {
    const out = rel.supershapePolar({ m, n1, n2: 2, n3: 2, a: 1, b: 1 }, { sampleCount: 72, bindingId: "check" });
    check(out.points.length === 72, `supershape: 72 samples for m=${m}`);
    const worst = Math.max(...out.points.map((p: { x: number; y: number }) => Math.abs(Math.hypot(p.x, p.y) - 1)));
    check(worst <= 1e-6, `supershape: circle identity holds for m=${m}, n1=${n1} (worst ${worst})`);
  }
  // And point-for-point agreement with the framework's own function.
  const mine = rel.supershapePolar({ ...DEFAULT_VALUES }, { sampleCount: 180, bindingId: "shape" }).points;
  const theirs = frameworkSupershapePoints({ ...DEFAULT_VALUES }, 180);
  check(mine.length === theirs.length && mine.every((p: { x: number; y: number }, i: number) => Math.abs(p.x - theirs[i].x) < 1e-12 && Math.abs(p.y - theirs[i].y) < 1e-12),
    "supershape: exported def agrees point-for-point with the framework def");
  const app = readFileSync(path.join(superDir, "src/App.tsx"), "utf8");
  check(app.includes("// binding: shape (supershape.polar)"), "supershape: App carries the binding trace comment");
  check(app.includes("useMemo"), "supershape: binding emitted as a useMemo");
}

// ----- fixture 3: bézier demo plan -----
const bezierPlan = JSON.parse(readFileSync(path.join(repoRoot, "morph-plans/bezier.json"), "utf8"));
const bezDir = exportFixture("bezier", bezierPlan);
{
  const rel = bundleEntry(bezDir, "rel-entry.ts", `export * from "./src/relations";`);
  const P = [{ x: 1, y: 6 }, { x: 3, y: 1 }, { x: 7, y: 1 }, { x: 8, y: 6 }];
  const out = rel.bezierCubic({ p0: P[0], p1: P[1], p2: P[2], p3: P[3] }, { sampleCount: 33, bindingId: "curve" });
  check(out.points.length === 33, "bezier: binding samples 33 points");
  check(out.points[0].x === 1 && out.points[0].y === 6, "bezier: first sampled point is exactly p0");
  check(out.points[32].x === 8 && out.points[32].y === 6, "bezier: last sampled point is exactly p3");
  const at0 = rel.cubicPoint(P[0], P[1], P[2], P[3], 0);
  const at1 = rel.cubicPoint(P[0], P[1], P[2], P[3], 1);
  check(at0.x === 1 && at0.y === 6 && at1.x === 8 && at1.y === 6, "bezier: cubicPoint endpoints are exact");
  const theirs = frameworkSampleCubic(P[0] as never, P[1] as never, P[2] as never, P[3] as never, 33);
  check(out.points.every((p: { x: number; y: number }, i: number) => Math.abs(p.x - theirs[i].x) < 1e-12 && Math.abs(p.y - theirs[i].y) < 1e-12),
    "bezier: exported samples agree with the framework's sampleCubic");
  const mid = rel.bezierPointAt({ p0: P[0], p1: P[1], p2: P[2], p3: P[3], t: 0.5 }, { bindingId: "marker" }).point;
  const oracle = frameworkCubicPoint(P[0] as never, P[1] as never, P[2] as never, P[3] as never, 0.5);
  check(Math.abs(mid.x - oracle.x) < 1e-9 && Math.abs(mid.y - oracle.y) < 1e-9, "bezier: pointAt(0.5) matches the framework oracle");
  const app = readFileSync(path.join(bezDir, "src/App.tsx"), "utf8");
  check(app.indexOf("// binding: curve (bezier.cubic)") >= 0 && app.indexOf("// binding: curve (bezier.cubic)") < app.indexOf("// binding: marker (bezier.pointAt)"),
    "bezier: bindings emitted in engine order (curve before marker)");
}

// ----- emitter coverage -----
{
  const controlTypes = listControlData().map(d => d.type);
  const controlEmitters = new Set(listControlEmitters());
  const missingControls = controlTypes.filter(t => !controlEmitters.has(t));
  const fixtureControls = [...new Set(guiDoc.nodes.map(n => n.type))];
  check(fixtureControls.every(t => controlEmitters.has(t)), "coverage: every control type used by the fixtures has an emitter");
  console.log(`coverage: controls ${controlTypes.length - missingControls.length}/${controlTypes.length} have emitters${missingControls.length ? `; missing: ${missingControls.join(", ")}` : ""}`);

  const defIds = listRelationDefs().map(d => d.id);
  const extracted = new Set(defsWithExtraction());
  const fixtureDefs = ["supershape.polar", "bezier.cubic", "bezier.pointAt"];
  check(fixtureDefs.every(id => extracted.has(id)), "coverage: every def used by the fixtures has an extraction emitter");
  const defEmitters = new Set(listDefEmitters());
  const noEmitter = defIds.filter(id => !defEmitters.has(id));
  check(noEmitter.length === 0, "coverage: every registered def has an emitter or a diagnostic emitter");
  console.log(`coverage: defs extracted: ${defIds.filter(id => extracted.has(id)).join(", ")}; diagnostic-only: ${defIds.filter(id => !extracted.has(id)).join(", ") || "none"}`);

  const morphTypes = listMorphs().map(m => m.type);
  const morphEmitters = new Set(listMorphEmitters());
  const morphMissing = morphTypes.filter(t => !morphEmitters.has(t));
  console.log(`coverage: morphs ${morphTypes.length - morphMissing.length}/${morphTypes.length} have emitters (morph emission is E5; no fixture uses a morph)`);
  check(morphMissing.length === morphTypes.length, "coverage: morph emitters are honestly absent in E1–E3 scope (E5)");
}

console.log(`verify:export OK (${checks} checks)`);
