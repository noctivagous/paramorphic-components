import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { root, checkSource, lint } from '../scripts/import-boundaries.mjs';
const file = path.join(root, 'src/framework/types.ts');

test('current core obeys import boundaries', () => assert.deepEqual(lint(), []));
test('blocks vocabulary, assembly and application imports including types and re-exports', () => {
  for (const source of [
    `import '../framework/morphs/sheet';`,
    `import type { CellPresentation } from './morphs/formulas';`,
    `export * from './index';`,
    `import '../../apps/spreadsheet/src/App';`,
    `const v = require('./morphs/player');`,
    `const v = module.require('./morphs/player');`,
    `const v = require.resolve('./morphs/player');`,
    `const v = import('./morphs/grid');`,
    `type X = import('./morphs/tree').X;`,
  ]) assert.equal(checkSource(file, source).length, 1, source);
});
test('allows core and packages, rejects unresolved and computed imports', () => {
  assert.deepEqual(checkSource(file, `import type { Pos } from './types'; import React from 'react';`), []);
  for (const source of [`import x from './not-found';`, `const x = import(name);`, `const y = require(name);`]) assert.equal(checkSource(file, source).length, 1, source);
});
