import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, probe, PRESETS, DEFAULT_SETTINGS } from '../dist/model.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('healthy baseline matches teaching values', () => {
  const a = analyze(DEFAULT_SETTINGS);
  near(a.frc, 3.0, 0.02, 'FRC'); near(a.tlc, 6.0, 1e-3, 'TLC'); near(a.rv, 1.5, 1e-3, 'RV');
  near(a.lungRecoilAtFrc, -a.chestWallRecoilAtFrc, 1e-6, 'recoils balance at FRC');
  near(a.systemCompliance, 0.136, 0.01, 'Crs');
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
