// The device that makes rule 9 of the house study discipline bind: the C31 report
// cannot drift from its run artifacts without a test going red.
//
// gate-value-study shipped two report paths reaching opposite verdicts on one
// dataset, and nothing caught it. `analysis/check-report.mjs` pins every number in
// runs/out-of-family/REPORT.md to runs/out-of-family/run-*/results.json and exits
// non-zero on disagreement; this test is what runs it.

import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { execFileSync } from 'node:child_process';

test('the C31 report agrees with its run artifacts', () => {
  let out = '';
  try {
    out = execFileSync('node', ['analysis/check-report.mjs'], { encoding: 'utf8' });
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string };
    a.fail(`check-report.mjs failed:\n${err.stderr ?? err.stdout ?? String(e)}`);
  }
  a.match(out, /^OK — \d+ report claims verified/, out);
});
