// Cardiopulmonary exercise test (ramp cycle ergometer) teaching model.
// Units: VO2 and VCO2 mL/min, VE L/min, HR beats/min, work W, time s, Hb g/dL.
//
// The chain from the PFT lab slides: muscle -> circulation -> lungs.
//  Muscle:      VO2 demand = VO2rest + unloaded pedaling + 10.3 mL/min per W; VO2 follows demand with
//               a time constant (O2 kinetics).
//  Circulation: Fick. VO2 cannot exceed HRmax * SVmax * CaO2 * maximal extraction.
//               HR rises linearly with VO2 from rest to HRmax at the circulatory limit.
//  Metabolism:  Above the anaerobic threshold (AT), lactate is buffered by bicarbonate, adding CO2, so
//               VCO2 rises faster than VO2 (the V-slope). Past the respiratory compensation point,
//               PaCO2 falls to buffer the acidosis.
//  Lungs:       Alveolar ventilation equation: VE = 0.863 * VCO2 / (PaCO2 * (1 - VD/VT)).
//               Maximal ventilation is MVV = FEV1 * 40. Breathing reserve = 1 - VEpeak/MVV.
//               Gas exchange disease adds exercise desaturation, which lowers CaO2.
// The test stops at whichever limit is reached first: circulatory (the normal case) or ventilatory.
// Predicted VO2max for men: weight * (50.72 - 0.372 * age) (Hansen, Sue & Wasserman 1984).

export const SUBJECT = Object.freeze({ age: 40, weight: 80, sex: 'male' });

export const CPET_DEFAULTS = Object.freeze({
  strokeVolume: 1,      // maximal stroke volume multiplier (normal SVmax 110 mL)
  heartRateMax: 1,      // maximal heart rate as a fraction of predicted (220 - age)
  fitness: 1,           // muscle oxidative capacity: scales maximal O2 extraction and the AT fraction
  fev1: 3.62,           // L (the PFT page's healthy adult); MVV = FEV1 * 40
  vc: 4.5,              // L; limits tidal volume
  deadSpace: 0.15,      // VD/VT at peak exercise (rest 0.33)
  desaturation: 0,      // fall in SpO2 at peak exercise, percentage points
  hemoglobin: 14.6,
  restingHeartRate: 70,
  effort: 1,            // fraction of the limit the patient reaches before stopping
});

const K = Object.freeze({
  vo2RestPerKg: 3.5, unloaded: 150, slopeW: 10.3, rampWperMin: 25,
  restS: 120, unloadedS: 120, recoveryS: 120, dt: 1, tauOn: 45, tauOff: 60,
  svMax: 0.110, extractionMax: 0.76, atFraction: 0.5, bufferSlope: 0.75, rerRest: 0.83,
  paco2: 40, paco2Drop: 6, rcpFraction: 0.6, vdRest: 0.33, mvvFactor: 40, saRest: 0.97,
});

function capacities(s) {
  const hrMaxPred = 220 - SUBJECT.age, hrMax = hrMaxPred * s.heartRateMax;
  const vo2Rest = K.vo2RestPerKg * SUBJECT.weight;
  const saPeak = K.saRest - s.desaturation / 100;
  const ca = 1.34 * s.hemoglobin * 10 * saPeak;                       // mL O2 per L blood
  const extraction = Math.min(0.9, K.extractionMax * s.fitness);
  const vo2Circ = hrMax * K.svMax * s.strokeVolume * ca * extraction;  // mL/min
  const at = vo2Rest + Math.min(0.75, K.atFraction * s.fitness ** 1.5) * (vo2Circ - vo2Rest);
  return { hrMaxPred, hrMax, vo2Rest, saPeak, vo2Circ, at, rcp: at + K.rcpFraction * (vo2Circ - at), mvv: s.fev1 * K.mvvFactor };
}

function physiology(vo2, s, c) {
  const frac = Math.max(0, Math.min(1, (vo2 - c.vo2Rest) / (c.vo2Circ - c.vo2Rest)));
  const vco2 = K.rerRest * vo2 + K.bufferSlope * Math.max(0, vo2 - c.at);
  const paco2 = K.paco2 - K.paco2Drop * Math.max(0, Math.min(1, (vo2 - c.rcp) / (c.vo2Circ - c.rcp)));
  const vdvt = K.vdRest + (s.deadSpace - K.vdRest) * Math.sqrt(frac);
  const veL = 0.863 * vco2 / (paco2 * (1 - vdvt)); // L/min, since 0.863 converts mL/min STPD and mmHg to L/min BTPS
  const vtMax = 0.6 * s.vc, vtRest = Math.min(0.6, 0.2 * s.vc + 0.1), veRest = 0.863 * K.rerRest * c.vo2Rest / (K.paco2 * (1 - K.vdRest));
  const vt = vtRest + (vtMax - vtRest) * (1 - Math.exp(-Math.max(0, veL - veRest) / 25));
  const hr = s.restingHeartRate + (c.hrMax - s.restingHeartRate) * frac;
  const spo2 = 100 * (K.saRest - (s.desaturation / 100) * frac ** 1.5);
  return { vo2, vco2, rer: vco2 / vo2, ve: veL, vt, rr: veL / vt, hr, o2pulse: vo2 / hr, spo2, paco2, vdvt, veVo2: veL * 1000 / vo2, veVco2: veL * 1000 / vco2 };
}

export function simulate(settings = {}) {
  const s = { ...CPET_DEFAULTS, ...settings }, c = capacities(s);
  // Ventilatory limit: the VO2 at which VE reaches MVV.
  let lo = c.vo2Rest, hi = c.vo2Circ;
  if (physiology(hi, s, c).ve > c.mvv) { for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (physiology(m, s, c).ve < c.mvv) lo = m; else hi = m; } }
  const vo2Vent = physiology(c.vo2Circ, s, c).ve > c.mvv ? lo : Infinity;
  const limitVo2 = Math.min(c.vo2Circ, vo2Vent);
  const limitedBy = vo2Vent < c.vo2Circ ? 'ventilatory' : 'circulatory';
  const stopVo2 = c.vo2Rest + s.effort * (limitVo2 - c.vo2Rest);
  const series = [];
  let vo2 = c.vo2Rest, t = 0, phase = 'rest', stopAt = null, work = 0;
  const tRamp = K.restS + K.unloadedS;
  while (true) {
    if (t >= K.restS && phase === 'rest') phase = 'unloaded';
    if (t >= tRamp && phase === 'unloaded') phase = 'ramp';
    work = phase === 'ramp' ? K.rampWperMin * (t - tRamp) / 60 : 0;
    let demand = c.vo2Rest + (phase === 'rest' || phase === 'recovery' ? 0 : K.unloaded) + K.slopeW * work;
    if (phase === 'recovery') { demand = c.vo2Rest; work = 0; }
    const tau = demand >= vo2 ? K.tauOn : K.tauOff;
    vo2 += (demand - vo2) * (1 - Math.exp(-K.dt / tau));
    vo2 = Math.min(vo2, limitVo2);
    const p = physiology(vo2, s, c);
    series.push({ t, phase, work, ...p });
    if (phase === 'ramp' && vo2 >= stopVo2 - 1) { phase = 'recovery'; stopAt = t; }
    if (stopAt !== null && t - stopAt >= K.recoveryS) break;
    if (t > 3600) break;
    t += K.dt;
  }
  const peakIdx = series.findIndex(p => p.t === stopAt);
  const avg = (i0, i1, k) => { let sum = 0, n = 0; for (let i = Math.max(0, i0); i <= i1; i++) { sum += series[i][k]; n++; } return sum / n; };
  const pick = (i0, i1) => Object.fromEntries(['work', 'vo2', 'vco2', 'rer', 've', 'vt', 'rr', 'hr', 'o2pulse', 'spo2', 'veVo2', 'veVco2'].map(k => [k, avg(i0, i1, k)]));
  const restIdx = K.restS - 1, rest = pick(restIdx - 30, restIdx);
  const peak = pick(peakIdx - 20, peakIdx); peak.work = series[peakIdx].work;
  const atIdx = series.findIndex(p => p.phase === 'ramp' && p.vo2 >= c.at);
  const atRow = atIdx > 0 && atIdx < peakIdx ? pick(atIdx - 5, atIdx + 5) : null;
  const pred = predicted();
  const add = r => r && Object.assign(r, { vo2kg: r.vo2 / SUBJECT.weight, mets: r.vo2 / (K.vo2RestPerKg * SUBJECT.weight) });
  [rest, peak, atRow].forEach(add);
  return {
    settings: s, capacities: { ...c, vo2Vent, limitVo2 }, limitedBy, series, stopAt, rampStart: tRamp,
    rest, at: atRow, peak, predicted: pred,
    summary: {
      vo2PeakPct: 100 * peak.vo2 / pred.vo2max, atPctPred: atRow ? 100 * atRow.vo2 / pred.vo2max : null,
      hrPeakPct: 100 * peak.hr / pred.hrMax, heartRateReserve: pred.hrMax - peak.hr,
      breathingReserve: 100 * (1 - peak.ve / c.mvv), mvv: c.mvv, o2pulsePct: 100 * peak.o2pulse / pred.o2pulse,
      spo2Drop: rest.spo2 - peak.spo2, veVco2AtAT: atRow ? atRow.veVco2 : peak.veVco2, rerPeak: peak.rer,
    },
  };
}

export function predicted() {
  const vo2max = SUBJECT.weight * (50.72 - 0.372 * SUBJECT.age), hrMax = 220 - SUBJECT.age;
  return { vo2max, vo2kg: vo2max / SUBJECT.weight, hrMax, o2pulse: vo2max / hrMax, work: (vo2max - K.vo2RestPerKg * SUBJECT.weight - K.unloaded) / K.slopeW, mvv: CPET_DEFAULTS.fev1 * K.mvvFactor };
}

const preset = (label, o) => ({ label, settings: { ...CPET_DEFAULTS, ...o } });
export const CPET_PRESETS = {
  normal: preset('Healthy 40-year-old man', {}),
  athlete: preset('Endurance athlete', { strokeVolume: 1.4, fitness: 1.08, restingHeartRate: 50, fev1: 4.4, vc: 5.4 }),
  deconditioned: preset('Deconditioned (sedentary, otherwise healthy)', { strokeVolume: 0.85, fitness: 0.8, restingHeartRate: 85 }),
  heartFailure: preset('Heart failure with reduced ejection fraction', { strokeVolume: 0.5, heartRateMax: 0.9, fitness: 0.85, deadSpace: 0.44, restingHeartRate: 80 }),
  copd: preset('COPD (FEV1 1.3 L)', { fev1: 1.3, vc: 3.4, deadSpace: 0.38, desaturation: 3, strokeVolume: 0.9, fitness: 0.85 }),
  ild: preset('Interstitial lung disease', { fev1: 2.4, vc: 2.6, deadSpace: 0.36, desaturation: 10, fitness: 0.9 }),
  pulmVascular: preset('Pulmonary vascular disease (e.g., pulmonary hypertension)', { strokeVolume: 0.6, deadSpace: 0.5, desaturation: 7, fitness: 0.9 }),
  anemia: preset('Anemia (Hb 9 g/dL)', { hemoglobin: 9 }),
};

// Simple stepwise CPET interpretation (teaching thresholds; Milani et al. 2006 and the PFT lab).
export function interpretCPET(r) {
  const s = r.summary, steps = [];
  const maximal = s.rerPeak >= 1.10, lowVO2 = s.vo2PeakPct < 80, ventLimit = s.breathingReserve < 15;
  const cardiacReached = s.hrPeakPct >= 85, desat = s.spo2Drop >= 4, inefficient = s.veVco2AtAT > 34, lowO2pulse = s.o2pulsePct < 80;
  steps.push({ q: 'Was it a maximal effort? (peak RER at least 1.10)', a: `Peak RER ${s.rerPeak.toFixed(2)}: ${maximal ? 'yes.' : ventLimit ? 'below 1.10, which is common when breathing, not the heart, stops exercise before much lactate builds up.' : 'no; the patient may have stopped early, so interpret the peak values with caution.'}` });
  steps.push({ q: 'Is peak VO2 reduced? (below 80% predicted)', a: `Peak VO2 ${Math.round(r.peak.vo2)} mL/min, ${Math.round(s.vo2PeakPct)}% of predicted: ${lowVO2 ? 'yes.' : s.vo2PeakPct > 120 ? 'no; it is high.' : 'no.'}${s.atPctPred ? ` The anaerobic threshold is at ${Math.round(s.atPctPred)}% of predicted VO2max (low if below about 40%).` : ''}` });
  steps.push({ q: 'Did ventilation run out? (breathing reserve below 15%)', a: `Peak VE ${r.peak.ve.toFixed(0)} L/min of an MVV of ${s.mvv.toFixed(0)} L/min: breathing reserve ${Math.round(s.breathingReserve)}%. ${ventLimit ? 'Yes, the patient reached the ventilatory ceiling.' : 'No, ventilation was left over.'}` });
  steps.push({ q: 'Did the heart reach its maximum? (peak HR at least 85% predicted)', a: `Peak HR ${Math.round(r.peak.hr)}, ${Math.round(s.hrPeakPct)}% of predicted (heart rate reserve ${Math.round(s.heartRateReserve)}/min). O2 pulse ${r.peak.o2pulse.toFixed(1)} mL/beat, ${Math.round(s.o2pulsePct)}% of predicted.` });
  steps.push({ q: 'Is gas exchange abnormal? (SpO2 falls 4 or more points; VE/VCO2 above 34)', a: `SpO2 fell ${s.spo2Drop.toFixed(0)} points; VE/VCO2 at AT ${s.veVco2AtAT.toFixed(0)}. ${desat || inefficient ? [desat ? 'Exercise desaturation' : '', inefficient ? 'high VE/VCO2 (wasted ventilation: dead space)' : ''].filter(Boolean).join(' and ') + '.' : 'No.'}` });
  let pattern, consistent;
  if (ventLimit) {
    pattern = 'Ventilatory limitation';
    consistent = desat && r.peak.rr > 45
      ? 'The patient ran out of ventilation, breathing fast and shallow, and desaturated: the pattern of interstitial lung disease (stiff, small lungs and a thickened membrane).'
      : 'The patient ran out of ventilation with heart rate to spare (large heart rate reserve): the pattern of obstructive lung disease such as COPD. Flow limitation caps how much air can move each minute.';
  } else if (!lowVO2) {
    pattern = s.vo2PeakPct > 120 ? 'Normal, high fitness' : 'Normal exercise capacity';
    consistent = 'The heart reached its maximum with breathing reserve left over. That is normal: healthy people are limited by cardiac output (O2 delivery), not by their lungs.' + (s.vo2PeakPct > 120 ? ' The large O2 pulse reflects a big stroke volume from training.' : '');
  } else if (desat && inefficient) {
    pattern = 'Circulatory limitation with abnormal gas exchange';
    consistent = 'Low peak VO2 and O2 pulse, desaturation, and high VE/VCO2 with breathing reserve left over: the pattern of pulmonary vascular disease. Blood flow through the lungs cannot rise, so dead space and right heart output limit exercise.';
  } else if (inefficient && lowO2pulse) {
    pattern = 'Circulatory (cardiac) limitation';
    consistent = 'Low peak VO2, an early anaerobic threshold, a low O2 pulse (stroke volume cannot rise), and high VE/VCO2 without desaturation: the pattern of heart failure.';
  } else if (r.settings.hemoglobin < 12) {
    pattern = 'Circulatory limitation: low O2 content';
    consistent = 'Heart rate reached its maximum early with a low O2 pulse but normal lungs: each beat carries less O2 because hemoglobin is low (anemia).';
  } else {
    pattern = 'Circulatory limitation';
    consistent = 'Low peak VO2 and an early anaerobic threshold, but the heart reaches its maximum, breathing reserve is normal, and gas exchange is normal: the pattern of deconditioning (or early heart disease). Training raises stroke volume and muscle O2 extraction.';
  }
  return { steps, pattern, consistent, maximal };
}
