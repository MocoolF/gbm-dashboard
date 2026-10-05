'use strict';

/* ===================== utils ===================== */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };

const MON  = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const MONG = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const DOW  = ['пн','вт','ср','чт','пт','сб','вс'];

const iso   = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const addD  = (s,n) => { const d = parse(s); d.setDate(d.getDate()+n); return iso(d); };
const monStart = s => s.slice(0,8) + '01';
const monEnd   = s => { const d = parse(s); return iso(new Date(d.getFullYear(), d.getMonth()+1, 0)); };
const daysIn   = (a,b) => Math.round((parse(b) - parse(a)) / 864e5) + 1;
const short    = s => { const d = parse(s); return `${d.getDate()} ${MONG[d.getMonth()].slice(0,3)}`; };
const long     = s => { const d = parse(s); return `${d.getDate()} ${MONG[d.getMonth()]} ${d.getFullYear()}`; };

const nf  = n => new Intl.NumberFormat('ru-RU').format(Math.round(n));
const money = n => nf(n) + ' ₽';
const moneyShort = n => n >= 1e6 ? (n/1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.',',') + ' млн ₽'
                      : n >= 1e4 ? Math.round(n/1e3) + ' тыс ₽' : nf(n) + ' ₽';
const pct = (a,b) => b > 0 ? Math.round(a/b*100) : 0;
const plural = (n, f) => { const m = n % 10, h = n % 100;
  return f[(m === 1 && h !== 11) ? 0 : (m >= 2 && m <= 4 && (h < 10 || h >= 20)) ? 1 : 2]; };

const TODAY = iso(new Date());

/* ===================== state ===================== */
const S = {
  leads: [], spend: [], channels: [], stages: [], goals: {},
  from: monStart(TODAY), to: TODAY, preset: 'month', sel: new Set()
};

/* ===================== load ===================== */
async function boot() {
  try {
    const [cfg, leads, spend, goals] = await Promise.all(
      ['data/channels.json','data/leads.json','data/spend.json','data/goals.json']
        .map(u => fetch(u, {cache:'no-store'}).then(r => { if (!r.ok) throw new Error(u); return r.json(); }))
    );
    S.channels = cfg.channels; S.stages = cfg.stages;
    S.leads = leads; S.spend = spend; S.goals = goals;
    S.sel = new Set(S.channels.map(c => c.id));
  } catch (e) {
    $('#view-summary').innerHTML = `<div class="card"><div class="empty">Не удалось загрузить данные: ${e.message}<br><br>
      Открой папку через локальный сервер: <code>python3 -m http.server</code></div></div>`;
    return;
  }
  initTheme(); initDate(); initChannels();
  $('#updated').textContent = 'обновлено ' + long(TODAY);
  render();
}

/* ===================== theme ===================== */
function initTheme() {
  const saved = (() => { try { return localStorage.getItem('gbm-theme'); } catch { return null; } })();
  if (saved) document.documentElement.dataset.theme = saved;
  else if (matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';
  $('#themeBtn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('gbm-theme', next); } catch {}
    render();
  };
}

/* ===================== filtering ===================== */
const inRange = (d, a, b) => !!d && d >= a && d <= b;
const chanOk  = l => S.sel.has(l.channel);

function slice(from, to) {
  const L = S.leads.filter(l => chanOk(l) && inRange(l.date, from, to));          // когорта заявок
  const sp = S.spend.filter(s => S.sel.has(s.channel) && inRange(s.date, from, to));
  const ev = S.leads.filter(chanOk);                                              // события в периоде
  const spend  = sp.reduce((a,s) => a + s.amount, 0);
  const quals  = L.filter(l => l.qual_date).length;
  const zooms  = ev.filter(l => inRange(l.zoom_date, from, to)).length;
  const sales  = ev.filter(l => inRange(l.won_date, from, to));
  return {
    leads: L, spend, nLeads: L.length, quals,
    cpl:  L.length ? spend / L.length : 0,
    cpql: quals ? spend / quals : 0,
    zooms, nSales: sales.length,
    revenue: sales.reduce((a,l) => a + (l.amount||0), 0),
    funnel: {
      lead: L.length,
      qual: quals,
      zoom_set: L.filter(l => l.zoom_set_date).length,
      zoom:     L.filter(l => l.zoom_date).length,
      offer:    L.filter(l => l.offer_date).length,
      won:      L.filter(l => l.won_date).length
    }
  };
}

/* по дням: значение метрики на каждую дату периода */
function series(from, to, kind) {
  const out = new Map();
  for (let d = from; d <= to; d = addD(d, 1)) out.set(d, 0);
  if (kind === 'spend') {
    S.spend.forEach(s => { if (S.sel.has(s.channel) && out.has(s.date)) out.set(s.date, out.get(s.date) + s.amount); });
  } else {
    const key = { leads:'date', quals:'qual_date', zooms:'zoom_date', sales:'won_date' }[kind];
    S.leads.forEach(l => { if (!chanOk(l)) return; const d = l[key]; if (d && out.has(d)) out.set(d, out.get(d) + 1); });
  }
  return [...out].map(([date, v]) => ({ date, v }));
}

/* ===================== render ===================== */
function render() {
  const cur  = slice(S.from, S.to);
  const len  = daysIn(S.from, S.to);
  const pTo   = addD(S.from, -1), pFrom = addD(pTo, -(len - 1));
  const prev = slice(pFrom, pTo);
  renderGoals();
  renderKpis(cur, prev, pFrom, pTo);
  renderFunnel(cur.funnel);
  renderRings(cur.funnel);
  renderCharts();
}

/* ---------- goals ---------- */
function renderGoals() {
  const mKey = S.to.slice(0,7);
  const g = S.goals[mKey];
  const box = $('#goals');
  if (!g) { box.innerHTML = `<div class="goal"><div class="empty">Цель на ${MON[+mKey.slice(5,7)-1]} не задана в <code>data/goals.json</code></div></div>`; return; }

  const mS = mKey + '-01', mE = monEnd(mS);
  const total = daysIn(mS, mE);
  const passed = Math.min(Math.max(daysIn(mS, TODAY < mE ? TODAY : mE), 0), total);
  const left = total - passed;
  const ev = S.leads.filter(chanOk);
  const fact = {
    leads: ev.filter(l => inRange(l.date, mS, mE)).length,
    zooms: ev.filter(l => inRange(l.zoom_date, mS, mE)).length
  };
  const names = { leads:['Первичные заявки',['заявка','заявки','заявок']], zooms:['Зумы / консультации',['зум','зума','зумов']] };

  box.innerHTML = '';
  ['leads','zooms'].forEach(k => {
    const goal = g[k]; if (goal == null) return;
    const f = fact[k];
    const planNow = goal * passed / total;
    const fc = passed > 0 ? Math.round(f / passed * total) : 0;
    const diff = Math.round(f - planNow);
    const perDay = left > 0 ? Math.max(0, (goal - f) / left) : 0;
    const state = fc >= goal ? 'ok' : fc >= goal * 0.85 ? 'warn' : 'bad';
    const label = { ok:'в графике', warn:'есть риск', bad:'отстаём' }[state];
    const need  = Math.max(0, goal - f);
    const pace  = left <= 0 ? '—' : perDay < 1 ? `ещё <b>${need}</b> за ${left} ${plural(left,['день','дня','дней'])}`
                                               : `<b>${perDay.toFixed(1)}</b>/день`;
    const [title, forms] = names[k];

    box.append(el('div','goal',`
      <div class="goal__top">
        <span class="goal__name">${title}</span>
        <span class="goal__period">${MON[+mKey.slice(5,7)-1]} ${mKey.slice(0,4)} · день ${passed} из ${total}</span>
        <span class="goal__pill ${state}">${label}</span>
      </div>
      <div class="goal__nums">
        <span class="goal__fact">${f}</span>
        <span class="goal__plan">/ ${goal} ${plural(goal, forms)}</span>
        <span class="goal__pct">${pct(f, goal)}%</span>
      </div>
      <div class="bar">
        <div class="bar__fill ${state}" style="width:${Math.min(100, pct(f, goal))}%"></div>
        <div class="bar__pace" style="left:${Math.min(100, passed/total*100)}%" title="темп плана"></div>
      </div>
      <div class="goal__legend">
        <span>план на сегодня <b>${Math.round(planNow)}</b></span>
        <span>прогноз месяца <b>${fc}</b></span>
        <span>${diff === 0 ? 'ровно по плану' : (diff < 0 ? 'отставание ' : 'опережение ') + `<b>${Math.abs(diff)}</b>`}</span>
        <span>нужно ${pace}</span>
      </div>`));
  });
}

/* ---------- kpi ---------- */
function renderKpis(c, p, pFrom, pTo) {
  const items = [
    { n:'Бюджет',        v: moneyShort(c.spend),  raw:c.spend,  prev:p.spend,  kind:'spend',  inv:true,  sub:`CPL ${c.cpl ? money(c.cpl) : '—'}` },
    { n:'Заявки',        v: nf(c.nLeads),         raw:c.nLeads, prev:p.nLeads, kind:'leads',  sub:'первичные' },
    { n:'Квал. заявки',  v: nf(c.quals),          raw:c.quals,  prev:p.quals,  kind:'quals',  sub:`${pct(c.quals, c.nLeads)}% от заявок` },
    { n:'Цена квала',    v: c.cpql ? money(c.cpql) : '—', raw:c.cpql, prev:p.cpql, kind:null, inv:true, sub:'бюджет / квал' },
    { n:'Зумы',          v: nf(c.zooms),          raw:c.zooms,  prev:p.zooms,  kind:'zooms',  sub:'проведено' },
    { n:'Продажи',       v: nf(c.nSales),         raw:c.nSales, prev:p.nSales, kind:'sales',  sub:`${pct(c.nSales, c.nLeads)}% от заявок` },
    { n:'Выручка',       v: moneyShort(c.revenue),raw:c.revenue,prev:p.revenue,kind:null,
        sub: c.nSales ? `чек ${moneyShort(c.revenue / c.nSales)}` : 'нет оплат' }
  ];
  const box = $('#kpis'); box.innerHTML = '';
  items.forEach(it => {
    const d = it.prev > 0 ? (it.raw - it.prev) / it.prev * 100 : (it.raw > 0 ? 100 : 0);
    const good = it.inv ? d < 0 : d > 0;
    const cls = Math.abs(d) < 0.5 ? 'flat' : good ? 'up' : 'down';
    const arrow = Math.abs(d) < 0.5 ? '' : d > 0 ? '↑' : '↓';
    const node = el('div','kpi',`
      <div class="kpi__name">${it.n}</div>
      <div class="kpi__val">${it.v}</div>
      <div class="kpi__sub">
        <span class="delta ${cls}">${arrow}${Math.abs(Math.round(d))}%</span>
        <span>· ${it.sub}</span>
      </div>`);
    const sp = el('div','kpi__spark');
    if (it.kind) sp.append(sparkline(series(S.from, S.to, it.kind), it.inv));
    node.append(sp);
    node.title = `${it.n}: ${it.v}\nпрошлый период (${short(pFrom)}–${short(pTo)}): ${
      it.kind === 'spend' || it.n === 'Выручка' ? moneyShort(it.prev) : it.n === 'Цена квала' ? money(it.prev) : nf(it.prev)}`;
    box.append(node);
  });
}

/* ---------- funnel ---------- */
function renderFunnel(f) {
  const vals = S.stages.map(s => f[s.id] || 0);
  const max = Math.max(...vals, 1);
  const box = $('#funnel'); box.innerHTML = '';
  const wrap = el('div','fn');
  S.stages.forEach((s, i) => {
    const v = vals[i], prev = i ? vals[i-1] : null;
    const w = Math.max(v / max * 100, v > 0 ? 2 : 0);
    const inside = w > 14;
    const row = el('div','fn__row',`
      <div class="fn__lbl">${s.name}</div>
      <div class="fn__barwrap">
        <div class="fn__bar" style="width:${w}%;background:var(--fun${i+1})">
          ${inside ? `<span class="fn__v">${nf(v)}</span>` : ''}
        </div>
        ${inside ? '' : `<span class="fn__v fn__v--out">${nf(v)}</span>`}
        <span class="fn__cv">${prev !== null ? `<b>${pct(v, prev)}%</b> от пред.` : ''}${
          i > 1 ? ` · <b>${pct(v, vals[0])}%</b> от заявок` : ''}</span>
      </div>`);
    wrap.append(row);
  });
  box.append(wrap);
  if (!vals[0]) box.innerHTML = '<div class="empty">За выбранный период заявок нет</div>';
}

/* ---------- rings ---------- */
function renderRings(f) {
  const steps = [
    ['Квалификация','заявка → квал',       f.qual,     f.lead],
    ['Назначен зум','квал → назначен',     f.zoom_set, f.qual],
    ['Дошёл до зума','назначен → проведён',f.zoom,     f.zoom_set],
    ['Отправлено КП','зум → КП',           f.offer,    f.zoom],
    ['Закрытие','КП → продажа',            f.won,      f.offer],
    ['Итог','заявка → продажа',            f.won,      f.lead]
  ];
  const box = $('#rings'); box.innerHTML = '';
  steps.forEach(([n, s, a, b], i) => {
    const p = pct(a, b);
    box.append(el('div','ring', `${ringSvg(p, i === 5)}
      <div><div class="ring__n">${n}</div><div class="ring__s">${s} · ${nf(a)}/${nf(b)}</div></div>`));
  });
}
function ringSvg(p, accent) {
  const R = 26, C = 2 * Math.PI * R, off = C * (1 - Math.min(p,100) / 100);
  return `<svg width="68" height="68" viewBox="0 0 68 68" role="img" aria-label="${p}%">
    <circle cx="34" cy="34" r="${R}" fill="none" stroke="var(--line-2)" stroke-width="7"/>
    <circle cx="34" cy="34" r="${R}" fill="none" stroke="${accent ? 'var(--s2)' : 'var(--brand)'}" stroke-width="7"
      stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${off}" transform="rotate(-90 34 34)"/>
    <text x="34" y="34" text-anchor="middle" dominant-baseline="central"
      font-size="15" font-weight="700" fill="var(--ink)" font-family="inherit">${p}%</text>
  </svg>`;
}

/* ---------- charts ---------- */
function renderCharts() {
  const n = daysIn(S.from, S.to);
  const step = n <= 45 ? 'day' : n <= 200 ? 'week' : 'month';
  $('#dynHint').textContent = `${short(S.from)} — ${short(S.to)} · по ${{day:'дням',week:'неделям',month:'месяцам'}[step]}`;
  const defs = [
    { t:'Бюджет',      kind:'spend', color:'var(--s1)', money:true },
    { t:'Заявки',      kind:'leads', color:'var(--s2)' },
    { t:'Квал. заявки',kind:'quals', color:'var(--s3)' },
    { t:'Зумы',        kind:'zooms', color:'var(--s6)' }
  ];
  const box = $('#charts'); box.innerHTML = '';
  defs.forEach(d => {
    const data = bin(series(S.from, S.to, d.kind), step);
    const sum = data.reduce((a,x) => a + x.v, 0);
    const w = el('div','ch', `<div class="ch__head"><span class="ch__t">${d.t}</span>
      <span class="ch__sum">всего ${d.money ? moneyShort(sum) : nf(sum)}</span></div>`);
    w.append(lineChart(data, d.color, d.money, step));
    box.append(w);
  });
}

function bin(rows, step) {
  if (step === 'day') return rows.map(r => ({ ...r, label: short(r.date), end: r.date }));
  const out = [], size = step === 'week' ? 7 : 0;
  if (step === 'week') {
    for (let i = 0; i < rows.length; i += size) {
      const g = rows.slice(i, i + size);
      out.push({ date:g[0].date, end:g[g.length-1].date, v:g.reduce((a,x)=>a+x.v,0),
                 label:`${short(g[0].date)}–${short(g[g.length-1].date)}` });
    }
  } else {
    const m = new Map();
    rows.forEach(r => { const k = r.date.slice(0,7); if (!m.has(k)) m.set(k, {date:r.date, end:r.date, v:0, label:`${MON[+k.slice(5,7)-1]}`}); 
      const o = m.get(k); o.v += r.v; o.end = r.date; });
    out.push(...m.values());
  }
  return out;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const mk = (t, a) => { const n = document.createElementNS(SVGNS, t); for (const k in a) n.setAttribute(k, a[k]); return n; };

function sparkline(rows, inverse) {
  const W = 120, H = 28, P = 2;
  const svg = mk('svg', { viewBox:`0 0 ${W} ${H}`, class:'ch__svg', preserveAspectRatio:'none', height:H, 'aria-hidden':'true' });
  const max = Math.max(...rows.map(r => r.v), 1);
  const x = i => P + i * (W - 2*P) / Math.max(rows.length - 1, 1);
  const y = v => H - P - (v / max) * (H - 2*P);
  const pts = rows.map((r,i) => `${x(i).toFixed(1)},${y(r.v).toFixed(1)}`).join(' ');
  svg.append(mk('polyline', { points:`${P},${H} ${pts} ${W-P},${H}`, fill:'currentColor', opacity:.07, stroke:'none' }));
  svg.append(mk('polyline', { points:pts, fill:'none', stroke:'currentColor', 'stroke-width':1.6,
    'stroke-linejoin':'round', 'stroke-linecap':'round', opacity:.5 }));
  svg.style.color = inverse ? 'var(--ink-2)' : 'var(--brand)';
  return svg;
}

function lineChart(rows, color, isMoney, step) {
  const W = 520, H = 150, L = 42, R = 10, T = 12, B = 24;
  const iw = W - L - R, ih = H - T - B;
  const svg = mk('svg', { viewBox:`0 0 ${W} ${H}`, class:'ch__svg', role:'img' });
  const max = Math.max(...rows.map(r => r.v), 1);
  const nice = niceMax(max);
  const x = i => L + (rows.length === 1 ? iw/2 : i * iw / (rows.length - 1));
  const y = v => T + ih - (v / nice) * ih;

  for (let i = 0; i <= 2; i++) {
    const v = nice * i / 2, yy = y(v);
    svg.append(mk('line', { x1:L, x2:W-R, y1:yy, y2:yy, stroke:'var(--line-2)', 'stroke-width':1 }));
    const t = mk('text', { x:L-7, y:yy+3.5, 'text-anchor':'end', 'font-size':10, fill:'var(--ink-3)' });
    t.textContent = isMoney ? (v >= 1000 ? Math.round(v/1000)+'к' : Math.round(v)) : Math.round(v);
    svg.append(t);
  }

  const pts = rows.map((r,i) => `${x(i).toFixed(1)},${y(r.v).toFixed(1)}`).join(' ');
  svg.append(mk('polygon', { points:`${L},${T+ih} ${pts} ${x(rows.length-1).toFixed(1)},${T+ih}`,
    fill:color, opacity:.10, stroke:'none' }));
  svg.append(mk('polyline', { points:pts, fill:'none', stroke:color, 'stroke-width':2,
    'stroke-linejoin':'round', 'stroke-linecap':'round' }));

  const everyN = Math.ceil(rows.length / 6);
  rows.forEach((r,i) => {
    if (i % everyN === 0 || i === rows.length - 1) {
      const t = mk('text', { x:x(i), y:H-7, 'text-anchor':'middle', 'font-size':10, fill:'var(--ink-3)' });
      t.textContent = step === 'day' ? short(r.date) : r.label;
      svg.append(t);
    }
  });

  const cross = mk('line', { y1:T, y2:T+ih, stroke:'var(--ink-3)', 'stroke-width':1, 'stroke-dasharray':'3 3', opacity:0 });
  const dot = mk('circle', { r:4.5, fill:color, stroke:'var(--surface)', 'stroke-width':2, opacity:0 });
  svg.append(cross, dot);

  const tip = $('#tip');
  const move = ev => {
    const b = svg.getBoundingClientRect();
    const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - b.left) / b.width * W;
    let i = Math.round((px - L) / (iw / Math.max(rows.length - 1, 1)));
    i = Math.max(0, Math.min(rows.length - 1, i));
    const r = rows[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', .6);
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(r.v)); dot.setAttribute('opacity', 1);
    tip.hidden = false;
    tip.innerHTML = `<div class="tip__d">${step === 'day' ? long(r.date) : r.label}</div><b>${isMoney ? money(r.v) : nf(r.v)}</b>`;
    const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX), cy = (ev.touches ? ev.touches[0].clientY : ev.clientY);
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(innerWidth - tw - 8, cx - tw/2)) + 'px';
    tip.style.top  = Math.max(8, cy - th - 14) + 'px';
  };
  const out = () => { cross.setAttribute('opacity',0); dot.setAttribute('opacity',0); tip.hidden = true; };
  svg.addEventListener('mousemove', move);
  svg.addEventListener('mouseleave', out);
  svg.addEventListener('touchstart', move, {passive:true});
  svg.addEventListener('touchmove', move, {passive:true});
  svg.addEventListener('touchend', out);
  return svg;
}

function niceMax(v) {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / p * 2) / 2 * p;
}

/* ===================== date picker ===================== */
const PRESETS = [
  ['today','Сегодня',          () => [TODAY, TODAY]],
  ['yday','Вчера',             () => [addD(TODAY,-1), addD(TODAY,-1)]],
  ['d7','Последние 7 дней',    () => [addD(TODAY,-6), TODAY]],
  ['d30','Последние 30 дней',  () => [addD(TODAY,-29), TODAY]],
  ['month','Текущий месяц',    () => [monStart(TODAY), TODAY]],
  ['pmonth','Прошлый месяц',   () => { const p = addD(monStart(TODAY), -1); return [monStart(p), p]; }],
  ['q','Последние 90 дней',    () => [addD(TODAY,-89), TODAY]],
  ['all','Всё время',          () => ['2000-01-01', TODAY]]
];

let dpFrom = null, dpTo = null, dpLeft = null;

function initDate() {
  const ctrl = $('#dateCtrl'), btn = $('#dateBtn'), pop = $('#datePop');
  btn.onclick = e => {
    e.stopPropagation();
    const open = !pop.hidden;
    closeAll();
    if (!open) { dpFrom = S.from; dpTo = S.to; dpLeft = monStart(addD(monStart(S.to), -1)); pop.hidden = false; ctrl.classList.add('is-open'); drawDate(); }
  };
  pop.onclick = e => e.stopPropagation();
  applyDateLabel();
}

function applyDateLabel() {
  const p = PRESETS.find(p => p[0] === S.preset);
  $('#dateLabel').textContent = S.preset && p && S.preset !== 'custom'
    ? p[1] : `${short(S.from)} — ${short(S.to)}`;
}

function drawDate() {
  const pop = $('#datePop');
  pop.innerHTML = '';
  const pres = el('div','dp__presets');
  PRESETS.forEach(([id, name, fn]) => {
    const b = el('button','dp__preset' + (S.preset === id ? ' is-active' : ''), name);
    b.onclick = () => { const [a,z] = fn(); S.from = a; S.to = z; S.preset = id; closeAll(); applyDateLabel(); render(); };
    pres.append(b);
  });
  const right = el('div','dp__right');
  const months = el('div','dp__months');
  months.append(monthView(dpLeft, true), monthView(monStart(addD(monEnd(dpLeft), 1)), false));
  const foot = el('div','dp__foot', `<span class="dp__cur">${dpFrom ? long(dpFrom) : '…'} — ${dpTo ? long(dpTo) : '…'}</span>`);
  const cancel = el('button','btn','Отмена'); cancel.onclick = closeAll;
  const ok = el('button','btn btn--primary','Применить');
  ok.onclick = () => { if (!dpFrom) return; S.from = dpFrom; S.to = dpTo || dpFrom; S.preset = 'custom'; closeAll(); applyDateLabel(); render(); };
  foot.append(cancel, ok);
  right.append(months, foot);
  pop.append(pres, right);
}

function monthView(mStart, withPrev) {
  const d = parse(mStart), Y = d.getFullYear(), M = d.getMonth();
  const wrap = el('div','dp__month');
  const nav = el('div','dp__nav');
  if (withPrev) {
    const b = el('button','dp__navbtn','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 18l-6-6 6-6"/></svg>');
    b.onclick = () => { dpLeft = monStart(addD(mStart, -1)); drawDate(); };
    nav.append(b);
  } else nav.append(el('span'));
  nav.append(el('span','dp__mname', `${MON[M]} ${Y}`));
  if (!withPrev) {
    const b = el('button','dp__navbtn','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 18l6-6-6-6"/></svg>');
    b.disabled = monStart(TODAY) <= mStart;
    b.onclick = () => { dpLeft = monStart(addD(mStart, 1)); drawDate(); };
    nav.append(b);
  } else nav.append(el('span'));

  const grid = el('div','dp__grid');
  DOW.forEach(w => grid.append(el('div','dp__dow', w)));
  const first = (new Date(Y, M, 1).getDay() + 6) % 7;
  for (let i = 0; i < first; i++) grid.append(el('span'));
  const last = new Date(Y, M+1, 0).getDate();
  for (let day = 1; day <= last; day++) {
    const ds = iso(new Date(Y, M, day));
    const dow = (new Date(Y, M, day).getDay() + 6) % 7;
    const b = el('button','dp__day' + (dow > 4 ? ' is-we' : ''), String(day));
    b.disabled = ds > TODAY;
    const a = dpFrom, z = dpTo;
    if (a && z && ds > a && ds < z) b.classList.add('in-range');
    if (ds === a || ds === z) {
      b.classList.add('is-edge');
      b.classList.add(a === z ? 'edge-both' : ds === a ? 'edge-start' : 'edge-end');
    }
    b.onclick = () => {
      if (!dpFrom || (dpFrom && dpTo)) { dpFrom = ds; dpTo = null; }
      else if (ds < dpFrom) { dpTo = dpFrom; dpFrom = ds; }
      else dpTo = ds;
      drawDate();
    };
    grid.append(b);
  }
  wrap.append(nav, grid);
  return wrap;
}

/* ===================== channels ===================== */
function initChannels() {
  const ctrl = $('#chanCtrl'), btn = $('#chanBtn'), pop = $('#chanPop');
  btn.onclick = e => {
    e.stopPropagation();
    const open = !pop.hidden;
    closeAll();
    if (!open) { pop.hidden = false; ctrl.classList.add('is-open'); drawChannels(); }
  };
  pop.onclick = e => e.stopPropagation();
  chanLabel();
}
function chanLabel() {
  const n = S.sel.size, all = S.channels.length;
  $('#chanLabel').textContent = n === all ? 'Все каналы'
    : n === 0 ? 'Канал не выбран'
    : n === 1 ? S.channels.find(c => S.sel.has(c.id)).name
    : `${n} ${plural(n,['канал','канала','каналов'])}`;
}
function drawChannels() {
  const pop = $('#chanPop'); pop.innerHTML = '';
  const counts = new Map();
  S.leads.forEach(l => { if (inRange(l.date, S.from, S.to)) counts.set(l.channel, (counts.get(l.channel)||0) + 1); });
  S.channels.forEach(c => {
    const on = S.sel.has(c.id);
    const row = el('label','chan__row' + (on ? ' on' : ''), `
      <span class="chan__box"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><path d="M5 13l4 4L19 7"/></svg></span>
      <span class="chan__dot" style="background:${c.color}"></span>
      <span>${c.name}</span>
      <span class="chan__n">${counts.get(c.id) || 0}</span>`);
    row.onclick = e => {
      e.preventDefault();
      S.sel.has(c.id) ? S.sel.delete(c.id) : S.sel.add(c.id);
      drawChannels(); chanLabel(); render();
    };
    pop.append(row);
  });
  const foot = el('div','chan__foot');
  const all = el('button','btn','Все'); all.onclick = () => { S.sel = new Set(S.channels.map(c=>c.id)); drawChannels(); chanLabel(); render(); };
  const none = el('button','btn','Снять'); none.onclick = () => { S.sel = new Set(); drawChannels(); chanLabel(); render(); };
  foot.append(all, none);
  pop.append(foot);
}

/* ===================== misc ===================== */
function closeAll() {
  $$('.pop').forEach(p => p.hidden = true);
  $$('.ctrl').forEach(c => c.classList.remove('is-open'));
}
document.addEventListener('click', closeAll);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

boot();
