// Cardiopulmonary exercise test (ramp cycle ergometer) teaching model.
// Units: VO2 and VCO2 mL/min, VE L/min, HR beats/min, work W, time s, Hb g/dL.
//
// The chain from the PFT lab slides and the course exercise lecture: muscle -> circulation -> lungs.
//  Muscle:      VO2 demand = VO2rest + unloaded pedaling + 10.3 mL/min per W. VO2 follows demand with
//               a time constant (O2 kinetics), so on a fast ramp VO2 lags further behind the work.
//               Once demand passes the VO2 ceiling the extra work is paid for anaerobically; the test ends
//               when that reserve is used up. A faster ramp piles up work faster, so peak work ends higher
//               relative to peak VO2, and VO2 may not yet have caught up (the male physiology professor case).
//  Circulation: Fick. VO2 cannot exceed HRmax * SVmax * CaO2 * maximal extraction. Healthy maximal
//               extraction 60% (mixed venous saturation falls from about 75% to about 40%), SVmax 135 mL,
//               so peak cardiac output is about 24 L/min. HR rises linearly with VO2 up to HRmax.
//  Metabolism:  RER rises gradually as carbohydrate use increases. Above the anaerobic threshold (AT),
//               lactate is buffered by bicarbonate, adding CO2 (isocapnic buffering; the V-slope). Past
//               the respiratory compensation point (RCP), buffering is overwhelmed and PaCO2 falls.
//  Lungs:       VE = 0.863 * VCO2 / (PaCO2 * (1 - VD/VT)). Dead space volume rises with exercise, but
//               tidal volume rises more, so VD/VT falls. MVV = FEV1 * 40; breathing reserve = 1 - VE/MVV.
//               Even in health the A-a gradient widens; gas exchange disease adds desaturation.
// Predicted VO2max for men: weight * (50.72 - 0.372 * age) (Hansen, Sue & Wasserman 1984); HRmax 220 - age.

export const CPET_DEFAULTS = Object.freeze({
  age: 40, weight: 80,
  rampRate: 25,         // W/min
  strokeVolume: 1,      // maximal stroke volume multiplier (healthy SVmax 135 mL)
  heartRateMax: 1,      // maximal heart rate as a fraction of predicted (220 - age)
  fitness: 1,           // muscle oxidative capacity: scales maximal O2 extraction and the AT fraction
  fev1: 3.62,           // L (the PFT page's healthy adult); MVV = FEV1 * 40
  vc: 4.5,              // L; limits tidal volume
  deadSpace: 0.15,      // VD/VT at peak exercise (rest 0.33)
  desaturation: 0,      // fall in SpO2 at peak exercise, percentage points
  hemoglobin: 14.6,
  restingHeartRate: 70,
  effort: 1,            // fraction of the anaerobic reserve the patient is willing to use
});

const K = Object.freeze({
  vo2RestPerKg: 3.5, unloaded: 150, slopeW: 10.3,
  restS: 120, unloadedS: 120, recoveryS: 120, dt: 1, tauOn: 45, tauOff: 60,
  svMax: 0.135, extractionMax: 0.60, atFraction: 0.42, bufferSlope: 0.45, rerRest: 0.83, rerAT: 0.97,
  paco2: 40, paco2Drop: 6, rcpFraction: 0.6, vdRest: 0.33, mvvFactor: 40, saRest: 0.97,
  deficitMaxPerKg: 3.3, // mL O2-equivalent per kg of work done above the VO2 ceiling at full effort
});

function capacities(s) {
  const hrMaxPred = 220 - s.age, hrMax = hrMaxPred * s.heartRateMax;
  const vo2Rest = K.vo2RestPerKg * s.weight;
  const saPeak = K.saRest - s.desaturation / 100;
  const ca = 1.34 * s.hemoglobin * 10 * saPeak;                       // mL O2 per L blood
  const extraction = Math.min(0.8, K.extractionMax * s.fitness);
  const coMax = hrMax * K.svMax * s.strokeVolume;                      // L/min
  const vo2Circ = coMax * ca * extraction;                             // mL/min
  const at = vo2Rest + Math.min(0.7, K.atFraction * s.fitness ** 1.5) * (vo2Circ - vo2Rest);
  return { hrMaxPred, hrMax, vo2Rest, saPeak, ca, extraction, coMax, vo2Circ, at, rcp: at + K.rcpFraction * (vo2Circ - at), mvv: s.fev1 * K.mvvFactor };
}

function physiology(vo2, s, c) {
  const frac = Math.max(0, Math.min(1, (vo2 - c.vo2Rest) / (c.vo2Circ - c.vo2Rest)));
  const toAT = Math.max(0, Math.min(1, (vo2 - c.vo2Rest) / (c.at - c.vo2Rest)));
  const rq = K.rerRest + (K.rerAT - K.rerRest) * toAT;                 // more carbohydrate as intensity rises
  const vco2 = rq * vo2 + K.bufferSlope * Math.max(0, vo2 - c.at);
  const paco2 = K.paco2 - K.paco2Drop * Math.max(0, Math.min(1, (vo2 - c.rcp) / (c.vo2Circ - c.rcp)));
  const vdvt = K.vdRest + (s.deadSpace - K.vdRest) * Math.sqrt(frac);
  const ve = 0.863 * vco2 / (paco2 * (1 - vdvt));                      // L/min BTPS
  const vtMax = 0.6 * s.vc, vtRest = Math.min(0.6, 0.2 * s.vc + 0.1), veRest = 0.863 * K.rerRest * c.vo2Rest / (K.paco2 * (1 - K.vdRest));
  const vt = vtRest + (vtMax - vtRest) * (1 - Math.exp(-Math.max(0, ve - veRest) / 25));
  const hr = s.restingHeartRate + (c.hrMax - s.restingHeartRate) * frac;
  const spo2 = 100 * (K.saRest - (s.desaturation / 100) * frac ** 1.5);
  const co = hr * K.svMax * s.strokeVolume * Math.min(1, 0.65 + 0.35 * Math.sqrt(frac)); // SV rises early in exercise
  return { vo2, vco2, rer: vco2 / vo2, ve, vt, rr: ve / vt, hr, o2pulse: vo2 / hr, spo2, paco2, vdvt, veVo2: ve * 1000 / vo2, veVco2: ve * 1000 / vco2, co };
}

export function predicted(s = CPET_DEFAULTS) {
  const vo2max = s.weight * (50.72 - 0.372 * s.age), hrMax = 220 - s.age;
  return { vo2max, vo2kg: vo2max / s.weight, hrMax, o2pulse: vo2max / hrMax, work: (vo2max - K.vo2RestPerKg * s.weight - K.unloaded) / K.slopeW, mvv: CPET_DEFAULTS.fev1 * K.mvvFactor };
}

export function simulate(settings = {}) {
  const s = { ...CPET_DEFAULTS, ...settings }, c = capacities(s);
  // Ventilatory limit: the VO2 at which VE reaches MVV.
  let lo = c.vo2Rest, hi = c.vo2Circ;
  const ventLimited = physiology(c.vo2Circ, s, c).ve > c.mvv;
  if (ventLimited) for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (physiology(m, s, c).ve < c.mvv) lo = m; else hi = m; }
  const limitVo2 = ventLimited ? lo : c.vo2Circ;
  const deficitMax = K.deficitMaxPerKg * s.weight * s.effort;          // mL O2-equivalent
  const series = [];
  let vo2 = c.vo2Rest, t = 0, phase = 'rest', stopAt = null, deficit = 0, work = 0, peakWork = 0;
  const tRamp = K.restS + K.unloadedS;
  while (t <= 3600) {
    if (t >= K.restS && phase === 'rest') phase = 'unloaded';
    if (t >= tRamp && phase === 'unloaded') phase = 'ramp';
    work = phase === 'ramp' ? s.rampRate * (t - tRamp) / 60 : 0;
    const demand = phase === 'recovery' || phase === 'rest' ? c.vo2Rest : c.vo2Rest + K.unloaded + K.slopeW * work;
    vo2 += (demand - vo2) * (1 - Math.exp(-K.dt / (demand >= vo2 ? K.tauOn : K.tauOff)));
    vo2 = Math.min(vo2, limitVo2);
    if (phase === 'ramp') deficit += Math.max(0, demand - limitVo2) * K.dt / 60; // work above the VO2 ceiling, paid anaerobically
    series.push({ t, phase, work, deficit, ...physiology(vo2, s, c) });
    if (phase === 'ramp' && deficit >= deficitMax) { phase = 'recovery'; stopAt = t; peakWork = work; }
    if (stopAt !== null && t - stopAt >= K.recoveryS) break;
    t += K.dt;
  }
  const peakIdx = series.findIndex(p => p.t === stopAt);
  const avg = (i0, i1, k) => { let sum = 0, n = 0; for (let i = Math.max(0, i0); i <= i1; i++) { sum += series[i][k]; n++; } return sum / n; };
  const keys = ['work', 'vo2', 'vco2', 'rer', 've', 'vt', 'rr', 'hr', 'o2pulse', 'spo2', 'veVo2', 'veVco2'];
  const pick = (i0, i1) => Object.fromEntries(keys.map(k => [k, avg(i0, i1, k)]));
  const rest = pick(K.restS - 31, K.restS - 1);
  const peak = pick(peakIdx - 20, peakIdx); peak.work = peakWork;
  const atIdx = series.findIndex(p => p.phase === 'ramp' && p.vo2 >= c.at);
  const rcpIdx = series.findIndex(p => p.phase === 'ramp' && p.vo2 >= c.rcp);
  const atRow = atIdx > 0 && atIdx < peakIdx ? pick(atIdx - 5, atIdx + 5) : null;
  const pred = predicted(s);
  for (const r of [rest, peak, atRow]) if (r) Object.assign(r, { vo2kg: r.vo2 / s.weight, mets: r.vo2 / (K.vo2RestPerKg * s.weight) });
  return {
    settings: s, capacities: { ...c, limitVo2 }, limitedBy: ventLimited ? 'ventilatory' : 'circulatory', series, stopAt, rampStart: tRamp,
    atTime: atRow ? series[atIdx].t : null, rcpTime: rcpIdx > 0 && rcpIdx < peakIdx ? series[rcpIdx].t : null,
    rest, at: atRow, peak, predicted: pred,
    summary: {
      vo2PeakPct: 100 * peak.vo2 / pred.vo2max, workPct: 100 * peak.work / pred.work, atPctPred: atRow ? 100 * atRow.vo2 / pred.vo2max : null,
      hrPeakPct: 100 * peak.hr / pred.hrMax, heartRateReserve: pred.hrMax - peak.hr,
      breathingReserve: 100 * (1 - peak.ve / c.mvv), mvv: c.mvv, o2pulsePct: 100 * peak.o2pulse / pred.o2pulse,
      spo2Drop: rest.spo2 - peak.spo2, veVco2AtAT: atRow ? atRow.veVco2 : peak.veVco2, rerPeak: peak.rer,
      coMax: c.coMax, svo2Peak: 100 * c.saPeak * (1 - c.extraction),
    },
  };
}

const preset = (label, o, extra = {}) => ({ label, settings: { ...CPET_DEFAULTS, ...o }, ...extra });
export const CPET_PRESETS = {
  normal: preset('Healthy 40-year-old man', {}),
  professor: preset('Male physiology professor', { age: 44, weight: 82, rampRate: 34, strokeVolume: 0.757, fitness: 1.05, fev1: 3.95, vc: 4.9, effort: 1.2 },
    { actual: { rest: { vo2: 395, vco2: 356, rer: 0.90, ve: 11.2, vt: 0.87, rr: 13, veVo2: 28, veVco2: 31 }, at: { work: 87, vo2: 1126, vco2: 1121, rer: 1.00, ve: 30.3, vt: 1.77, rr: 17, veVo2: 27, veVco2: 27 }, peak: { work: 214, vo2: 2126, vco2: 3080, rer: 1.45, ve: 100.8, vt: 2.41, rr: 42, veVo2: 47, veVco2: 33 }, pred: { vo2: 2805, work: 216, ve: 158, hr: 176 } } }),
  athlete: preset('Endurance athlete', { strokeVolume: 1.4, fitness: 1.08, restingHeartRate: 50, fev1: 4.4, vc: 5.4, desaturation: 3 }),
  deconditioned: preset('Deconditioned (sedentary, otherwise healthy)', { strokeVolume: 0.85, fitness: 0.8, restingHeartRate: 85 }),
  heartFailure: preset('Heart failure with reduced ejection fraction', { strokeVolume: 0.5, heartRateMax: 0.9, fitness: 0.85, deadSpace: 0.44, restingHeartRate: 80 }),
  copd: preset('COPD (FEV1 1.3 L)', { fev1: 1.3, vc: 3.4, deadSpace: 0.35, desaturation: 3, strokeVolume: 0.9, fitness: 0.85 }),
  copdHf: preset('COPD and heart failure (transplant evaluation)', { fev1: 1.3, vc: 3.4, deadSpace: 0.44, desaturation: 3, strokeVolume: 0.45, heartRateMax: 0.9, fitness: 0.85, restingHeartRate: 80 }),
  ild: preset('Interstitial lung disease', { fev1: 2.4, vc: 2.6, deadSpace: 0.36, desaturation: 10, fitness: 0.9 }),
  pulmVascular: preset('Pulmonary vascular disease (e.g., pulmonary hypertension)', { strokeVolume: 0.6, deadSpace: 0.5, desaturation: 7, fitness: 0.9 }),
  anemia: preset('Anemia (Hb 9 g/dL)', { hemoglobin: 9 }),
};

// Simple stepwise CPET interpretation (teaching thresholds; Milani et al. 2006, the PFT lab, the course materials).
export function interpretCPET(r) {
  const s = r.summary, steps = [];
  const maximal = s.rerPeak >= 1.10, ventLimit = s.breathingReserve < 15;
  const fastRampArtifact = s.vo2PeakPct < 80 && s.workPct >= 90;  // work outran VO2 (O2 kinetics)
  const lowVO2 = s.vo2PeakPct < 80 && !fastRampArtifact;
  const desat = s.spo2Drop >= 4, inefficient = s.veVco2AtAT > 34, lowO2pulse = s.o2pulsePct < 80;
  steps.push({ q: 'Was it a maximal effort? (peak RER at least 1.10)', a: `Peak RER ${s.rerPeak.toFixed(2)}: ${maximal ? 'yes.' : ventLimit ? 'below 1.10, which is common when breathing, not the heart, stops exercise before much lactate builds up.' : 'no; the patient may have stopped early, so interpret the peak values with caution.'}` });
  steps.push({ q: 'Is peak VO2 (VO2max) reduced? (below 80% predicted)', a: `Peak VO2 ${Math.round(r.peak.vo2)} mL/min, ${Math.round(s.vo2PeakPct)}% of predicted; peak work ${Math.round(r.peak.work)} W, ${Math.round(s.workPct)}% of predicted. ${fastRampArtifact ? `Peak VO2 reads low, but work is near predicted: on a fast ramp (${r.settings.rampRate} W/min) VO2 lags behind the work (O2 kinetics) and the rest is paid for anaerobically, so this is not a true reduction.` : lowVO2 ? 'Yes.' : s.vo2PeakPct > 120 ? 'No; it is high.' : 'No.'}${s.atPctPred ? ` The anaerobic threshold is at ${Math.round(s.atPctPred)}% of predicted VO2max: ${s.atPctPred < 39.5 ? 'low (normal is about 40% or more; ATS/ACCP 2003).' : s.atPctPred < 45 ? 'at the lower limit of normal (about 40% or more).' : 'normal (about 40% or more).'}` : ''}` });
  steps.push({ q: 'Did ventilation run out? (breathing reserve below 15%)', a: `Peak VE ${r.peak.ve.toFixed(0)} L/min of an MVV of ${s.mvv.toFixed(0)} L/min: breathing reserve ${Math.round(s.breathingReserve)}%. ${ventLimit ? 'Yes, the patient reached the ventilatory ceiling.' : 'No, ventilation was left over.'}` });
  steps.push({ q: 'Did the heart reach its maximum? (peak HR at least 85% predicted)', a: `Peak HR ${Math.round(r.peak.hr)}, ${Math.round(s.hrPeakPct)}% of predicted (heart rate reserve ${Math.round(s.heartRateReserve)}/min). O2 pulse ${r.peak.o2pulse.toFixed(1)} mL/beat, ${Math.round(s.o2pulsePct)}% of predicted.` });
  steps.push({ q: 'Is gas exchange abnormal? (SpO2 falls 4 or more points; VE/VCO2 above 34)', a: `SpO2 fell ${s.spo2Drop.toFixed(0)} points; VE/VCO2 at AT ${s.veVco2AtAT.toFixed(0)}. ${desat || inefficient ? [desat ? 'Exercise desaturation' : '', inefficient ? 'high VE/VCO2 (wasted ventilation: dead space)' : ''].filter(Boolean).join(' and ') + '.' : s.spo2Drop >= 1.5 ? 'A small fall, as can happen in health (the A-a gradient widens with exercise).' : 'No.'}` });
  let pattern, consistent;
  if (ventLimit && s.o2pulsePct < 50 && inefficient) {
    pattern = 'Both heart and lungs at their limits';
    consistent = 'Breathing reserve is nearly gone and the O2 pulse is very low, with high VE/VCO2: the lungs and the heart reach their ceilings at about the same workload. A new heart alone would not raise exercise capacity much, because the lungs would stop the test soon after.';
  } else if (ventLimit) {
    pattern = 'Ventilatory limitation';
    consistent = desat && r.peak.rr > 45
      ? 'The patient ran out of ventilation, breathing fast and shallow, and desaturated: the pattern of interstitial lung disease (stiff, small lungs and a thickened membrane).'
      : 'The patient ran out of ventilation with heart rate to spare (large heart rate reserve): the pattern of obstructive lung disease such as COPD. Flow limitation caps how much air can move each minute.';
  } else if (!lowVO2) {
    pattern = s.vo2PeakPct > 120 ? 'Normal, high fitness' : 'Normal exercise capacity';
    consistent = 'Breathing reserve was left over and the heart and circulation set the ceiling. That is normal: healthy people are limited by cardiac output (O2 delivery), not by their lungs.' + (s.vo2PeakPct > 120 ? ' The large O2 pulse reflects a big stroke volume from training.' : '') + (fastRampArtifact ? ' Peak VO2 is below 80% only because the fast ramp let work outrun VO2.' : '');
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
