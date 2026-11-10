// Static respiratory mechanics: lung, chest wall, and the combined respiratory system.
// Units: volume in L, pressure in cmH2O (relative to atmosphere), compliance in L/cmH2O.
//
// Core rule: the lung and chest wall share one volume (they move together because of the
// pleural seal). At any volume, the relaxation pressure of the whole system is the sum of the
// two recoil pressures:   Prs(V) = PL(V) + Pcw(V).
// Differentiating gives   1/Crs = 1/CL + 1/Ccw   (compliances in series: same volume change,
// pressures add). Adding volumes at equal pressure would be the parallel rule, which does not
// apply here.

export const NORMAL = Object.freeze({
  // Lung (Salazar-Knowles exponential): V = Vmax - (Vmax - V0) * exp(-k * PL), for PL >= 0.
  // Fit to PL 5 cmH2O at FRC 3.0 L, CL 0.28 L/cmH2O at FRC, and PL 34 cmH2O at TLC 6.0 L.
  // V0 is the lung's minimal volume ("minimal air"), below RV, so the lung still recoils a little at RV.
  lungV0: 1.2530,   // volume of the lung at zero transpulmonary pressure
  lungVmax: 6.2742, // asymptotic maximum lung volume
  lungK: 0.08552,   // shape constant, 1/cmH2O
  // Lung size: a compliance multiplier s also scales the lung's volume axis by s^lungSizeExp, so an
  // emphysematous lung is bigger at every pressure (TLC rises above 120%) and a fibrotic lung smaller
  // (TLC and RV fall). With s = 1 the healthy curve is unchanged.
  lungSizeExp: 0.2,
  // Chest wall (logistic): V = Vlow + (Vhigh - Vlow) / (1 + exp(-(Pcw - Pc) / b)).
  // Fit so the chest wall rests at 72% VC (4.75 L; Rahn et al. 1946), recoils outward
  // -5 cmH2O at FRC (3.0 L), and -14 cmH2O at RV (1.5 L), leaving room for RV to fall when the
  // chest wall is loaded (obesity) or the lung is stiff (fibrosis). The upper limit (8.5 L) is set
  // high enough that a hyperinflated chest (emphysema) can reach a TLC above 120% of predicted.
  cwVlow: 1.1398,
  cwVhigh: 8.5,
  cwPc: 0.1816,     // cmH2O
  cwB: 4.7798,      // cmH2O
  // Maximal relaxation-pressure equivalents of the respiratory muscles at 100% strength.
  // Calibrated so the healthy model gives TLC 6.0 L and RV 1.5 L.
  inspMax: null,
  expMax: null,
});

export const DEFAULT_SETTINGS = Object.freeze({ lungCompliance: 1, chestWallCompliance: 1, chestWallLoad: 0, muscleStrength: 1 });

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Lung: the compliance multiplier s scales the slope of the lung curve. Through g = s^lungSizeExp it
// also scales the lung's volume axis (minimal and maximal volume), so the curve both steepens and
// grows in emphysema, and flattens and shrinks in fibrosis. With s = 1 nothing changes.
// The chest wall pivots near RV instead (see below).
const lungScale = (s, p) => s ** (p.lungSizeExp ?? 0);
export const lungMinVolume = (s = 1, p = NORMAL) => p.lungV0 * lungScale(s, p);
export const lungMaxVolume = (s = 1, p = NORMAL) => p.lungVmax * lungScale(s, p);
export function lungVolume(P, s = 1, p = NORMAL) {
  if (P < 0) return NaN; // the lung cannot sustain negative transpulmonary pressure
  const g = lungScale(s, p);
  return g * (p.lungVmax - (p.lungVmax - p.lungV0) * Math.exp(-p.lungK * (s / g) * P));
}
export function lungPressure(V, s = 1, p = NORMAL) {
  const g = lungScale(s, p), v = V / g;
  if (v <= p.lungV0) return 0;
  if (v >= p.lungVmax) return Infinity;
  return -Math.log((p.lungVmax - v) / (p.lungVmax - p.lungV0)) / (p.lungK * (s / g));
}
// The chest wall curve pivots near RV: the compressed chest wall at low volume is set by the
// bony thorax and changes little with disease, while a stiffer chest wall needs more pressure
// to expand above that. So a stiffer chest wall lowers its resting volume and FRC, matching the
// restrictive pattern. P(V) = Ppivot + (Pnormal(V) - Ppivot) / s.
export const CW_PIVOT_VOLUME = 1.5;
const cwRawPressure = (V, p) => {
  if (V <= p.cwVlow) return -Infinity;
  if (V >= p.cwVhigh) return Infinity;
  return p.cwPc - p.cwB * Math.log((p.cwVhigh - p.cwVlow) / (V - p.cwVlow) - 1);
};
const cwRawVolume = (P, p) => p.cwVlow + (p.cwVhigh - p.cwVlow) / (1 + Math.exp(-(P - p.cwPc) / p.cwB));
// `load` is an extra inward pressure on the chest wall (mass loading from obesity, ascites,
// pregnancy). It shifts the chest wall curve to the right without changing its slope.
export function chestWallVolume(P, s = 1, p = NORMAL, load = 0) {
  const piv = cwRawPressure(CW_PIVOT_VOLUME, p);
  return cwRawVolume(piv + s * (P - load - piv), p);
}
export function chestWallPressure(V, s = 1, p = NORMAL, load = 0) {
  const piv = cwRawPressure(CW_PIVOT_VOLUME, p);
  return piv + (cwRawPressure(V, p) - piv) / s + load;
}
export function systemPressure(V, settings = DEFAULT_SETTINGS, p = NORMAL) {
  return lungPressure(V, settings.lungCompliance, p) + chestWallPressure(V, settings.chestWallCompliance, p, settings.chestWallLoad || 0);
}

// Prs(V) increases monotonically with V, so bisection finds the volume for any target pressure.
export function volumeAtSystemPressure(target, settings = DEFAULT_SETTINGS, p = NORMAL) {
  let lo = p.cwVlow + 1e-9, hi = Math.min(lungMaxVolume(settings.lungCompliance ?? 1, p), p.cwVhigh) - 1e-9;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (systemPressure(mid, settings, p) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Compliance = dV/dP, from the slope of P(V) by central difference.
function slopeCompliance(pressureOfV, V, h = 1e-4) {
  const dP = pressureOfV(V + h) - pressureOfV(V - h);
  return (2 * h) / dP;
}

function calibrate() {
  const base = { ...NORMAL };
  base.inspMax = systemPressure(6.0, DEFAULT_SETTINGS, base);
  base.expMax = -systemPressure(1.5, DEFAULT_SETTINGS, base);
  return Object.freeze(base);
}
export const PARAMS = calibrate();

export function analyze(settings = DEFAULT_SETTINGS, p = PARAMS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const frc = volumeAtSystemPressure(0, s, p);
  const tlc = volumeAtSystemPressure(p.inspMax * s.muscleStrength, s, p);
  // The lung cannot be emptied below its minimal volume, however strong the expiratory muscles.
  const rv = Math.max(volumeAtSystemPressure(-p.expMax * s.muscleStrength, s, p), lungMinVolume(s.lungCompliance, p));
  const PL = lungPressure(frc, s.lungCompliance, p);
  const Pcw = chestWallPressure(frc, s.chestWallCompliance, p, s.chestWallLoad);
  const CL = slopeCompliance(V => lungPressure(V, s.lungCompliance, p), frc);
  const Ccw = slopeCompliance(V => chestWallPressure(V, s.chestWallCompliance, p, s.chestWallLoad), frc);
  const Crs = slopeCompliance(V => systemPressure(V, s, p), frc);
  return {
    frc, tlc, rv, vc: tlc - rv, erv: frc - rv, ic: tlc - frc,
    lungRecoilAtFrc: PL, chestWallRecoilAtFrc: Pcw,
    lungCompliance: CL, chestWallCompliance: Ccw, systemCompliance: Crs,
    seriesCheck: 1 / (1 / CL + 1 / Ccw),
    chestWallRestingVolume: chestWallVolume(0, s.chestWallCompliance, p, s.chestWallLoad),
    lungMinimalVolume: lungMinVolume(s.lungCompliance, p),
  };
}

export function probe(V, settings = DEFAULT_SETTINGS, p = PARAMS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const PL = lungPressure(V, s.lungCompliance, p), Pcw = chestWallPressure(V, s.chestWallCompliance, p, s.chestWallLoad);
  return { volume: V, lung: PL, chestWall: Pcw, system: PL + Pcw };
}

// Curves for plotting, as arrays of {x: pressure, y: volume}.
export function curves(settings = DEFAULT_SETTINGS, p = PARAMS, { pMin = -40, pMax = 60 } = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const n = 240, lung = [], chestWall = [], system = [];
  for (let i = 0; i <= n; i++) {
    const P = pMin + (pMax - pMin) * i / n;
    if (P >= 0) lung.push({ x: P, y: lungVolume(P, s.lungCompliance, p) });
    chestWall.push({ x: P, y: chestWallVolume(P, s.chestWallCompliance, p, s.chestWallLoad) });
  }
  // The system curve is built on a volume grid (pressures add at each volume).
  const vLo = p.cwVlow + 0.02, vHi = Math.min(lungMaxVolume(s.lungCompliance, p), p.cwVhigh) - 0.02;
  for (let i = 0; i <= n; i++) {
    const V = vLo + (vHi - vLo) * i / n;
    const P = systemPressure(V, s, p);
    if (P >= pMin - 20 && P <= pMax + 20) system.push({ x: P, y: V });
  }
  return { lung, chestWall, system };
}

// One quiet breath from FRC. The inspiratory muscles add a pressure Pmus that lowers pleural
// pressure below the chest wall's relaxation pressure: Ppl = Pcw(V) - Pmus. The lung's elastic
// recoil depends only on volume, Pel = Ptp = PA - Ppl, so PA = Ppl + Pel. When PA falls below zero
// (atmosphere), air flows in through the airways: flow = -PA / Raw. Pmus is sized so the breath
// reaches the same tidal volume in every condition, which lets the work be compared directly.
// Elastic work per breath = integral of Prs dV from FRC to end inspiration (area under the
// combined curve), in cmH2O*L; 1 cmH2O*L = 0.0981 J.
export const BREATH = Object.freeze({ tidalVolume: 0.5, raw: 3, rise: 0.9, holdUntil: 2.4, relax: 0.4, duration: 5.2, dt: 0.01 });
export function simulateBreath(settings = DEFAULT_SETTINGS, p = PARAMS, b = BREATH) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const frc = volumeAtSystemPressure(0, s, p);
  const vEnd = frc + b.tidalVolume;
  const pPlateau = systemPressure(vEnd, s, p); // Prs(FRC) = 0
  const smooth = x => { const u = clamp(x, 0, 1); return u * u * (3 - 2 * u); };
  const pmusAt = t => pPlateau * (t < b.holdUntil ? smooth(t / b.rise) : 1 - smooth((t - b.holdUntil) / b.relax));
  const out = [];
  let V = frc, work = 0, vPeak = frc;
  for (let t = 0; t <= b.duration + 1e-9; t += b.dt) {
    const pmus = pmusAt(t);
    const pel = lungPressure(V, s.lungCompliance, p);
    const ppl = chestWallPressure(V, s.chestWallCompliance, p, s.chestWallLoad) - pmus;
    const pa = ppl + pel;
    const flow = -pa / b.raw;
    out.push({ t, volume: V, pmus, pel, ppl, pa, flow, work });
    const dV = flow * b.dt;
    if (dV > 0) work += systemPressure(V + dV / 2, s, p) * dV;
    V += dV; vPeak = Math.max(vPeak, V);
  }
  return { frc, vEnd, pPlateau, vPeak, work, workJ: work * 0.0981, samples: out };
}

const preset = (label, o) => ({ label, ...DEFAULT_SETTINGS, ...o });
export const PRESETS = {
  normal: preset('Healthy adult', {}),
  emphysema: preset('Emphysema: lung compliance ↑', { lungCompliance: 2 }),
  fibrosis: preset('Pulmonary fibrosis: lung compliance ↓', { lungCompliance: 0.5 }),
  obesity: preset('Obesity: inward load on chest wall', { chestWallLoad: 5 }),
  kyphoscoliosis: preset('Kyphoscoliosis: chest wall compliance ↓', { chestWallCompliance: 0.6 }),
  neuromuscular: preset('Respiratory muscle weakness', { muscleStrength: 0.5 }),
};

export { clamp };
