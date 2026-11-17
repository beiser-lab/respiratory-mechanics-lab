// Cardiopulmonary exercise test (ramp cycle ergometer) teaching model.
// Units: VO2 and VCO2 mL/min, VE L/min, HR beats/min, work W, time s, Hb g/dL.
//
// The chain from the course PFT lab slides and exercise lecture: muscle -> circulation -> lungs.
//  Muscle:      VO2 demand = VO2rest + unloaded pedaling + 10.3 mL/min per W. VO2 follows demand with
//               a time constant (O2 kinetics), so on a fast ramp VO2 lags further behind the work.
//               Once demand passes the VO2 ceiling the extra work is paid for anaerobically; the test ends
//               when that reserve is used up. A faster ramp piles up work faster, so peak work ends higher
//               relative to peak VO2, and VO2 may not yet have caught up.
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
  effort: 1,            // 1 = maximal. Below 1 the patient stops at that fraction of the way from rest to the
                        // VO2 ceiling (poor effort); above 1, a larger anaerobic reserve
});

const K = Object.freeze({
  vo2RestPerKg: 3.5, unloaded: 150, slopeW: 10.3,
  restS: 120, unloadedS: 120, recoveryS: 120, dt: 1, tauOn: 45, tauOff: 60,
  svMax: 0.135, extractionMax: 0.60, atFraction: 0.55, atTrainSlope: 1.5, bufferSlope: 0.6, rerRest: 0.83, rerAT: 0.97,
  paco2: 40, paco2Drop: 4, rcpFraction: 0.6, vdRest: 0.33, mvvFactor: 40, saRest: 0.97,
  deficitMaxPerKg: 3.3, // mL O2-equivalent per kg of work done above the VO2 ceiling at full effort
  ventDeficitFraction: 0.3, // breathless patients stop soon after VE reaches MVV, before much lactate builds up
});

function capacities(s) {
  const hrMaxPred = 220 - s.age, hrMax = hrMaxPred * s.heartRateMax;
  const vo2Rest = K.vo2RestPerKg * s.weight;
  const saPeak = K.saRest - s.desaturation / 100;
  const ca = 1.34 * s.hemoglobin * 10 * saPeak;                       // mL O2 per L blood
  const extraction = Math.min(0.8, K.extractionMax * s.fitness);
  const coMax = hrMax * K.svMax * s.strokeVolume;                      // L/min
  const vo2Circ = coMax * ca * extraction;                             // mL/min
  // AT sits about 55% of the way from rest to the ceiling in untrained people and moves up with training
  // (to about 75% in endurance athletes); it does not fall below that in the unfit.
  const at = vo2Rest + Math.min(0.8, K.atFraction + K.atTrainSlope * Math.max(0, s.fitness - 1)) * (vo2Circ - vo2Rest);
  return { hrMaxPred, hrMax, vo2Rest, saPeak, ca, extraction, coMax, vo2Circ, at, rcp: at + K.rcpFraction * (vo2Circ - at), mvv: s.fev1 * K.mvvFactor };
}

function physiology(vo2, s, c) {
  const frac = Math.max(0, Math.min(1, (vo2 - c.vo2Rest) / (c.vo2Circ - c.vo2Rest)));
  const toAT = Math.max(0, Math.min(1, (vo2 - c.vo2Rest) / (c.at - c.vo2Rest)));
  const rq = K.rerRest + (K.rerAT - K.rerRest) * toAT;                 // more carbohydrate as intensity rises
  const vco2 = rq * vo2 + K.bufferSlope * Math.max(0, vo2 - c.at);
  const paco2 = K.paco2 - K.paco2Drop * Math.max(0, Math.min(1, (vo2 - c.rcp) / (c.vo2Circ - c.rcp)));
  const vdRest = Math.max(K.vdRest, s.deadSpace + 0.08); // diseased lungs start with more dead space
  const vdvt = vdRest + (s.deadSpace - vdRest) * Math.sqrt(frac);
  const ve = 0.863 * vco2 / (paco2 * (1 - vdvt));                      // L/min BTPS
  const vtMax = 0.6 * s.vc, vtRest = Math.min(0.6, 0.2 * s.vc + 0.1), veRest = 0.863 * K.rerRest * c.vo2Rest / (K.paco2 * (1 - vdRest));
  const vt = vtRest + (vtMax - vtRest) * (1 - Math.exp(-Math.max(0, ve - veRest) / 25));
  const hr = s.restingHeartRate + (c.hrMax - s.restingHeartRate) * frac;
  const lim = c.limitVo2 ?? c.vo2Circ, fracLim = Math.max(0, Math.min(1, (vo2 - c.vo2Rest) / (lim - c.vo2Rest)));
  const spo2 = 100 * (K.saRest - (s.desaturation / 100) * fracLim ** 1.5);
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
  // Floor: every patient can at least pedal unloaded (very extreme sliders otherwise give a ceiling below rest).
  const limitVo2 = Math.max(ventLimited ? lo : c.vo2Circ, c.vo2Rest + K.unloaded + 50);
  c.limitVo2 = limitVo2;
  const fullEffort = s.effort >= 1;
  const deficitMax = fullEffort ? K.deficitMaxPerKg * s.weight * s.effort * (ventLimited ? K.ventDeficitFraction : 1) : 0;
  const stopVo2 = fullEffort ? Infinity : c.vo2Rest + Math.max(0.2, s.effort) * (limitVo2 - c.vo2Rest); // poor effort
  const series = [];
  let vo2 = c.vo2Rest, t = 0, phase = 'rest', stopAt = null, deficit = 0, work = 0, peakWork = 0;
  const tRamp = K.restS + K.unloadedS;
  while (t <= 4 * 3600) { // long enough for the slowest ramp with the largest ceiling
    if (t >= K.restS && phase === 'rest') phase = 'unloaded';
    if (t >= tRamp && phase === 'unloaded') phase = 'ramp';
    work = phase === 'ramp' ? s.rampRate * (t - tRamp) / 60 : 0;
    const demand = phase === 'recovery' || phase === 'rest' ? c.vo2Rest : c.vo2Rest + K.unloaded + K.slopeW * work;
    vo2 += (demand - vo2) * (1 - Math.exp(-K.dt / (demand >= vo2 ? K.tauOn : K.tauOff)));
    vo2 = Math.min(vo2, limitVo2);
    if (phase === 'ramp') deficit += Math.max(0, demand - limitVo2) * K.dt / 60; // work above the VO2 ceiling, paid anaerobically
    series.push({ t, phase, work, deficit, ...physiology(vo2, s, c) });
    if (phase === 'ramp' && (fullEffort ? deficit >= deficitMax && demand > limitVo2 : vo2 >= stopVo2)) { phase = 'recovery'; stopAt = t; peakWork = work; }
    if (stopAt !== null && t - stopAt >= K.recoveryS) break;
    t += K.dt;
  }
  if (stopAt === null) { stopAt = series[series.length - 1].t; peakWork = series[series.length - 1].work; } // safety net
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
      hrPeakPct: 100 * peak.hr / pred.hrMax, heartRateReserve: pred.hrMax - peak.hr, heartRateReservePct: 100 * (pred.hrMax - peak.hr) / pred.hrMax,
      rampMinutes: (stopAt - tRamp) / 60, atPctOwn: atRow ? 100 * atRow.vo2 / peak.vo2 : null, caRest: 1.34 * s.hemoglobin * K.saRest, caPeak: c.ca / 10, tooWeak: c.vo2Circ < c.vo2Rest + K.unloaded + 50, hemoglobin: s.hemoglobin,
      breathingReserve: 100 * (1 - peak.ve / c.mvv), mvv: c.mvv, o2pulsePct: 100 * peak.o2pulse / pred.o2pulse,
      spo2Drop: rest.spo2 - peak.spo2, veVco2AtAT: atRow ? atRow.veVco2 : peak.veVco2, rerPeak: peak.rer,
      coMax: c.coMax, svo2Peak: 100 * c.saPeak * (1 - c.extraction),
    },
  };
}

const preset = (label, o, extra = {}) => ({ label, settings: { ...CPET_DEFAULTS, ...o }, ...extra });
// Each patient gets a ramp rate that makes the ramp last about 8 to 12 minutes, as labs choose it.
export const CPET_PRESETS = {
  normal: preset('Healthy 40-year-old man', {}),
  athlete: preset('Trained endurance athlete', { rampRate: 35, strokeVolume: 1.4, fitness: 1.08, restingHeartRate: 50, fev1: 4.4, vc: 5.4, desaturation: 3 }),
  poorEffort: preset('Healthy man who stops early (submaximal effort)', { effort: 0.65 }),
  deconditioned: preset('Deconditioned (sedentary, otherwise healthy)', { rampRate: 18, strokeVolume: 0.9, fitness: 0.8, restingHeartRate: 85 }),
  heartFailure: preset('Heart failure with reduced ejection fraction', { rampRate: 8, strokeVolume: 0.5, heartRateMax: 0.78, fitness: 0.85, deadSpace: 0.44, restingHeartRate: 80 }),
  copd: preset('COPD (FEV1 1.3 L)', { rampRate: 10, fev1: 1.3, vc: 3.4, deadSpace: 0.35, desaturation: 3, strokeVolume: 0.9, fitness: 0.85 }),
  copdHf: preset('COPD and heart failure (transplant evaluation)', { rampRate: 8, fev1: 1.3, vc: 3.4, deadSpace: 0.44, desaturation: 3, strokeVolume: 0.45, heartRateMax: 0.9, fitness: 0.85, restingHeartRate: 80 }),
  ild: preset('Interstitial lung disease', { rampRate: 18, fev1: 2.4, vc: 2.6, deadSpace: 0.38, desaturation: 10, fitness: 0.9 }),
  pulmVascular: preset('Pulmonary vascular disease (beyond the course)', { rampRate: 12, strokeVolume: 0.6, deadSpace: 0.5, desaturation: 7, fitness: 0.9 }),
  anemia: preset('Anemia (Hb 9 g/dL)', { rampRate: 18, hemoglobin: 9 }),
};

// Stepwise CPET interpretation. Cutoffs from the course reading (Milani et al. 2006, Mayo Clin Proc,
// pp 1605-1607 and Figure 3): VO2max below 85% predicted is reduced; respiratory (breathing) reserve
// below 30% is ventilatory impairment, 20-30% borderline; peak HR at or below 85% predicted is submaximal
// for the heart; R below 1.10 suggests poor effort; AT below 40% of predicted VO2max is low; VE/VCO2 above
// 34 (ATS/ACCP 2003). Each pattern is named only after heart rate and gas exchange have been checked.
export const CUTOFFS = Object.freeze({ vo2: 85, reserve: 30, reserveBorder: 20, hr: 85, r: 1.10, at: 40, veVco2: 34, spo2Drop: 4, o2pulse: 80, hb: 13 });
export function interpretCPET(r) {
  const s = r.summary, C = CUTOFFS, steps = [], f0 = x => Math.round(x);
  const maximalR = s.rerPeak >= C.r, lowVO2 = f0(s.vo2PeakPct) < C.vo2, heartMax = f0(s.hrPeakPct) > C.hr;
  const reserve = f0(s.breathingReserve), respLimited = reserve < C.reserve, respBorder = reserve >= C.reserveBorder && reserve < C.reserve;
  const lowAT = s.atPctPred != null && f0(s.atPctPred) < C.at;
  const desat = f0(s.spo2Drop) >= C.spo2Drop, inefficient = f0(s.veVco2AtAT) > C.veVco2, lowO2pulse = f0(s.o2pulsePct) < C.o2pulse, lowHb = s.hemoglobin < C.hb;
  const poorEffort = !maximalR && !heartMax && !respLimited;

  steps.push({ q: `Was it a maximal effort? (peak R, the respiratory exchange ratio, ${C.r.toFixed(2)} or more)`, a: `Peak R ${s.rerPeak.toFixed(2)}: ${maximalR ? 'yes.' : respLimited ? 'no, but that is expected here: breathlessness stopped the test before much lactate built up (see step 4).' : heartMax ? 'no, although heart rate reached its maximum (step 5); read the peak values with some caution.' : 'no. Check steps 4 and 5: with heart rate and respiratory reserve also left over, the patient probably stopped early, and the peak values may understate what the heart and lungs can do.'}` });
  steps.push({ q: `Is VO2max (peak VO2) reduced? (below ${C.vo2}% of predicted)`, a: `Peak VO2 ${f0(r.peak.vo2)} mL/min (${r.peak.vo2kg.toFixed(1)} mL/kg/min), ${f0(s.vo2PeakPct)}% of predicted; peak work ${f0(r.peak.work)} W. ${lowVO2 ? 'Yes, it is reduced.' : s.vo2PeakPct > 120 ? 'No; it is high.' : 'No.'}` });
  steps.push({ q: `Is the anaerobic threshold early? (below ${C.at}% of predicted VO2max)`, a: s.atPctPred == null ? 'The test stopped before the anaerobic threshold, so it cannot be read.' : `AT at ${f0(s.atPctPred)}% of predicted VO2max (${f0(s.atPctOwn)}% of this patient’s own VO2max): ${lowAT ? 'yes, early. Muscles run short of O2 at a low workload, which points to poor O2 delivery (the heart, the blood, or the pulmonary circulation).' : 'no, it is normal.'}` });
  steps.push({ q: `Was the patient respiratory limited? (respiratory reserve, 1 − VE/MVV, below ${C.reserve}%)`, a: `Peak VE ${r.peak.ve.toFixed(0)} L/min of an MVV of ${s.mvv.toFixed(0)} L/min (FEV1 × 40): respiratory reserve ${reserve}%. ${respLimited ? (respBorder ? 'Borderline (20–30%): ventilation came close to its ceiling.' : 'Yes, ventilation reached its ceiling.') : 'No, ventilation was left over.'}` });
  steps.push({ q: `Did heart rate reach its predicted maximum? (peak heart rate above ${C.hr}% of predicted)`, a: `Peak HR ${f0(r.peak.hr)}/min, ${f0(s.hrPeakPct)}% of predicted (heart rate reserve ${f0(s.heartRateReserve)}/min, ${f0(s.heartRateReservePct)}%). ${heartMax ? 'Yes.' : 'No, heart rate was left over.'} O2 pulse ${r.peak.o2pulse.toFixed(1)} mL/beat, ${f0(s.o2pulsePct)}% of predicted${lowO2pulse ? ': low, so each beat delivers less O2 (small stroke volume, low hemoglobin, or low SpO2).' : '.'}` });
  steps.push({ q: `Is gas exchange abnormal? (SpO2 falls ${C.spo2Drop} or more points; VE/VCO2 at AT above ${C.veVco2})`, a: `SpO2 fell ${s.spo2Drop.toFixed(0)} points; VE/VCO2 at AT ${s.veVco2AtAT.toFixed(0)}; hemoglobin ${s.hemoglobin.toFixed(1)} g/dL. ${desat || inefficient ? [desat ? 'Exercise desaturation' : '', inefficient ? 'High VE/VCO2 (wasted ventilation)' : ''].filter(Boolean).join(' and ').replace(' and High', ' and high') + '.' : s.spo2Drop >= 1.5 ? 'No; a small fall, below the 4-point cutoff (even healthy lungs widen the A-a gradient at peak).' : 'No.'}${lowHb ? ' Hemoglobin is low.' : ''}` });

  let pattern, consistent;
  if (s.tooWeak) {
    pattern = 'Too little capacity to read';
    consistent = 'These settings leave a ceiling too low to sustain even unloaded pedaling, so no real patient would look like this. Move the sliders back toward normal.';
  } else if (poorEffort) {
    pattern = 'Submaximal test';
    consistent = 'Peak R stayed below 1.10, heart rate stopped well short of its predicted maximum, and respiratory reserve was left over: neither the heart nor the lungs reached a limit. The patient stopped early (effort, motivation, pain, or anxiety). A low VO2max here does not mean disease; repeat the test with encouragement before reading it.';
  } else if (respLimited && !lowVO2 && heartMax && !desat && !inefficient) {
    pattern = s.vo2PeakPct > 120 ? 'Normal, high fitness' : 'Normal exercise capacity';
    consistent = 'Cardiac limited, as expected in health, and ventilation came close to its ceiling as well. A trained athlete moves so much air at peak that the respiratory reserve shrinks; the lungs are normal.' + (s.vo2PeakPct > 120 ? ' The large O2 pulse reflects a bigger stroke volume and, to a lesser degree, more O2 extraction.' : '');
  } else if (respLimited && f0(s.o2pulsePct) < 50 && inefficient) {
    pattern = 'Both heart and lungs at their limits';
    consistent = 'Respiratory reserve is nearly gone and the O2 pulse is very low, with high VE/VCO2: the lungs and the heart reach their ceilings at about the same workload (steps 4 and 5 both say yes). A new heart alone would not raise exercise capacity much, because the lungs would stop the test soon after.';
  } else if (respLimited) {
    pattern = 'Respiratory limited';
    if (desat && r.peak.rr > 45) consistent = 'The patient ran out of ventilation, breathing fast and shallow, and desaturated: the pattern of interstitial lung disease (stiff, small lungs and a thickened membrane).' + (heartMax ? ' Heart rate reached its predicted maximum too (step 5), so both systems were near their limits; the desaturation and the rapid, shallow breathing show that the lungs are the main problem.' : '');
    else if (!heartMax) consistent = 'The patient ran out of ventilation with heart rate to spare (heart rate reserve left over): the pattern of obstructive lung disease such as COPD. Flow limitation caps how much air can move each minute.';
    else consistent = 'Ventilation reached its ceiling, and heart rate is near its maximum too. Look at FEV1, dead space, and SpO2 to see why ventilation runs out.';
  } else if (!lowVO2) {
    if (desat || inefficient) {
      pattern = 'Normal VO2max, abnormal gas exchange';
      consistent = `Exercise capacity is preserved, but ${desat ? 'SpO2 falls with exercise' : ''}${desat && inefficient ? ' and ' : ''}${inefficient ? 'VE/VCO2 is high' : ''}. That is not normal: look for early interstitial or pulmonary vascular disease.`;
    } else {
      pattern = s.vo2PeakPct > 120 ? 'Normal, high fitness' : 'Normal exercise capacity';
      consistent = 'Cardiac limited: respiratory reserve was left over and the heart set the ceiling. That is normal. Healthy people are limited by cardiac output (O2 delivery), not by their lungs.' + (s.vo2PeakPct > 120 ? ' The large O2 pulse reflects a bigger stroke volume and, to a lesser degree, more O2 extraction.' : '');
    }
  } else if (desat && inefficient) {
    pattern = 'Circulatory limitation with abnormal gas exchange';
    consistent = 'Low VO2max and O2 pulse, an early anaerobic threshold, desaturation, and high VE/VCO2 with respiratory reserve left over: the pattern of pulmonary vascular disease. Blood flow through the lungs cannot rise, so dead space rises and right heart output limits exercise.';
  } else if (inefficient && lowO2pulse) {
    pattern = 'Circulatory (cardiac) limitation';
    consistent = 'Low VO2max, an early anaerobic threshold, a low O2 pulse (stroke volume cannot rise), and high VE/VCO2 without desaturation: the pattern of heart failure. The circulation sets the ceiling, so this is a cardiac limit' + (heartMax ? '.' : ', even though heart rate stopped short of its predicted maximum (step 5): beta-blockers, a mainstay of heart failure treatment, blunt the rise in heart rate, and the small stroke volume caps cardiac output anyway.');
  } else if (lowHb && lowO2pulse) {
    pattern = 'Circulatory limitation: low O2 content';
    consistent = `Heart rate reached its maximum with a low O2 pulse but normal lungs: each beat carries less O2 because hemoglobin is low (anemia). CaO2 is about ${s.caRest.toFixed(0)} mL/dL at rest (normal about 19), so the Fick product falls.`;
  } else if (!heartMax) {
    pattern = 'Heart rate did not rise normally';
    consistent = 'VO2max is low and heart rate stopped short of its predicted maximum, though the patient reached a high R and the lungs had reserve. Think of chronotropic incompetence (or a beta-blocker): the heart rate cannot climb, so cardiac output cannot.';
  } else if (!lowAT) {
    pattern = 'Low VO2max with a normal anaerobic threshold';
    consistent = 'VO2max is low, but the anaerobic threshold is normal, the heart reached its maximum, respiratory reserve was left over, and gas exchange is normal: the pattern of deconditioning. Training raises stroke volume and muscle O2 extraction.';
  } else {
    pattern = 'Circulatory limitation';
    consistent = 'Low VO2max with an early anaerobic threshold, while the heart reaches its maximum and the lungs and gas exchange are normal: O2 delivery runs short. Think of early heart disease; deconditioning alone usually leaves the threshold normal.';
  }
  if (!s.tooWeak && !poorEffort && (s.rampMinutes < 6 || s.rampMinutes > 15)) consistent += ` The ramp lasted ${s.rampMinutes.toFixed(1)} min; labs choose the ramp rate so it lasts about 8 to 12 min, and a much shorter or longer ramp changes the peak values.`;
  return { steps, pattern, consistent, maximal: maximalR };
}
