#!/usr/bin/env node
// Pins every number in the two C79 reports to their run artifacts. Exit 0 = the
// reports agree with the data; exit 1 = drift, with the drift named.
//
//   runs/factor-count/REPORT.md            ← runs/factor-count/run-<id>/results.json
//   runs/out-of-family/REPORT-c79.md       ← runs/out-of-family/run-<id>/results.json
//
// Same device as analysis/check-report.mjs (C31): the report is not allowed to be a
// second source of truth. Table formats are fixed by this file; a report row that
// does not parse is a failure, not a skip.
//
//   node analysis/check-c79-reports.mjs [factor-count-run-id] [out-of-family-run-id]

import { readFileSync } from 'node:fs';

const fcRun = process.argv[2] ?? '2026-09-04';
const oofRun = process.argv[3] ?? '2026-09-04-c79';
const Q = 0.1;

const fails = [];
let checked = 0;
const eq = (label, got, want, tol = 0) => {
  checked++;
  if (Math.abs(got - want) > tol) fails.push(`${label}: report ${want}, data ${got}`);
};
const eqText = (label, got, want) => {
  checked++;
  if (got !== want) fails.push(`${label}: report "${want}", data "${got}"`);
};
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const pct1 = (x) => Math.round(x * 1000) / 10;
const pct0 = (x) => Math.round(x * 100);
const cells = (s) => s.split('|').map((x) => x.trim()).filter(Boolean);

// ── Report 1: factor-count recovery and the FDR gate ────────────────────────
{
  const res = JSON.parse(readFileSync(`runs/factor-count/run-${fcRun}/results.json`, 'utf8'));
  const report = readFileSync('runs/factor-count/REPORT.md', 'utf8');
  const byCell = new Map(res.cells.map((c) => [c.cell, c]));
  const CANDS = ['eigenvalue-ratio', 'bai-ng-ic2', 'onatski-ed'];
  const passes = (d) => d.fdr <= Q + 3 * d.se;
  let recoveryRows = 0;
  let gateRows = 0;

  for (const line of report.split('\n')) {
    // Recovery table: | cell | K mean (min–max) | ER K̂ / |err| / exact% | IC ... | ED ... |
    let m = line.match(/^\|\s*([a-z_]+@\d+)\s*\|\s*([\d.]+) \((\d+)–(\d+)\)\s*\|(.+)\|\s*$/);
    if (m && m[5].split('|').filter((x) => x.trim()).length === 3 && m[5].split('/').length === 9) {
      const [, cell, kMean, kMin, kMax, rest] = m;
      const c = byCell.get(cell);
      if (!c) { fails.push(`recovery row for unknown cell ${cell}`); continue; }
      recoveryRows++;
      eq(`${cell}.trueK.mean`, r2(c.trueK.mean), Number(kMean), 0.0051);
      eq(`${cell}.trueK.min`, c.trueK.min, Number(kMin));
      eq(`${cell}.trueK.max`, c.trueK.max, Number(kMax));
      cells(rest).forEach((txt, i) => {
        const arm = c.arms[CANDS[i]];
        const [kbar, abs, exact] = txt.split('/').map((x) => Number(x.trim()));
        const mean = arm.khat.reduce((s, v) => s + v, 0) / arm.khat.length;
        eq(`${cell}.${CANDS[i]}.khatMean`, r2(mean), kbar, 0.0051);
        eq(`${cell}.${CANDS[i]}.meanAbs`, r2(arm.recovery.meanAbs), abs, 0.0051);
        eq(`${cell}.${CANDS[i]}.exact%`, pct0(arm.recovery.exact), exact, 0.51);
      });
      continue;
    }
    // Gate table: | cell | oracle FDR / FPR% | oracle-k FDR / FPR% / PASS|FAIL | cand FDR ± se / FPR% / verdict ×3 |
    m = line.match(/^\|\s*([a-z_]+@\d+)\s*\|\s*([\d.]+) \/ ([\d.]+)\s*\|\s*([\d.]+) \/ ([\d.]+) \/ (PASS|FAIL)\s*\|(.+)\|\s*$/);
    if (m) {
      const [, cell, oFdr, oFpr, okFdr, okFpr, okVerdict, rest] = m;
      const c = byCell.get(cell);
      if (!c) { fails.push(`gate row for unknown cell ${cell}`); continue; }
      gateRows++;
      eq(`${cell}.oracle.fdr`, r2(c.oracle.fdr), Number(oFdr), 0.0051);
      eq(`${cell}.oracle.fpr%`, pct1(c.oracle.fpr), Number(oFpr), 0.051);
      const ok = c.arms['oracle-k'].detectors['hidden-cusum-bh'];
      eq(`${cell}.oracle-k.fdr`, r2(ok.fdr), Number(okFdr), 0.0051);
      eq(`${cell}.oracle-k.fpr%`, pct1(ok.fpr), Number(okFpr), 0.051);
      eqText(`${cell}.oracle-k.verdict`, passes(ok) ? 'PASS' : 'FAIL', okVerdict);
      const parts = cells(rest);
      if (parts.length !== 3) fails.push(`${cell}: expected 3 candidate cells, got ${parts.length}`);
      parts.forEach((txt, i) => {
        const mm = txt.match(/^([\d.]+) ± ([\d.]+) \/ ([\d.]+) \/ (PASS|FAIL|n\.a\.)$/);
        if (!mm) { fails.push(`${cell}.${CANDS[i]}: unparseable gate cell "${txt}"`); return; }
        const d = c.arms[CANDS[i]].detectors['hidden-cusum-bh'];
        eq(`${cell}.${CANDS[i]}.fdr`, r2(d.fdr), Number(mm[1]), 0.0051);
        eq(`${cell}.${CANDS[i]}.se`, r3(d.se), Number(mm[2]), 0.00051);
        eq(`${cell}.${CANDS[i]}.fpr%`, pct1(d.fpr), Number(mm[3]), 0.051);
        const verdict = !passes(ok) ? 'n.a.' : passes(d) ? 'PASS' : 'FAIL';
        eqText(`${cell}.${CANDS[i]}.verdict`, verdict, mm[4]);
      });
    }
  }
  if (recoveryRows !== res.cells.length) fails.push(`recovery table: ${recoveryRows} rows for ${res.cells.length} cells`);
  if (gateRows !== res.cells.length) fails.push(`gate table: ${gateRows} rows for ${res.cells.length} cells`);

  // Headline: the ship decision as the pre-registered rule computes it.
  const gateCells = res.cells.filter((c) => passes(c.arms['oracle-k'].detectors['hidden-cusum-bh']));
  const shipping = CANDS.filter((m) => gateCells.every((c) => passes(c.arms[m].detectors['hidden-cusum-bh'])));
  const meanAbs = (m) => res.cells.reduce((s, c) => s + c.arms[m].recovery.meanAbs, 0) / res.cells.length;
  const winner =
    shipping.length === 0
      ? 'none'
      : shipping.slice().sort((x, y) => meanAbs(x) - meanAbs(y) || (x === 'onatski-ed' ? -1 : 1))[0];
  const want = report.match(/\*\*Ship decision:\*\* `([a-z0-9-]+)`/);
  if (!want) fails.push('report has no "**Ship decision:** `<method>`" line');
  else eqText('ship decision', winner, want[1]);
  const passesLine = report.match(/passes the gate at (\d+) of (\d+) gated cells/g) ?? [];
  for (const l of passesLine) {
    const mm = l.match(/passes the gate at (\d+) of (\d+) gated cells/);
    checked++;
    if (Number(mm[2]) !== gateCells.length) fails.push(`gated cell count: report ${mm[2]}, data ${gateCells.length}`);
  }
  for (const m of CANDS) {
    const re = new RegExp('`' + m + '` passes the gate at (\\d+) of \\d+ gated cells');
    const mm = report.match(re);
    if (mm) eq(`${m}.gatedPasses`, gateCells.filter((c) => passes(c.arms[m].detectors['hidden-cusum-bh'])).length, Number(mm[1]));
  }
}

// ── Report 2: the repaired switching axis and the re-measured surface ───────
{
  const res = JSON.parse(readFileSync(`runs/out-of-family/run-${oofRun}/results.json`, 'utf8'));
  const report = readFileSync('runs/out-of-family/REPORT-c79.md', 'utf8');
  const byCell = new Map(res.cells.map((c) => [c.cell, c]));
  const DETS = ['oracle-cusum-bh', 'hidden-cusum-bh', 'hidden-cusum-ebh', 'hidden-ar1-halves-bh'];
  let rows = 0;
  for (const line of report.split('\n')) {
    const m = line.match(/^\|\s*((?:in-family|nonlinear@[\d.]+|heavyTails@[\d.]+|switching@[\d.]+)(?:#[a-z-]+)?)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|(.+)\|\s*$/);
    if (!m) continue;
    const [, cellName, cmStr, khatStr, rest] = m;
    const c = byCell.get(cellName);
    if (!c) { fails.push(`report row for unknown cell ${cellName}`); continue; }
    rows++;
    eq(`${cellName}.commonMode`, r1(c.commonSdInResidualSd), Number(cmStr), 0.051);
    eq(`${cellName}.khat`, r2(c.khatNull), Number(khatStr), 0.0051);
    const triples = cells(rest);
    if (triples.length !== DETS.length) fails.push(`${cellName}: expected ${DETS.length} detector cells, got ${triples.length}`);
    triples.forEach((txt, i) => {
      const d = DETS[i];
      const [fpr, fdr, pow] = txt.split('/').map((x) => Number(x.trim()));
      eq(`${cellName}.${d}.fpr`, pct1(c.detectors[d].fpr), fpr, 0.051);
      eq(`${cellName}.${d}.fdr`, pct0(c.detectors[d].fdr), fdr, 0.51);
      eq(`${cellName}.${d}.pow`, pct0(c.detectors[d].power), pow, 0.51);
    });
  }
  if (rows !== res.cells.length) fails.push(`out-of-family table rows: ${rows} for ${res.cells.length} cells`);
  // The manifest's reference estimator must be the one the report names.
  const named = report.match(/reference estimator `([a-z0-9-]+)`/);
  if (!named) fails.push('report does not name the reference estimator');
  else eqText('reference estimator', res.referenceEstimator, named[1]);
}

if (fails.length) {
  console.error(`DRIFT — ${fails.length} of ${checked} claims disagree with the run artifacts:`);
  for (const f of fails) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`OK — ${checked} report claims verified against run artifacts`);
