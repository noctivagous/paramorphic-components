import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('app metrics enumerate sources and plans with documented limits', () => {
  const report = JSON.parse(execFileSync(process.execPath, ['scripts/report-app-metrics.mjs', '--json'], { encoding: 'utf8' }));
  assert.match(report.method, /not bundle size/);
  for (const app of ['spreadsheet', 'player', 'keyboard', 'browser']) {
    const row = report.apps.find(r => r.app === app);
    assert(row && row.custom_lines > 0 && row.shared_reachable_lines > 0);
    assert(row.custom_files.includes(`apps/${app}/src/App.tsx`));
    assert.equal(row.plan_lines > 0, app !== 'browser');
  }
  assert(report.manual_measures.includes('review effort'));
});
