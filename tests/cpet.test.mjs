import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, interpretCPET, CPET_PRESETS, predicted } from '../dist/cpet-model.js';

const run = k => simulate(CPET_PRESETS[k].settings);

test('healthy test looks like a normal maximal CPET', () => {
  const r = simulate(), s = r.summary, p = predicted();
  assert.ok(Math.abs(p.vo2max - 2867) < 1, 'Hansen predicted VO2max for 40 y, 80 kg man');
  assert.equal(r.limitedBy, 'circulatory');
  assert.ok(s.vo2PeakPct > 90 && s.hrPeakPct > 95 && s.breathingReserve > 20 && s.rerPeak >= 1.1);
  assert.ok(s.atPctPred > 40 && s.atPctPred < 70, 'AT about half of VO2max');
  assert.ok(Math.abs(r.rest.vo2 - 280) < 1 && Math.abs(r.rest.mets - 1) < 0.01, '1 MET = 3.5 mL/kg/min');
  assert.ok(r.rest.ve > 6 && r.rest.ve < 10 && s.veVco2AtAT < 30);
});

test('Fick and ventilation equations hold along the test', () => {
  const r = simulate();
  for (const p of r.series.filter((_, i) => i % 30 === 0)) {
    assert.ok(Math.abs(p.ve - 0.863 * p.vco2 / (p.paco2 * (1 - p.vdvt))) < 1e-9, 'alveolar ventilation equation');
    assert.ok(Math.abs(p.o2pulse * p.hr - p.vo2) < 1e-6, 'O2 pulse = VO2/HR');
  }
  const pk = r.peak; assert.ok(pk.vco2 > pk.vo2, 'VCO2 exceeds VO2 above AT (buffering)');
});

test('each patient shows its limitation', () => {
  const pat = k => interpretCPET(run(k)).pattern;
  assert.equal(pat('normal'), 'Normal exercise capacity');
  assert.equal(pat('athlete'), 'Normal, high fitness');
  assert.equal(pat('deconditioned'), 'Circulatory limitation');
  assert.equal(pat('heartFailure'), 'Circulatory (cardiac) limitation');
  assert.equal(pat('copd'), 'Ventilatory limitation');
  assert.equal(pat('ild'), 'Ventilatory limitation');
  assert.equal(pat('pulmVascular'), 'Circulatory limitation with abnormal gas exchange');
  assert.equal(pat('anemia'), 'Circulatory limitation: low O2 content');
  const c = run('copd').summary; assert.ok(c.breathingReserve < 15 && c.heartRateReserve > 30, 'COPD: no breathing reserve, heart rate to spare');
  const i = run('ild'); assert.ok(i.summary.spo2Drop >= 4 && i.peak.rr > 45, 'ILD: desaturation, rapid shallow breathing');
});
