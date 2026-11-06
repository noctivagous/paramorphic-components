// ---------- Exporter core: plans and documents as ordinary source code ----------
// Export is a second presentation of a plan (README §8.5). This module is
// the mechanism: a deterministic code project, emitter registries keyed by
// the same identifiers as the runtime registries, a source provider for
// vendoring, and a manifest that names everything emitted or left behind.
//
// It deliberately does not import the app-kit. Hosts (the CLI today, a
// builder surface later) inject the runtime registries and resolvers they
// already assemble. That keeps framework core inside its import boundary
// and makes the exporter usable from scripts without a browser bundle.
import type { ScopedAppliedMorph } from "../morphs/scoped";
import type { RelationDef } from "../relations";

export type ExportPieceKind = "emitted" | "vendored" | "template";

export type ExportManifest = {
  partial: boolean;
  emitted: string[];
  vendored: string[];
  templates: string[];
  diagnostics: string[];
  notes: string[];
};

export type SourceProvider = {
  /** Read a framework source by logical path, or null when unavailable. */
  readText(logicalPath: string): string | null;
};

/** Structural GUI node shape; identical to app-kit GuiNode by design. */
export type GuiNodeLike = {
  id: string;
  type: string;
  parentId: string | null;
  props: Record<string, unknown>;
  layouts: Record<string, { x: number; y: number; w: number; h: number }>;
  grid?: { colStart: number; colSpan: number; rowStart: number; rowSpan: number };
  layoutMode?: "absolute" | "stack" | "grid";
  stack?: Record<string, unknown>;
  gridCfg?: Record<string, unknown>;
  struts?: Record<string, unknown>;
  locked?: boolean;
  visible?: boolean;
  [key: string]: unknown;
};

export type GuiDocumentLike = {
  schema: "paramorphic-gui/1";
  device: string;
  separateLayouts: boolean;
  nodes: GuiNodeLike[];
  [key: string]: unknown;
};

export type ControlDataLike = {
  type: string;
  label: string;
  propSchema: Array<{ key: string; kind: string }>;
  container?: boolean;
};

export type ResolvedRectLike = { x: number; y: number; w: number; h: number; absX: number; absY: number };

export type ExportDeps = {
  source?: SourceProvider;
  controlTypes?: string[];
  getControlData?: (type: string) => ControlDataLike | undefined;
  resolvedRects?: (doc: GuiDocumentLike, device: string) => Map<string, ResolvedRectLike>;
  relationDefs?: RelationDef[];
  /** Layer emitters injected by hosts (keeps this core free of layer imports). */
  guiExporter?: (project: CodeProject, input: unknown, doc: GuiDocumentLike, shell?: Record<string, unknown>) => void;
  planExporter?: (project: CodeProject, input: unknown, plan: Record<string, unknown>) => boolean;
};

export interface EmitterContext {
  readonly project: CodeProject;
  readonly source?: SourceProvider;
  file(path: string): CodeFile;
  need(fromFile: string, moduleSpecifier: string, names: string[]): void;
  diag(message: string): void;
  note(message: string): void;
  record(kind: ExportPieceKind, name: string): void;
}

export type ControlEmitter = (node: GuiNodeLike, ctx: EmitterContext) => string;
export type DefEmitter = (def: RelationDef, ctx: EmitterContext) => void;
export type MorphEmitter = (morph: ScopedAppliedMorph, ctx: EmitterContext) => string;

const controlEmitters = new Map<string, ControlEmitter>();
const defEmitters = new Map<string, DefEmitter>();
const morphEmitters = new Map<string, MorphEmitter>();

export function registerControlEmitter(type: string, emitter: ControlEmitter): void { controlEmitters.set(type, emitter); }
export function getControlEmitter(type: string): ControlEmitter | undefined { return controlEmitters.get(type); }
export function listControlEmitters(): string[] { return [...controlEmitters.keys()]; }

export function registerDefEmitter(id: string, emitter: DefEmitter): void { defEmitters.set(id, emitter); }
export function getDefEmitter(id: string): DefEmitter | undefined { return defEmitters.get(id); }
export function listDefEmitters(): string[] { return [...defEmitters.keys()]; }

export function registerMorphEmitter(type: string, emitter: MorphEmitter): void { morphEmitters.set(type, emitter); }
export function getMorphEmitter(type: string): MorphEmitter | undefined { return morphEmitters.get(type); }
export function listMorphEmitters(): string[] { return [...morphEmitters.keys()]; }

/** Coverage accounting used by verify:export and by hosts. */
export function emitterCoverage(registered: string[], emitters: string[], exclusions: string[] = []): { covered: string[]; excluded: string[]; missing: string[] } {
  const emitterSet = new Set(emitters);
  const exclusionSet = new Set(exclusions);
  return {
    covered: registered.filter(id => emitterSet.has(id)),
    excluded: registered.filter(id => !emitterSet.has(id) && exclusionSet.has(id)),
    missing: registered.filter(id => !emitterSet.has(id) && !exclusionSet.has(id)),
  };
}

export class CodeFile {
  readonly chunks: string[] = [];
  readonly imports = new Map<string, Set<string>>();

  constructor(readonly path: string, readonly header?: string) {}

  append(text: string): this {
    const clean = text.replace(/^\n+|\s+$/g, "");
    if (clean) this.chunks.push(clean);
    return this;
  }

  need(moduleSpecifier: string, names: string[]): void {
    if (!this.imports.has(moduleSpecifier)) this.imports.set(moduleSpecifier, new Set());
    for (const name of names) this.imports.get(moduleSpecifier)!.add(name);
  }

  render(): string {
    const imports = [...this.imports.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([spec, names]) => `import { ${[...names].sort().join(", ")} } from ${JSON.stringify(spec)};`);
    return [this.header, ...imports, ...this.chunks].filter(Boolean).join("\n\n") + "\n";
  }
}

export class CodeProject implements EmitterContext {
  readonly filesByPath = new Map<string, CodeFile>();
  readonly manifest: ExportManifest = { partial: false, emitted: [], vendored: [], templates: [], diagnostics: [], notes: [] };

  constructor(readonly sourceName: string, readonly deps: ExportDeps = {}) {}

  get source(): SourceProvider | undefined { return this.deps.source; }
  get project(): CodeProject { return this; }

  file(path: string): CodeFile {
    if (!this.filesByPath.has(path)) {
      const header = path.endsWith(".css")
        ? `/* Generated from ${this.sourceName} — edit freely; regeneration overwrites. */`
        : /\.(?:ts|tsx|js|jsx)$/.test(path)
          ? `// Generated from ${this.sourceName} — edit freely; regeneration overwrites.`
          : undefined;
      this.filesByPath.set(path, new CodeFile(path, header));
    }
    return this.filesByPath.get(path)!;
  }

  need(fromFile: string, moduleSpecifier: string, names: string[]): void { this.file(fromFile).need(moduleSpecifier, names); }
  diag(message: string): void { if (!this.manifest.diagnostics.includes(message)) this.manifest.diagnostics.push(message); }
  note(message: string): void { if (!this.manifest.notes.includes(message)) this.manifest.notes.push(message); }
  record(kind: ExportPieceKind, name: string): void {
    const bucket = kind === "emitted" ? this.manifest.emitted : kind === "vendored" ? this.manifest.vendored : this.manifest.templates;
    if (!bucket.includes(name)) bucket.push(name);
  }

  renderFiles(): Map<string, string> {
    this.manifest.partial = this.manifest.diagnostics.length > 0;
    const out = new Map<string, string>();
    for (const path of [...this.filesByPath.keys()].sort()) out.set(path, this.filesByPath.get(path)!.render());
    out.set("EXPORT-MANIFEST.md", renderManifest(this.sourceName, this.manifest));
    return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}

export function renderManifest(sourceName: string, manifest: ExportManifest): string {
  const section = (title: string, values: string[]) => `## ${title}\n\n${values.length ? values.map(v => `- ${v}`).join("\n") : "- None"}`;
  return [
    `# Export manifest`,
    `Generated from ${sourceName}.`,
    `Status: ${manifest.partial ? "partial" : "complete"}.`,
    section("Emitted", manifest.emitted),
    section("Vendored", manifest.vendored),
    section("Templates", manifest.templates),
    section("Diagnostics", manifest.diagnostics),
    section("Notes", manifest.notes),
    "",
  ].join("\n\n");
}

export function toIdentifier(value: string, fallback = "value"): string {
  const cleaned = value.replace(/[^A-Za-z0-9_$]+/g, "_").replace(/^_+|_+$/g, "");
  const out = !cleaned || /^[0-9]/.test(cleaned) ? `${fallback}_${cleaned || "item"}` : cleaned;
  return out === "value" && fallback !== "value" ? fallback : out;
}

export function toPascalCase(value: string): string {
  const parts = value.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const out = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  return !out || /^[0-9]/.test(out) ? `Item${out}` : out;
}

export function jsLiteral(value: unknown): string {
  if (value === undefined) return "undefined";
  return JSON.stringify(value, null, 2) ?? "undefined";
}

export function sourceNameOf(input: unknown): string {
  if (input && typeof input === "object") {
    const rec = input as Record<string, unknown>;
    if (typeof rec.presetId === "string") return `plan:${rec.presetId}`;
    if (rec.schema === "paramorphic-gui/1") return "GUI document";
    if (rec.schema === "paramorphic-gui-plan/1") return "GUI plan";
    if (typeof rec.title === "string") return rec.title;
  }
  return "paramorphic input";
}

function packageNameOf(input: unknown): string {
  const raw = sourceNameOf(input).replace(/^plan:/, "");
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug && slug !== "gui-document" && slug !== "gui-plan" ? `${slug}-export` : "exported-app";
}

export function emitSkeleton(project: CodeProject, input: unknown): void {
  const title = sourceNameOf(input).replace(/^plan:/, "") || "Exported app";
  project.file("package.json").append(JSON.stringify({
    name: packageNameOf(input),
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: { dev: "vite", build: "vite build", preview: "vite preview", typecheck: "tsc --noEmit" },
    dependencies: { react: "^18.3.1", "react-dom": "^18.3.1" },
    devDependencies: {
      "@types/react": "^18.3.3",
      "@types/react-dom": "^18.3.0",
      "@vitejs/plugin-react": "^4.3.1",
      typescript: "~5.6.2",
      vite: "^6.0.3",
    },
  }, null, 2));
  project.file("index.html").append(`<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${title}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>`);
  project.file("vite.config.ts").append(`import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({ plugins: [react()] });`);
  project.file("tsconfig.json").append(JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      useDefineForClassFields: true,
      lib: ["ES2020", "DOM", "DOM.Iterable"],
      module: "ESNext",
      skipLibCheck: true,
      moduleResolution: "bundler",
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      isolatedModules: true,
      moduleDetection: "force",
      jsx: "react-jsx",
      strict: true,
      noFallthroughCasesInSwitch: true,
    },
    include: ["src", "vite.config.ts"],
  }, null, 2));
  project.file("src/main.tsx").append(`import React from "react";\nimport ReactDOM from "react-dom/client";\nimport App from "./App";\n\nReactDOM.createRoot(document.getElementById("root")!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n);`);
  project.record("emitted", "standalone Vite/React/TypeScript skeleton");
}

/**
 * E1 entry point: always produce the skeleton and a manifest. Later slices
 * teach this same entry GUI-document and relation-plan emission; until a
 * piece has an emitter it is named in diagnostics rather than dropped.
 */
export function exportProject(input: unknown, deps: ExportDeps = {}): { files: Map<string, string>; manifest: ExportManifest } {
  const project = new CodeProject(sourceNameOf(input), deps);
  emitSkeleton(project, input);
  const rec = input && typeof input === "object" ? input as Record<string, unknown> : null;
  const doc = rec?.schema === "paramorphic-gui/1" ? rec as unknown as GuiDocumentLike
    : rec?.schema === "paramorphic-gui-plan/1" ? (rec.snapshot as GuiDocumentLike)
    : rec?.document && typeof rec.document === "object" ? rec.document as GuiDocumentLike
    : null;

  if (doc) {
    const shell = (rec?.shell ?? rec?.shellPlan) as Record<string, unknown> | undefined;
    if (deps.guiExporter) deps.guiExporter(project, input, doc, shell);
    else {
      for (const node of doc.nodes ?? []) project.diag(`GUI node "${node.id}" (${node.type}) has no GUI exporter in this host`);
      project.note("No GUI layer emitter was injected by the host; only the skeleton was emitted.");
    }
    if (rec && Array.isArray(rec.relations) && rec.relations.length) project.diag("GUI document carries relation bindings, which this exporter does not bind to GUI nodes (R3b territory)");
  } else if (rec && Array.isArray(rec.occupants)) {
    const handled = deps.planExporter ? deps.planExporter(project, input, rec) : false;
    if (!handled) {
      for (const occ of rec.occupants as Array<Record<string, unknown>>) project.diag(`plan occupant "${String(occ.id)}" is not emitted by this exporter`);
      if (Array.isArray(rec.relations)) for (const b of rec.relations as Array<Record<string, unknown>>) project.diag(`relation binding "${String(b.id)}" (${String(b.def)}) is not emitted by this exporter`);
    }
    if (Array.isArray(rec.morphs)) for (const m of rec.morphs as Array<Record<string, unknown>>) project.diag(`morph "${String(m.type ?? m.kind ?? "unknown")}" is registered for coverage but morph emission is E5 work, not E1–E3`);
  } else {
    project.diag("input is not a recognized GUI document, GUI plan, or morph plan");
  }

  if (!project.filesByPath.get("src/App.tsx")?.chunks.length) {
    project.file("src/App.tsx").append(`export default function App() {\n  return <main><h1>Export skeleton</h1><p>See EXPORT-MANIFEST.md for the pieces this exporter has not emitted yet.</p></main>;\n}`);
  }
  const files = project.renderFiles();
  return { files, manifest: project.manifest };
}
