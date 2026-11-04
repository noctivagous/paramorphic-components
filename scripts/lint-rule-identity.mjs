import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { root } from './import-boundaries.mjs';
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : e.isFile() && /\.[jt]sx?$/.test(e.name) ? [path.join(dir, e.name)] : []); }
export function checkRuleBranches(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const errors = [];
  function check(node) {
    if ((ts.isPropertyAccessExpression(node) && node.name.text === 'id' && ts.isIdentifier(node.expression) && node.expression.text === 'ruleSet') || (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'ruleSet' && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'id')) {
      const loc = ast.getLineAndCharacterOfPosition(node.getStart(ast));
      errors.push(`${path.relative(root, file)}:${loc.line + 1}: behavior must not branch on ruleSet.id`);
    }
    ts.forEachChild(node, check);
  }
  function visit(node) {
    if (ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) check(node.expression);
    else if (ts.isConditionalExpression(node)) check(node.condition);
    else if (ts.isSwitchStatement(node)) check(node.expression);
    else if (ts.isForStatement(node) && node.condition) check(node.condition);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return errors;
}
const all = [...files(path.join(root, 'src')), ...files(path.join(root, 'apps')), path.join(root, 'App.tsx')];
const errors = all.flatMap(f => checkRuleBranches(f, fs.readFileSync(f, 'utf8')));
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; } else console.log('No direct ruleSet.id behavior branches.');
