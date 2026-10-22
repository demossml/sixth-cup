/* Binds real numbers into the static markup of the audit UI (everything that coffee.js does not render itself). */
(function () {
  'use strict';
  const SC = window.SC;
  const nf = new Intl.NumberFormat('ru-RU');
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const setText = (el, t) => { if (el) el.textContent = t; };
  const B = SC.bind = {};

  const WD = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const MONTH = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  function arrow(up) {
    return '<svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="' + (up ? 'M5 8V2M2.4 4.6 5 2l2.6 2.6' : 'M5 2v6M2.4 5.4 5 8l2.6-2.6') + '" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function setDelta(el, text, cls) {
    if (!el) return;
    el.className = 'delta ' + cls;
    el.innerHTML = (cls === 'up' ? arrow(true) : cls === 'down' ? arrow(false) : '') + text;
  }
  const money = (n) => nf.format(Math.round(n));

  /* ---------- chrome ---------- */
  B.chrome = function () {
    $$('.demo-chip').forEach((e) => e.remove());
    const roles = { owner: 'Владелец', manager: 'Менеджер', viewer: 'Наблюдатель' };
    const role = (SC.me && SC.me.role) || 'owner';
    const st = $('.side-status');
    if (st) { st.innerHTML = '<i></i><span>Подключено к серверу</span><b>6.7</b>'; }
    const u = $('.user');
    if (u) {
      u.removeAttribute('data-toast');
      setText($('.user-name', u), roles[role] || role);
      setText($('.user-role', u), 'Админка 6.7');
      setText($('.avatar', u), (roles[role] || 'А').slice(0, 2).toUpperCase());
      if (!u.dataset.scBound) {
        u.dataset.scBound = '1';
        u.addEventListener('click', () => { if (confirm('Выйти из админки?')) { SC.token.clear(); location.reload(); } });
      }
    }
    const top = $('.top-avatar, .avatar.top, header .avatar');
    if (top) setText(top, (roles[role] || 'А').slice(0, 2).toUpperCase());
    document.body.classList.toggle('sc-readonly', role === 'viewer');
  };

  /* ---------- Today ---------- */
  B.today = function () {
    const D = SC.data, dash = D.dashboard || {};
    const ops = dash.ops || {}, docs = dash.docs || {};
    const now = new Date();
    const sub = $('[data-view="today"] .page-sub');
    if (sub) sub.textContent = WD[now.getDay()] + ', ' + now.getDate() + ' ' + MONTH[now.getMonth()] + ' · что происходит на кассе и с начислением чашек';

    const kpis = $$('[data-view="today"] .kpi-grid .kpi');
    const processed = Math.max(0, (docs.sell || 0) - (docs.sellFailed || 0));
    const cmp = (D.compare24 || {});
    if (kpis[0]) {
      setText($('.kpi-value', kpis[0]), nf.format(processed));
      setText($('.kpi-note', kpis[0]), 'чеков SELL: ' + nf.format(docs.sell || 0));
      const d = $('.delta', kpis[0]);
      if (cmp.previous && cmp.previous.n) { const p = ((cmp.current.n - cmp.previous.n) / cmp.previous.n) * 100; setDelta(d, Math.abs(p).toFixed(1).replace('.', ',') + '%', p >= 0 ? 'up' : 'down'); } else if (d) d.style.display = 'none';
    }
    if (kpis[1]) {
      setText($('.kpi-value', kpis[1]), nf.format(ops.cups || 0));
      setText($('.kpi-note', kpis[1]), 'возвращено: ' + nf.format(ops.cupsReturned || 0));
      const d = $('.delta', kpis[1]);
      if (cmp.previous && cmp.previous.cups) { const p = ((cmp.current.cups - cmp.previous.cups) / cmp.previous.cups) * 100; setDelta(d, Math.abs(p).toFixed(1).replace('.', ',') + '%', p >= 0 ? 'up' : 'down'); } else if (d) d.style.display = 'none';
    }
    if (kpis[2]) {
      const cb = (ops.cashbackKopecks || 0) / 100;
      $('.kpi-value', kpis[2]).innerHTML = money(cb) + ' <small>₽</small>';
      setText($('.kpi-note', kpis[2]), 'сумма чеков: ' + money(ops.resultRub || 0) + ' ₽');
      const share = ops.resultRub ? (cb / ops.resultRub) * 100 : 0;
      setDelta($('.delta', kpis[2]), share.toFixed(1).replace('.', ',') + '%', 'flat');
    }
    if (kpis[3]) {
      setText($('.kpi-value', kpis[3]), nf.format(dash.customers || 0));
      const d = $('.delta', kpis[3]);
      if (dash.newCustomers) { d.style.display = ''; setDelta(d, String(dash.newCustomers), 'up'); } else if (d) d.style.display = 'none';
      setText($('.kpi-note', kpis[3]), 'новых за 24 часа');
    }
    $$('.kpi .spark').forEach((s) => s.remove()); // sparklines were illustrative; real series live in the chart below

    const strip = $$('[data-view="today"] .strip-item');
    if (strip[0]) setText($('.strip-value', strip[0]), nf.format(ops.free || 0));
    if (strip[1]) setText($('.strip-value', strip[1]), nf.format(dash.sellWithoutCard || 0));
    if (strip[2]) setText($('.strip-value', strip[2]), nf.format((docs.sellFailed || 0) + (docs.paybackFailed || 0)));
    if (strip[3]) {
      const last = (D.operations || [])[0];
      setText($('.strip-value', strip[3]), ops.lastOpAt ? SC.fmt.hm(ops.lastOpAt) : '—');
      setText($('.strip-note', strip[3]), last && last.card !== '—' ? 'карта •• ' + last.card : (ops.lastOpAt ? 'без карты' : 'операций пока нет'));
    }
    B.attention();
    const cs = $('[data-view="today"] .table-toolbar .card-sub');
    const n = (D.points || []).length;
    $$('[data-view="today"] .table-toolbar .card-sub').forEach((e) => { if (/точк/.test(e.textContent)) e.textContent = n + ' ' + plural(n, 'точка', 'точки', 'точек') + ' · синхронизация с Эвотор'; });
    void cs;
  };

  function plural(n, a, b, c) { const m = n % 100, d = n % 10; return m > 10 && m < 20 ? c : d === 1 ? a : d > 1 && d < 5 ? b : c; }
  B.plural = plural;

  /* "Требует внимания": built from real counters, zero rows hidden */
  B.attention = function () {
    const D = SC.data, dash = D.dashboard || {};
    const items = $$('[data-view="today"] .attention .att-item');
    if (items.length < 5) return;
    const failed = (dash.docs ? (dash.docs.sellFailed || 0) + (dash.docs.paybackFailed || 0) : 0);
    const noCard = dash.sellWithoutCard || 0;
    const stk = D.stockProblems || { n: 0, sumRub: 0, names: '' };
    const noPhoto = (D.qualityCounts || {}).noPhoto || 0;
    const worst = (D.points || []).filter((p) => p.enabled && p.status !== 'ok').sort((a, b) => (b.status === 'bad') - (a.status === 'bad'))[0];
    const set = (el, show, title, desc, n) => {
      el.style.display = show ? '' : 'none';
      if (!show) return;
      const t = $('.att-t', el);
      if (!el.querySelector('[data-count]')) t.textContent = title; else t.innerHTML = title;
      setText($('.att-d', el), desc);
      const nn = $('.att-n', el); if (nn && n != null) nn.textContent = n;
    };
    set(items[0], failed > 0, failed + ' ' + plural(failed, 'чек', 'чека', 'чеков') + ' с ошибкой', 'Не начислены чашки · документы Эвотор', failed);
    set(items[1], noCard > 0, noCard + ' ' + plural(noCard, 'продажа', 'продажи', 'продаж') + ' без карты', 'Гость не назвал карту · чашки не начислены', noCard);
    set(items[2], stk.n > 0, stk.n + ' ' + plural(stk.n, 'позиция', 'позиции', 'позиций') + ' ниже минимума', stk.names || 'Проверьте остатки', stk.n);
    items[3].style.display = noPhoto > 0 ? '' : 'none';
    $$('[data-count="noPhoto"]', items[3]).forEach((e) => (e.textContent = noPhoto));
    if (worst) {
      set(items[4], true, worst.name + (worst.status === 'bad' ? ': проблема с кассой' : ' давно не опрашивалась'), 'Очередь: ' + worst.queue + ' · последний опрос ' + worst.last, 1);
    } else items[4].style.display = 'none';
    const cnt = items.filter((e) => e.style.display !== 'none').length;
    setText($('[data-view="today"] .att-count'), String(cnt));
    setText($('[data-view="today"] .attention .card-sub'), cnt ? cnt + ' ' + plural(cnt, 'задача', 'задачи', 'задач') + ' на смену' : 'всё в порядке');
    const foot = $('[data-view="today"] .attention-foot'); if (foot) foot.style.display = 'none';
    let empty = $('[data-view="today"] .attention .att-empty');
    if (!cnt) {
      if (!empty) { empty = document.createElement('div'); empty.className = 'att-empty'; empty.style.cssText = 'padding:18px 4px;color:rgba(255,255,255,.7);font-size:13px'; empty.textContent = 'Нет задач — смена идёт штатно.'; $('[data-view="today"] .att-list').appendChild(empty); }
    } else if (empty) empty.remove();
  };

  /* ---------- sidebar counters ---------- */
  B.nav = function () {
    const D = SC.data, dash = D.dashboard || {};
    const failed = (dash.docs ? (dash.docs.sellFailed || 0) + (dash.docs.paybackFailed || 0) : 0);
    const set = (sel, n) => { const e = $(sel); if (!e) return; e.textContent = n; e.style.display = n > 0 ? '' : 'none'; };
    set('.nav-item[data-view="operations"] .count', failed);
    set('.nav-item[data-view="cash"] .count', (D.points || []).filter((p) => p.enabled && p.status !== 'ok').length);
    set('#stockNavCount', (D.stockProblems || {}).n || 0);
    set('#purchasesNavCount', (D.purchaseProblems || 0));
    $$('[data-count]').forEach((e) => { const k = e.dataset.count; const v = (D.qualityCounts || {})[k]; if (v != null) { e.textContent = v; if (e.classList.contains('count')) e.style.display = v > 0 ? '' : 'none'; } });
    const q = D.qualityCounts || {};
    const total = (q.noPhoto || 0) + (q.noCategory || 0) + (q.noScheme || 0) + (q.noLink || 0);
    const qt = $('#qualityTotal'); if (qt) qt.innerHTML = '<i></i>' + total;
  };

  /* top-bar till chip */
  B.chip = function () {
    const chip = $('.cash-pill');
    if (!chip) return;
    const pts = (SC.data.points || []).filter((p) => p.enabled);
    const ok = pts.filter((p) => p.status === 'ok').length;
    const bad = pts.find((p) => p.status !== 'ok');
    const dot = chip.querySelector('i'); chip.querySelectorAll('span.t').forEach((x) => x.style.display = '');
    const color = !pts.length ? 'var(--faint)' : bad ? (bad.status === 'bad' ? 'var(--red)' : 'var(--amber)') : 'var(--green)';
    if (dot) dot.style.cssText = 'background:' + color + ';box-shadow:0 0 0 3px rgba(146,96,10,.12)';
    const spans = chip.querySelectorAll('span');
    if (spans[0]) spans[0].textContent = pts.length ? 'Касса: ' + ok + ' из ' + pts.length : 'Касса: нет точек';
    if (spans[1]) spans[1].textContent = bad ? '· ' + bad.name : '';
  };


  /* ---------- static blocks that depend on data ---------- */
  const tpl = (a) => a.map((c) => {
    const p = c.primary || {};
    const attrs = p.nav ? ' data-ai-nav="' + p.nav + '"' : p.action ? ' data-ai-action="' + p.action + '"' + (p.invoice ? ' data-invoice="' + p.invoice + '"' : '') + (p.item ? ' data-item="' + p.item + '"' : '') : '';
    const red = c.sev === 'urgent' ? ' red' : '';
    const esc = (t) => String(t).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
    return '<button class="stock-alert"' + attrs + '><span class="att-ic' + red + '"><svg width="13" height="13" viewBox="0 0 18 18" fill="none"><path d="M9 2.8 16 15H2L9 2.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 7.2v3.3M9 12.8v.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span class="stock-alert-body"><span class="att-t">' + esc(c.title) + '</span><span class="att-d">' + esc(c.why) + '</span></span></button>';
  }).join('');
  B.extra = B.extra || [];
  B.extra.push(function stockStatic() {
    const box = $('#stockAlerts'); if (!box) return;
    const feed = (SC.data.aiFeed || []).filter((c) => /^(stock-|expiry|no-norm)/.test(c.id)).slice(0, 3);
    box.innerHTML = feed.length ? tpl(feed) : '<div class="t-muted" style="padding:10px 14px">Замечаний нет — остатки и нормы в порядке.</div>';
    setText($('#stockAiSub'), feed.length + ' ' + (feed.length === 1 ? 'наблюдение' : 'наблюдения') + ' · только подсказки');
    const docs = (SC.data.inventoryDocs || []).filter((d) => d.status === 'posted');
    setText($('#stockInvLabel'), 'Инвентаризация: ' + (docs.length ? docs[0].date.split(',')[0] : 'не проводилась'));
  });
  B.extra.push(function wishSub() {
    const r = (SC.data.wishRulesRaw || SC.data.wishRules || [])[0];
    const el = $('#wishRuleSub'); if (!el) return;
    el.textContent = r ? ((r.periodLabel || r.targetMonth) + (r.closesLabel ? ' · ' + r.closesLabel : '') + (r.limitDays ? ' · лимит ' + r.limitDays + ' дат' : '')) : 'правила не заданы';
  });
  B.extra.push(function stamps() {
    const t = new Date(), s = t.getDate() + ' ' + MONTH[t.getMonth()].slice(0, 3) + ', ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    setText($('#anaUpdated'), 'Данные на ' + s);
    const roles = { owner: 'Владелец', manager: 'Менеджер', viewer: 'Наблюдатель' };
    setText($('#assistantMeta'), (roles[(SC.me && SC.me.role) || 'owner'] || 'Владелец') + ' · все точки · данные на ' + s);
  });


  B.extra.push(function roleGate() {
    const role = (SC.me && SC.me.role) || 'owner';
    if (role === 'owner') return;
    const note = role === 'viewer' ? 'Недоступно для наблюдателя' : 'Недоступно для менеджера';
    const lock = (el) => { if (el) { el.disabled = true; el.style.opacity = '.45'; el.title = note; el.setAttribute('aria-disabled', 'true'); } };
    if (role === 'viewer') {
      $$('#menuPrimary, #newGroupBtn, #newSchemeBtn, #addStaffBtn, #saveSchedule, #sendSchedule, #pdSave, #pdRemove, #stSave, #newInvBtn2, #newReceiptBtn, #saveAI, #bulkPublish, #bulkHide').forEach(lock);
    }
    $$('[data-grant], #saveAI, #aiEnableRow').forEach(lock);
    $$('[data-sys-tab="danger"]').forEach((b) => { if (role === 'viewer') b.style.display = 'none'; });
  });

  B.all = function () { B.chrome(); B.chip(); B.today(); B.nav(); (B.extra || []).forEach((fn) => { try { fn(); } catch (e) { console.error('bind', e); } }); };
  B.all();
})();
