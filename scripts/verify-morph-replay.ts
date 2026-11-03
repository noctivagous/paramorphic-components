// Maintained replay check: every stored plan must load by replaying its
// base + morph chain, never by trusting the cached snapshot. Run with
// `npm run verify:replay` (esbuild bundle + node, no test framework).
import { readFileSync } from "node:fs";
import { chainForSave, loadPlan } from "../src/framework/plan";
import {
  applyMorph,
  checkMorphState,
  describeChain,
  invertMorph,
  registerMorph,
  removeMorphAt,
  replaceMorphAt,
  replayMorphs,
} from "../src/framework/morphs/registry";
import { pushHistory, redoHistory, undoHistory } from "../src/framework/history";
import { buildSheetSave } from "../apps/spreadsheet/src/save";
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
  const noFrame = invertMorph(
    { occupants: [], width: 8, height: 2 },
    { name: "grid.resize", params: { width: 8, height: 2 } }
  );
  check("grid.resize without inverse data falls back", noFrame === null);
}

// 7. Snapshot-only plans still load: the snapshot becomes the base.
{
  const data = JSON.parse(readFileSync(files[0].path, "utf8"));
  delete data.base;
  delete data.morphs;
  const res = loadPlan({ data, errors: [] }, null);
  check("snapshot-only plan loads", res.ok, res.ok ? "" : res.errors.join("; "));
  if (res.ok) {
    check("snapshot-only chain is empty", res.plan.morphs.length === 0);
    check("snapshot-only base is the snapshot", res.plan.base.occupants.length === 11);
  }
}

// 8. History truncation drops the oldest steps at the cap.
{
  let past: ReturnType<typeof pushHistory> = [];
  let cur: any[] = [];
  for (let i = 0; i < 55; i++) {
    const next = [{ id: `c-${i}`, anchor: { q: 0, r: 0 }, span: [], type: "cell", data: {}, tags: [] }];
    past = pushHistory(past, cur, null);
    cur = next;
  }
  check("history capped at 50", past.length === 50, `got ${past.length}`);
  // 55 pushes keep the last 50 pre-edit snapshots (edits 5..54); the earliest
  // surviving entry holds the state before edit 5, which contains only c-4.
  const firstIds = past[0].snapshot.map((o: any) => o.id);
  check("truncation drops the oldest steps", JSON.stringify(firstIds) === JSON.stringify(["c-4"]),
    JSON.stringify(firstIds));
}

// 9. Undo followed by a new edit: redo is gone, the new branch holds.
{
  const dims = { width: 5, height: 4 };
  const s0: any[] = [];
  const s1 = [{ id: "a", anchor: { q: 0, r: 0 }, span: [], type: "cell", data: { value: 1 }, tags: [] }];
  const s2 = [{ id: "a", anchor: { q: 0, r: 0 }, span: [], type: "cell", data: { value: 2 }, tags: [] }];
  let past = pushHistory([], s0, null);
  past = pushHistory(past, s1, null);
  const u = undoHistory(past, [], s2, dims);
  check("undo restores s1", u.undone && JSON.stringify(u.occupants) === JSON.stringify(s1));
  // New edit on the undone state, as the shell does (future cleared).
  const s3 = [{ id: "a", anchor: { q: 0, r: 0 }, span: [], type: "cell", data: { value: 3 }, tags: [] }];
  const branched = pushHistory(u.past, u.occupants, null);
  const r = redoHistory(branched, [], s3, dims);
  check("redo after new edit is a no-op", !r.redone && JSON.stringify(r.occupants) === JSON.stringify(s3));
}

// 10. Inverse capture and failure semantics.
{
  const dims = { width: 5, height: 4 };
  const prev = { id: "c", anchor: { q: 1, r: 1 }, span: [], type: "cell", data: { value: 1 }, tags: [] };
  const next = { id: "c", anchor: { q: 1, r: 1 }, span: [], type: "cell", data: { value: 2 }, tags: [] };
  // Replacement inverts to the captured previous cell.
  const back = invertMorph({ occupants: [next], ...dims },
    { name: "sheet.setCell", params: { occ: next }, inverse: { prev } });
  check("replacement inverts to prev", back !== null && (back.occupants[0].data as any).value === 1);
  // Removal inverts to the removed cell.
  const gone = invertMorph({ occupants: [], ...dims },
    { name: "sheet.clearCell", params: { id: "c" }, inverse: { prev } });
  check("removal inverts to prev", gone !== null && gone.occupants.length === 1);
  // Missing inverse data falls back to the snapshot, never a guessed inverse.
  const snapshot = [prev];
  const current = [next];
  const u = undoHistory(
    [{ snapshot, morph: { name: "sheet.setCell", params: { occ: next } } }],
    [], current, dims);
  check("missing inverse restores snapshot", u.undone && JSON.stringify(u.occupants) === JSON.stringify(snapshot));
  // Non-invertible steps use the snapshot path too.
  registerMorph({
    name: "test.volatile",
    describe: "Test-only non-invertible morph",
    invertible: false,
    validate: () => [],
    apply: (state) => ({ ...state, occupants: [...state.occupants, next] }),
    invert: (state) => state,
  });
  const v = undoHistory(
    [{ snapshot: [], morph: { name: "test.volatile", params: {}, inverse: {} } }],
    [], [next], dims);
  check("non-invertible step restores snapshot", v.undone && v.occupants.length === 0);
}

// 11. Applicability: a candidate morph against the exact current state.
{
  const state = { occupants: [], width: 5, height: 4 };
  const far = { id: "x", anchor: { q: 9, r: 9 }, span: [], type: "cell", data: {}, tags: [] };
  const errs = checkMorphState("grid.upsertOccupant", state, { occ: far });
  check("out-of-bounds upsert inapplicable", errs.length === 1 && errs[0].includes("outside"),
    errs.join("; "));
  const missing = checkMorphState("grid.removeOccupant", state, { id: "ghost" });
  check("removing an absent occupant inapplicable", missing.length === 1 && missing[0].includes("not present"),
    missing.join("; "));
  const near = { id: "x", anchor: { q: 1, r: 1 }, span: [], type: "cell", data: {}, tags: [] };
  check("in-bounds upsert applicable", checkMorphState("grid.upsertOccupant", state, { occ: near }).length === 0);
  check("unknown morph reported", checkMorphState("nope.ghost", state, {}).length === 1);
}

// 12. Applied-chain inspection reads in human terms.
{
  const lines = describeChain([
    { name: "sheet.setCell", params: { occ: { id: "c" } }, inverse: { prev: null } },
    { name: "nope.ghost", params: {} },
  ]);
  check("describeChain numbers and describes", lines.length === 2 && lines[0].startsWith("1. Write or replace"),
    lines.join(" | "));
  check("describeChain names unknown morphs", lines[1].includes("nope.ghost"));
}

// 13. Removing an earlier morph replays dependents; conflicts name the step.
{
  const base = { occupants: [], width: 5, height: 4 };
  const a = { id: "a", anchor: { q: 0, r: 0 }, span: [], type: "cell", data: { value: 1 }, tags: [] };
  const b = { id: "b", anchor: { q: 1, r: 1 }, span: [], type: "cell", data: { value: 2 }, tags: [] };
  const mk = (occ: any) => ({ name: "sheet.setCell", params: { occ }, inverse: { prev: null } });
  const clean = removeMorphAt(base, [mk(a), mk(b)], 0);
  check("independent removal replays", clean.ok && (clean.ok as boolean) &&
    (clean as any).state.occupants.length === 1 && (clean as any).chain.length === 1);
  const dependent = removeMorphAt(base, [mk(a), { name: "sheet.clearCell", params: { id: "a" }, inverse: { prev: a } }], 0);
  check("dependent removal reports conflict", !dependent.ok, dependent.ok ? "replayed despite dangling remove" : "");
  if (!dependent.ok) {
    check("conflict names the dependent step",
      dependent.errors.some(e => e.includes("morphs[1]") || e.includes("not present")),
      dependent.errors.join("; "));
  }
  check("bad removal index rejected", !removeMorphAt(base, [mk(a)], 5).ok);
}

// 14. Replacing an earlier morph replays dependents too.
{
  const base = { occupants: [], width: 5, height: 4 };
  const a = { id: "a", anchor: { q: 0, r: 0 }, span: [], type: "cell", data: { value: 1 }, tags: [] };
  const a2 = { id: "a", anchor: { q: 0, r: 0 }, span: [], type: "cell", data: { value: 9 }, tags: [] };
  const mk = (occ: any) => ({ name: "sheet.setCell", params: { occ }, inverse: { prev: null } });
  const swapped = replaceMorphAt(base, [mk(a)], 0, mk(a2));
  check("replacement replays", swapped.ok && (swapped as any).state.occupants.length === 1 &&
    ((swapped as any).state.occupants[0].data as any).value === 9);
  const far = { id: "a", anchor: { q: 40, r: 40 }, span: [], type: "cell", data: {}, tags: [] };
  const badSwap = replaceMorphAt(base, [mk(a)], 0, mk(far));
  check("out-of-bounds replacement breaks dependents", !badSwap.ok, badSwap.ok ? "replayed" : "");
  check("unknown replacement rejected",
    !replaceMorphAt(base, [mk(a)], 0, { name: "nope.ghost", params: {} }).ok);
}

// 15. chainForSave publishes full chains and checkpoints partial ones.
{
  const data = JSON.parse(readFileSync(files[0].path, "utf8"));
  const first = loadPlan({ data, errors: [] }, null);
  if (!first.ok) {
    check("chainForSave setup loads", false, first.errors.join("; "));
  } else {
    const full = chainForSave(first.plan.base, first.plan.morphs, first.plan.occupants ?? [],
      first.plan.width, first.plan.height);
    check("complete chain saves whole", !full.checkpointed && full.morphs.length === 11);
    // Simulate a truncated history: drop the first step but keep the cache.
    const partial = chainForSave(first.plan.base, first.plan.morphs.slice(1), first.plan.occupants ?? [],
      first.plan.width, first.plan.height);
    check("partial chain checkpoints", partial.checkpointed && partial.morphs.length === 0);
    check("checkpoint base is current state", partial.base.occupants.length === 11);
    const reload = loadPlan({
      data: { ...data, base: partial.base, morphs: partial.morphs, occupants: partial.base.occupants },
      errors: [],
    }, null);
    check("checkpoint file loads", reload.ok, reload.ok ? "" : reload.errors.join("; "));
  }
}

// 16. Load rejects out-of-bounds and colliding chains, not just bad params.
{
  const base = { occupants: [], width: 5, height: 4 };
  const seed = JSON.parse(readFileSync(files[0].path, "utf8"));
  const far = { id: "far", anchor: { q: 99, r: 0 }, span: [], type: "cell", data: {}, tags: [] };
  const r1 = loadPlan({
    data: { ...seed, base, morphs: [{ name: "sheet.setCell", params: { occ: far }, inverse: { prev: null } }], occupants: [far] },
    errors: [],
  }, null);
  check("out-of-bounds chain rejected", !r1.ok, r1.ok ? "loaded a cell at (99,0)" : "");
  const a = { id: "a", anchor: { q: 0, r: 0 }, span: [], type: "cell", data: {}, tags: [] };
  const b = { id: "b", anchor: { q: 0, r: 0 }, span: [], type: "cell", data: {}, tags: [] };
  const mk = (occ: any) => ({ name: "sheet.setCell", params: { occ }, inverse: { prev: null } });
  const r2 = loadPlan({
    data: { ...seed, base, morphs: [mk(a), mk(b)], occupants: [a, b] },
    errors: [],
  }, null);
  check("colliding chain rejected", !r2.ok, r2.ok ? "loaded two occupants in one cell" : "");
  // An empty chain over an explicit base is still verified against the cache.
  const r3 = loadPlan({
    data: { ...seed, base, morphs: [], occupants: [a] },
    errors: [],
  }, null);
  check("empty chain bypass rejected", !r3.ok, r3.ok ? "base/cache mismatch accepted" : "");
}

// 17. The versioned contract is enforced and malformed bases never throw.
{
  const seed = JSON.parse(readFileSync(files[0].path, "utf8"));
  const r1 = loadPlan({ data: { ...seed, $schema: "paramorphic-plan/999" }, errors: [] }, null);
  check("unknown schema version rejected", !r1.ok, r1.ok ? "future version loaded" : "");
  let threw = false;
  let r2: any = null;
  try {
    r2 = loadPlan({ data: { ...seed, base: { occupants: 42, width: "wide", height: null } }, errors: [] }, null);
  } catch {
    threw = true;
  }
  check("malformed base returns errors, never throws", !threw && r2 && !r2.ok, threw ? "threw" : "loaded");
}

// 18. A content-free inverse frame falls back instead of deleting.
{
  const dims = { width: 5, height: 4 };
  const prev = { id: "c", anchor: { q: 1, r: 1 }, span: [], type: "cell", data: { value: 1 }, tags: [] };
  const next = { id: "c", anchor: { q: 1, r: 1 }, span: [], type: "cell", data: { value: 2 }, tags: [] };
  const inverted = invertMorph({ occupants: [next], ...dims },
    { name: "sheet.setCell", params: { occ: next }, inverse: {} });
  check("empty frame inverts to fallback", inverted === null);
  const u = undoHistory(
    [{ snapshot: [prev], morph: { name: "sheet.setCell", params: { occ: next }, inverse: {} } }],
    [], [next], dims);
  check("empty frame undoes to snapshot", u.undone && JSON.stringify(u.occupants) === JSON.stringify([prev]),
    JSON.stringify(u.occupants));
}

// 19. Chain surgery refreshes later frames: no ghost restores on undo.
{
  const base = { occupants: [], width: 5, height: 4 };
  const v1 = { id: "a", anchor: { q: 0, r: 0 }, span: [], type: "cell", data: { value: 1 }, tags: [] };
  const v2 = { id: "a", anchor: { q: 0, r: 0 }, span: [], type: "cell", data: { value: 2 }, tags: [] };
  const chain = [
    { name: "sheet.setCell", params: { occ: v1 }, inverse: { prev: null } },
    { name: "sheet.setCell", params: { occ: v2 }, inverse: { prev: v1 } },
  ];
  const edited = removeMorphAt(base, chain, 0);
  check("surgery replays", edited.ok, edited.ok ? "" : edited.errors.join("; "));
  if (edited.ok) {
    const frame = (edited.chain[0] as any).inverse;
    check("surgery recaptures the later frame", frame && frame.prev === null, JSON.stringify(frame));
    const undone = invertMorph(edited.state, edited.chain[0]);
    check("undo after surgery removes, not resurrects",
      undone !== null && undone.occupants.length === 0, JSON.stringify(undone?.occupants));
  }
}

// 20. Complete save/reload round trip preserves the opened file's settings.
{
  const seed = JSON.parse(readFileSync(files[0].path, "utf8"));
  const opened = loadPlan({ data: seed, errors: [] }, null);
  if (!opened.ok) {
    check("round-trip setup loads", false, opened.errors.join("; "));
  } else {
    const settings = {
      tilingId: "square8",
      presetId: "custom-fork",
      ruleSet: { ...seed.ruleSet, id: "custom-fork" },
      regions: seed.regions,
      interpretation: { view: "sheet", note: "opened elsewhere" },
    };
    const size = { w: opened.plan.width, h: opened.plan.height };
    const extra = { id: "c-3-3", anchor: { q: 3, r: 3 }, span: [], type: "cell", data: { value: 3 }, tags: [] };
    const occupants = [...(opened.plan.occupants ?? []), extra];
    const past = pushHistory([], opened.plan.occupants ?? [],
      { name: "sheet.setCell", params: { occ: extra }, inverse: { prev: null } });
    const { plan, checkpointed } = buildSheetSave({
      settings, size, occupants, base: opened.plan.base, adopted: opened.plan.morphs, past,
    });
    check("clean save needs no checkpoint", !checkpointed);
    const savedText = JSON.stringify(plan);
    const reloaded = loadPlan({ data: JSON.parse(savedText), errors: [] }, null);
    check("saved file reloads", reloaded.ok, reloaded.ok ? "" : reloaded.errors.join("; "));
    if (reloaded.ok) {
      check("settings survive the round trip",
        reloaded.plan.presetId === "custom-fork" &&
        (reloaded.plan.interpretation as any)?.note === "opened elsewhere" &&
        reloaded.plan.ruleSet.id === "custom-fork",
        reloaded.plan.presetId);
      check("edits survive the round trip",
        (reloaded.plan.occupants ?? []).some(o => o.id === "c-3-3"));
      // And undoing the reloaded chain restores the pre-edit board.
      const last = reloaded.plan.morphs[reloaded.plan.morphs.length - 1];
      const undone = invertMorph(
        { occupants: reloaded.plan.occupants ?? [], width: reloaded.plan.width, height: reloaded.plan.height },
        last);
      check("reloaded chain undoes cleanly",
        undone !== null && !undone.occupants.some(o => o.id === "c-3-3"));
    }
  }
}

// 21. Truncation and branching round-trip through real save files.
{
  // Own 8x8 board with distinct cells, so nothing collides by construction.
  const settings = {
    tilingId: "square8",
    presetId: "trunc",
    ruleSet: {
      id: "trunc",
      setup: { width: 8, height: 8, description: "truncation board" },
      moves: [],
      turns: { type: "free", order: [], first: "s" },
      outcomes: [],
      end: { condition: "none", action: "none" },
    },
    regions: [],
    interpretation: null,
  };
  const size = { w: 8, h: 8 };
  const dims = { width: 8, height: 8 };
  const base = { occupants: [], width: 8, height: 8 };
  // 55 single-cell writes against the 50-cap: the first 5 steps fall off,
  // so no saved chain can reconstruct the board from the base.
  let past: ReturnType<typeof pushHistory> = [];
  let cur: any[] = [];
  for (let i = 0; i < 55; i++) {
    const cell = {
      id: `t-${i}`,
      anchor: { q: i % 8, r: Math.floor(i / 8) },
      span: [], type: "cell", data: { value: i }, tags: [],
    };
    const before = cur;
    past = pushHistory(past, before,
      { name: "sheet.setCell", params: { occ: cell }, inverse: { prev: null } });
    cur = [...cur, cell];
  }
  const { plan, checkpointed } = buildSheetSave({
    settings, size, occupants: cur, base, adopted: [], past,
  });
  check("truncated save checkpoints", checkpointed);
  const reloaded = loadPlan({ data: JSON.parse(JSON.stringify(plan)), errors: [] }, null);
  check("truncated save reloads whole", reloaded.ok &&
    JSON.stringify((reloaded.plan.occupants ?? []).map(o => o.id).sort()) ===
    JSON.stringify(cur.map(o => o.id).sort()),
    reloaded.ok ? "" : reloaded.errors.join("; "));
  // Branching: undo the last write, store a different value in its cell,
  // save through the same helper, reload.
  const u = undoHistory(past, [], cur, dims);
  check("branch undo drops t-54", u.undone && !u.occupants.some(o => o.id === "t-54"));
  const branchedCell = {
    id: "t-54", anchor: { q: 54 % 8, r: Math.floor(54 / 8) },
    span: [], type: "cell", data: { value: "branch" }, tags: [],
  };
  const branchedOcc = [...u.occupants, branchedCell];
  const branchedPast = pushHistory(u.past, u.occupants,
    { name: "sheet.setCell", params: { occ: branchedCell }, inverse: { prev: null } });
  const bSaved = buildSheetSave({
    settings, size, occupants: branchedOcc, base, adopted: [], past: branchedPast,
  });
  const bReloaded = loadPlan({ data: JSON.parse(JSON.stringify(bSaved.plan)), errors: [] }, null);
  check("branched save reloads", bReloaded.ok, bReloaded.ok ? "" : bReloaded.errors.join("; "));
  if (bReloaded.ok) {
    const found = (bReloaded.plan.occupants ?? []).find(o => o.id === "t-54");
    check("branch value survives", (found?.data as any)?.value === "branch", JSON.stringify(found?.data));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
