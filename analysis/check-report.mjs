#!/usr/bin/env node
// Pins every number in runs/out-of-family/REPORT.md to the run artifacts.
// Exit 0 = the report agrees with the data; exit 1 = drift, with the drift named.
//
// This exists because a report and its data can disagree silently: gate-value-study
// shipped two report paths reaching opposite verdicts on one dataset. The report
// is not allowed to be a second source of truth.
//
//   node analysis/check-report.mjs [run-id]

import { readFileSync } from 'node:fs';

const runId = process.argv[2] ?? '2026-08-05';
const results = JSON.parse(
  readFileSync(`runs/out-of-family/run-${runId}/results.json`, 'utf8'),
);
const report = readFileSync('runs/out-of-family/REPORT.md', 'utf8');

const byCell = new Map(results.cells.map((c) => [c.cell, c]));
const fails = [];
const checked = [];

const eq = (label, got, want, tol = 0) => {
  checked.push(label);
  if (Math.abs(got - want) > tol) fails.push(`${label}: report ${want}, data ${got}`);
};

// ── the result tables: every cell row, every detector triple ────────────────
// Rows look like:  | nonlinear@0.5 | 1.8 | 5.50 | 2.4 / 88 / 5 | 7.6 / 83 / 34 | ...
const DETS = ['oracle-cusum-bh', 'hidden-cusum-bh', 'hidden-cusum-ebh', 'hidden-ar1-halves-bh'];
const pct1 = (x) => Math.round(x * 1000) / 10;
const pct0 = (x) => Math.round(x * 100);

let rows = 0;
for (const line of report.split('\n')) {
  const m = line.match(
    /^\|\s*(in-family|nonlinear@[\d.]+|heavyTails@[\d.]+|switching@[\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|(.+)\|\s*$/,
  );
  if (!m) continue;
  const [, cellName, cmStr, khatStr, rest] = m;
  const c = byCell.get(cellName);
  if (!c) {
    fails.push(`report row for unknown cell ${cellName}`);
    continue;
  }
  const triples = rest.split('|').map((s) => s.trim()).filter(Boolean);
  // The exploratory table carries FPR/pow pairs for two detectors, not triples for four.
  const isTriple = triples[0].split('/').length === 3;
  rows++;
  eq(`${cellName}.commonMode`, Math.round(c.commonSdInResidualSd * 10) / 10, Number(cmStr), 0.051);
  eq(`${cellName}.khat`, Math.round(c.khatNull * 100) / 100, Number(khatStr), 0.005);
  if (isTriple) {
    if (triples.length !== DETS.length) fails.push(`${cellName}: expected ${DETS.length} detector cells, got ${triples.length}`);
    triples.forEach((cellText, i) => {
      const d = DETS[i];
      if (!d) return;
      const [fpr, fdr, pow] = cellText.split('/').map((x) => Number(x.trim()));
      eq(`${cellName}.${d}.fpr`, pct1(c.detectors[d].fpr), fpr, 0.051);
      eq(`${cellName}.${d}.fdr`, pct0(c.detectors[d].fdr), fdr, 0.51);
      eq(`${cellName}.${d}.pow`, pct0(c.detectors[d].power), pow, 0.51);
    });
  } else {
    const pairs = [['oracle-cusum-bh', triples[0]], ['hidden-cusum-bh', triples[1]]];
    for (const [d, txt] of pairs) {
      const [fpr, pow] = txt.split('/').map((x) => Number(x.trim()));
      eq(`${cellName}.${d}.fpr`, pct1(c.detectors[d].fpr), fpr, 0.051);
      eq(`${cellName}.${d}.pow`, pct0(c.detectors[d].power), pow, 0.51);
    }
  }
}
if (rows !== results.cells.length + 3) {
  // 13 pre-registered rows + 3 exploratory rows, each appearing once, plus the 3
  // exploratory cells also being in results.cells → 16 cells, 16 rows... the 3
  // exploratory cells appear ONLY in the exploratory table, so rows === cells.
  if (rows !== results.cells.length) fails.push(`table rows ${rows} != cells ${results.cells.length}`);
}

// ── prose claims that carry the argument ───────────────────────────────────
const inFam = byCell.get('in-family');
const nl1 = byCell.get('nonlinear@1');
const sw1 = byCell.get('switching@1');
const ht1 = byCell.get('heavyTails@1');

eq('prose.oracle in-family power = 74', pct0(inFam.detectors['oracle-cusum-bh'].power), 74);
eq('prose.oracle nonlinear@1 power = 3', pct0(nl1.detectors['oracle-cusum-bh'].power), 3);
eq('prose.hidden nonlinear@1 power = 54', pct0(nl1.detectors['hidden-cusum-bh'].power), 54);
eq('prose.hidden in-family power = 46', pct0(inFam.detectors['hidden-cusum-bh'].power), 46);
eq('prose.khat in-family = 1.56', Math.round(inFam.khatNull * 100) / 100, 1.56, 0.005);
eq('prose.khat nonlinear@1 = 6.38', Math.round(nl1.khatNull * 100) / 100, 6.38, 0.005);
eq('prose.khat switching@1 = 3.69', Math.round(sw1.khatNull * 100) / 100, 3.69, 0.005);
eq('prose.commonMode in-family = 14.5', Math.round(inFam.commonSdInResidualSd * 10) / 10, 14.5, 0.051);
eq('prose.commonMode switching@1 = 41.2', Math.round(sw1.commonSdInResidualSd * 10) / 10, 41.2, 0.051);
eq('prose.in-family hidden FDR = 84', pct0(inFam.detectors['hidden-cusum-bh'].fdr), 84);
eq('prose.in-family hidden FPR = 12.5', pct1(inFam.detectors['hidden-cusum-bh'].fpr), 12.5, 0.051);
eq('prose.heavyTails@1 hidden FPR = 15.1', pct1(ht1.detectors['hidden-cusum-bh'].fpr), 15.1, 0.051);
eq('prose.heavyTails@1 ar1 FPR = 9.6', pct1(ht1.detectors['hidden-ar1-halves-bh'].fpr), 9.6, 0.051);
eq('prose.in-family ar1 FPR = 4.9', pct1(inFam.detectors['hidden-ar1-halves-bh'].fpr), 4.9, 0.051);
eq('prose.nNull per cell = 2304', inFam.nNull, 2304);
eq('prose.nPositive per cell = 153', inFam.nPositive, 153);
eq('prose.seeds = 16', inFam.seeds, 16);
eq('prose.shards = 144', inFam.nShards, 144);
eq('prose.q = 0.10', results.run.q, 0.1);
eq('prose.fault midpoint = 6 noise sd', results.diagnostics.faultMidpointInNoiseSd, 6);

// oracle power falls 74 -> 3 across the ladder: the headline "71 points"
eq(
  'prose.oracle power drop = 71 points',
  pct0(inFam.detectors['oracle-cusum-bh'].power) - pct0(nl1.detectors['oracle-cusum-bh'].power),
  71,
);

// baselines: random is 11.1% everywhere, magnitude spans 8.5–13.1%
const rand = results.cells.map((c) => pct1(c.baselines['baseline-random'].recall));
if (new Set(rand).size !== 1 || rand[0] !== 11.1) {
  fails.push(`prose.baseline-random recall: report 11.1% in every cell, data ${[...new Set(rand)].join(',')}`);
} else checked.push('prose.baseline-random = 11.1 everywhere');
const mag = results.cells.map((c) => pct1(c.baselines['baseline-magnitude'].recall));
eq('prose.baseline-magnitude min = 8.5', Math.min(...mag), 8.5, 0.051);
eq('prose.baseline-magnitude max = 13.1', Math.max(...mag), 13.1, 0.051);

// three of four detectors below the random baseline at nonlinear@0.75
const below = DETS.filter((d) => pct1(byCell.get('nonlinear@0.75').detectors[d].power) < 11.1);
if (below.length !== 3) {
  fails.push(`prose."three of four below random" at nonlinear@0.75: data says ${below.length} (${below.join(', ')})`);
} else checked.push('prose.three of four below the random baseline');

// the exercise-level falsifier did not fire
if (results.cells.every((c) => DETS.every((d) => Math.abs(c.detectors[d].power - inFam.detectors[d].power) < 0.05))) {
  fails.push('prose."falsifier did not fire": no detector moved — it DID fire');
} else checked.push('prose.exercise falsifier did not fire');

// ── provenance ─────────────────────────────────────────────────────────────
for (const [label, got, want] of [
  ['manifest.register', results.register, 'C31'],
  ['manifest.prereg', results.prereg, 'PREREG-out-of-family.md'],
  ['manifest.runId', results.runId, runId],
]) {
  checked.push(label);
  if (got !== want) fails.push(`${label}: expected ${want}, got ${got}`);
}

if (fails.length) {
  console.error(`FAIL — ${fails.length} of ${checked.length} checks drifted:\n  ${fails.join('\n  ')}`);
  process.exit(1);
}
console.log(`OK — ${checked.length} report claims verified against run-${runId}`);
