// Pulmonary function test model built on the static lung and chest wall model (model.js).
// Units: volume L, flow L/s, pressure cmH2O, time s, DLCO mL/min/mmHg, Hb g/dL.
//
// Forced expiration. Three limits act at once; the lowest one sets the flow at each instant:
//  1. Small-airway (wave-speed / equal-pressure-point) limit, effort independent:
//       Vmax(V) = PL(V) / Rus(V)                       (Mead et al. 1967; Pride et al. 1967)
//     PL is the static lung recoil from model.js. Rus is the upstream (small-airway) resistance.
//     Small airways are held open by lung recoil, so Rus rises steeply as recoil falls:
//       Rus(V) = Rus0 * r * (1 + c * (Pt / PL)^2)
//     r = airway narrowing (asthma, bronchitis), c = collapsibility / loss of tethering (emphysema).
//  2. Effort limit: (Prs(V) + expiratory muscle pressure) / Rcentral, with effort rising over ~0.05 s.
//  3. Central-airway limit: a fixed maximum flow (and a lower one with fixed upper airway obstruction).
// Forced inspiration has no dynamic compression, so it is effort limited:
//       flow = (inspiratory muscle pressure - Prs(V)) / Rinsp,  Rinsp rising with airway narrowing.
// Airway closure: when Rus reaches ten times the normal open small-airway resistance (Rus0) the
// airways are treated as closed. That volume (the closing capacity) sets RV if it is above the chest
// wall limit, which is how air trapping raises RV in emphysema and in an asthma attack.
// Dynamic hyperinflation: where the small-airway limit cannot carry a quiet expiration (about
// 0.5 L/s), end-expiratory lung volume (the FRC the body box measures) rises above the relaxed FRC.
// Raw (body box airway resistance at FRC) is mostly central airways; small airways add a little.
//
// DLCO (Roughton & Forster 1957):  1/DLCO = 1/DM + 1/(theta * Vc), theta proportional to Hb.
// Hb adjustment (ERS/ATS 2017, adult male): DLCOcorr = DLCO * (10.22 + Hb) / (1.7 * Hb).

import { analyze, lungMinVolume, lungMaxVolume, lungPressure, chestWallPressure, systemPressure, PARAMS, DEFAULT_SETTINGS as STATIC_DEFAULTS } from './model.js?v=15';

export const PFT_DEFAULTS = Object.freeze({
  ...STATIC_DEFAULTS,
  airwayResistance: 1,     // small-airway narrowing multiplier r
  airwayCollapsibility: 1, // loss of tethering multiplier c
  upperAirwayLimit: 0,     // fixed upper airway obstruction: max flow in L/s; 0 = none
  membrane: 1,             // DM multiplier (alveolar-capillary membrane / surface area)
  capillaryVolume: 1,      // Vc multiplier (pulmonary capillary blood volume)
  hemoglobin: 14.6,        // g/dL; ERS/ATS 2017 reference value for adult men
});

export const K = Object.freeze({
  Rus0: 2.1, Pt: 0.6, closureFactor: 10, forcedClosureFactor: 7,
  Rcentral: 3.5, effortTau: 0.05, waveSpeedMax: 10,
  Rinsp: 6, inspTau: 0.2, rinspAirwayShare: 0.3,
  tidalFlow: 0.5, rawNormal: 1.4, rawSmallAirwayShare: 0.13,
  endFlow: 0.025, maxExpTime: 15, dt: 0.002,
  // DM/(theta*Vc) = 0.7 at the reference Hb, the assumption behind the ERS/ATS Hb correction.
  DM: 42.5, thetaVcNormal: 60.7, HbNormal: 14.6,
});

const softMin = (xs, p = 6) => { let s = 0; for (const x of xs) { if (x <= 0) return 0; s += x ** -p; } return s ** (-1 / p); };

function rus(V, s) {
  const PL = Math.max(lungPressure(V, s.lungCompliance, PARAMS), 1e-6);
  return K.Rus0 * s.airwayResistance * (1 + s.airwayCollapsibility * (K.Pt / PL) ** 2);
}

// Volume of airway closure (closing capacity): where Rus reaches `factor` times the normal open
// value Rus0. Narrowed airways (r > 1) start nearer that limit, so they close at a higher volume.
// During a forced expiration the airways are also squeezed by positive pleural pressure, so they
// close earlier (higher volume) than during a slow exhalation. That is why SVC can exceed FVC.
export function closingVolume(s, factor = K.closureFactor) {
  const room = factor / s.airwayResistance - 1, vMax = lungMaxVolume(s.lungCompliance, PARAMS);
  if (room <= 0.02) return 0.98 * vMax;
  const target = K.Pt * Math.sqrt(s.airwayCollapsibility / room);
  let lo = lungMinVolume(s.lungCompliance, PARAMS), hi = vMax - 1e-6;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (lungPressure(m, s.lungCompliance, PARAMS) < target) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
// End-expiratory volume during quiet breathing. If the small airways cannot carry K.tidalFlow at the
// relaxed FRC, the next breath starts before the last one is out (dynamic hyperinflation).
export function dynamicFrc(s, relaxedFrc) {
  const vmax = V => lungPressure(V, s.lungCompliance, PARAMS) / rus(V, s);
  if (vmax(relaxedFrc) >= K.tidalFlow) return relaxedFrc;
  let lo = relaxedFrc, hi = lungMaxVolume(s.lungCompliance, PARAMS) - 1e-6;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (vmax(m) < K.tidalFlow) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

function expiratoryFlow(V, t, s, statics) {
  const PL = lungPressure(V, s.lungCompliance, PARAMS);
  const smallAirway = PL / rus(V, s);
  const effort = (1 - Math.exp(-t / K.effortTau)) * (systemPressure(V, s, PARAMS) + PARAMS.expMax * s.muscleStrength) / K.Rcentral;
  const limits = [smallAirway, effort, K.waveSpeedMax];
  if (s.upperAirwayLimit > 0) limits.push(s.upperAirwayLimit);
  return V <= statics.forcedEnd ? 0 : softMin(limits);
}
function inspiratoryFlow(V, t, s) {
  const drive = PARAMS.inspMax * s.muscleStrength - systemPressure(V, s, PARAMS);
  const rinsp = K.Rinsp * (1 + K.rinspAirwayShare * (s.airwayResistance - 1));
  const limits = [(1 - Math.exp(-t / K.inspTau)) * drive / rinsp];
  if (s.upperAirwayLimit > 0) limits.push(s.upperAirwayLimit);
  return softMin(limits);
}

export function simulate(settings = {}) {
  const s = { ...PFT_DEFAULTS, ...settings };
  const st = analyze(s);
  const closing = closingVolume(s);
  const vcFloor = st.tlc - 0.2; // extreme slider combinations: keep at least 0.2 L of vital capacity
  const rv = Math.min(Math.max(st.rv, closing), vcFloor); // RV after a slow, complete exhalation
  // End-expiratory volume: never below RV, and low enough that a 0.5 L tidal breath fits below TLC.
  const frc = Math.max(rv, Math.min(dynamicFrc(s, st.frc), st.tlc - 0.5));
  const forcedEnd = Math.min(Math.max(st.rv, closingVolume(s, K.forcedClosureFactor)), vcFloor); // end of a forced expiration
  const statics = { ...st, closing, rvMeasured: rv, forcedEnd, frcMeasured: frc };
  // Forced expiration from TLC.
  const exp = [{ t: 0, v: st.tlc, flow: 0 }];
  let V = st.tlc, t = 0, quietSince = null;
  while (t < K.maxExpTime) {
    const f = expiratoryFlow(V, t, s, statics);
    V = Math.max(forcedEnd, V - f * K.dt); t += K.dt;
    exp.push({ t, v: V, flow: f });
    if (f < K.endFlow && t > 0.5) { quietSince ??= t; if (t - quietSince >= 1) break; } else quietSince = null;
  }
  const endVolume = V;
  // Forced inspiration from the end of expiration back to TLC.
  const insp = [{ t: 0, v: endVolume, flow: 0 }];
  V = endVolume; t = 0;
  while (V < st.tlc - 0.005 && t < 6) {
    const f = inspiratoryFlow(V, t, s);
    V = Math.min(st.tlc, V + f * K.dt); t += K.dt;
    insp.push({ t, v: V, flow: f });
  }
  const at = time => { const i = Math.min(exp.length - 1, Math.round(time / K.dt)); return exp[i].v; };
  const fvc = st.tlc - endVolume;
  const fev1 = st.tlc - at(1);
  const v25 = st.tlc - 0.25 * fvc, v75 = st.tlc - 0.75 * fvc;
  const t25 = exp.find(p => p.v <= v25)?.t ?? 0, t75 = exp.find(p => p.v <= v75)?.t ?? 0;
  const fef2575 = (0.5 * fvc) / Math.max(1e-6, t75 - t25);
  const pef = Math.max(...exp.map(p => p.flow));
  // Share of the FVC exhaled at 90% of peak flow or more: a flat-topped (squared-off) expiratory limb.
  let plateauVol = 0; for (let i = 1; i < exp.length; i++) if (exp[i].flow >= 0.9 * pef) plateauVol += exp[i - 1].v - exp[i].v;
  const plateau = fvc > 0 ? plateauVol / fvc : 0;
  const pif = Math.max(...insp.map(p => p.flow));
  // Diffusion.
  const thetaVc = K.thetaVcNormal * s.capillaryVolume * s.hemoglobin / K.HbNormal;
  const dlco = 1 / (1 / (K.DM * s.membrane) + 1 / thetaVc);
  const dlcoCorrected = dlco * (10.22 + s.hemoglobin) / (1.7 * s.hemoglobin); // ERS/ATS 2017, males >= 15 y
  const svc = st.tlc - rv;
  // Raw at FRC: central airways (fixed) plus a small share from the small airways, plus a stenosis.
  const rusRatio = rus(frc, s) / rus(3.0, PFT_DEFAULTS);
  const raw = K.rawNormal * ((1 - K.rawSmallAirwayShare) + K.rawSmallAirwayShare * rusRatio) + (s.upperAirwayLimit > 0 ? 0.1 * (K.waveSpeedMax / s.upperAirwayLimit - 1) : 0);
  return {
    settings: s, statics, expiration: exp, inspiration: insp,
    report: {
      tlc: st.tlc, frc, rv,
      fvc, fev1, ratio: fev1 / fvc, fef2575, pef, pif, plateau,
      svc, ic: st.tlc - frc, erv: frc - rv, raw,
      dlco, dlcoCorrected, va: st.tlc - 0.15, hemoglobin: s.hemoglobin,
      expTime: exp[exp.length - 1].t,
    },
  };
}

const preset = (label, o, extra = {}) => ({ label, settings: { ...PFT_DEFAULTS, ...o }, ...extra });
export const PFT_PRESETS = {
  normal: preset('Healthy adult', {}),
  emphysema: preset('Emphysema (Small Group 1 case: 72-year-old former smoker)', { lungCompliance: 2.5, airwayCollapsibility: 60, airwayResistance: 2, membrane: 0.5, capillaryVolume: 0.7 }, { bronchodilator: { airwayResistance: 1.7 } }),
  asthma: preset('Asthma, during an exacerbation', { lungCompliance: 1.25, airwayResistance: 3, airwayCollapsibility: 35, capillaryVolume: 1.2 }, { bronchodilator: { airwayResistance: 1, airwayCollapsibility: 1 } }),
  ild: preset('Interstitial lung disease (pulmonary fibrosis)', { lungCompliance: 0.35, membrane: 0.45, capillaryVolume: 0.8 }),
  obesity: preset('Obesity', { chestWallLoad: 6, chestWallCompliance: 0.4, capillaryVolume: 1.1 }),
  // Chronic weakness also stiffens the lung and chest wall a little (Gibson 1977; Estenne 1983).
  neuromuscular: preset('Respiratory muscle weakness (Small Group 4 case)', { muscleStrength: 0.48, lungCompliance: 0.82, chestWallCompliance: 0.82 }, { supine: { muscleStrength: 0.38, chestWallLoad: 1 } }),
  upperAirway: preset('Fixed upper airway obstruction (e.g., tracheal stenosis)', { upperAirwayLimit: 3 }),
  anemia: preset('Anemia (Hb 8 g/dL), lungs normal', { hemoglobin: 8 }),
};

export const PREDICTED = simulate(PFT_DEFAULTS).report;
