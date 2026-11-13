import { simulate, PFT_PRESETS, PFT_DEFAULTS, PREDICTED } from './pft-model.js?v=24';
import { interpret } from './pft-interpret.js?v=24';

const $ = id => document.getElementById(id);
const colors = { patient: '#800000', healthy: '#4d4d4d', lung: '#a65e00', chestWall: '#155f83', grid: '#eaf0f2', axis: '#aebdc4', text: '#666666' };

const QUESTIONS = {
  normal: ['Read it like a consultant', 'Start with lung volumes: big lungs or small lungs? Then FEV1/FVC: is there obstruction? Then the shape of the flow-volume loop, then DLCO: is it preserved? If a bronchodilator was given, did it help? Load a patient and work through the same questions.'],
  emphysema: ['72-year-old former smoker', 'Big lungs or small lungs? Rank TLC, FRC, and RV by how far each rises. Why does RV rise the most? Is FEV1/FVC below 70%? Why is DLCO low here but not in asthma? Look for the scoop on the flow-volume loop and the long tail on the volume-time curve. Then check after bronchodilator: does it reverse?'],
  asthma: ['Obstruction that reverses', 'Notice the air trapping before treatment (RV and FRC). Now check the box for after bronchodilator. Compare the change in FEV1 and FVC, in liters and in points of percent predicted (shown under the report). Which number does the response rule use? What happens to RV? Why is DLCO not low, even though the spirometry looks like emphysema?'],
  ild: ['Small, stiff lungs', 'TLC and FVC fall (RV only a little), but FEV1/FVC is normal or high. Use the flow-volume loop to explain why. Tick \u201cFlow-volume loop on absolute lung volume\u201d and compare flow at the same lung volume: is it higher or lower than normal? What does the low DLCO add?'],
  obesity: ['A load on the chest wall', 'TLC, FRC, and RV all fall, RV only a little. Of TLC, FRC, RV, and ERV, which falls the most as percent predicted, and why? Compare ERV here with the other restrictive patients. Why is DLCO normal?'],
  neuromuscular: ['Small Group 4: weak muscles', 'Compare TLC, FRC, and RV as percent predicted. Why is TLC low and RV high while FRC stays near normal (the step-up pattern)? Now check tested supine. What happens to TLC, RV, and the flows, and why?'],
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
  const r = sm.report, pts = [], VT = Math.max(0.05, Math.min(0.5, r.tlc - r.frc)), period = 4;
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
  const fs = w < 600 ? 11 : 10; // larger canvas text on phones (QA-08)
  const left = margin.left ?? 46, right = w - (margin.right ?? 16), top = 18, bottom = h - 36;
  const X = x => left + (x - xMin) / (xMax - xMin) * (right - left), Y = y => bottom - (y - yMin) / (yMax - yMin) * (bottom - top);
  ctx.font = `${fs}px -apple-system, sans-serif`; ctx.lineWidth = 1;
  for (const y of yTicks) { ctx.strokeStyle = y === 0 ? colors.axis : colors.grid; ctx.beginPath(); ctx.moveTo(left, Y(y)); ctx.lineTo(right, Y(y)); ctx.stroke(); ctx.fillStyle = colors.text; ctx.textAlign = 'right'; ctx.fillText(y, left - 7, Y(y) + 3); }
  for (const x of xTicks) { ctx.strokeStyle = colors.grid; ctx.beginPath(); ctx.moveTo(X(x), top); ctx.lineTo(X(x), bottom); ctx.stroke(); ctx.fillStyle = colors.text; ctx.textAlign = 'center'; ctx.fillText(x, X(x), bottom + 15); }
  ctx.fillStyle = colors.text; ctx.textAlign = 'left'; ctx.fillText(yLabel, 3, 11); ctx.textAlign = 'center'; ctx.fillText(xLabel, (left + right) / 2, h - 5);
  const clip = fn => { ctx.save(); ctx.beginPath(); ctx.rect(left, top - 6, right - left, bottom - top + 6); ctx.clip(); fn(); ctx.restore(); };
  const line = (pts, color, { dashed = false, width = 2.2, alpha = 1 } = {}) => clip(() => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha; ctx.setLineDash(dashed ? [5, 4] : []); ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))); ctx.stroke(); });
  const dot = (x, y, color, r = 4.5) => { ctx.setLineDash([]); ctx.fillStyle = color; ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); };
  const text = (s, x, y, { color = colors.text, align = 'left', bold = false, dx = 0, dy = 0 } = {}) => { ctx.fillStyle = color; ctx.font = `${bold ? '600 ' : ''}${fs}px -apple-system, sans-serif`; ctx.textAlign = align; ctx.fillText(s, X(x) + dx, Y(y) + dy); };
  return { ctx, X, Y, w, left, right, top, bottom, line, dot, text, clip };
}

function drawTracing(tl, r) {
  const narrow = $('tracing').getBoundingClientRect().width < 600;
  const g = chart('tracing', { xMin: 0, xMax: Math.max(40, Math.ceil(tl.end / 5) * 5), yMin: 0, yMax: 8.5, xLabel: 'Time (s)', yLabel: 'Lung volume (L)', xTicks: [0, 10, 20, 30, 40, 50].filter(x => x <= Math.max(40, tl.end)), yTicks: [0, 1, 2, 3, 4, 5, 6, 7, 8], margin: { right: narrow ? 34 : 215 } });
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
  if (!narrow) {
    bracket(0, r.tlc, vT, 'IRV'); bracket(0, vT, r.frc, 'TV'); bracket(0, r.frc, r.rv, 'ERV'); bracket(0, r.rv, 0, 'RV');
    bracket(1, r.tlc, r.frc, 'IC'); bracket(1, r.frc, 0, 'FRC'); bracket(2, r.tlc, r.rv, 'VC'); bracket(3, r.tlc, 0, 'TLC');
  }
  for (const [v, l] of [[r.tlc, 'TLC'], [r.frc, 'FRC'], [r.rv, 'RV']]) {
    ctx.strokeStyle = '#c4c4c4'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(g.left, g.Y(v)); ctx.lineTo(g.right, g.Y(v)); ctx.stroke();
    if (narrow) { ctx.setLineDash([]); ctx.fillStyle = '#4d4d4d'; ctx.font = '600 11px -apple-system, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(l, g.right + 4, g.Y(v) + 4); }
  }
  ctx.setLineDash([]);
  // On phones the brackets would leave no room for the tracing, so the volumes go in a row below it.
  const vols = [['IRV', r.tlc - vT], ['TV', vT - r.frc], ['ERV', r.frc - r.rv], ['RV', r.rv], ['IC', r.tlc - r.frc], ['FRC', r.frc], ['VC', r.tlc - r.rv], ['TLC', r.tlc]];
  const row = $('tracing-vols'); row.hidden = !narrow;
  if (narrow) row.textContent = vols.map(([l, v]) => `${l} ${v.toFixed(2)}`).join(' · ') + ' L';
  $('tracing').setAttribute('aria-label', `Spirometry tracing: lung volume over time. ${vols.map(([l, v]) => `${l} ${v.toFixed(2)} L`).join(', ')}. RV, FRC, and TLC cannot be measured by spirometry.`);
  const past = tl.pts.filter(p => p.t <= tNow), cur = past[past.length - 1]; if (playing && cur) g.dot(cur.t, cur.v, colors.patient);
}

function fvPoints(sm, absolute) {
  const tlc = sm.report.tlc, x = v => absolute ? v : tlc - v;
  return [...sm.expiration.filter((_, i) => i % 4 === 0).map(p => ({ x: x(p.v), y: p.flow, t: p.t, phase: 'e' })), ...sm.inspiration.filter((_, i) => i % 4 === 0).map(p => ({ x: x(p.v), y: -p.flow, t: p.t, phase: 'i' }))];
}
function drawFlowVolume(sm, tl) {
  const absolute = $('absolute').checked;
  $('fv-note').textContent = absolute ? 'Absolute lung volume: needs plethysmography for RV and TLC' : 'Volume exhaled from TLC, as on a report';
  const g = absolute
    ? chart('fv', { xMin: 8.5, xMax: 1, yMin: -8, yMax: 12, xLabel: 'Lung volume (L)  ← TLC        RV →', yLabel: 'Flow (L/s)', xTicks: [8, 7, 6, 5, 4, 3, 2, 1], yTicks: [-8, -4, 0, 4, 8, 12] })
    : chart('fv', { xMin: 0, xMax: 5.5, yMin: -8, yMax: 12, xLabel: 'Volume exhaled from TLC (L)', yLabel: 'Flow (L/s)', xTicks: [0, 1, 2, 3, 4, 5], yTicks: [-8, -4, 0, 4, 8, 12] });
  g.text('Expiration', absolute ? 8.4 : 0.1, 11, { bold: true, dy: 4 }); g.text('Inspiration', absolute ? 8.4 : 0.1, -7.2, { bold: true });
  if ($('overlay').checked) g.line(fvPoints(healthySim, absolute), colors.healthy, { dashed: true, width: 1.3, alpha: 0.8 });
  const shown = fvPoints(sm, absolute).filter(p => tNow >= tl.end || (p.phase === 'e' ? tl.tExp + p.t <= tNow : tl.tIns + p.t <= tNow));
  g.line(shown, colors.patient);
  const tl0 = sm.report.tlc, ev = sm.expiration[sm.expiration.length - 1].v;
  if (tNow >= tl.end) { g.text('TLC', absolute ? tl0 : 0, 0, { align: 'center', dy: 14, bold: true }); const trapped = ev - sm.report.rv > 0.02; g.text(absolute ? (trapped ? 'End of FVC' : 'RV') : 'FVC', absolute ? ev : tl0 - ev, 0, { align: 'center', dy: 14, bold: true }); if (absolute && trapped) g.text('RV', sm.report.rv, 0, { align: 'center', dy: 26, color: '#737373' }); }
}
function drawVolumeTime(sm, tl) {
  // 8 s holds every preset (emphysema, the longest, exhales for about 7 s); the axis widens only for custom
  // patients who exhale longer, up to the 15 s end of test.
  const tMax = Math.max(8, Math.ceil(sm.report.expTime / 2) * 2), step = tMax > 8 ? 2 : 1;
  const g = chart('vt', { xMin: 0, xMax: tMax, yMin: 0, yMax: 5.5, xLabel: 'Time (s)', yLabel: 'Volume exhaled (L)', xTicks: Array.from({ length: tMax / step + 1 }, (_, i) => i * step), yTicks: [0, 1, 2, 3, 4, 5] });
  const series = s => s.expiration.filter((_, i) => i % 5 === 0).map(p => ({ x: p.t, y: s.report.tlc - p.v }));
  if ($('overlay').checked) g.line(series(healthySim), colors.healthy, { dashed: true, width: 1.3, alpha: 0.8 });
  const elapsed = tNow >= tl.end ? Infinity : tNow - tl.tExp;
  g.line(series(sm).filter(p => p.x <= elapsed), colors.patient);
  const r = sm.report; g.ctx.save(); g.ctx.strokeStyle = '#9a9a9a'; g.ctx.setLineDash([3, 4]); g.ctx.beginPath(); g.ctx.moveTo(g.X(1), g.top); g.ctx.lineTo(g.X(1), g.bottom); g.ctx.stroke(); g.ctx.restore();
  if (elapsed >= 1) { g.dot(1, r.fev1, colors.patient); g.text(`FEV1 ${r.fev1.toFixed(2)} L`, 1, r.fev1, { dx: 8, dy: 14, color: colors.patient, bold: true }); }
  if (elapsed >= r.expTime) { g.ctx.save(); g.ctx.strokeStyle = colors.patient; g.ctx.setLineDash([2, 3]); g.ctx.beginPath(); g.ctx.moveTo(g.X(0), g.Y(r.fvc)); g.ctx.lineTo(g.right, g.Y(r.fvc)); g.ctx.stroke(); g.ctx.restore(); g.text(`FVC ${r.fvc.toFixed(2)} L`, tMax, r.fvc, { align: 'right', dy: -5, color: colors.patient, bold: true }); }
}

// ---------- report ----------
const ROWS = [
  ['Plethysmography'], ['tlc', 'TLC (L)', 2], ['frc', 'FRC (L)', 2], ['rv', 'RV (L)', 2],
  ['Spirometry'], ['fvc', 'FVC (L)', 2], ['fev1', 'FEV1 (L)', 2], ['ratio', 'FEV1/FVC (%)', 0], ['fef2575', 'FEF 25–75% (L/s)', 2], ['pef', 'PEF (L/s)', 2],
  ['Slow vital capacity'], ['svc', 'SVC (L)', 2], ['ic', 'IC (L)', 2], ['erv', 'ERV (L)', 2],
  ['Airways'], ['raw', 'Raw (airway resistance)', 2],
  ['Diffusion'], ['dlco', 'DLCO, uncorrected', 1], ['dlcoCorrected', 'DLCO, corrected for Hb', 1], ['hemoglobin', 'Hemoglobin (g/dL)', 1],
];
// Flags: course rule 80–120% of predicted for volumes and DLCO (both directions); only low values are
// flagged for flows and vital capacities; FEV1/FVC below 70%; Raw 2 or more; Hb below 13 or above 18.
const BOTH_SIDES = new Set(['tlc', 'frc', 'rv', 'dlco', 'dlcoCorrected']);
const NO_PCT = new Set(['ratio', 'hemoglobin', 'raw']);
const PRE_ONLY = new Set(['dlco', 'dlcoCorrected', 'hemoglobin']); // not repeated after bronchodilator
// Flags are decided on the rounded value the report shows, so a value printed as 80 is never flagged (STU-10).
function isFlagged(k, r) {
  if (k === 'hemoglobin') { const hb = Number(r[k].toFixed(1)); return hb < 13 || hb > 18; }
  if (k === 'ratio') return Math.round(100 * r[k]) < 70;
  if (k === 'raw') return Number(r[k].toFixed(2)) >= 2;
  if (k === 'fef2575') return false; // shown, but not used for diagnosis
  const pc = Math.round(100 * r[k] / PREDICTED[k]);
  return pc < 80 || (BOTH_SIDES.has(k) && pc > 120);
}
const show = (k, v, dp) => (k === 'ratio' ? 100 * v : v).toFixed(dp);
function preReport() {
  const p = PFT_PRESETS[presetKey];
  if (!p.bronchodilator || !$('bronchodilator').checked || matchPreset() !== presetKey) return null;
  return simulate({ ...p.settings, ...(p.supine && $('supine').checked ? p.supine : {}) }).report;
}
const signed = (x, dp) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(dp)}`;
function renderReport(r) {
  const done = tNow >= (timeline?.end ?? 0), pre = preReport();
  // With a bronchodilator, the course report layout: pre-drug actual, predicted, %pred; post-drug actual, %pred, %change.
  // Pre and Post cells are flagged separately (STU-03).
  const table = (rows, name) => {
    let html = `<div class="table-scroll"><table><caption class="sr-only">${name}</caption>` + (pre
      ? '<thead><tr><th scope="col"><span class="sr-only">Measure</span></th><th scope="col">Pre</th><th scope="col">Pred</th><th scope="col">%Pred</th><th scope="col">Post</th><th scope="col">%Pred</th><th scope="col">% change from Pre</th></tr></thead><tbody>'
      : '<thead><tr><th scope="col"><span class="sr-only">Measure</span></th><th scope="col">Actual</th><th scope="col">Pred</th><th scope="col">%Pred</th></tr></thead><tbody>');
    const cols = pre ? 7 : 4;
    for (const row of rows) {
      if (row.length === 1) { html += `<tr class="section"><th colspan="${cols}" scope="colgroup">${row[0]}</th></tr>`; continue; }
      const [k, label, dp] = row, base = pre || r, noPct = NO_PCT.has(k);
      const pc = x => done && !noPct ? Math.round(100 * x[k] / PREDICTED[k]) : '';
      const fBase = done && isFlagged(k, base), fPost = done && pre && !PRE_ONLY.has(k) && isFlagged(k, r);
      const cls = f => f ? ' class="flag"' : '';
      html += `<tr${fBase || fPost ? ' class="flag-row"' : ''}><th scope="row">${label}</th><td${cls(fBase)}>${done ? show(k, base[k], dp) : '…'}</td><td>${show(k, PREDICTED[k], dp)}</td><td${cls(fBase)}>${pc(base)}</td>`;
      if (pre) {
        // % change is computed from the values as printed, so students can check it by hand (STU-17).
        const a = Number(show(k, pre[k], dp)), b = Number(show(k, r[k], dp));
        html += !PRE_ONLY.has(k) ? `<td${cls(fPost)}>${done ? show(k, r[k], dp) : '…'}</td><td${cls(fPost)}>${pc(r)}</td><td>${done && a ? Math.round(100 * (b - a) / a) : ''}</td>` : '<td></td><td></td><td></td>';
      }
      html += '</tr>';
    }
    return html + '</tbody></table></div>';
  };
  const split = ROWS.findIndex(row => row[0] === 'Slow vital capacity');
  $('report').innerHTML = table(ROWS.slice(0, split), 'Plethysmography and spirometry') + table(ROWS.slice(split), 'Slow vital capacity, airways, and diffusion');
  // The bronchodilator rule uses the change in percent predicted, which a lab report does not print (STU-01, 02).
  const bd = $('bd-change');
  if (pre && done) {
    const pts = k => 100 * (r[k] - pre[k]) / PREDICTED[k];
    bd.hidden = false;
    bd.innerHTML = `<strong>Change after bronchodilator:</strong> FEV1 ${signed(r.fev1 - pre.fev1, 2)} L (${signed(pts('fev1'), 0)} points of percent predicted); FVC ${signed(r.fvc - pre.fvc, 2)} L (${signed(pts('fvc'), 0)} points). The bronchodilator rule uses these points: a rise of more than 10 in FEV1 or FVC is a response. The "% change from Pre" column is a different number.`;
  } else bd.hidden = true;
  const rule = 'volumes and DLCO outside 80–120% of predicted; flows and vital capacities below 80%; FEV1/FVC below 70%; Raw 2 or more; hemoglobin below 13 or above 18 g/dL. Flags use the rounded value shown. FEF 25–75% is shown but not used for diagnosis';
  $('report-caption').textContent = pre
    ? `Pre is before and Post after bronchodilator. Values in bold red are outside the normal range, judged separately for Pre and Post, and an asterisk marks the row: ${rule}.`
    : `Values in bold red, rows marked with an asterisk, are outside the normal range: ${rule}.`;
}

const CTA = 'Make your own read first, then show the stepwise interpretation';
function renderInterpretation() {
  const done = tNow >= (timeline?.end ?? 0), box = $('interp-box');
  const summary = box.querySelector('summary'), cta = box.querySelector('.interp-cta');
  if (!done) {
    box.open = false; box.classList.add('waiting'); summary.setAttribute('aria-disabled', 'true');
    cta.textContent = 'The stepwise interpretation is available when the run finishes';
    $('fv').setAttribute('aria-label', 'Flow-volume loop, drawing as the test runs'); $('vt').setAttribute('aria-label', 'Volume-time curve, drawing as the test runs');
    return;
  }
  box.classList.remove('waiting'); summary.removeAttribute('aria-disabled'); cta.textContent = CTA;
  const out = interpret(sim.report, PREDICTED, { pre: preReport(), custom: matchPreset() === 'custom' });
  // Text equivalents for the charts (QA-04). The loop shape comes from the same rules as step 3.
  const r = sim.report, shape = out.steps[2].a.replace(/<[^>]+>.*$/s, '').replace(/^(No\.|Yes,)\s*/, '').replace(/^./, c => c.toUpperCase());
  $('fv').setAttribute('aria-label', `Flow-volume loop. Peak expiratory flow ${r.pef.toFixed(1)} L/s, peak inspiratory flow ${r.pif.toFixed(1)} L/s, FVC ${r.fvc.toFixed(2)} L. ${shape}`);
  $('vt').setAttribute('aria-label', `Volume-time curve. FEV1 ${r.fev1.toFixed(2)} L, FVC ${r.fvc.toFixed(2)} L, FEV1/FVC ${Math.round(100 * r.ratio)}%, expiration lasts ${r.expTime.toFixed(1)} s.`);
  $('interp-steps').innerHTML = out.steps.map(x => `<li><strong>${x.q}</strong><br>${x.a}</li>`).join('');
  $('interp-result').innerHTML = `<strong>${out.pattern}.</strong> ${out.consistent}`;
}

function renderPleth(r) {
  // Same simplified algebra as the course slides: drop the tiny dP*dV term and use Patm for P1.
  const Patm = 1033, dP = 10, dV = -r.frc * dP / Patm; // L; an expiratory push compresses the chest gas
  const mL = Math.round(dV * 1000), sub = x => `<sub>${x}</sub>`;
  $('pleth-example').innerHTML = `<p>The patient sits in a sealed box and pants against a closed shutter at the end of a normal breath, so the starting volume is FRC. No air moves, so the gas in the chest obeys Boyle's law, P${sub(1)}V${sub(1)} = P${sub(2)}V${sub(2)}, and mouth pressure equals alveolar pressure. P${sub(1)} is atmospheric pressure and V${sub(1)} is FRC, the unknown. Pushing against the shutter raises mouth pressure by ΔP and compresses the chest gas by ΔV. The patient gets slightly smaller, so the box gas has more room and box pressure falls; the box is calibrated to turn that fall into ΔV.</p>
<p class="eq">P${sub(1)}V${sub(1)} = (P${sub(1)} + ΔP)(V${sub(1)} + ΔV)</p>
<p>Multiply out and cancel P${sub(1)}V${sub(1)} from both sides. ΔP·ΔV is a small number times a small number, so drop it. That leaves 0 = ΔP·V${sub(1)} + ΔV·P${sub(1)}, so</p>
<p class="eq">FRC = −(ΔV / ΔP) · P${sub('atm')}</p>
<p>For this patient, a push that raises mouth pressure ${dP} cmH₂O compresses the chest gas by ${Math.abs(mL)} mL: FRC = −(${(dV).toFixed(3).replace('-', '−')} L / ${dP} cmH₂O) × ${Patm} cmH₂O = ${(-dV / dP * Patm).toFixed(2)} L. Then RV = FRC − ERV and TLC = FRC + IC. (Commercial body boxes use the pressure of dry alveolar gas, atmospheric minus water vapor, about 969 cmH₂O, which changes the answer by about 6%. You will not be asked to do this calculation on the exam.)</p>`;
}

function draw() {
  sim = simulate(settings); timeline = buildTimeline(sim);
  if (!playing) tNow = Infinity;
  drawTracing(timeline, sim.report); drawFlowVolume(sim, timeline); drawVolumeTime(sim, timeline); renderReport(sim.report); renderInterpretation(); renderPleth(sim.report);
  for (const [k, m] of Object.entries(SLIDERS)) { const t = m.fmt(settings[k]); $('o-' + k).textContent = t; $('s-' + k).setAttribute('aria-valuetext', t); }
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
  for (const row of ROWS) if (row.length > 1) rows.push([row[1], r[row[0]].toFixed(3), PREDICTED[row[0]].toFixed(3), NO_PCT.has(row[0]) ? '' : Math.round(100 * r[row[0]] / PREDICTED[row[0]])]);
  rows.push([], ['time_s', 'volume_L', 'flow_Lps', 'phase']);
  sim.expiration.filter((_, i) => i % 5 === 0).forEach(p => rows.push([p.t.toFixed(3), p.v.toFixed(4), p.flow.toFixed(4), 'forced expiration']));
  sim.inspiration.filter((_, i) => i % 5 === 0).forEach(p => rows.push([p.t.toFixed(3), p.v.toFixed(4), (-p.flow).toFixed(4), 'forced inspiration']));
  rows.push([], ['settings', JSON.stringify(settings).replaceAll(',', ';')]);
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([rows.map(x => x.join(',')).join('\n')], { type: 'text/csv' })), download: 'pft-report.csv' });
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

$('preset').innerHTML = Object.entries(PFT_PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
$('load').addEventListener('click', () => loadPreset($('preset').value));
$('reset').addEventListener('click', () => { $('preset').value = 'normal'; loadPreset('normal'); });
for (const id of ['bronchodilator', 'supine']) $(id).addEventListener('change', () => { settings = currentPresetSettings(); writeSliders(); setQuestion(presetKey); draw(); });
for (const k of Object.keys(SLIDERS)) $('s-' + k).addEventListener('input', () => { readSliders(); setQuestion(matchPreset()); draw(); });
for (const id of ['overlay', 'absolute']) $(id).addEventListener('change', draw);
// Keyboard and mouse are blocked the same way while the run plays (QA-06).
$('interp-box').querySelector('summary').addEventListener('click', e => { if ($('interp-box').classList.contains('waiting')) e.preventDefault(); });
$('run').addEventListener('click', run); $('export').addEventListener('click', exportCsv);
window.addEventListener('resize', draw);
loadPreset('normal');
window.pftModel = { simulate, get settings() { return { ...settings }; }, get report() { return sim.report; } };
