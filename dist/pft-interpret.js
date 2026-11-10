// Stepwise PFT interpretation in the order the MEDC 30504 course teaches it (PFT interpretation
// flowchart and "respiratory principles" summary; Small Group 4):
//   1) Lung volumes: big lungs or small lungs?   2) FEV1/FVC: obstruction?
//   3) Flow-volume loop shape                    4) Is the DLCO preserved?
//   5) Bronchodilator response, when tested
// Course teaching values: 80-120% of predicted is normal; TLC below 80% is small lungs (restriction)
// and above 120% big lungs; FEV1/FVC below 70% is obstruction; DLCO below 80% is low; a bronchodilator
// response is a rise in FEV1 or FVC of more than 10% of predicted (also the ERS/ATS 2022 criterion).
// Clinical labs use lower limits of normal from reference equations instead of fixed cutoffs.

const pct = (r, p, k) => 100 * r[k] / p[k];
const f0 = x => Math.round(x);
const EXTRA = ' <span class="extra">(beyond the course flowchart)</span>';

export function interpret(r, p, { pre = null, custom = false } = {}) {
  const steps = [];
  const ratio = 100 * r.ratio, tlc = pct(r, p, 'tlc'), rv = pct(r, p, 'rv'), frc = pct(r, p, 'frc'), erv = pct(r, p, 'erv');
  const fev1 = pct(r, p, 'fev1'), fvc = pct(r, p, 'fvc'), dl = pct(r, p, 'dlco'), dlc = pct(r, p, 'dlcoCorrected');
  const small = tlc < 80, big = tlc > 120, obstruction = Math.round(ratio) < 70; // decide on the value shown
  const lowDL = dl < 80, lowDLc = dlc < 80, highDL = dl > 120;
  // Step-up: TLC, FRC, RV rise in that order as percent predicted, with RV clearly high.
  const stepUp = rv > 110 && rv > frc && frc > tlc;
  // Fixed upper airway obstruction caps flow in both directions, so the expiratory limb has a flat top
  // (a quarter or more of the FVC exhaled near peak flow) and inspiratory flow is low. FEV1/PEF
  // (Empey index, mL per L/min; above 10 is abnormal) is a second check. Students read it from the loop.
  const empey = (r.fev1 * 1000) / (r.pef * 60);
  // Weak muscles also blunt both limbs of the loop, so a borderline flat top with a step-up pattern
  // (small TLC, high RV) is read as weakness. A clearly flat top (30% or more of FVC near peak flow) is
  // still called a fixed obstruction: weakness alone does not flatten the loop that much.
  const upperAirway = fvc >= 40 && (r.plateau ?? 0) >= 0.25 && empey > 10 && pct(r, p, 'pif') < 80 && !(small && stepUp && r.plateau < 0.30);
  const volumesNormal = tlc >= 80 && tlc <= 120 && rv <= 120, dlNormal = !lowDLc;

  // 1. Lung volumes
  let vol = `TLC ${f0(tlc)}%, FRC ${f0(frc)}%, RV ${f0(rv)}%: `;
  if (small) vol += 'small lungs (restriction).';
  else if (big) vol += 'big lungs (hyperinflation).';
  else vol += 'TLC is normal.';
  if (stepUp) vol += ` The volumes step up from TLC to FRC to RV${obstruction ? ' (here from air trapping)' : ''}.`;
  else if (rv > 120) vol += ' RV is high: air trapping.';
  steps.push({ q: 'Look at lung volumes: big lungs or small lungs? (TLC below 80% is small; above 120% is big)', a: vol });

  // 2. FEV1/FVC
  steps.push({ q: 'Is there obstruction? (FEV1/FVC below 70%)', a: `FEV1/FVC ${f0(ratio)}%: ${obstruction ? 'yes, obstruction' : 'no'}. FEV1 ${f0(fev1)}% and FVC ${f0(fvc)}% of predicted.` });

  // 3. Loop shape, asked every time
  let loop;
  if (upperAirway) loop = 'No. Both limbs are cut off flat: peak expiratory flow is blunted at the very start of exhalation and inspiratory flow is capped too, so the loop is squared off. <span class="extra">(Extra: FEV1/PEF is ' + empey.toFixed(1) + ' mL per L/min; above 10 also suggests it.)</span>';
  else if (obstruction) loop = 'No. The expiratory limb is scooped: flow falls off quickly after the peak and stays low through the rest of the breath.';
  else if (small && !stepUp && ratio > 80) loop = 'No. The loop is tall and narrow: small volume, but flow is normal or high for that volume.';
  else if (small && stepUp && !obstruction) loop = 'No. The loop is small, with low peak flows in both directions. The peak is blunted too, but the small TLC and high RV point to weak muscles; a fixed tracheal obstruction blunts the loop with normal lung volumes.';
  else if (small || fvc < 80) loop = 'No. The loop is small, with low peak flows in both directions.';
  else loop = 'Yes, normal shape.';
  steps.push({ q: 'Does the flow-volume loop look normal?', a: loop });

  // 4. DLCO
  steps.push({ q: 'Is the DLCO preserved? (below 80% is low)', a: `DLCO ${f0(dl)}%${Math.abs(dlc - dl) > 3 ? `, ${f0(dlc)}% after correcting for hemoglobin` : ''}: ${lowDLc ? 'no, it is low.' : lowDL ? 'low only because hemoglobin is low.' : highDL ? 'yes; it is high.' : 'yes, normal.'}` });

  // 5. Bronchodilator
  let reversible = false;
  if (pre) {
    const dFev1 = 100 * (r.fev1 - pre.fev1) / p.fev1, dFvc = 100 * (r.fvc - pre.fvc) / p.fvc;
    reversible = dFev1 > 10 || dFvc > 10;
    const mL = x => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 1000))} mL`, pp = x => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(0)}% of predicted`;
    steps.push({ q: 'Is there a bronchodilator response? (FEV1 or FVC up more than 10% of predicted)', a: `FEV1 ${pre.fev1.toFixed(2)} → ${r.fev1.toFixed(2)} L (${mL(r.fev1 - pre.fev1)}, ${pp(dFev1)}); FVC ${pre.fvc.toFixed(2)} → ${r.fvc.toFixed(2)} L (${pp(dFvc)}). ${reversible ? 'Yes, a significant response.' : 'No significant response.'}` });
  }

  let pattern, consistent;
  if (fvc < 20) {
    pattern = 'Too little vital capacity to read';
    consistent = 'These settings leave almost no vital capacity, so no real patient would look like this and the patterns below do not apply. Move the sliders back toward normal.';
  } else if (upperAirway) {
    pattern = 'Upper airway obstruction';
    consistent = (volumesNormal && dlNormal
      ? 'A squared-off loop with normal lung volumes and DLCO points to a fixed obstruction of the trachea (for example, tracheal stenosis).'
      : 'A squared-off loop points to a fixed obstruction of the trachea (for example, tracheal stenosis). The lung volumes and DLCO are not normal, so there is a second process as well; read them as you would without the stenosis.')
      + ' The trachea becomes the flow-limiting segment at the start of exhalation, where flow is normally highest. FEV1/FVC may also be low, but the loop shape, not the ratio, gives it away.';
  } else if (obstruction || (pre && 100 * pre.ratio < 70)) {
    if (small) { pattern = 'Mixed obstruction and restriction'; consistent = 'Obstruction with small lungs. Look for two processes, for example COPD with obesity or fibrosis.' + EXTRA; }
    else if (pre && reversible) {
      pattern = obstruction ? 'Obstruction, partly reversible' : 'Obstruction that reverses';
      consistent = 'Obstruction that improves by more than 10% of predicted after bronchodilator, with a preserved DLCO: the pattern of asthma. Narrowed airways relax; the alveoli were never damaged. The trapped air (high RV and FRC) also comes back down.';
    } else if (lowDLc) {
      pattern = 'Obstruction';
      consistent = `Obstruction with ${big ? 'big lungs, ' : ''}${rv > 120 ? 'air trapping, ' : ''}${big || rv > 120 ? 'and ' : ''}a low DLCO${pre ? ', with no bronchodilator response' : ''}: the pattern of emphysema. Alveolar walls and their capillaries are destroyed, so recoil, airway tethering, and DLCO are all lost.`;
    } else {
      pattern = 'Obstruction';
      consistent = pre
        ? 'Obstruction with a preserved DLCO and no bronchodilator response points to the airways: in the course flowchart, chronic bronchitis. The alveoli are intact.'
        : 'Obstruction with a preserved DLCO points to the airways: asthma (repeat after bronchodilator) or chronic bronchitis. The alveoli are intact.';
    }
  } else if (small) {
    pattern = 'Restriction';
    if (lowDLc) consistent = 'Small lungs with a low DLCO point inside the chest, to the lung parenchyma, as in interstitial lung disease: stiff lungs (small TLC, normal or high FEV1/FVC) and a thickened, scarred alveolar membrane.';
    else if (stepUp) consistent = 'Small lungs with a normal DLCO and a step-up pattern (TLC low, FRC near normal, RV high) point to respiratory muscle weakness: the respiratory system curve is nearly normal, but the weak muscles cannot push it to TLC or down to RV. Supine testing makes it worse.';
    else if (erv < 70) consistent = 'Small lungs with a normal DLCO and a very small ERV point outside the lung, to the chest wall, as in obesity: an inward load lowers FRC and squeezes ERV.';
    else consistent = 'Small lungs with a normal DLCO point outside the lung (extrathoracic): chest wall, obesity, or respiratory muscle weakness.';
  } else if (fvc < 80 || fev1 < 80 || rv > 120) {
    pattern = 'Normal TLC, but abnormal spirometry or RV';
    consistent = (rv > 120 && frc <= 120 && tlc < 90 && frc - tlc > 5
      ? 'TLC is normal, so this is not restriction, but RV is high and less air moves than it should, with FRC near normal. Think of early respiratory muscle weakness; supine spirometry would help.'
      : 'TLC is normal, so this is not restriction, but less air moves than it should' + (rv > 120 ? ' and RV is high (air trapping)' : '') + '. Think of early airway disease or early muscle weakness, and repeat after bronchodilator.') + EXTRA;
  } else {
    pattern = 'No obstruction or restriction';
    if (lowDL && !lowDLc) consistent = 'Normal spirometry and lung volumes. DLCO is low only because hemoglobin is low (anemia); the corrected value is normal.';
    else if (lowDLc) consistent = 'Normal spirometry and lung volumes with a low DLCO: think of the pulmonary circulation (pulmonary vascular disease, emboli) or early parenchymal disease.' + EXTRA;
    else if (erv < 70 && frc < 80) { pattern = 'Normal spirometry, low FRC and ERV'; consistent = 'Spirometry and TLC are normal, but FRC and ERV are low: the pattern of obesity before TLC falls.' + EXTRA; }
    else consistent = 'Normal study. If symptoms still suggest asthma, the next test is bronchoprovocation.';
  }
  if (custom) consistent += ' <span class="extra">Custom patient: these rules assume that lung recoil, airways, and DLCO change together as they do in real diseases. Moving one slider on its own may not match any one disease.</span>';
  return { steps, pattern, consistent };
}
