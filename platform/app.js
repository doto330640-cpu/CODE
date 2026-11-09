/* ECM 코스관리 플랫폼 — 경영자 / 코스팀장 두 가지 보기 (데이터: data/courses.json) */
(function () {
  'use strict';
  const $app = document.getElementById('app');
  const COLORS = ['#1F7A52', '#2D7BD3', '#D98E16', '#8A5CD0', '#C4476B'];
  const SVG = 'http://www.w3.org/2000/svg';
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  let DATA = null, SENS = {},  role = 'exec', teamIdx = 0;
  const hidden = new Set(); // 비교 차트에서 숨긴 코스

  /* ---------- 유틸 ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } }
  };
  const f1 = (x) => (x == null ? '—' : x.toFixed(1));
  const f2 = (x) => (x == null ? '—' : x.toFixed(2));
  const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);
  const dObj = (s) => new Date(s + 'T00:00:00');
  const md = (s) => { const d = dObj(s); return `${d.getMonth() + 1}.${d.getDate()}`; };
  const mdw = (s) => `${md(s)}(${WD[dObj(s).getDay()]})`;
  const gap = (a, b) => Math.round((dObj(b) - dObj(a)) / 864e5);
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') e.className = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]);
    }
    kids.flat().forEach((c) => { if (c != null) e.append(c.nodeType ? c : document.createTextNode(c)); });
    return e;
  }
  function s(tag, attrs) { const e = document.createElementNS(SVG, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); return e; }

  // 센서 포트 이름: 위치가 등록된 코스는 '포트1 · 퍼팅그린 하'처럼 보여 준다
  const pn = (name, i) => { const w = ((SENS[name] || {}).ports || [])[i]; return '포트' + (i + 1) + (w ? ' · ' + w : ''); };

  /* ---------- 지표 계산 ---------- */
  const STATUS = {
    bad: { cls: 'bad', tag: 't-bad', label: '관수 점검', rank: 0 },
    off: { cls: 'off', tag: 't-off', label: '센서 중단', rank: 1 },
    watch: { cls: 'watch', tag: 't-watch', label: '주의', rank: 2 },
    ok: { cls: 'ok', tag: 't-ok', label: '양호', rank: 3 }
  };
  function metrics(c) {
    const d = c.daily, wLast = d[d.length - 1];
    const soil = d.filter((x) => x.vwc != null), sLast = soil[soil.length - 1];
    const stale = gap(sLast.date, wLast.date);
    const w7 = d.slice(-7);
    const rain7 = sum(w7.map((x) => x.rain)), et7 = sum(w7.map((x) => x.et0));
    const bal7 = rain7 - et7;
    const v = soil.map((x) => x.vwc), min = Math.min(...v), max = Math.max(...v);
    const p = max > min ? (sLast.vwc - min) / (max - min) : 0.5; // 이 코스의 관측 기간 안에서 현재 수분의 위치(0=최저, 1=최고)
    const ref = soil[soil.length - 8] || soil[0];
    const lowIdx = sLast.ports.reduce((m, x, i, a) => (x != null && (a[m] == null || x < a[m]) ? i : m), 0);
    let dry = 0;
    for (let i = d.length - 1; i >= 0 && (d[i].rain || 0) < 1; i--) dry++;
    let st = 'ok';
    if (stale >= 2) st = 'off';
    else if (p <= 0.25 && bal7 < -5) st = 'bad';
    else if (p <= 0.4 || bal7 < -10) st = 'watch';
    return { c, d, wLast, sLast, stale, rain7, et7, bal7, p, delta: sLast.vwc - ref.vwc, lowIdx, dry, st, S: STATUS[st], min, max };
  }
  const reasons = (m) => {
    const r = [];
    if (m.st === 'off') r.push(`토양센서 값이 ${md(m.sLast.date)} 이후 들어오지 않습니다 (${m.stale}일째). 먼저 전원·통신을 확인하세요.`);
    r.push(`토양수분 ${f1(m.sLast.vwc)}% — 관측 기간(${f1(m.min)}~${f1(m.max)}%) 중 ${Math.round(m.p * 100)}% 위치${m.st === 'off' ? ` (${md(m.sLast.date)} 기준)` : ''}`);
    r.push(`최근 7일 강수 ${f1(m.rain7)}mm, 증발산 ${f1(m.et7)}mm → 수분수지 ${m.bal7 > 0 ? '+' : ''}${f1(m.bal7)}mm`);
    if (m.dry >= 3) r.push(`${m.dry}일 연속 1mm 이상 비가 없었습니다.`);
    if (m.st !== 'off' && m.sLast.ports.filter((x) => x != null).length > 1) r.push(`가장 낮은 곳은 ${pn(m.c.name, m.lowIdx)} (${f1(m.sLast.ports[m.lowIdx])}%)`);
    return r;
  };

  /* ---------- 차트 ---------- */
  function nice(lo, hi) { // 눈금이 떨어지는 값(1·2·5 단위)이 되도록 범위를 넓힌다
    const raw = (hi - lo || 1) / 4, pw = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((k) => k * pw).find((k) => k >= raw) || 10 * pw;
    return { lo: Math.floor(lo / step + 1e-9) * step, hi: Math.ceil(hi / step - 1e-9) * step, step };
  }
  function tipBox(host) { const t = el('div', { class: 'tip', hidden: '' }); host.append(t); return t; }
  function placeTip(t, host, x, y, html) {
    t.innerHTML = html; t.hidden = false;
    const w = t.offsetWidth, W = host.clientWidth;
    t.style.left = Math.max(0, Math.min(x + 12, W - w)) + 'px'; t.style.top = Math.max(0, y - 10) + 'px';
  }
  function lineChart(host, o) {
    host.replaceChildren();
    const W = Math.max(host.clientWidth, 260), H = o.h || 230, m = { t: 12, r: 12, b: 26, l: 38 };
    const n = o.dates.length, x = (i) => m.l + (n > 1 ? (i / (n - 1)) * (W - m.l - m.r) : 0);
    const all = o.series.flatMap((q) => q.vals).filter((v) => v != null);
    if (!all.length) { host.append(el('div', { class: 'empty' }, '표시할 데이터가 없습니다')); return; }
    const nz = nice(o.min != null ? o.min : Math.min(...all) - 0.5, o.max != null ? o.max : Math.max(...all) + 0.5);
    const lo = nz.lo, hi = nz.hi;
    const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.label || '추이 차트' });
    const ax = s('g', { class: 'axis' });
    for (let v = lo; v <= hi + 1e-9; v += nz.step) {
      ax.append(s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: '#E4E9E0' }));
      const t = s('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }); t.textContent = Math.round(v * 100) / 100; ax.append(t);
    }
    const every = Math.ceil(n / Math.max(2, Math.floor((W - m.l) / 52)));
    o.dates.forEach((d, i) => { if ((i % every === 0 && n - 1 - i >= every * 0.6) || i === n - 1) { const t = s('text', { x: x(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }); t.textContent = md(d); ax.append(t); } });
    svg.append(ax);
    if (o.ref != null) { svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(o.ref), y2: y(o.ref), stroke: '#B8C2B6', 'stroke-dasharray': '4 4' })); }
    o.series.forEach((q) => {
      let dd = '', pen = false;
      q.vals.forEach((v, i) => { if (v == null) { pen = false; return; } dd += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); pen = true; });
      svg.append(s('path', { d: dd, fill: 'none', stroke: q.color, 'stroke-width': q.w || 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': q.dash || '' }));
    });
    const rule = s('line', { y1: m.t, y2: H - m.b, stroke: '#9AA89C', display: 'none' }); svg.append(rule);
    const hit = s('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }); svg.append(hit);
    host.append(svg);
    const tip = tipBox(host);
    const move = (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1))));
      rule.setAttribute('x1', x(i)); rule.setAttribute('x2', x(i)); rule.removeAttribute('display');
      const rows = o.series.filter((q) => q.vals[i] != null).map((q) => `<div><i style="background:${q.color}"></i>${q.name} <b style="display:inline;margin:0 0 0 auto;padding-left:10px">${(o.fmt || f1)(q.vals[i])}${o.unit || ''}</b></div>`).join('');
      placeTip(tip, host, (x(i) / W) * host.clientWidth, m.t + 6, `<b>${mdw(o.dates[i])}</b>${rows || '<div>기록 없음</div>'}`);
    };
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { rule.setAttribute('display', 'none'); tip.hidden = true; });
  }
  function rainEtChart(host, d) {
    host.replaceChildren();
    const W = Math.max(host.clientWidth, 260), H = 230, m = { t: 12, r: 12, b: 26, l: 38 }, n = d.length;
    const nz = nice(0, Math.max(4, ...d.map((x) => Math.max(x.rain || 0, x.et0 || 0)))), hi = nz.hi;
    const bw = Math.max(3, ((W - m.l - m.r) / n) * 0.6), cx = (i) => m.l + ((i + 0.5) / n) * (W - m.l - m.r);
    const y = (v) => m.t + (1 - v / hi) * (H - m.t - m.b);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '일별 강수량과 증발산량' }), ax = s('g', { class: 'axis' });
    for (let v = 0; v <= hi + 1e-9; v += nz.step) { ax.append(s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: '#E4E9E0' })); const t = s('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }); t.textContent = Math.round(v * 10) / 10; ax.append(t); }
    const every = Math.ceil(n / Math.max(2, Math.floor((W - m.l) / 52)));
    d.forEach((x, i) => { if ((i % every === 0 && n - 1 - i >= every * 0.6) || i === n - 1) { const t = s('text', { x: cx(i), y: H - 8, 'text-anchor': 'middle' }); t.textContent = md(x.date); ax.append(t); } });
    svg.append(ax);
    d.forEach((x, i) => { if (x.rain) svg.append(s('rect', { x: cx(i) - bw / 2, y: y(x.rain), width: bw, height: Math.max(1, y(0) - y(x.rain)), rx: 3, fill: '#2D7BD3' })); });
    let dd = '', pen = false;
    d.forEach((x, i) => { if (x.et0 == null) { pen = false; return; } dd += (pen ? 'L' : 'M') + cx(i).toFixed(1) + ' ' + y(x.et0).toFixed(1); pen = true; });
    svg.append(s('path', { d: dd, fill: 'none', stroke: '#D98E16', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    const hit = s('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }); svg.append(hit); host.append(svg);
    const tip = tipBox(host);
    const move = (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.floor(((px - m.l) / (W - m.l - m.r)) * n))), x = d[i];
      placeTip(tip, host, (cx(i) / W) * host.clientWidth, m.t + 6, `<b>${mdw(x.date)}</b><div><i style="background:#2D7BD3"></i>강수 <b style="display:inline;margin:0 0 0 auto;padding-left:10px">${f1(x.rain)}mm</b></div><div><i style="background:#D98E16"></i>증발산 <b style="display:inline;margin:0 0 0 auto;padding-left:10px">${x.et0 == null ? '미산출' : f1(x.et0) + 'mm'}</b></div>`);
    };
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move); hit.addEventListener('pointerleave', () => { tip.hidden = true; });
  }
  function spark(vals, color) {
    const v = vals.filter((x) => x != null), svg = s('svg', { viewBox: '0 0 120 44', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    if (v.length < 2) return svg;
    const lo = Math.min(...v), hi = Math.max(...v), n = vals.length;
    let dd = '', pen = false;
    vals.forEach((x, i) => { if (x == null) { pen = false; return; } const px = 3 + (i / (n - 1)) * 114, py = 40 - ((x - lo) / (hi - lo || 1)) * 34; dd += (pen ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1); pen = true; });
    svg.append(s('path', { d: dd, fill: 'none', stroke: color, 'vector-effect': 'non-scaling-stroke', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    return svg;
  }
  function heroArt() { // 코스 등고선 느낌의 장식 (데이터 아님)
    const svg = s('svg', { class: 'art', viewBox: '0 0 600 400', 'aria-hidden': 'true', preserveAspectRatio: 'xMaxYMid slice' });
    for (let k = 0; k < 14; k++) {
      let dd = '';
      for (let a = 0; a <= 360; a += 6) {
        const r = 30 + k * 22 + 9 * Math.sin((a * Math.PI) / 45 + k) + 6 * Math.cos((a * Math.PI) / 30 - k * 0.6), t = (a * Math.PI) / 180;
        dd += (a ? 'L' : 'M') + (360 + r * 1.35 * Math.cos(t)).toFixed(1) + ' ' + (200 + r * 0.9 * Math.sin(t)).toFixed(1);
      }
      svg.append(s('path', { d: dd + 'Z', fill: 'none', stroke: k % 4 === 0 ? '#E8DCC0' : '#6FA35B', 'stroke-width': k % 4 === 0 ? 1.6 : 1, opacity: k % 4 === 0 ? 0.7 : 0.55 }));
    }
    return svg;
  }

  /* ---------- 공통 조각 ---------- */
  const tag = (S, text) => el('span', { class: 'tag ' + S.tag }, text || S.label);
  const kpi = (k, v, unit, d, cls) => el('div', { class: 'card kpi ' + (cls || '') }, el('div', { class: 'k' }, k), el('div', { class: 'v num' }, v, unit ? el('small', null, unit) : null), el('div', { class: 'd' }, d || ''));
  function legend(items, onToggle) {
    return el('div', { class: 'legend' }, items.map((q) => {
      const b = el('button', { 'aria-pressed': String(!hidden.has(q.name)), type: 'button' }, el('i', { style: 'background:' + q.color }), q.name);
      if (onToggle) b.addEventListener('click', () => onToggle(q.name)); return b;
    }));
  }
  const legendStatic = (items) => el('div', { class: 'legend' }, items.map((q) => el('span', { style: 'display:inline-flex;align-items:center;gap:6px' }, el('i', { style: `width:14px;height:${q.bar ? 10 : 4}px;border-radius:2px;background:${q.color}` }), q.name)));
  const howto = () => el('details', { class: 'how' }, el('summary', null, '판정 기준 보기'),
    el('p', null, '코스마다 토양 종류와 센서 위치가 달라 수분(%)의 절대 기준을 하나로 두지 않았습니다. 각 코스의 관측 기간 안에서 현재 수분이 어디쯤인지와 최근 7일 수분수지(강수 − 증발산)를 함께 봅니다.'),
    el('p', null, el('b', null, '관수 점검'), ': 수분이 하위 25% 이하이고 7일 수분수지가 −5mm 미만. ', el('b', null, '주의'), ': 하위 40% 이하이거나 수분수지 −10mm 미만. ', el('b', null, '센서 중단'), ': 토양 값이 2일 이상 끊김.'),
    el('p', null, '※ 위 기준은 현장 확정 전 내부 가정값입니다. 증발산량은 FAO-56 계산값(작물계수 미적용)이며 부분일은 제외했습니다. 센서 포트와 홀의 대응은 코스 등록 시 지정해야 합니다.'));

  /* ---------- 경영자 보기 ---------- */
  function renderExec() {
    const ms = DATA.courses.map(metrics), by = (st) => ms.filter((m) => m.st === st);
    const bad = by('bad'), off = by('off'), watch = by('watch');
    const asof = ms.reduce((a, m) => (m.wLast.date > a ? m.wLast.date : a), '');
    const head = bad.length ? `${bad.map((m) => m.c.name).join('·')} 관수 점검이 필요합니다` : off.length ? `${off.map((m) => m.c.name).join('·')} 센서 수신이 끊겨 있습니다` : watch.length ? `${watch.map((m) => m.c.name).join('·')} 수분 흐름을 주시할 시점입니다` : '전 코스 수분 상태가 안정적입니다';
    const avgBal = ms.reduce((a, m) => a + m.bal7, 0) / ms.length;
    const root = el('div', { style: 'display:contents' });
    root.append(el('section', { class: 'hero' }, heroArt(), el('div', { class: 'eyebrow' }, `경영 현황 · ${mdw(asof)} 기준`),
      el('h1', null, head),
      el('p', null, `${ms.length}개 코스 센서 자료를 한 화면에서 비교합니다. 코스를 누르면 팀장 화면으로 이어집니다.`),
      el('div', { class: 'chips' }, [`관수 점검 ${bad.length}곳`, `주의 ${watch.length}곳`, `센서 중단 ${off.length}곳`, `양호 ${by('ok').length}곳`].map((t) => el('span', null, t)))));

    root.append(el('section', { class: 'kpis' },
      kpi('모니터링 코스', String(ms.length), '곳', '센서 연동 코스'),
      kpi('관수 점검', String(bad.length), '곳', bad.length ? bad.map((m) => m.c.name).join(', ') : '해당 없음', bad.length ? 'bad' : 'ok'),
      kpi('센서 이상', String(off.length), '곳', off.length ? off.map((m) => `${m.c.name} ${m.stale}일째`).join(', ') : '전 코스 수신 중', off.length ? 'watch' : 'ok'),
      kpi('7일 수분수지 평균', (avgBal > 0 ? '+' : '') + f1(avgBal), 'mm', '강수 − 증발산, 5개 코스 평균', avgBal < -5 ? 'watch' : '')));

    root.append(el('section', { class: 'grid g5' }, ms.map((m, i) => {
      const last14 = m.d.filter((x) => x.vwc != null).slice(-14).map((x) => x.vwc);
      const b = el('button', { class: 'cc', type: 'button', 'aria-label': `${m.c.name} 상세 보기` },
        el('div', { class: 'top' }, el('b', null, m.c.name), tag(m.S)),
        el('div', { class: 'mid' }, el('div', null, el('div', { class: 'big num' }, f1(m.sLast.vwc), el('small', null, '%')), el('div', { class: 'lbl' }, `토양수분 · ${md(m.sLast.date)}${m.delta < 0 ? ' · 7일 ' + f1(m.delta) : ' · 7일 +' + f1(m.delta)}`)), spark(last14, COLORS[i])),
        el('div', { class: 'foot num' }, el('span', null, '강수 ', el('b', null, f1(m.rain7) + 'mm')), el('span', null, '증발산 ', el('b', null, f1(m.et7) + 'mm')), el('span', null, '수지 ', el('b', null, (m.bal7 > 0 ? '+' : '') + f1(m.bal7)))));
      b.addEventListener('click', () => go('team', i)); return b;
    })));

    const cmp = el('div', { class: 'card' }), cmpHost = el('div', { class: 'chart' });
    const draw = () => {
      const dates = [...new Set(ms.flatMap((m) => m.d.filter((x) => x.vwc != null).map((x) => x.date)))].sort().slice(-21);
      lineChart(cmpHost, { dates, label: '코스별 토양수분 추이', unit: '%', min: 8, max: 26, series: ms.filter((m) => !hidden.has(m.c.name)).map((m) => ({ name: m.c.name, color: COLORS[ms.indexOf(m)], vals: dates.map((d) => (m.d.find((x) => x.date === d) || {}).vwc ?? null) })) });
    };
    const lg = el('div'), mkLegend = () => lg.replaceChildren(legend(ms.map((m, i) => ({ name: m.c.name, color: COLORS[i] })), (n) => { hidden.has(n) ? hidden.delete(n) : hidden.add(n); mkLegend(); draw(); }));
    mkLegend();
    cmp.append(el('div', { class: 'ch' }, el('h2', null, '코스별 토양수분 비교'), el('span', { class: 'sub' }, '최근 21일 · 3개 포트 평균 · 이름을 눌러 켜고 끔')), cmpHost, lg);

    const bal = el('div', { class: 'card' }), mx = Math.max(10, ...ms.map((m) => Math.abs(m.bal7)));
    bal.append(el('div', { class: 'ch' }, el('h2', null, '7일 수분수지'), el('span', { class: 'sub' }, '강수 − 증발산(mm) · 음수일수록 물이 부족')),
      el('div', { class: 'ports' }, ms.slice().sort((a, b) => a.bal7 - b.bal7).map((m) => el('div', { class: 'port num' + (m.bal7 < -10 ? ' low' : '') }, el('span', null, m.c.name),
        el('div', { class: 'tr' }, el('b', { style: `width:${(Math.abs(m.bal7) / mx) * 100}%;background:${m.bal7 < 0 ? (m.bal7 < -10 ? '#CF3F3F' : '#D98E16') : '#2E8B57'}` })), el('span', null, (m.bal7 > 0 ? '+' : '') + f1(m.bal7))))),
      el('p', { class: 'note', style: 'margin:12px 0 0' }, `기간 내 비가 가장 적었던 곳은 ${ms.slice().sort((a, b) => a.rain7 - b.rain7)[0].c.name}(7일 ${f1(ms.slice().sort((a, b) => a.rain7 - b.rain7)[0].rain7)}mm)입니다.`));
    root.append(el('section', { class: 'grid g2' }, cmp, bal));

    const order = ms.slice().sort((a, b) => a.S.rank - b.S.rank || a.p - b.p);
    root.append(el('section', { class: 'card' }, el('div', { class: 'ch' }, el('h2', null, '조치 우선순위'), el('span', { class: 'sub' }, '긴급도 순 · 코스팀장에게 전달할 사항')),
      el('ol', { class: 'prio' }, order.map((m, i) => el('li', { class: m.S.cls },
        el('div', { class: 'n' }, String(i + 1)),
        el('div', null, el('b', null, m.c.name + ' · ' + m.S.label), el('span', { class: 'r' }, m.st === 'off' ? `토양센서 ${m.stale}일째 미수신 — 점검 요청` : m.st === 'bad' ? `수분 하위 ${Math.round(m.p * 100)}%, 7일 수지 ${f1(m.bal7)}mm — 오늘 관수 점검` : m.st === 'watch' ? `수분 ${f1(m.sLast.vwc)}%, 7일 수지 ${(m.bal7 > 0 ? '+' : '') + f1(m.bal7)}mm — 추이 확인` : `수분 ${f1(m.sLast.vwc)}% — 특이사항 없음`)),
        (() => { const b = el('button', { class: 'link', type: 'button' }, '팀장 화면'); b.addEventListener('click', () => go('team', ms.indexOf(m))); return b; })()))),
      el('div', { style: 'margin-top:12px' }, howto())));
    root.append(el('p', { class: 'note' }, DATA.source + ' 경영 지표(내장객·객단가·비용)는 자료 연동 후 추가됩니다.'));
    $app.replaceChildren(root);
    draw();
  }

  /* ---------- 코스팀장 보기 ---------- */
  function renderTeam() {
    const ms = DATA.courses.map(metrics), m = ms[teamIdx], d = m.d, soil = d.filter((x) => x.vwc != null).slice(-21);
    const root = el('div', { style: 'display:contents' });
    root.append(el('div', { class: 'picker', role: 'group', 'aria-label': '코스 선택' }, ms.map((x, i) => {
      const b = el('button', { 'aria-pressed': String(i === teamIdx), type: 'button' }, el('i', { style: `background:var(--${x.S.cls === 'off' ? 'off' : x.S.cls})` }), x.c.name);
      b.addEventListener('click', () => go('team', i)); return b;
    })));

    const headline = m.st === 'bad' ? '오늘 관수를 점검하세요' : m.st === 'off' ? '센서부터 확인하세요' : m.st === 'watch' ? '수분 추이를 지켜보세요' : '오늘은 현재 관리 유지';
    root.append(el('section', { class: 'card decide' },
      el('div', null, el('div', { class: 'ch', style: 'margin:0' }, el('span', { class: 'sub' }, `${m.c.name} · 오늘의 판단`), tag(m.S)), el('div', { class: 'big' }, headline), el('ul', { class: 'reasons' }, reasons(m).map((r) => el('li', null, r)))),
      el('div', { class: 'ports' }, el('div', { class: 'sub note' }, `센서 포트별 토양수분 (${md(m.sLast.date)})`),
        m.sLast.ports.map((v, i) => el('div', { class: 'port num' + (i === m.lowIdx && m.st !== 'ok' ? ' low' : '') }, el('span', { style: 'font-size:.82em' }, pn(m.c.name, i)), el('div', { class: 'tr' }, el('b', { style: `width:${v == null ? 0 : Math.min(100, (v / 30) * 100)}%;background:${COLORS[i]}` })), el('span', null, v == null ? '—' : f1(v) + '%'))),
        el('div', { class: 'note' }, (SENS[m.c.name] && SENS[m.c.name].map ? '센서 위치: ' + SENS[m.c.name].map + ' · ' : '') + '막대 최대치는 30%입니다.'))));

    const last = m.sLast;
    root.append(el('section', { class: 'kpis' },
      kpi('토양수분 평균', f1(last.vwc), '%', `${md(last.date)} · 7일 ${m.delta >= 0 ? '+' : ''}${f1(m.delta)}`, m.st === 'bad' ? 'bad' : m.st === 'watch' ? 'watch' : ''),
      kpi('지온', f1(last.soilT), '℃', '포트 평균'),
      kpi('공극수 EC', f2(last.ec), 'mS/cm', '포트 평균'),
      kpi('7일 수분수지', (m.bal7 > 0 ? '+' : '') + f1(m.bal7), 'mm', `강수 ${f1(m.rain7)} − 증발산 ${f1(m.et7)}`, m.bal7 < -10 ? 'bad' : ''),
      kpi('마지막 수신', md(last.date), '', m.stale >= 1 ? `기상 대비 ${m.stale}일 지연` : '정상 수신', m.stale >= 2 ? 'bad' : 'ok')));

    const c1 = el('div', { class: 'card' }), h1 = el('div', { class: 'chart' });
    const ports = [0, 1, 2].filter((i) => soil.some((x) => x.ports[i] != null));
    c1.append(el('div', { class: 'ch' }, el('h2', null, '토양수분 추이'), el('span', { class: 'sub' }, '포트별 · 최근 21일 (%)')), h1,
      legendStatic([...ports.map((i) => ({ name: pn(m.c.name, i), color: COLORS[i] })), { name: '평균', color: '#1D2A22' }]));
    const c2 = el('div', { class: 'card' }), h2 = el('div', { class: 'chart' });
    c2.append(el('div', { class: 'ch' }, el('h2', null, '강수와 증발산'), el('span', { class: 'sub' }, '일별 (mm) · 막대가 선보다 낮으면 물이 줄어드는 날')), h2,
      legendStatic([{ name: '강수량', color: '#2D7BD3', bar: true }, { name: '증발산량(ET0)', color: '#D98E16' }]));
    const c3 = el('div', { class: 'card' }), h3 = el('div', { class: 'chart' });
    c3.append(el('div', { class: 'ch' }, el('h2', null, '기온과 지온'), el('span', { class: 'sub' }, '일 평균 (℃)')), h3,
      legendStatic([{ name: '기온', color: '#C4476B' }, { name: '지온', color: '#8A5CD0' }]));
    const c4 = el('div', { class: 'card' }), h4 = el('div', { class: 'chart' });
    c4.append(el('div', { class: 'ch' }, el('h2', null, '공극수 EC'), el('span', { class: 'sub' }, '포트 평균 (mS/cm) · 시비 후 변화 확인용')), h4);
    root.append(el('section', { class: 'grid g2' }, c1, c2, c3, c4));

    /* 오늘 작업 */
    const key = `ecm.tasks.${m.c.name}.${m.wLast.date}`, st = store.get(key, { done: {}, custom: [] });
    const auto = [];
    if (m.st === 'off') auto.push({ id: 'sensor', t: '토양센서 전원·통신 점검', n: `${md(m.sLast.date)} 이후 미수신` });
    if (m.st === 'bad') auto.push({ id: 'irr', t: `${pn(m.c.name, m.lowIdx)} 주변 분할 관수`, n: `수분 ${f1(m.sLast.ports[m.lowIdx])}% · 한 번에 많이 주기보다 나눠서` });
    if (m.st === 'watch') auto.push({ id: 'chk', t: '건조 의심 구역 현장 확인 후 관수 여부 결정', n: `수분수지 ${f1(m.bal7)}mm` });
    auto.push({ id: 'verify', t: '센서 값과 현장 상태를 대조 (그린 표면 단단함·잔디 시들음)', n: '센서는 한 지점 값입니다' });
    const list = el('ul', { class: 'tasks' });
    const saveSt = () => store.set(key, st);
    const drawTasks = () => {
      list.replaceChildren(...[...auto.map((a) => ({ id: a.id, t: a.t, n: a.n })), ...st.custom.map((c) => ({ id: c.id, t: c.t, n: '직접 추가', custom: true }))].map((it) => {
        const done = !!st.done[it.id];
        const b = el('button', { class: 'chk', type: 'button', 'aria-label': (done ? '완료 취소: ' : '완료: ') + it.t, 'aria-pressed': String(done) }, el('svg', { viewBox: '0 0 24 24' }, ...[(() => { const p = s('path', { d: 'M5 12.5l4.5 4.5L19 7.5' }); return p; })()]));
        b.addEventListener('click', () => { st.done[it.id] = !done; saveSt(); drawTasks(); });
        const li = el('li', { class: done ? 'done' : '' }, b, el('div', { class: 'tt' }, it.t, el('small', null, it.n)));
        if (it.custom) { const x = el('button', { class: 'x', type: 'button', 'aria-label': '삭제' }, '삭제'); x.addEventListener('click', () => { st.custom = st.custom.filter((c) => c.id !== it.id); delete st.done[it.id]; saveSt(); drawTasks(); }); li.append(x); } else li.append(el('span'));
        return li;
      }));
    };
    const inp = el('input', { type: 'text', placeholder: '오늘 할 일을 직접 추가 (예: 3번홀 그린 롤링)', 'aria-label': '작업 직접 추가', maxlength: '60' });
    const add = () => { const t = inp.value.trim(); if (!t) return; st.custom.push({ id: 'c' + Date.now(), t }); inp.value = ''; saveSt(); drawTasks(); };
    const addBtn = el('button', { class: 'btn', type: 'button' }, '추가'); addBtn.addEventListener('click', add); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    root.append(el('section', { class: 'card' }, el('div', { class: 'ch' }, el('h2', null, '오늘 작업'), el('span', { class: 'sub' }, `${mdw(m.wLast.date)} · 체크 내용은 이 기기에 저장됩니다`)), list, el('div', { class: 'addrow' }, inp, addBtn), el('div', { style: 'margin-top:12px' }, howto())));
    drawTasks();

    $app.replaceChildren(root);
    const dates = soil.map((x) => x.date);
    const draw = () => {
      lineChart(h1, { dates, label: '포트별 토양수분', unit: '%', series: [...ports.map((i) => ({ name: pn(m.c.name, i), color: COLORS[i], w: 1.8, vals: soil.map((x) => x.ports[i]) })), { name: '평균', color: '#1D2A22', w: 2.8, dash: '5 4', vals: soil.map((x) => x.vwc) }] });
      rainEtChart(h2, d.slice(-21));
      const dd = d.slice(-21).map((x) => x.date);
      lineChart(h3, { dates: dd, label: '기온과 지온', unit: '℃', series: [{ name: '기온', color: '#C4476B', vals: d.slice(-21).map((x) => x.tmean) }, { name: '지온', color: '#8A5CD0', vals: d.slice(-21).map((x) => x.soilT) }] });
      lineChart(h4, { dates, label: '공극수 EC', fmt: f2, min: 0, max: Math.max(0.2, ...soil.map((x) => x.ec || 0)) * 1.3, series: [{ name: 'EC', color: '#1F7A52', vals: soil.map((x) => x.ec) }] });
    };
    draw(); window.__redraw = draw;
  }

  /* ---------- 라우팅 ---------- */
  function go(r, i) { location.hash = r === 'team' ? '#team/' + encodeURIComponent(DATA.courses[i != null ? i : teamIdx].name) : '#exec'; }
  function route() {
    if (!DATA) return;
    const h = decodeURIComponent(location.hash.slice(1)) || store.get('ecm.role', 'exec');
    const [r, name] = h.split('/');
    role = r === 'team' ? 'team' : 'exec';
    if (name) { const i = DATA.courses.findIndex((c) => c.name === name); if (i >= 0) teamIdx = i; }
    store.set('ecm.role', role === 'team' ? 'team/' + DATA.courses[teamIdx].name : 'exec');
    document.getElementById('roleExec').setAttribute('aria-pressed', String(role === 'exec'));
    document.getElementById('roleTeam').setAttribute('aria-pressed', String(role === 'team'));
    window.__redraw = null;
    role === 'exec' ? renderExec() : renderTeam();
    window.scrollTo(0, 0);
  }
  document.getElementById('roleExec').addEventListener('click', () => go('exec'));
  document.getElementById('roleTeam').addEventListener('click', () => go('team'));
  window.addEventListener('hashchange', route);
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (DATA) { const y = window.scrollY; route(); window.scrollTo(0, y); } }, 200); });

  Promise.all([fetch('data/courses.json').then((r) => r.json()), fetch('data/sensors.json').then((r) => r.json()).catch(() => ({ courses: {} }))]).then(([j, sj]) => {
    DATA = j; SENS = sj.courses || {};
    const asof = j.courses.reduce((a, c) => { const l = c.daily[c.daily.length - 1].date; return l > a ? l : a; }, '');
    document.getElementById('asof').textContent = `자료 기준 ${mdw(asof)}`;
    route();
  }).catch(() => { $app.replaceChildren(el('div', { class: 'card empty' }, '데이터를 불러오지 못했습니다. 연결을 확인한 뒤 새로고침하세요.')); });
})();
