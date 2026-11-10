import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, probe, PRESETS, DEFAULT_SETTINGS } from '../dist/model.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('healthy baseline matches teaching values', () => {
  const a = analyze(DEFAULT_SETTINGS);
  near(a.frc, 3.0, 0.02, 'FRC'); near(a.tlc, 6.0, 1e-3, 'TLC'); near(a.rv, 1.5, 1e-3, 'RV');
  near(a.lungRecoilAtFrc, -a.chestWallRecoilAtFrc, 1e-6, 'recoils balance at FRC');
  near(a.systemCompliance, 0.147, 0.01, 'Crs');
  near(a.chestWallRestingVolume, 4.75, 0.01, 'chest wall rests at 72% VC (Rahn 1946)');
});

test('pressures add at equal volume and compliances add in series', () => {
  for (const s of Object.values(PRESETS)) {
    const a = analyze(s);
    near(a.systemCompliance, a.seriesCheck, 1e-4, `series rule (${s.label})`);
    assert.ok(a.systemCompliance < Math.min(a.lungCompliance, a.chestWallCompliance), 'system stiffer than either part');
    const p = probe(4.2, s); near(p.system, p.lung + p.chestWall, 1e-9, 'sum');
    assert.ok(a.rv < a.frc && a.frc < a.tlc, 'volume ordering');
  }
});

test('conditions move volumes in the taught direction', () => {
  const h = analyze(DEFAULT_SETTINGS), A = k => analyze(PRESETS[k]);
  assert.ok(A('emphysema').frc > h.frc && A('emphysema').tlc > h.tlc, 'emphysema hyperinflation');
  assert.ok(A('fibrosis').frc < h.frc && A('fibrosis').tlc < h.tlc, 'fibrosis restriction');
  assert.ok(A('obesity').frc < h.frc && A('obesity').erv < h.erv, 'obesity lowers FRC and ERV');
  const k = A('kyphoscoliosis');
  assert.ok(k.frc < h.frc && k.tlc < h.tlc && k.erv < h.erv && k.systemCompliance < h.systemCompliance, 'stiff chest wall alone gives restriction');
  near(k.rv, h.rv, 0.01, 'RV pinned near the pivot');
  const n = A('neuromuscular');
  near(n.frc, h.frc, 1e-6, 'weakness leaves FRC'); assert.ok(n.tlc < h.tlc && n.rv > h.rv, 'weakness: TLC down, RV up');
});

import { simulateBreath, PRESETS as BREATH_PRESETS } from '../dist/model.js';
test('one breath: Ppl falls, PA goes negative, flow stops at the new volume', () => {
  const b = simulateBreath(BREATH_PRESETS.normal), s = b.samples;
  assert.ok(Math.abs(s[0].ppl + 5) < 0.1 && Math.abs(s[0].pa) < 1e-9, 'starts at FRC: Ppl -5, PA 0');
  const endInsp = s.find(x => x.t >= 2.4 - 1e-9);
  assert.ok(Math.abs(endInsp.ppl + 7) < 0.3, `end-inspiratory Ppl about -7 (${endInsp.ppl})`);
  assert.ok(Math.min(...s.map(x => x.pa)) < -1 && Math.abs(endInsp.pa) < 0.15, 'PA dips below zero, then returns toward zero');
  for (const x of s) assert.ok(Math.abs(x.pa - (x.ppl + x.pel)) < 1e-9, 'PA = Ppl + Pel');
  assert.ok(Math.abs(b.vPeak - b.frc - 0.5) < 0.02 && Math.abs(s.at(-1).volume - b.frc) < 0.02, 'tidal breath of 0.5 L returns to FRC');
  const fib = simulateBreath(BREATH_PRESETS.fibrosis), emph = simulateBreath(BREATH_PRESETS.emphysema);
  assert.ok(fib.work > 1.3 * b.work && emph.work < b.work, 'stiffer lung, more elastic work for the same breath');
});

test('TLC and RV sit where the combined curve meets the muscle limits, which change with volume', async () => {
  const m = await import('../dist/model.js');
  for (const s of [{}, { muscleStrength: 0.5 }, { lungCompliance: 0.47 }, { lungCompliance: 2 }, { chestWallLoad: 5 }]) {
    const set = { ...m.DEFAULT_SETTINGS, ...s }, a = m.analyze(set);
    assert.ok(Math.abs(m.systemPressure(a.tlc, set) - m.inspiratoryMusclePressure(a.tlc, set.muscleStrength)) < 1e-6, `TLC on the inspiratory limit ${JSON.stringify(s)}`);
    if (a.rv > a.lungMinimalVolume + 1e-6) assert.ok(Math.abs(m.systemPressure(a.rv, set) + m.expiratoryMusclePressure(a.rv, set.muscleStrength)) < 1e-6, `RV on the expiratory limit ${JSON.stringify(s)}`);
  }
  assert.ok(m.inspiratoryMusclePressure(3) > m.inspiratoryMusclePressure(6), 'inspiratory muscles weaker as the lung fills');
  assert.ok(m.expiratoryMusclePressure(6) > m.expiratoryMusclePressure(1.5), 'expiratory muscles weaker as the lung empties');
});
