import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRuleBranches } from '../scripts/lint-rule-identity.mjs';

test('reject direct rule identity branches but allow serialization', () => {
  for (const source of ['if (ruleSet.id === "chess") {}', 'switch (ruleSet["id"]) {}', 'const x = ruleSet.id === "x" ? 1 : 2;']) {
    assert.equal(checkRuleBranches('x.ts', source).length, 1);
  }
  assert.equal(checkRuleBranches('x.ts', 'const label = ruleSet.id; if (ruleSet.turns.type === "free") {}').length, 0);
});
