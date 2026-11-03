import type { MoveRule, Occupant, Pos, Region, RuleSet, TilingDef, Toggles } from "./types";
import { TILINGS, getTiling } from "./tilings";
import { replayMorphs, validateChain, type AppliedMorph, type PlanState } from "./morphs/registry";

// ---------- Plan parsing & validation ----------
export function parsePlan(text: string): { data: any; errors: string[]; format: "json" | "yaml" | "xml" } {
  const errors: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) return { data: null, errors: ["Empty plan"], format: "json" };
  // try JSON
  try {
    const j = JSON.parse(trimmed);
    return { data: j, errors: [], format: "json" };
  } catch {}
  // try XML
  if (trimmed.startsWith("<")) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(trimmed, "text/xml");
      const root = doc.documentElement;
      if (root.nodeName === "parsererror" || doc.querySelector("parsererror")) {
        errors.push("XML parse error");
        return { data: null, errors, format: "xml" };
      }
      // simple XML to object: expect <OcelotPlan ...> with attributes
      const getAttr = (n: string) => root.getAttribute(n);
      const data: any = {
        component: getAttr("component") || "Grid",
        tilingId: getAttr("tiling") || root.getAttribute("tilingId") || "square8",
        presetId: getAttr("preset") || "custom",
        ruleSet: { id: getAttr("preset") || "custom", setup: { width: 6, height: 6, description: "from XML" }, moves: [], turns: { type: "alternating", order: ["white", "black"], first: "white" }, outcomes: [], end: { condition: "anyOutcome", action: "stop" }, regions: [] },
        occupants: [],
        width: parseInt(root.getAttribute("width") || "6"),
        height: parseInt(root.getAttribute("height") || "6"),
      };
      // parse RuleSet children
      const rsNode = doc.querySelector("RuleSet");
      if (rsNode) {
        const moves: MoveRule[] = [];
        rsNode.querySelectorAll("Move").forEach(mn => {
          const piece = mn.getAttribute("piece") || "*";
          const dirs = (mn.getAttribute("dirs") || "").split(",").map(s => s.trim()).filter(Boolean);
          const slide = mn.getAttribute("slide") === "true";
          moves.push({ pieceType: piece, moves: dirs.map(d => slide ? { type: "slide" as const, dir: d } : { type: "step" as const, dir: d }), capture: "both" as any });
        });
        data.ruleSet.moves = moves;
      }
      return { data, errors, format: "xml" };
    } catch (e: any) {
      errors.push(`XML error: ${e.message}`);
      return { data: null, errors, format: "xml" };
    }
  }
  // try simple YAML (very limited)
  try {
    const lines = trimmed.split("\n");
    const obj: any = {};
    const stack: { indent: number; obj: any }[] = [{ indent: -1, obj }];
    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const indent = line.search(/\S/);
      const content = line.trim();
      if (content.includes(":")) {
        const [k, ...rest] = content.split(":");
        const v = rest.join(":").trim();
        while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
        const parent = stack[stack.length - 1].obj;
        if (!v) {
          const newObj: any = {};
          parent[k.trim()] = newObj;
          stack.push({ indent, obj: newObj });
        } else {
          // try parse value
          let parsed: any = v;
          if (v === "true") parsed = true;
          else if (v === "false") parsed = false;
          else if (!isNaN(Number(v))) parsed = Number(v);
          else if ((v.startsWith("[") && v.endsWith("]")) || (v.startsWith("{") && v.endsWith("}"))) {
            try { parsed = JSON.parse(v); } catch {}
          } else {
            parsed = v.replace(/^["']|["']$/g, "");
          }
          parent[k.trim()] = parsed;
        }
      }
    }
    // if parsed looks like plan, return
    if (obj.component || obj.tiling || obj.preset || obj.ruleSet) {
      // normalize
      const data: any = {
        component: obj.component || "Grid",
        tilingId: obj.tiling?.id || obj.tilingId || "square8",
        presetId: obj.preset || obj.presetId || "custom",
        ruleSet: obj.ruleSet || { id: "custom", setup: { width: 6, height: 6, description: "yaml" }, moves: [], turns: { type: "alternating", order: ["white", "black"], first: "white" }, outcomes: [], end: { condition: "anyOutcome", action: "stop" }, regions: [] },
        occupants: obj.occupants || [],
        width: obj.width || obj.ruleSet?.setup?.width || 6,
        height: obj.height || obj.ruleSet?.setup?.height || 6,
      };
      return { data, errors, format: "yaml" };
    }
    errors.push("YAML parse: not recognized as plan");
    return { data: null, errors, format: "yaml" };
  } catch (e: any) {
    errors.push(`YAML error: ${e.message}`);
    return { data: null, errors, format: "yaml" };
  }
}

export function validatePlan(data: any, tiling: TilingDef | null): string[] {
  const errors: string[] = [];
  if (!data) { errors.push("No data"); return errors; }
  if (!data.component) errors.push("Missing component");
  if (!data.tilingId) errors.push("Missing tilingId");
  else {
    if (!(data.tilingId in TILINGS)) errors.push(`Unknown tiling ${data.tilingId}, available: ${Object.keys(TILINGS).join(",")}`);
  }
  const tilingToCheck = data.tilingId ? getTiling(data.tilingId) : tiling;
  if (!tilingToCheck) errors.push("Tiling not found");
  if (!data.ruleSet) errors.push("Missing ruleSet");
  else {
    if (!data.ruleSet.id) errors.push("ruleSet.id missing");
    if (!Array.isArray(data.ruleSet.moves)) errors.push("ruleSet.moves must be array");
    else {
      data.ruleSet.moves.forEach((mr: MoveRule, idx: number) => {
        if (!mr.pieceType) errors.push(`moves[${idx}] missing pieceType`);
        if (!Array.isArray(mr.moves)) errors.push(`moves[${idx}].moves must be array`);
        else mr.moves.forEach((mk: any, j: number) => {
          if (mk.type === "step" || mk.type === "slide") {
            if (!mk.dir) errors.push(`moves[${idx}].moves[${j}] missing dir`);
            else if (tilingToCheck && !tilingToCheck.directionMap[mk.dir]) {
              errors.push(`direction ${mk.dir} not defined in tiling ${tilingToCheck.id}, available: ${tilingToCheck.directions.map(d => d.name).join(",")}`);
            }
          } else if (mk.type === "pawn") {
            const forwards = Array.isArray(mk.forward) ? mk.forward : [mk.forward];
            forwards.forEach((f: string) => {
              if (tilingToCheck && !tilingToCheck.directionMap[f]) errors.push(`pawn forward direction ${f} not defined in tiling ${tilingToCheck.id}`);
            });
            (mk.captureDirs || []).forEach((cd: string) => {
              if (tilingToCheck && !tilingToCheck.directionMap[cd]) errors.push(`pawn capture dir ${cd} not defined in tiling ${tilingToCheck.id}`);
            });
          } else if (mk.type === "leap") {
            if (!Array.isArray(mk.offsets)) errors.push(`moves[${idx}].moves[${j}] leap missing offsets array`);
            else mk.offsets.forEach((off: any, k: number) => {
              if (typeof off?.dq !== "number" || typeof off?.dr !== "number") errors.push(`moves[${idx}].moves[${j}].offsets[${k}] needs numeric dq/dr`);
            });
          } else if (mk.type === "leapRef") {
            if (mk.ref !== "knight") errors.push(`moves[${idx}].moves[${j}] unknown leap ref "${mk.ref}" (available: knight)`);
            else if (tilingToCheck && tilingToCheck.leaps.offsets.length === 0) errors.push(`tiling ${tilingToCheck.id} defines no leap offsets for ref "knight"`);
          } else if (mk.type === "place") {
            // no direction to check
          } else {
            errors.push(`moves[${idx}].moves[${j}] unknown move type "${mk.type}" (available: step, slide, leap, leapRef, pawn, place)`);
          }
        });
      });
    }
    if (!data.ruleSet.turns) errors.push("ruleSet.turns missing");
    else {
      const t = data.ruleSet.turns.type;
      if (t !== "alternating" && t !== "free" && t !== "samePlayerIfCapture") errors.push(`ruleSet.turns.type "${t}" unknown (available: alternating, free, samePlayerIfCapture)`);
    }
    if (!Array.isArray(data.ruleSet.outcomes)) errors.push("ruleSet.outcomes must be array");
    else {
      const known = ["line", "captureAll", "noMoves", "kingCaptured", "reachRow", "boardFull", "fillRegions", "topReached"];
      const regionIds = new Set([...(data.regions || []).map((r: any) => r.id), ...((data.ruleSet.regions || []).map((r: any) => r.id))]);
      data.ruleSet.outcomes.forEach((o: any, i: number) => {
        if (!known.includes(o.kind)) errors.push(`outcomes[${i}] unknown kind "${o.kind}" (available: ${known.join(", ")})`);
        if ((o.kind === "reachRow") && !o.regionId) errors.push(`outcomes[${i}] reachRow missing regionId`);
        else if (o.kind === "reachRow" && !regionIds.has(o.regionId)) errors.push(`outcomes[${i}] region "${o.regionId}" not found in regions`);
        if (o.kind === "line" && o.regions && o.regions !== "all" && Array.isArray(o.regions)) {
          o.regions.forEach((rid: string) => { if (!regionIds.has(rid)) errors.push(`outcomes[${i}] region "${rid}" not found in regions`); });
        }
      });
    }
    // span collision check at setup
    if (Array.isArray(data.occupants)) {
      const occMap = new Map<string, string>();
      data.occupants.forEach((occ: Occupant, i: number) => {
        if (!occ.anchor) errors.push(`occupants[${i}] missing anchor`);
        const cells = [occ.anchor, ...(occ.span || []).map((s: Pos) => ({ q: occ.anchor.q + s.q, r: occ.anchor.r + s.r }))];
        cells.forEach(c => {
          const key = `${c.q},${c.r}`;
          if (occMap.has(key)) errors.push(`Span collision at setup: occupants ${occMap.get(key)} and ${occ.id || i} both occupy ${key}`);
          else occMap.set(key, occ.id || `${i}`);
        });
      });
    }
  }
  return errors;
}


// ---------- Plan serialization (extracted verbatim from the demo shell) ----------
export type PlanMode = "yaml" | "xml" | "json";
export function serializePlan(args: {
  component: string;
  tiling: TilingDef;
  tilingId: string;
  presetId: string;
  ruleSet: RuleSet;
  occupants: Occupant[];
  width: number;
  height: number;
  regions: Region[];
  toggles: Toggles;
  planMode: PlanMode;
}): string {
  const { component, tiling, tilingId, presetId, ruleSet, occupants, width, height, regions, toggles, planMode } = args;
    const plan = {
      component,
      tilingId,
      presetId,
      width,
      height,
      ruleSet,
      occupants: occupants.slice(0, 30),
      regions,
      turns: ruleSet.turns,
      outcomes: ruleSet.outcomes
    };
    if (planMode === "json") {
      return (JSON.stringify(plan, null, 2));
    } else if (planMode === "xml") {
      const movesXml = ruleSet.moves.map(m => `    <Move piece="${m.pieceType}" dirs="${m.moves.map((mk: any) => mk.dir || mk.type).join(",")}" slide="${m.moves.some(mk => mk.type === "slide")}" />`).join("\n");
      const xml = `<OcelotPlan component="${component}" tiling="${tilingId}" preset="${presetId}" width="${width}" height="${height}">
  <RuleSet id="${ruleSet.id}" outcome="${ruleSet.outcomes.map(o => o.kind).join(",")}" turn="${(ruleSet.turns as any).first || ""}">
${movesXml}
  </RuleSet>
  <Grid width="${width}" height="${height}" gravity="${toggles.gravity}" wrapping="${toggles.wrapping}">
${occupants.slice(0, 10).map(o => `    <Occupant id="${o.id}" anchor="${o.anchor.q},${o.anchor.r}" type="${o.type}" player="${o.data?.player || ""}" span="${o.span.length}" guest="${o.guest?.kind || ""}" />`).join("\n")}
  </Grid>
  <Regions count="${regions.length}">${regions.slice(0, 3).map(r => r.id).join(",")}</Regions>
</OcelotPlan>`;
      return (xml);
    } else {
      const yaml = `component: ${component}
tiling:
  id: ${tilingId}
  shape: ${tiling.shape}
  neighbors: [${tiling.directions.map(d => d.name).join(", ")}]
  style: ${tiling.style}
  cellToPoint: "(q,r) -> point via ${tiling.id.includes("hex") ? "axial" : "cartesian"}"
  pointToCell: "inverse"
  distance: "${tiling.id.includes("hex") ? "axial hexDistance" : tilingId === "square4" ? "manhattan" : "chebyshev"}"
  directions:
${tiling.directions.map(d => `    - name: ${d.name} dq: ${d.dq} dr: ${d.dr} axial: {q:${d.axial.q},r:${d.axial.r}} angle:${d.angle}`).join("\n")}
preset: ${presetId}
ruleSet:
  id: ${ruleSet.id}
  setup: {w:${width}, h:${height}, desc: "${ruleSet.setup.description}"}
  turns: {type:${(ruleSet.turns as any).type}, order:[${(ruleSet.turns as any).order?.join(",") || ""}], first:${(ruleSet.turns as any).first || ""}}
  outcomes:
${ruleSet.outcomes.map(o => `    - kind: ${o.kind} ${Object.entries(o).filter(([k]) => k !== "kind").map(([k, v]) => `${k}:${Array.isArray(v) ? `[${v}]` : v}`).join(" ")}`).join("\n")}
  moves:
${ruleSet.moves.map(m => `    - piece: ${m.pieceType} moves: [${m.moves.map(mk => `${mk.type}${(mk as any).dir ? `:${(mk as any).dir}` : ""}`).join(", ")}] capture:${m.capture} ${m.jumpOver ? "jumpOver:true" : ""} ${m.onMove ? `onMove:${JSON.stringify(m.onMove)}` : ""}`).join("\n")}
  regions: ${regions.length} [${regions.slice(0, 3).map(r => r.id).join(",")}]
  gravity: ${ruleSet.gravity ? JSON.stringify(ruleSet.gravity) : "none"}
occupants: ${occupants.length} [${occupants.slice(0, 3).map(o => `${o.type}@${o.anchor.q},${o.anchor.r}${o.span.length ? ` span${o.span.length}` : ""}${o.guest ? ` guest:${o.guest.kind}` : ""}`).join(", ")}]
toggles: gravity=${toggles.gravity} diagonal=${toggles.diagonal} sliding=${toggles.sliding} wrapping=${toggles.wrapping} chainCapture=${toggles.chainCapture}
engine: getValidMoves generic using tiling.directionMap + leaps, outcomes evaluated via tiling.line()
`;
      return (yaml);
    }
}

// ---------- Stored plans: load + apply ----------
// A plan file (morph-plans/*.json) is validated by validatePlan on load and only
// then applied. Text pasted in the demo goes through parsePlan first; files
// skip parsing because JSON import already produced data.
export type PlanComponent = "Grid" | "Graph" | "Tree" | "Path" | "Protocol" | "Logic" | "Compose";

const KNOWN_COMPONENTS: PlanComponent[] = ["Grid", "Graph", "Tree", "Path", "Protocol", "Logic", "Compose"];

export type PlanBase = {
  occupants: Occupant[];
  width: number;
  height: number;
};

export type LoadedPlan = {
  component?: PlanComponent;
  tilingId?: string;
  interpretation?: any;
  presetId: string;
  ruleSet: RuleSet;
  width: number;
  height: number;
  occupants?: Occupant[];
  regions?: Region[];
  firstTurn: string;
  /**
   * Normalized base the morph chain replays over. For snapshot-only plans
   * (no stored morphs) this is the snapshot itself, so a later save can
   * write base + new edits as a replayable chain.
   */
  base: PlanBase;
  /** Normalized morph sequence; empty means snapshot-only plan. */
  morphs: AppliedMorph[];
};

/** Compare a replayed state against the cached snapshot, order-insensitively. */
function statesEqual(a: PlanState, occupants: Occupant[], width: number, height: number): string | null {
  if (a.width !== width || a.height !== height) {
    return `replayed dimensions ${a.width}x${a.height} do not match cached ${width}x${height}`;
  }
  const key = (o: Occupant) => o.id;
  const ra = [...a.occupants].sort((x, y) => (key(x) < key(y) ? -1 : 1));
  const rb = [...occupants].sort((x, y) => (key(x) < key(y) ? -1 : 1));
  if (ra.length !== rb.length) {
    return `replayed ${ra.length} occupants but cached snapshot has ${rb.length}`;
  }
  for (let i = 0; i < ra.length; i++) {
    if (JSON.stringify(ra[i]) !== JSON.stringify(rb[i])) {
      return `replayed occupant "${key(ra[i])}" differs from cached snapshot`;
    }
  }
  return null;
}

function readBase(data: any, width: number, height: number): { base: PlanBase; errors: string[] } {
  const errors: string[] = [];
  const raw = data?.base;
  if (raw === undefined) {
    // Snapshot-only file: the snapshot is the base for future edits.
    return {
      base: {
        occupants: Array.isArray(data?.occupants) ? data.occupants : [],
        width,
        height,
      },
      errors,
    };
  }
  if (!raw || typeof raw !== "object") {
    errors.push("plan.base must be { occupants, width, height }");
    return { base: { occupants: [], width, height }, errors };
  }
  if (!Array.isArray(raw.occupants)) errors.push("plan.base.occupants must be an array");
  if (typeof raw.width !== "number" || typeof raw.height !== "number") {
    errors.push("plan.base needs numeric width and height");
  }
  (raw.occupants ?? []).forEach((o: Occupant, i: number) => {
    if (!o || typeof o.id !== "string" || !o.id) errors.push(`plan.base.occupants[${i}] missing id`);
    if (!o?.anchor || typeof o.anchor.q !== "number" || typeof o.anchor.r !== "number") {
      errors.push(`plan.base.occupants[${i}] needs a numeric anchor {q,r}`);
    }
  });
  return {
    base: {
      occupants: Array.isArray(raw.occupants) ? raw.occupants : [],
      width: typeof raw.width === "number" ? raw.width : width,
      height: typeof raw.height === "number" ? raw.height : height,
    },
    errors,
  };
}

export function loadPlan(
  parsed: { data: any; errors: string[] },
  tiling: TilingDef | null,
  fallback?: { width: number; height: number }
): { ok: true; plan: LoadedPlan } | { ok: false; errors: string[] } {
  if (parsed.errors.length > 0) return { ok: false, errors: parsed.errors };
  const data = parsed.data;
  const errors = validatePlan(data, tiling);
  if (data?.component && !KNOWN_COMPONENTS.includes(data.component)) {
    errors.push(`Unknown component "${data.component}" (available: ${KNOWN_COMPONENTS.join(", ")})`);
  }
  if (data?.morphs !== undefined) {
    if (!Array.isArray(data.morphs)) errors.push("plan.morphs must be an array");
    else for (const e of validateChain(data.morphs, { tilingId: data.tilingId })) errors.push(e);
  }
  if (errors.length > 0) return { ok: false, errors };
  const setup = data.ruleSet?.setup || {};
  const width = setup.width ?? data.width ?? fallback?.width ?? 8;
  const height = setup.height ?? data.height ?? fallback?.height ?? 8;
  const { base, errors: baseErrors } = readBase(data, width, height);
  for (const e of baseErrors) errors.push(e);
  if (errors.length > 0) return { ok: false, errors };
  const morphs: AppliedMorph[] = Array.isArray(data.morphs) ? data.morphs : [];
  let occupants: Occupant[] | undefined = Array.isArray(data.occupants) ? data.occupants : undefined;
  let outWidth = width;
  let outHeight = height;
  if (morphs.length > 0) {
    // The chain constructs the app: replay base + morphs and require the
    // result to match the cached snapshot. A mismatch is a hard error —
    // the plan is never partially applied.
    const replayed = replayMorphs(base, morphs, { tilingId: data.tilingId });
    if (!replayed.ok) return { ok: false, errors: replayed.errors };
    if (!occupants) {
      occupants = replayed.state.occupants;
      outWidth = replayed.state.width;
      outHeight = replayed.state.height;
    } else {
      const mismatch = statesEqual(replayed.state, occupants, width, height);
      if (mismatch) return { ok: false, errors: [`plan replay mismatch: ${mismatch}`] };
      // Use the replayed state as the source of truth.
      occupants = replayed.state.occupants;
      outWidth = replayed.state.width;
      outHeight = replayed.state.height;
    }
  }
  return {
    ok: true,
    plan: {
      component: data.component,
      tilingId: data.tilingId,
      presetId: data.presetId || "custom",
      interpretation: data.interpretation ?? null,
      ruleSet: data.ruleSet,
      width: outWidth,
      height: outHeight,
      occupants,
      regions: Array.isArray(data.regions)
        ? data.regions
        : Array.isArray(data.ruleSet?.regions)
          ? data.ruleSet.regions
          : undefined,
      firstTurn:
        (data.ruleSet?.turns as any)?.first ||
        (data.ruleSet?.turns as any)?.order?.[0] ||
        "white",
      base,
      morphs,
    },
  };
}

export type PlanApplyTarget = {
  setComponent: (c: PlanComponent) => void;
  setTilingId: (t: TilingDef["id"]) => void;
  setInterpretation: (v: any) => void;
  setPresetId: (p: string) => void;
  setRuleSet: (r: RuleSet) => void;
  setWidth: (w: number) => void;
  setHeight: (h: number) => void;
  setOccupants: (o: Occupant[]) => void;
  setRegions: (r: Region[]) => void;
  setCurrentTurn: (t: string) => void;
  setOutcome: (o: null) => void;
  setSelectedId: (id: string | null) => void;
  setValidMoves: (m: any[]) => void;
  setPlanErrors: (e: string[]) => void;
  setChainCaptureActive: (b: boolean) => void;
  markPlanLoad: () => void;
};

export function applyPlan(plan: LoadedPlan, target: PlanApplyTarget): void {
  // Plan is the source of truth: the caller skips the preset effect so a
  // custom plan's rules and occupants are not reset when presetId changes.
  // plan.occupants is already the replayed chain result when the file
  // carries morphs, so every shell constructs the app from the chain.
  target.markPlanLoad();
  if (plan.component) target.setComponent(plan.component);
  if (plan.tilingId) target.setTilingId(plan.tilingId as TilingDef["id"]);
  target.setInterpretation(plan.interpretation ?? null);
  target.setPresetId(plan.presetId);
  target.setRuleSet(plan.ruleSet);
  target.setWidth(plan.width);
  target.setHeight(plan.height);
  if (plan.occupants) target.setOccupants(plan.occupants);
  if (plan.regions) target.setRegions(plan.regions);
  target.setCurrentTurn(plan.firstTurn);
  target.setOutcome(null);
  target.setSelectedId(null);
  target.setValidMoves([]);
  target.setPlanErrors([]);
  target.setChainCaptureActive(false);
}
