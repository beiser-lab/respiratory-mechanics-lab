import { analyze, curves, probe, PRESETS, DEFAULT_SETTINGS, PARAMS, lungPressure, chestWallPressure, systemPressure } from './model.js';

const $ = id => document.getElementById(id);
const colors = { system: '#800000', lung: '#a65e00', chestWall: '#155f83', grid: '#eaf0f2', axis: '#aebdc4', text: '#666666', ink: '#193944' };
const AX = { pMin: -30, pMax: 50, vMin: 0, vMax: 7 };
const V_DRAW_MAX = 6.6; // the classic figure stops near TLC

const QUESTIONS = {
  normal: ['Where do the pulls balance?', 'At FRC the lung recoils inward and the chest wall recoils outward with equal and opposite pressures. Which way should FRC move if the lung becomes stiffer?'],
  emphysema: ['Less recoil, bigger lungs', 'Loss of elastic tissue lets the lung curve rotate up and to the left. Why does FRC rise even though nothing changed in the chest wall? What happens to the outward pull of the chest wall at the new FRC?'],
  fibrosis: ['More recoil, smaller lungs', 'A stiff lung needs more pressure at every volume. Follow the FRC and TLC. Why does TLC fall even though muscle strength is normal?'],
  obesity: ['A load on the outside', 'Mass loading pushes the chest wall curve to the right. Which volume changes most, and why might a patient with obesity have trouble with ERV in particular?'],
  kyphoscoliosis: ['A stiff box', 'The lung is normal, yet FRC, TLC, and ERV all fall and the combined curve is flatter. Use 1/Crs = 1/CL + 1/Ccw to explain why the stiffer of the two parts dominates the system compliance.'],
  neuromuscular: ['Weak muscles, normal tissues', 'The relaxation curves did not move at all. Why do TLC and RV change while FRC stays put? Compare this with the fibrosis pattern.'],
  custom: ['Your own experiment', 'Predict first, then move the slider. Which volumes depend only on the relaxation curves, and which also depend on the muscles?'],
};

const sliders = {
  lungCompliance: { el: 'lung-c', out: 'lung-c-out', toModel: v => 2 ** v, toSlider: x => Math.log2(x), fmt: x => x.toFixed(2) + '×' },
  chestWallCompliance: { el: 'cw-c', out: 'cw-c-out', toModel: v => 2 ** v, toSlider: x => Math.log2(x), fmt: x => x.toFixed(2) + '×' },
  chestWallLoad: { el: 'cw-load', out: 'cw-load-out', toModel: v => v, toSlider: x => x, fmt: x => x.toFixed(1).replace(/\.0$/, '') + ' cmH₂O' },
  muscleStrength: { el: 'muscle', out: 'muscle-out', toModel: v => v, toSlider: x => x, fmt: x => Math.round(x * 100) + '%' },
};

const healthy = analyze(DEFAULT_SETTINGS);
const trim = c => Object.fromEntries(Object.entries(c).map(([k, pts]) => [k, pts.filter(p => p.y <= V_DRAW_MAX)]));
const healthyCurves = trim(curves(DEFAULT_SETTINGS, PARAMS, AX));
let settings = { ...DEFAULT_SETTINGS };
let probeVolume = 4.0;

function readSliders() {
  for (const [k, s] of Object.entries(sliders)) settings[k] = s.toModel(Number($(s.el).value));
}
function writeSliders() {
  for (const [k, s] of Object.entries(sliders)) $(s.el).value = s.toSlider(settings[k]);
}

// ---------- metrics ----------
const VOLUME_METRICS = [
  ['tlc', 'Total lung capacity', 'L', 2], ['frc', 'Functional residual capacity', 'L', 2],
  ['rv', 'Residual volume', 'L', 2], ['vc', 'Vital capacity', 'L', 2], ['erv', 'Expiratory reserve volume', 'L', 2],
];
const MECH_METRICS = [
  ['lungRecoilAtFrc', 'Lung recoil (inward)', 'cmH₂O', 1], ['chestWallRecoilAtFrc', 'Chest wall recoil (outward if −)', 'cmH₂O', 1],
  ['lungCompliance', 'Lung compliance, CL', 'L/cmH₂O', 3], ['chestWallCompliance', 'Chest wall compliance, Ccw', 'L/cmH₂O', 3],
  ['systemCompliance', 'Respiratory system, Crs', 'L/cmH₂O', 3],
];
function renderMetrics(container, specs, a) {
  $(container).innerHTML = specs.map(([key, label, unit, dp]) => {
    const v = a[key], d = v - healthy[key];
    const delta = Math.abs(d) < 0.5 * 10 ** -dp ? 'Healthy value' : `${d > 0 ? '↑' : '↓'} ${Math.abs(d).toFixed(dp)} vs healthy`;
    const cls = Math.abs(d) < 0.5 * 10 ** -dp ? '' : (d > 0 ? 'up' : 'down');
    return `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${v.toFixed(dp)}<span class="metric-unit">${unit}</span></div><div class="metric-delta ${cls}">${delta}</div></div>`;
  }).join('');
}

// ---------- chart ----------
function chart(id) {
  const canvas = $(id), r = canvas.getBoundingClientRect(), w = r.width;
  const h = Number(canvas.dataset.logicalHeight || (canvas.dataset.logicalHeight = canvas.getAttribute('height')));
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.height = h + 'px'; }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const left = 50, right = w - 52, top = 34, bottom = h - 40;
  const X = x => left + (x - AX.pMin) / (AX.pMax - AX.pMin) * (right - left);
  const Y = y => bottom - (y - AX.vMin) / (AX.vMax - AX.vMin) * (bottom - top);
  const Yinv = py => AX.vMin + (bottom - py) / (bottom - top) * (AX.vMax - AX.vMin);
  ctx.font = '10px -apple-system, sans-serif'; ctx.lineWidth = 1;
  for (let v = 0; v <= AX.vMax; v++) { ctx.strokeStyle = colors.grid; ctx.beginPath(); ctx.moveTo(left, Y(v)); ctx.lineTo(right, Y(v)); ctx.stroke(); ctx.fillStyle = colors.text; ctx.textAlign = 'right'; ctx.fillText(v, left - 8, Y(v) + 3); }
  for (let p = AX.pMin; p <= AX.pMax; p += 10) { ctx.strokeStyle = p === 0 ? colors.axis : colors.grid; ctx.lineWidth = p === 0 ? 1.4 : 1; ctx.beginPath(); ctx.moveTo(X(p), top); ctx.lineTo(X(p), bottom); ctx.stroke(); ctx.fillStyle = colors.text; ctx.textAlign = 'center'; ctx.fillText(p, X(p), bottom + 16); }
  ctx.lineWidth = 1;
  ctx.fillStyle = colors.text; ctx.textAlign = 'left'; ctx.fillText('Volume (L)', 3, 14);
  ctx.textAlign = 'center'; ctx.fillText('Relaxation pressure (cmH₂O): transpulmonary for lung, transmural for chest wall, airway for the system', (left + right) / 2, h - 6);
  ctx.font = '600 11px -apple-system, sans-serif'; ctx.fillStyle = '#4d4d4d';
  ctx.fillText('← Expanding (outward) recoil', (left + X(0)) / 2, top - 12); ctx.fillText('Collapsing (inward) recoil →', (X(0) + right) / 2, top - 12);
  ctx.font = '10px -apple-system, sans-serif';
  const clip = fn => { ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip(); fn(); ctx.restore(); };
  const line = (pts, color, { dashed = false, width = 2.2, alpha = 1 } = {}) => clip(() => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha; ctx.setLineDash(dashed ? [5, 5] : []); ctx.beginPath();
    let on = false; for (const p of pts) { if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { on = false; continue; } if (!on) { ctx.moveTo(X(p.x), Y(p.y)); on = true; } else ctx.lineTo(X(p.x), Y(p.y)); }
    ctx.stroke();
  });
  const hline = (v, color, label, dash = [3, 4]) => clip(() => { ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(left, Y(v)); ctx.lineTo(right, Y(v)); ctx.stroke(); }) || label && (ctx.fillStyle = color, ctx.textAlign = 'left', ctx.font = '600 10px -apple-system, sans-serif', ctx.fillText(label, right + 6, Y(v) + 3), ctx.font = '10px -apple-system, sans-serif');
  const dot = (x, y, color, r = 5) => { if (!Number.isFinite(x) || x < AX.pMin || x > AX.pMax) return; ctx.fillStyle = color; ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); };
  const arrow = (x0, x1, y, color) => {
    if (Math.abs(X(x1) - X(x0)) < 14) return; const dir = Math.sign(x1 - x0), xa = X(x0) + dir * 8, xb = X(x1) - dir * 8, py = Y(y);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.6; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(xa, py); ctx.lineTo(xb, py); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(xb, py); ctx.lineTo(xb - dir * 7, py - 4); ctx.lineTo(xb - dir * 7, py + 4); ctx.closePath(); ctx.fill();
  };
  return { ctx, line, hline, dot, arrow, X, Y, Yinv, left, right, top, bottom };
}

function draw() {
  const a = analyze(settings), c = trim(curves(settings, PARAMS, AX)), g = chart('pv');
  const overlay = $('overlay').checked, limits = $('show-limits').checked;
  if (overlay) {
    g.line(healthyCurves.lung, colors.lung, { dashed: true, width: 1.3, alpha: 0.45 });
    g.line(healthyCurves.chestWall, colors.chestWall, { dashed: true, width: 1.3, alpha: 0.45 });
    g.line(healthyCurves.system, colors.system, { dashed: true, width: 1.3, alpha: 0.45 });
  }
  if (limits) { g.hline(a.tlc, '#6b6b6b', `TLC ${a.tlc.toFixed(2)}`); g.hline(a.rv, '#6b6b6b', `RV ${a.rv.toFixed(2)}`); }
  g.hline(a.frc, '#4d4d4d', `FRC ${a.frc.toFixed(2)}`, []);
  g.line(c.chestWall, colors.chestWall); g.line(c.lung, colors.lung); g.line(c.system, colors.system, { width: 2.8 });
  // FRC balance, as in the classic figure: the system sits at zero; arrows point to each tissue's recoil.
  g.arrow(0, a.chestWallRecoilAtFrc, a.frc, colors.chestWall); g.arrow(0, a.lungRecoilAtFrc, a.frc, colors.lung);
  g.dot(a.chestWallRecoilAtFrc, a.frc, colors.chestWall); g.dot(a.lungRecoilAtFrc, a.frc, colors.lung); g.dot(0, a.frc, colors.system);
  // Probe: at the chosen volume, show each pressure and their sum.
  const pr = probe(probeVolume, settings);
  g.ctx.save(); g.ctx.globalAlpha = 0.9; g.hline(probeVolume, '#800000', '', [2, 3]); g.ctx.restore();
  g.dot(pr.chestWall, probeVolume, colors.chestWall, 4); g.dot(pr.lung, probeVolume, colors.lung, 4); g.dot(pr.system, probeVolume, colors.system, 4);
  // Curve labels at fixed volumes, placed where the curves are well separated.
  const label = (pts, V, text, color, side) => {
    const p = pts.reduce((b, q) => Math.abs(q.y - V) < Math.abs(b.y - V) ? q : b, pts[0]); if (!p || p.x < AX.pMin || p.x > AX.pMax) return;
    g.ctx.fillStyle = color; g.ctx.font = '600 11px -apple-system, sans-serif';
    if (side === 'right' && g.X(p.x) + 8 + g.ctx.measureText(text).width > g.right - 4) side = 'below';
    if (side === 'below') { g.ctx.textAlign = 'right'; g.ctx.fillText(text, g.X(p.x) - 6, g.Y(p.y) + 18); return; }
    g.ctx.textAlign = side === 'left' ? 'right' : 'left';
    g.ctx.fillText(text, g.X(p.x) + (side === 'left' ? -8 : 8), g.Y(p.y) + 4);
  };
  label(c.chestWall, 5.6, 'Chest wall', colors.chestWall, 'left'); label(c.lung, 5.2, 'Lung', colors.lung, 'left'); label(c.system, 5.0, 'Lung + chest wall', colors.system, 'right');

  renderMetrics('metrics-volumes', VOLUME_METRICS, a);
  renderMetrics('metrics-mech', MECH_METRICS, a);
  for (const [k, s] of Object.entries(sliders)) $(s.out).textContent = s.fmt(settings[k]);
  $('probe-out').textContent = probeVolume.toFixed(2) + ' L';
  const f = x => !Number.isFinite(x) ? (x > 0 ? '+∞' : '−∞') : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1);
  $('probe-sum').innerHTML = `At ${probeVolume.toFixed(2)} L: <b class="lung">P<sub>L</sub> ${f(pr.lung)}</b> + <b class="cw">P<sub>cw</sub> ${f(pr.chestWall)}</b> = <b class="rs">P<sub>rs</sub> ${f(pr.system)}</b> cmH₂O`
    + `<br><span class="hint">Series check at FRC: 1 / (1/${a.lungCompliance.toFixed(3)} + 1/${a.chestWallCompliance.toFixed(3)}) = ${a.seriesCheck.toFixed(3)} L/cmH₂O, the slope of the combined curve.</span>`;
}

function matchPreset() {
  const hit = Object.entries(PRESETS).find(([, p]) => Object.keys(sliders).every(k => Math.abs(p[k] - settings[k]) < 1e-6));
  return hit ? hit[0] : 'custom';
}
function setQuestion(key) { const [t, q] = QUESTIONS[key] || QUESTIONS.custom; $('question-title').textContent = t; $('question').textContent = q; }
function loadPreset(key) { settings = { ...DEFAULT_SETTINGS, ...PRESETS[key] }; delete settings.label; writeSliders(); setQuestion(key); draw(); }

function exportCsv() {
  const rows = [['volume_L', 'lung_cmH2O', 'chest_wall_cmH2O', 'system_cmH2O', 'healthy_lung_cmH2O', 'healthy_chest_wall_cmH2O', 'healthy_system_cmH2O']];
  for (let V = 1.25; V <= 6.6001; V += 0.05) {
    const p = probe(V, settings), h = probe(V, DEFAULT_SETTINGS);
    rows.push([V.toFixed(2), p.lung, p.chestWall, p.system, h.lung, h.chestWall, h.system].map(x => typeof x === 'number' ? (Number.isFinite(x) ? x.toFixed(3) : '') : x));
  }
  const a = analyze(settings);
  rows.push([], ['settings', JSON.stringify(settings).replaceAll(',', ';')], ['FRC_L', a.frc.toFixed(3)], ['TLC_L', a.tlc.toFixed(3)], ['RV_L', a.rv.toFixed(3)]);
  const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'respiratory-mechanics.csv' });
  link.click(); URL.revokeObjectURL(link.href);
}

// ---------- wiring ----------
$('preset').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
$('load').addEventListener('click', () => loadPreset($('preset').value));
$('reset').addEventListener('click', () => { $('preset').value = 'normal'; loadPreset('normal'); });
for (const s of Object.values(sliders)) $(s.el).addEventListener('input', () => { readSliders(); setQuestion(matchPreset()); draw(); });
$('overlay').addEventListener('change', draw); $('show-limits').addEventListener('change', draw);
$('probe').addEventListener('input', e => { probeVolume = Number(e.target.value); draw(); });
const canvas = $('pv');
const fromPointer = e => { const r = canvas.getBoundingClientRect(); const h = Number(canvas.dataset.logicalHeight); const top = 34, bottom = h - 40; const v = AX.vMin + (bottom - (e.clientY - r.top)) / (bottom - top) * (AX.vMax - AX.vMin); probeVolume = Math.min(6.6, Math.max(1.3, v)); $('probe').value = probeVolume; draw(); };
canvas.addEventListener('pointermove', fromPointer); canvas.addEventListener('pointerdown', fromPointer);
$('export').addEventListener('click', exportCsv);
window.addEventListener('resize', draw);
loadPreset('normal');

// Exposed for console checks while teaching or debugging.
window.respiratoryModel = { analyze, probe, lungPressure, chestWallPressure, systemPressure, get settings() { return { ...settings }; } };
