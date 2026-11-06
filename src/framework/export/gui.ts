// ---------- GUI document emission (E2) ----------
// A GuiDocument becomes ordinary JSX: layout is resolved at export time
// with the app-kit's own resolvers (injected by the host), controls are
// vendored by usage from controls/registry.tsx, and interactive state
// mirrors GuiRenderer exactly — values live in props, onChange(patch)
// merges a patch into the node's value record.
import {
  getControlEmitter,
  jsLiteral,
  registerControlEmitter,
  toPascalCase,
  type CodeProject,
  type ControlDataLike,
  type EmitterContext,
  type GuiDocumentLike,
  type GuiNodeLike,
  type ResolvedRectLike,
} from "./index";

export type ShellPlanLike = {
  schema?: string;
  title?: string;
  layout?: string;
  slots?: string[];
  widths?: number[];
  menus?: Array<Record<string, unknown>>;
  toolbar?: Array<Record<string, unknown>>;
  dialogs?: Array<Record<string, unknown>>;
  actions?: Array<Record<string, unknown>>;
  status?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

// ----- small source scanner (strings, templates, comments, brackets) -----
// A frame stack: code frames carry their own bracket counts, and a template
// ${ } pushes a fresh code frame whose closing brace returns to the
// template. That is the case naive depth counters get wrong.
type ScanFrame =
  | { kind: "code"; brace: number; paren: number; bracket: number; tplReturn: boolean }
  | { kind: "sq" | "dq" | "tpl" | "line" | "block" };

export class SourceScanner {
  readonly stack: ScanFrame[] = [{ kind: "code", brace: 0, paren: 0, bracket: 0, tplReturn: false }];
  constructor(private src: string, public i: number) {}
  private get top(): ScanFrame { return this.stack[this.stack.length - 1]; }

  /** True when the scanner sits at top level of the root code frame. */
  atRoot(): boolean {
    const t = this.top;
    return this.stack.length === 1 && t.kind === "code" && t.brace === 0 && t.paren === 0 && t.bracket === 0;
  }

  /** Bracket depths of the top frame when it is a code frame. */
  topDepths(): { brace: number; paren: number; bracket: number } | null {
    const t = this.top;
    return t.kind === "code" ? { brace: t.brace, paren: t.paren, bracket: t.bracket } : null;
  }

  /** Advance one token. Events: "braceZero" when a root code frame's brace
      count returns to zero, "close" at a parent close (brace already zero),
      "comma" at a root-level comma. Callers interpret braceZero. */
  step(): "braceZero" | "close" | "comma" | null {
    const src = this.src, i = this.i, c = src[i], next = src[i + 1], top = this.top;
    if (top.kind === "line") { if (c === "\n") this.stack.pop(); this.i = i + 1; return null; }
    if (top.kind === "block") { if (c === "*" && next === "/") { this.stack.pop(); this.i = i + 2; } else this.i = i + 1; return null; }
    if (top.kind === "sq" || top.kind === "dq") {
      if (c === "\\") { this.i = i + 2; return null; }
      if ((top.kind === "sq" && c === "'") || (top.kind === "dq" && c === '"')) this.stack.pop();
      this.i = i + 1; return null;
    }
    if (top.kind === "tpl") {
      if (c === "\\") { this.i = i + 2; return null; }
      if (c === "`") { this.stack.pop(); this.i = i + 1; return null; }
      if (c === "$" && next === "{") { this.stack.push({ kind: "code", brace: 0, paren: 0, bracket: 0, tplReturn: true }); this.i = i + 2; return null; }
      this.i = i + 1; return null;
    }
    if (top.kind !== "code") { this.i = i + 1; return null; }
    // code frame
    if (c === "/" && next === "/") { this.stack.push({ kind: "line" }); this.i = i + 2; return null; }
    if (c === "/" && next === "*") { this.stack.push({ kind: "block" }); this.i = i + 2; return null; }
    if (c === "'") { this.stack.push({ kind: "sq" }); this.i = i + 1; return null; }
    if (c === '"') { this.stack.push({ kind: "dq" }); this.i = i + 1; return null; }
    if (c === "`") { this.stack.push({ kind: "tpl" }); this.i = i + 1; return null; }
    if (c === "{") { top.brace++; this.i = i + 1; return null; }
    if (c === "}") {
      if (top.brace > 0) {
        top.brace--; this.i = i + 1;
        return top.brace === 0 && this.stack.length === 1 ? "braceZero" : null;
      }
      if (top.tplReturn) { this.stack.pop(); this.i = i + 1; return null; }
      return "close";
    }
    if (c === "(") { top.paren++; this.i = i + 1; return null; }
    if (c === ")") { if (top.paren > 0) top.paren--; this.i = i + 1; return null; }
    if (c === "[") { top.bracket++; this.i = i + 1; return null; }
    if (c === "]") { if (top.bracket > 0) top.bracket--; this.i = i + 1; return null; }
    if (c === "," && this.stack.length === 1 && top.brace === 0 && top.paren === 0 && top.bracket === 0) return "comma";
    this.i = i + 1; return null;
  }
}

/** Index of the `}` matching the `{` at open, or -1. */
export function findMatchingBrace(src: string, open: number): number {
  const sc = new SourceScanner(src, open + 1);
  (sc.stack[0] as { brace: number }).brace = 1;
  while (sc.i < src.length) {
    if (sc.step() === "braceZero") return sc.i - 1;
  }
  return -1;
}

/** Index just past an object-entry value starting at `start`. A value that
    is itself a block (object literal or block-bodied arrow) ends at its
    closing brace; any other value ends at the top-level comma or the
    parent object's close — JSX expression braces inside it are balanced
    and must not end it early. */
export function findEntryEnd(src: string, start: number, limit: number): number {
  const head = src.slice(start, Math.min(limit, start + 400));
  if (/^\{/.test(head)) {
    const close = findMatchingBrace(src, start);
    return close < 0 ? limit : close + 1;
  }
  const arrow = head.match(/^(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/);
  if (arrow) {
    const bodyOpen = start + arrow[0].length - 1;
    const close = findMatchingBrace(src, bodyOpen);
    return close < 0 ? limit : close + 1;
  }
  const sc = new SourceScanner(src, start);
  while (sc.i < limit) {
    const ev = sc.step();
    if (ev === "comma" || ev === "close") return sc.i;
  }
  return limit;
}

function skipTrivia(src: string, i: number): number {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src.startsWith("//", i)) { const nl = src.indexOf("\n", i); i = nl < 0 ? src.length : nl + 1; continue; }
    if (src.startsWith("/*", i)) { const end = src.indexOf("*/", i); i = end < 0 ? src.length : end + 2; continue; }
    return i;
  }
}

export type ExtractedComponents = { entries: Map<string, string>; preHelpers: string; postHelpers: string };

/** Pull the COMPONENTS entries plus the shared helper declarations out of
    controls/registry.tsx. Helpers live both before and after the map. */
export function extractComponents(source: string): ExtractedComponents | null {
  const compIdx = source.indexOf("const COMPONENTS");
  if (compIdx < 0) return null;
  const eq = source.indexOf("=", compIdx);
  const open = source.indexOf("{", eq);
  if (open < 0) return null;
  const close = findMatchingBrace(source, open);
  if (close < 0) return null;
  const preStart = source.indexOf("const s =");
  if (preStart < 0) return null;
  const preHelpers = source.slice(preStart, compIdx).trim();
  const semi = source.indexOf(";", close);
  const postEnd = source.indexOf("/** The full registry");
  if (semi < 0 || postEnd < 0) return null;
  const postHelpers = source.slice(semi + 1, postEnd).trim();

  const entries = new Map<string, string>();
  let i = open + 1;
  while (i < close) {
    i = skipTrivia(source, i);
    if (source[i] === ",") { i++; continue; }
    if (i >= close) break;
    const quote = source[i];
    if (quote !== '"' && quote !== "'") return null;
    let j = i + 1;
    while (j < source.length && source[j] !== quote) { if (source[j] === "\\") j++; j++; }
    if (j >= source.length) return null;
    let key: string;
    try { key = JSON.parse(source.slice(i, j + 1)); } catch { return null; }
    i = skipTrivia(source, j + 1);
    if (source[i] !== ":") return null;
    i = skipTrivia(source, i + 1);
    const end = findEntryEnd(source, i, close);
    const expr = source.slice(i, end).trim();
    if (!expr) return null;
    entries.set(key, expr);
    i = end;
  }
  return { entries, preHelpers, postHelpers };
}

// ----- names -----
export function camelIdentifier(id: string): string {
  const parts = id.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length) return "node";
  const out = parts.map((p, idx) => idx === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1)).join("");
  return /^[0-9]/.test(out) ? `node${out}` : out;
}
export function stateNameFor(node: GuiNodeLike): string { return camelIdentifier(node.id); }
export function setterNameFor(node: GuiNodeLike): string { return `set${toPascalCase(stateNameFor(node))}`; }
export function componentNameFor(type: string): string { return toPascalCase(type); }

function isStateful(node: GuiNodeLike, getData?: (t: string) => ControlDataLike | undefined): boolean {
  const data = getData?.(node.type);
  return !!data && data.propSchema.length > 0;
}

// ----- the generic extraction-based control emitter -----
type ActiveGui = { stateful: Set<string>; extracted: Set<string> };
let activeGui: ActiveGui | null = null;

function genericControlEmitter(node: GuiNodeLike, ctx: EmitterContext): string {
  if (!activeGui?.extracted.has(node.type)) {
    ctx.diag(`control "${node.type}" (node "${node.id}") could not be extracted from controls/registry.tsx`);
    return `{/* unsupported control: ${node.type} */}`;
  }
  const name = componentNameFor(node.type);
  ctx.need("src/App.tsx", "./controls", [name]);
  const propsExpr = activeGui.stateful.has(node.id)
    ? `{ ...${jsLiteral(node.props)}, ...${stateNameFor(node)} }`
    : jsLiteral(node.props);
  const onChange = activeGui.stateful.has(node.id)
    ? ` onChange={patch => ${setterNameFor(node)}(prev => ({ ...prev, ...patch }))}`
    : "";
  return `<${name} props={${propsExpr}}${onChange} interactive />`;
}

/** Register the extraction emitter for every registry control type. */
export function registerExtractionControlEmitters(types: string[]): void {
  for (const type of types) if (!getControlEmitter(type)) registerControlEmitter(type, genericControlEmitter);
}

// ----- vendoring -----
function vendorControls(project: CodeProject, usedTypes: string[]): Set<string> {
  const extracted = new Set<string>();
  const source = project.source?.readText("controls/registry.tsx");
  if (!source) {
    for (const t of usedTypes) project.diag(`control "${t}" could not be vendored: controls/registry.tsx unavailable from the SourceProvider`);
    return extracted;
  }
  const parsed = extractComponents(source);
  if (!parsed) {
    for (const t of usedTypes) project.diag(`control "${t}" could not be extracted from controls/registry.tsx`);
    return extracted;
  }
  const typesSource = project.source?.readText("controls/types.ts");
  if (typesSource) {
    project.file("src/controls/types.ts").append(typesSource);
    project.record("vendored", "control types (src/controls/types.ts, whole file from controls/types.ts)");
  } else project.diag("controls/types.ts unavailable from the SourceProvider; src/controls/types.ts not emitted");

  const css = project.source?.readText("controls/controls.css");
  if (css) {
    project.file("src/controls.css").append(css);
    project.record("vendored", "controls.css (verbatim)");
  } else project.diag("controls/controls.css unavailable from the SourceProvider; styles not emitted");

  const pairs: Array<[string, string]> = [];
  const chunks: string[] = [
    `import React, { useCallback, useRef } from "react";\nimport type { ControlComponent, ControlProps } from "./controls/types";`,
    parsed.preHelpers,
  ];
  for (const type of usedTypes) {
    const expr = parsed.entries.get(type);
    if (!expr) { project.diag(`control "${type}" could not be extracted from controls/registry.tsx`); continue; }
    extracted.add(type);
    pairs.push([type, componentNameFor(type)]);
    chunks.push(`export const ${componentNameFor(type)}: ControlComponent = ${expr};`);
    project.record("vendored", `control ${type} (extracted from controls/registry.tsx)`);
  }
  chunks.push(parsed.postHelpers);
  chunks.push(`export const CONTROL_COMPONENTS: Record<string, ControlComponent> = { ${pairs.map(([t, n]) => `${JSON.stringify(t)}: ${n}`).join(", ")} };`);
  project.file("src/controls.tsx").append(chunks.join("\n\n"));
  return extracted;
}

// ----- shell (simplified chrome from a recipe) -----
export function emitShell(project: CodeProject, shell: ShellPlanLike): void {
  const file = project.file("src/Shell.tsx");
  file.append(`import type { ReactNode } from "react";

export type ShellPlanData = ${"{"} title: string; menus: Array<{ id: string; label: string; items: Array<{ id: string; label: string }> }>; toolbar: Array<{ id: string; label: string }>; status: Array<{ id: string; label: string; value: string }>; ${"}"};

export const SHELL_PLAN: ShellPlanData = ${jsLiteral({
    title: shell.title ?? "App",
    menus: (shell.menus ?? []).map(m => ({ id: String(m.id ?? ""), label: String(m.label ?? ""), items: ((m.items as Array<Record<string, unknown>> | undefined) ?? []).map(it => ({ id: String(it.id ?? ""), label: String(it.label ?? "") })) })),
    toolbar: (shell.toolbar ?? []).map(t => ({ id: String(t.id ?? ""), label: String(t.label ?? "") })),
    status: (shell.status ?? []).map(s => ({ id: String(s.id ?? ""), label: String(s.label ?? ""), value: String(s.value ?? "") })),
  })};

export function Shell({ plan, onAction, children }: { plan: ShellPlanData; onAction?: (id: string) => void; children: ReactNode }) {
  return <div className="export-shell">
    <header className="export-shell-menubar">
      <strong>{plan.title}</strong>
      {plan.menus.map(menu => <span key={menu.id} className="export-shell-menu">{menu.label}
        {menu.items.map(item => <button key={item.id} type="button" onClick={() => onAction?.(item.id)}>{item.label}</button>)}
      </span>)}
    </header>
    <div className="export-shell-toolbar">{plan.toolbar.map(item => <button key={item.id} type="button" onClick={() => onAction?.(item.id)}>{item.label}</button>)}</div>
    <div className="export-shell-body">{children}</div>
    <footer className="export-shell-status">{plan.status.map(item => <span key={item.id}>{item.label}: {item.value}</span>)}</footer>
  </div>;
}`);
  project.record("template", "shell recipe (simplified menubar/toolbar/status chrome)");
}

// ----- document walk -----
function fallbackRects(doc: GuiDocumentLike): Map<string, ResolvedRectLike> {
  const out = new Map<string, ResolvedRectLike>();
  const walk = (parentId: string | null, px: number, py: number) => {
    for (const node of doc.nodes.filter(n => n.parentId === parentId && n.visible !== false)) {
      const r = node.layouts[doc.device] ?? { x: 0, y: 0, w: 0, h: 0 };
      const rect = { ...r, absX: px + r.x, absY: py + r.y };
      out.set(node.id, rect);
      walk(node.id, rect.absX, rect.absY);
    }
  };
  walk(null, 0, 0);
  return out;
}

export function exportGuiDocument(project: CodeProject, _input: unknown, doc: GuiDocumentLike, shell?: Record<string, unknown>): void {
  const deps = project.deps;
  if (!deps.resolvedRects) project.note("No layout resolver was injected; absolute layout was used and stack/grid containers may differ from GuiRenderer.");
  const rects = deps.resolvedRects ? deps.resolvedRects(doc, doc.device) : fallbackRects(doc);
  const byId = new Map(doc.nodes.map(n => [n.id, n]));
  const childrenOf = (parentId: string | null) => doc.nodes.filter(n => n.parentId === parentId && n.visible !== false);
  const rendered: GuiNodeLike[] = [];
  const collect = (parentId: string | null) => {
    for (const node of childrenOf(parentId)) {
      if (!rects.has(node.id)) continue;
      rendered.push(node);
      collect(node.id);
    }
  };
  collect(null);

  const usedTypes = [...new Set(rendered.map(n => n.type))];
  const extracted = vendorControls(project, usedTypes);
  const stateful = new Set(rendered.filter(n => isStateful(n, deps.getControlData)).map(n => n.id));

  const otherDevices = new Set<string>();
  for (const node of doc.nodes) for (const d of Object.keys(node.layouts)) if (d !== doc.device) otherDevices.add(d);
  if (otherDevices.size) project.note(`Layouts for ${[...otherDevices].sort().join(", ")} are noted, not emitted; the export carries the document's current device (${doc.device}).`);
  if (doc.nodes.some(n => n.locked)) project.note("Locked nodes: GuiRenderer ignores `locked` in a live render (it is a builder-canvas affordance), so the export renders them interactive, exactly as GuiRenderer does.");
  if (shell) emitShell(project, shell as ShellPlanLike);
  else project.note("The input carries no shell recipe; the document is exported full-canvas without shell chrome.");

  project.need("src/App.tsx", "react", ["useState"]);
  const app = project.file("src/App.tsx");
  const renderNode = (node: GuiNodeLike, parent: ResolvedRectLike | null): string => {
    const rect = rects.get(node.id)!;
    const emitter = getControlEmitter(node.type);
    let control: string;
    if (!emitter) {
      project.diag(`control "${node.type}" (node "${node.id}") has no registered control emitter`);
      control = `{/* unsupported control: ${node.type} */}`;
    } else control = emitter(node, project);
    const kids = childrenOf(node.id).filter(k => rects.has(k.id)).map(k => renderNode(k, rect)).join("\n");
    const style = `{ position: "absolute", left: ${rect.absX - (parent?.absX ?? 0)}, top: ${rect.absY - (parent?.absY ?? 0)}, width: ${rect.w}, height: ${rect.h} }`;
    return `<div className="gui-node" data-gui-node={${jsLiteral(node.id)}} style={${style}}>${control}${kids ? `\n${kids}` : ""}</div>`;
  };

  activeGui = { stateful, extracted };
  try {
    const roots = childrenOf(null).filter(n => rects.has(n.id));
    const rootW = roots.length ? Math.max(...roots.map(n => { const r = rects.get(n.id)!; return r.absX + r.w; })) : 0;
    const rootH = roots.length ? Math.max(...roots.map(n => { const r = rects.get(n.id)!; return r.absY + r.h; })) : 0;
    const body = roots.map(n => renderNode(n, null)).join("\n");
    const states = rendered.filter(n => stateful.has(n.id)).map(n => `  const [${stateNameFor(n)}, ${setterNameFor(n)}] = useState<Record<string, unknown>>({});`).join("\n");
    const root = `<div className="gui-root" style={{ position: "relative", width: ${rootW}, height: ${rootH}, overflow: "hidden" }}>\n${body}\n</div>`;
    const inner = shell ? `<Shell plan={SHELL_PLAN} onAction={() => {}}>${root}</Shell>` : root;
    if (shell) project.need("src/App.tsx", "./Shell", ["Shell", "SHELL_PLAN"]);
    app.append(`import "./controls.css";\n\nexport default function App() {\n${states}${states ? "\n" : ""}  return (\n    ${inner}\n  );\n}`);
  } finally {
    activeGui = null;
  }
  project.record("emitted", `GUI document for device ${doc.device} (${rendered.length} nodes, layout resolved at export time)`);
  for (const node of rendered) if (!byId.has(node.id)) project.diag(`rendered node "${node.id}" missing from document`);
}
