import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
const inRepo = f => !path.relative(root, f).startsWith('..') && !f.includes(`${path.sep}node_modules${path.sep}`);
const lines = f => fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(line => line.trim().length > 0).length;
const sum = files => files.reduce((n, f) => n + lines(f), 0);
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : e.isFile() ? [path.join(dir, e.name)] : []);
}
function graph(entry) {
  const seen = new Set();
  function visit(file) {
    file = path.resolve(file);
    if (seen.has(file) || !inRepo(file) || !/\.[cm]?[jt]sx?$/.test(file) || !fs.existsSync(file)) return;
    seen.add(file);
    const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function follow(spec) {
      if (!spec || !ts.isStringLiteralLike(spec)) return;
      const found = ts.resolveModuleName(spec.text, file, options, ts.sys).resolvedModule;
      if (found && !found.isExternalLibraryImport) visit(found.resolvedFileName);
    }
    function scan(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) follow(node.moduleSpecifier);
      else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) follow(node.moduleReference.expression);
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) follow(node.argument.literal);
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) follow(node.arguments[0]);
      ts.forEachChild(node, scan);
    }
    scan(ast);
  }
  visit(entry);
  return [...seen].sort();
}
const appRoot = path.join(root, 'apps');
const reports = fs.readdirSync(appRoot, { withFileTypes: true }).filter(e => e.isDirectory() && fs.existsSync(path.join(appRoot, e.name, 'src/main.tsx'))).map(e => {
  const dir = path.join(appRoot, e.name);
  const deps = graph(path.join(dir, 'src/main.tsx'));
  const own = walk(dir).filter(f => /\.[jt]sx?$/.test(f));
  const shared = deps.filter(f => f.startsWith(path.join(root, 'src/framework') + path.sep));
  const views = deps.filter(f => f.startsWith(path.join(root, 'src/views') + path.sep));
  const custom = [...new Set([...own, ...views])].sort();
  const plans = walk(path.join(dir, 'morph-plans')).filter(f => f.endsWith('.json')).sort();
  const rel = f => path.relative(root, f).split(path.sep).join('/');
  return { app: e.name, shared_reachable_lines: sum(shared), custom_lines: sum(custom), plan_lines: sum(plans), shared_files: shared.map(rel), custom_files: custom.map(rel), plan_files: plans.map(rel) };
});
const data = { method: 'Nonblank physical lines. Shared counts are statically reachable framework source, including barrel re-exports; they are not bundle size or proven executed code. Custom counts include all app-local TS/TSX and reachable src/views. Plans count app-owned JSON; generated recipes are shared code, not plan lines. No code sharing or quality is inferred from line counts.', apps: reports, manual_measures: ['time to first working draft', 'AI first-try validity', 'corrections', 'review effort'] };
if (process.argv.includes('--json')) console.log(JSON.stringify(data, null, 2));
else {
  console.log(data.method);
  console.log('\nApp\tShared reachable\tCustom\tPlan JSON');
  for (const r of reports) console.log(`${r.app}\t${r.shared_reachable_lines}\t${r.custom_lines}\t${r.plan_lines}`);
  console.log('\nUse --json for file lists. Time, AI validity, corrections, and review effort require recorded evaluations.');
}
