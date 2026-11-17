import { simulate, interpretCPET, CPET_PRESETS, CPET_DEFAULTS, CUTOFFS } from './cpet-model.js?v=27';

const $ = id => document.getElementById(id);
const colors = { o2: '#800000', co2: '#155f83', hr: '#a65e00', grid: '#eaf0f2', axis: '#aebdc4', text: '#666666', work: 'rgba(128,128,128,0.10)' };

const QUESTIONS = {
  normal: ['What stops a healthy person?', 'At peak exercise, is heart rate near its predicted maximum? How much respiratory reserve is left? Is this person cardiac limited or respiratory limited, and is that normal?'],
  athlete: ['A bigger engine', 'VO2max is far above predicted, but peak heart rate is about the same as the healthy subject. Which parts of the Fick equation changed with training, and which changed most? Look at the O2 pulse. Why is the respiratory reserve smaller than in the healthy subject?'],
  poorEffort: ['Stopped early', 'VO2max is low. Before calling this disease, check peak R, the heart rate reserve, and the respiratory reserve. Did the heart or the lungs reach a limit? What would you do next?'],
  copdHf: ['Would a new heart help?', 'This patient has both COPD and heart failure and is being evaluated for heart transplant. Which ceiling does each system set? If the heart were replaced, what would stop exercise next?'],
  deconditioned: ['Out of shape', 'VO2max is low, yet heart rate reaches its maximum, the anaerobic threshold is normal, and the respiratory reserve is large. Why does heart rate climb so fast for each step of work? What would training change?'],
  heartFailure: ['Heart failure', 'Compare the O2 pulse and the anaerobic threshold with the healthy subject. Why are they low? Why is VE/VCO2 high even though the lungs are normal? Peak heart rate is low too: what common heart failure drug does that?'],
  copd: ['COPD', 'What is the respiratory reserve at peak, and how much heart rate reserve is left? Is this patient cardiac limited or respiratory limited? Why is peak R lower than in the healthy subject?'],
  ild: ['Interstitial lung disease', 'Look at tidal volume and breathing rate at peak, and at SpO2. Why does a stiff lung force rapid, shallow breathing? Why does SpO2 fall with exercise but not at rest?'],
  pulmVascular: ['Pulmonary vascular disease', 'Beyond the course. Spirometry is normal and respiratory reserve is left over, yet the patient desaturates and VE/VCO2 is very high. Walk the chain: air moves in (ventilation), O2 crosses into pulmonary capillary blood, the right heart pumps that blood through the lungs, the left heart sends it to muscle. Which link fails here?'],
  anemia: ['Anemia', 'The heart and lungs are normal. Use CaO2 in the Fick equation to explain the low VO2max and low O2 pulse.'],
  custom: ['Your own patient', 'Predict first: which ceiling will this patient hit, the heart or the lungs? Then run the test.'],
};

const lin = (fmt) => ({ toModel: v => v, toSlider: x => x, fmt });
const SLIDERS = {
  strokeVolume: lin(x => Math.round(x * 100) + '%'), heartRateMax: lin(x => Math.round(x * 100) + '%'),
  restingHeartRate: lin(x => Math.round(x) + '/min'), hemoglobin: lin(x => x.toFixed(1) + ' g/dL'),
  fitness: lin(x => Math.round(x * 100) + '%'), effort: lin(x => Math.round(x * 100) + '%'), rampRate: lin(x => Math.round(x) + ' W/min'),
  fev1: lin(x => x.toFixed(2) + ' L'), vc: lin(x => x.toFixed(2) + ' L'),
  deadSpace: lin(x => x.toFixed(2)), desaturation: lin(x => x.toFixed(1).replace(/\.0$/, '') + ' points'),
};

let presetKey = 'normal', settings = { ...CPET_DEFAULTS }, sim = null, playing = false, tNow = Infinity, lastFrame = 0;
const healthy = simulate(CPET_DEFAULTS);
const SPEED = 30;

function chart(id, { xMin, xMax, yMin, yMax, xLabel, yLabel, xTicks, yTicks, y2 = null }) {
  const canvas = $(id), r = canvas.getBoundingClientRect(), w = r.width;
  const h = Number(canvas.dataset.logicalHeight || (canvas.dataset.logicalHeight = canvas.getAttribute('height'))), dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.height = h + 'px'; }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const left = 48, right = w - (y2 ? 44 : 14), top = 18, bottom = h - 36, fs = w < 600 ? 11 : 10; let lastLabelX = -1e9, labelRow = 0;
  const X = x => left + (x - xMin) / (xMax - xMin) * (right - left), Y = y => bottom - (y - yMin) / (yMax - yMin) * (bottom - top);
  const Y2 = y2 ? y => bottom - (y - y2.min) / (y2.max - y2.min) * (bottom - top) : null;
  ctx.font = `${fs}px -apple-system, sans-serif`; ctx.lineWidth = 1;
  for (const y of yTicks) { ctx.strokeStyle = colors.grid; ctx.beginPath(); ctx.moveTo(left, Y(y)); ctx.lineTo(right, Y(y)); ctx.stroke(); ctx.fillStyle = colors.text; ctx.textAlign = 'right'; ctx.fillText(y, left - 7, Y(y) + 3); }
  if (y2) for (const y of y2.ticks) { ctx.fillStyle = colors.hr; ctx.textAlign = 'left'; ctx.fillText(y, right + 6, Y2(y) + 3); }
  for (const x of xTicks) { ctx.strokeStyle = colors.grid; ctx.beginPath(); ctx.moveTo(X(x), top); ctx.lineTo(X(x), bottom); ctx.stroke(); ctx.fillStyle = colors.text; ctx.textAlign = 'center'; ctx.fillText(x, X(x), bottom + 15); }
  ctx.fillStyle = colors.text; ctx.textAlign = 'left'; ctx.fillText(yLabel, 3, 11); if (y2) { ctx.textAlign = 'right'; ctx.fillStyle = colors.hr; ctx.fillText(y2.label, w - 3, 11); }
  ctx.fillStyle = colors.text; ctx.textAlign = 'center'; ctx.fillText(xLabel, (left + right) / 2, h - 5);
  const clip = fn => { ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip(); fn(); ctx.restore(); };
  const line = (pts, color, { dashed = false, width = 2, alpha = 1, axis2 = false } = {}) => clip(() => {
    const YY = axis2 ? Y2 : Y; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha; ctx.setLineDash(dashed ? [5, 4] : []); ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(X(p.x), YY(p.y)) : ctx.moveTo(X(p.x), YY(p.y))); ctx.stroke(); });
  const vline = (x, label) => clip(() => { ctx.strokeStyle = '#737373'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(X(x), top); ctx.lineTo(X(x), bottom); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#4d4d4d'; ctx.font = `600 ${fs}px -apple-system, sans-serif`; ctx.textAlign = 'left';
    labelRow = X(x) - lastLabelX < 46 ? labelRow + 1 : 0; lastLabelX = X(x); ctx.fillText(label, X(x) + 4, top + 11 + 13 * labelRow); }); // stagger labels that would touch
  const fill = (pts, color) => clip(() => { ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(X(pts[0].x), Y(yMin)); pts.forEach(p => ctx.lineTo(X(p.x), Y(p.y))); ctx.lineTo(X(pts[pts.length - 1].x), Y(yMin)); ctx.closePath(); ctx.fill(); });
  return { ctx, X, Y, Y2, line, vline, fill, clip, left, right, top, bottom };
}

const minutes = p => p.t / 60;
function visible(series) { return series.filter(p => p.t <= tNow); }
function markers(g, r, { rcp = false } = {}) {
  g.vline(r.rampStart / 60, 'Ramp');
  if (r.atTime && tNow >= r.atTime) g.vline(r.atTime / 60, 'AT');
  if (rcp && r.rcpTime && tNow >= r.rcpTime) g.vline(r.rcpTime / 60, 'RCP');
  if (tNow >= r.stopAt) g.vline(r.stopAt / 60, 'VO₂max');
}
function drawAll() {
  const r = sim, overlay = $('overlay').checked, tMax = Math.max(16, Math.ceil(Math.max(r.series[r.series.length - 1].t, healthy.series[healthy.series.length - 1].t) / 60) + 1);
  const xTicks = Array.from({ length: Math.floor(tMax / 2) + 1 }, (_, i) => 2 * i);
  const vis = visible(r.series);
  // 1. VO2, VCO2, HR.
  const yMax = Math.max(3.5, Math.ceil(Math.max(r.peak.vco2, r.peak.vo2, overlay ? healthy.peak.vco2 : 0) / 500) * 0.5);
  let g = chart('c-gas', { xMin: 0, xMax: tMax, yMin: 0, yMax, xLabel: 'Time from start (min)', yLabel: 'L/min', xTicks, yTicks: Array.from({ length: Math.round(yMax / 0.5) + 1 }, (_, i) => +(i * 0.5).toFixed(1)), y2: { min: 0, max: 200, ticks: [0, 50, 100, 150, 200], label: 'HR /min' } });
  const workMax = Math.max(...r.series.map(p => p.work), 1);
  g.fill(vis.map(p => ({ x: minutes(p), y: yMax * 0.9 * p.work / Math.max(workMax, healthy.peak.work) })), colors.work);
  if (overlay) { g.line(healthy.series.map(p => ({ x: minutes(p), y: p.vo2 / 1000 })), colors.o2, { dashed: true, width: 1.2, alpha: 0.8 }); }
  g.line(vis.map(p => ({ x: minutes(p), y: p.vo2 / 1000 })), colors.o2); g.line(vis.map(p => ({ x: minutes(p), y: p.vco2 / 1000 })), colors.co2); g.line(vis.map(p => ({ x: minutes(p), y: p.hr })), colors.hr, { axis2: true });
  markers(g, r);
  // 2. Ventilatory equivalents.
  g = chart('c-eq', { xMin: 0, xMax: tMax, yMin: 0, yMax: 70, xLabel: 'Time from start (min)', yLabel: 'V̇E/V̇O₂ and V̇E/V̇CO₂', xTicks, yTicks: [0, 10, 20, 30, 40, 50, 60, 70] });
  g.line(vis.map(p => ({ x: minutes(p), y: p.veVo2 })), colors.o2); g.line(vis.map(p => ({ x: minutes(p), y: p.veVco2 })), colors.co2);
  markers(g, r, { rcp: true });
  // 3. V-slope.
  const vmax = Math.max(3.5, Math.ceil(Math.max(r.peak.vo2, r.peak.vco2) / 500) * 0.5);
  g = chart('c-vslope', { xMin: 0, xMax: vmax, yMin: 0, yMax: vmax, xLabel: 'V̇O₂ (L/min)', yLabel: 'V̇CO₂ (L/min)', xTicks: Array.from({ length: Math.round(vmax) + 1 }, (_, i) => i), yTicks: Array.from({ length: Math.round(vmax) + 1 }, (_, i) => i) });
  g.line([{ x: 0, y: 0 }, { x: vmax, y: vmax }], '#737373', { dashed: true, width: 1 });
  g.line(vis.filter(p => p.phase !== 'recovery').map(p => ({ x: p.vo2 / 1000, y: p.vco2 / 1000 })), colors.co2);
  if (r.at && tNow >= r.stopAt) { const x = g.X(r.at.vo2 / 1000), y = g.Y(r.at.vco2 / 1000); g.ctx.fillStyle = colors.o2; g.ctx.beginPath(); g.ctx.arc(x, y, 4.5, 0, 7); g.ctx.fill(); g.ctx.font = '600 11px -apple-system, sans-serif'; g.ctx.textAlign = 'left'; g.ctx.fillText('AT', x + 8, y + 4); }
  // 4. VE, MVV, SpO2.
  const veMax = Math.max(160, Math.ceil(Math.max(r.summary.mvv, r.predicted.mvv) / 20) * 20 + 20);
  g = chart('c-ve', { xMin: 0, xMax: tMax, yMin: 0, yMax: veMax, xLabel: 'Time from start (min)', yLabel: 'V̇E (L/min)', xTicks, yTicks: Array.from({ length: veMax / 40 + 1 }, (_, i) => i * 40), y2: { min: 70, max: 100, ticks: [70, 80, 90, 100], label: 'SpO₂ %' } });
  g.line([{ x: 0, y: r.summary.mvv }, { x: tMax, y: r.summary.mvv }], '#4d4d4d', { dashed: true, width: 1.3 });
  g.ctx.fillStyle = '#4d4d4d'; g.ctx.font = '600 10px -apple-system, sans-serif'; g.ctx.textAlign = 'right'; g.ctx.fillText(`MVV ${Math.round(r.summary.mvv)}`, g.right - 4, g.Y(r.summary.mvv) - 5);
  if (overlay) g.line(healthy.series.map(p => ({ x: minutes(p), y: p.ve })), colors.co2, { dashed: true, width: 1.2, alpha: 0.8 });
  g.line(vis.map(p => ({ x: minutes(p), y: p.ve })), colors.co2); g.line(vis.map(p => ({ x: minutes(p), y: p.spo2 })), colors.hr, { axis2: true });
  markers(g, r);
}

const ROWS = [
  ['Work'], ['work', 'Work rate (W)', 0, 'work'], ['mets', 'METs', 1, null],
  ['O₂ consumption'], ['vo2kg', 'V̇O₂ (mL/kg/min)', 1, 'vo2kg'], ['vo2', 'V̇O₂ (mL/min)', 0, 'vo2max'], ['vco2', 'V̇CO₂ (mL/min)', 0, null], ['rer', 'R (RER)', 2, null],
  ['Ventilation'], ['ve', 'V̇E (L/min); Pred = this patient’s MVV, % = % of MVV', 1, 'mvv'], ['vt', 'V<sub>T</sub> (L)', 2, null], ['rr', 'Breathing rate (/min)', 0, null], ['spo2', 'SpO₂ (%)', 0, null],
  ['Cardiac'], ['hr', 'Heart rate (/min)', 0, 'hrMax'], ['o2pulse', 'O₂ pulse (mL/beat)', 1, 'o2pulse'],
  ['Gas exchange efficiency'], ['veVo2', 'V̇E/V̇O₂', 0, null], ['veVco2', 'V̇E/V̇CO₂', 0, null],
];
function renderReport() {
  const r = sim, done = tNow >= r.series[r.series.length - 1].t, show = (v, dp) => done && v != null ? v.toFixed(dp) : '…';
  let html = '<div class="table-scroll"><table><caption class="sr-only">CPET report</caption><thead><tr><th scope="col"><span class="sr-only">Measure</span></th><th scope="col">Rest</th><th scope="col">AT</th><th scope="col">VO₂max (peak)</th><th scope="col">Pred</th><th scope="col">Peak %Pred</th></tr></thead><tbody>';
  for (const row of ROWS) {
    if (row.length === 1) { html += `<tr class="section"><th colspan="6">${row[0]}</th></tr>`; continue; }
    // VE is compared with this patient's own MVV (FEV1 x 40), so its percent is 100 minus the respiratory reserve.
    const [k, label, dp, pk] = row, pred = k === 've' ? r.summary.mvv : pk ? r.predicted[pk] : null, pct = pred ? 100 * r.peak[k] / pred : null;
    const C = CUTOFFS, rp = pct != null ? Math.round(pct) : null;
    const flag = done && (k === 've' ? Math.round(r.summary.breathingReserve) < C.reserve : k === 'spo2' ? Math.round(r.summary.spo2Drop) >= C.spo2Drop
      : k === 'hr' ? rp <= C.hr : k === 'vo2' || k === 'vo2kg' ? rp < C.vo2 : k === 'rer' ? Number(r.peak.rer.toFixed(2)) < C.r : k === 'veVco2' ? r.at && Math.round(r.at.veVco2) > C.veVco2 : rp != null && rp < C.o2pulse);
        const fc = flag ? ' class="flag"' : '', atFlag = flag && k === 'veVco2'; // VE/VCO2 is judged at AT; every other flag is a peak value
    html += `<tr${flag ? ' class="flag-row"' : ''}><th scope="row">${label}</th><td>${show(r.rest[k], dp)}</td><td${atFlag ? fc : ''}>${r.at ? show(r.at[k], dp) : '–'}</td><td${atFlag ? '' : fc}>${show(r.peak[k], dp)}</td><td>${pred != null ? pred.toFixed(dp) : ''}</td><td${atFlag ? '' : fc}>${done && pct != null ? Math.round(pct) : ''}</td></tr>`;
  }
  html += '</tbody></table></div>';
  const s = r.summary;
  html += `<div class="cpet-summary"><div class="metric"><div class="metric-label">Respiratory reserve, 1 − V̇E/MVV</div><div class="metric-value">${done ? Math.round(s.breathingReserve) : '…'}<span class="metric-unit">%</span></div></div><div class="metric"><div class="metric-label">Heart rate reserve (pred − peak)</div><div class="metric-value">${done ? Math.round(s.heartRateReserve) : '…'}<span class="metric-unit">/min (${done ? Math.round(s.heartRateReservePct) : '…'}%)</span></div></div><div class="metric"><div class="metric-label">VO₂max, % predicted</div><div class="metric-value">${done ? Math.round(s.vo2PeakPct) : '…'}<span class="metric-unit">%</span></div></div><div class="metric"><div class="metric-label">Exercise time on the ramp</div><div class="metric-value">${done ? ((r.stopAt - r.rampStart) / 60).toFixed(1) : '…'}<span class="metric-unit">min</span></div></div></div>`;
  $('report').innerHTML = html;
}
const CTA = 'Decide what limited this patient, then show the stepwise interpretation';
function renderInterpretation() {
  const done = tNow >= sim.series[sim.series.length - 1].t, box = $('interp-box');
  const summary = box.querySelector('summary'), cta = box.querySelector('.interp-cta');
  if (!done) {
    box.open = false; box.classList.add('waiting'); summary.setAttribute('aria-disabled', 'true'); cta.textContent = 'The stepwise interpretation is available when the run finishes';
    for (const id of ['c-gas', 'c-eq', 'c-vslope', 'c-ve']) $(id).setAttribute('aria-label', 'Chart drawing as the test runs');
    return;
  }
  box.classList.remove('waiting'); summary.removeAttribute('aria-disabled'); cta.textContent = CTA;
  const out = interpretCPET(sim);
  // Text equivalents for the charts, with the numbers a sighted student reads off them (QA-03).
  const r = sim, s = r.summary, min = t => t == null ? 'not reached' : `${(t / 60).toFixed(1)} min`;
  $('c-gas').setAttribute('aria-label', `VO2, VCO2, and heart rate over time. Rest VO2 ${(r.rest.vo2 / 1000).toFixed(2)} L/min, peak ${(r.peak.vo2 / 1000).toFixed(2)} L/min at ${min(r.stopAt)}; peak VCO2 ${(r.peak.vco2 / 1000).toFixed(2)} L/min; heart rate ${Math.round(r.rest.hr)} rising to ${Math.round(r.peak.hr)} per minute. Anaerobic threshold at ${min(r.atTime)}.`);
  $('c-eq').setAttribute('aria-label', `Ventilatory equivalents over time. VE/VCO2 ${r.rest.veVco2.toFixed(0)} at rest, ${r.at ? r.at.veVco2.toFixed(0) : 'not measured'} at the anaerobic threshold, ${r.peak.veVco2.toFixed(0)} at peak; VE/VO2 ${r.peak.veVo2.toFixed(0)} at peak. Respiratory compensation point at ${min(r.rcpTime)}.`);
  $('c-vslope').setAttribute('aria-label', `V-slope: VCO2 against VO2. ${r.at ? `The slope steepens at the anaerobic threshold, VO2 ${(r.at.vo2 / 1000).toFixed(2)} L/min.` : 'No anaerobic threshold was reached.'}`);
  $('c-ve').setAttribute('aria-label', `Minute ventilation over time against the MVV line at ${Math.round(s.mvv)} L/min. Peak VE ${r.peak.ve.toFixed(0)} L/min, respiratory reserve ${Math.round(s.breathingReserve)}%. SpO2 ${r.rest.spo2.toFixed(0)}% at rest and ${r.peak.spo2.toFixed(0)}% at peak.`);
  $('interp-steps').innerHTML = out.steps.map(x => `<li><strong>${x.q}</strong><br>${x.a}</li>`).join('');
  $('interp-result').innerHTML = `<strong>${out.pattern}.</strong> ${out.consistent}`;
}
function render() { $('subject').textContent = `${sim.settings.age}-year-old man, ${sim.settings.weight} kg, ${sim.settings.rampRate} W/min ramp`; drawAll(); renderReport(); renderInterpretation(); for (const [k, m] of Object.entries(SLIDERS)) { const t = m.fmt(settings[k]); $('o-' + k).textContent = t; $('s-' + k).setAttribute('aria-valuetext', t); } }
function update() { sim = simulate(settings); if (!playing) tNow = Infinity; render(); }

function frame(now) {
  if (!playing) return;
  tNow += (now - lastFrame) / 1000 * SPEED; lastFrame = now;
  if (tNow >= sim.series[sim.series.length - 1].t) { playing = false; tNow = Infinity; $('run').textContent = '▶ Run the test'; }
  render(); if (playing) requestAnimationFrame(frame);
}
function run() {
  if (playing) { playing = false; tNow = Infinity; $('run').textContent = '▶ Run the test'; render(); return; }
  playing = true; tNow = 0; lastFrame = performance.now(); $('run').textContent = '■ Skip to results'; requestAnimationFrame(frame);
}

function readSliders() { for (const [k, m] of Object.entries(SLIDERS)) settings[k] = m.toModel(Number($('s-' + k).value)); }
function writeSliders() { for (const [k, m] of Object.entries(SLIDERS)) $('s-' + k).value = m.toSlider(settings[k]); }
function matchPreset() { const p = CPET_PRESETS[presetKey].settings; return Object.keys(SLIDERS).every(k => Math.abs(p[k] - settings[k]) < 1e-6) ? presetKey : 'custom'; }
function setQuestion(k) { const [t, q] = QUESTIONS[k] || QUESTIONS.custom; $('question-title').textContent = t; $('question').textContent = q; }
function loadPreset(k) { presetKey = k; settings = { ...CPET_PRESETS[k].settings }; writeSliders(); setQuestion(k); update(); }

function exportCsv() {
  const keys = ['t', 'phase', 'work', 'vo2', 'vco2', 'rer', 've', 'vt', 'rr', 'hr', 'o2pulse', 'spo2', 'veVo2', 'veVco2'];
  const rows = [keys, ...sim.series.filter((_, i) => i % 5 === 0).map(p => keys.map(k => typeof p[k] === 'number' ? +p[k].toFixed(3) : p[k]))];
  rows.push([], ['settings', JSON.stringify(settings).replaceAll(',', ';')]);
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([rows.map(x => x.join(',')).join('\n')], { type: 'text/csv' })), download: 'cpet.csv' });
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

$('preset').innerHTML = Object.entries(CPET_PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
$('load').addEventListener('click', () => loadPreset($('preset').value));
$('reset').addEventListener('click', () => { $('preset').value = 'normal'; loadPreset('normal'); });
for (const [k, m] of Object.entries(SLIDERS)) $('s-' + k).addEventListener('input', () => { settings[k] = m.toModel(Number($('s-' + k).value)); setQuestion(matchPreset()); update(); });
$('interp-box').querySelector('summary').addEventListener('click', e => { if ($('interp-box').classList.contains('waiting')) e.preventDefault(); });
$('overlay').addEventListener('change', render); $('run').addEventListener('click', run); $('export').addEventListener('click', exportCsv);
window.addEventListener('resize', render);
loadPreset('normal');
window.cpetModel = { simulate, get result() { return sim; } };
