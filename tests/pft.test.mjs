import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, PFT_PRESETS, PFT_DEFAULTS, PREDICTED } from '../dist/pft-model.js';
import { interpret } from '../dist/pft-interpret.js';

const pct = (r, k) => 100 * r[k] / PREDICTED[k];
const run = (k, extra) => simulate({ ...PFT_PRESETS[k].settings, ...(extra ? PFT_PRESETS[k][extra] : {}) }).report;

test('healthy spirometry is in the normal adult range', () => {
  const r = PREDICTED;
  assert.ok(r.ratio > 0.75 && r.ratio < 0.88, `FEV1/FVC ${r.ratio}`);
  assert.ok(r.pef > 7 && r.pef < 11, `PEF ${r.pef}`);
  assert.ok(Math.abs(r.fvc - r.svc) < 0.08, 'FVC about equals SVC in health');
  assert.ok(Math.abs(r.tlc - (r.svc + r.rv)) < 1e-9, 'TLC = SVC + RV'); assert.ok(Math.abs(r.tlc - (r.ic + r.erv + r.rv)) < 1e-9, 'TLC = IC + ERV + RV');
  assert.ok(Math.abs(r.dlco - 25) < 0.01);
  assert.ok(Math.abs(r.raw - 1.4) < 0.01 && r.raw < 2, 'normal Raw below 2');
});

test('volumes are conserved along the forced maneuver', () => {
  const sim = simulate(PFT_DEFAULTS);
  for (let i = 1; i < sim.expiration.length; i++) assert.ok(sim.expiration[i].v <= sim.expiration[i - 1].v + 1e-12, 'volume never rises during expiration');
  const last = sim.inspiration.at(-1).v; assert.ok(Math.abs(last - sim.report.tlc) < 0.01, 'inspiration returns to TLC');
});

test('FRC is never below RV, whatever the sliders (D1)', () => {
  for (const load of [0, 3, 6, 9, 12]) for (const cw of [0.25, 0.5, 1, 2, 4]) for (const base of ['emphysema', 'asthma', 'normal']) {
    const r = simulate({ ...PFT_PRESETS[base].settings, chestWallLoad: load, chestWallCompliance: cw }).report;
    assert.ok(r.erv >= -1e-9 && r.frc <= r.tlc, `${base} load ${load} Ccw ${cw}: ERV ${r.erv}`);
  }
});

test('emphysema: big lungs, TLC < FRC < RV rise, low DLCO, no bronchodilator response', () => {
  const e = run('emphysema'), bd = run('emphysema', 'bronchodilator');
  assert.ok(e.ratio < 0.7 && pct(e, 'fev1') < 80, 'obstructive spirometry');
  assert.ok(pct(e, 'tlc') > 120, `TLC above 120% (course "big lungs"): ${pct(e, 'tlc')}`);
  assert.ok(pct(e, 'rv') > pct(e, 'frc') && pct(e, 'frc') > pct(e, 'tlc'), 'RV > FRC > TLC rise (air trapping)');
  assert.ok(pct(e, 'dlco') < 70, 'low DLCO');
  assert.ok(e.svc > e.fvc + 0.1, 'SVC exceeds FVC');
  assert.ok(pct(e, 'pif') < 80, 'inspiratory flow reduced too (lab key)');
  assert.ok(100 * (bd.fev1 - e.fev1) / PREDICTED.fev1 < 10 && 100 * (bd.fvc - e.fvc) / PREDICTED.fvc < 10, 'no significant bronchodilator response');
});

test('asthma: obstruction with air trapping that reverses after bronchodilator', () => {
  const a = run('asthma'), bd = run('asthma', 'bronchodilator');
  assert.ok(a.ratio < 0.7 && pct(a, 'dlco') >= 100, 'obstructive, DLCO normal or high');
  assert.ok(pct(a, 'rv') > 140 && pct(a, 'frc') > 105, `air trapping before treatment: RV ${pct(a, 'rv')}, FRC ${pct(a, 'frc')}`);
  assert.ok(a.raw >= 2, 'Raw raised during the attack');
  assert.ok(100 * (bd.fev1 - a.fev1) / PREDICTED.fev1 > 10, 'FEV1 up more than 10% of predicted');
  assert.ok(bd.ratio >= 0.72 && pct(bd, 'rv') < 110, 'obstruction and air trapping resolve');
});

test('restriction: ILD, obesity, muscle weakness', () => {
  const i = run('ild'), o = run('obesity'), n = run('neuromuscular'), s = run('neuromuscular', 'supine');
  assert.ok(pct(i, 'tlc') < 75 && pct(i, 'dlco') < 70 && i.ratio > PREDICTED.ratio, 'ILD: clearly small, low DLCO, high FEV1/FVC');
  assert.ok(pct(i, 'rv') < 100 && pct(i, 'fef2575') > 100 && i.raw <= PREDICTED.raw + 0.01, 'ILD: RV falls; stiff lungs hold the airways open (high flows for volume, Raw not raised)');
  assert.ok(pct(o, 'erv') < 65 && pct(o, 'dlco') >= 95, 'obesity: low ERV, normal DLCO');
  assert.ok(pct(o, 'tlc') < 80 && pct(o, 'frc') < 80 && pct(o, 'rv') < 100, 'obesity: TLC, FRC, RV all fall (Small Group 4 key)');
  assert.ok(pct(n, 'tlc') < 80 && pct(n, 'frc') > 80 && pct(n, 'rv') > 120 && pct(n, 'tlc') < pct(n, 'frc') && pct(n, 'frc') < pct(n, 'rv'), 'weakness step-up pattern');
  assert.ok(Math.abs(pct(n, 'dlco') - 100) < 1, 'weakness: normal DLCO');
  assert.ok(s.tlc < n.tlc && s.fvc < n.fvc && s.pef < n.pef && s.rv > n.rv, 'supine: TLC and flows further down, RV further up (Small Group 4 key)');
});

test('fixed upper airway obstruction and anemia', () => {
  const u = run('upperAirway');
  assert.ok(u.pef < 3.2 && u.pif < 3.2, 'flattened expiratory and inspiratory limbs');
  const an = run('anemia');
  assert.ok(pct(an, 'dlco') < 80 && Math.abs(pct(an, 'dlcoCorrected') - 100) < 2, 'Hb correction restores DLCO');
});

test('stepwise interpretation follows the course order and names each teaching pattern', () => {
  const read = (k, extra, pre) => interpret(run(k, extra), PREDICTED, { pre });
  const first = read('normal').steps.map(s => s.q);
  assert.match(first[0], /lung volumes/i); assert.match(first[1], /FEV1\/FVC/); assert.match(first[2], /loop/); assert.match(first[3], /DLCO/);
  for (const k of Object.keys(PFT_PRESETS)) assert.ok(read(k).steps.some(s => /loop/.test(s.q)), `loop question asked for ${k}`);
  assert.equal(read('normal').pattern, 'No obstruction or restriction');
  assert.match(read('emphysema').consistent, /emphysema/);
  assert.match(read('emphysema', 'bronchodilator', run('emphysema')).consistent, /emphysema/);
  assert.match(read('asthma').consistent, /asthma/);
  assert.equal(read('asthma', 'bronchodilator', run('asthma')).pattern, 'Obstruction that reverses');
  assert.match(read('ild').consistent, /interstitial/);
  assert.match(read('neuromuscular').consistent, /step-up/);
  assert.match(read('neuromuscular', 'supine').consistent, /step-up/);
  assert.match(read('obesity').consistent, /obesity/);
  assert.equal(read('upperAirway').pattern, 'Upper airway obstruction');
  assert.match(read('anemia').consistent, /hemoglobin/);
});

// Course cases, as % predicted (FEV1/FVC as a percent).
const courseCase = c => {
  const r = {};
  for (const k of ['tlc', 'frc', 'rv', 'erv', 'fvc', 'fev1', 'dlco', 'pef', 'pif']) r[k] = (c[k] ?? 100) / 100 * PREDICTED[k];
  r.dlcoCorrected = r.dlco; r.ratio = c.ratio / 100; return r;
};
test('course PFT cases read as the keys say (D3)', () => {
  const read = c => interpret(courseCase(c), PREDICTED);
  assert.match(read({ tlc: 72, frc: 83, rv: 125, erv: 60, fvc: 70, fev1: 75, ratio: 86, dlco: 92 }).consistent, /step-up/, 'Small Group 4 weakness patient');
  assert.match(read({ tlc: 76, frc: 62, rv: 71, erv: 30, fvc: 80, fev1: 80, ratio: 80, dlco: 100 }).consistent, /obesity/);
  assert.match(read({ tlc: 62, frc: 65, rv: 68, erv: 60, fvc: 60, fev1: 66, ratio: 88, dlco: 45 }).consistent, /interstitial/);
  assert.match(read({ tlc: 122, frc: 178, rv: 222, erv: 120, fvc: 70, fev1: 40, ratio: 45, dlco: 45 }).consistent, /emphysema/);
});

test('bronchodilator rule is 10% of predicted in FEV1 or FVC, not 12% and 200 mL (D4)', () => {
  const base = courseCase({ fvc: 90, fev1: 60, ratio: 60, dlco: 100 });
  const fvcOnly = courseCase({ fvc: 110, fev1: 62, ratio: 51, dlco: 100 }); // the lecture's FVC responder
  assert.match(interpret(fvcOnly, PREDICTED, { pre: base }).steps.at(-1).a, /Yes/);
  const small = { ...base, fev1: base.fev1 + 0.08 * PREDICTED.fev1 }; // +12.7% relative, +8% of predicted
  small.ratio = small.fev1 / small.fvc;
  assert.match(interpret(small, PREDICTED, { pre: base }).steps.at(-1).a, /No significant/);
});

test('no "normal study" when TLC is normal but spirometry or RV is not (D2)', () => {
  for (const s of [{ muscleStrength: 0.4 }, { airwayCollapsibility: 63 }]) {
    const out = interpret(simulate(s).report, PREDICTED);
    assert.notEqual(out.consistent.split('.')[0], 'Normal study', JSON.stringify(s));
  }
});

test('weakness does not read as upper airway obstruction, but a real stenosis in a weak patient still does (PHY-06)', () => {
  let maxPlateau = 0;
  for (const m of [0.2, 0.3, 0.4, 0.6]) for (const l of [0.6, 0.8, 1]) for (const c of [0.6, 0.85, 1]) {
    const r = simulate({ muscleStrength: m, lungCompliance: l, chestWallCompliance: c }).report;
    maxPlateau = Math.max(maxPlateau, r.plateau);
    assert.notEqual(interpret(r, PREDICTED).pattern, 'Upper airway obstruction', `weakness ${m}/${l}/${c}`);
  }
  assert.ok(maxPlateau < 0.29, `weakness alone stays below the 0.30 plateau guard: ${maxPlateau}`);
  for (const lim of [1.5, 2, 3]) {
    const r = simulate({ ...PFT_PRESETS.neuromuscular.settings, upperAirwayLimit: lim }).report;
    assert.equal(interpret(r, PREDICTED).pattern, 'Upper airway obstruction', `stenosis ${lim} L/s with weakness`);
  }
});
