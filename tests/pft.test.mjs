import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, PFT_PRESETS, PFT_DEFAULTS, PREDICTED } from '../dist/pft-model.js';

const pct = (r, k) => 100 * r[k] / PREDICTED[k];
const run = (k, extra) => simulate({ ...PFT_PRESETS[k].settings, ...(extra ? PFT_PRESETS[k][extra] : {}) }).report;

test('healthy spirometry is in the normal adult range', () => {
  const r = PREDICTED;
  assert.ok(r.ratio > 0.75 && r.ratio < 0.88, `FEV1/FVC ${r.ratio}`);
  assert.ok(r.pef > 7 && r.pef < 11, `PEF ${r.pef}`);
  assert.ok(Math.abs(r.fvc - r.svc) < 0.08, 'FVC about equals SVC in health');
  assert.ok(Math.abs(r.tlc - (r.svc + r.rv)) < 1e-9, 'TLC = SVC + RV'); assert.ok(Math.abs(r.tlc - (r.ic + r.erv + r.rv)) < 1e-9, 'TLC = IC + ERV + RV');
  assert.ok(Math.abs(r.dlco - 25) < 0.01);
});

test('volumes are conserved along the forced maneuver', () => {
  const sim = simulate(PFT_DEFAULTS);
  for (let i = 1; i < sim.expiration.length; i++) assert.ok(sim.expiration[i].v <= sim.expiration[i - 1].v + 1e-12, 'volume never rises during expiration');
  const last = sim.inspiration.at(-1).v; assert.ok(Math.abs(last - sim.report.tlc) < 0.01, 'inspiration returns to TLC');
});

test('obstruction: emphysema and asthma', () => {
  const e = run('emphysema');
  assert.ok(e.ratio < 0.7 && pct(e, 'fev1') < 80, 'obstructive spirometry');
  assert.ok(pct(e, 'rv') > pct(e, 'frc') && pct(e, 'frc') > pct(e, 'tlc') && pct(e, 'tlc') > 100, 'RV > FRC > TLC rise (air trapping)');
  assert.ok(pct(e, 'dlco') < 70, 'low DLCO');
  assert.ok(e.svc > e.fvc + 0.1, 'SVC exceeds FVC in emphysema');
  const a = run('asthma'), bd = run('asthma', 'bronchodilator');
  assert.ok(a.ratio < 0.7 && pct(a, 'dlco') >= 100, 'asthma obstructive, DLCO normal or high');
  assert.ok(bd.fev1 - a.fev1 > 0.2 && (bd.fev1 - a.fev1) / a.fev1 > 0.12, 'bronchodilator response');
});

test('restriction: ILD, obesity, muscle weakness', () => {
  const i = run('ild'), o = run('obesity'), n = run('neuromuscular'), s = run('neuromuscular', 'supine');
  assert.ok(pct(i, 'tlc') < 80 && i.ratio > PREDICTED.ratio && pct(i, 'dlco') < 70, 'ILD');
  assert.ok(pct(o, 'erv') < 65 && pct(o, 'dlco') >= 95, 'obesity: low ERV, normal DLCO');
  assert.ok(pct(n, 'tlc') < 90 && Math.abs(pct(n, 'frc') - 100) < 2 && pct(n, 'rv') > 110, 'weakness step-up pattern');
  assert.ok(Math.abs(pct(n, 'dlco') - 100) < 1, 'weakness: normal DLCO');
  assert.ok(s.tlc < n.tlc && s.fvc < n.fvc, 'supine worse than upright');
});

test('fixed upper airway obstruction and anemia', () => {
  const u = run('upperAirway');
  assert.ok(u.pef < 3.2 && u.pif < 3.2, 'flattened expiratory and inspiratory limbs');
  const an = run('anemia');
  assert.ok(pct(an, 'dlco') < 80 && Math.abs(pct(an, 'dlcoCorrected') - 100) < 2, 'Hb correction restores DLCO');
});

import { interpret } from '../dist/pft-interpret.js';
test('stepwise interpretation names each teaching pattern', () => {
  const read = (k, extra, pre) => interpret(run(k, extra), PREDICTED, { pre });
  assert.equal(read('normal').pattern, 'No obstruction or restriction');
  assert.match(read('emphysema').consistent, /emphysema/);
  assert.match(read('asthma').consistent, /asthma/);
  assert.equal(read('asthma', 'bronchodilator', run('asthma')).pattern, 'Obstruction that reverses');
  assert.match(read('ild').consistent, /interstitial/);
  assert.match(read('neuromuscular').consistent, /step-up/);
  assert.match(read('neuromuscular', 'supine').consistent, /step-up/);
  assert.match(read('obesity').consistent, /obesity/);
  assert.equal(read('upperAirway').pattern, 'Upper airway obstruction');
  assert.match(read('anemia').consistent, /hemoglobin/);
});
