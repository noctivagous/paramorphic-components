// Export CLI host: reads one GUI document/plan or morph plan JSON file and
// writes a standalone project. This host supplies the disk SourceProvider;
// the exporter core itself stays free of Node imports.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  exportProject,
  getControlData,
  listControlData,
  listRelationDefs,
  resolvedRects,
  type SourceProvider,
} from "../src/framework";
import { exportGuiDocument, registerExtractionControlEmitters } from "../src/framework/export/gui";
import { exportPlanApp, registerExtractionDefEmitters } from "../src/framework/export/relations";

const [inputPath, outdir] = process.argv.slice(2);
if (!inputPath || !outdir) {
  console.error("Usage: npm run export -- <input.json> <outdir>");
  process.exit(2);
}

const repoRoot = process.env.PARAMORPHIC_ROOT ? path.resolve(process.env.PARAMORPHIC_ROOT) : process.cwd();
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

const input = JSON.parse(readFileSync(path.resolve(inputPath), "utf8"));
registerExtractionControlEmitters(listControlData().map(d => d.type));
registerExtractionDefEmitters(listRelationDefs());
const result = exportProject(input, {
  source,
  controlTypes: listControlData().map(d => d.type),
  getControlData,
  resolvedRects: (doc, device) => resolvedRects(doc as never, device as never),
  relationDefs: listRelationDefs(),
  guiExporter: (project, raw, doc, shell) => exportGuiDocument(project, raw, doc, shell),
  planExporter: (project, raw, plan) => exportPlanApp(project, raw, plan),
});

for (const [file, content] of result.files) {
  const target = path.join(path.resolve(outdir), file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

console.log(`export-app: wrote ${result.files.size} files to ${path.resolve(outdir)} (${result.manifest.partial ? "partial" : "complete"}; ${result.manifest.diagnostics.length} diagnostics)`);
for (const diagnostic of result.manifest.diagnostics) console.log(`  - ${diagnostic}`);
