import test from 'node:test';
import { execFileSync } from 'node:child_process';

for (const script of ['verify:replay', 'verify:browser', 'verify:tilings', 'verify:turns', 'verify:selection']) {
  test(script, () => execFileSync('npm', ['run', script], { stdio: 'pipe' }));
}
