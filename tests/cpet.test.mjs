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

test('each patient shows its limitation (course reading cutoffs)', () => {
  const pat = k => interpretCPET(run(k)).pattern;
  assert.equal(pat('normal'), 'Normal exercise capacity');
  assert.equal(pat('athlete'), 'Normal, high fitness');
  assert.equal(pat('poorEffort'), 'Submaximal test');
  assert.equal(pat('deconditioned'), 'Low VO2max with a normal anaerobic threshold');
  assert.equal(pat('heartFailure'), 'Circulatory (cardiac) limitation');
  assert.equal(pat('copd'), 'Respiratory limited');
  assert.equal(pat('ild'), 'Respiratory limited');
  assert.equal(pat('pulmVascular'), 'Circulatory limitation with abnormal gas exchange');
  assert.equal(pat('anemia'), 'Circulatory limitation: low O2 content');
  assert.equal(pat('copdHf'), 'Both heart and lungs at their limits');
  assert.match(interpretCPET(run('copd')).consistent, /COPD/); assert.match(interpretCPET(run('ild')).consistent, /interstitial/);
  const c = run('copd').summary; assert.ok(c.breathingReserve < 20 && c.heartRateReserve > 30 && c.rerPeak < 1.1, 'COPD: no respiratory reserve, heart rate to spare, low peak R');
  const i = run('ild'); assert.ok(i.summary.spo2Drop >= 4 && i.peak.rr > 45 && i.summary.veVco2AtAT > 34, 'ILD: desaturation, rapid shallow breathing, high VE/VCO2');
  const d = run('deconditioned').summary; assert.ok(d.atPctPred >= 40 && d.vo2PeakPct < 85, 'deconditioning: low VO2max, normal AT (reading flowchart)');
  const p = run('poorEffort').summary; assert.ok(p.rerPeak < 1.1 && p.hrPeakPct < 85 && p.breathingReserve > 30, 'poor effort: low R, heart rate and respiratory reserve left');
  const h = simulate().summary; assert.ok(h.breathingReserve >= 30, `healthy respiratory reserve at least 30%: ${h.breathingReserve}`);
  for (const k of Object.keys(CPET_PRESETS)) if (k !== 'poorEffort') { const m = run(k).summary.rampMinutes; assert.ok(m >= 8 && m <= 12, `${k} ramp lasts 8-12 min: ${m}`); }
});

test('the final read checks heart rate and gas exchange before naming a pattern (PHY-01 to 03)', () => {
  const read = o => interpretCPET(simulate(o));
  assert.doesNotMatch(read({ ...CPET_PRESETS.athlete.settings, fev1: 3.2 }).consistent, /heart rate to spare/, 'fit man with no heart rate reserve is not COPD');
  assert.equal(read({ desaturation: 10 }).pattern, 'Normal VO2max, abnormal gas exchange');
  assert.equal(read({ heartRateMax: 0.7 }).pattern, 'Heart rate did not rise normally');
  assert.equal(read({ strokeVolume: 0.3, heartRateMax: 0.6, hemoglobin: 6, fitness: 0.6, desaturation: 15 }).pattern, 'Too little capacity to read');
  const z = simulate({ effort: 0.4 }); assert.ok(z.peak.work > 0 && interpretCPET(z).pattern === 'Submaximal test', 'lowest effort still pedals and reads as submaximal');
});

test('a fast ramp lowers peak VO2 relative to peak work (O2 kinetics)', () => {
  const fast = simulate({ ...CPET_PRESETS.normal.settings, rampRate: 40 }).summary;
  const slow = simulate({ ...CPET_PRESETS.normal.settings, rampRate: 15 }).summary;
  assert.ok(fast.workPct - fast.vo2PeakPct > slow.workPct - slow.vo2PeakPct, 'faster ramp widens the work-VO2 gap');
});

test('healthy extraction and cardiac output follow the lecture', () => {
  const s = simulate().summary;
  assert.ok(s.coMax > 20 && s.coMax < 26, 'peak CO 20-25 L/min');
  assert.ok(s.svo2Peak > 35 && s.svo2Peak < 50, 'mixed venous saturation about 40-50% at peak');
  assert.ok(run('athlete').summary.spo2Drop >= 2, 'athletes can desaturate');
});
