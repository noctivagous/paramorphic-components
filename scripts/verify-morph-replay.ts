// Maintained replay check: every stored plan must load by replaying its
// base + morph chain, never by trusting the cached snapshot. Run with
// `npm run verify:replay` (esbuild bundle + node, no test framework).
import { readFileSync } from "node:fs";
import { loadPlan } from "../src/framework/plan";
import { applyMorph, invertMorph, replayMorphs } from "../src/framework/morphs/registry";
import "../src/framework/morphs/sheet";
import "../src/framework/morphs/grid";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`ok - ${name}`);
  } else {
    fail++;
    console.log(`FAIL - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

const files = [
  { path: "apps/spreadsheet/morph-plans/spreadsheet.json", morphs: 11, occupants: 11 },
  { path: "morph-plans/sequencer.json", morphs: 3, occupants: 3 },
  { path: "morph-plans/chat.json", morphs: 5, occupants: 5 },
];

// 1. Each stored plan replays to its cached snapshot.
for (const f of files) {
  const data = JSON.parse(readFileSync(f.path, "utf8"));
  const res = loadPlan({ data, errors: [] }, null);
  check(`${f.path} loads`, res.ok, res.ok ? "" : res.errors.join("; "));
  if (res.ok) {
    check(`${f.path} replays ${f.morphs} morphs`, res.plan.morphs.length === f.morphs,
      `got ${res.plan.morphs.length}`);
    check(`${f.path} yields ${f.occupants} occupants`, (res.plan.occupants ?? []).length === f.occupants,
      `got ${(res.plan.occupants ?? []).length}`);
    // 2. Replay is pure: the stored base still has its original occupants.
    check(`${f.path} base unmutated`, (data.base?.occupants ?? []).length === 0,
      `base now has ${data.base?.occupants?.length}`);
  }
}

// 3. A tampered cache is rejected, never partially applied.
{
  const data = JSON.parse(readFileSync(files[0].path, "utf8"));
  data.occupants = [];
  const res = loadPlan({ data, errors: [] }, null);
  check("tampered cache rejected", !res.ok, res.ok ? "loaded despite mismatch" : "");
  if (!res.ok) {
    check("mismatch message actionable", res.errors.some(e => e.includes("replay mismatch")),
      res.errors.join("; "));
  }
}

// 4. Unknown morphs and invalid params are rejected with actionable errors.
{
  const data = JSON.parse(readFileSync(files[1].path, "utf8"));
  const badName = { ...data, morphs: [{ name: "nope.ghost", params: {} }] };
  const r1 = loadPlan({ data: badName, errors: [] }, null);
  check("unknown morph rejected", !r1.ok, r1.ok ? "loaded" : "");
  const badParam = {
    ...data,
    morphs: [{ name: "grid.upsertOccupant", params: { occ: { id: "", anchor: { q: 0, r: 0 } } }, inverse: { prev: null } }],
  };
  const r2 = loadPlan({ data: badParam, errors: [] }, null);
  check("invalid morph param rejected", !r2.ok, r2.ok ? "loaded" : "");
}

// 5. Save round-trip: base + adopted chain + one new edit reloads cleanly.
{
  const data = JSON.parse(readFileSync(files[0].path, "utf8"));
  const first = loadPlan({ data, errors: [] }, null);
  check("round-trip base loads", first.ok, first.ok ? "" : first.errors.join("; "));
  if (first.ok) {
    const extra = {
      name: "sheet.setCell",
      params: { occ: { id: "c-9-9", anchor: { q: 4, r: 3 }, span: [], type: "cell", data: { value: 7 }, tags: [] } },
      inverse: { prev: null },
    };
    const applied = replayMorphs(first.plan.base, [...first.plan.morphs, extra]);
    check("round-trip edit applies", applied.ok);
    if (applied.ok) {
      const saved = { ...data, occupants: applied.state.occupants, morphs: [...first.plan.morphs, extra] };
      const reloaded = loadPlan({ data: saved, errors: [] }, null);
      check("round-trip save reloads", reloaded.ok, reloaded.ok ? "" : reloaded.errors.join("; "));
      if (reloaded.ok) {
        check("round-trip keeps edit", (reloaded.plan.occupants ?? []).some(o => o.id === "c-9-9"));
      }
    }
  }
}

// 6. grid.resize replays dimensions and inverts via its undo frame.
{
  const base = { occupants: [], width: 5, height: 4 };
  const chain = [{
    name: "grid.resize",
    params: { width: 8, height: 2 },
    inverse: { prevWidth: 5, prevHeight: 4 },
  }];
  const r = replayMorphs(base, chain);
  check("grid.resize replays", r.ok && r.state.width === 8 && r.state.height === 2);
  if (r.ok) {
    const back = invertMorph(r.state, chain[0]);
    check("grid.resize inverts", back !== null && back.width === 5 && back.height === 4);
  }
  const bad = applyMorph(base, { name: "grid.resize", params: { width: 0, height: 4 } });
  check("grid.resize rejects bad dims", !bad.ok);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
