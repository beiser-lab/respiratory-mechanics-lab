import { simulate, interpretCPET, CPET_PRESETS, CPET_DEFAULTS, predicted } from './cpet-model.js?v=21';

const $ = id => document.getElementById(id);
const colors = { o2: '#800000', co2: '#155f83', hr: '#a65e00', grid: '#eaf0f2', axis: '#aebdc4', text: '#666666', work: 'rgba(128,128,128,0.10)' };

const QUESTIONS = {
  normal: ['What stops a healthy person?', 'At peak exercise, is heart rate near its predicted maximum? How much breathing reserve is left? What does that tell you about which system limits exercise in health?'],
  professor: ['Male physiology professor', 'Peak VO2 is only about 76% of predicted, yet peak work is near predicted and breathing reserve is large. Is this test normal? Why does a fast ramp (34 W/min) lower the measured peak VO2? Compare the simulation with his actual numbers below the report.'],
  athlete: ['A bigger engine', 'Peak VO2 is far above predicted, but peak heart rate is about the same as the healthy subject. Which part of the Fick equation changed with training? Look at the O2 pulse. Why can SpO2 fall a few points in an elite athlete with normal lungs?'],
  copdHf: ['Would a new heart help?', 'This patient has both COPD and heart failure and is being evaluated for heart transplant. Which ceiling does each system set? If the heart were replaced, what would stop exercise next?'],
  deconditioned: ['Out of shape', 'Peak VO2 and the anaerobic threshold are low, yet heart rate reaches its maximum and breathing reserve is large. Why does heart rate climb so fast? What would training change?'],
  heartFailure: ['Heart failure', 'Compare O2 pulse with the healthy subject. Why is it low? Why is VE/VCO2 high even though the lungs are normal?'],
  copd: ['COPD', 'What is the breathing reserve at peak, and how much heart rate reserve is left? Which system stopped this patient? Why is peak RER low?'],
  ild: ['Interstitial lung disease', 'Look at tidal volume and breathing rate at peak, and at SpO2. Why does a stiff lung force rapid, shallow breathing? Why does SpO2 fall with exercise but not at rest?'],
  pulmVascular: ['Pulmonary vascular disease', 'Spirometry is normal and breathing reserve is left over, yet the patient desaturates and VE/VCO2 is very high. Where in the chain from air to muscle is the problem?'],
  anemia: ['Anemia', 'The heart and lungs are normal. Use CaO2 in the Fick equation to explain the low peak VO2 and low O2 pulse.'],
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
  const left = 48, right = w - (y2 ? 44 : 14), top = 18, bottom = h - 36;
  const X = x => left + (x - xMin) / (xMax - xMin) * (right - left), Y = y => bottom - (y - yMin) / (yMax - yMin) * (bottom - top);
  const Y2 = y2 ? y => bottom - (y - y2.min) / (y2.max - y2.min) * (bottom - top) : null;
  ctx.font = '10px -apple-system, sans-serif'; ctx.lineWidth = 1;
  for (const y of yTicks) { ctx.strokeStyle = colors.grid; ctx.beginPath(); ctx.moveTo(left, Y(y)); ctx.lineTo(right, Y(y)); ctx.stroke(); ctx.fillStyle = colors.text; ctx.textAlign = 'right'; ctx.fillText(y, left - 7, Y(y) + 3); }
  if (y2) for (const y of y2.ticks) { ctx.fillStyle = colors.hr; ctx.textAlign = 'left'; ctx.fillText(y, right + 6, Y2(y) + 3); }
  for (const x of xTicks) { ctx.strokeStyle = colors.grid; ctx.beginPath(); ctx.moveTo(X(x), top); ctx.lineTo(X(x), bottom); ctx.stroke(); ctx.fillStyle = colors.text; ctx.textAlign = 'center'; ctx.fillText(x, X(x), bottom + 15); }
  ctx.fillStyle = colors.text; ctx.textAlign = 'left'; ctx.fillText(yLabel, 3, 11); if (y2) { ctx.textAlign = 'right'; ctx.fillStyle = colors.hr; ctx.fillText(y2.label, w - 3, 11); }
  ctx.fillStyle = colors.text; ctx.textAlign = 'center'; ctx.fillText(xLabel, (left + right) / 2, h - 5);
  const clip = fn => { ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip(); fn(); ctx.restore(); };
  const line = (pts, color, { dashed = false, width = 2, alpha = 1, axis2 = false } = {}) => clip(() => {
    const YY = axis2 ? Y2 : Y; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha; ctx.setLineDash(dashed ? [5, 4] : []); ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(X(p.x), YY(p.y)) : ctx.moveTo(X(p.x), YY(p.y))); ctx.stroke(); });
  const vline = (x, label) => clip(() => { ctx.strokeStyle = '#9a9a9a'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(X(x), top); ctx.lineTo(X(x), bottom); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#4d4d4d'; ctx.font = '600 10px -apple-system, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(label, X(x) + 4, top + 11); });
  const fill = (pts, color) => clip(() => { ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(X(pts[0].x), Y(yMin)); pts.forEach(p => ctx.lineTo(X(p.x), Y(p.y))); ctx.lineTo(X(pts.at(-1).x), Y(yMin)); ctx.closePath(); ctx.fill(); });
  return { ctx, X, Y, Y2, line, vline, fill, clip, left, right, top, bottom };
}

const minutes = p => p.t / 60;
function visible(series) { return series.filter(p => p.t <= tNow); }
function markers(g, r, { rcp = false } = {}) {
  g.vline(r.rampStart / 60, 'Ramp');
  if (r.atTime && tNow >= r.atTime) g.vline(r.atTime / 60, 'AT');
  if (rcp && r.rcpTime && tNow >= r.rcpTime) g.vline(r.rcpTime / 60, 'RCP');
  if (tNow >= r.stopAt) g.vline(r.stopAt / 60, 'Peak');
}
function drawAll() {
  const r = sim, overlay = $('overlay').checked, tMax = Math.max(16, Math.ceil(Math.max(r.series.at(-1).t, healthy.series.at(-1).t) / 60) + 1);
  const xTicks = Array.from({ length: Math.floor(tMax / 2) + 1 }, (_, i) => 2 * i);
  const vis = visible(r.series);
  // 1. VO2, VCO2, HR.
  const yMax = Math.max(3.5, Math.ceil(Math.max(r.peak.vco2, r.peak.vo2, overlay ? healthy.peak.vco2 : 0) / 500) * 0.5);
  let g = chart('c-gas', { xMin: 0, xMax: tMax, yMin: 0, yMax, xLabel: 'Time (min)', yLabel: 'L/min', xTicks, yTicks: Array.from({ length: Math.round(yMax / 0.5) + 1 }, (_, i) => +(i * 0.5).toFixed(1)), y2: { min: 0, max: 200, ticks: [0, 50, 100, 150, 200], label: 'HR /min' } });
  const workMax = Math.max(...r.series.map(p => p.work), 1);
  g.fill(vis.map(p => ({ x: minutes(p), y: yMax * 0.9 * p.work / Math.max(workMax, healthy.peak.work) })), colors.work);
  if (overlay) { g.line(healthy.series.map(p => ({ x: minutes(p), y: p.vo2 / 1000 })), colors.o2, { dashed: true, width: 1.2, alpha: 0.45 }); }
  g.line(vis.map(p => ({ x: minutes(p), y: p.vo2 / 1000 })), colors.o2); g.line(vis.map(p => ({ x: minutes(p), y: p.vco2 / 1000 })), colors.co2); g.line(vis.map(p => ({ x: minutes(p), y: p.hr })), colors.hr, { axis2: true });
  markers(g, r);
  // 2. Ventilatory equivalents.
  g = chart('c-eq', { xMin: 0, xMax: tMax, yMin: 0, yMax: 70, xLabel: 'Time (min)', yLabel: 'V̇E/V̇O₂ and V̇E/V̇CO₂', xTicks, yTicks: [0, 10, 20, 30, 40, 50, 60, 70] });
  g.line(vis.map(p => ({ x: minutes(p), y: p.veVo2 })), colors.o2); g.line(vis.map(p => ({ x: minutes(p), y: p.veVco2 })), colors.co2);
  markers(g, r, { rcp: true });
  // 3. V-slope.
  const vmax = Math.max(3.5, Math.ceil(Math.max(r.peak.vo2, r.peak.vco2) / 500) * 0.5);
  g = chart('c-vslope', { xMin: 0, xMax: vmax, yMin: 0, yMax: vmax, xLabel: 'V̇O₂ (L/min)', yLabel: 'V̇CO₂ (L/min)', xTicks: Array.from({ length: Math.round(vmax) + 1 }, (_, i) => i), yTicks: Array.from({ length: Math.round(vmax) + 1 }, (_, i) => i) });
  g.line([{ x: 0, y: 0 }, { x: vmax, y: vmax }], '#9a9a9a', { dashed: true, width: 1 });
  g.line(vis.filter(p => p.phase !== 'recovery').map(p => ({ x: p.vo2 / 1000, y: p.vco2 / 1000 })), colors.co2);
  if (r.at && tNow >= r.stopAt) { const x = g.X(r.at.vo2 / 1000), y = g.Y(r.at.vco2 / 1000); g.ctx.fillStyle = colors.o2; g.ctx.beginPath(); g.ctx.arc(x, y, 4.5, 0, 7); g.ctx.fill(); g.ctx.font = '600 10px -apple-system, sans-serif'; g.ctx.textAlign = 'left'; g.ctx.fillText('AT', x + 8, y + 4); }
  // 4. VE, MVV, SpO2.
  const veMax = Math.max(160, Math.ceil(Math.max(r.summary.mvv, r.predicted.mvv) / 20) * 20 + 20);
  g = chart('c-ve', { xMin: 0, xMax: tMax, yMin: 0, yMax: veMax, xLabel: 'Time (min)', yLabel: 'V̇E (L/min)', xTicks, yTicks: Array.from({ length: veMax / 40 + 1 }, (_, i) => i * 40), y2: { min: 70, max: 100, ticks: [70, 80, 90, 100], label: 'SpO₂ %' } });
  g.line([{ x: 0, y: r.summary.mvv }, { x: tMax, y: r.summary.mvv }], '#4d4d4d', { dashed: true, width: 1.3 });
  g.ctx.fillStyle = '#4d4d4d'; g.ctx.font = '600 10px -apple-system, sans-serif'; g.ctx.textAlign = 'right'; g.ctx.fillText(`MVV ${Math.round(r.summary.mvv)}`, g.right - 4, g.Y(r.summary.mvv) - 5);
  if (overlay) g.line(healthy.series.map(p => ({ x: minutes(p), y: p.ve })), colors.co2, { dashed: true, width: 1.2, alpha: 0.45 });
  g.line(vis.map(p => ({ x: minutes(p), y: p.ve })), colors.co2); g.line(vis.map(p => ({ x: minutes(p), y: p.spo2 })), colors.hr, { axis2: true });
  markers(g, r);
}

const ROWS = [
  ['Work'], ['work', 'Work rate (W)', 0, 'work'], ['mets', 'METs', 1, null],
  ['O₂ consumption'], ['vo2kg', 'V̇O₂ (mL/kg/min)', 1, 'vo2kg'], ['vo2', 'V̇O₂ (mL/min)', 0, 'vo2max'], ['vco2', 'V̇CO₂ (mL/min)', 0, null], ['rer', 'RER', 2, null],
  ['Ventilation'], ['ve', 'V̇E (L/min)', 1, 'mvv'], ['vt', 'V<sub>T</sub> (L)', 2, null], ['rr', 'Breathing rate (/min)', 0, null], ['spo2', 'SpO₂ (%)', 0, null],
  ['Cardiac'], ['hr', 'Heart rate (/min)', 0, 'hrMax'], ['o2pulse', 'O₂ pulse (mL/beat)', 1, 'o2pulse'],
  ['Gas exchange efficiency'], ['veVo2', 'V̇E/V̇O₂', 0, null], ['veVco2', 'V̇E/V̇CO₂', 0, null],
];
function renderReport() {
  const r = sim, done = tNow >= r.series.at(-1).t, show = (v, dp) => done && v != null ? v.toFixed(dp) : '…';
  let html = '<table><thead><tr><th></th><th>Rest</th><th>AT</th><th>Peak</th><th>Pred</th><th>Peak %Pred</th></tr></thead><tbody>';
  for (const row of ROWS) {
    if (row.length === 1) { html += `<tr class="section"><th colspan="6">${row[0]}</th></tr>`; continue; }
    const [k, label, dp, pk] = row, pred = pk ? r.predicted[pk] : null, pct = pred ? 100 * r.peak[k] / pred : null;
    const flag = done && ((k === 've') ? r.summary.breathingReserve < 15 : (k === 'spo2') ? r.summary.spo2Drop >= 4 : pct != null && pct < 80);
    html += `<tr class="${flag ? 'flag' : ''}"><td>${label}</td><td>${show(r.rest[k], dp)}</td><td>${r.at ? show(r.at[k], dp) : '–'}</td><td>${show(r.peak[k], dp)}</td><td>${pred != null ? pred.toFixed(dp) : ''}</td><td>${done && pct != null ? Math.round(pct) : ''}</td></tr>`;
  }
  html += '</tbody></table>';
  const s = r.summary;
  html += `<div class="cpet-summary"><div class="metric"><div class="metric-label">Breathing reserve (1 − V̇E/MVV)</div><div class="metric-value">${done ? Math.round(s.breathingReserve) : '…'}<span class="metric-unit">%</span></div></div><div class="metric"><div class="metric-label">Heart rate reserve (pred − peak)</div><div class="metric-value">${done ? Math.round(s.heartRateReserve) : '…'}<span class="metric-unit">/min</span></div></div><div class="metric"><div class="metric-label">Peak V̇O₂, % predicted</div><div class="metric-value">${done ? Math.round(s.vo2PeakPct) : '…'}<span class="metric-unit">%</span></div></div><div class="metric"><div class="metric-label">Exercise time on the ramp</div><div class="metric-value">${done ? ((r.stopAt - r.rampStart) / 60).toFixed(1) : '…'}<span class="metric-unit">min</span></div></div></div>`;
  const actual = CPET_PRESETS[presetKey]?.actual;
  if (actual && matchPreset() === presetKey && done) {
    const cell = (o, k, dp) => o && o[k] != null ? o[k].toFixed(dp) : '–';
    const rowsA = [['work', 'Work rate (W)', 0], ['vo2', 'V̇O₂ (mL/min)', 0], ['vco2', 'V̇CO₂ (mL/min)', 0], ['rer', 'RER', 2], ['ve', 'V̇E (L/min)', 1], ['vt', 'V<sub>T</sub> (L)', 2], ['rr', 'Breathing rate (/min)', 0], ['veVo2', 'V̇E/V̇O₂', 0], ['veVco2', 'V̇E/V̇CO₂', 0]];
    html += `<h3 class="actual-head">The professor's actual test</h3><table class="actual"><thead><tr><th></th><th>Rest</th><th>AT</th><th>Peak</th><th>Pred</th></tr></thead><tbody>` + rowsA.map(([k, l, dp]) => `<tr><td>${l}</td><td>${cell(actual.rest, k, dp)}</td><td>${cell(actual.at, k, dp)}</td><td>${cell(actual.peak, k, dp)}</td><td>${cell(actual.pred, k, dp)}</td></tr>`).join('') + `</tbody></table><p class="hint">Heart rate was not recorded. The professor's own read: average fitness, cardiac limited; the fast ramp and extra anaerobic work held peak V̇O₂ down. His peak RER (1.45) is higher than the model's because he sprinted at the end.</p>`;
  }
  $('report').innerHTML = html;
}
function renderInterpretation() {
  const done = tNow >= sim.series.at(-1).t, box = $('interp-box');
  if (!done) { box.open = false; box.classList.add('waiting'); return; }
  box.classList.remove('waiting');
  const out = interpretCPET(sim);
  $('interp-steps').innerHTML = out.steps.map(x => `<li><strong>${x.q}</strong><br>${x.a}</li>`).join('');
  $('interp-result').innerHTML = `<strong>${out.pattern}.</strong> ${out.consistent}`;
}
function render() { $('subject').textContent = `${sim.settings.age}-year-old man, ${sim.settings.weight} kg, ${sim.settings.rampRate} W/min ramp`; drawAll(); renderReport(); renderInterpretation(); for (const [k, m] of Object.entries(SLIDERS)) $('o-' + k).textContent = m.fmt(settings[k]); }
function update() { sim = simulate(settings); if (!playing) tNow = Infinity; render(); }

function frame(now) {
  if (!playing) return;
  tNow += (now - lastFrame) / 1000 * SPEED; lastFrame = now;
  if (tNow >= sim.series.at(-1).t) { playing = false; tNow = Infinity; $('run').textContent = '▶ Run the test'; }
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
  link.click(); URL.revokeObjectURL(link.href);
}

$('preset').innerHTML = Object.entries(CPET_PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
$('load').addEventListener('click', () => loadPreset($('preset').value));
$('reset').addEventListener('click', () => { $('preset').value = 'normal'; loadPreset('normal'); });
for (const k of Object.keys(SLIDERS)) $('s-' + k).addEventListener('input', () => { readSliders(); setQuestion(matchPreset()); update(); });
$('overlay').addEventListener('change', render); $('run').addEventListener('click', run); $('export').addEventListener('click', exportCsv);
window.addEventListener('resize', render);
loadPreset('normal');
window.cpetModel = { simulate, get result() { return sim; } };
