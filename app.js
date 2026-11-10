import { analyze, curves, probe, PRESETS, DEFAULT_SETTINGS, PARAMS, inspiratoryMusclePressure, expiratoryMusclePressure, lungPressure, chestWallPressure, systemPressure, simulateBreath, BREATH } from './model.js?v=21';

const $ = id => document.getElementById(id);
const colors = { system: '#800000', lung: '#a65e00', chestWall: '#155f83', grid: '#eaf0f2', axis: '#aebdc4', text: '#666666', ink: '#193944', muscle: '#d22f1e' };
const AX = { pMin: -30, pMax: 60, vMin: 0, vMax: 8 };
const V_DRAW_MAX = 7.6; // the classic figure stops near TLC; room for a hyperinflated TLC

const QUESTIONS = {
  normal: ['Where do the pulls balance?', 'At FRC the lung recoils inward and the chest wall recoils outward with equal and opposite pressures. Which way should FRC move if the lung becomes stiffer?'],
  emphysema: ['Less recoil, bigger lungs', 'Loss of elastic tissue lets the lung curve rotate up and to the left. Why does FRC rise even though nothing changed in the chest wall? What happens to the outward pull of the chest wall at the new FRC?'],
  fibrosis: ['More recoil, smaller lungs', 'A stiff lung needs more pressure at every volume. Follow the FRC and TLC. Why does TLC fall even though muscle strength is normal?'],
  obesity: ['A load on the outside', 'Mass loading pushes the chest wall curve to the right. Which volume changes most, and why might a patient with obesity have trouble with ERV in particular?'],
  kyphoscoliosis: ['A stiff box', 'The lung is normal, yet FRC, TLC, and ERV all fall and the combined curve is flatter. Use 1/Crs = 1/CL + 1/Ccw to explain why the stiffer of the two parts dominates the system compliance.'],
  neuromuscular: ['Weak muscles, normal tissues', 'The compliance curves did not move. Watch the red muscle curves as you lower strength. Where do they now meet the respiratory system curve? Why does FRC stay put? Compare this with the fibrosis pattern.'],
  custom: ['Your own experiment', 'Predict first, then move the slider. Which volumes depend only on the compliance curves, and which also depend on the muscles?'],
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
  ['lungRecoilAtFrc', 'Lung elastic recoil, Pel = Ptp', 'cmH₂O', 1], ['chestWallRecoilAtFrc', 'Pleural pressure, Ppl', 'cmH₂O', 1],
  ['lungCompliance', 'Lung compliance, CL', 'L/cmH₂O', 3], ['chestWallCompliance', 'Chest wall compliance, Ccw', 'L/cmH₂O', 3],
  ['systemCompliance', 'Respiratory system, Crs', 'L/cmH₂O', 3], ['chestWallRestingVolume', 'Chest wall resting volume', 'L', 2],
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
  const compact = w < 560;
  ctx.font = '10px -apple-system, sans-serif'; ctx.lineWidth = 1;
  for (let v = 0; v <= AX.vMax; v++) { ctx.strokeStyle = colors.grid; ctx.beginPath(); ctx.moveTo(left, Y(v)); ctx.lineTo(right, Y(v)); ctx.stroke(); ctx.fillStyle = colors.text; ctx.textAlign = 'right'; ctx.fillText(v, left - 8, Y(v) + 3); }
  for (let p = AX.pMin; p <= AX.pMax; p += 10) { ctx.strokeStyle = p === 0 ? colors.axis : colors.grid; ctx.lineWidth = p === 0 ? 1.4 : 1; ctx.beginPath(); ctx.moveTo(X(p), top); ctx.lineTo(X(p), bottom); ctx.stroke(); ctx.fillStyle = colors.text; ctx.textAlign = 'center'; ctx.fillText(p, X(p), bottom + 16); }
  ctx.lineWidth = 1;
  ctx.fillStyle = colors.text; ctx.textAlign = 'left'; ctx.fillText('Volume (L)', 3, 14);
  ctx.textAlign = 'center'; ctx.fillText(compact ? 'Pressure (cmH₂O)' : 'Pressure (cmH₂O), muscles relaxed · lung: Ptp = PA − Ppl · chest wall: Ppl · system: Prs', (left + right) / 2, h - 6);
  ctx.font = '600 11px -apple-system, sans-serif'; ctx.fillStyle = '#4d4d4d';
  if (compact) {
    ctx.font = '600 10px -apple-system, sans-serif'; ctx.textAlign = 'right'; ctx.fillText('← Compression', X(0) - 6, top - 10);
    ctx.textAlign = 'left'; ctx.fillText('Expansion →', X(0) + 6, top - 10);
  } else {
    ctx.fillText('← Compression (inward)', (left + X(0)) / 2, top - 18); ctx.fillText('Expansion (outward) →', (X(0) + right) / 2, top - 18);
    ctx.font = '10px -apple-system, sans-serif'; ctx.fillStyle = colors.text;
    ctx.fillText('held below its rest volume, so it springs back out', (left + X(0)) / 2, top - 5); ctx.fillText('held above its rest volume, so it recoils back in', (X(0) + right) / 2, top - 5);
  }
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
  return { ctx, clip, line, hline, dot, arrow, X, Y, Yinv, left, right, top, bottom, compact };
}

// Muscle limits, as in the lecture's "Determinants of TLC / RV" figure: the most pressure each muscle
// group can make at each volume. TLC and RV sit where the combined curve meets them.
function drawMuscles(g, a) {
  const m = settings.muscleStrength, seg = (f, v0, v1) => Array.from({ length: 41 }, (_, i) => { const V = v0 + (v1 - v0) * i / 40; return { x: f(V), y: V }; });
  const insp = seg(V => inspiratoryMusclePressure(V, m), Math.max(a.frc, a.tlc - 2), a.tlc);
  const exp = seg(V => -expiratoryMusclePressure(V, m), a.rv, Math.min(a.frc, a.rv + 2));
  const { ctx } = g;
  g.clip(() => { ctx.strokeStyle = colors.muscle; ctx.lineWidth = 3; ctx.setLineDash([9, 6]); for (const pts of [insp, exp]) { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(g.X(p.x), g.Y(p.y)) : ctx.moveTo(g.X(p.x), g.Y(p.y))); ctx.stroke(); } ctx.setLineDash([]); });
  g.dot(insp[insp.length - 1].x, a.tlc, colors.muscle, 4); g.dot(exp[0].x, a.rv, colors.muscle, 4);
  ctx.fillStyle = colors.muscle; ctx.font = '600 11px -apple-system, sans-serif';
  // Labels sit clear of the lines: inspiratory below its line, expiratory above its line.
  const vis = pts => pts.filter(p => p.x >= AX.pMin && p.x <= AX.pMax);
  const vi = vis(insp), ve = vis(exp);
  if (vi.length) { const p = vi[Math.floor(vi.length / 2)]; ctx.textAlign = 'right'; ctx.fillText(g.compact ? 'Muscles' : 'Inspiratory muscles', g.X(p.x) - 6, g.Y(p.y) + 22); }
  if (ve.length) { const p = ve[Math.floor(ve.length / 2)]; ctx.textAlign = 'left'; ctx.fillText(g.compact ? 'Muscles' : 'Expiratory muscles', Math.max(g.left + 4, g.X(p.x) - 30), g.Y(p.y) - 14); }
}

const pctVC = (V, a) => Math.round(100 * (V - a.rv) / a.vc);

function draw() {
  const a = analyze(settings), c = trim(curves(settings, PARAMS, AX)), g = chart('pv');
  const overlay = $('overlay').checked, limits = $('show-limits').checked;
  if (overlay) {
    g.line(healthyCurves.lung, colors.lung, { dashed: true, width: 1.3, alpha: 0.45 });
    g.line(healthyCurves.chestWall, colors.chestWall, { dashed: true, width: 1.3, alpha: 0.45 });
    g.line(healthyCurves.system, colors.system, { dashed: true, width: 1.3, alpha: 0.45 });
  }
  if (limits) { g.hline(a.tlc, '#6b6b6b', `TLC ${a.tlc.toFixed(2)}`); g.hline(a.rv, '#6b6b6b', `RV ${a.rv.toFixed(2)}`); drawMuscles(g, a); }
  g.hline(a.frc, '#4d4d4d', `FRC ${a.frc.toFixed(2)}`, []);
  g.line(c.chestWall, colors.chestWall); g.line(c.lung, colors.lung); g.line(c.system, colors.system, { width: 2.8 });
  // FRC balance, as in the classic figure: the system sits at zero; arrows point to each tissue's recoil.
  g.arrow(0, a.chestWallRecoilAtFrc, a.frc, colors.chestWall); g.arrow(0, a.lungRecoilAtFrc, a.frc, colors.lung);
  g.dot(a.chestWallRecoilAtFrc, a.frc, colors.chestWall); g.dot(a.lungRecoilAtFrc, a.frc, colors.lung); g.dot(0, a.frc, colors.system);
  // Probe: at the chosen volume, show each pressure and their sum.
  const pr = probe(probeVolume, settings);
  if (!breath) {
    g.ctx.save(); g.ctx.globalAlpha = 0.9; g.hline(probeVolume, '#800000', '', [2, 3]); g.ctx.restore();
    g.dot(pr.chestWall, probeVolume, colors.chestWall, 4); g.dot(pr.lung, probeVolume, colors.lung, 4); g.dot(pr.system, probeVolume, colors.system, 4);
  } else drawBreath(g, a);
  // Curve labels at fixed volumes, placed where the curves are well separated.
  const label = (pts, V, text, color, side) => {
    const p = pts.reduce((b, q) => Math.abs(q.y - V) < Math.abs(b.y - V) ? q : b, pts[0]); if (!p || p.x < AX.pMin || p.x > AX.pMax) return;
    g.ctx.fillStyle = color; g.ctx.font = '600 11px -apple-system, sans-serif';
    if (side === 'right' && g.X(p.x) + 8 + g.ctx.measureText(text).width > g.right - 4) side = 'below';
    if (side === 'below') { g.ctx.textAlign = 'right'; g.ctx.fillText(text, g.X(p.x) - 6, g.Y(p.y) + 18); return; }
    g.ctx.textAlign = side === 'left' ? 'right' : 'left';
    g.ctx.fillText(text, g.X(p.x) + (side === 'left' ? -8 : 8), g.Y(p.y) + 4);
  };
  label(c.chestWall, 6.25, 'Chest wall', colors.chestWall, 'left'); label(c.lung, 5.2, 'Lung', colors.lung, 'left'); if (!g.compact) label(c.system, 5.0, 'Lung + chest wall', colors.system, 'right');
  // Chest wall at rest (Pcw = 0), point C in the classic Rahn/Beachey figure.
  const rest = a.chestWallRestingVolume;
  if (rest <= V_DRAW_MAX) {
    g.ctx.save(); g.ctx.fillStyle = 'white'; g.ctx.strokeStyle = colors.chestWall; g.ctx.lineWidth = 2; g.ctx.setLineDash([]);
    g.ctx.beginPath(); g.ctx.arc(g.X(0), g.Y(rest), 5, 0, Math.PI * 2); g.ctx.fill(); g.ctx.stroke();
    g.ctx.fillStyle = colors.chestWall; g.ctx.font = '10px -apple-system, sans-serif'; g.ctx.textAlign = 'right';
    g.ctx.fillText(g.compact ? `Rest ${pctVC(rest, a)}% VC` : `Chest wall at rest (${pctVC(rest, a)}% VC)`, g.X(0) - 10, g.Y(rest) + 4); g.ctx.restore();
  }

  renderBreathPanel();
  renderMetrics('metrics-volumes', VOLUME_METRICS, a);
  renderMetrics('metrics-mech', MECH_METRICS, a);
  for (const [k, s] of Object.entries(sliders)) $(s.out).textContent = s.fmt(settings[k]);
  $('probe-out').textContent = `${probeVolume.toFixed(2)} L · ${pctVC(probeVolume, a)}% VC`;
  const f = x => !Number.isFinite(x) ? (x > 0 ? '+∞' : '−∞') : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1);
  $('probe-sum').innerHTML = `At ${probeVolume.toFixed(2)} L: <b class="lung">P<sub>tp</sub> ${f(pr.lung)}</b> + <b class="cw">P<sub>pl</sub> ${f(pr.chestWall)}</b> = <b class="rs">P<sub>rs</sub> ${f(pr.system)}</b> cmH₂O`
    + `<br><span class="hint">Muscles relaxed, airway held shut at this volume: P<sub>tp</sub> is the lung's elastic recoil (P<sub>el</sub>), P<sub>pl</sub> is the chest wall's recoil, and their sum is the alveolar pressure, P<sub>A</sub> = P<sub>rs</sub>.</span>`
    + `<br><span class="hint">Series check at FRC: 1 / (1/${a.lungCompliance.toFixed(3)} + 1/${a.chestWallCompliance.toFixed(3)}) = ${a.seriesCheck.toFixed(3)} L/cmH₂O, the slope of the combined curve.</span>`;
}

// ---------- one breath ----------
// Ppl falls, PA = Ppl + Pel goes below zero, air flows in, volume rises, Pel rises, and flow stops
// when PA is back to zero. The shaded area under the combined curve is the elastic work.
let breath = null, timer = 0;
const healthyBreath = simulateBreath(DEFAULT_SETTINGS);
function stopBreath() { clearTimeout(timer); breath = null; }
function startBreath() {
  clearTimeout(timer);
  breath = { sim: simulateBreath(settings), t: 0, start: performance.now(), done: false };
  const step = () => {
    breath.t = Math.max(0, Math.min(BREATH.duration, (performance.now() - breath.start) / 1000));
    breath.done = breath.t >= BREATH.duration;
    draw(); if (!breath.done) timer = setTimeout(step, 30);
  };
  step();
}
const breathSample = () => breath.sim.samples[Math.min(breath.sim.samples.length - 1, Math.round(breath.t / BREATH.dt))];
function drawBreath(g, a) {
  const x = breathSample(), sim = breath.sim, ctx = g.ctx;
  const vTop = breath.t >= BREATH.holdUntil ? sim.vPeak : Math.max(sim.frc, x.volume);
  if (vTop > sim.frc + 0.005) { // elastic work: area between the combined curve and Prs = 0
    ctx.save(); ctx.beginPath(); ctx.moveTo(g.X(0), g.Y(sim.frc));
    for (let i = 0; i <= 40; i++) { const V = sim.frc + (vTop - sim.frc) * i / 40; ctx.lineTo(g.X(systemPressure(V, settings, PARAMS)), g.Y(V)); }
    ctx.lineTo(g.X(0), g.Y(vTop)); ctx.closePath(); ctx.fillStyle = 'rgba(128,0,0,0.22)'; ctx.fill();
    ctx.restore();
  }
  ctx.save(); ctx.globalAlpha = 0.9; g.hline(x.volume, '#800000', '', [2, 3]); ctx.restore();
  const pcw = x.ppl + x.pmus;
  g.arrow(pcw, x.ppl, x.volume + 0.09, '#4d4d4d');
  if (Math.abs(g.X(pcw) - g.X(x.ppl)) > 30) { ctx.fillStyle = '#4d4d4d'; ctx.font = '10px -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('muscles', (g.X(pcw) + g.X(x.ppl)) / 2, g.Y(x.volume + 0.09) - 6); }
  g.dot(pcw, x.volume, colors.chestWall, 3); g.dot(x.ppl, x.volume, colors.chestWall, 5); g.dot(x.pel, x.volume, colors.lung, 5);
  ctx.fillStyle = colors.chestWall; ctx.font = '600 10px -apple-system, sans-serif'; ctx.textAlign = 'right'; ctx.fillText('Ppl', g.X(x.ppl) - 8, g.Y(x.volume) + 4);
  ctx.fillStyle = colors.lung; ctx.textAlign = 'left'; ctx.fillText('Pel', g.X(x.pel) + 8, g.Y(x.volume) + 4);
}
function renderBreathPanel() {
  const f = (v, d = 1) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
  const x = breath ? breathSample() : { ppl: analyze(settings).chestWallRecoilAtFrc, pel: analyze(settings).lungRecoilAtFrc, pa: 0, flow: 0, volume: analyze(settings).frc };
  const frc = breath ? breath.sim.frc : x.volume;
  const flowText = Math.abs(x.flow) < 0.02 ? 'no flow' : `${Math.abs(x.flow).toFixed(2)} L/s ${x.flow > 0 ? 'in' : 'out'}`;
  const chip = (label, value, cls = '') => `<div class="chip ${cls}"><span>${label}</span><b>${value}</b></div>`;
  $('breath-chain').innerHTML = [
    chip('Pleural pressure, P<sub>pl</sub>', f(x.ppl) + ' cmH₂O', 'cw'),
    chip('Alveolar, P<sub>A</sub> = P<sub>pl</sub> + P<sub>el</sub>', f(x.pa) + ' cmH₂O', 'rs'),
    chip('Airflow', flowText),
    chip('Volume above FRC', f(x.volume - frc, 2) + ' L'),
    chip('Lung recoil, P<sub>el</sub>', f(x.pel) + ' cmH₂O', 'lung'),
  ].join('<span class="chain-arrow">→</span>');
  const s = breath ? breath.sim : simulateBreath(settings), h = healthyBreath;
  const cmp = Math.abs(s.work - h.work) < 0.02 ? 'the same as healthy' : `${s.work > h.work ? 'more' : 'less'} than the healthy ${h.work.toFixed(2)}`;
  $('breath-note').innerHTML = `For a ${BREATH.tidalVolume} L breath from this FRC, the muscles must lower pleural pressure to ${f(s.samples.find(q => q.t >= BREATH.holdUntil - 1e-9).ppl)} cmH₂O. Elastic work (the shaded area under the combined curve): ${s.work.toFixed(2)} cmH₂O·L (${s.workJ.toFixed(3)} J), ${cmp}.`;
}

function matchPreset() {
  const hit = Object.entries(PRESETS).find(([, p]) => Object.keys(sliders).every(k => Math.abs(p[k] - settings[k]) < 1e-6));
  return hit ? hit[0] : 'custom';
}
function setQuestion(key) { const [t, q] = QUESTIONS[key] || QUESTIONS.custom; $('question-title').textContent = t; $('question').textContent = q; }
function loadPreset(key) { settings = { ...DEFAULT_SETTINGS, ...PRESETS[key] }; delete settings.label; writeSliders(); setQuestion(key); stopBreath(); draw(); }

function exportCsv() {
  const rows = [['volume_L', 'lung_cmH2O', 'chest_wall_cmH2O', 'system_cmH2O', 'healthy_lung_cmH2O', 'healthy_chest_wall_cmH2O', 'healthy_system_cmH2O']];
  for (let V = 1.25; V <= 7.6001; V += 0.05) {
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
for (const s of Object.values(sliders)) $(s.el).addEventListener('input', () => { readSliders(); setQuestion(matchPreset()); stopBreath(); draw(); });
$('overlay').addEventListener('change', draw); $('show-limits').addEventListener('change', draw);
$('probe').addEventListener('input', e => { probeVolume = Number(e.target.value); stopBreath(); draw(); });
$('breathe').addEventListener('click', startBreath);
const canvas = $('pv');
const fromPointer = e => { if (breath && !breath.done) return; const r = canvas.getBoundingClientRect(); const h = Number(canvas.dataset.logicalHeight); const top = 34, bottom = h - 40; const v = AX.vMin + (bottom - (e.clientY - r.top)) / (bottom - top) * (AX.vMax - AX.vMin); probeVolume = Math.min(7.6, Math.max(1.3, v)); $('probe').value = probeVolume; draw(); };
canvas.addEventListener('pointermove', e => { if (breath) return; fromPointer(e); }); canvas.addEventListener('pointerdown', e => { stopBreath(); fromPointer(e); });
$('export').addEventListener('click', exportCsv);
window.addEventListener('resize', draw);
loadPreset('normal');

// Exposed for console checks while teaching or debugging.
window.respiratoryModel = { analyze, probe, lungPressure, chestWallPressure, systemPressure, get settings() { return { ...settings }; } };
