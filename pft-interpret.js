// Simple stepwise PFT interpretation, following the MEDC 30504 Small Group 4 framework:
// 1) FEV1/FVC -> obstruction?  2) TLC -> restriction?  3) DLCO -> alveolar problem?
// then the clues that separate common diseases. Thresholds are the course's teaching values:
// 80-120% predicted is normal, FEV1/FVC < 0.70 is obstruction, a bronchodilator response is
// an FEV1 rise of at least 12% and 200 mL. These are teaching rules, not a full ERS/ATS (LLN) read.

const pct = (r, p, k) => 100 * r[k] / p[k];
const f0 = x => Math.round(x);

export function interpret(r, p, { pre = null, hbAvailable = true } = {}) {
  const steps = [];
  const ratio = r.ratio, tlc = pct(r, p, 'tlc'), rv = pct(r, p, 'rv'), frc = pct(r, p, 'frc'), erv = pct(r, p, 'erv');
  const fev1 = pct(r, p, 'fev1'), dl = pct(r, p, 'dlco'), dlc = pct(r, p, 'dlcoCorrected');
  const obstruction = ratio < 0.70, restriction = tlc < 80;
  const lowDL = dl < 80, lowDLc = dlc < 80, highDL = dl > 120;
  const empey = (r.fev1 * 1000) / (r.pef * 60); // FEV1 (mL) / PEF (L/min); > 10 suggests upper airway obstruction

  steps.push({ q: 'Is there obstruction? (FEV1/FVC below 0.70)', a: `FEV1/FVC ${ratio.toFixed(2)}: ${obstruction ? `yes. FEV1 is ${f0(fev1)}% of predicted.` : 'no.'}` });
  steps.push({ q: 'Is there restriction? (TLC below 80% predicted)', a: `TLC ${f0(tlc)}%: ${restriction ? 'yes.' : tlc > 120 ? 'no; TLC is high (hyperinflation).' : 'no.'}${rv > 120 ? ` RV is ${f0(rv)}% (air trapping or weak expiratory muscles).` : ''}` });
  steps.push({ q: 'Is gas transfer reduced? (DLCO below 80% predicted)', a: `DLCO ${f0(dl)}%${Math.abs(dlc - dl) > 3 ? `, ${f0(dlc)}% after correcting for hemoglobin` : ''}: ${lowDLc ? 'yes, low.' : lowDL ? 'low only because hemoglobin is low.' : highDL ? 'no; it is high.' : 'no, normal.'}` });

  let pattern, consistent, reversible = false;
  if (pre) {
    const d = r.fev1 - pre.fev1, rel = 100 * d / pre.fev1; reversible = d >= 0.2 && rel >= 12;
    steps.push({ q: 'Does it reverse after bronchodilator? (FEV1 up ≥12% and ≥200 mL)', a: `Before: FEV1/FVC ${pre.ratio.toFixed(2)}. FEV1 ${pre.fev1.toFixed(2)} → ${r.fev1.toFixed(2)} L (${d >= 0 ? '+' : ''}${Math.round(d * 1000)} mL, ${d >= 0 ? '+' : ''}${f0(rel)}%): ${reversible ? 'yes, a significant response.' : 'no significant response.'}` });
  }
  if (empey > 10) {
    steps.push({ q: 'Does the flow-volume loop look normal?', a: `No. PEF is ${f0(pct(r, p, 'pef'))}% of predicted, out of proportion to FEV1: FEV1/PEF is ${empey.toFixed(1)} mL per L/min (above 10 suggests large-airway obstruction). Both limbs are flattened.` });
    pattern = 'Upper airway obstruction';
    consistent = 'Flat inspiratory and expiratory limbs with normal lung volumes and DLCO point to a fixed obstruction of the large airway, such as tracheal stenosis. FEV1/FVC may also be low, but the loop shape, not the ratio, gives it away.';
  } else if (pre && pre.ratio < 0.70 && reversible) {
    pattern = obstruction ? 'Obstruction, partly reversible' : 'Obstruction that reverses';
    consistent = 'Obstruction before bronchodilator that improves significantly after it, with normal DLCO: the pattern of asthma. Narrowed airways relax; the alveoli were never damaged.';
  } else if (obstruction) {
    pattern = 'Obstruction';
    if (lowDLc) consistent = 'Obstruction with low DLCO and air trapping points to emphysema: alveolar walls and their capillaries are destroyed, so recoil, airway tethering, and gas transfer are all lost.';
    else consistent = 'Obstruction with normal or high DLCO points to an airway disease such as asthma (or chronic bronchitis): the alveoli are intact. Repeat after bronchodilator to look for reversibility.';
    if (restriction) { pattern = 'Mixed obstruction and restriction'; consistent = 'Both obstruction and a low TLC. Look for two processes (for example, COPD with obesity or fibrosis).'; }
  } else if (restriction) {
    pattern = 'Restriction';
    const stepUp = rv > 110 && frc >= 85 && frc <= 115;
    if (lowDLc) consistent = 'Restriction with low DLCO points to the lung parenchyma, such as interstitial lung disease: stiff lungs (small TLC, high FEV1/FVC) and a thickened alveolar membrane.';
    else if (stepUp) consistent = 'Restriction with normal DLCO and a step-up pattern (TLC low, FRC normal, RV high) points to respiratory muscle weakness: the relaxation curves are normal, but the muscles cannot push the system to TLC or RV. Supine testing makes it worse.';
    else if (erv < 70) consistent = 'Restriction with normal DLCO and a small ERV points to the chest wall, such as obesity: an inward load lowers FRC and squeezes ERV.';
    else consistent = 'Restriction with normal DLCO points outside the lung parenchyma: chest wall, pleura, or respiratory muscles.';
  } else {
    pattern = 'No obstruction or restriction';
    if (lowDL && !lowDLc) consistent = 'Normal spirometry and lung volumes. DLCO is low only because hemoglobin is low (anemia); the corrected value is normal.';
    else if (lowDLc) consistent = 'Normal spirometry and lung volumes with low DLCO: think of the pulmonary circulation (pulmonary vascular disease, emboli) or early parenchymal disease.';
    else if (erv < 70 && frc < 80) { pattern = 'Normal spirometry, low FRC and ERV'; consistent = 'Spirometry and TLC are normal, but FRC and ERV are low: the pattern of obesity before TLC falls.'; }
    else consistent = 'Normal study.';
  }
  return { steps, pattern, consistent };
}
