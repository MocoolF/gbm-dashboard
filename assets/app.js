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
const weekStart = () => addD(TODAY, -((parse(TODAY).getDay() + 6) % 7));   // понедельник текущей недели

/* ===================== state ===================== */
const S = {
  leads: [], spend: [], channels: [], stages: [], goals: {}, niches: [], offers: [],
  from: monStart(TODAY), to: TODAY, preset: 'month', sel: new Set(),
  tab: 'summary', cols: null, sort: { key:'spend', dir:-1 }, collapsed: new Set(),
  pending: new Map(), removed: new Set(), nf: {}
};

const REPO = 'MocoolF/gbm-dashboard';

/* колонки таблицы дозвонов */
const COLS = [
  { k:'spend', n:'Бюджет',      f:v => money(v),            on:true },
  { k:'leads', n:'Цифра 1',     f:v => nf(v),               on:true, hint:'заявка' },
  { k:'cpl',   n:'CPL',         f:v => v ? money(v) : '—',  on:true },
  { k:'quals', n:'Квал. заявки',f:v => nf(v),               on:true },
  { k:'cpql',  n:'CPL квала',   f:v => v ? money(v) : '—',  on:true },
  { k:'zooms', n:'Зумы',        f:v => nf(v),               on:true },
  { k:'sales', n:'Продажи',     f:v => nf(v),               on:true },
  { k:'revenue', n:'Выручка',   f:v => v ? moneyShort(v) : '—', on:false }
];

/* ===================== load ===================== */
async function boot() {
  try {
    const [cfg, leads, spend, goals] = await Promise.all(
      ['data/channels.json','data/leads.json','data/spend.json','data/goals.json']
        .map(u => fetch(u, {cache:'no-store'}).then(r => { if (!r.ok) throw new Error(u); return r.json(); }))
    );
    S.channels = cfg.channels; S.stages = cfg.stages;
    S.niches = cfg.niches || []; S.offers = cfg.offers || [];
    S.leads = leads; S.spend = spend; S.goals = goals;
    S.sel = new Set(S.channels.map(c => c.id));
  } catch (e) {
    $('#view-summary').innerHTML = `<div class="card"><div class="empty">Не удалось загрузить данные: ${e.message}<br><br>
      Открой папку через локальный сервер: <code>python3 -m http.server</code></div></div>`;
    return;
  }
  initTheme(); initDate(); initChannels(); initCols(); initTabs();
  $('#updated').textContent = 'обновлено ' + long(TODAY);
  render();
  if (GH.token) reload();
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
  const L = S.leads.filter(l => chanOk(l) && inRange(l.date, from, to));   // когорта заявок периода
  const sp = S.spend.filter(s => S.sel.has(s.channel) && inRange(s.date, from, to));
  const spend  = sp.reduce((a,s) => a + s.amount, 0);
  const quals  = L.filter(l => l.qual_date).length;
  const zooms  = L.filter(l => l.zoom_date).length;
  const sales  = L.filter(l => l.won_date);
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
      zoom:     zooms,
      offer:    L.filter(l => l.offer_date).length,
      won:      sales.length
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
    // считаем по дате заявки: метрика падает в тот день, когда лид пришёл
    const need = { leads:null, quals:'qual_date', zooms:'zoom_date', sales:'won_date' }[kind];
    S.leads.forEach(l => {
      if (!chanOk(l) || (need && !l[need])) return;
      if (out.has(l.date)) out.set(l.date, out.get(l.date) + 1);
    });
  }
  return [...out].map(([date, v]) => ({ date, v }));
}

/* ===================== render ===================== */
function initTabs() {
  $$('#tabs .tab').forEach(b => b.onclick = () => {
    S.tab = b.dataset.tab;
    $$('#tabs .tab').forEach(x => x.classList.toggle('is-active', x === b));
    $('#view-summary').hidden = S.tab !== 'summary';
    $('#view-calls').hidden   = S.tab !== 'calls';
    $('#view-data').hidden    = S.tab !== 'data';
    $('#chanCtrl').hidden = S.tab !== 'summary';
    $('#colCtrl').hidden  = S.tab !== 'calls';
    $('.filters').hidden  = S.tab === 'data';
    render();
  });
}

function render() {
  if (S.tab === 'calls') return renderCalls();
  if (S.tab === 'data')  return renderData();
  const cur  = slice(S.from, S.to);
  const len  = daysIn(S.from, S.to);
  const pTo   = addD(S.from, -1), pFrom = addD(pTo, -(len - 1));
  const prev = slice(pFrom, pTo);
  renderTop(cur, prev);
  renderGoals();
  renderKpis(cur, prev, pFrom, pTo);
  renderFunnel(cur.funnel);
  renderRings(cur.funnel);
  renderCharts();
}

/* ---------- top: бюджет и цена заявки ---------- */
function renderTop(c, p) {
  const items = [
    { n:'Бюджет',                  v: money(c.spend), raw:c.spend, prev:p.spend, kind:'spend', neutral:true },
    { n:'Стоимость первичной заявки', v: c.cpl ? money(c.cpl) : '—', raw:c.cpl, prev:p.cpl, kind:null }
  ];
  const box = $('#top'); box.innerHTML = '';
  items.forEach(it => {
    const d = it.prev > 0 ? (it.raw - it.prev) / it.prev * 100 : (it.raw > 0 ? 100 : 0);
    const cls = it.neutral || Math.abs(d) < 0.5 ? 'flat' : d < 0 ? 'up' : 'down';
    const arrow = Math.abs(d) < 0.5 ? '' : d > 0 ? '↑' : '↓';
    const node = el('div','big',`
      <div class="big__name">${it.n}</div>
      <div class="big__row">
        <span class="big__val">${it.v}</span>
        <span class="delta ${cls}">${arrow}${Math.abs(Math.round(d))}%</span>
      </div>`);
    if (it.kind) { const s = el('div','big__spark'); s.append(sparkline(series(S.from, S.to, it.kind), true)); node.append(s); }
    box.append(node);
  });
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
  const cohort = ev.filter(l => inRange(l.date, mS, mE));
  const fact = { leads: cohort.length, zooms: cohort.filter(l => l.zoom_date).length };
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
    const need  = Math.max(0, goal - f);
    const pace  = left <= 0 ? '—' : perDay < 1 ? `ещё <b>${need}</b> за ${left} ${plural(left,['день','дня','дней'])}`
                                               : `<b>${perDay.toFixed(1)}</b>/день`;
    const [title, forms] = names[k];

    box.append(el('div','goal',`
      <div class="goal__top">
        <span class="goal__name">${title}</span>
        <span class="goal__period">${MON[+mKey.slice(5,7)-1]} ${mKey.slice(0,4)}</span>
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
        <span>нужно ${pace}</span>
      </div>`));
  });
}

/* ---------- kpi ---------- */
function renderKpis(c, p, pFrom, pTo) {
  const items = [
    { n:'Заявки',        v: nf(c.nLeads),         raw:c.nLeads, prev:p.nLeads, kind:'leads' },
    { n:'Квал. заявки',  v: nf(c.quals),          raw:c.quals,  prev:p.quals,  kind:'quals' },
    { n:'Цена квала',    v: c.cpql ? money(c.cpql) : '—', raw:c.cpql, prev:p.cpql, kind:null, inv:true },
    { n:'Зумы',          v: nf(c.zooms),          raw:c.zooms,  prev:p.zooms,  kind:'zooms' },
    { n:'Продажи',       v: nf(c.nSales),         raw:c.nSales, prev:p.nSales, kind:'sales' },
    { n:'Выручка',       v: moneyShort(c.revenue),raw:c.revenue,prev:p.revenue,kind:null }
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
      </div>`);
    const sp = el('div','kpi__spark');
    if (it.kind) sp.append(sparkline(series(S.from, S.to, it.kind), it.inv));
    node.append(sp);
    node.title = `${it.n}: ${it.v}\nпрошлый период (${short(pFrom)}–${short(pTo)}): ${
      it.kind === 'spend' || it.n === 'Выручка' ? moneyShort(it.prev) : it.n === 'Цена квала' ? money(it.prev) : nf(it.prev)}`;
    box.append(node);
  });
}

/* ===================== лист «Дозвоны» ===================== */
function callRows(from, to) {
  const L = S.leads.filter(l => l.channel === 'calls' && inRange(l.date, from, to));
  const SP = S.spend.filter(s => s.channel === 'calls' && inRange(s.date, from, to));
  const blank = () => ({ spend:0, leads:0, quals:0, zooms:0, sales:0, revenue:0 });
  const agg = new Map();           // offerId -> метрики
  S.offers.forEach(o => agg.set(o.id, blank()));
  SP.forEach(s => { const o = agg.get(s.offer); if (o) o.spend += s.amount; });
  L.forEach(l => {
    const o = agg.get(l.offer); if (!o) return;
    o.leads++;
    if (l.qual_date) o.quals++;
    if (l.zoom_date) o.zooms++;
    if (l.won_date) { o.sales++; o.revenue += l.amount || 0; }
  });
  const fin = m => ({ ...m, cpl: m.leads ? m.spend/m.leads : 0, cpql: m.quals ? m.spend/m.quals : 0 });

  const byNiche = S.niches.map(nch => {
    const offers = S.offers.filter(o => o.niche === nch.id)
      .map(o => ({ id:o.id, name:o.name, ...fin(agg.get(o.id)) }))
      .filter(o => o.spend > 0 || o.leads > 0);
    const t = blank();
    offers.forEach(o => { t.spend += o.spend; t.leads += o.leads; t.quals += o.quals;
                          t.zooms += o.zooms; t.sales += o.sales; t.revenue += o.revenue; });
    return { id:nch.id, name:nch.name, offers, ...fin(t) };
  }).filter(n => n.offers.length);

  const tot = blank();
  byNiche.forEach(n => { tot.spend += n.spend; tot.leads += n.leads; tot.quals += n.quals;
                         tot.zooms += n.zooms; tot.sales += n.sales; tot.revenue += n.revenue; });
  return { byNiche, total: fin(tot) };
}

function renderCalls() {
  const { byNiche, total } = callRows(S.from, S.to);
  const len = daysIn(S.from, S.to);
  const pTo = addD(S.from, -1), pFrom = addD(pTo, -(len - 1));
  const prev = callRows(pFrom, pTo).total;

  /* сводка */
  const tiles = [
    { n:'Бюджет',       v: money(total.spend),  raw:total.spend, prev:prev.spend, neutral:true },
    { n:'Цифра 1',      v: nf(total.leads),     raw:total.leads, prev:prev.leads },
    { n:'CPL',          v: total.cpl ? money(total.cpl) : '—', raw:total.cpl, prev:prev.cpl, inv:true },
    { n:'Квал. заявки', v: nf(total.quals),     raw:total.quals, prev:prev.quals },
    { n:'CPL квала',    v: total.cpql ? money(total.cpql) : '—', raw:total.cpql, prev:prev.cpql, inv:true },
    { n:'Зумы',         v: nf(total.zooms),     raw:total.zooms, prev:prev.zooms },
    { n:'Продажи',      v: nf(total.sales),     raw:total.sales, prev:prev.sales }
  ];
  const top = $('#callsTop'); top.className = 'kpis kpis--7'; top.innerHTML = '';
  tiles.forEach(it => {
    const d = it.prev > 0 ? (it.raw - it.prev) / it.prev * 100 : (it.raw > 0 ? 100 : 0);
    const good = it.inv ? d < 0 : d > 0;
    const cls = it.neutral || Math.abs(d) < 0.5 ? 'flat' : good ? 'up' : 'down';
    const arrow = Math.abs(d) < 0.5 ? '' : d > 0 ? '↑' : '↓';
    top.append(el('div','kpi',`
      <div class="kpi__name">${it.n}</div>
      <div class="kpi__val">${it.v}</div>
      <div class="kpi__sub"><span class="delta ${cls}">${arrow}${Math.abs(Math.round(d))}%</span></div>`));
  });

  /* таблица */
  const cols = COLS.filter(c => S.cols.has(c.k));
  const t = $('#callsTbl'); t.innerHTML = '';
  const thead = el('thead'); const hr = el('tr');
  const th0 = el('th','tbl__name','Ниша и оффер'); hr.append(th0);
  cols.forEach(c => {
    const th = el('th','tbl__num' + (S.sort.key === c.k ? ' is-sort' : ''),
      `${c.n}${S.sort.key === c.k ? `<span class="tbl__arr">${S.sort.dir < 0 ? '↓' : '↑'}</span>` : ''}`);
    th.onclick = () => { S.sort = { key:c.k, dir: S.sort.key === c.k ? -S.sort.dir : -1 }; renderCalls(); };
    hr.append(th);
  });
  thead.append(hr); t.append(thead);

  const sorted = [...byNiche].sort((a,b) => (a[S.sort.key] - b[S.sort.key]) * S.sort.dir);
  const tb = el('tbody');
  sorted.forEach(n => {
    const open = !S.collapsed.has(n.id);
    const tr = el('tr','tbl__niche');
    tr.append(el('td','tbl__name',
      `<span class="tbl__t" title="${n.name}"><span class="tbl__chev">${open ? '▾' : '▸'}</span>${n.name}
       <span class="tbl__cnt">${n.offers.length}</span></span>`));
    cols.forEach(c => tr.append(el('td','tbl__num', c.f(n[c.k]))));
    tr.onclick = () => { S.collapsed.has(n.id) ? S.collapsed.delete(n.id) : S.collapsed.add(n.id); renderCalls(); };
    tb.append(tr);
    if (!open) return;
    [...n.offers].sort((a,b) => (a[S.sort.key] - b[S.sort.key]) * S.sort.dir).forEach(o => {
      const r = el('tr','tbl__offer');
      r.append(el('td','tbl__name', `<span class="tbl__t" title="${o.name}">${o.name}</span>`));
      cols.forEach(c => r.append(el('td','tbl__num', c.f(o[c.k]))));
      tb.append(r);
    });
  });
  t.append(tb);

  const tf = el('tfoot'); const fr = el('tr');
  fr.append(el('td','tbl__name','Итого'));
  cols.forEach(c => fr.append(el('td','tbl__num', c.f(total[c.k]))));
  tf.append(fr); t.append(tf);

  if (!byNiche.length) t.innerHTML = '<tbody><tr><td class="empty">За выбранный период дозвонов не было</td></tr></tbody>';
}

/* выбор колонок */
function initCols() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('gbm-cols')); } catch {}
  S.cols = new Set(Array.isArray(saved) && saved.length ? saved : COLS.filter(c => c.on).map(c => c.k));
  const ctrl = $('#colCtrl'), btn = $('#colBtn'), pop = $('#colPop');
  btn.onclick = e => {
    e.stopPropagation();
    const open = !pop.hidden;
    closeAll();
    if (!open) { pop.hidden = false; ctrl.classList.add('is-open'); drawCols(); }
  };
  pop.onclick = e => e.stopPropagation();
  colLabel();
}
function colLabel() { $('#colLabel').textContent = `Колонки · ${S.cols.size}`; }
function drawCols() {
  const pop = $('#colPop'); pop.innerHTML = '';
  COLS.forEach(c => {
    const on = S.cols.has(c.k);
    const row = el('label','chan__row' + (on ? ' on' : ''), `
      <span class="chan__box"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><path d="M5 13l4 4L19 7"/></svg></span>
      <span>${c.n}</span>${c.hint ? `<span class="chan__n">${c.hint}</span>` : ''}`);
    row.onclick = e => {
      e.preventDefault();
      if (S.cols.has(c.k)) { if (S.cols.size > 1) S.cols.delete(c.k); } else S.cols.add(c.k);
      try { localStorage.setItem('gbm-cols', JSON.stringify([...S.cols])); } catch {}
      drawCols(); colLabel(); renderCalls();
    };
    pop.append(row);
  });
}

/* ---------- funnel ---------- */
function renderFunnel(f) {
  const vals = S.stages.map(s => f[s.id] || 0);
  const max = Math.max(...vals, 1);
  const box = $('#funnel'); box.innerHTML = '';
  const wrap = el('div','fn');
  S.stages.forEach((s, i) => {
    const v = vals[i];
    const w = Math.max(v / max * 100, v > 0 ? 2 : 0);
    const inside = w > 14;
    const row = el('div','fn__row',`
      <div class="fn__lbl">${s.name}</div>
      <div class="fn__barwrap">
        <div class="fn__bar" style="width:${w}%;background:var(--fun${i+1})">
          ${inside ? `<span class="fn__v">${nf(v)}</span>` : ''}
        </div>
        ${inside ? '' : `<span class="fn__v fn__v--out">${nf(v)}</span>`}
      </div>`);
    wrap.append(row);
  });
  box.append(wrap);
  if (!vals[0]) box.innerHTML = '<div class="empty">За выбранный период заявок нет</div>';
}

/* ---------- rings ---------- */
function renderRings(f) {
  const steps = [
    ['Квалификация','заявка → квал',   f.qual, f.lead],
    ['Дошёл до зума','квал → зум',     f.zoom, f.qual],
    ['Закрытие','зум → продажа',       f.won,  f.zoom],
    ['Итог','заявка → продажа',        f.won,  f.lead]
  ];
  const box = $('#rings'); box.innerHTML = '';
  steps.forEach(([n, s, a, b], i) => {
    const p = pct(a, b);
    box.append(el('div','ring', `${ringSvg(p, i === 3)}
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
  $('#dynHint').textContent = `${short(S.from)} — ${short(S.to)} · по ${{day:'дням',week:'неделям',month:'месяцам'}[step]} · всё по дате заявки`;
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
  ['week','Текущая неделя',    () => [weekStart(), TODAY]],
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

const QUICK = [['today','Сегодня'], ['week','Неделя'], ['month','Месяц']];

function renderQuick() {
  const box = $('#quick'); if (!box) return;
  box.innerHTML = '';
  QUICK.forEach(([id, name]) => {
    const b = el('button','quick__b' + (S.preset === id ? ' is-on' : ''), name);
    b.onclick = () => {
      const [a, z] = PRESETS.find(p => p[0] === id)[2]();
      S.from = a; S.to = z; S.preset = id;
      closeAll(); applyDateLabel(); render();
    };
    box.append(b);
  });
}

function applyDateLabel() {
  const p = PRESETS.find(p => p[0] === S.preset);
  $('#dateLabel').textContent = S.preset && p && S.preset !== 'custom'
    ? p[1] : `${short(S.from)} — ${short(S.to)}`;
  renderQuick();
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

/* ===================== GitHub как хранилище ===================== */
const GH = {
  get token() { try { return localStorage.getItem('gbm-gh-token') || ''; } catch { return ''; } },
  set token(v) { try { v ? localStorage.setItem('gbm-gh-token', v) : localStorage.removeItem('gbm-gh-token'); } catch {} }
};

function b64enc(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g,'')), c => c.charCodeAt(0)));

async function ghApi(path, opts = {}) {
  const h = { 'Accept':'application/vnd.github+json', ...(opts.headers || {}) };
  if (GH.token) h.Authorization = 'Bearer ' + GH.token;
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, { ...opts, headers: h });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${(JSON.parse(txt || '{}').message) || txt.slice(0,120)}`);
  return txt ? JSON.parse(txt) : {};
}
async function ghRead(file) {
  const j = await ghApi(`/contents/${file}?ref=main&_=${Date.now()}`);
  return { sha: j.sha, data: JSON.parse(b64dec(j.content)) };
}
async function ghSave(file, mutate, message) {
  let last;
  for (let i = 0; i < 3; i++) {
    const { sha, data } = await ghRead(file);
    const next = mutate(JSON.parse(JSON.stringify(data)));
    try {
      await ghApi(`/contents/${file}`, { method:'PUT', body: JSON.stringify({
        message, content: b64enc(JSON.stringify(next, null, 1)), sha, branch:'main' }) });
      return next;
    } catch (e) { last = e; if (!/^(409|422)/.test(e.message)) throw e; }
  }
  throw last;
}

/* латиница для id */
const SLUG_MAP = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',
  н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
function slug(s, used) {
  let out = s.toLowerCase().split('').map(c => SLUG_MAP[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,28) || 'id';
  let base = out, i = 2;
  while (used.includes(out)) out = `${base}_${i++}`;
  return out;
}
const nextLeadId = () => {
  const max = S.leads.reduce((m,l) => Math.max(m, parseInt(String(l.id).replace(/\D/g,''), 10) || 0), 0);
  return n => `L${String(max + n).padStart(4,'0')}`;
};

/* ===================== лист «Данные» ===================== */
const STATUSES = [
  ['new','Заявка'], ['qual','Квал'], ['zoom_set','Зум назначен'], ['zoom','Зум проведён'],
  ['offer','КП отправлено'], ['won','Продажа'], ['lost','Отказ']
];
const FLOW = [['qual','qual_date'],['zoom_set','zoom_set_date'],['zoom','zoom_date'],['offer','offer_date'],['won','won_date']];

function applyStatus(l, st, date) {
  const d = date || TODAY;
  if (st === 'lost') { l.status = 'lost'; l.qual = !!l.qual_date; return; }
  const idx = st === 'new' ? -1 : FLOW.findIndex(f => f[0] === st);
  FLOW.forEach(([, f], i) => { if (i <= idx) { if (!l[f]) l[f] = d; } else l[f] = null; });
  l.qual = !!l.qual_date;
  l.status = st;
  l.lost_reason = null;
  if (st !== 'won') l.amount = 0;
}

function renderData() { renderAuth(); renderForms(); renderEdit(); renderHistory(); }

function renderAuth() {
  const box = $('#authCard');
  if (GH.token) {
    box.innerHTML = `<div class="auth auth--on">
      <span class="auth__dot"></span>
      <span>Подключено к <b>${REPO}</b> — изменения сохраняются на сайт</span>
      <button class="btn" id="authOff">Отключить</button></div>`;
    $('#authOff').onclick = () => { GH.token = ''; renderData(); };
  } else {
    box.innerHTML = `<div class="auth">
      <div class="auth__head">Чтобы вносить данные с этого устройства, нужен ключ доступа</div>
      <ol class="auth__steps">
        <li>Открой <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">страницу создания токена</a></li>
        <li>Repository access → <b>Only select repositories</b> → выбери <b>gbm-dashboard</b></li>
        <li>Permissions → Repository permissions → <b>Contents</b> → <b>Read and write</b></li>
        <li>Generate token, скопируй и вставь сюда</li>
      </ol>
      <div class="auth__row">
        <input class="inp" id="tokenInp" type="password" placeholder="github_pat_..." autocomplete="off">
        <button class="btn btn--primary" id="authOn">Подключить</button>
      </div>
      <div class="auth__note">Ключ хранится только в этом браузере и никуда не отправляется, кроме GitHub.</div>
    </div>`;
    $('#authOn').onclick = async () => {
      const v = $('#tokenInp').value.trim();
      if (!v) return;
      GH.token = v;
      try { await ghApi('/contents/data/leads.json?ref=main'); renderData(); await reload(); }
      catch (e) { GH.token = ''; alertBox('Ключ не подошёл: ' + e.message); renderData(); }
    };
  }
}

function alertBox(msg) {
  const n = el('div','toast', msg);
  document.body.append(n);
  setTimeout(() => n.remove(), 5000);
}

/* ---------- формы ---------- */
function fieldSel(id, label, opts, val) {
  return `<label class="fld"><span class="fld__l">${label}</span>
    <select class="sel" id="${id}">${opts.map(o => `<option value="${o[0]}"${o[0]===val?' selected':''}>${o[1]}</option>`).join('')}</select></label>`;
}
function renderForms() {
  const ch = S.channels.map(c => [c.id, c.name]);
  ['leadForm','spendForm'].forEach(fid => {
    const isLead = fid === 'leadForm';
    const f = $('#' + fid);
    const st = S.nf[fid] = S.nf[fid] || { channel:'calls', niche:'', offer:'', newNiche:false, newOffer:false };
    if (!S.niches.some(n => n.id === st.niche)) st.niche = S.niches[0]?.id || '';
    const offs = S.offers.filter(o => o.niche === st.niche);
    if (!offs.some(o => o.id === st.offer)) st.offer = offs[0]?.id || '';
    const isCalls = st.channel === 'calls';

    f.innerHTML = `
      <label class="fld"><span class="fld__l">Дата</span>
        <input class="inp" type="date" id="${fid}_date" value="${TODAY}" max="${TODAY}"></label>
      ${fieldSel(fid+'_ch','Инструмент', ch, st.channel)}
      ${isCalls ? `
      <label class="fld"><span class="fld__l">Ниша</span>
        <div class="fld__row">
          ${st.newNiche || !S.niches.length
            ? `<input class="inp" id="${fid}_nnew" placeholder="Например: Стройматериалы">`
            : `<select class="sel" id="${fid}_n">${S.niches.map(n => `<option value="${n.id}"${n.id===st.niche?' selected':''}>${n.name}</option>`).join('')}</select>`}
          <button type="button" class="btn btn--icon" id="${fid}_ntog" title="Новая ниша">${st.newNiche && S.niches.length ? '×' : '+'}</button>
        </div></label>
      <label class="fld"><span class="fld__l">Оффер</span>
        <div class="fld__row">
          ${st.newOffer || !offs.length
            ? `<input class="inp" id="${fid}_onew" placeholder="Например: Оффер 1">`
            : `<select class="sel" id="${fid}_o">${offs.map(o => `<option value="${o.id}"${o.id===st.offer?' selected':''}>${o.name}</option>`).join('')}</select>`}
          <button type="button" class="btn btn--icon" id="${fid}_otog" title="Новый оффер">${st.newOffer && offs.length ? '×' : '+'}</button>
        </div></label>` : ''}
      <label class="fld"><span class="fld__l">${isLead ? 'Сколько заявок' : 'Сумма, ₽'}</span>
        <input class="inp" type="number" id="${fid}_v" min="${isLead?1:0}" step="${isLead?1:1}" value="${isLead?1:''}" placeholder="${isLead?'':'1204'}"></label>
      <button type="submit" class="btn btn--primary btn--wide">${isLead ? 'Добавить заявки' : 'Добавить расход'}</button>`;

    $(`#${fid}_ch`).onchange = e => { st.channel = e.target.value; renderForms(); };
    const nt = $(`#${fid}_ntog`), ot = $(`#${fid}_otog`);
    if (nt) nt.onclick = () => { st.newNiche = !st.newNiche; renderForms(); };
    if (ot) ot.onclick = () => { st.newOffer = !st.newOffer; renderForms(); };
    const ns = $(`#${fid}_n`); if (ns) ns.onchange = e => { st.niche = e.target.value; st.offer=''; renderForms(); };
    const os = $(`#${fid}_o`); if (os) os.onchange = e => { st.offer = e.target.value; };
    f.onsubmit = e => { e.preventDefault(); isLead ? submitLeads(fid, st) : submitSpend(fid, st); };
  });
}

/* разобрать ниша/оффер из формы, при необходимости завести новые */
function pickNO(fid, st) {
  const res = { niche:null, offer:null, nicheName:'', offerName:'', newN:null, newO:null };
  if (st.channel !== 'calls') return res;
  const nnew = $(`#${fid}_nnew`), onew = $(`#${fid}_onew`);
  if (nnew) {
    const name = nnew.value.trim(); if (!name) throw new Error('Укажи нишу');
    const exist = S.niches.find(n => n.name.toLowerCase() === name.toLowerCase());
    if (exist) { res.niche = exist.id; res.nicheName = exist.name; }
    else { res.niche = slug(name, S.niches.map(n => n.id)); res.nicheName = name; res.newN = { id:res.niche, name }; }
  } else { res.niche = $(`#${fid}_n`).value; res.nicheName = S.niches.find(n => n.id === res.niche)?.name || ''; }
  if (onew) {
    const name = onew.value.trim(); if (!name) throw new Error('Укажи оффер');
    const exist = S.offers.find(o => o.niche === res.niche && o.name.toLowerCase() === name.toLowerCase());
    if (exist) { res.offer = exist.id; res.offerName = exist.name; }
    else { res.offer = slug(res.niche + '_' + name, S.offers.map(o => o.id)); res.offerName = name;
           res.newO = { id:res.offer, niche:res.niche, name }; }
  } else { res.offer = $(`#${fid}_o`).value; res.offerName = S.offers.find(o => o.id === res.offer)?.name || ''; }
  return res;
}

async function saveDict(no) {
  if (!no.newN && !no.newO) return;
  await ghSave('data/channels.json', d => {
    if (no.newN && !d.niches.some(x => x.id === no.newN.id)) d.niches.push(no.newN);
    if (no.newO && !d.offers.some(x => x.id === no.newO.id)) d.offers.push(no.newO);
    return d;
  }, `Справочник: ${[no.newN && 'ниша ' + no.newN.name, no.newO && 'оффер ' + no.newO.name].filter(Boolean).join(', ')}`);
  if (no.newN) S.niches.push(no.newN);
  if (no.newO) S.offers.push(no.newO);
}

async function submitLeads(fid, st) {
  if (!requireToken()) return;
  const btn = $(`#${fid} button[type=submit]`);
  try {
    const date = $(`#${fid}_date`).value;
    const n = parseInt($(`#${fid}_v`).value, 10);
    if (!date || !(n > 0)) throw new Error('Проверь дату и количество');
    const no = pickNO(fid, st);
    busy(btn, true);
    await saveDict(no);
    const mk = nextLeadId();
    const add = Array.from({length:n}, (_, i) => ({
      id: mk(i + 1), date, channel: st.channel, service: null,
      niche: no.niche, offer: no.offer, name: '',
      qual:false, qual_date:null, zoom_set_date:null, zoom_date:null,
      offer_date:null, won_date:null, amount:0, status:'new', lost_reason:null, note:''
    }));
    const where = st.channel === 'calls' ? `${no.nicheName} / ${no.offerName}`
      : S.channels.find(c => c.id === st.channel).name;
    await ghSave('data/leads.json', d => d.concat(add), `+${n} ${plural(n,['заявка','заявки','заявок'])} · ${where} · ${short(date)}`);
    await reload();
    alertBox(`Добавлено заявок: ${n}`);
  } catch (e) { alertBox('Не сохранилось: ' + e.message); }
  finally { busy(btn, false); }
}

async function submitSpend(fid, st) {
  if (!requireToken()) return;
  const btn = $(`#${fid} button[type=submit]`);
  try {
    const date = $(`#${fid}_date`).value;
    const amount = Math.round(parseFloat($(`#${fid}_v`).value));
    if (!date || !(amount >= 0)) throw new Error('Проверь дату и сумму');
    const no = pickNO(fid, st);
    busy(btn, true);
    await saveDict(no);
    const rec = { date, channel: st.channel, amount };
    if (st.channel === 'calls') { rec.niche = no.niche; rec.offer = no.offer; }
    const where = st.channel === 'calls' ? `${no.nicheName} / ${no.offerName}`
      : S.channels.find(c => c.id === st.channel).name;
    await ghSave('data/spend.json', d => d.concat([rec]), `Расход ${nf(amount)} ₽ · ${where} · ${short(date)}`);
    await reload();
    alertBox(`Расход записан: ${money(amount)}`);
  } catch (e) { alertBox('Не сохранилось: ' + e.message); }
  finally { busy(btn, false); }
}

function requireToken() {
  if (GH.token) return true;
  alertBox('Сначала подключи ключ доступа — форма вверху листа');
  return false;
}
function busy(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  btn.dataset.t = btn.dataset.t || btn.textContent;
  btn.textContent = on ? 'Сохраняю…' : btn.dataset.t;
}

/* ---------- редактирование заявок ---------- */
function renderEdit() {
  const t = $('#editTbl'); t.innerHTML = '';
  const rows = [...S.leads].sort((a,b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id))).slice(0, 60);
  if (!rows.length) { t.innerHTML = '<tbody><tr><td class="empty">Заявок пока нет</td></tr></tbody>'; $('#editFoot').innerHTML=''; return; }
  const head = el('thead','', `<tr>
    <th class="tbl__name">Дата</th><th class="tbl__name">Инструмент</th>
    <th class="tbl__name">Ниша / оффер</th><th class="tbl__name">Статус</th>
    <th class="tbl__num">Сумма, ₽</th><th></th></tr>`);
  t.append(head);
  const tb = el('tbody');
  rows.forEach(l => {
    const cur = S.pending.get(l.id) || l;
    const gone = S.removed.has(l.id);
    const off = S.offers.find(o => o.id === cur.offer);
    const nch = S.niches.find(n => n.id === cur.niche);
    const tr = el('tr', 'edit' + (gone ? ' is-gone' : '') + (S.pending.has(l.id) ? ' is-dirty' : ''));
    tr.append(el('td','tbl__name', short(cur.date)));
    tr.append(el('td','tbl__name', S.channels.find(c => c.id === cur.channel)?.name || cur.channel));
    tr.append(el('td','tbl__name', off ? `${nch?.name || ''} / ${off.name}` : '—'));

    const tdS = el('td','tbl__name');
    const sel = el('select','sel sel--sm');
    sel.innerHTML = STATUSES.map(([v,n]) => `<option value="${v}"${v===cur.status?' selected':''}>${n}</option>`).join('');
    sel.onchange = e => {
      const next = JSON.parse(JSON.stringify(S.pending.get(l.id) || l));
      applyStatus(next, e.target.value);
      S.pending.set(l.id, next); renderEdit();
    };
    sel.disabled = gone; tdS.append(sel); tr.append(tdS);

    const tdA = el('td','tbl__num');
    if (cur.status === 'won') {
      const inp = el('input','inp inp--sm');
      inp.type = 'number'; inp.min = 0; inp.value = cur.amount || '';
      inp.placeholder = '0';
      inp.onchange = e => {
        const next = JSON.parse(JSON.stringify(S.pending.get(l.id) || l));
        next.amount = Math.round(parseFloat(e.target.value) || 0);
        S.pending.set(l.id, next); renderEdit();
      };
      tdA.append(inp);
    } else tdA.textContent = '—';
    tr.append(tdA);

    const tdX = el('td','tbl__num');
    const x = el('button','iconx', gone ? '↩' : '✕');
    x.title = gone ? 'Вернуть' : 'Удалить заявку';
    x.onclick = () => { S.removed.has(l.id) ? S.removed.delete(l.id) : S.removed.add(l.id); renderEdit(); };
    tdX.append(x); tr.append(tdX);
    tb.append(tr);
  });
  t.append(tb);

  const n = S.pending.size + S.removed.size;
  const foot = $('#editFoot');
  foot.innerHTML = n
    ? `<span class="form__cnt">Не сохранено изменений: <b>${n}</b></span>`
    : `<span class="form__cnt">Показаны последние ${rows.length} из ${S.leads.length}</span>`;
  if (n) {
    const cancel = el('button','btn','Отменить');
    cancel.onclick = () => { S.pending.clear(); S.removed.clear(); renderEdit(); };
    const save = el('button','btn btn--primary', `Сохранить (${n})`);
    save.onclick = () => saveEdits(save);
    foot.append(cancel, save);
  }
}

async function saveEdits(btn) {
  if (!requireToken()) return;
  const changed = S.pending.size, gone = S.removed.size;
  try {
    busy(btn, true);
    const msg = [changed && `изменено ${changed}`, gone && `удалено ${gone}`].filter(Boolean).join(', ');
    await ghSave('data/leads.json', d => d
      .filter(l => !S.removed.has(l.id))
      .map(l => S.pending.has(l.id) ? S.pending.get(l.id) : l),
      `Правка заявок: ${msg}`);
    S.pending.clear(); S.removed.clear();
    await reload();
    alertBox('Сохранено: ' + msg);
  } catch (e) { alertBox('Не сохранилось: ' + e.message); }
  finally { busy(btn, false); }
}

/* ---------- история ---------- */
async function renderHistory() {
  const box = $('#history');
  box.innerHTML = '<div class="empty">Загружаю…</div>';
  try {
    const cs = await ghApi(`/commits?path=data&per_page=25&_=${Date.now()}`);
    if (!cs.length) { box.innerHTML = '<div class="empty">Изменений пока нет</div>'; return; }
    box.innerHTML = '';
    const list = el('div','hist');
    cs.forEach(c => {
      const d = new Date(c.commit.author.date);
      const when = d.toLocaleString('ru-RU', { day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' });
      list.append(el('div','hist__row', `
        <span class="hist__when">${when}</span>
        <span class="hist__msg">${(c.commit.message.split('\n')[0]).replace(/</g,'&lt;')}</span>
        <a class="hist__lnk" href="${c.html_url}" target="_blank" rel="noopener">смотреть</a>`));
    });
    box.append(list);
  } catch (e) { box.innerHTML = `<div class="empty">История недоступна: ${e.message}</div>`; }
}

/* перечитать данные после записи */
async function reload() {
  try {
    const [cfg, leads, spend, goals] = await Promise.all(
      ['data/channels.json','data/leads.json','data/spend.json','data/goals.json'].map(async f => {
        if (GH.token) return (await ghRead(f)).data;
        return fetch(f + '?_=' + Date.now(), {cache:'no-store'}).then(r => r.json());
      }));
    S.channels = cfg.channels; S.stages = cfg.stages;
    S.niches = cfg.niches || []; S.offers = cfg.offers || [];
    S.leads = leads; S.spend = spend; S.goals = goals;
    S.sel = new Set(S.channels.map(c => c.id));
    if (S.tab === 'data') { renderForms(); renderEdit(); renderHistory(); } else render();
  } catch (e) { alertBox('Не удалось обновить данные: ' + e.message); }
}

/* ===================== misc ===================== */
function closeAll() {
  $$('.pop').forEach(p => p.hidden = true);
  $$('.ctrl').forEach(c => c.classList.remove('is-open'));
}
document.addEventListener('click', closeAll);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

boot();
