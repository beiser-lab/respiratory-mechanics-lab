import { simulate, PFT_PRESETS, PFT_DEFAULTS, PREDICTED } from './pft-model.js?v=11';
import { interpret } from './pft-interpret.js?v=11';

const $ = id => document.getElementById(id);
const colors = { patient: '#800000', healthy: '#4d4d4d', lung: '#a65e00', chestWall: '#155f83', grid: '#eaf0f2', axis: '#aebdc4', text: '#666666' };

const QUESTIONS = {
  normal: ['Read it like a consultant', 'Start with FEV1/FVC: is there obstruction? Then TLC: is there restriction? Then DLCO: is the problem in the alveoli? Load a patient and work through the same three questions.'],
  emphysema: ['72-year-old former smoker', 'Is FEV1/FVC below 0.70? Rank TLC, FRC, and RV by how far each rises. Why does RV rise the most? Why is DLCO low here but not in asthma? Look for the scoop on the flow-volume loop and the long tail on the volume-time curve.'],
  asthma: ['Obstruction that reverses', 'Check the box for after bronchodilator. How much does FEV1 change, in liters and in percent? Why is DLCO normal or high even though spirometry looks like emphysema?'],
  ild: ['Small, stiff lungs', 'TLC and FVC fall, but FEV1/FVC is normal or high. Use the flow-volume loop to explain why: at any given lung volume, is flow higher or lower than normal? What does the low DLCO add?'],
  obesity: ['A load on the chest wall', 'TLC, FRC, and RV all fall, but one volume falls the most. Which is it, and why? Compare ERV here with the other restrictive patients. Why is DLCO normal?'],
  neuromuscular: ['Small Group 4: weak muscles', 'Compare TLC, FRC, and RV as percent predicted. What is the step-up pattern, and why does FRC stay normal? Now check tested supine. What changes, and why?'],
  upperAirway: ['The next room over', 'Both limbs of the flow-volume loop are cut off flat. Where along the airway must the obstruction be for flow to be capped in both directions? Why is DLCO normal?'],
  anemia: ['Normal lungs, low DLCO', 'Spirometry and lung volumes are normal. Why is the uncorrected DLCO low, and why does the hemoglobin-corrected value come back to normal?'],
  custom: ['Your own patient', 'Predict the report before you look: which numbers should move, and in which direction?'],
};

const log2 = { toModel: v => 2 ** v, toSlider: x => Math.log2(x), fmt: x => x.toFixed(2) + '×' };
const SLIDERS = {
  lungCompliance: log2, chestWallCompliance: log2,
  chestWallLoad: { toModel: v => v, toSlider: x => x, fmt: x => x.toFixed(1).replace(/\.0$/, '') + ' cmH₂O' },
  muscleStrength: { toModel: v => v, toSlider: x => x, fmt: x => Math.round(x * 100) + '%' },
  airwayResistance: { toModel: v => 2 ** v, toSlider: x => Math.log2(x), fmt: x => x.toFixed(1) + '×' },
  airwayCollapsibility: { toModel: v => 10 ** (0.9 * v), toSlider: x => Math.log10(x) / 0.9, fmt: x => (x < 10 ? x.toFixed(1) : Math.round(x)) + '×' },
  upperAirwayLimit: { toModel: v => v, toSlider: x => x, fmt: x => x === 0 ? 'none' : x.toFixed(2).replace(/0$/, '') + ' L/s' },
  membrane: { toModel: v => v, toSlider: x => x, fmt: x => Math.round(x * 100) + '%' },
  capillaryVolume: { toModel: v => v, toSlider: x => x, fmt: x => Math.round(x * 100) + '%' },
  hemoglobin: { toModel: v => v, toSlider: x => x, fmt: x => x.toFixed(1) + ' g/dL' },
};

let presetKey = 'normal', settings = { ...PFT_DEFAULTS }, sim = null, timeline = null, playing = false, tNow = Infinity, lastFrame = 0;
const healthySim = simulate(PFT_DEFAULTS);

function readSliders() { for (const [k, m] of Object.entries(SLIDERS)) settings[k] = m.toModel(Number($('s-' + k).value)); }
function writeSliders() { for (const [k, m] of Object.entries(SLIDERS)) $('s-' + k).value = m.toSlider(settings[k]); }
function currentPresetSettings() {
  const p = PFT_PRESETS[presetKey]; let s = { ...p.settings };
  if (p.bronchodilator && $('bronchodilator').checked) s = { ...s, ...p.bronchodilator };
  if (p.supine && $('supine').checked) s = { ...s, ...p.supine };
  return s;
}

// ---------- the composite spirometry maneuver ----------
function buildTimeline(sm) {
  const r = sm.report, pts = [], VT = 0.5, period = 4;
  let t = 0; const push = (v, phase) => pts.push({ t, v, phase });
  const dt = 0.02;
  for (; t < 3 * period - 1e-9; t += dt) push(r.frc + VT / 2 * (1 - Math.cos(2 * Math.PI * t / period)), 'tidal');
  const t0 = t; for (let u = 0; u <= 2.5; u += dt) { t = t0 + u; push(r.frc + (r.tlc - r.frc) * (1 - Math.cos(Math.PI * u / 2.5)) / 2, 'maxInsp'); }
  const tExp = t; for (const p of sm.expiration.filter((_, i) => i % 5 === 0)) { t = tExp + p.t; push(p.v, 'forcedExp'); }
  const tIns = t; for (const p of sm.inspiration.filter((_, i) => i % 5 === 0)) { t = tIns + p.t; push(p.v, 'forcedInsp'); }
  const tBack = t; for (let u = 0; u <= 3; u += dt) { t = tBack + u; push(r.tlc + (r.frc - r.tlc) * (1 - Math.cos(Math.PI * u / 3)) / 2, 'return'); }
  const tTid = t; for (let u = 0; u <= period; u += dt) { t = tTid + u; push(r.frc + VT / 2 * (1 - Math.cos(2 * Math.PI * u / period)), 'tidal'); }
  return { pts, tExp, tIns, end: t };
}

// ---------- charts ----------
function chart(id, { xMin, xMax, yMin, yMax, xLabel, yLabel, xTicks, yTicks, margin = {} }) {
  const canvas = $(id), r = canvas.getBoundingClientRect(), w = r.width;
  const h = Number(canvas.dataset.logicalHeight || (canvas.dataset.logicalHeight = canvas.getAttribute('height'))), dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.height = h + 'px'; }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const left = margin.left ?? 46, right = w - (margin.right ?? 16), top = 18, bottom = h - 36;
  const X = x => left + (x - xMin) / (xMax - xMin) * (right - left), Y = y => bottom - (y - yMin) / (yMax - yMin) * (bottom - top);
  ctx.font = '10px -apple-system, sans-serif'; ctx.lineWidth = 1;
  for (const y of yTicks) { ctx.strokeStyle = y === 0 ? colors.axis : colors.grid; ctx.beginPath(); ctx.moveTo(left, Y(y)); ctx.lineTo(right, Y(y)); ctx.stroke(); ctx.fillStyle = colors.text; ctx.textAlign = 'right'; ctx.fillText(y, left - 7, Y(y) + 3); }
  for (const x of xTicks) { ctx.strokeStyle = colors.grid; ctx.beginPath(); ctx.moveTo(X(x), top); ctx.lineTo(X(x), bottom); ctx.stroke(); ctx.fillStyle = colors.text; ctx.textAlign = 'center'; ctx.fillText(x, X(x), bottom + 15); }
  ctx.fillStyle = colors.text; ctx.textAlign = 'left'; ctx.fillText(yLabel, 3, 11); ctx.textAlign = 'center'; ctx.fillText(xLabel, (left + right) / 2, h - 5);
  const clip = fn => { ctx.save(); ctx.beginPath(); ctx.rect(left, top - 6, right - left, bottom - top + 6); ctx.clip(); fn(); ctx.restore(); };
  const line = (pts, color, { dashed = false, width = 2.2, alpha = 1 } = {}) => clip(() => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha; ctx.setLineDash(dashed ? [5, 4] : []); ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))); ctx.stroke(); });
  const dot = (x, y, color, r = 4.5) => { ctx.setLineDash([]); ctx.fillStyle = color; ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); };
  const text = (s, x, y, { color = colors.text, align = 'left', bold = false, dx = 0, dy = 0 } = {}) => { ctx.fillStyle = color; ctx.font = `${bold ? '600 ' : ''}10px -apple-system, sans-serif`; ctx.textAlign = align; ctx.fillText(s, X(x) + dx, Y(y) + dy); };
  return { ctx, X, Y, left, right, top, bottom, line, dot, text, clip };
}

function drawTracing(tl, r) {
  const g = chart('tracing', { xMin: 0, xMax: Math.max(40, Math.ceil(tl.end / 5) * 5), yMin: 0, yMax: 7.5, xLabel: 'Time (s)', yLabel: 'Lung volume (L)', xTicks: [0, 10, 20, 30, 40, 50].filter(x => x <= Math.max(40, tl.end)), yTicks: [0, 1, 2, 3, 4, 5, 6, 7], margin: { right: 215 } });
  // RV cannot be measured by spirometry.
  g.ctx.save(); g.ctx.fillStyle = 'rgba(128,128,128,0.10)'; g.ctx.fillRect(g.left, g.Y(r.rv), g.right - g.left, g.Y(0) - g.Y(r.rv)); g.ctx.restore();
  g.line(tl.pts.filter(p => p.t <= tNow).map(p => ({ x: p.t, y: p.v })), colors.patient);
  // Volume and capacity brackets, as in the Small Group 1 figure.
  const ctx = g.ctx, vT = r.frc + 0.5;
  const bracket = (col, y0, y1, label) => {
    const x = g.right + 10 + col * 52, a = g.Y(y0), b = g.Y(y1);
    ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(x, a); ctx.lineTo(x + 4, a); ctx.moveTo(x, a); ctx.lineTo(x, b); ctx.moveTo(x, b); ctx.lineTo(x + 4, b); ctx.stroke();
    ctx.fillStyle = '#4d4d4d'; ctx.font = '600 10px -apple-system, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(label, x + 7, (a + b) / 2 + 3);
  };
  bracket(0, r.tlc, vT, 'IRV'); bracket(0, vT, r.frc, 'TV'); bracket(0, r.frc, r.rv, 'ERV'); bracket(0, r.rv, 0, 'RV');
  bracket(1, r.tlc, r.frc, 'IC'); bracket(1, r.frc, 0, 'FRC'); bracket(2, r.tlc, r.rv, 'VC'); bracket(3, r.tlc, 0, 'TLC');
  for (const [v, l] of [[r.tlc, 'TLC'], [r.frc, 'FRC'], [r.rv, 'RV']]) { ctx.strokeStyle = '#c4c4c4'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(g.left, g.Y(v)); ctx.lineTo(g.right, g.Y(v)); ctx.stroke(); }
  ctx.setLineDash([]);
  const cur = tl.pts.filter(p => p.t <= tNow).at(-1); if (playing && cur) g.dot(cur.t, cur.v, colors.patient);
}

function fvPoints(sm, absolute) {
  const tlc = sm.report.tlc, x = v => absolute ? v : tlc - v;
  return [...sm.expiration.filter((_, i) => i % 4 === 0).map(p => ({ x: x(p.v), y: p.flow, t: p.t, phase: 'e' })), ...sm.inspiration.filter((_, i) => i % 4 === 0).map(p => ({ x: x(p.v), y: -p.flow, t: p.t, phase: 'i' }))];
}
function drawFlowVolume(sm, tl) {
  const absolute = $('absolute').checked;
  $('fv-note').textContent = absolute ? 'Absolute lung volume: needs plethysmography for RV and TLC' : 'Volume exhaled from TLC, as on a report';
  const g = absolute
    ? chart('fv', { xMin: 7.5, xMax: 1, yMin: -8, yMax: 12, xLabel: 'Lung volume (L)  ← TLC        RV →', yLabel: 'Flow (L/s)', xTicks: [7, 6, 5, 4, 3, 2, 1], yTicks: [-8, -4, 0, 4, 8, 12] })
    : chart('fv', { xMin: 0, xMax: 5.5, yMin: -8, yMax: 12, xLabel: 'Volume exhaled from TLC (L)', yLabel: 'Flow (L/s)', xTicks: [0, 1, 2, 3, 4, 5], yTicks: [-8, -4, 0, 4, 8, 12] });
  g.text('Expiration', absolute ? 7.4 : 0.1, 11, { bold: true, dy: 4 }); g.text('Inspiration', absolute ? 7.4 : 0.1, -7.2, { bold: true });
  if ($('overlay').checked) g.line(fvPoints(healthySim, absolute), colors.healthy, { dashed: true, width: 1.3, alpha: 0.5 });
  const shown = fvPoints(sm, absolute).filter(p => tNow >= tl.end || (p.phase === 'e' ? tl.tExp + p.t <= tNow : tl.tIns + p.t <= tNow));
  g.line(shown, colors.patient);
  const tl0 = sm.report.tlc, ev = sm.expiration.at(-1).v;
  if (tNow >= tl.end) { g.text('TLC', absolute ? tl0 : 0, 0, { align: 'center', dy: 14, bold: true }); g.text(absolute ? 'RV' : 'RV (FVC)', absolute ? ev : tl0 - ev, 0, { align: 'center', dy: 14, bold: true }); }
}
function drawVolumeTime(sm, tl) {
  const tMax = 14, g = chart('vt', { xMin: 0, xMax: tMax, yMin: 0, yMax: 5.5, xLabel: 'Time (s)', yLabel: 'Volume exhaled (L)', xTicks: [0, 1, 2, 4, 6, 8, 10, 12, 14], yTicks: [0, 1, 2, 3, 4, 5] });
  const series = s => s.expiration.filter((_, i) => i % 5 === 0).map(p => ({ x: p.t, y: s.report.tlc - p.v }));
  if ($('overlay').checked) g.line(series(healthySim), colors.healthy, { dashed: true, width: 1.3, alpha: 0.5 });
  const elapsed = tNow >= tl.end ? Infinity : tNow - tl.tExp;
  g.line(series(sm).filter(p => p.x <= elapsed), colors.patient);
  const r = sm.report; g.ctx.save(); g.ctx.strokeStyle = '#9a9a9a'; g.ctx.setLineDash([3, 4]); g.ctx.beginPath(); g.ctx.moveTo(g.X(1), g.top); g.ctx.lineTo(g.X(1), g.bottom); g.ctx.stroke(); g.ctx.restore();
  if (elapsed >= 1) { g.dot(1, r.fev1, colors.patient); g.text(`FEV1 ${r.fev1.toFixed(2)} L`, 1, r.fev1, { dx: 8, dy: 14, color: colors.patient, bold: true }); }
  if (elapsed >= r.expTime) { g.ctx.save(); g.ctx.strokeStyle = colors.patient; g.ctx.setLineDash([2, 3]); g.ctx.beginPath(); g.ctx.moveTo(g.X(0), g.Y(r.fvc)); g.ctx.lineTo(g.right, g.Y(r.fvc)); g.ctx.stroke(); g.ctx.restore(); g.text(`FVC ${r.fvc.toFixed(2)} L`, tMax, r.fvc, { align: 'right', dy: -5, color: colors.patient, bold: true }); }
}

// ---------- report ----------
const ROWS = [
  ['Plethysmography'], ['tlc', 'TLC (L)', 2], ['frc', 'FRC (L)', 2], ['rv', 'RV (L)', 2],
  ['Spirometry'], ['fvc', 'FVC (L)', 2], ['fev1', 'FEV1 (L)', 2], ['ratio', 'FEV1/FVC', 2], ['fef2575', 'FEF 25–75% (L/s)', 2], ['pef', 'PEF (L/s)', 2],
  ['Slow vital capacity'], ['svc', 'SVC (L)', 2], ['ic', 'IC (L)', 2], ['erv', 'ERV (L)', 2],
  ['Diffusion'], ['dlco', 'DLCO unc (mL/min/mmHg)', 1], ['dlcoCorrected', 'DLCO cor for Hb', 1], ['hemoglobin', 'Hemoglobin (g/dL)', 1],
];
function renderReport(r) {
  const done = tNow >= (timeline?.end ?? 0);
  const table = rows => {
    let html = '<table><thead><tr><th></th><th>Actual</th><th>Pred</th><th>%Pred</th></tr></thead><tbody>';
    for (const row of rows) {
      if (row.length === 1) { html += `<tr class="section"><th colspan="4">${row[0]}</th></tr>`; continue; }
      const [k, label, dp] = row, isRatio = k === 'ratio', noPct = isRatio || k === 'hemoglobin';
      const a = isRatio ? r[k] : r[k], p = PREDICTED[k], pc = 100 * r[k] / PREDICTED[k];
      const low = k === 'fef2575' ? 65 : 80;
      const flag = k === 'hemoglobin' ? (r[k] < 13 || r[k] > 18) : isRatio ? r[k] < 0.7 : (pc < low || pc > 120);
      html += `<tr class="${flag && done ? 'flag' : ''}"><td>${label}</td><td>${done ? a.toFixed(dp) : '…'}</td><td>${p.toFixed(dp)}</td><td>${done && !noPct ? Math.round(pc) : ''}</td></tr>`;
    }
    return html + '</tbody></table>';
  };
  const split = ROWS.findIndex(row => row[0] === 'Slow vital capacity');
  $('report').innerHTML = table(ROWS.slice(0, split)) + table(ROWS.slice(split));
}

function renderInterpretation() {
  const done = tNow >= (timeline?.end ?? 0), box = $('interp-box');
  if (!done) { box.open = false; box.classList.add('waiting'); return; }
  box.classList.remove('waiting');
  const p = PFT_PRESETS[presetKey];
  const pre = p.bronchodilator && $('bronchodilator').checked && matchPreset() === presetKey ? simulate({ ...p.settings, ...(p.supine && $('supine').checked ? p.supine : {}) }).report : null;
  const out = interpret(sim.report, PREDICTED, { pre });
  $('interp-steps').innerHTML = out.steps.map(x => `<li><strong>${x.q}</strong><br>${x.a}</li>`).join('');
  $('interp-result').innerHTML = `<strong>${out.pattern}.</strong> ${out.consistent}`;
}

function renderPleth(r) {
  const P1 = 969, dP = 10, dV = r.frc * dP / (P1 - dP);
  $('pleth-example').innerHTML = `The patient sits in a sealed box and pants against a closed shutter at the end of a normal breath (FRC). No air moves, so the gas in the chest obeys Boyle's law: P<sub>1</sub>V<sub>1</sub> = P<sub>2</sub>V<sub>2</sub>. With no airflow, mouth pressure equals alveolar pressure. The starting pressure of the alveolar gas is atmospheric pressure minus water vapor (about 1033 − 64 = ${P1} cmH₂O). When this patient pulls in and mouth pressure falls ${dP} cmH₂O, the chest gas expands by ${Math.round(dV * 1000)} mL, which the box detects as a pressure rise. Solving, V<sub>1</sub> = ΔV·(P<sub>1</sub> − ΔP)/ΔP = ${(dV * (P1 - dP) / dP).toFixed(2)} L, the FRC. Then RV = FRC − ERV and TLC = FRC + IC. (You will not be asked to do this calculation on the exam.)`;
}

function draw() {
  sim = simulate(settings); timeline = buildTimeline(sim);
  if (!playing) tNow = Infinity;
  drawTracing(timeline, sim.report); drawFlowVolume(sim, timeline); drawVolumeTime(sim, timeline); renderReport(sim.report); renderInterpretation(); renderPleth(sim.report);
  for (const [k, m] of Object.entries(SLIDERS)) $('o-' + k).textContent = m.fmt(settings[k]);
}
function frame(now) {
  if (!playing) return;
  tNow += (now - lastFrame) / 1000 * 2; lastFrame = now; // 2x real time
  if (tNow >= timeline.end) { playing = false; tNow = Infinity; $('run').textContent = '▶ Run the test'; }
  drawTracing(timeline, sim.report); drawFlowVolume(sim, timeline); drawVolumeTime(sim, timeline); renderReport(sim.report); renderInterpretation();
  if (playing) requestAnimationFrame(frame);
}
function run() {
  if (playing) { playing = false; tNow = Infinity; $('run').textContent = '▶ Run the test'; draw(); return; }
  playing = true; tNow = 0; lastFrame = performance.now(); $('run').textContent = '■ Skip to results'; requestAnimationFrame(frame);
}

function matchPreset() {
  const s = currentPresetSettings();
  return Object.keys(SLIDERS).every(k => Math.abs(s[k] - settings[k]) < 1e-6) ? presetKey : 'custom';
}
function setQuestion(k) { const [t, q] = QUESTIONS[k] || QUESTIONS.custom; $('question-title').textContent = t; $('question').textContent = q; }
function loadPreset(k) {
  presetKey = k; const p = PFT_PRESETS[k];
  $('bronchodilator').disabled = !p.bronchodilator; $('supine').disabled = !p.supine; $('bronchodilator').checked = false; $('supine').checked = false;
  settings = currentPresetSettings(); writeSliders(); setQuestion(k); draw();
}

function exportCsv() {
  const r = sim.report, rows = [['measure', 'actual', 'predicted', 'percent_predicted']];
  for (const row of ROWS) if (row.length > 1) rows.push([row[1], r[row[0]].toFixed(3), PREDICTED[row[0]].toFixed(3), Math.round(100 * r[row[0]] / PREDICTED[row[0]])]);
  rows.push([], ['time_s', 'volume_L', 'flow_Lps', 'phase']);
  sim.expiration.filter((_, i) => i % 5 === 0).forEach(p => rows.push([p.t.toFixed(3), p.v.toFixed(4), p.flow.toFixed(4), 'forced expiration']));
  sim.inspiration.filter((_, i) => i % 5 === 0).forEach(p => rows.push([p.t.toFixed(3), p.v.toFixed(4), (-p.flow).toFixed(4), 'forced inspiration']));
  rows.push([], ['settings', JSON.stringify(settings).replaceAll(',', ';')]);
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([rows.map(x => x.join(',')).join('\n')], { type: 'text/csv' })), download: 'pft-report.csv' });
  link.click(); URL.revokeObjectURL(link.href);
}

$('preset').innerHTML = Object.entries(PFT_PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
$('load').addEventListener('click', () => loadPreset($('preset').value));
$('reset').addEventListener('click', () => { $('preset').value = 'normal'; loadPreset('normal'); });
for (const id of ['bronchodilator', 'supine']) $(id).addEventListener('change', () => { settings = currentPresetSettings(); writeSliders(); setQuestion(presetKey); draw(); });
for (const k of Object.keys(SLIDERS)) $('s-' + k).addEventListener('input', () => { readSliders(); setQuestion(matchPreset()); draw(); });
for (const id of ['overlay', 'absolute']) $(id).addEventListener('change', draw);
$('run').addEventListener('click', run); $('export').addEventListener('click', exportCsv);
window.addEventListener('resize', draw);
loadPreset('normal');
window.pftModel = { simulate, get settings() { return { ...settings }; }, get report() { return sim.report; } };
