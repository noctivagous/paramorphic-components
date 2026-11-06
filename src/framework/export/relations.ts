// ---------- Relation emission (E3) ----------
// Bindings become straight-line code: defs are vendored as plain functions
// (evaluate bodies + their pure helpers extracted from relation-defs.ts),
// and each binding becomes a useMemo in the engine's own evaluation order
// (producer map + evaluateItems, the same ordering evaluateRelations
// uses), with try/catch quarantine and a trace comment naming the binding.
import { evaluateItems, type RelationBinding, type RelationDef } from "../relations";
import {
  getDefEmitter,
  jsLiteral,
  registerDefEmitter,
  toPascalCase,
  type CodeProject,
  type EmitterContext,
} from "./index";
import { camelIdentifier } from "./gui";
import { SourceScanner, findEntryEnd, findMatchingBrace } from "./gui";

// ----- source extraction over relation-defs.ts -----
function declIndex(source: string, name: string): number {
  const re = new RegExp(`(?:^|\\n)(?:export\\s+)?(?:function|const|let|var|type|interface)\\s+${name}\\b`);
  const m = re.exec(source);
  return m ? m.index + (m[0].startsWith("\n") ? 1 : 0) : -1;
}

function findMatchingParen(source: string, open: number): number {
  const sc = new SourceScanner(source, open + 1);
  const root = sc.stack[0] as { paren: number };
  root.paren = 1;
  while (sc.i < source.length) {
    sc.step();
    const d = sc.topDepths();
    if (d && sc.stack.length === 1 && d.paren === 0) return sc.i - 1;
  }
  return -1;
}

/** Extract one top-level declaration (function / const / type) verbatim. */
export function extractDeclaration(source: string, name: string): string | null {
  const start = declIndex(source, name);
  if (start < 0) return null;
  const isFunction = /^(?:export\s+)?function\b/.test(source.slice(start, start + 20));
  if (isFunction) {
    const paren = source.indexOf("(", start);
    if (paren < 0) return null;
    const closeParen = findMatchingParen(source, paren);
    if (closeParen < 0) return null;
    const body = source.indexOf("{", closeParen);
    if (body < 0) return null;
    const close = findMatchingBrace(source, body);
    return close < 0 ? null : source.slice(start, close + 1);
  }
  const sc = new SourceScanner(source, start);
  while (sc.i < source.length) {
    if (source[sc.i] === ";" && sc.atRoot()) return source.slice(start, sc.i + 1);
    sc.step();
  }
  return null;
}

/** Extract a def's evaluate expression from its def object literal. */
export function extractDefEvaluate(source: string, defConst: string): string | null {
  const start = declIndex(source, defConst);
  if (start < 0) return null;
  const open = source.indexOf("{", start);
  if (open < 0) return null;
  const close = findMatchingBrace(source, open);
  if (close < 0) return null;
  const evalIdx = source.indexOf("evaluate:", open);
  if (evalIdx < 0 || evalIdx > close) return null;
  let valueStart = evalIdx + "evaluate:".length;
  while (valueStart < close && /\s/.test(source[valueStart])) valueStart++;
  const end = findEntryEnd(source, valueStart, close);
  const expr = source.slice(valueStart, end).trim();
  return expr || null;
}

function annotateEvaluate(expr: string): string {
  // Extracted evaluate arrows carry untyped params ((inputs, ctx) / inputs);
  // the emitted function types them once, here. Every emitted def accepts
  // the same (inputs, ctx) call shape whether or not its body reads ctx.
  if (/^\(inputs, ctx\)\s*=>/.test(expr)) return expr.replace(/^\(inputs, ctx\)/, "(inputs: Record<string, unknown>, ctx: RelationCtx)");
  if (/^inputs\s*=>/.test(expr)) return expr.replace(/^inputs/, "(inputs: Record<string, unknown>, _ctx?: RelationCtx)");
  if (/^\(inputs\)\s*=>/.test(expr)) return expr.replace(/^\(inputs\)/, "(inputs: Record<string, unknown>, _ctx?: RelationCtx)");
  return expr;
}

// ----- def emitters -----
export function defFnName(defId: string): string {
  const parts = defId.split(".");
  return parts.map((p, i) => i === 0 ? camelIdentifier(p) : toPascalCase(p)).join("");
}

type DefPlan = { defConst: string; helpers: string[] };
const DEF_PLANS: Record<string, DefPlan> = {
  "bezier.cubic": { defConst: "bezierCubicDef", helpers: ["asPoint", "cubicPoint", "sampleCubic"] },
  "bezier.pointAt": { defConst: "bezierPointAtDef", helpers: ["asPoint", "cubicPoint"] },
  "supershape.polar": { defConst: "supershapeDef", helpers: ["num", "SupershapeParams", "supershapeRadius", "supershapePoints"] },
  "path.ride": { defConst: "pathRideDef", helpers: ["pointAlongPoints"] },
};

/** Defs with an extraction plan; any other def gets a diagnostic emitter. */
export function defsWithExtraction(): string[] { return Object.keys(DEF_PLANS); }

const emittedHelpers = new WeakMap<object, Set<string>>();

function makeDefEmitter(plan: DefPlan) {
  return (def: RelationDef, ctx: EmitterContext): void => {
    const file = ctx.file("src/relations.ts");
    if (!emittedHelpers.has(ctx)) emittedHelpers.set(ctx, new Set());
    const done = emittedHelpers.get(ctx)!;
    if (!done.has("__header")) {
      done.add("__header");
      file.append(`export class DomainError extends Error {
  constructor(message: string) { super(message); this.name = "DomainError"; }
}

export type RelationPoint = { x: number; y: number };
export type RelationBBox = { minX: number; minY: number; maxX: number; maxY: number };
export type RelationCtx = { sampleCount?: number; params?: Record<string, unknown>; bindingId?: string };`);
    }
    if (done.has(def.id)) return;
    const source = ctx.source?.readText("morphs/relation-defs.ts");
    if (!source) {
      ctx.diag(`relation def "${def.id}" could not be vendored: morphs/relation-defs.ts unavailable from the SourceProvider`);
      file.append(`export const ${defFnName(def.id)} = (): never => { throw new DomainError("relation def ${def.id} was not vendored"); };`);
      done.add(def.id);
      return;
    }
    for (const helper of plan.helpers) {
      if (done.has(`helper:${helper}`)) continue;
      const text = extractDeclaration(source, helper);
      if (!text) { ctx.diag(`relation def "${def.id}": helper "${helper}" could not be extracted from morphs/relation-defs.ts`); continue; }
      done.add(`helper:${helper}`);
      file.append(text);
      ctx.record("vendored", `relation helper ${helper} (extracted from morphs/relation-defs.ts)`);
    }
    const evaluate = extractDefEvaluate(source, plan.defConst);
    if (!evaluate) {
      ctx.diag(`relation def "${def.id}": evaluate body could not be extracted from ${plan.defConst}`);
      file.append(`export const ${defFnName(def.id)} = (): never => { throw new DomainError("relation def ${def.id} was not vendored"); };`);
      done.add(def.id);
      return;
    }
    file.append(`export const ${defFnName(def.id)} = ${annotateEvaluate(evaluate)};`);
    done.add(def.id);
    ctx.record("vendored", `relation def ${def.id} (evaluate extracted from morphs/relation-defs.ts)`);
  };
}

/** Register extraction emitters for the defs E3 supports; every other
    registered def gets an emitter that names itself in diagnostics when
    used (sheet.formula's evaluator vendoring is E5 work). */
export function registerExtractionDefEmitters(defs: RelationDef[]): void {
  for (const def of defs) {
    if (getDefEmitter(def.id)) continue;
    const plan = DEF_PLANS[def.id];
    if (plan) registerDefEmitter(def.id, makeDefEmitter(plan));
    else registerDefEmitter(def.id, (_def, ctx) => ctx.diag(`relation def "${def.id}" is not vendored by this exporter slice (no extraction plan; evaluator vendoring is later work)`));
  }
}

// ----- binding order: the engine's own rule -----
/** Topologically order bindings exactly as evaluateRelations does:
    producer map over output refs, then evaluateItems' Kahn ordering. */
export function orderBindings(bindings: RelationBinding[]): { order: RelationBinding[]; cyclic: string[] } {
  const active = bindings.filter(b => b.live !== false);
  const producer = new Map<string, string>();
  for (const b of active) for (const ref of Object.values(b.out)) producer.set(ref, b.id);
  const byId = new Map(active.map(b => [b.id, b]));
  const items = active.map(b => ({
    id: b.id,
    dependsOn: [...new Set(Object.values(b.in).filter((w): w is string => typeof w === "string").map(w => producer.get(w)).filter((p): p is string => !!p && p !== b.id))],
    compute: () => ({}),
  }));
  const outcome = evaluateItems(items);
  return { order: outcome.order.map(id => byId.get(id)!), cyclic: outcome.cyclic };
}

// ----- plan -> standalone app -----
type OccupantLike = {
  id: string;
  type?: string;
  anchor?: { q: number; r: number };
  data?: Record<string, unknown>;
  guest?: { kind?: string; state?: Record<string, unknown> } & Record<string, unknown>;
  [key: string]: unknown;
};

function refParts(ref: string): { occ: string; kind: "data" | "anchor" | "guestPoints" | "guestState"; field?: string } | null {
  const anchor = /^([^.]+)\.anchor$/.exec(ref);
  if (anchor) return { occ: anchor[1], kind: "anchor" };
  const data = /^([^.]+)\.data\.([^.]+)$/.exec(ref);
  if (data) return { occ: data[1], kind: "data", field: data[2] };
  const guestPoints = /^([^.]+)\.guest\.points$/.exec(ref);
  if (guestPoints) return { occ: guestPoints[1], kind: "guestPoints" };
  const guestState = /^([^.]+)\.guest\.state\.([^.]+)$/.exec(ref);
  if (guestState) return { occ: guestState[1], kind: "guestState", field: guestState[2] };
  return null;
}

export function exportPlanApp(project: CodeProject, _input: unknown, plan: Record<string, unknown>): boolean {
  const bindings = (plan.relations as RelationBinding[] | undefined) ?? [];
  if (!bindings.length) return false;
  const occupants = new Map<string, OccupantLike>(((plan.occupants as OccupantLike[] | undefined) ?? []).map(o => [o.id, o]));
  const defs = new Map((project.deps.relationDefs ?? []).map(d => [d.id, d]));
  const { order, cyclic } = orderBindings(bindings);
  for (const id of cyclic) project.diag(`relation binding "${id}" is part of a dependency cycle and was not emitted`);
  const ordered = order.length ? order : bindings.filter(b => !cyclic.includes(b.id));

  // Entity -> expression, filled in as state, constants, and derived
  // variables are declared.
  const exprOf = new Map<string, string>();
  const producerOf = new Map<string, RelationBinding>();
  for (const b of ordered) for (const ref of Object.values(b.out)) producerOf.set(ref, b);

  const referencedOccupants = new Set<string>();
  for (const b of ordered) for (const ref of Object.values(b.out)) { const p = refParts(ref); if (p) referencedOccupants.add(p.occ); }

  const stateGroups = new Map<string, { varName: string; setter: string; fields: Map<string, unknown> }>();
  const constDecls: string[] = [];
  const sourcePointsVars: string[] = [];

  const sourceExpr = (ref: string): string => {
    if (exprOf.has(ref)) return exprOf.get(ref)!;
    const parts = refParts(ref);
    if (!parts) { project.diag(`entity ref "${ref}" does not match the EntityRef grammar and was not emitted`); return "undefined"; }
    referencedOccupants.add(parts.occ);
    const occ = occupants.get(parts.occ);
    let expr: string;
    if (parts.kind === "anchor") {
      const varName = `${camelIdentifier(parts.occ)}Anchor`;
      constDecls.push(`const ${varName} = ${jsLiteral(occ?.anchor ? { x: occ.anchor.q, y: occ.anchor.r } : { x: 0, y: 0 })};`);
      expr = varName;
    } else if (parts.kind === "guestPoints") {
      const varName = `${camelIdentifier(parts.occ)}Points`;
      const initial = (occ?.guest?.state?.points as unknown) ?? [];
      constDecls.push(`const ${varName}: Array<{ x: number; y: number }> = ${jsLiteral(initial)};`);
      sourcePointsVars.push(varName);
      expr = varName;
    } else {
      const groupKey = `${parts.occ}:${parts.kind}`;
      if (!stateGroups.has(groupKey)) {
        const varName = camelIdentifier(parts.occ) + (parts.kind === "guestState" ? "Guest" : "");
        stateGroups.set(groupKey, { varName, setter: `set${toPascalCase(varName)}`, fields: new Map() });
      }
      const group = stateGroups.get(groupKey)!;
      if (!group.fields.has(parts.field!)) {
        const initial = parts.kind === "data" ? occ?.data?.[parts.field!] : occ?.guest?.state?.[parts.field!];
        group.fields.set(parts.field!, initial);
      }
      expr = `${group.varName}.${parts.field}`;
    }
    exprOf.set(ref, expr);
    return expr;
  };

  // Resolve all source expressions first so state declarations are complete.
  for (const b of ordered) {
    for (const w of Object.values(b.in)) if (typeof w === "string" && !producerOf.has(w)) sourceExpr(w);
  }

  // Vendor the defs and build the useMemo chain.
  const bindingCode: string[] = [];
  const derivedPointsVars: string[] = [];
  const derivedPointVars: string[] = [];
  const derivedOther: Array<{ label: string; expr: string }> = [];
  const sliderSpecs: Array<{ stateVar: string; setter: string; field: string; label: string; min: number; max: number; step: number }> = [];
  const sliderSeen = new Set<string>();
  const anchorVars: string[] = [];

  for (const b of ordered) {
    const def = defs.get(b.def);
    if (!def) { project.diag(`relation binding "${b.id}" uses unknown def "${b.def}" and was not emitted`); continue; }
    const emitter = getDefEmitter(b.def);
    if (!emitter) { project.diag(`relation binding "${b.id}": def "${b.def}" has no registered def emitter`); continue; }
    emitter(def, project);
    const fn = defFnName(b.def);
    project.need("src/App.tsx", "./relations", [fn]);
    const resultVar = camelIdentifier(b.id);
    const inputEntries: string[] = [];
    const depVars = new Set<string>();
    const guards: string[] = [];
    for (const port of def.inputs) {
      const w = b.in[port.name];
      if (w === undefined) { inputEntries.push(`${port.name}: ${port.default !== undefined ? jsLiteral(port.default) : "undefined"}`); continue; }
      if (typeof w !== "string") { inputEntries.push(`${port.name}: ${jsLiteral((w as { const: unknown }).const)}`); continue; }
      const producer = producerOf.get(w);
      if (producer) {
        guards.push(camelIdentifier(producer.id));
        depVars.add(camelIdentifier(producer.id));
        inputEntries.push(`${port.name}: ${exprOf.get(w)}`);
      } else {
        inputEntries.push(`${port.name}: ${exprOf.get(w)}`);
        const parts = refParts(w);
        if (parts?.kind === "data" || parts?.kind === "guestState") {
          const group = stateGroups.get(`${parts.occ}:${parts.kind}`);
          if (group) depVars.add(group.varName);
          if (parts.kind === "data" && port.type === "number") {
            const key = `${group?.varName}.${parts.field}`;
            if (group && !sliderSeen.has(key)) {
              sliderSeen.add(key);
              sliderSpecs.push({ stateVar: group.varName, setter: group.setter, field: parts.field!, label: port.label ?? parts.field!, min: port.min ?? 0, max: port.max ?? 1, step: port.step ?? 0.1 });
            }
          }
        }
        if (parts?.kind === "anchor") anchorVars.push(exprOf.get(w)!);
      }
    }
    const ctxParts = [`bindingId: ${jsLiteral(b.id)}`];
    if (b.sample?.count !== undefined) ctxParts.unshift(`sampleCount: ${b.sample.count}`);
    if (b.params) ctxParts.push(`params: ${jsLiteral(b.params)}`);
    const guardCode = guards.length ? `if (${guards.map(g => `!${g}`).join(" || ")}) return undefined; ` : "";
    bindingCode.push(`  // binding: ${b.id} (${b.def})\n  const ${resultVar} = useMemo(() => { ${guardCode}try { return ${fn}({ ${inputEntries.join(", ")} }, { ${ctxParts.join(", ")} }); } catch { return undefined; } }, [${[...depVars].join(", ")}]);`);
    for (const port of def.outputs) {
      const ref = b.out[port.name];
      if (!ref) continue;
      const varName = `${resultVar}${toPascalCase(port.name)}`;
      const fallback = port.type === "points" ? " ?? []" : "";
      bindingCode.push(`  const ${varName} = ${resultVar}?.${port.name}${fallback};`);
      exprOf.set(ref, varName);
      if (port.type === "points") derivedPointsVars.push(varName);
      else if (port.type === "point") derivedPointVars.push(varName);
      else derivedOther.push({ label: `${b.id}.${port.name}`, expr: varName });
    }
    project.record("emitted", `binding ${b.id} (${b.def}) as a useMemo`);
  }

  for (const occ of occupants.values()) {
    if (!referencedOccupants.has(occ.id)) project.diag(`plan occupant "${occ.id}" (${occ.type ?? "unknown"}) is not referenced by any binding and was not rendered`);
  }
  if (anchorVars.length) project.note("Handle occupants are emitted as fixed anchor constants; dragging handles is host code and is not carried.");
  project.note("Host plumbing that lives outside the plan (file open/save, presets, traversal/rider animation) is not carried by a plan export; the plan's state, bindings, and preview are.");

  // App assembly: state, constants, binding chain, sliders, SVG preview.
  project.need("src/App.tsx", "react", ["useMemo", "useState"]);
  const app = project.file("src/App.tsx");
  const stateDecls = [...stateGroups.values()].map(g => `  const [${g.varName}, ${g.setter}] = useState<Record<string, any>>(${jsLiteral(Object.fromEntries(g.fields))});`).join("\n");
  const previewVar = derivedPointsVars[0] ?? sourcePointsVars[0];
  const extraPaths = derivedPointsVars.slice(1).map(v => `          <polyline points={${v}.map(p => px(p)).join(" ")} fill="none" stroke="#888" strokeWidth="1" />`).join("\n");
  const markers = [...new Set(anchorVars)].map(v => `          <circle cx={${v}.x * view.scale + view.padX} cy={${v}.y * view.scale + view.padY} r="4" fill="#f2c94c" />`).join("\n");
  const riderMarkers = derivedPointVars.map(v => `          {${v} ? <circle cx={${v}.x * view.scale + view.padX} cy={${v}.y * view.scale + view.padY} r="5" fill="#e05d44" /> : null}`).join("\n");
  const sliders = sliderSpecs.map(s => `        <label key="${s.stateVar}.${s.field}">${s.label} <input type="range" min={${s.min}} max={${s.max}} step={${s.step}} value={${s.stateVar}.${s.field} ?? ${s.min}} onChange={e => ${s.setter}(prev => ({ ...prev, ${s.field}: Number(e.target.value) }))} /> <span>{String(${s.stateVar}.${s.field} ?? "")}</span></label>`).join("\n");
  const outputs = derivedOther.map(o => `        <div key="${o.label}">${o.label}: {JSON.stringify(${o.expr})}</div>`).join("\n");

  app.append(`${constDecls.join("\n")}${constDecls.length ? "\n\n" : ""}export default function App() {
${stateDecls}
${bindingCode.join("\n")}
  const previewPoints = ${previewVar ?? "[]"};
  const view = useMemo(() => {
    const pts = [...previewPoints, ${[...new Set(anchorVars)].join(", ")}];
    if (!pts.length) return { scale: 1, padX: 0, padY: 0 };
    const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
    const scale = Math.min(300 / Math.max(1e-9, maxX - minX), 300 / Math.max(1e-9, maxY - minY));
    return { scale, padX: 10 - minX * scale, padY: 10 - minY * scale };
  }, [previewPoints]);
  const px = (p: { x: number; y: number }) => \`\${(p.x * view.scale + view.padX).toFixed(2)},\${(p.y * view.scale + view.padY).toFixed(2)}\`;
  return (
    <main>
      <h1>Exported relation plan</h1>
      <section>
${sliders}
      </section>
      <svg width="320" height="320" viewBox="0 0 320 320">
        {previewPoints.length ? <polyline points={previewPoints.map(p => px(p)).join(" ")} fill="none" stroke="#4a8af4" strokeWidth="1.5" /> : null}
${extraPaths}
${markers}
${riderMarkers}
      </svg>
      <section>
${outputs}
      </section>
    </main>
  );
}`);
  project.record("template", "relation plan app shell (state + sliders + SVG preview)");
  project.record("emitted", `relation plan (${ordered.length} bindings in engine order)`);
  return true;
}
