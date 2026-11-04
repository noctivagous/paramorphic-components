import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const framework = path.join(root, 'src/framework');
const outside = (base, file) => { const rel = path.relative(base, file); return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel); };
/** Core is framework code by default; entry point, vocabularies and adapters assemble it. */
export function isCore(file) {
  if (outside(framework, file)) return false;
  const rel = path.relative(framework, file).split(path.sep).join('/');
  if (['index.ts', 'presets.ts'].includes(rel)) return false;
  if (['plan-kits/', 'app-kit/', 'adapters/'].some(p => rel.startsWith(p))) return false;
  if (rel.startsWith('morphs/') && !['morphs/registry.ts', 'morphs/scoped.ts'].includes(rel)) return false;
  return /\.[cm]?[jt]sx?$/.test(rel);
}
const configPath = path.join(root, 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const resolve = (specifier, importer) => {
  const resolved = ts.resolveModuleName(specifier, importer, parsed.options, ts.sys).resolvedModule;
  if (resolved) return path.resolve(resolved.resolvedFileName);
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@/') || specifier.startsWith('~/')) return null;
  return 'external';
};
export function checkSource(file, source) {
  if (!isCore(file)) return [];
  const errors = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function inspect(spec, node) {
    const loc = ast.getLineAndCharacterOfPosition(node.getStart(ast));
    const where = `${path.relative(root, file)}:${loc.line + 1}:${loc.character + 1}`;
    if (!spec || !ts.isStringLiteralLike(spec)) { errors.push(`${where}: computed import/require cannot be checked`); return; }
    const target = resolve(spec.text, file);
    if (target === null) errors.push(`${where}: cannot resolve internal import ${JSON.stringify(spec.text)}`);
    else if (target !== 'external' && !outside(root, target) && !target.includes(`${path.sep}node_modules${path.sep}`) && !isCore(target)) errors.push(`${where}: core must not import non-core ${JSON.stringify(spec.text)} (${path.relative(root, target)})`);
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) inspect(node.moduleSpecifier, node);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) inspect(node.moduleReference.expression, node);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) inspect(node.argument.literal, node);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require') || (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && ((node.expression.expression.text === 'module' && node.expression.name.text === 'require') || (node.expression.expression.text === 'require' && node.expression.name.text === 'resolve'))))) inspect(node.arguments[0], node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return errors;
}
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : e.isFile() && /\.[cm]?[jt]sx?$/.test(e.name) ? [path.join(dir, e.name)] : []);
}
export function lint() { return files(framework).flatMap(f => checkSource(f, fs.readFileSync(f, 'utf8'))); }
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const errors = lint();
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('Import boundaries pass: core imports only core or external packages.');
}
