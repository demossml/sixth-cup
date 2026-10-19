(function () {
  'use strict';

  const nf = new Intl.NumberFormat('ru-RU');
  const money = (n) => (n < 0 ? '−' : '') + nf.format(Math.abs(n)) + ' ₽';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------------- data ---------------- */
  const points = [
    { name: 'Покровка', addr: 'ул. Покровка, 17', status: 'ok', label: 'Работает', last: '4 мин назад', queue: 0, errors: 0, enabled: true },
    { name: 'Арбат', addr: 'ул. Новый Арбат, 21', status: 'warn', label: 'Давно не опрашивалась', last: '3 ч 12 мин назад', queue: 14, errors: 0, enabled: true },
    { name: 'Депо', addr: 'ул. Лесная, 5', status: 'bad', label: 'Проблема', last: '26 мин назад', queue: 6, errors: 2, enabled: true }
  ];

  const operations = [
    { id: '412', type: 'Продажа', store: 'Покровка', card: '4821', nick: 'anna_k', amount: 420, cups: 2, cashback: 12.6, status: 'Начислено', time: '12:41', items: [{ n: 'Капучино 300 мл', q: 1, p: 280 }, { n: 'Круассан', q: 1, p: 140 }] },
    { id: '411', type: 'Продажа', store: 'Арбат', card: '—', nick: '', amount: 260, cups: 0, cashback: 0, status: 'Без карты', time: '12:38', items: [{ n: 'Латте 400 мл', q: 1, p: 260 }] },
    { id: '409', type: 'Возврат', store: 'Покровка', card: '4821', nick: 'anna_k', amount: -260, cups: -1, cashback: -7.8, status: 'Возврат', time: '12:31', items: [{ n: 'Латте 400 мл', q: 1, p: 260 }] },
    { id: '408', type: 'Продажа', store: 'Депо', card: '3907', nick: 'm_petrov', amount: 380, cups: 2, cashback: 11.4, status: 'Ошибка', time: '12:27', items: [{ n: 'Раф ванильный', q: 1, p: 340 }, { n: 'Эспрессо', q: 1, p: 40 }] },
    { id: '407', type: 'Продажа', store: 'Арбат', card: '5120', nick: 'kate_s', amount: 540, cups: 3, cashback: 16.2, status: 'Начислено', time: '12:22', items: [{ n: 'Флэт уайт', q: 1, p: 300 }, { n: 'Матча латте', q: 1, p: 240 }] },
    { id: '406', type: 'Продажа', store: 'Покровка', card: '—', nick: '', amount: 240, cups: 0, cashback: 0, status: 'Без карты', time: '12:09', items: [{ n: 'Ледяной чай', q: 1, p: 240 }] },
    { id: '405', type: 'Продажа', store: 'Депо', card: '8842', nick: 'd_volkov', amount: 310, cups: 1, cashback: 9.3, status: 'Спор', time: '11:58', items: [{ n: 'Капучино 300 мл', q: 1, p: 280 }, { n: 'Сырник', q: 1, p: 30 }] },
    { id: '404', type: 'Продажа', store: 'Арбат', card: '2270', nick: 'elena_l', amount: 260, cups: 1, cashback: 7.8, status: 'Ошибка', time: '11:47', items: [{ n: 'Латте 400 мл', q: 1, p: 260 }] },
    { id: '403', type: 'Продажа', store: 'Покровка', card: '4821', nick: 'anna_k', amount: 620, cups: 3, cashback: 18.6, status: 'Начислено', time: '11:35', items: [{ n: 'Капучино 300 мл', q: 2, p: 280 }, { n: 'Круассан', q: 2, p: 60 }] },
    { id: '401', type: 'Возврат', store: 'Арбат', card: '2270', nick: 'elena_l', amount: -180, cups: -1, cashback: -5.4, status: 'Возврат', time: '11:21', items: [{ n: 'Эспрессо', q: 1, p: 180 }] },
    { id: '400', type: 'Продажа', store: 'Депо', card: '3907', nick: 'm_petrov', amount: 450, cups: 2, cashback: 13.5, status: 'Начислено', time: '11:14', items: [{ n: 'Раф ванильный', q: 1, p: 340 }, { n: 'Эспрессо', q: 1, p: 110 }] },
    { id: '399', type: 'Продажа', store: 'Покровка', card: '7712', nick: 's_belova', amount: 300, cups: 1, cashback: 9.0, status: 'Начислено', time: '10:58', items: [{ n: 'Флэт уайт', q: 1, p: 300 }] }
  ];

  const customers = [
    { card: '4821', nick: 'anna_k', cups: 38, paid: 34, cashback: 486, invited: 4, reg: '12 мар 2025', created: 1741737600 },
    { card: '3907', nick: 'm_petrov', cups: 31, paid: 29, cashback: 412, invited: 2, reg: '2 апр 2025', created: 1743552000 },
    { card: '5120', nick: 'kate_s', cups: 27, paid: 24, cashback: 368, invited: 6, reg: '18 апр 2025', created: 1744934400 },
    { card: '8842', nick: 'd_volkov', cups: 19, paid: 19, cashback: 244, invited: 0, reg: '7 июн 2025', created: 1749254400 },
    { card: '2270', nick: 'elena_l', cups: 44, paid: 38, cashback: 512, invited: 3, reg: '21 янв 2025', created: 1737417600 },
    { card: '7712', nick: 's_belova', cups: 12, paid: 12, cashback: 158, invited: 1, reg: '30 авг 2025', created: 1756512000 },
    { card: '6034', nick: 'roma_t', cups: 8, paid: 8, cashback: 96, invited: 0, reg: '3 окт 2025', created: 1759449600 },
    { card: '9155', nick: 'olga_m', cups: 5, paid: 5, cashback: 61, invited: 1, reg: '11 окт 2025', created: 1760140800 }
  ];

  const products = [
    { id: 0, name: 'Капучино 300 мл', sku: 'CAP-300', group: 'Кофе', price: 280, cup: true, free: true, photo: true, scheme: 'Все сиропы', sync: 'В кассе', issues: [], sizes: [{ v: '300 мл', p: 280 }], available: ['Покровка', 'Арбат', 'Депо'] },
    { id: 1, name: 'Латте 400 мл', sku: 'LAT-400', group: 'Кофе', price: 320, cup: true, free: true, photo: false, scheme: 'Молочные альтернативы', sync: 'В кассе', issues: ['noPhoto'], sizes: [{ v: '400 мл', p: 320 }], available: ['Покровка', 'Арбат', 'Депо'] },
    { id: 2, name: 'Раф ванильный', sku: 'RAF-300', group: 'Кофе', price: 340, cup: true, free: true, photo: false, scheme: 'Без схемы', sync: 'В кассе', issues: ['noPhoto', 'noScheme'], sizes: [{ v: '300 мл', p: 340 }], available: ['Покровка', 'Арбат'] },
    { id: 3, name: 'Эспрессо', sku: 'ESP-060', group: 'Кофе', price: 180, cup: true, free: true, photo: true, scheme: 'Без схемы', sync: 'В кассе', issues: [], sizes: [{ v: '60 мл', p: 180 }], available: ['Покровка', 'Арбат', 'Депо'] },
    { id: 4, name: 'Флэт уайт', sku: 'FLW-300', group: 'Кофе', price: 300, cup: true, free: true, photo: false, scheme: 'Молочные альтернативы', sync: 'Ждёт выгрузки', issues: ['noPhoto'], sizes: [{ v: '300 мл', p: 300 }], available: ['Покровка', 'Арбат'] },
    { id: 5, name: 'Матча латте', sku: 'MAT-350', group: 'Напитки', price: 360, cup: true, free: true, photo: true, scheme: 'Без схемы', sync: 'В кассе', issues: ['noScheme'], sizes: [{ v: '350 мл', p: 360 }], available: ['Покровка', 'Депо'] },
    { id: 6, name: 'Круассан', sku: 'CRO-001', group: 'Без группы', price: 220, cup: false, free: false, photo: false, scheme: 'Без схемы', sync: 'В кассе', issues: ['noPhoto', 'noCategory'], sizes: [{ v: 'шт', p: 220 }], available: ['Покровка', 'Арбат', 'Депо'] },
    { id: 7, name: 'Сырники', sku: 'SYR-001', group: 'Выпечка', price: 290, cup: false, free: false, photo: true, scheme: 'Без схемы', sync: 'В кассе', issues: [], sizes: [{ v: 'шт', p: 290 }], available: ['Покровка', 'Депо'] },
    { id: 8, name: 'Сэндвич с индейкой', sku: 'SAN-001', group: 'Без группы', price: 380, cup: false, free: false, photo: false, scheme: 'Без схемы', sync: 'Ошибка выгрузки', issues: ['noPhoto', 'noCategory', 'noLink'], sizes: [{ v: 'шт', p: 380 }], available: ['Покровка'] },
    { id: 9, name: 'Ледяной чай', sku: 'ICE-400', group: 'Без группы', price: 240, cup: false, free: false, photo: false, scheme: 'Без схемы', sync: 'Не на кассе', issues: ['noPhoto', 'noCategory'], sizes: [{ v: '400 мл', p: 240 }], available: ['Арбат'] }
  ];

  const groups = [
    { name: 'Кофе', count: 32, visible: true },
    { name: 'Напитки', count: 21, visible: true },
    { name: 'Выпечка', count: 18, visible: true },
    { name: 'Еда', count: 12, visible: false },
    { name: 'Без группы', count: 3, visible: true, system: true }
  ];

  const schemes = [
    { name: 'Все сиропы', addons: ['Сироп ванильный', 'Сироп карамельный', 'Сироп лавандовый'], used: 12 },
    { name: 'Молочные альтернативы', addons: ['Овсяное молоко', 'Миндальное молоко', 'Кокосовое молоко'], used: 8 },
    { name: 'Топпинги', addons: ['Карамель', 'Шоколад'], used: 6 },
    { name: 'Добавки к матче', addons: ['Сироп лавандовый', 'Кокосовое молоко'], used: 4 },
    { name: 'Без схемы', addons: [], used: 5, warn: true }
  ];

  const addons = [
    { name: 'Сироп ванильный', type: 'Сироп', price: 50, on: true },
    { name: 'Сироп карамельный', type: 'Сироп', price: 50, on: true },
    { name: 'Сироп лавандовый', type: 'Сироп', price: 60, on: true },
    { name: 'Овсяное молоко', type: 'Молоко', price: 60, on: true },
    { name: 'Миндальное молоко', type: 'Молоко', price: 60, on: true },
    { name: 'Кокосовое молоко', type: 'Молоко', price: 60, on: false },
    { name: 'Карамель', type: 'Топпинг', price: 40, on: true },
    { name: 'Шоколад', type: 'Топпинг', price: 40, on: true }
  ];

  const qualityCounts = { all: 86, noPhoto: 14, noCategory: 3, noScheme: 5, noLink: 1 };

  const issueMeta = {
    noPhoto: 'Без фото',
    noCategory: 'Без категории',
    noScheme: 'Без схемы',
    noLink: 'Без связи с кассой'
  };
  const statusPill = {
    'Начислено': 'green', 'Без карты': 'amber', 'Ошибка': 'red', 'Спор': 'navy', 'Возврат': 'red'
  };

  /* ---------------- shared ui ---------------- */
  const toastEl = document.getElementById('toast');
  const toastText = document.getElementById('toastText');
  let toastTimer;
  function toast(msg) {
    toastText.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 2600);
  }

  const scrim = document.getElementById('scrim');
  const sheet = document.getElementById('sheet');
  const palette = document.getElementById('palette');
  const drawer = document.getElementById('drawer');

  function closeSheet() { sheet.classList.remove('is-on'); }
  function closePalette() { palette.classList.remove('is-on'); }
  function closeDrawer() { drawer.classList.remove('is-on'); }
  function closeAll() {
    closeSheet(); closePalette(); closeDrawer(); closeProduct(); closeStaff();
    document.querySelectorAll('.stock-drawer').forEach((d) => d.classList.remove('is-on'));
    document.querySelectorAll('.purchase-drawer').forEach((d) => d.classList.remove('is-on'));
    document.querySelectorAll('.assistant-drawer').forEach((d) => d.classList.remove('is-on'));
    document.querySelectorAll('.help-drawer').forEach((d) => d.classList.remove('is-on'));
    document.querySelectorAll('.inv-overlay,.inv-modal').forEach((d) => d.classList.remove('is-on'));
    const aim = document.getElementById('aiDraftModal');
    if (aim) aim.classList.remove('is-on');
    scrim.classList.remove('is-on');
  }

  function syncScrim() {
    const open = sheet.classList.contains('is-on') || palette.classList.contains('is-on') || drawer.classList.contains('is-on') || productDrawer.classList.contains('is-on') || staffDrawer.classList.contains('is-on') || !!document.querySelector('.stock-drawer.is-on') || !!document.querySelector('.purchase-drawer.is-on') || !!document.querySelector('.assistant-drawer.is-on') || !!document.querySelector('.help-drawer.is-on');
    scrim.classList.toggle('is-on', open);
  }

  /* ---------------- navigation ---------------- */
  const crumb = document.getElementById('crumb');
  const navNames = {
    today: 'Сегодня', operations: 'Операции', customers: 'Клиенты', menu: 'Меню', cash: 'Касса',
    staff: 'Сотрудники', content: 'Контент', referrals: 'Рефералка',
    stock: 'Склад', purchases: 'Закупки', analytics: 'Аналитика', help: 'Справка', compare: 'Сравнение', events: 'События', assistant: 'Помощник', system: 'Система'
  };
  const crumbGroups = {
    today: 'Смена', operations: 'Смена', customers: 'Смена', menu: 'Каталог', cash: 'Управление',
    staff: 'Управление', content: 'Управление', referrals: 'Управление', stock: 'Управление', purchases: 'Деньги',
    analytics: 'Данные', help: 'Помощь', compare: 'Аналитика', events: 'Аналитика', assistant: 'Аналитика', system: 'Админка'
  };
  function go(view) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === view));
    document.querySelectorAll('.side .nav-item').forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
    document.querySelectorAll('.mobile-nav button').forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
    const sheetBtn = document.getElementById('openSheet');
    if (sheetBtn) sheetBtn.classList.toggle('is-active', ['today', 'operations', 'customers', 'menu'].indexOf(view) === -1);
    if (crumb) crumb.textContent = navNames[view] || 'Сегодня';
    const cg = document.getElementById('crumbGroup');
    if (cg) cg.textContent = crumbGroups[view] || 'Смена';
    document.querySelector('.content').scrollTop = 0;
    closeAll();
    if (menuBulk) menuBulk.classList.remove('is-on');
    if (view === 'menu') updateMenuBulk();
  }

  document.addEventListener('click', (e) => {
    const viewBtn = e.target.closest('[data-view]');
    if (viewBtn && !viewBtn.classList.contains('view')) {
      e.preventDefault();
      go(viewBtn.dataset.view);
      return;
    }
    const next = e.target.closest('[data-next]');
    if (next) {
      closeAll();
      toast('Раздел «' + next.dataset.next + '» — в следующей итерации концепта');
      return;
    }
    const goto = e.target.closest('[data-goto]');
    if (goto) {
      e.preventDefault();
      const view = goto.dataset.goto;
      go(view);
      if (view === 'operations' && goto.dataset.filter) setOpsFilter(goto.dataset.filter);
      if (view === 'menu' && goto.dataset.filter) setMenuIssue(goto.dataset.filter);
      return;
    }
    const t = e.target.closest('[data-toast]');
    if (t) { e.preventDefault(); toast(t.dataset.toast); }
  });

  /* mobile sheet */
  document.getElementById('openSheet').addEventListener('click', () => {
    closePalette(); closeDrawer();
    sheet.classList.add('is-on');
    syncScrim();
  });

  /* ---------------- chart ---------------- */
  const chartData = {
    yesterday: {
      labels: ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22'],
      checks: [5, 10, 19, 32, 39, 28, 23, 27, 35, 45, 41, 33, 21, 11, 4],
      cups: [4, 8, 17, 29, 35, 25, 20, 24, 31, 40, 36, 28, 18, 9, 3],
      note: 'по часам · вчера', delta: '+8,2% к позавчера', ticks: [0, 2, 4, 6, 8, 10, 12, 14]
    },
    '24h': {
      labels: ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22'],
      checks: [5, 11, 22, 37, 46, 32, 26, 31, 41, 53, 48, 39, 24, 13, 0],
      cups: [4, 9, 20, 33, 41, 29, 23, 28, 37, 48, 43, 35, 21, 11, 4],
      note: 'по часам · последние 24 часа', delta: '+8,2% к вчера', ticks: [0, 2, 4, 6, 8, 10, 12, 14]
    },
    '7d': {
      labels: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
      checks: [386, 412, 447, 401, 468, 512, 478],
      cups: [351, 378, 412, 368, 428, 468, 432],
      note: 'по дням · 7 дней', delta: '+11,4% к прошлой неделе', ticks: [0, 1, 2, 3, 4, 5, 6]
    },
    '30d': {
      labels: ['19.09', '20.09', '21.09', '22.09', '23.09', '24.09', '25.09', '26.09', '27.09', '28.09', '29.09', '30.09', '01.10', '02.10', '03.10', '04.10', '05.10', '06.10', '07.10', '08.10', '09.10', '10.10', '11.10', '12.10', '13.10', '14.10', '15.10', '16.10', '17.10', '18.10'],
      checks: [398, 411, 389, 432, 455, 421, 468, 447, 476, 502, 489, 461, 472, 448, 463, 491, 516, 487, 498, 474, 459, 481, 507, 523, 496, 478, 512, 538, 564, 527],
      cups: [362, 374, 351, 392, 412, 384, 426, 407, 433, 458, 445, 419, 430, 408, 421, 447, 470, 443, 453, 431, 417, 438, 462, 476, 451, 435, 466, 491, 514, 480],
      note: 'по дням · 30 дней', delta: '+14,1% к прошлому периоду', ticks: [0, 5, 10, 15, 20, 25, 29]
    }
  };

  const svg = document.getElementById('salesChart');
  const chartX = document.getElementById('chartX');
  const chartTip = document.getElementById('chartTip');
  const chartSub = document.getElementById('chartSub');
  const chartTotal = document.getElementById('chartTotal');
  const chartDelta = document.getElementById('chartDelta');
  const W = 720, H = 198, PAD_T = 14, PAD_B = 8;
  let current = chartData['24h'];
  let geom = null;

  function fmtShort(n) { return nf.format(n); }

  function renderChart() {
    const all = current.checks.concat(current.cups);
    const max = Math.max.apply(null, all) * 1.12 || 1;
    const innerH = H - PAD_T - PAD_B;
    const pts = (arr) => arr.map((v, i) => [(i / (arr.length - 1)) * W, PAD_T + innerH - (v / max) * innerH]);
    const cp = pts(current.checks);
    const up = pts(current.cups);
    const path = (p) => {
      let d = 'M' + p[0][0] + ',' + p[0][1];
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], b = p[i], mx = (a[0] + b[0]) / 2;
        d += ' C' + mx + ',' + a[1] + ' ' + mx + ',' + b[1] + ' ' + b[0] + ',' + b[1];
      }
      return d;
    };
    const grid = [0.25, 0.5, 0.75].map((f) => {
      const y = PAD_T + innerH * f;
      return '<line x1="0" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="#ece5d8" stroke-dasharray="2 5" vector-effect="non-scaling-stroke"/>';
    }).join('');
    svg.innerHTML =
      '<defs><linearGradient id="yellowFill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#fbbf24" stop-opacity="0.22"/>' +
      '<stop offset="1" stop-color="#fbbf24" stop-opacity="0"/></linearGradient></defs>' +
      grid +
      '<path d="' + path(up) + ' L' + W + ',' + (H - PAD_B) + ' L0,' + (H - PAD_B) + ' Z" fill="url(#yellowFill)"/>' +
      '<path d="' + path(cp) + '" fill="none" stroke="#0f172a" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' +
      '<path d="' + path(up) + '" fill="none" stroke="#b45309" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' +
      '<line id="hoverLine" x1="0" x2="0" y1="' + PAD_T + '" y2="' + (H - PAD_B) + '" stroke="#0f172a" stroke-opacity="0.25" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" style="opacity:0"/>' +
      '<circle id="dotChecks" r="3.5" fill="#fffdf8" stroke="#0f172a" stroke-width="2" style="opacity:0"/>' +
      '<circle id="dotCups" r="3.5" fill="#fffdf8" stroke="#b45309" stroke-width="2" style="opacity:0"/>';
    geom = { cp, up };
    chartX.innerHTML = current.labels.map((l, i) => '<span>' + (current.ticks.indexOf(i) > -1 ? l : '') + '</span>').join('');
    const sumC = current.checks.reduce((a, b) => a + b, 0);
    const sumU = current.cups.reduce((a, b) => a + b, 0);
    chartTotal.textContent = fmtShort(sumC) + ' / ' + fmtShort(sumU);
    chartDelta.textContent = 'чеков / чашек · ' + current.delta;
    chartSub.textContent = current.note + ' · источник 6.7 ops, не полный отчёт Эвотор';
  }

  svg.addEventListener('pointermove', (e) => {
    if (!geom) return;
    const r = svg.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const idx = Math.round(ratio * (current.checks.length - 1));
    const [cx, cy] = geom.cp[idx];
    const [, uy] = geom.up[idx];
    const line = document.getElementById('hoverLine');
    const dc = document.getElementById('dotChecks');
    const du = document.getElementById('dotCups');
    line.setAttribute('x1', cx); line.setAttribute('x2', cx); line.style.opacity = 1;
    dc.setAttribute('cx', cx); dc.setAttribute('cy', cy); dc.style.opacity = 1;
    du.setAttribute('cx', cx); du.setAttribute('cy', uy); du.style.opacity = 1;
    chartTip.style.left = (cx / W) * r.width + 'px';
    chartTip.style.top = ((Math.min(cy, uy) / H) * r.height - 8) + 'px';
    chartTip.style.opacity = 1;
    chartTip.querySelector('b').textContent = current.checks[idx] + ' чеков · ' + current.cups[idx] + ' чашек';
    chartTip.querySelector('span').textContent = current.labels[idx] + ((current === chartData['24h'] || current === chartData.yesterday) ? ':00' : '');
  });
  svg.addEventListener('pointerleave', () => {
    chartTip.style.opacity = 0;
    ['hoverLine', 'dotChecks', 'dotCups'].forEach((id) => { const el = document.getElementById(id); if (el) el.style.opacity = 0; });
  });

  document.getElementById('periodSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-period]');
    if (!b) return;
    document.querySelectorAll('#periodSeg button').forEach((x) => x.classList.toggle('is-on', x === b));
    current = chartData[b.dataset.period];
    renderChart();
  });
  renderChart();

  /* ---------------- today points / recent ---------------- */
  const pointsBody = document.getElementById('pointsBody');
  function renderPoints() {
    pointsBody.innerHTML = points.map((p, i) => (
      '<tr>' +
        '<td><div class="point-name"><span class="point-ic"><svg width="13" height="13" viewBox="0 0 18 18" fill="none"><path d="M2.5 7.5 9 2.8l6.5 4.7V15a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V7.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></span><span><b>' + p.name + '</b><span>' + p.addr + '</span></span></div></td>' +
        '<td><span class="pill ' + (p.status === 'ok' ? 'green' : p.status === 'warn' ? 'amber' : 'red') + '"><i></i>' + p.label + '</span></td>' +
        '<td><span class="t-muted">' + p.last + '</span></td>' +
        '<td><span class="t-num ' + (p.queue ? '' : 't-muted') + '">' + p.queue + '</span></td>' +
        '<td><span class="t-num ' + (p.errors ? 'text-bad' : 't-muted') + '" ' + (p.errors ? 'style="color:var(--red)"' : '') + '>' + p.errors + '</span></td>' +
      '</tr>'
    )).join('');
  }

  function rowOp(o, compact) {
    const client = o.card === '—'
      ? '<div class="client-cell"><span class="avatar" style="color:var(--faint)">—</span><span><span class="c-name" style="color:var(--muted);font-weight:550">Без карты</span><span class="c-card">гость не назвал</span></span></div>'
      : '<div class="client-cell"><span class="avatar">' + esc(o.nick.slice(0, 2).toUpperCase()) + '</span><span><span class="c-name">' + esc(o.nick) + '</span><span class="c-card">•• ' + o.card + '</span></span></div>';
    return '<tr class="clickable" data-op="' + o.id + '">' +
      '<td><span class="t-time">' + o.time + '</span></td>' +
      '<td><span class="t-type ' + (o.type === 'Возврат' ? 'ret' : '') + '">' + o.type + '</span><span class="t-doc" style="display:block">#' + o.id + '</span></td>' +
      (compact ? '' : '<td><span class="t-muted">' + o.store + '</span></td>') +
      '<td>' + client + '</td>' +
      '<td class="num-r"><span class="t-money">' + money(o.amount) + '</span></td>' +
      '<td class="num-r"><span class="t-num">' + (o.cups > 0 ? '+' : '') + o.cups + '</span></td>' +
      '<td class="num-r"><span class="t-num">' + (o.cashback ? money(o.cashback) : '—') + '</span></td>' +
      '<td><span class="pill ' + (statusPill[o.status] || 'gray') + '"><i></i>' + o.status + '</span></td>' +
      '<td><button class="row-btn" aria-label="Открыть"><svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="13" cy="8" r="1.3"/></svg></button></td>' +
    '</tr>';
  }

  document.getElementById('recentBody').innerHTML = operations.slice(0, 6).map((o) => rowOp(o, false)).join('');
  renderPoints();

  /* ---------------- operations ---------------- */
  const opsBody = document.getElementById('opsBody');
  const opsEmpty = document.getElementById('opsEmpty');
  const opsInfo = document.getElementById('opsInfo');
  const opsSearch = document.getElementById('opsSearch');
  let opsStatus = 'all';

  function visibleOps() {
    const q = opsSearch.value.trim().toLowerCase();
    return operations.filter((o) => {
      const okStatus = opsStatus === 'all' || o.status === opsStatus;
      const okQ = !q || o.id.includes(q) || o.card.includes(q) || o.nick.toLowerCase().includes(q) || o.store.toLowerCase().includes(q);
      return okStatus && okQ;
    });
  }
  function renderOps() {
    const rows = visibleOps();
    opsBody.innerHTML = rows.map((o) => rowOp(o, false)).join('');
    opsEmpty.style.display = rows.length ? 'none' : 'block';
    opsInfo.textContent = rows.length ? 'Показано ' + rows.length + ' из 428' : 'Операций не найдено';
  }
  function setOpsFilter(f) {
    const alias = { errors: 'Ошибка', nocard: 'Без карты' };
    opsStatus = alias[f] || f;
    document.querySelectorAll('#opsChips .chip').forEach((c) => c.classList.toggle('is-on', c.dataset.status === f));
    renderOps();
  }
  document.getElementById('opsChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    setOpsFilter(chip.dataset.status);
  });
  opsSearch.addEventListener('input', renderOps);
  document.getElementById('opsPeriod').addEventListener('change', (e) => {
    toast('Демо: период «' + e.target.value + '» — структура та же, данные демонстрационные');
  });
  renderOps();

  /* ---------------- customers ---------------- */
  const custBody = document.getElementById('custBody');
  const custEmpty = document.getElementById('custEmpty');
  const custInfo = document.getElementById('custInfo');
  const custSearch = document.getElementById('custSearch');
  const custSort = document.getElementById('custSort');
  function renderCustomers() {
    const q = custSearch.value.trim().toLowerCase();
    let rows = customers.filter((c) => !q || c.card.includes(q) || c.nick.toLowerCase().includes(q));
    const sort = custSort.value;
    rows = rows.slice().sort((a, b) => {
      if (sort === 'cups') return b.cups - a.cups;
      if (sort === 'cashback') return b.cashback - a.cashback;
      if (sort === 'invited') return b.invited - a.invited;
      return b.created - a.created;
    });
    custBody.innerHTML = rows.map((c) => (
      '<tr class="clickable" data-customer="' + c.card + '">' +
        '<td><div class="client-cell"><span class="avatar">' + c.nick.slice(0, 2).toUpperCase() + '</span><span><span class="c-name">' + esc(c.nick) + '</span><span class="c-card">Карта •• ' + c.card + '</span></span></div></td>' +
        '<td class="num-r"><span class="t-num">' + c.cups + '</span></td>' +
        '<td class="num-r"><span class="t-num">' + c.paid + '</span></td>' +
        '<td class="num-r"><span class="t-num">' + nf.format(c.cashback) + '</span></td>' +
        '<td class="num-r"><span class="t-num">' + (c.invited || '—') + '</span></td>' +
        '<td><span class="t-muted">' + c.reg + '</span></td>' +
        '<td><button class="row-btn" aria-label="Открыть"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></td>' +
      '</tr>'
    )).join('');
    custEmpty.style.display = rows.length ? 'none' : 'block';
    custInfo.textContent = rows.length ? 'Показано ' + rows.length + ' из 6 214' : 'Клиент не найден';
  }
  custSearch.addEventListener('input', renderCustomers);
  custSort.addEventListener('change', renderCustomers);
  renderCustomers();

  custBody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-customer]');
    if (!tr) return;
    const c = customers.find((x) => x.card === tr.dataset.customer);
    if (c) toast('Демо: карточка клиента •• ' + c.card + ' — ' + c.cups + ' чашек');
  });

  /* ---------------- menu ---------------- */
  const menuBody = document.getElementById('menuBody');
  const menuEmpty = document.getElementById('menuEmpty');
  const menuInfo = document.getElementById('menuInfo');
  const menuSearch = document.getElementById('menuSearch');
  const menuGroupFilter = document.getElementById('menuGroupFilter');
  const menuSyncFilter = document.getElementById('menuSyncFilter');
  const menuCheckAll = document.getElementById('menuCheckAll');
  const menuBulk = document.getElementById('menuBulk');
  const menuSelected = new Set();
  let menuIssue = 'all';
  let menuGroup = 'all';
  let menuSync = 'all';
  let menuTab = 'products';

  function moneyShort(n) { return nf.format(n) + ' ₽'; }

  function updateQualityUI() {
    document.querySelectorAll('[data-qcount]').forEach((el) => {
      el.textContent = qualityCounts[el.dataset.qcount];
    });
    document.querySelectorAll('[data-count]').forEach((el) => {
      const v = qualityCounts[el.dataset.count];
      if (v !== undefined) el.textContent = v;
    });
    const pt = document.getElementById('menuProductTotal');
    if (pt) pt.textContent = qualityCounts.all;
    const gt = document.getElementById('menuGroupTotal');
    if (gt) gt.textContent = groups.filter((g) => !g.system).length;
    const st = document.getElementById('menuSchemeTotal');
    if (st) st.textContent = schemes.filter((x) => !x.warn).length;
    const qt = document.getElementById('qualityTotal');
    if (qt) qt.textContent = qualityCounts.noPhoto + qualityCounts.noCategory + qualityCounts.noScheme + qualityCounts.noLink;
    const tabN = document.querySelector('[data-menu-tab="products"] .tab-n');
    if (tabN) tabN.textContent = qualityCounts.all;
  }

  function applyIssueDelta(oldIssues, newIssues) {
    ['noPhoto', 'noCategory', 'noScheme', 'noLink'].forEach((k) => {
      const before = oldIssues.indexOf(k) > -1;
      const after = newIssues.indexOf(k) > -1;
      if (before && !after) qualityCounts[k] = Math.max(0, qualityCounts[k] - 1);
      if (!before && after) qualityCounts[k] += 1;
    });
    updateQualityUI();
  }

  function fillGroupFilter() {
    const current = menuGroupFilter.value || 'all';
    menuGroupFilter.innerHTML = '<option value="all">Все группы</option>' + groups.map((g) =>
      '<option value="' + esc(g.name) + '">' + esc(g.name) + '</option>'
    ).join('');
    menuGroupFilter.value = groups.some((g) => g.name === current) ? current : 'all';
    menuGroup = menuGroupFilter.value;
  }

  function syncCls(status) {
    return status === 'В кассе' ? 'green' : status === 'Ошибка выгрузки' ? 'red' : status === 'Не на кассе' ? 'gray' : 'amber';
  }

  function visibleMenuRows() {
    const q = menuSearch.value.trim().toLowerCase();
    return products.filter((p) => {
      const okQ = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.group.toLowerCase().includes(q);
      const okIssue = menuIssue === 'all' || p.issues.indexOf(menuIssue) > -1;
      const okGroup = menuGroup === 'all' || p.group === menuGroup;
      const okSync = menuSync === 'all' || p.sync === menuSync;
      return okQ && okIssue && okGroup && okSync;
    });
  }

  function updateMenuBulk() {
    const onMenu = document.querySelector('.view[data-view="menu"]').classList.contains('is-active');
    const count = document.getElementById('menuSelCount');
    if (count) count.textContent = menuSelected.size;
    if (menuBulk) menuBulk.classList.toggle('is-on', menuSelected.size > 0 && onMenu && menuTab === 'products');
  }

  function renderMenu() {
    const rows = visibleMenuRows();
    menuBody.innerHTML = rows.map((p) => {
      const thumb = p.photo
        ? '<span class="thumb photo"><svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M4 8h9.2v4.2a3.6 3.6 0 0 1-3.6 3.6H7.6A3.6 3.6 0 0 1 4 12.2V8Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M13.2 9h1.4a2.2 2.2 0 0 1 0 4.4h-1.4" stroke="currentColor" stroke-width="1.3"/></svg></span>'
        : '<span class="thumb warn"><svg width="14" height="14" viewBox="0 0 18 18" fill="none"><rect x="2.5" y="3.5" width="13" height="11" rx="1.8" stroke="currentColor" stroke-width="1.4"/><circle cx="6.5" cy="7" r="1.2" stroke="currentColor" stroke-width="1.3"/><path d="m4 13 3.4-3 2.5 2.1 2-1.7 2.1 2.6" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></span>';
      const problems = p.issues.length
        ? p.issues.map((i) => '<span class="pill ' + (i === 'noPhoto' || i === 'noLink' ? 'red' : 'amber') + '"><i></i>' + issueMeta[i] + '</span>').join(' ')
        : '<span class="t-muted">—</span>';
      const groupCell = p.group === 'Без группы'
        ? '<span class="pill amber"><i></i>Без группы</span>'
        : '<span class="t-muted">' + esc(p.group) + '</span>';
      const size = p.sizes && p.sizes[0] ? p.sizes[0].v : '—';
      const checked = menuSelected.has(p.id) ? ' checked' : '';
      return '<tr data-row="' + p.id + '">' +
        '<td><input type="checkbox" class="check menu-check" data-id="' + p.id + '"' + checked + ' aria-label="Выбрать ' + esc(p.name) + '"></td>' +
        '<td><button class="product-cell product-open" data-edit="' + p.id + '">' + thumb +
          '<span><span class="p-name">' + esc(p.name) + (p.free ? '<span class="p-free">free</span>' : '') + '</span><span class="p-sku">' + p.sku + ' · ' + esc(size) + '</span></span>' +
        '</button></td>' +
        '<td>' + groupCell + '</td>' +
        '<td class="num-r"><span class="t-money">' + nf.format(p.price) + ' ₽</span></td>' +
        '<td><button class="cup-toggle ' + (p.cup ? 'on' : '') + '" data-cup-toggle="' + p.id + '"><i>' + (p.cup ? '<svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2 6.2 4.8 9 10 3.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '') + '</i>' + (p.cup ? 'Да' : 'Нет') + '</button></td>' +
        '<td><span class="pill ' + syncCls(p.sync) + '"><i></i>' + p.sync + '</span></td>' +
        '<td>' + problems + '</td>' +
        '<td><button class="row-btn" data-edit="' + p.id + '" aria-label="Редактировать"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="m3 11.5-.5 2.5 2.5-.5 7.5-7.5-2-2-7.5 7.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></button></td>' +
      '</tr>';
    }).join('');
    menuEmpty.style.display = rows.length ? 'none' : 'block';
    menuInfo.textContent = rows.length ? 'Показано ' + rows.length + ' из ' + qualityCounts.all : 'Товаров не найдено';
    const visibleIds = rows.map((p) => p.id);
    const selectedVisible = visibleIds.filter((id) => menuSelected.has(id)).length;
    menuCheckAll.checked = rows.length > 0 && selectedVisible === rows.length;
    menuCheckAll.indeterminate = selectedVisible > 0 && selectedVisible < rows.length;
    updateMenuBulk();
  }

  function setMenuIssue(issue) {
    if (menuTab !== 'products') setMenuTab('products');
    menuIssue = issue;
    document.querySelectorAll('#issueGrid .issue').forEach((b) => b.classList.toggle('is-on', b.dataset.issue === issue));
    renderMenu();
  }

  function setMenuTab(tab) {
    menuTab = tab;
    document.querySelectorAll('[data-menu-tab]').forEach((b) => {
      const on = b.dataset.menuTab === tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-menu-panel]').forEach((p) => {
      p.hidden = p.dataset.menuPanel !== tab;
    });
    const labels = { products: 'Новый товар', groups: 'Новая группа', schemes: 'Новая схема' };
    document.getElementById('menuPrimaryLabel').textContent = labels[tab];
    if (tab === 'groups') renderGroups();
    if (tab === 'schemes') renderSchemes();
    updateMenuBulk();
  }

  function updateMenuTabCounts() {
    const g = document.querySelector('[data-menu-tab="groups"] .tab-n');
    if (g) g.textContent = groups.filter((x) => !x.system).length;
    const s = document.querySelector('[data-menu-tab="schemes"] .tab-n');
    if (s) s.textContent = schemes.filter((x) => !x.warn).length;
    const sl = document.getElementById('schemeListCount');
    if (sl) sl.textContent = schemes.filter((x) => !x.warn).length;
    const p = document.querySelector('[data-menu-tab="products"] .tab-n');
    if (p) p.textContent = qualityCounts.all;
    const pt = document.getElementById('menuProductTotal');
    if (pt) pt.textContent = qualityCounts.all;
    const gt = document.getElementById('menuGroupTotal');
    if (gt) gt.textContent = groups.filter((x) => !x.system).length;
    const stt = document.getElementById('menuSchemeTotal');
    if (stt) stt.textContent = schemes.filter((x) => !x.warn).length;
  }

  document.getElementById('issueGrid').addEventListener('click', (e) => {
    const b = e.target.closest('.issue');
    if (b) setMenuIssue(b.dataset.issue);
  });
  menuSearch.addEventListener('input', renderMenu);
  menuGroupFilter.addEventListener('change', () => { menuGroup = menuGroupFilter.value; renderMenu(); });
  menuSyncFilter.addEventListener('change', () => { menuSync = menuSyncFilter.value; renderMenu(); });
  menuBody.addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { openProduct(Number(ed.dataset.edit)); return; }
    const cup = e.target.closest('[data-cup-toggle]');
    if (cup) {
      const p = products.find((x) => x.id === Number(cup.dataset.cupToggle));
      if (p) {
        p.cup = !p.cup;
        if (!p.cup) p.free = false;
        toast('«' + p.name + '»: ' + (p.cup ? 'считается чашкой' : 'не считается чашкой'));
        renderMenu();
      }
    }
  });
  menuBody.addEventListener('change', (e) => {
    const cb = e.target.closest('.menu-check');
    if (!cb) return;
    const id = Number(cb.dataset.id);
    if (cb.checked) menuSelected.add(id); else menuSelected.delete(id);
    renderMenu();
  });
  menuCheckAll.addEventListener('change', () => {
    const rows = visibleMenuRows();
    if (menuCheckAll.checked) rows.forEach((p) => menuSelected.add(p.id));
    else rows.forEach((p) => menuSelected.delete(p.id));
    renderMenu();
  });
  document.getElementById('bulkClear').addEventListener('click', () => { menuSelected.clear(); renderMenu(); });
  document.getElementById('bulkPublish').addEventListener('click', () => {
    menuSelected.forEach((id) => {
      const p = products.find((x) => x.id === id);
      if (p) {
        if (p.issues.indexOf('noLink') > -1) qualityCounts.noLink = Math.max(0, qualityCounts.noLink - 1);
        p.sync = 'Ждёт выгрузки';
        p.issues = p.issues.filter((i) => i !== 'noLink');
      }
    });
    toast('Выбрано ' + menuSelected.size + ' товаров · уйдут в Эвотор');
    menuSelected.clear();
    updateQualityUI();
    renderMenu();
  });
  document.getElementById('bulkHide').addEventListener('click', () => {
    menuSelected.forEach((id) => {
      const p = products.find((x) => x.id === id);
      if (p) p.sync = 'Не на кассе';
    });
    toast('Выбрано ' + menuSelected.size + ' товаров · скрыты в PWA и на кассе');
    menuSelected.clear();
    renderMenu();
  });
  document.querySelector('.menu-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-menu-tab]');
    if (b) setMenuTab(b.dataset.menuTab);
  });
  document.getElementById('menuPrimary').addEventListener('click', () => {
    if (menuTab === 'groups') { showGroupComposer(); return; }
    if (menuTab === 'schemes') { showSchemeComposer(); return; }
    openProduct(-1);
  });

  /* ----- groups ----- */
  const groupsList = document.getElementById('groupsList');
  const pwaGroups = document.getElementById('pwaGroups');
  const groupAdd = document.getElementById('groupAdd');
  const groupNameInput = document.getElementById('groupNameInput');
  const arrowUp = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M4.5 6.5 8 3l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const arrowDown = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M4.5 9.5 8 13l3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderGroups() {
    const regular = groups.filter((g) => !g.system);
    const sys = groups.find((g) => g.system);
    groupsList.innerHTML = regular.map((g, i) => (
      '<div class="group-row ' + (g.visible ? '' : 'is-off') + '">' +
        '<span class="grip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>' +
        '<div class="g-main"><span class="g-name">' + esc(g.name) + '</span><span class="g-meta">' + g.count + ' товаров · порядок ' + (i + 1) + '</span></div>' +
        '<div class="g-actions">' +
          '<button data-g-up="' + i + '" aria-label="Выше"' + (i === 0 ? ' disabled' : '') + '>' + arrowUp + '</button>' +
          '<button data-g-down="' + i + '" aria-label="Ниже"' + (i === regular.length - 1 ? ' disabled' : '') + '>' + arrowDown + '</button>' +
          '<button class="sync-toggle ' + (g.visible ? 'on' : '') + '" data-g-vis="' + i + '" aria-label="Показывать ' + esc(g.name) + '" aria-pressed="' + g.visible + '"></button>' +
        '</div>' +
      '</div>'
    )).join('') + (
      sys ? '<div class="group-row g-system">' +
        '<span class="grip" aria-hidden="true"><i></i><i></i><i></i></span>' +
        '<div class="g-main"><span class="g-name">Без группы</span><span class="g-meta">' + sys.count + ' товара · не видны гостю</span></div>' +
        '<button class="card-link" data-goto="menu" data-filter="noCategory">Разобрать →</button>' +
      '</div>' : ''
    );
    pwaGroups.innerHTML = regular.filter((g) => g.visible).map((g) => (
      '<div class="pwa-g"><b>' + esc(g.name) + '</b><span>' + g.count + '</span></div>'
    )).join('') || '<div class="pwa-g"><b>Пока пусто</b><span>0</span></div>';
    updateMenuTabCounts();
  }

  groupsList.addEventListener('click', (e) => {
    const vis = e.target.closest('[data-g-vis]');
    if (vis) {
      const i = Number(vis.dataset.gVis);
      const g = groups[i];
      g.visible = !g.visible;
      renderGroups();
      toast('Группа «' + g.name + '» ' + (g.visible ? 'показывается' : 'скрыта') + ' в PWA');
      return;
    }
    const up = e.target.closest('[data-g-up]');
    if (up) {
      const i = Number(up.dataset.gUp);
      if (i > 0) {
        const t = groups[i - 1]; groups[i - 1] = groups[i]; groups[i] = t;
        renderGroups();
        toast('Порядок групп обновлён');
      }
      return;
    }
    const down = e.target.closest('[data-g-down]');
    if (down) {
      const i = Number(down.dataset.gDown);
      if (i < groups.filter((g) => !g.system).length - 1) {
        const t = groups[i + 1]; groups[i + 1] = groups[i]; groups[i] = t;
        renderGroups();
        toast('Порядок групп обновлён');
      }
    }
  });

  function showGroupComposer() {
    groupAdd.hidden = false;
    groupNameInput.value = '';
    groupNameInput.focus();
  }
  document.getElementById('newGroupBtn').addEventListener('click', showGroupComposer);
  document.getElementById('groupCancel').addEventListener('click', () => { groupAdd.hidden = true; });
  function saveGroup() {
    const name = groupNameInput.value.trim();
    if (!name) { groupNameInput.focus(); return; }
    if (groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) { toast('Такая группа уже есть'); return; }
    const sysIndex = groups.findIndex((g) => g.system);
    groups.splice(sysIndex, 0, { name, count: 0, visible: true });
    groupAdd.hidden = true;
    fillGroupFilter();
    renderGroups();
    toast('Группа «' + name + '» создана');
  }
  document.getElementById('groupSave').addEventListener('click', saveGroup);
  groupNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveGroup();
    if (e.key === 'Escape') groupAdd.hidden = true;
  });

  /* ----- schemes ----- */
  const schemesList = document.getElementById('schemesList');
  const addonsList = document.getElementById('addonsList');
  const schemeAdd = document.getElementById('schemeAdd');
  const schemeNameInput = document.getElementById('schemeNameInput');

  function renderSchemes() {
    schemesList.innerHTML = schemes.map((s, i) => {
      if (s.warn) {
        return '<div class="scheme warn">' +
          '<div class="scheme-head"><b>Без схемы</b><span class="pill amber"><i></i>' + s.used + ' напитков</span></div>' +
          '<div class="scheme-chips"><span class="addon-chip">бариста не увидит добавки</span></div>' +
          '<div class="scheme-foot"><span>Назначьте схему в карточке напитка</span><button class="card-link sp" data-goto="menu" data-filter="noScheme">Показать →</button></div>' +
        '</div>';
      }
      return '<div class="scheme">' +
        '<div class="scheme-head"><b>' + esc(s.name) + '</b><span class="pill gray"><i></i>' + s.used + ' товаров</span></div>' +
        '<div class="scheme-chips">' + (s.addons.length ? s.addons.map((a) => '<span class="addon-chip">' + esc(a) + '</span>').join('') : '<span class="addon-chip">пусто</span>') + '</div>' +
        '<div class="scheme-foot"><span>Используется в ' + s.used + ' товарах</span>' +
          '<button class="card-link sp" data-copy-scheme="' + i + '">Копировать</button>' +
          '<button class="card-link" data-edit-scheme="' + i + '">Изменить</button>' +
        '</div>' +
      '</div>';
    }).join('');
    addonsList.innerHTML = addons.map((a, i) => (
      '<div class="addon-row">' +
        '<span class="addon-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><path d="M6 4h6l-1 3.5v5.2a1.3 1.3 0 0 1-1.3 1.3H8.3A1.3 1.3 0 0 1 7 12.7V7.5L6 4Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7.4 4V2.8h3.2V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></span>' +
        '<span><span class="addon-name">' + esc(a.name) + '</span><span class="addon-type">' + a.type + '</span></span>' +
        '<span class="addon-price">' + a.price + ' ₽</span>' +
        '<button class="sync-toggle ' + (a.on ? 'on' : '') + '" data-addon="' + i + '" aria-label="Доступность ' + esc(a.name) + '" aria-pressed="' + a.on + '"></button>' +
      '</div>'
    )).join('');
    updateMenuTabCounts();
  }

  schemesList.addEventListener('click', (e) => {
    const copy = e.target.closest('[data-copy-scheme]');
    if (copy) {
      const idx = Number(copy.dataset.copyScheme);
      const src = schemes[idx];
      const warnIndex = schemes.findIndex((s) => s.warn);
      schemes.splice(warnIndex, 0, { name: src.name + ' (копия)', addons: src.addons.slice(), used: 0 });
      renderSchemes();
      toast('Схема «' + src.name + '» скопирована');
      return;
    }
    const edit = e.target.closest('[data-edit-scheme]');
    if (edit) toast('Демо: редактор схемы «' + schemes[Number(edit.dataset.editScheme)].name + '»');
  });
  addonsList.addEventListener('click', (e) => {
    const t = e.target.closest('[data-addon]');
    if (!t) return;
    const a = addons[Number(t.dataset.addon)];
    a.on = !a.on;
    renderSchemes();
    toast('«' + a.name + '» ' + (a.on ? 'доступна' : 'скрыта') + ' в схемах');
  });
  function showSchemeComposer() {
    schemeAdd.hidden = false;
    schemeNameInput.value = '';
    schemeNameInput.focus();
  }
  document.getElementById('newSchemeBtn').addEventListener('click', showSchemeComposer);
  document.getElementById('schemeCancel').addEventListener('click', () => { schemeAdd.hidden = true; });
  function saveScheme() {
    const name = schemeNameInput.value.trim();
    if (!name) { schemeNameInput.focus(); return; }
    if (schemes.some((s) => s.name.toLowerCase() === name.toLowerCase())) { toast('Такая схема уже есть'); return; }
    const warnIndex = schemes.findIndex((s) => s.warn);
    schemes.splice(warnIndex, 0, { name, addons: [], used: 0 });
    schemeAdd.hidden = true;
    renderSchemes();
    toast('Схема «' + name + '» создана');
  }
  document.getElementById('schemeSave').addEventListener('click', saveScheme);
  schemeNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveScheme();
    if (e.key === 'Escape') schemeAdd.hidden = true;
  });

  /* ----- product editor ----- */
  const productDrawer = document.getElementById('productDrawer');
  let pdIndex = -1;
  let pdDraft = null;

  function closeProduct() {
    productDrawer.classList.remove('is-on');
  }

  function renderPDSizes() {
    const box = document.getElementById('pdSizes');
    box.innerHTML = pdDraft.sizes.map((s, i) => (
      '<div class="size-row">' +
        '<input data-sv="' + i + '" value="' + esc(s.v) + '" placeholder="Объём, например 300 мл">' +
        '<input data-sp="' + i + '" type="number" min="0" step="1" inputmode="numeric" value="' + (s.p || 0) + '" aria-label="Цена размера">' +
        '<button class="rm" data-srm="' + i + '" aria-label="Удалить размер"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>' +
      '</div>'
    )).join('');
  }

  function renderPDPoints(available) {
    const box = document.getElementById('pdPoints');
    box.innerHTML = points.map((p) => (
      '<label class="point-check"><input type="checkbox" class="check" data-point="' + esc(p.name) + '"' + (available.indexOf(p.name) > -1 ? ' checked' : '') + '>' +
        esc(p.name) + '<span class="meta">' + (p.status === 'ok' ? 'онлайн' : 'нет связи') + '</span></label>'
    )).join('');
  }

  function updatePDToggles() {
    document.getElementById('pdCupSwitch').classList.toggle('on', pdDraft.cup);
    document.getElementById('pdFreeSwitch').classList.toggle('on', pdDraft.free);
    document.getElementById('pdCupRow').setAttribute('aria-pressed', pdDraft.cup);
    document.getElementById('pdFreeRow').setAttribute('aria-pressed', pdDraft.free);
  }

  function updatePDPhoto() {
    const ph = document.getElementById('pdPhoto');
    ph.classList.toggle('has-photo', !!pdDraft.photo);
    document.getElementById('pdPhotoNote').textContent = pdDraft.photo ? 'фото' : 'нет фото';
  }

  function openProduct(id) {
    pdIndex = id >= 0 ? products.findIndex((x) => x.id === id) : -1;
    const p = pdIndex >= 0 ? products[pdIndex] : {
      name: '', sku: 'NEW-' + (products.length + 1), group: 'Кофе', price: 0,
      cup: true, free: false, photo: false, scheme: 'Без схемы', sync: 'Не на кассе',
      issues: ['noPhoto'], sizes: [{ v: '300 мл', p: 0 }], available: ['Покровка']
    };
    pdDraft = {
      photo: !!p.photo, cup: !!p.cup, free: !!p.free,
      issues: p.issues.slice(), sizes: p.sizes.map((s) => ({ v: s.v, p: s.p }))
    };
    const groupSel = document.getElementById('pdGroup');
    groupSel.innerHTML = groups.map((g) => '<option value="' + esc(g.name) + '">' + esc(g.name) + '</option>').join('');
    groupSel.value = p.group;
    const schemeSel = document.getElementById('pdScheme');
    schemeSel.innerHTML = schemes.map((s) => '<option value="' + esc(s.name) + '">' + esc(s.name) + '</option>').join('');
    schemeSel.value = p.scheme;
    document.getElementById('pdTitle').textContent = pdIndex >= 0 ? p.name : 'Новый товар';
    document.getElementById('pdMeta').textContent = (pdIndex >= 0 ? 'Артикул ' + p.sku : 'Новый артикул') + ' · ' + p.group;
    document.getElementById('pdName').value = p.name;
    document.getElementById('pdPrice').value = p.price;
    document.getElementById('pdKicker').textContent = p.sync;
    const cls = syncCls(p.sync);
    document.getElementById('pdSyncPill').className = 'pill ' + cls;
    document.getElementById('pdSyncPill').innerHTML = '<i></i>' + p.sync;
    document.getElementById('pdSyncTitle').textContent = p.sync === 'В кассе' ? 'Выгрузка не требуется' : p.sync === 'Ошибка выгрузки' ? 'Ошибка при последней выгрузке' : 'Товар в очереди на выгрузку';
    document.getElementById('pdSyncMeta').textContent = p.sync === 'В кассе'
      ? 'Последняя выгрузка: сегодня, 12:20. При сохранении изменений товар встанет в очередь.'
      : 'После сохранения товар будет выгружен в Эвотор на включённых точках.';
    document.getElementById('pdRemove').textContent = pdIndex >= 0 ? 'Убрать из продажи' : 'Отмена';
    updatePDPhoto();
    updatePDToggles();
    renderPDSizes();
    renderPDPoints(p.available || []);
    closeAll();
    productDrawer.classList.add('is-on');
    document.querySelector('#productDrawer .drawer-body').scrollTop = 0;
    syncScrim();
    if (pdIndex < 0) setTimeout(() => document.getElementById('pdName').focus(), 60);
  }

  document.getElementById('productClose').addEventListener('click', () => { closeProduct(); syncScrim(); });
  document.getElementById('pdUpload').addEventListener('click', () => {
    pdDraft.photo = true;
    updatePDPhoto();
    toast('Фото загружено · сохраните товар');
  });
  document.getElementById('pdAddSize').addEventListener('click', () => {
    pdDraft.sizes.push({ v: '', p: 0 });
    renderPDSizes();
    const inputs = document.querySelectorAll('#pdSizes [data-sv]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });
  document.getElementById('pdSizes').addEventListener('input', (e) => {
    const v = e.target.dataset.sv, p = e.target.dataset.sp;
    if (v !== undefined) pdDraft.sizes[Number(v)].v = e.target.value;
    if (p !== undefined) pdDraft.sizes[Number(p)].p = Math.max(0, Number(e.target.value) || 0);
  });
  document.getElementById('pdSizes').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-srm]');
    if (!rm) return;
    if (pdDraft.sizes.length === 1) { toast('У товара должен остаться хотя бы один размер'); return; }
    pdDraft.sizes.splice(Number(rm.dataset.srm), 1);
    renderPDSizes();
  });
  productDrawer.addEventListener('click', (e) => {
    const t = e.target.closest('[data-pdtoggle]');
    if (t) {
      const k = t.dataset.pdtoggle;
      pdDraft[k] = !pdDraft[k];
      if (k === 'free' && pdDraft.free) pdDraft.cup = true;
      if (k === 'cup' && !pdDraft.cup) pdDraft.free = false;
      updatePDToggles();
    }
  });

  document.getElementById('pdSave').addEventListener('click', () => {
    const name = document.getElementById('pdName').value.trim();
    if (!name) { document.getElementById('pdName').focus(); toast('Введите название товара'); return; }
    const price = Math.max(0, Math.round(Number(document.getElementById('pdPrice').value) || 0));
    const group = document.getElementById('pdGroup').value;
    const scheme = document.getElementById('pdScheme').value;
    const sizes = pdDraft.sizes
      .map((s) => ({ v: s.v.trim(), p: Math.max(0, Math.round(Number(s.p) || 0)) }))
      .filter((s) => s.v);
    if (!sizes.length) sizes.push({ v: 'шт', p: price });
    const available = Array.from(document.querySelectorAll('#pdPoints input:checked')).map((x) => x.dataset.point);
    const oldIssues = pdIndex >= 0 ? products[pdIndex].issues.slice() : [];
    const issues = [];
    if (!pdDraft.photo) issues.push('noPhoto');
    if (group === 'Без группы') issues.push('noCategory');
    if (pdDraft.cup && scheme === 'Без схемы') issues.push('noScheme');
    if (pdIndex >= 0) {
      const p = products[pdIndex];
      Object.assign(p, { name, price, group, scheme, cup: pdDraft.cup, free: pdDraft.free, photo: pdDraft.photo, issues, sizes, available, sync: 'Ждёт выгрузки' });
    } else {
      products.unshift({
        id: products.length, name, sku: 'NEW-' + String(products.length + 1).padStart(3, '0'), group, price,
        cup: pdDraft.cup, free: pdDraft.free, photo: pdDraft.photo, scheme, sync: 'Ждёт выгрузки',
        issues, sizes, available
      });
      qualityCounts.all += 1;
    }
    applyIssueDelta(oldIssues, issues);
    fillGroupFilter();
    closeProduct();
    syncScrim();
    renderMenu();
    toast(pdIndex >= 0 ? 'Товар сохранён · ждёт выгрузки' : 'Товар создан · ждёт выгрузки');
  });

  document.getElementById('pdRemove').addEventListener('click', () => {
    if (pdIndex >= 0) {
      products[pdIndex].sync = 'Не на кассе';
      toast('«' + products[pdIndex].name + '» убран из продажи');
      renderMenu();
    }
    closeProduct();
    syncScrim();
  });

  /* ---------------- staff ---------------- */
  const cashOptions = [
    { name: 'Покровка', uuid: 'a1f4…9c2e' },
    { name: 'Арбат', uuid: 'b7c1…4d8a' },
    { name: 'Депо', uuid: 'e9d2…7f10' }
  ];
  const employees = [
    { name: 'Анна Ковалёва', role: 'Кассир', device: 'Покровка', uuid: 'a1f4…9c2e' },
    { name: 'Игорь Соколов', role: 'Бариста', device: 'Арбат', uuid: 'b7c1…4d8a' },
    { name: 'Мария Полякова', role: 'Кассир', device: '', uuid: '' },
    { name: 'Роман Титов', role: 'Управляющий', device: 'Депо', uuid: 'e9d2…7f10' },
    { name: 'Елена Лебедева', role: 'Бариста', device: 'Покровка', uuid: 'a1f4…9c2e' },
    { name: 'Денис Волков', role: 'Кассир', device: '', uuid: '' }
  ];
  const weekDays = [
    { label: 'Пн', date: '19' }, { label: 'Вт', date: '20' }, { label: 'Ср', date: '21' },
    { label: 'Чт', date: '22' }, { label: 'Пт', date: '23' }, { label: 'Сб', date: '24' }, { label: 'Вс', date: '25' }
  ];
  const schedule = {
    'Анна Ковалёва': ['morning', 'off', 'morning', 'off', 'morning', 'off', 'morning'],
    'Игорь Соколов': ['evening', 'off', 'off', 'morning', 'off', 'evening', 'evening'],
    'Мария Полякова': ['off', 'morning', 'off', 'morning', 'off', 'morning', 'off'],
    'Роман Титов': ['off', 'evening', 'evening', 'off', 'evening', 'off', 'off'],
    'Елена Лебедева': ['off', 'off', 'off', 'off', 'morning', 'evening', 'off'],
    'Денис Волков': ['off', 'off', 'off', 'off', 'off', 'off', 'off']
  };
  const shiftMeta = {
    morning: { short: 'У', full: 'Утро 10:00–16:00' },
    evening: { short: 'В', full: 'Вечер 16:00–22:00' },
    off: { short: '—', full: 'Выходной' }
  };
  let scheduleDirty = false;

  const wishes = [
    { name: 'Анна К.', text: 'Просит 21 октября — вторая половина дня', status: 'new' },
    { name: 'Игорь С.', text: 'Просит 23 октября — выходной', status: 'new' },
    { name: 'Мария П.', text: 'Просит 20 и 22 октября — утро', status: 'new' },
    { name: 'Роман Т.', text: 'Просит 24 октября — утро', status: 'accept' },
    { name: 'Елена Л.', text: 'Просит 22 октября — выходной', status: 'reject' }
  ];
  const wishMeta = {
    new: { cls: 'gray', label: 'ждёт' },
    accept: { cls: 'green', label: 'принято' },
    part: { cls: 'amber', label: 'частично' },
    reject: { cls: 'red', label: 'отклонено' }
  };
  let wishFilter = 'all';

  function initials(name) {
    return name.split(' ').map((w) => w.charAt(0)).slice(0, 2).join('').toUpperCase();
  }
  function shiftCount(name) {
    return (schedule[name] || []).filter((s) => s !== 'off').length;
  }

  function renderStaff() {
    const body = document.getElementById('staffBody');
    body.innerHTML = employees.map((e, i) => {
      const bound = !!e.uuid;
      return '<tr class="clickable" data-staff="' + i + '">' +
        '<td><div class="staff-cell"><span class="avatar">' + initials(e.name) + '</span><span><span class="staff-name">' + esc(e.name) + '</span><span class="staff-uuid ' + (bound ? '' : 'none') + '">' + (bound ? 'UUID ' + e.uuid : 'касса не привязана') + '</span></span></div></td>' +
        '<td><span class="pill ' + (e.role === 'Управляющий' ? 'navy' : 'gray') + '"><i></i>' + e.role + '</span></td>' +
        '<td>' + (bound ? '<span class="staff-device">' + e.device + '</span>' : '<span class="bind-cell"><span class="pill amber"><i></i>нет привязки</span><button class="card-link" data-staff-open="' + i + '">Привязать</button></span>') + '</td>' +
        '<td class="num-r"><span class="t-num">' + shiftCount(e.name) + '</span></td>' +
        '<td><button class="row-btn" data-staff-open="' + i + '" aria-label="Открыть"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></td>' +
      '</tr>';
    }).join('');
    const sc = document.getElementById('staffCount');
    if (sc) sc.textContent = employees.length;
    const sl = document.getElementById('staffLinked');
    if (sl) sl.textContent = employees.filter((e) => e.uuid).length + ' / ' + employees.length;
    const ln = document.getElementById('staffLinkedNote');
    if (ln) ln.textContent = (employees.length - employees.filter((e) => e.uuid).length) + ' без привязки';
    const rn = document.getElementById('staffRoleNote');
    if (rn) {
      const c = { 'Кассир': 0, 'Бариста': 0, 'Управляющий': 0 };
      employees.forEach((e) => { c[e.role] = (c[e.role] || 0) + 1; });
      rn.textContent = [c['Кассир'] + ' кассира', c['Бариста'] + ' бариста', c['Управляющий'] + ' управляющий'].join(' · ');
    }
  }

  function renderWishes() {
    const pending = wishes.filter((w) => w.status === 'new').length;
    const list = document.getElementById('wishesList');
    const shown = wishes.filter((w) => wishFilter === 'all' || (wishFilter === 'new' ? w.status === 'new' : w.status !== 'new'));
    list.innerHTML = shown.length ? shown.map((w) => {
      const meta = wishMeta[w.status];
      return '<div class="wish">' +
        '<div class="wish-top"><span class="wish-name">' + esc(w.name) + '</span><span class="pill ' + meta.cls + '"><i></i>' + meta.label + '</span></div>' +
        '<div class="wish-text">' + esc(w.text) + '</div>' +
        (w.status === 'new'
          ? '<div class="wish-actions"><button class="ok" data-wish-name="' + esc(w.name) + '" data-act="accept">Принять</button><button class="part" data-wish-name="' + esc(w.name) + '" data-act="part">Частично</button><button class="no" data-wish-name="' + esc(w.name) + '" data-act="reject">Отклонить</button></div>'
          : '<div class="wish-text" style="margin-top:5px">Решение записано в журнал</div>') +
      '</div>';
    }).join('') : '<div class="st-wish-empty">В этом фильтре пожеланий нет.</div>';
    const wp = document.getElementById('wishPending');
    if (wp) wp.textContent = pending;
    const wt = document.getElementById('staffWishTotal');
    if (wt) wt.textContent = wishes.length;
    const wn = document.getElementById('staffWishNote');
    if (wn) wn.textContent = pending + ' ждут решения';
    const counts = { all: wishes.length, new: pending, decided: wishes.length - pending };
    document.querySelectorAll('#wishFilter .chip').forEach((b) => {
      const n = b.querySelector('.n');
      if (n) n.textContent = counts[b.dataset.wishFilter];
      b.classList.toggle('is-on', b.dataset.wishFilter === wishFilter);
    });
  }

  function renderSchedule() {
    const body = document.getElementById('scheduleBody');
    body.innerHTML = employees.map((e, ei) => (
      '<tr>' +
        '<td><div class="schedule-emp"><span class="avatar">' + initials(e.name) + '</span><span><b>' + esc(e.name) + '</b><span>' + e.role + '</span></span></div></td>' +
        weekDays.map((d, di) => {
          const s = (schedule[e.name] || [])[di] || 'off';
          return '<td class="' + (di === 2 ? 'is-today' : '') + '"><button class="shift-cell ' + s + '" data-shift-emp="' + ei + '" data-shift-day="' + di + '" title="' + shiftMeta[s].full + '">' + shiftMeta[s].short + '</button></td>';
        }).join('') +
        '<td class="num-r"><span class="t-num">' + shiftCount(e.name) + '</span></td>' +
      '</tr>'
    )).join('');
    updateScheduleState();
  }

  function updateScheduleState() {
    const st = document.getElementById('scheduleState');
    if (!st) return;
    st.classList.toggle('dirty', scheduleDirty);
    st.innerHTML = '<span class="dot ' + (scheduleDirty ? 'amber' : 'green') + '"></span>' + (scheduleDirty ? 'Не сохранено' : 'Сохранено');
  }

  document.getElementById('staffBody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-staff]');
    if (tr) openStaff(Number(tr.dataset.staff));
  });
  document.getElementById('wishFilter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-wish-filter]');
    if (!b) return;
    wishFilter = b.dataset.wishFilter;
    renderWishes();
  });
  document.getElementById('wishesList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-wish-name]');
    if (!b) return;
    const w = wishes.find((x) => x.name === b.dataset.wishName && x.status === 'new');
    if (!w) return;
    w.status = b.dataset.act;
    renderWishes();
    toast('Пожелание ' + w.name + ': ' + wishMeta[w.status].label);
  });
  document.getElementById('scheduleBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-shift-emp]');
    if (!b) return;
    const emp = employees[Number(b.dataset.shiftEmp)];
    const day = Number(b.dataset.shiftDay);
    if (!schedule[emp.name]) schedule[emp.name] = Array(7).fill('off');
    const order = ['off', 'morning', 'evening'];
    const cur = schedule[emp.name][day];
    schedule[emp.name][day] = order[(order.indexOf(cur) + 1) % order.length];
    scheduleDirty = true;
    renderSchedule();
    renderStaff();
  });
  document.getElementById('saveSchedule').addEventListener('click', () => {
    scheduleDirty = false;
    updateScheduleState();
    toast('График сохранён · изменения уйдут на кассы');
  });
  document.getElementById('sendSchedule').addEventListener('click', () => {
    if (scheduleDirty) { toast('Сначала сохраните график'); return; }
    toast('График отправлен на кассы');
  });

  /* staff drawer */
  const staffDrawer = document.getElementById('staffDrawer');
  let staffIndex = -1;
  function closeStaff() { staffDrawer.classList.remove('is-on'); }

  function wishForEmployee(name) {
    const first = name.split(' ')[0];
    return wishes.filter((w) => w.name.split(' ')[0] === first);
  }

  function updateStaffBind() {
    const uuid = document.getElementById('stCash').value;
    const opt = cashOptions.find((x) => x.uuid === uuid);
    const pill = document.getElementById('stBindStatus');
    const title = document.getElementById('stBindTitle');
    const meta = document.getElementById('stBindMeta');
    const topPill = document.getElementById('stBindPill');
    if (opt) {
      pill.className = 'pill green';
      pill.innerHTML = '<i></i>привязана';
      title.textContent = opt.name;
      meta.textContent = 'UUID ' + opt.uuid + '. Касса будет показывать табель и смену этого сотрудника.';
      topPill.className = 'pill green';
      topPill.textContent = 'касса привязана';
    } else {
      pill.className = 'pill amber';
      pill.innerHTML = '<i></i>без привязки';
      title.textContent = 'Касса не привязана';
      meta.textContent = 'UUID приходит в заголовке X-Evotor-Device-UUID. Без привязки экран «Смена» не знает, чей табель показывать.';
      topPill.className = 'pill amber';
      topPill.textContent = 'нет привязки';
    }
  }

  function openStaff(index) {
    staffIndex = index;
    const e = index >= 0 ? employees[index] : { name: '', role: 'Кассир', device: '', uuid: '' };
    document.getElementById('stKicker').textContent = index >= 0 ? 'в команде' : 'новый';
    document.getElementById('stTitle').textContent = index >= 0 ? e.name : 'Новый сотрудник';
    document.getElementById('stMeta').textContent = index >= 0
      ? e.role + ' · ' + shiftCount(e.name) + ' смен на неделе'
      : 'Добавьте кассу, чтобы касса знала табель';
    document.getElementById('stAvatar').textContent = index >= 0 ? initials(e.name) : '+';
    document.getElementById('stRoleLabel').textContent = e.role;
    document.getElementById('stStatusLabel').textContent = index >= 0 ? 'активен · в команде' : 'новый сотрудник';
    document.getElementById('stName').value = e.name;
    document.getElementById('stRole').value = e.role;
    const cash = document.getElementById('stCash');
    cash.innerHTML = '<option value="">Не привязана</option>' + cashOptions.map((o) =>
      '<option value="' + o.uuid + '">' + o.name + ' · ' + o.uuid + '</option>'
    ).join('');
    cash.value = e.uuid || '';
    document.getElementById('stWeekSec').hidden = index < 0;
    document.getElementById('stWishSec').hidden = index < 0;
    if (index >= 0) {
      const list = schedule[e.name] || Array(7).fill('off');
      document.getElementById('stWeekCount').textContent = shiftCount(e.name) + ' смены';
      document.getElementById('stWeek').innerHTML = weekDays.map((d, i) => {
        const s = list[i] || 'off';
        return '<div class="st-day ' + s + (i === 2 ? ' is-today' : '') + '"><b>' + d.label + '</b><span>' + (s === 'off' ? '—' : shiftMeta[s].short) + '</span></div>';
      }).join('');
      const w = wishForEmployee(e.name);
      document.getElementById('stWishCount').textContent = w.filter((x) => x.status === 'new').length;
      document.getElementById('stWishes').innerHTML = w.length ? w.map((x) =>
        '<div class="st-wish"><span>' + esc(x.text) + '</span><span class="pill ' + wishMeta[x.status].cls + '"><i></i>' + wishMeta[x.status].label + '</span></div>'
      ).join('') : '<div class="st-wish-empty">Пожеланий на эту неделю нет.</div>';
    }
    updateStaffBind();
    document.getElementById('stWeekSec').scrollTop = 0;
    closeAll();
    staffDrawer.classList.add('is-on');
    document.querySelector('#staffDrawer .drawer-body').scrollTop = 0;
    syncScrim();
    if (index < 0) setTimeout(() => document.getElementById('stName').focus(), 60);
  }

  document.getElementById('addStaffBtn').addEventListener('click', () => openStaff(-1));
  document.getElementById('staffClose').addEventListener('click', () => { closeStaff(); syncScrim(); });
  document.getElementById('stCancel').addEventListener('click', () => { closeStaff(); syncScrim(); });
  document.getElementById('stCash').addEventListener('change', updateStaffBind);

  document.getElementById('stSave').addEventListener('click', () => {
    const name = document.getElementById('stName').value.trim();
    if (!name) { document.getElementById('stName').focus(); toast('Введите ФИО сотрудника'); return; }
    if (employees.some((e, i) => i !== staffIndex && e.name.toLowerCase() === name.toLowerCase())) {
      toast('Сотрудник с таким именем уже есть');
      return;
    }
    const role = document.getElementById('stRole').value;
    const uuid = document.getElementById('stCash').value;
    const opt = cashOptions.find((x) => x.uuid === uuid);
    if (staffIndex >= 0) {
      const e = employees[staffIndex];
      const oldName = e.name;
      e.name = name; e.role = role; e.device = opt ? opt.name : ''; e.uuid = opt ? opt.uuid : '';
      if (oldName !== name) {
        schedule[name] = schedule[oldName] || Array(7).fill('off');
        delete schedule[oldName];
      }
    } else {
      employees.push({ name, role, device: opt ? opt.name : '', uuid: opt ? opt.uuid : '' });
      schedule[name] = Array(7).fill('off');
    }
    closeStaff();
    syncScrim();
    renderStaff();
    renderSchedule();
    renderWishes();
    toast(staffIndex >= 0 ? 'Сотрудник сохранён' : 'Сотрудник добавлен · привяжите кассу');
  });

  /* ---------------- stock ---------------- */
  const stockPoints = ['Покровка', 'Арбат', 'Депо'];
  const stockItems = [
    { id: 'coffee', name: 'Кофе зерно', type: 'raw', unit: 'кг', min: 4, cost: 1200, balances: {
      'Покровка': { opening: 5, consumed: 1.8, fact: 2.9 }, 'Арбат': { opening: 4, consumed: 1.5, fact: 2.2 }, 'Депо': { opening: 3, consumed: 1.2, fact: 2.1 } } },
    { id: 'milk', name: 'Молоко 3,2%', type: 'raw', unit: 'л', min: 10, cost: 90, balances: {
      'Покровка': { opening: 24, consumed: 16.4, fact: 7.2 }, 'Арбат': { opening: 20, consumed: 13.5, fact: 6.0 }, 'Депо': { opening: 16, consumed: 10.2, fact: 4.6 } } },
    { id: 'vanilla', name: 'Сироп ванильный', type: 'raw', unit: 'л', min: 1, cost: 800, balances: {
      'Покровка': { opening: 1.6, consumed: 0.32, fact: 1.28 }, 'Арбат': { opening: 1.4, consumed: 0.28, fact: 1.12 }, 'Депо': { opening: 1, consumed: 0.2, fact: 0.8 } } },
    { id: 'matcha', name: 'Матча', type: 'raw', unit: 'кг', min: 0.2, cost: 4200, balances: {
      'Покровка': { opening: 0.2, consumed: 0.036, fact: null }, 'Арбат': { opening: 0.15, consumed: 0.03, fact: null }, 'Депо': { opening: 0.1, consumed: 0.02, fact: null } } },
    { id: 'croissant', name: 'Круассан', type: 'piece', unit: 'шт', min: 10, cost: 45, balances: {
      'Покровка': { opening: 24, consumed: 9, fact: 14 }, 'Арбат': { opening: 20, consumed: 7, fact: 19 }, 'Депо': { opening: 16, consumed: 5, fact: 16 } } },
    { id: 'syrniki', name: 'Сырники', type: 'piece', unit: 'шт', min: 6, cost: 60, balances: {
      'Покровка': { opening: 16, consumed: 6, fact: 10 }, 'Арбат': { opening: 14, consumed: 5, fact: 9 }, 'Депо': { opening: 10, consumed: 3, fact: 7 } } },
    { id: 'sandwich', name: 'Сэндвич с индейкой', type: 'piece', unit: 'шт', min: 4, cost: 120, balances: {
      'Покровка': { opening: 8, consumed: 0, fact: 7 }, 'Арбат': { opening: 7, consumed: 0, fact: 6 }, 'Депо': { opening: 5, consumed: 0, fact: 5 } } },
    { id: 'tea', name: 'Чай концентрат', type: 'raw', unit: 'л', min: 0.5, cost: 600, balances: {
      'Покровка': { opening: 1.5, consumed: 0, fact: 1.5 }, 'Арбат': { opening: 1, consumed: 0, fact: 1 }, 'Депо': { opening: 0.5, consumed: 0, fact: 0.5 } } }
  ];
  const stockMeta = {
    coffee: { multiple: 10, shelf: 180, defaultSupplier: 's1', supplierName: 'Кофейная компания', daily: 1.8 },
    milk: { multiple: 12, shelf: 7, defaultSupplier: 's2', supplierName: 'Молочная ферма', daily: 16.4 },
    vanilla: { multiple: 6, shelf: 90, defaultSupplier: 's1', supplierName: 'Кофейная компания', daily: 0.32 },
    matcha: { multiple: 1, shelf: 60, defaultSupplier: 's4', supplierName: 'Чай и матча', daily: 0.036 },
    croissant: { multiple: 12, shelf: 2, defaultSupplier: 's3', supplierName: 'Сладкая лавка', daily: 9 },
    syrniki: { multiple: 6, shelf: 2, defaultSupplier: 's3', supplierName: 'Сладкая лавка', daily: 6 },
    sandwich: { multiple: 6, shelf: 2, defaultSupplier: 's5', supplierName: 'Гастроном', daily: 4 },
    tea: { multiple: 6, shelf: 120, defaultSupplier: 's4', supplierName: 'Чай и матча', daily: 0.2 }
  };
  stockItems.forEach((it) => Object.assign(it, stockMeta[it.id] || { multiple: 1, shelf: 30, defaultSupplier: '', daily: 0 }));
  const batchProfiles = {
    coffee: [{ lot: 'CF-2410', expiry: '2 дек', days: 45, share: 1 }],
    milk: [{ lot: 'ML-1018', expiry: '20 окт', days: 2, share: 0.55, ret: true }, { lot: 'ML-1021', expiry: '26 окт', days: 8, share: 0.45, ret: true }],
    croissant: [{ lot: 'CR-1018', expiry: '18 окт', days: 0, share: 0.4, ret: true }, { lot: 'CR-1021', expiry: '21 окт', days: 3, share: 0.6, ret: true }],
    sandwich: [{ lot: 'SW-1017', expiry: '17 окт', days: -1, share: 0.25, ret: false }, { lot: 'SW-1020', expiry: '20 окт', days: 2, share: 0.75, ret: true }],
    syrniki: [{ lot: 'SY-1019', expiry: '20 окт', days: 2, share: 1, ret: true }],
    vanilla: [{ lot: 'VN-1101', expiry: '1 ноя', days: 14, share: 0.6, ret: false }, { lot: 'VN-1120', expiry: '20 ноя', days: 33, share: 0.4, ret: false }],
    matcha: [{ lot: 'MT-1105', expiry: '5 ноя', days: 18, share: 1, ret: false }],
  };
  function roundQ(v) { return Math.round(v * 100) / 100; }
  function getBatches(item, point) {
    const expected = stockAgg(item, point).expected;
    const prof = batchProfiles[item.id];
    if (!prof) return expected > 0 ? [{ item, qty: expected, lot: '—', expiry: 'не указан', days: null, ret: false, supplier: item.supplierName || '—' }] : [];
    return prof.map((b) => ({ item, qty: roundQ(expected * b.share), lot: b.lot, expiry: b.expiry, days: b.days, ret: b.ret, supplier: item.supplierName || '—' })).filter((b) => b.qty > 0);
  }
  function allBatches(point) {
    const out = [];
    stockItems.forEach((it) => getBatches(it, point).forEach((b) => out.push(b)));
    return out.sort((a, b) => (a.days === null ? 999 : a.days) - (b.days === null ? 999 : b.days));
  }
  function expiryRecs(point) {
    return allBatches(point).filter((b) => b.days === null || b.days <= 14).map((b) => {
      const sev = b.days === null ? 'info' : b.days < 0 || b.days <= 2 ? 'urgent' : b.days <= 7 ? 'warn' : 'info';
      return Object.assign({}, b, { sev, point });
    });
  }
  function expLabel(days) {
    if (days === null) return 'нет срока';
    if (days < 0) return 'просрочен';
    if (days === 0) return 'сегодня';
    return days + ' дн.';
  }
  function reduceStock(itemId, point, qty) {
    const it = itemById(itemId);
    const b = it.balances[point];
    if (!b) return;
    const currentFact = b.fact === null ? b.opening - b.consumed : b.fact;
    b.fact = Math.max(0, roundQ(currentFact - qty));
    b.opening = Math.max(0, roundQ(b.opening - qty));
  }

  let recipes = [
    { product: 'Капучино 300 мл', group: 'Кофе', mode: 'raw', sold: 40, components: [{ item: 'coffee', qty: 18 }, { item: 'milk', qty: 150 }] },
    { product: 'Латте 400 мл', group: 'Кофе', mode: 'raw', sold: 25, components: [{ item: 'coffee', qty: 18 }, { item: 'milk', qty: 250 }] },
    { product: 'Раф ванильный', group: 'Кофе', mode: 'raw', sold: 12, components: [{ item: 'coffee', qty: 18 }, { item: 'milk', qty: 200 }, { item: 'vanilla', qty: 10 }] },
    { product: 'Эспрессо', group: 'Кофе', mode: 'raw', sold: 13, components: [{ item: 'coffee', qty: 18 }] },
    { product: 'Флэт уайт', group: 'Кофе', mode: 'raw', sold: 10, components: [{ item: 'coffee', qty: 18 }, { item: 'milk', qty: 180 }] },
    { product: 'Матча латте', group: 'Напитки', mode: 'raw', sold: 9, components: [{ item: 'matcha', qty: 4 }, { item: 'milk', qty: 200 }] },
    { product: 'Круассан', group: 'Выпечка', mode: 'piece', sold: 21, components: [{ item: 'croissant', qty: 1 }] },
    { product: 'Сырники', group: 'Выпечка', mode: 'piece', sold: 14, components: [{ item: 'syrniki', qty: 1 }] },
    { product: 'Сэндвич с индейкой', group: 'Еда', mode: 'none', sold: 8, components: [] },
    { product: 'Ледяной чай', group: 'Напитки', mode: 'none', sold: 12, components: [] }
  ];
  let receipts = [
    { id: 'ПР-0241', date: '18 окт', point: 'Покровка', supplier: 'Кофейная компания', positions: 3, amount: 18400, status: 'Проведён' },
    { id: 'ПР-0240', date: '17 окт', point: 'Арбат', supplier: 'Молочная ферма', positions: 2, amount: 6200, status: 'Проведён' },
    { id: 'ПР-0239', date: '15 окт', point: 'Покровка', supplier: 'Сладкая лавка', positions: 4, amount: 9800, status: 'Проведён' },
    { id: 'ПР-0238', date: '12 окт', point: 'Депо', supplier: 'Кофейная компания', positions: 2, amount: 12400, status: 'Проведён' }
  ];
  let stockPoint = 'Покровка';
  let stockFilter = 'all';
  let recipeFilter = 'all';
  let stockItemQuery = '';

  const qtyFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  const fmtQ = (v) => qtyFmt.format(v);
  const itemById = (id) => stockItems.find((x) => x.id === id);
  function plural(n, one, few, many) {
    const n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
    return many;
  }

  function stockAgg(item, point) {
    const keys = point === 'all' ? stockPoints : [point];
    let opening = 0, consumed = 0, fact = 0, hasFact = true;
    keys.forEach((k) => {
      const b = item.balances[k];
      if (!b) return;
      opening += b.opening;
      consumed += b.consumed;
      if (b.fact === null || b.fact === undefined) hasFact = false;
      else fact += b.fact;
    });
    const expected = opening - consumed;
    return { opening, consumed, expected, fact: hasFact ? fact : null, variance: hasFact ? fact - expected : null };
  }
  function stockStatus(agg) {
    if (agg.fact === null) return { cls: 'gray', label: 'не инвентаризировано' };
    if (agg.variance < -0.001) return { cls: 'red', label: 'недостача' };
    if (agg.variance > 0.001) return { cls: 'amber', label: 'излишек' };
    return { cls: 'green', label: 'норма' };
  }
  function varianceText(v, unit) {
    if (v === null) return '—';
    const sign = v > 0 ? '+' : '';
    return sign + fmtQ(v) + ' ' + unit;
  }
  function pointLabel() { return stockPoint === 'all' ? 'Все точки' : stockPoint; }
  function stockFactor() {
    const coffee = itemById('coffee');
    const agg = stockAgg(coffee, stockPoint);
    return agg.consumed / 1.8 || 1;
  }
  function recipeSold(r) { return Math.max(1, Math.round(r.sold * stockFactor())); }
  function compUnit(item) {
    return item.unit === 'кг' ? 'г' : item.unit === 'л' ? 'мл' : item.unit;
  }
  function totalForComp(comp, sold) {
    const item = itemById(comp.item);
    if (!item) return '';
    const total = comp.qty * sold;
    if (compUnit(item) === 'г') return total >= 1000 ? fmtQ(total / 1000) + ' кг' : fmtQ(total) + ' г';
    if (compUnit(item) === 'мл') return total >= 1000 ? fmtQ(total / 1000) + ' л' : fmtQ(total) + ' мл';
    return fmtQ(total) + ' шт';
  }

  function shortageStats() {
    let count = 0, money = 0;
    stockItems.forEach((it) => {
      const a = stockAgg(it, stockPoint);
      if (a.variance !== null && a.variance < -0.001) {
        count += 1;
        money += Math.abs(a.variance) * it.cost;
      }
    });
    return { count, money };
  }

  function renderStockKpis() {
    const coffee = itemById('coffee');
    const ca = stockAgg(coffee, stockPoint);
    const short = shortageStats();
    const noNorm = recipes.filter((r) => r.mode === 'none').length;
    document.getElementById('stockCoffeeExpected').innerHTML = fmtQ(ca.expected) + ' <small>' + coffee.unit + '</small>';
    document.getElementById('stockCoffeeFact').textContent = 'факт ' + (ca.fact === null ? '—' : fmtQ(ca.fact)) + ' · ожидаемо ' + fmtQ(ca.expected);
    document.getElementById('stockShortCount').innerHTML = short.count + ' <small>' + plural(short.count, 'позиция', 'позиции', 'позиций') + '</small>';
    document.getElementById('stockShortMoney').textContent = '−' + nf.format(Math.round(short.money)) + ' ₽';
    document.getElementById('stockNoNormCount').textContent = noNorm;
    document.getElementById('stockCoffeeUse').innerHTML = fmtQ(ca.consumed) + ' <small>' + coffee.unit + '</small>';
    document.getElementById('stockCoffeeCups').textContent = Math.round(ca.consumed / 0.018) + ' чашек';
    document.getElementById('stockPointLabel').textContent = pointLabel();
    document.getElementById('chartPoint').textContent = pointLabel();
    document.getElementById('previewPoint').textContent = pointLabel();
    document.getElementById('recipePoint').textContent = pointLabel();
    const pill = document.getElementById('stockShortPill');
    if (pill) pill.innerHTML = '<i></i>' + short.count + ' ' + plural(short.count, 'недостача', 'недостачи', 'недостач');
    const nav = document.getElementById('stockNavCount');
    if (nav) nav.textContent = short.count;
    const noNormPill = document.getElementById('noNormCount');
    if (noNormPill) noNormPill.innerHTML = '<i></i>' + noNorm;
    document.getElementById('stockBalancesCount').textContent = stockItems.length;
    document.getElementById('stockRecipesCount').textContent = recipes.length;
    document.getElementById('stockReceiptsCount').textContent = receipts.length;
    document.getElementById('stockItemsCount').textContent = stockItems.length;
    document.getElementById('formulaOpening').textContent = fmtQ(ca.opening);
    document.getElementById('formulaConsumed').textContent = fmtQ(ca.consumed);
    document.getElementById('formulaExpected').textContent = fmtQ(ca.expected);
    const fn = document.getElementById('formulaNote');
    if (fn) fn.textContent = 'Пример: кофе, ' + (stockPoint === 'all' ? 'все точки' : 'точка «' + stockPoint + '»') + '. ' + (ca.fact === null ? 'Факт ещё не введён.' : 'Факт ' + fmtQ(ca.fact) + ' кг → ' + (ca.variance < 0 ? 'недостача ' : 'излишек ') + fmtQ(Math.abs(ca.variance)) + ' кг.');
  }

  function renderCoffeeChart() {
    const base = [1.6, 1.8, 1.7, 1.9, 2.1, 2.4, 2.2];
    const labels = ['12', '13', '14', '15', '16', '17', '18'];
    const factor = stockFactor();
    const vals = base.map((v) => v * factor);
    const max = Math.max.apply(null, vals) * 1.1;
    document.getElementById('coffeeChart').innerHTML = vals.map((v, i) => (
      '<div class="stock-bar-col ' + (i === vals.length - 1 ? 'is-today' : '') + '">' +
        '<div class="stock-bar-track"><div class="stock-bar ' + (v === Math.max.apply(null, vals) ? 'is-peak' : '') + '" style="height:' + (v / max * 100) + '%"><span class="bv">' + fmtQ(v) + '</span></div></div>' +
        '<span class="bl">' + labels[i] + '</span>' +
      '</div>'
    )).join('');
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    document.getElementById('coffeeAvg').textContent = fmtQ(avg) + ' кг';
  }

  function renderStockPreview() {
    document.getElementById('stockPreviewBody').innerHTML = stockItems.slice(0, 5).map((it) => {
      const a = stockAgg(it, stockPoint);
      const st = stockStatus(a);
      return '<tr><td><span class="t-type" style="font-size:11.5px">' + it.name + '</span><span class="t-sub">' + it.unit + '</span></td>' +
        '<td class="num-r"><span class="cmp-val">' + fmtQ(a.expected) + ' ' + it.unit + '</span></td>' +
        '<td class="num-r"><span class="cmp-val">' + (a.fact === null ? '—' : fmtQ(a.fact) + ' ' + it.unit) + '</span></td>' +
        '<td class="num-r"><span class="' + (a.variance !== null && a.variance < 0 ? 'var-neg' : a.variance > 0 ? 'var-pos' : 't-muted') + '">' + varianceText(a.variance, it.unit) + '</span></td>' +
        '<td><span class="pill ' + st.cls + '"><i></i>' + st.label + '</span></td></tr>';
    }).join('');
  }

  function renderNoNorm() {
    const none = recipes.filter((r) => r.mode === 'none');
    document.getElementById('noNormList').innerHTML = none.map((r) => (
      '<button class="q-item" data-stock-action="recipes-none"><span class="q-ic red"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.3" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 9h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span><span><span class="q-t">' + r.product + '</span><span class="q-d">' + recipeSold(r) + ' продаж · сырьё не списано</span></span><span class="q-n red">!</span></button>'
    )).join('') || '<div class="stock-norm-empty">Все позиции с нормой.</div>';
  }

  function renderBalances() {
    let rows = stockItems.map((it) => ({ it, a: stockAgg(it, stockPoint) }));
    if (stockFilter === 'variance') rows = rows.filter((r) => r.a.variance !== null && Math.abs(r.a.variance) > 0.001);
    if (stockFilter === 'unchecked') rows = rows.filter((r) => r.a.fact === null);
    document.getElementById('balancesBody').innerHTML = rows.map(({ it, a }) => {
      const st = stockStatus(a);
      const action = a.fact === null ? 'Ввести' : 'Изменить';
      const bs = getBatches(it, stockPoint);
      const earliest = bs.filter((b) => b.days !== null).sort((x, y) => x.days - y.days)[0];
      const expCls = !earliest ? 'none' : earliest.days < 0 || earliest.days <= 2 ? 'urgent' : earliest.days <= 7 ? 'warn' : 'info';
      const expText = !earliest ? 'нет срока' : expLabel(earliest.days);
      return '<tr>' +
        '<td><span class="t-type" style="font-size:11.5px">' + it.name + '</span><span class="t-sub">' + it.unit + '</span></td>' +
        '<td><span class="pill ' + (it.type === 'raw' ? 'navy' : 'gray') + '"><i></i>' + (it.type === 'raw' ? 'Сырьё' : 'Штука') + '</span></td>' +
        '<td class="num-r"><span class="cmp-val">' + fmtQ(a.opening) + '</span></td>' +
        '<td class="num-r"><span class="cmp-val">' + fmtQ(a.consumed) + '</span></td>' +
        '<td class="num-r"><span class="cmp-val">' + fmtQ(a.expected) + '</span></td>' +
        '<td class="num-r"><span class="cmp-val">' + (a.fact === null ? '—' : fmtQ(a.fact)) + '</span></td>' +
        '<td class="num-r"><span class="' + (a.variance !== null && a.variance < 0 ? 'var-neg' : a.variance > 0 ? 'var-pos' : 't-muted') + '">' + varianceText(a.variance, it.unit) + '</span></td>' +
        '<td><button class="exp-badge ' + expCls + '" data-batch-toggle="' + it.id + '">' + expText + ' <span>' + bs.length + '</span></button></td>' +
        '<td><span class="pill ' + st.cls + '"><i></i>' + st.label + '</span></td>' +
        '<td><button class="btn btn-ghost btn-sm" data-inv="' + it.id + '">' + action + '</button></td>' +
      '</tr>' +
      '<tr class="batch-detail-row" data-batch-row="' + it.id + '" hidden><td colspan="10"><div class="batch-detail">' +
        '<div class="batch-detail-head"><span>Партия</span><span>Остаток</span><span>Годен до</span><span>Срок</span><span>Поставщик</span></div>' +
        (bs.length ? bs.map((b) => '<div class="batch-detail-item"><span><b>' + b.lot + '</b>' + (b.days !== null && b.days <= 2 ? '<em>FEFO</em>' : '') + '</span><span class="q">' + fmtQ(b.qty) + ' ' + it.unit + '</span><span>' + b.expiry + '</span><span class="' + (b.days === null ? 't-muted' : b.days < 0 ? 'var-neg' : b.days <= 2 ? 'var-neg' : b.days <= 7 ? 'text-amber' : 't-muted') + '">' + expLabel(b.days) + '</span><span class="muted">' + b.supplier + '</span></div>').join('') : '<div class="stock-norm-empty">Партий нет — укажите срок в следующем приходе.</div>') +
      '</div></td></tr>';
    }).join('');
    document.getElementById('balancesEmpty').style.display = rows.length ? 'none' : 'block';
  }

  function renderRecipes() {
    const counts = {
      all: recipes.length,
      raw: recipes.filter((r) => r.mode === 'raw').length,
      piece: recipes.filter((r) => r.mode === 'piece').length,
      none: recipes.filter((r) => r.mode === 'none').length
    };
    document.querySelectorAll('#recipeFilters .chip').forEach((b) => {
      if (b.querySelector('.n')) b.querySelector('.n').textContent = counts[b.dataset.recipeFilter];
      b.classList.toggle('is-on', b.dataset.recipeFilter === recipeFilter);
    });
    const rows = recipes.filter((r) => recipeFilter === 'all' || r.mode === recipeFilter);
    document.getElementById('recipesBody').innerHTML = rows.map((r, idx) => {
      const i = recipes.indexOf(r);
      const isNone = r.mode === 'none';
      const norm = r.mode === 'piece'
        ? '<span class="norm-chip">1 шт = 1 продажа</span>'
        : r.mode === 'none'
          ? '<span class="norm-none">Не списывается</span>'
          : '<div class="norm-chips">' + r.components.map((c) => {
              const it = itemById(c.item);
              return '<span class="norm-chip">' + (it ? it.name : c.item) + ' <b>' + c.qty + ' ' + (it ? compUnit(it) : '') + '</b></span>';
            }).join('') + '</div>';
      const typePill = r.mode === 'piece' ? '<span class="pill gray"><i></i>Штука</span>' : r.mode === 'none' ? '<span class="pill amber"><i></i>Не задано</span>' : '<span class="pill navy"><i></i>Сырьё</span>';
      const status = r.mode === 'piece'
        ? '<span class="pill navy"><i></i>1:1</span>'
        : r.mode === 'none'
          ? '<span class="pill amber"><i></i>Без нормы</span>'
          : '<span class="pill green"><i></i>Норма</span>';
      return '<tr class="' + (isNone ? 'no-norm-row' : '') + '">' +
        '<td><span class="t-type" style="font-size:11.5px">' + r.product + '</span><span class="t-sub">' + r.group + '</span></td>' +
        '<td>' + typePill + '</td>' +
        '<td>' + norm + '</td>' +
        '<td class="num-r"><span class="t-num">' + recipeSold(r) + '</span></td>' +
        '<td>' + status + '</td>' +
        '<td><button class="card-link" data-recipe="' + i + '">Изменить</button></td>' +
      '</tr>';
    }).join('');
    document.getElementById('recipesEmpty').style.display = rows.length ? 'none' : 'block';
  }

  function renderReceipts() {
    const rows = receipts.filter((r) => stockPoint === 'all' || r.point === stockPoint);
    document.getElementById('receiptsBody').innerHTML = rows.map((r) => (
      '<tr><td><span class="t-id">' + r.id + '</span></td><td><span class="t-muted">' + r.date + '</span></td><td><span class="t-muted">' + r.point + '</span></td><td><span class="t-type" style="font-size:11px;font-weight:550">' + r.supplier + '</span></td><td class="num-r"><span class="t-num">' + r.positions + '</span></td><td class="num-r"><span class="t-money">' + nf.format(r.amount) + ' ₽</span></td><td><span class="pill green"><i></i>' + r.status + '</span></td></tr>'
    )).join('');
  }

  function renderItems() {
    const q = stockItemQuery.toLowerCase();
    const rows = stockItems.filter((it) => !q || it.name.toLowerCase().includes(q));
    document.getElementById('itemsBody').innerHTML = rows.map((it) => {
      const a = stockAgg(it, stockPoint);
      return '<tr><td><span class="t-type" style="font-size:11.5px">' + it.name + '</span></td>' +
        '<td><span class="pill ' + (it.type === 'raw' ? 'navy' : 'gray') + '"><i></i>' + (it.type === 'raw' ? 'Сырьё' : 'Штука') + '</span></td>' +
        '<td><span class="unit-chip">' + it.unit + '</span></td>' +
        '<td class="num-r"><span class="t-num">' + fmtQ(it.min) + '</span></td>' +
        '<td class="num-r"><span class="t-money">' + nf.format(it.cost) + ' ₽</span></td>' +
        '<td class="num-r"><span class="cmp-val">' + fmtQ(a.expected) + ' ' + it.unit + '</span></td>' +
        '<td><span class="t-muted">' + Object.keys(it.balances).length + ' ' + plural(Object.keys(it.balances).length, 'точка', 'точки', 'точек') + '</span></td>' +
        '<td><button class="card-link" data-item-edit="' + it.id + '">Изменить</button></td></tr>';
    }).join('');
    document.getElementById('itemsEmpty').style.display = rows.length ? 'none' : 'block';
  }

  function renderStock() {
    renderStockKpis();
    renderCoffeeChart();
    renderStockPreview();
    renderNoNorm();
    renderBalances();
    renderRecipes();
    renderReceipts();
    renderItems();
  }

  function setStockTab(tab) {
    document.querySelectorAll('[data-stock-tab]').forEach((b) => b.classList.toggle('is-on', b.dataset.stockTab === tab));
    document.querySelectorAll('[data-stock-panel]').forEach((p) => { p.hidden = p.dataset.stockPanel !== tab; });
    if (tab === 'dates' && typeof renderExpiry === 'function') renderExpiry();
  }

  document.getElementById('stockTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-stock-tab]');
    if (b) setStockTab(b.dataset.stockTab);
  });
  document.getElementById('stockPoint').addEventListener('change', (e) => {
    stockPoint = e.target.value;
    renderStock();
    if (typeof renderExpiry === 'function') renderExpiry();
  });
  document.getElementById('stockFilters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-stock-filter]');
    if (!b) return;
    stockFilter = b.dataset.stockFilter;
    document.querySelectorAll('#stockFilters .chip').forEach((x) => x.classList.toggle('is-on', x === b));
    renderBalances();
  });
  document.getElementById('recipeFilters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-recipe-filter]');
    if (!b) return;
    recipeFilter = b.dataset.recipeFilter;
    renderRecipes();
  });
  document.getElementById('stockItemSearch').addEventListener('input', (e) => {
    stockItemQuery = e.target.value.trim();
    renderItems();
  });
  document.getElementById('balancesBody').addEventListener('click', (e) => {
    const bt = e.target.closest('[data-batch-toggle]');
    if (bt) {
      const row = document.querySelector('[data-batch-row="' + bt.dataset.batchToggle + '"]');
      if (row) row.hidden = !row.hidden;
      return;
    }
    const b = e.target.closest('[data-inv]');
    if (b) openInventory(b.dataset.inv);
  });
  document.getElementById('recipesBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-recipe]');
    if (b) openRecipe(Number(b.dataset.recipe));
  });
  document.getElementById('itemsBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-item-edit]');
    if (b) openItem(b.dataset.itemEdit);
  });
  document.getElementById('newReceiptBtn').addEventListener('click', openReceipt);
  document.getElementById('newReceiptBtn2').addEventListener('click', openReceipt);
  document.getElementById('newItemBtn').addEventListener('click', () => openItem(null));
  document.getElementById('startInventory').addEventListener('click', () => {
    const p = stockPoint === 'all' ? 'Покровка' : stockPoint;
    const candidate = stockItems.find((it) => stockAgg(it, p).fact === null) || stockItems[0];
    openInventory(candidate.id, p);
  });

  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-stock-action]');
    if (!a) return;
    e.preventDefault();
    const action = a.dataset.stockAction;
    if (action === 'balances') setStockTab('balances');
    if (action === 'recipes') setStockTab('recipes');
    if (action === 'recipes-none') {
      recipeFilter = 'none';
      setStockTab('recipes');
      renderRecipes();
    }
    if (action === 'inventory-coffee') openInventory('coffee', 'Арбат');
  });

  function closeStockDrawers() {
    document.querySelectorAll('.stock-drawer').forEach((d) => d.classList.remove('is-on'));
    document.querySelectorAll('.purchase-drawer').forEach((d) => d.classList.remove('is-on'));
    document.querySelectorAll('.assistant-drawer').forEach((d) => d.classList.remove('is-on'));
    document.querySelectorAll('.help-drawer').forEach((d) => d.classList.remove('is-on'));
    document.querySelectorAll('.inv-overlay,.inv-modal').forEach((d) => d.classList.remove('is-on'));
    const aim = document.getElementById('aiDraftModal');
    if (aim) aim.classList.remove('is-on');
  }

  /* inventory */
  let invItemId = null;
  function openInventory(id, point) {
    openInvWizard([id], point || (stockPoint === 'all' ? 'Покровка' : stockPoint));
  }
  function updateInventory() {
    const item = itemById(invItemId);
    const p = document.getElementById('invPoint').value;
    const b = item.balances[p] || { opening: 0, consumed: 0, fact: null };
    const expected = b.opening - b.consumed;
    document.getElementById('invTitle').textContent = item.name;
    document.getElementById('invMeta').textContent = p + ' · ' + (item.type === 'raw' ? 'сырьё' : 'шт') + ' · ' + item.unit;
    document.getElementById('invOpening').textContent = fmtQ(b.opening) + ' ' + item.unit;
    document.getElementById('invConsumed').textContent = fmtQ(b.consumed) + ' ' + item.unit;
    document.getElementById('invExpected').textContent = fmtQ(expected) + ' ' + item.unit;
    document.getElementById('invUnitLabel').textContent = item.unit;
    document.getElementById('invUnit').textContent = item.unit;
    const factInput = document.getElementById('invFact');
    factInput.step = item.unit === 'шт' ? '1' : '0.01';
    const fact = factInput.value === '' ? null : Number(factInput.value);
    const diff = document.getElementById('invDiff');
    if (fact === null) {
      diff.className = 'inv-diff';
      diff.innerHTML = '<span>Введите факт, чтобы увидеть расхождение</span>';
    } else {
      const v = fact - expected;
      const cls = Math.abs(v) < 0.001 ? 'good' : v < 0 ? 'bad' : 'warn';
      diff.className = 'inv-diff ' + cls;
      const label = Math.abs(v) < 0.001 ? 'Расхождений нет' : v < 0 ? 'Недостача' : 'Излишек';
      diff.innerHTML = '<b>' + label + ': ' + varianceText(v, item.unit) + '</b><span> · ожидаемо ' + fmtQ(expected) + ' ' + item.unit + '</span>';
    }
  }
  document.getElementById('invPoint').addEventListener('change', () => {
    const item = itemById(invItemId);
    const b = item.balances[document.getElementById('invPoint').value];
    document.getElementById('invFact').value = b && b.fact !== null ? b.fact : '';
    updateInventory();
  });
  document.getElementById('invFact').addEventListener('input', updateInventory);
  document.getElementById('invSave').addEventListener('click', () => {
    const item = itemById(invItemId);
    const p = document.getElementById('invPoint').value;
    if (document.getElementById('invFact').value === '') { document.getElementById('invFact').focus(); toast('Введите фактический остаток'); return; }
    item.balances[p].fact = Number(document.getElementById('invFact').value);
    closeStockDrawers();
    syncScrim();
    renderStock();
    toast('Факт сохранён · расхождение записано в журнал');
  });

  /* recipe */
  let recIndex = -1;
  let recDraft = null;
  function openRecipe(index) {
    recIndex = index;
    const r = recipes[index];
    recDraft = { mode: r.mode, components: r.components.map((c) => ({ item: c.item, qty: c.qty })) };
    document.getElementById('recTitle').textContent = r.product;
    document.getElementById('recMeta').textContent = 'Продано ' + recipeSold(r) + ' · ' + pointLabel() + ' · 24 часа';
    document.getElementById('recMode').textContent = r.mode === 'piece' ? 'штучный товар' : 'сырьё';
    renderRecLines();
    updateRecCalc();
    closeAll();
    document.getElementById('recipeDrawer').classList.add('is-on');
    syncScrim();
  }
  function renderRecLines() {
    const box = document.getElementById('recLines');
    const targetType = recDraft.mode === 'piece' ? 'piece' : 'raw';
    const options = stockItems.filter((it) => it.type === targetType);
    box.innerHTML = recDraft.components.map((c, i) => {
      const it = itemById(c.item);
      return '<div class="rec-line">' +
        '<select data-rec-item="' + i + '">' + options.map((o) => '<option value="' + o.id + '"' + (o.id === c.item ? ' selected' : '') + '>' + o.name + '</option>').join('') + '</select>' +
        '<input data-rec-qty="' + i + '" type="number" min="0" step="0.1" value="' + c.qty + '" aria-label="Количество">' +
        '<span class="u">' + (it ? compUnit(it) : '') + '</span>' +
        '<button class="rm" data-rec-rm="' + i + '" aria-label="Удалить"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>' +
      '</div>';
    }).join('');
  }
  function updateRecCalc() {
    const r = recipes[recIndex];
    const sold = recipeSold(r);
    const box = document.getElementById('recCalc');
    if (!recDraft.components.length) {
      box.className = 'rec-calc empty';
      box.innerHTML = '<b>Норма не задана.</b> Сырьё не будет списываться. Добавьте компонент и сохраните.';
      document.getElementById('recNote').textContent = 'Без компонентов списание по продажам не работает.';
      return;
    }
    box.className = 'rec-calc';
    box.innerHTML = '<b>За 24 часа · ' + sold + ' продаж:</b><br>' + recDraft.components.map((c) => {
      const it = itemById(c.item);
      return (it ? it.name : c.item) + ': ' + c.qty + ' ' + (it ? compUnit(it) : '') + ' × ' + sold + ' = <b>' + totalForComp(c, sold) + '</b>';
    }).join('<br>');
    document.getElementById('recNote').textContent = 'Списание уйдёт в склад по выбранной точке после сохранения нормы.';
  }
  document.getElementById('recLines').addEventListener('input', (e) => {
    const i = e.target.dataset.recQty;
    if (i !== undefined) { recDraft.components[Number(i)].qty = Math.max(0, Number(e.target.value) || 0); updateRecCalc(); }
  });
  document.getElementById('recLines').addEventListener('change', (e) => {
    const i = e.target.dataset.recItem;
    if (i !== undefined) { recDraft.components[Number(i)].item = e.target.value; renderRecLines(); updateRecCalc(); }
  });
  document.getElementById('recLines').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rec-rm]');
    if (!rm) return;
    recDraft.components.splice(Number(rm.dataset.recRm), 1);
    if (!recDraft.components.length) recDraft.mode = 'none';
    renderRecLines();
    updateRecCalc();
  });
  document.getElementById('recAdd').addEventListener('click', () => {
    const targetType = recDraft.mode === 'piece' ? 'piece' : 'raw';
    const used = recDraft.components.map((c) => c.item);
    const candidate = stockItems.find((it) => it.type === targetType && used.indexOf(it.id) === -1);
    if (!candidate) { toast('Все подходящие позиции уже добавлены'); return; }
    recDraft.components.push({ item: candidate.id, qty: targetType === 'piece' ? 1 : 10 });
    if (recDraft.mode === 'none') recDraft.mode = 'raw';
    renderRecLines();
    updateRecCalc();
  });
  document.getElementById('recSave').addEventListener('click', () => {
    const r = recipes[recIndex];
    const comps = recDraft.components.filter((c) => c.qty > 0);
    r.components = comps;
    r.mode = comps.length === 0 ? 'none' : r.mode === 'piece' ? 'piece' : 'raw';
    closeStockDrawers();
    syncScrim();
    renderStock();
    toast(comps.length ? 'Норма сохранена · списание включено' : 'Норма удалена · списание остановлено');
  });

  /* receipt */
  let rcDraft = [];
  function openReceipt(opts) {
    opts = opts || {};
    const rcPoint = document.getElementById('rcPoint');
    rcPoint.innerHTML = stockPoints.map((p) => '<option>' + p + '</option>').join('');
    rcPoint.value = opts.point || (stockPoint === 'all' ? 'Покровка' : stockPoint);
    document.getElementById('rcDate').value = '18 окт 2026';
    document.getElementById('rcSupplier').value = opts.supplier || 'Кофейная компания';
    rcDraft = opts.lines
      ? opts.lines.map((l) => ({ item: l.item, qty: l.qty, price: l.price === undefined ? itemById(l.item).cost : l.price, expiry: l.expiry || '1 ноя' }))
      : [
        { item: 'coffee', qty: 5, price: 1200, expiry: '2 дек' },
        { item: 'milk', qty: 20, price: 90, expiry: '26 окт' }
      ];
    renderRcLines();
    closeAll();
    document.getElementById('receiptDrawer').classList.add('is-on');
    syncScrim();
  }
  function renderRcLines() {
    document.getElementById('rcLines').innerHTML = rcDraft.map((l, i) => {
      const it = itemById(l.item);
      return '<div class="rc-line">' +
        '<select data-rc-item="' + i + '">' + stockItems.map((o) => '<option value="' + o.id + '"' + (o.id === l.item ? ' selected' : '') + '>' + o.name + '</option>').join('') + '</select>' +
        '<input data-rc-qty="' + i + '" type="number" min="0" step="0.01" value="' + l.qty + '" aria-label="Количество">' +
        '<span class="u">' + (it ? it.unit : '') + '</span>' +
        '<input data-rc-exp="' + i + '" type="text" value="' + (l.expiry || '') + '" placeholder="годен до" aria-label="Годен до">' +
        '<input data-rc-price="' + i + '" type="number" min="0" step="1" value="' + l.price + '" aria-label="Цена за единицу">' +
        '<span class="sum" data-rc-sum="' + i + '">' + nf.format(Math.round(l.qty * l.price)) + ' ₽</span>' +
        '<button class="rm" data-rc-rm="' + i + '" aria-label="Удалить"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>' +
      '</div>';
    }).join('');
    const total = rcDraft.reduce((s, l) => s + l.qty * l.price, 0);
    document.getElementById('rcTotal').textContent = nf.format(Math.round(total)) + ' ₽';
  }
  function updateRcTotal() {
    const total = rcDraft.reduce((s, l) => s + l.qty * l.price, 0);
    const el = document.getElementById('rcTotal');
    if (el) el.textContent = nf.format(Math.round(total)) + ' ₽';
    rcDraft.forEach((l, i) => {
      const sum = document.querySelector('[data-rc-sum="' + i + '"]');
      if (sum) sum.textContent = nf.format(Math.round(l.qty * l.price)) + ' ₽';
    });
  }
  document.getElementById('rcLines').addEventListener('input', (e) => {
    const q = e.target.dataset.rcQty, p = e.target.dataset.rcPrice, ex = e.target.dataset.rcExp;
    if (q !== undefined) rcDraft[Number(q)].qty = Math.max(0, Number(e.target.value) || 0);
    if (p !== undefined) rcDraft[Number(p)].price = Math.max(0, Number(e.target.value) || 0);
    if (ex !== undefined) rcDraft[Number(ex)].expiry = e.target.value;
    updateRcTotal();
  });
  document.getElementById('rcLines').addEventListener('change', (e) => {
    const i = e.target.dataset.rcItem;
    if (i !== undefined) {
      const it = itemById(e.target.value);
      rcDraft[Number(i)].item = e.target.value;
      rcDraft[Number(i)].price = it.cost;
      renderRcLines();
    }
  });
  document.getElementById('rcLines').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rc-rm]');
    if (!rm) return;
    rcDraft.splice(Number(rm.dataset.rcRm), 1);
    renderRcLines();
  });
  document.getElementById('rcAdd').addEventListener('click', () => {
    rcDraft.push({ item: stockItems[0].id, qty: 1, price: stockItems[0].cost, expiry: '1 ноя' });
    renderRcLines();
  });
  document.getElementById('rcSave').addEventListener('click', () => {
    const point = document.getElementById('rcPoint').value;
    const lines = rcDraft.filter((l) => l.qty > 0);
    if (!lines.length) { toast('Добавьте хотя бы одну позицию'); return; }
    lines.forEach((l) => {
      const it = itemById(l.item);
      if (it.balances[point]) it.balances[point].opening += l.qty;
    });
    const amount = lines.reduce((s, l) => s + l.qty * l.price, 0);
    receipts.unshift({
      id: 'ПР-' + String(238 + receipts.length).padStart(4, '0'),
      date: document.getElementById('rcDate').value,
      point,
      supplier: document.getElementById('rcSupplier').value || 'Без поставщика',
      positions: lines.length,
      amount: Math.round(amount),
      status: 'Проведён'
    });
    closeStockDrawers();
    syncScrim();
    renderStock();
    toast('Приход проведён · остаток увеличен');
  });

  /* nomenclature */
  let itemEditId = null;
  function openItem(id) {
    itemEditId = id;
    const it = id ? itemById(id) : null;
    document.getElementById('itemKicker').textContent = id ? 'редактирование' : 'новая позиция';
    document.getElementById('itemTitle').textContent = id ? it.name : 'Новая позиция';
    document.getElementById('itName').value = it ? it.name : '';
    document.getElementById('itType').value = it ? it.type : 'raw';
    document.getElementById('itUnit').value = it ? it.unit : 'кг';
    document.getElementById('itMin').value = it ? it.min : 1;
    document.getElementById('itCost').value = it ? it.cost : 0;
    document.getElementById('itMultiple').value = it ? (it.multiple || 1) : 1;
    document.getElementById('itShelf').value = it ? (it.shelf || 30) : 30;
    const supSel = document.getElementById('itSupplier');
    supSel.innerHTML = '<option value="">Не выбран</option>' + suppliers.map((sp) => '<option value="' + sp.id + '"' + (it && it.defaultSupplier === sp.id ? ' selected' : '') + '>' + sp.name + '</option>').join('');
    const bp = stockPoint === 'all' ? 'Покровка' : stockPoint;
    const bs = it ? getBatches(it, bp) : [];
    document.getElementById('itBatchesSec').hidden = !it;
    document.getElementById('itBatches').innerHTML = it ? (bs.length ? bs.map((b) => '<div class="it-batch"><span><b>' + b.lot + '</b><span>' + (b.expiry === 'не указан' ? 'срок не указан' : 'годен до ' + b.expiry) + '</span></span><span class="q">' + fmtQ(b.qty) + ' ' + it.unit + '</span><span class="pill ' + (b.days === null ? 'gray' : b.days < 0 ? 'red' : b.days <= 2 ? 'red' : b.days <= 7 ? 'amber' : 'green') + '"><i></i>' + expLabel(b.days) + '</span></div>').join('') : '<div class="stock-norm-empty">Партий нет — укажите срок в следующем приходе.</div>') : '';
    document.getElementById('itBatchesCount').textContent = it ? bp : '';
    document.getElementById('itPoints').innerHTML = stockPoints.map((p) =>
      '<label class="point-check"><input type="checkbox" class="check" data-it-point="' + p + '"' + (!it || it.balances[p] ? ' checked' : '') + '>' + p + '</label>'
    ).join('');
    closeAll();
    document.getElementById('itemDrawer').classList.add('is-on');
    syncScrim();
    if (!id) setTimeout(() => document.getElementById('itName').focus(), 60);
  }
  document.getElementById('itType').addEventListener('change', (e) => {
    document.getElementById('itUnit').value = e.target.value === 'piece' ? 'шт' : 'кг';
  });
  document.getElementById('itemSave').addEventListener('click', () => {
    const name = document.getElementById('itName').value.trim();
    if (!name) { document.getElementById('itName').focus(); toast('Введите название'); return; }
    const type = document.getElementById('itType').value;
    const unit = document.getElementById('itUnit').value;
    const min = Math.max(0, Number(document.getElementById('itMin').value) || 0);
    const cost = Math.max(0, Number(document.getElementById('itCost').value) || 0);
    const multiple = Math.max(1, Number(document.getElementById('itMultiple').value) || 1);
    const shelf = Math.max(0, Number(document.getElementById('itShelf').value) || 0);
    const defaultSupplier = document.getElementById('itSupplier').value;
    const pts = Array.from(document.querySelectorAll('#itPoints input:checked')).map((x) => x.dataset.itPoint);
    if (itemEditId) {
      const it = itemById(itemEditId);
      Object.assign(it, { name, type, unit, min, cost, multiple, shelf, defaultSupplier });
      pts.forEach((p) => { if (!it.balances[p]) it.balances[p] = { opening: 0, consumed: 0, fact: null }; });
      Object.keys(it.balances).forEach((p) => { if (pts.indexOf(p) === -1) delete it.balances[p]; });
    } else {
      const id = 'item' + (stockItems.length + 1);
      const balances = {};
      pts.forEach((p) => { balances[p] = { opening: 0, consumed: 0, fact: null }; });
      stockItems.push({ id, name, type, unit, min, cost, multiple, shelf, defaultSupplier, daily: 0, balances });
    }
    closeStockDrawers();
    syncScrim();
    renderStock();
    toast(itemEditId ? 'Позиция сохранена' : 'Позиция добавлена в номенклатуру');
  });

  /* close buttons */
  [['invClose', 'invDrawer'], ['recipeClose', 'recipeDrawer'], ['receiptClose', 'receiptDrawer'], ['itemClose', 'itemDrawer']].forEach(([btn, drawer]) => {
    const b = document.getElementById(btn);
    if (b) b.addEventListener('click', () => { document.getElementById(drawer).classList.remove('is-on'); syncScrim(); });
  });
  ['invCancel', 'recCancel', 'rcCancel', 'itemCancel'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', () => { closeStockDrawers(); syncScrim(); });
  });

  renderStock();

  /* ---------------- inventory ---------------- */
  const invZones = {
    coffee: 'Сухой склад', milk: 'Холодильник', vanilla: 'Бар', matcha: 'Бар', tea: 'Бар',
    croissant: 'Витрина', syrniki: 'Витрина', sandwich: 'Витрина'
  };
  const invCategory = {
    coffee: 'Зерно', milk: 'Молоко', vanilla: 'Сиропы', matcha: 'Чай', tea: 'Чай',
    croissant: 'Выпечка', syrniki: 'Выпечка', sandwich: 'Еда'
  };
  const invStatus = {
    draft: { label: 'Черновик', cls: 'gray' },
    in_progress: { label: 'В работе', cls: 'navy' },
    review: { label: 'На проверке', cls: 'amber' },
    posted: { label: 'Проведена', cls: 'green' },
    cancelled: { label: 'Отменена', cls: 'red' }
  };
  const invType = { full: 'Сплошная', partial: 'Частичная' };
  let inventoryDocs = [
    { id: 'ИНВ-0032', date: '18 окт, 12:20', point: 'Покровка', type: 'partial', status: 'draft', author: 'Дмитрий', total: 6, counted: 0, items: [] },
    { id: 'ИНВ-0031', date: '18 окт, 11:20', point: 'Покровка', type: 'partial', status: 'in_progress', author: 'Анна К.', total: 6, counted: 3, items: [] },
    { id: 'ИНВ-0030', date: '17 окт, 20:05', point: 'Арбат', type: 'full', status: 'review', author: 'Игорь С.', total: 8, counted: 8, items: [] },
    { id: 'ИНВ-0029', date: '12 окт, 09:10', point: 'Покровка', type: 'full', status: 'posted', author: 'Дмитрий', total: 8, counted: 8, items: [] },
    { id: 'ИНВ-0028', date: '8 окт, 18:40', point: 'Депо', type: 'partial', status: 'cancelled', author: 'Мария П.', total: 4, counted: 4, items: [] }
  ];
  let invStatusFilter = 'all';
  let invPointFilter = 'all';
  let invTypeFilter = 'all';
  let invQuery = '';
  let activeInv = null;
  let invMode = 'count';
  let invZone = 'all';
  let invRowQuery = '';
  let invWizard = null;
  let invRecount = new Set();
  let invConfirmCallback = null;

  function buildInvItems(ids, point) {
    return ids.map((id) => {
      const it = itemById(id);
      const a = stockAgg(it, point);
      return { itemId: id, book: a.expected, fact: null, counted: false, zone: invZones[id] || 'Склад', category: invCategory[id] || 'Сырьё' };
    });
  }
  function ensureInvItems(doc) {
    if (doc.items && doc.items.length) return;
    const ids = doc.type === 'full' ? stockItems.map((s) => s.id) : (doc.id === 'ИНВ-0028' ? ['coffee', 'milk', 'croissant', 'sandwich'] : ['coffee', 'milk', 'vanilla', 'croissant', 'syrniki', 'sandwich']);
    doc.items = buildInvItems(ids, doc.point);
    const diffs = { coffee: -0.5, milk: -0.8, croissant: -1, sandwich: -1 };
    if (doc.status === 'review' || doc.status === 'posted') {
      doc.items.forEach((it) => { it.fact = Math.max(0, +(it.book + (diffs[it.itemId] || 0)).toFixed(2)); it.counted = true; });
    } else if (doc.status === 'in_progress') {
      doc.items.slice(0, 3).forEach((it) => { it.fact = it.book; it.counted = true; });
    } else if (doc.status === 'cancelled') {
      doc.items.forEach((it) => { it.fact = it.book; it.counted = true; });
    }
    doc.total = doc.items.length;
    doc.counted = doc.items.filter((x) => x.counted).length;
  }
  function invProgress(doc) {
    const total = doc.items ? doc.items.length : doc.total || 0;
    const counted = doc.items ? doc.items.filter((x) => x.counted).length : doc.counted || 0;
    doc.counted = counted;
    doc.total = total;
    return { counted, total, pct: total ? Math.round(counted / total * 100) : 0 };
  }

  function renderInventoryDocs() {
    const q = invQuery.toLowerCase();
    const rows = inventoryDocs.filter((d) => {
      const okStatus = invStatusFilter === 'all' || d.status === invStatusFilter;
      const okPoint = invPointFilter === 'all' || d.point === invPointFilter;
      const okType = invTypeFilter === 'all' || d.type === invTypeFilter;
      const okQ = !q || d.id.toLowerCase().includes(q) || d.author.toLowerCase().includes(q) || d.point.toLowerCase().includes(q);
      return okStatus && okPoint && okType && okQ;
    });
    document.getElementById('invListBody').innerHTML = rows.map((d) => {
      ensureInvItems(d);
      const pr = invProgress(d);
      const st = invStatus[d.status] || invStatus.draft;
      return '<tr class="clickable" data-inv-doc="' + d.id + '">' +
        '<td><span class="t-id">' + d.id + '</span></td>' +
        '<td><span class="t-muted">' + d.date + '</span></td>' +
        '<td><span class="t-muted">' + d.point + '</span></td>' +
        '<td><span class="pill ' + (d.type === 'full' ? 'navy' : 'gray') + '"><i></i>' + invType[d.type] + '</span></td>' +
        '<td><span class="pill ' + st.cls + '"><i></i>' + st.label + '</span></td>' +
        '<td><div class="inv-progress"><div class="inv-progress-bar"><i style="width:' + pr.pct + '%"></i></div><span>' + pr.counted + '/' + pr.total + '</span></div></td>' +
        '<td><span class="t-muted">' + d.author + '</span></td>' +
        '<td><span class="q-arrow">›</span></td>' +
      '</tr>';
    }).join('');
    document.getElementById('invListEmpty').style.display = rows.length ? 'none' : 'block';
    const cnt = document.getElementById('stockInvCount');
    if (cnt) cnt.textContent = inventoryDocs.length;
  }

  document.getElementById('invStatusFilters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-inv-status]');
    if (!b) return;
    invStatusFilter = b.dataset.invStatus;
    document.querySelectorAll('#invStatusFilters .chip').forEach((x) => x.classList.toggle('is-on', x === b));
    renderInventoryDocs();
  });
  document.getElementById('invFilterPoint').addEventListener('change', (e) => { invPointFilter = e.target.value; renderInventoryDocs(); });
  document.getElementById('invFilterType').addEventListener('change', (e) => { invTypeFilter = e.target.value; renderInventoryDocs(); });
  document.getElementById('invSearch').addEventListener('input', (e) => { invQuery = e.target.value.trim(); renderInventoryDocs(); });
  document.getElementById('newInvBtn').addEventListener('click', () => openInvWizard(null));
  document.getElementById('newInvBtn2').addEventListener('click', () => openInvWizard(null));
  document.getElementById('invListBody').addEventListener('click', (e) => {
    const row = e.target.closest('[data-inv-doc]');
    if (row) openInvDoc(row.dataset.invDoc);
  });

  /* wizard */
  function openInvWizard(ids, point) {
    go('stock');
    setStockTab('inventory');
    invWizard = {
      point: point || (stockPoint === 'all' ? 'Покровка' : stockPoint),
      type: ids && ids.length ? 'partial' : 'full',
      selected: new Set(ids || []),
      category: 'all',
      zone: 'all',
      q: ''
    };
    closeAll();
    document.getElementById('invWizard').classList.add('is-on');
    renderInvWizard();
  }
  function renderInvWizard() {
    const w = invWizard;
    const card = document.getElementById('invWizardCard');
    const selectedCount = w.selected.size;
    const cats = ['all', 'Зерно', 'Молоко', 'Сиропы', 'Чай', 'Выпечка', 'Еда'];
    const zonesW = ['all', 'Холодильник', 'Бар', 'Сухой склад', 'Витрина'];
    const items = stockItems.filter((it) => (w.category === 'all' || invCategory[it.id] === w.category) && (w.zone === 'all' || invZones[it.id] === w.zone) && (!w.q || it.name.toLowerCase().includes(w.q)));
    card.innerHTML =
      '<div class="inv-modal-head"><span class="ai-badge">ИНВЕНТАРИЗАЦИЯ</span><button class="ai-modal-close" id="invWizClose" aria-label="Закрыть">×</button></div>' +
      '<h3>Новая инвентаризация</h3><p>Сначала выберите точку и тип. Для частичной — отметьте позиции, которые будете считать.</p>' +
      '<label class="field" style="margin-top:13px"><span>Точка</span><select id="invWizPoint">' + stockPoints.map((p) => '<option' + (p === w.point ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></label>' +
      '<div class="inv-type-grid">' +
        '<button class="inv-type-card ' + (w.type === 'full' ? 'is-on' : '') + '" data-inv-wiz-type="full"><span class="ic"><svg width="13" height="13" viewBox="0 0 18 18" fill="none"><path d="M2.5 3.5h13v11h-13z" stroke="currentColor" stroke-width="1.4"/><path d="M5 7h8M5 10h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></span><b>Сплошная</b><span>Все позиции точки. Незаполненные строки заблокируют завершение.</span></button>' +
        '<button class="inv-type-card ' + (w.type === 'partial' ? 'is-on' : '') + '" data-inv-wiz-type="partial"><span class="ic"><svg width="13" height="13" viewBox="0 0 18 18" fill="none"><path d="M3 4h12v10H3z" stroke="currentColor" stroke-width="1.4"/><path d="m5.5 9 2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span><b>Частичная</b><span>Только выбранные позиции. Остальные остатки не меняются.</span></button>' +
      '</div>' +
      (w.type === 'partial'
        ? '<div class="inv-cat-chips">' + cats.map((c) => '<button data-inv-wiz-cat="' + c + '"' + (w.category === c ? ' class="is-on"' : '') + '>' + (c === 'all' ? 'Все категории' : c) + '</button>').join('') + '</div>' +
          '<div class="inv-cat-chips" style="margin-top:-2px">' + zonesW.map((z) => '<button data-inv-wiz-zone="' + z + '"' + (w.zone === z ? ' class="is-on"' : '') + '>' + (z === 'all' ? 'Все зоны' : z) + '</button>').join('') + '</div>' +
          '<label class="mini-search" style="width:100%;margin-bottom:7px"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><circle cx="8" cy="8" r="5.2" stroke="currentColor" stroke-width="1.7"/><path d="m12 12 3.2 3.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><input id="invWizSearch" type="search" placeholder="Найти позицию" value="' + esc(w.q) + '"></label>' +
          '<div class="inv-item-list" id="invWizItems">' + (items.length ? items.map((it) => '<label class="inv-item-check"><input type="checkbox" class="check" data-inv-wiz-item="' + it.id + '"' + (w.selected.has(it.id) ? ' checked' : '') + '>' + it.name + '<span class="meta">' + it.unit + ' · ' + (invZones[it.id] || '') + '</span></label>').join('') : '<div class="inv-empty-state">Нет позиций под фильтр</div>') + '</div>' +
          '<p class="pd-note" id="invWizCount" style="margin-top:7px">Выбрано: ' + selectedCount + ' позиций</p>'
        : '<p class="pd-note" style="margin-top:10px">Будут пересчитаны все ' + stockItems.length + ' позиций точки «' + w.point + '».</p>') +
      '<div class="inv-modal-actions"><button class="btn btn-ghost" id="invWizCancel">Отмена</button><button class="btn btn-primary" id="invWizStart"' + (w.type === 'partial' && selectedCount === 0 ? ' disabled' : '') + '>Начать</button></div>';
  }
  document.getElementById('invWizardCard').addEventListener('click', (e) => {
    if (e.target.closest('#invWizClose') || e.target.closest('#invWizCancel')) {
      document.getElementById('invWizard').classList.remove('is-on');
      return;
    }
    const type = e.target.closest('[data-inv-wiz-type]');
    if (type) {
      invWizard.type = type.dataset.invWizType;
      renderInvWizard();
      return;
    }
    const cat = e.target.closest('[data-inv-wiz-cat]');
    if (cat) {
      invWizard.category = cat.dataset.invWizCat;
      renderInvWizard();
      return;
    }
    const zoneBtn = e.target.closest('[data-inv-wiz-zone]');
    if (zoneBtn) {
      invWizard.zone = zoneBtn.dataset.invWizZone;
      renderInvWizard();
      return;
    }
    if (e.target.closest('#invWizStart')) {
      startInvDoc();
    }
  });
  document.getElementById('invWizardCard').addEventListener('change', (e) => {
    if (e.target.id === 'invWizPoint') {
      invWizard.point = e.target.value;
      renderInvWizard();
    }
    const item = e.target.dataset.invWizItem;
    if (item) {
      if (e.target.checked) invWizard.selected.add(item); else invWizard.selected.delete(item);
      const count = document.getElementById('invWizCount');
      if (count) count.textContent = 'Выбрано: ' + invWizard.selected.size + ' позиций';
      const start = document.getElementById('invWizStart');
      if (start) start.disabled = invWizard.type === 'partial' && invWizard.selected.size === 0;
    }
  });
  document.getElementById('invWizardCard').addEventListener('input', (e) => {
    if (e.target.id === 'invWizSearch') {
      invWizard.q = e.target.value.trim().toLowerCase();
      const items = stockItems.filter((it) => (invWizard.category === 'all' || invCategory[it.id] === invWizard.category) && (invWizard.zone === 'all' || invZones[it.id] === invWizard.zone) && it.name.toLowerCase().includes(invWizard.q));
      const box = document.getElementById('invWizItems');
      if (box) box.innerHTML = items.length ? items.map((it) => '<label class="inv-item-check"><input type="checkbox" class="check" data-inv-wiz-item="' + it.id + '"' + (invWizard.selected.has(it.id) ? ' checked' : '') + '>' + it.name + '<span class="meta">' + it.unit + ' · ' + (invZones[it.id] || '') + '</span></label>').join('') : '<div class="inv-empty-state">Нет позиций под фильтр</div>';
    }
  });
  function startInvDoc() {
    const w = invWizard;
    let ids = w.type === 'full' ? stockItems.map((s) => s.id) : Array.from(w.selected);
    if (!ids.length) { toast('Выберите хотя бы одну позицию'); return; }
    const doc = {
      id: 'ИНВ-' + String(32 + inventoryDocs.length - 4).padStart(4, '0'),
      date: '18 окт, 12:41', point: w.point, type: w.type, status: 'in_progress', author: 'Дмитрий',
      total: ids.length, counted: 0, items: buildInvItems(ids, w.point), closedZones: []
    };
    inventoryDocs.unshift(doc);
    document.getElementById('invWizard').classList.remove('is-on');
    renderInventoryDocs();
    openInvDoc(doc.id);
  }

  /* workspace */
  function openInvDoc(id) {
    const doc = inventoryDocs.find((d) => d.id === id);
    if (!doc) return;
    ensureInvItems(doc);
    activeInv = doc;
    invMode = doc.status === 'in_progress' || doc.status === 'draft' ? 'count' : 'review';
    invZone = 'all';
    invRowQuery = '';
    invRecount = new Set();
    go('stock');
    setStockTab('inventory');
    closeAll();
    document.getElementById('invWorkspace').classList.add('is-on');
    renderInvWorkspace();
  }
  function closeInvWorkspace() {
    document.getElementById('invWorkspace').classList.remove('is-on');
    activeInv = null;
    renderInventoryDocs();
  }
  function renderInvWorkspace() {
    const doc = activeInv;
    if (!doc) return;
    ensureInvItems(doc);
    const pr = invProgress(doc);
    const st = invStatus[doc.status] || invStatus.draft;
    const top = '<div class="inv-top"><div class="inv-top-left"><button class="inv-back" data-inv-exit aria-label="Назад">←</button><div class="inv-doc"><h2>' + doc.id + ' · ' + doc.point + '</h2><div class="meta">' + invType[doc.type] + ' · ' + doc.date + ' · <span class="pill ' + st.cls + '"><i></i>' + st.label + '</span></div></div></div>' +
      '<div class="inv-top-mid"><span class="inv-role"><i></i>' + (invMode === 'count' ? 'Исполнитель · бариста' : 'Менеджер точки') + '</span><div class="inv-progress"><div class="inv-progress-bar"><i style="width:' + pr.pct + '%"></i></div><span>' + pr.counted + '/' + pr.total + '</span></div></div>' +
      '<div class="inv-top-actions">' +
        (invMode === 'count'
          ? '<button class="btn btn-ghost" data-inv-save>Сохранить черновик</button><button class="btn btn-primary" data-inv-submit>Сдать на проверку</button>'
          : '<button class="btn btn-ghost" data-inv-exit>Закрыть</button>' + (doc.status === 'review' ? '<button class="btn btn-primary" data-inv-post>Провести</button>' : '') + '<button class="btn btn-ghost" data-inv-print>Сличительная ведомость</button>') +
      '</div></div>';
    let body = '';
    if (invMode === 'count') {
      const zones = ['all'].concat(Array.from(new Set(doc.items.map((i) => i.zone))));
      body = '<div class="inv-body"><div class="inv-toolbar"><div class="inv-zonebar">' +
        zones.map((z) => {
          const items = z === 'all' ? doc.items : doc.items.filter((i) => i.zone === z);
          const done = items.filter((i) => i.counted).length;
          const closed = z !== 'all' && doc.closedZones && doc.closedZones.indexOf(z) > -1;
          return '<button class="inv-zone-chip ' + (invZone === z ? 'is-on ' : '') + (done === items.length ? 'done ' : '') + (closed ? 'closed' : '') + '" data-inv-zone="' + z + '">' + (z === 'all' ? 'Все' : z) + ' <span class="n">' + done + '/' + items.length + (closed ? ' ✓' : '') + '</span></button>';
        }).join('') +
        '</div><div class="right"><label class="mini-search"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><circle cx="8" cy="8" r="5.2" stroke="currentColor" stroke-width="1.7"/><path d="m12 12 3.2 3.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><input id="invCountSearch" type="search" placeholder="Найти позицию" value="' + esc(invRowQuery) + '"></label><button class="btn btn-ghost btn-sm" data-inv-close-zone>Закрыть зону</button></div></div>' +
        '<div class="inv-count-list"><div class="inv-count-head"><span>Позиция</span><span>Факт</span><span></span></div><div id="invCountRows">' +
        doc.items.map((it, i) => {
          const item = itemById(it.itemId);
          const zoneOk = invZone === 'all' || it.zone === invZone;
          const qOk = !invRowQuery || item.name.toLowerCase().includes(invRowQuery);
          return '<div class="inv-count-row ' + (it.counted ? 'is-counted' : '') + '" data-inv-row="' + i + '" data-zone="' + it.zone + '" data-name="' + item.name.toLowerCase() + '" style="' + (zoneOk && qOk ? '' : 'display:none') + '"><div class="inv-row-name"><b>' + item.name + '</b><span>' + it.zone + ' · ' + it.category + '</span></div><div class="inv-fact-wrap"><input class="inv-fact" data-inv-fact="' + i + '" type="number" min="0" step="' + (item.unit === 'шт' ? '1' : '0.01') + '" inputmode="decimal" value="' + (it.fact === null ? '' : it.fact) + '" placeholder="0"><span class="inv-fact-unit">' + item.unit + '</span></div><span class="inv-counted"><svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6.2 4.8 9 10 3.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span></div>';
        }).join('') + '</div></div>' +
        '<p class="inv-hint" style="margin-top:9px">Факт вводит человек. Учётный остаток скрыт до проверки, чтобы не подгонять цифры.</p></div>';
    } else {
      const diffs = doc.items.map((it) => {
        const item = itemById(it.itemId);
        const diff = it.fact === null ? null : it.fact - it.book;
        return { it, item, diff, sum: diff === null ? 0 : diff * item.cost };
      }).sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum));
      const neg = diffs.filter((x) => x.diff !== null && x.diff < -0.001);
      const pos = diffs.filter((x) => x.diff !== null && x.diff > 0.001);
      const negSum = neg.reduce((s, x) => s + Math.abs(x.sum), 0);
      const posSum = pos.reduce((s, x) => s + x.sum, 0);
      body = '<div class="inv-body">' +
        '<div class="inv-review-summary"><div class="inv-sum"><div class="l">Недостачи</div><div class="v" style="color:var(--red)">' + neg.length + '</div><div class="n">' + nf.format(Math.round(negSum)) + ' ₽</div></div><div class="inv-sum"><div class="l">Излишки</div><div class="v" style="color:var(--green)">' + pos.length + '</div><div class="n">' + nf.format(Math.round(posSum)) + ' ₽</div></div><div class="inv-sum"><div class="l">Позиций в документе</div><div class="v">' + doc.items.length + '</div><div class="n">' + (doc.status === 'posted' ? 'проведена' : 'на проверке') + '</div></div></div>' +
        '<div class="card table-card"><div class="table-scroll"><table class="inv-review-table"><thead><tr><th>Позиция</th><th class="num-r">Учётный</th><th class="num-r">Факт</th><th class="num-r">Разница</th><th class="num-r">Сумма</th><th></th></tr></thead><tbody>' +
        diffs.map(({ it, item, diff, sum }, idx) => {
          const big = Math.abs(sum) >= 300;
          const selected = invRecount.has(it.itemId);
          return '<tr class="' + (big ? 'is-big' : '') + '"><td><span class="t-type" style="font-size:11.5px">' + item.name + '</span><span class="t-sub">' + it.zone + ' · ' + item.unit + '</span></td>' +
            '<td class="num-r"><span class="cmp-val">' + fmtQ(it.book) + '</span></td>' +
            '<td class="num-r"><span class="cmp-val">' + fmtQ(it.fact) + '</span></td>' +
            '<td class="num-r"><span class="' + (diff < 0 ? 'inv-diff-neg' : diff > 0 ? 'inv-diff-pos' : 't-muted') + '">' + (diff > 0 ? '+' : '') + fmtQ(diff) + '</span></td>' +
            '<td class="num-r"><span class="' + (sum < 0 ? 'inv-diff-neg' : sum > 0 ? 'inv-diff-pos' : 't-muted') + '">' + (sum ? nf.format(Math.round(sum)) + ' ₽' : '—') + '</span></td>' +
            '<td>' + (doc.status === 'review' ? '<button class="inv-recount ' + (selected ? 'is-on' : '') + '" data-inv-recount="' + it.itemId + '">Пересчёт</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div><div class="table-foot"><span class="info">' + (doc.status === 'posted' ? 'Документ проведён. Изменения остатков зафиксированы.' : 'Отклонения больше 300 ₽ подсвечены. Их можно отправить на пересчёт.') + '</span></div></div>' +
        '<div class="inv-actions">' + (doc.status === 'review' ? '<button class="btn btn-ghost" data-inv-recount-submit>Отправить на пересчёт</button><span class="spacer"></span><button class="btn btn-primary" data-inv-post>Провести инвентаризацию</button>' : '<button class="btn btn-primary" data-inv-print>Сличительная ведомость</button><span class="spacer"></span><button class="btn btn-ghost" data-inv-exit>Закрыть</button>') + '</div></div>';
    }
    document.getElementById('invWorkspaceInner').innerHTML = top + body;
  }

  document.getElementById('invWorkspaceInner').addEventListener('click', (e) => {
    if (e.target.closest('[data-inv-exit]')) { closeInvWorkspace(); return; }
    if (e.target.closest('[data-inv-save]')) { activeInv.status = 'in_progress'; closeInvWorkspace(); toast('Черновик сохранён'); return; }
    if (e.target.closest('[data-inv-submit]')) { submitInv(); return; }
    const zone = e.target.closest('[data-inv-zone]');
    if (zone) { invZone = zone.dataset.invZone; renderInvWorkspace(); return; }
    if (e.target.closest('[data-inv-close-zone]')) {
      if (invZone === 'all') { toast('Выберите зону'); return; }
      const items = activeInv.items.filter((i) => i.zone === invZone);
      if (items.some((i) => !i.counted)) { toast('В зоне остались несчитанные позиции'); return; }
      if (!activeInv.closedZones) activeInv.closedZones = [];
      if (activeInv.closedZones.indexOf(invZone) === -1) activeInv.closedZones.push(invZone);
      toast('Зона «' + invZone + '» закрыта');
      renderInvWorkspace();
      return;
    }
    if (e.target.closest('[data-inv-post]')) { openPostConfirm(); return; }
    if (e.target.closest('[data-inv-print]')) { openInvPrint(activeInv); return; }
    const rec = e.target.closest('[data-inv-recount]');
    if (rec) {
      const id = rec.dataset.invRecount;
      if (invRecount.has(id)) invRecount.delete(id); else invRecount.add(id);
      renderInvWorkspace();
      return;
    }
    if (e.target.closest('[data-inv-recount-submit]')) { sendRecount(); }
  });
  document.getElementById('invWorkspaceInner').addEventListener('input', (e) => {
    const idx = e.target.dataset.invFact;
    if (idx !== undefined) {
      const it = activeInv.items[Number(idx)];
      const v = e.target.value.trim();
      it.fact = v === '' ? null : Math.max(0, Number(v) || 0);
      it.counted = v !== '';
      activeInv.counted = activeInv.items.filter((x) => x.counted).length;
      const row = e.target.closest('.inv-count-row');
      if (row) row.classList.toggle('is-counted', it.counted);
      if (!it.counted && activeInv.closedZones) activeInv.closedZones = activeInv.closedZones.filter((z) => z !== it.zone);
      const pr = invProgress(activeInv);
      const bar = document.querySelector('.inv-top .inv-progress-bar i');
      const txt = document.querySelector('.inv-top .inv-progress span');
      if (bar) bar.style.width = pr.pct + '%';
      if (txt) txt.textContent = pr.counted + '/' + pr.total;
      return;
    }
    if (e.target.id === 'invCountSearch') {
      invRowQuery = e.target.value.trim().toLowerCase();
      document.querySelectorAll('#invCountRows .inv-count-row').forEach((row) => {
        const zoneOk = invZone === 'all' || row.dataset.zone === invZone;
        const qOk = !invRowQuery || row.dataset.name.indexOf(invRowQuery) > -1;
        row.style.display = zoneOk && qOk ? '' : 'none';
      });
    }
  });
  function submitInv() {
    const missing = activeInv.items.filter((i) => !i.counted).length;
    if (missing) {
      openInvConfirm({
        title: 'Не все позиции заполнены',
        text: 'Осталось ' + missing + ' из ' + activeInv.items.length + ' строк. Завершить сплошную инвентаризацию без них нельзя.',
        rows: [['Документ', activeInv.id], ['Заполнено', (activeInv.items.length - missing) + ' / ' + activeInv.items.length]],
        confirmLabel: 'Вернуться к вводу',
        onConfirm: null
      });
      return;
    }
    activeInv.status = 'review';
    invMode = 'review';
    invRecount = new Set();
    renderInventoryDocs();
    renderInvWorkspace();
    toast('Документ передан на проверку');
  }
  function sendRecount() {
    let ids = Array.from(invRecount);
    if (!ids.length) {
      ids = activeInv.items.filter((it) => Math.abs((it.fact - it.book) * itemById(it.itemId).cost) >= 300).map((it) => it.itemId);
    }
    if (!ids.length) { toast('Нет позиций для пересчёта'); return; }
    activeInv.items.forEach((it) => {
      if (ids.indexOf(it.itemId) > -1) { it.fact = null; it.counted = false; }
    });
    activeInv.status = 'in_progress';
    activeInv.counted = activeInv.items.filter((i) => i.counted).length;
    invMode = 'count';
    invZone = 'all';
    invRecount = new Set();
    renderInventoryDocs();
    renderInvWorkspace();
    toast('Позиции отправлены на пересчёт');
  }
  function openPostConfirm() {
    const neg = activeInv.items.filter((it) => it.counted && it.fact < it.book);
    const pos = activeInv.items.filter((it) => it.counted && it.fact > it.book);
    const negSum = neg.reduce((s, it) => s + Math.abs((it.fact - it.book) * itemById(it.itemId).cost), 0);
    const posSum = pos.reduce((s, it) => s + (it.fact - it.book) * itemById(it.itemId).cost, 0);
    openInvConfirm({
      title: 'Провести инвентаризацию?',
      text: 'Остатки по ' + activeInv.items.length + ' позициям будут выровнены по факту. После проведения документ станет только для чтения.',
      rows: [['Списание', nf.format(Math.round(negSum)) + ' ₽'], ['Оприходование', nf.format(Math.round(posSum)) + ' ₽'], ['Позиций', activeInv.items.length]],
      confirmLabel: 'Провести',
      onConfirm: () => {
        activeInv.items.forEach((it) => {
          if (!it.counted || it.fact === null) return;
          const item = itemById(it.itemId);
          const b = item.balances[activeInv.point];
          if (!b) return;
          b.opening = it.fact + b.consumed;
          b.fact = it.fact;
        });
        activeInv.status = 'posted';
        activeInv.postedAt = '18 окт, 12:55';
        activeInv.counted = activeInv.items.length;
        renderStock();
        renderInventoryDocs();
        if (typeof renderExpiry === 'function') renderExpiry();
        if (typeof journal !== 'undefined') {
          journal.unshift({ time: '12:55', section: 'Склад', change: 'Инвентаризация ' + activeInv.id + ' проведена · ' + activeInv.point, who: 'Дмитрий' });
          if (typeof renderJournal === 'function') renderJournal();
        }
        invMode = 'review';
        renderInvWorkspace();
        toast('Инвентаризация проведена · остатки выровнены');
      }
    });
  }
  function openInvConfirm(config) {
    invConfirmCallback = config.onConfirm || null;
    document.getElementById('invConfirmTitle').textContent = config.title;
    document.getElementById('invConfirmText').textContent = config.text;
    document.getElementById('invConfirmRows').innerHTML = (config.rows || []).map((r) => '<div class="ai-draft-row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>').join('');
    document.getElementById('invConfirmOk').textContent = config.confirmLabel || 'Провести';
    document.getElementById('invConfirm').classList.add('is-on');
  }
  function closeInvConfirm() {
    document.getElementById('invConfirm').classList.remove('is-on');
    invConfirmCallback = null;
  }
  document.getElementById('invConfirmOk').addEventListener('click', () => {
    const cb = invConfirmCallback;
    closeInvConfirm();
    if (cb) cb();
  });
  document.getElementById('invConfirmCancel').addEventListener('click', closeInvConfirm);
  document.getElementById('invConfirmClose').addEventListener('click', closeInvConfirm);
  document.getElementById('invConfirm').addEventListener('click', (e) => { if (e.target.id === 'invConfirm') closeInvConfirm(); });

  function openInvPrint(doc) {
    const rows = doc.items.filter((i) => i.counted);
    const neg = rows.filter((it) => it.fact < it.book).reduce((s, it) => s + Math.abs((it.fact - it.book) * itemById(it.itemId).cost), 0);
    const pos = rows.filter((it) => it.fact > it.book).reduce((s, it) => s + (it.fact - it.book) * itemById(it.itemId).cost, 0);
    document.getElementById('invPrintBody').innerHTML = '<div class="inv-print-wrap"><div class="inv-print-bar"><button class="btn btn-ghost btn-sm" data-toast="Демо: ведомость отправлена на печать">Печать / PDF</button><button class="btn btn-primary btn-sm" id="invPrintClose">Закрыть</button></div><div class="inv-sheet"><div class="inv-sheet-head"><div><div class="inv-sheet-brand">6.7 Coffee · склад</div><h2>Сличительная ведомость</h2></div><div class="inv-sheet-meta">Документ: ' + doc.id + '<br>Точка: ' + doc.point + '<br>Дата: ' + doc.date + '<br>Тип: ' + invType[doc.type] + '</div></div><table><thead><tr><th>№</th><th>Позиция</th><th>Ед.</th><th class="num">Учёт</th><th class="num">Факт</th><th class="num">Разница</th><th class="num">Сумма</th></tr></thead><tbody>' + rows.map((it, i) => { const item = itemById(it.itemId); const diff = it.fact - it.book; return '<tr><td>' + (i + 1) + '</td><td>' + item.name + '</td><td>' + item.unit + '</td><td class="num">' + fmtQ(it.book) + '</td><td class="num">' + fmtQ(it.fact) + '</td><td class="num">' + (diff > 0 ? '+' : '') + fmtQ(diff) + '</td><td class="num">' + (diff ? nf.format(Math.round(diff * item.cost)) + ' ₽' : '—') + '</td></tr>'; }).join('') + '</tbody></table><div class="inv-sheet-totals"><span>Недостачи: <b>' + nf.format(Math.round(neg)) + ' ₽</b></span><span>Излишки: <b>' + nf.format(Math.round(pos)) + ' ₽</b></span></div><div class="inv-signs"><div class="inv-sign"><span>Считал</span></div><div class="inv-sign"><span>Проверил</span></div></div></div></div>';
    document.getElementById('invPrintModal').classList.add('is-on');
    document.getElementById('invPrintClose').addEventListener('click', () => document.getElementById('invPrintModal').classList.remove('is-on'));
  }

  renderInventoryDocs();


  /* ---------------- expiry monitor ---------------- */
  let expiryFilter = 'all';
  function renderExpiry() {
    const recs = expiryRecs(stockPoint);
    const urgent = recs.filter((r) => r.sev === 'urgent').length;
    const cnt = document.getElementById('stockDatesCount');
    if (cnt) cnt.textContent = urgent;
    const list = recs.filter((r) => expiryFilter === 'all' || r.sev === expiryFilter);
    document.getElementById('expiryList').innerHTML = list.map((r) => {
      const sevLabel = r.sev === 'urgent' ? 'Срочно' : r.sev === 'warn' ? 'Внимание' : 'Инфо';
      const why = r.days === null
        ? 'Срок не указан. Для скоропорта это риск: непонятно, что списывать первым.'
        : r.days < 0
          ? 'Срок истёк. Продавать нельзя — только списание или возврат поставщику, если договор позволяет.'
          : r.days <= 2
            ? 'До конца срока ' + expLabel(r.days) + '. Остаток ' + fmtQ(r.qty) + ' ' + r.item.unit + ' — высокий риск списания.'
            : 'До конца срока ' + expLabel(r.days) + '. Остаток ' + fmtQ(r.qty) + ' ' + r.item.unit + ' — стоит ускорить продажу.';
      const primary = r.days === null
        ? '<button class="ai-action" data-expiry-action="item" data-item="' + r.item.id + '">Указать срок</button>'
        : r.days < 0
          ? '<button class="ai-action urgent" data-expiry-action="writeoff" data-item="' + r.item.id + '" data-lot="' + r.lot + '" data-qty="' + r.qty + '" data-days="' + r.days + '">Списать порчу</button>'
          : '<button class="ai-action" data-expiry-action="promo" data-item="' + r.item.id + '" data-qty="' + r.qty + '" data-days="' + r.days + '">Ускорить продажу</button>';
      const ret = r.days !== null && r.days >= -3 && r.ret
        ? '<button class="ai-link" data-expiry-action="return" data-item="' + r.item.id + '" data-lot="' + r.lot + '" data-qty="' + r.qty + '" data-days="' + r.days + '">Вернуть поставщику</button>'
        : '';
      const writeoff = r.days >= 0
        ? '<button class="ai-link" data-expiry-action="writeoff" data-item="' + r.item.id + '" data-lot="' + r.lot + '" data-qty="' + r.qty + '" data-days="' + r.days + '">Списать</button>'
        : '';
      return '<div class="expiry-card ' + r.sev + '"><div class="expiry-head"><span class="pill ' + (r.sev === 'urgent' ? 'red' : r.sev === 'warn' ? 'amber' : 'gray') + '"><i></i>' + sevLabel + '</span><span class="expiry-days">' + expLabel(r.days) + '</span></div>' +
        '<div class="expiry-title">' + r.item.name + '</div><div class="expiry-lot">партия ' + r.lot + ' · ' + r.point + '</div>' +
        '<div class="expiry-facts"><span>' + fmtQ(r.qty) + ' ' + r.item.unit + '</span><span>годен до ' + r.expiry + '</span><span>' + r.supplier + '</span></div>' +
        '<p class="expiry-why">' + why + '</p>' +
        '<div class="expiry-actions">' + primary + ret + writeoff + '</div></div>';
    }).join('');
    document.getElementById('expiryEmpty').style.display = list.length ? 'none' : 'block';
  }
  document.getElementById('expiryFilters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-expiry-filter]');
    if (!b) return;
    expiryFilter = b.dataset.expiryFilter;
    document.querySelectorAll('#expiryFilters .chip').forEach((x) => x.classList.toggle('is-on', x === b));
    renderExpiry();
  });
  document.getElementById('expiryList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-expiry-action]');
    if (!b) return;
    const action = b.dataset.expiryAction;
    const item = itemById(b.dataset.item);
    const qty = Number(b.dataset.qty || 0);
    if (action === 'promo') {
      openInvConfirm({
        title: 'Черновик акции',
        text: 'Предложение по партии «' + item.name + '»: ускорить продажу, пока срок не истёк.',
        rows: [['Позиция', item.name], ['Остаток партии', fmtQ(qty) + ' ' + item.unit], ['Идея', '−20% на позицию или комбо'], ['Куда', 'Контент PWA / баннер']],
        confirmLabel: 'Открыть контент',
        onConfirm: () => { go('content'); toast('Черновик акции создан'); }
      });
      return;
    }
    if (action === 'writeoff') {
      openInvConfirm({
        title: 'Списать партию?',
        text: 'Партия «' + item.name + '» будет списана с остатка. Действие попадёт в журнал.',
        rows: [['Позиция', item.name], ['Количество', fmtQ(qty) + ' ' + item.unit], ['Основание', Number(b.dataset.days) < 0 ? 'Просрочен' : 'Порча / истекает']],
        confirmLabel: 'Списать',
        onConfirm: () => {
          reduceStock(item.id, stockPoint === 'all' ? 'Покровка' : stockPoint, qty);
          renderStock();
          renderExpiry();
          toast('Партия списана · остаток уменьшен');
        }
      });
      return;
    }
    if (action === 'return') {
      if (typeof openReturnFromRec === 'function') openReturnFromRec({ itemId: item.id, lot: b.dataset.lot, qty, days: Number(b.dataset.days), point: stockPoint === 'all' ? 'Покровка' : stockPoint });
      return;
    }
    if (action === 'item') openItem(item.id);
  });
  renderExpiry();

  const suppliers = [
    { id: 's1', name: 'Кофейная компания', legal: 'ООО «Кофейная компания»', type: 'Юрлицо', inn: '7701234567', kpp: '770101001', ogrn: '1157746123456', phone: '+7 495 120-44-10', email: 'order@coffeeco.ru', legalAddr: 'Москва, ул. Складочная, 1', addr: 'Москва, ул. Складочная, 1', contact: 'Ирина Петрова', delay: 14, status: 'active', bank: 'АО «Тинькофф Банк»', rs: '40702810900000012345', bik: '044525974', ks: '30101810145250000974', comment: 'Зерно, доставка по вторникам до 11:00' },
    { id: 's2', name: 'Молочная ферма', legal: 'ИП Соколова А. В.', type: 'ИП', inn: '770234567890', kpp: '', ogrn: '316770000123456', phone: '+7 916 240-18-02', email: 'milk@ferma.ru', legalAddr: 'Московская обл., д. Молоково, 4', addr: 'Москва, Ленинградский пр-т, 74', contact: 'Анна Соколова', delay: 7, status: 'active', bank: 'ПАО «Сбербанк»', rs: '40802810900000054321', bik: '044525225', ks: '30101810400000000225', comment: 'Молоко и сливки, ежедневно' },
    { id: 's3', name: 'Сладкая лавка', legal: 'ООО «Сладкая лавка»', type: 'Юрлицо', inn: '7703456789', kpp: '770301001', ogrn: '1147746234567', phone: '+7 495 780-31-22', email: 'hello@sladkaya.ru', legalAddr: 'Москва, ул. Большая Новодмитровская, 36', addr: 'Москва, ул. Лесная, 5', contact: 'Павел Орлов', delay: 10, status: 'active', bank: 'АО «Альфа-Банк»', rs: '40702810400000098765', bik: '044525593', ks: '30101810200000000593', comment: 'Выпечка, вторник и пятница' },
    { id: 's4', name: 'Чай и матча', legal: 'ООО «Чай и матча»', type: 'Юрлицо', inn: '7704567890', kpp: '770401001', ogrn: '1187746345678', phone: '+7 495 640-12-08', email: 'b2b@matcha.ru', legalAddr: 'Москва, Нижняя Сыромятническая, 10', addr: 'Москва, Нижняя Сыромятническая, 10', contact: 'Мария Полякова', delay: 5, status: 'active', bank: 'АО «Райффайзенбанк»', rs: '40702810800000024680', bik: '044525700', ks: '30101810200000000700', comment: 'Матча, чай, сиропы' },
    { id: 's5', name: 'Гастроном', legal: 'ООО «Гастроном»', type: 'Юрлицо', inn: '7705678901', kpp: '770501001', ogrn: '1177746456789', phone: '+7 495 310-55-77', email: 'zakaz@gastronom.ru', legalAddr: 'Москва, ул. Покровка, 17', addr: 'Москва, ул. Покровка, 17', contact: 'Роман Титов', delay: 7, status: 'active', bank: 'ПАО «ВТБ»', rs: '40702810100000013579', bik: '044525187', ks: '30101810700000000187', comment: 'Сэндвичи и сырники' },
    { id: 's6', name: 'УпаковкаПро', legal: 'ООО «УпаковкаПро»', type: 'Юрлицо', inn: '7706789012', kpp: '770601001', ogrn: '1167746567890', phone: '+7 495 900-10-30', email: 'sales@upak.pro', legalAddr: 'Москва, Дмитровское ш., 71', addr: 'Москва, Дмитровское ш., 71', contact: 'Денис Волков', delay: 30, status: 'archive', bank: 'АО «Тинькофф Банк»', rs: '40702810700000086420', bik: '044525974', ks: '30101810145250000974', comment: 'Стаканы и крышки, архив с сентября' }
  ];
  const invoices = [
    { id: 'ПР-0241', date: '18 окт', due: '1 ноя', dueIn: 14, supplier: 's1', point: 'Покровка', amount: 18400, paid: 18400, received: true, items: [{ item: 'coffee', qty: 10, price: 1200 }, { item: 'milk', qty: 40, price: 90 }, { item: 'vanilla', qty: 3.5, price: 800 }] },
    { id: 'ПР-0240', date: '16 окт', due: '16 окт', dueIn: -2, supplier: 's2', point: 'Арбат', amount: 6200, paid: 0, received: true, items: [{ item: 'milk', qty: 60, price: 90 }, { item: 'vanilla', qty: 1, price: 800 }] },
    { id: 'ПР-0239', date: '15 окт', due: '22 окт', dueIn: 4, supplier: 's3', point: 'Покровка', amount: 9780, paid: 5000, received: true, items: [{ item: 'croissant', qty: 120, price: 45 }, { item: 'syrniki', qty: 73, price: 60 }] },
    { id: 'ПР-0238', date: '12 окт', due: '26 окт', dueIn: 8, supplier: 's1', point: 'Покровка', amount: 12400, paid: 12400, received: true, items: [{ item: 'coffee', qty: 8, price: 1200 }, { item: 'vanilla', qty: 3.5, price: 800 }] },
    { id: 'ПР-0237', date: '10 окт', due: '15 окт', dueIn: -3, supplier: 's4', point: 'Депо', amount: 9600, paid: 0, received: true, items: [{ item: 'tea', qty: 2, price: 600 }, { item: 'matcha', qty: 2, price: 4200 }] },
    { id: 'ПР-0236', date: '9 окт', due: '17 окт', dueIn: -1, supplier: 's2', point: 'Покровка', amount: 5400, paid: 2700, received: true, items: [{ item: 'milk', qty: 60, price: 90 }] },
    { id: 'ПР-0235', date: '9 окт', due: '28 окт', dueIn: 10, supplier: 's5', point: 'Арбат', amount: 3600, paid: 0, received: false, items: [{ item: 'sandwich', qty: 30, price: 120 }] },
    { id: 'ПР-0234', date: '8 окт', due: '20 окт', dueIn: 2, supplier: 's3', point: 'Покровка', amount: 4200, paid: 4200, received: true, items: [{ item: 'croissant', qty: 40, price: 45 }, { item: 'syrniki', qty: 40, price: 60 }] }
  ];
  const purchasePayments = [
    { id: 'ОП-0120', date: '18 окт', supplier: 's1', amount: 18400, method: 'Банк', invoices: ['ПР-0241'], status: 'Проведён' },
    { id: 'ОП-0119', date: '15 окт', supplier: 's3', amount: 5000, method: 'Карта', invoices: ['ПР-0239'], status: 'Проведён' },
    { id: 'ОП-0118', date: '12 окт', supplier: 's1', amount: 12400, method: 'Банк', invoices: ['ПР-0238'], status: 'Проведён' },
    { id: 'ОП-0117', date: '10 окт', supplier: 's2', amount: 2700, method: 'Банк', invoices: ['ПР-0236'], status: 'Проведён' },
    { id: 'ОП-0116', date: '8 окт', supplier: 's3', amount: 4200, method: 'Наличные', invoices: ['ПР-0234'], status: 'Проведён' }
  ];
  const reconciliations = [
    { id: 'СВ-0042', supplier: 's1', period: 'Сентябрь 2026', turnover: 42800, balance: 0, status: 'agreed', date: '1 окт' },
    { id: 'СВ-0041', supplier: 's2', period: 'Сентябрь 2026', turnover: 18200, balance: 2700, status: 'mismatch', date: '2 окт' },
    { id: 'СВ-0040', supplier: 's3', period: 'Сентябрь 2026', turnover: 24600, balance: 0, status: 'agreed', date: '3 окт' },
    { id: 'СВ-0043', supplier: 's4', period: 'Октябрь 2026', turnover: 9600, balance: 9600, status: 'draft', date: '18 окт' }
  ];
  const bankRows = [
    { date: '18 окт', party: 'Сладкая лавка', purpose: 'Оплата по счёту 0239', amount: -5000, match: 'Найдена накладная', cls: 'green' },
    { date: '17 окт', party: 'Молочная ферма', purpose: 'Оплата по счёту 0236', amount: -2700, match: 'Найдена накладная', cls: 'green' },
    { date: '16 окт', party: 'Неизвестный получатель', purpose: 'Перевод', amount: -3000, match: 'Не сопоставлено', cls: 'red' },
    { date: '15 окт', party: 'Кофейная компания', purpose: 'Оплата по счёту 0241', amount: -18400, match: 'Найдена накладная', cls: 'green' }
  ];
  let invoiceFilter = 'all';
  let invoiceQuery = '';
  let supplierFilter = 'all';
  let supplierQuery = '';
  let purTab = 'overview';

  const supById = (id) => suppliers.find((s) => s.id === id);
  const invById = (id) => invoices.find((i) => i.id === id);
  const invoiceDebt = (inv) => Math.max(0, inv.amount - inv.paid);
  function invoiceStatus(inv) {
    if (invoiceDebt(inv) <= 0.001) return { key: 'paid', label: 'Оплачена', cls: 'green' };
    if (inv.dueIn < 0) return { key: 'overdue', label: 'Просрочена', cls: 'red' };
    if (inv.paid > 0) return { key: 'partial', label: 'Частично', cls: 'amber' };
    return { key: 'unpaid', label: 'Без оплаты', cls: 'gray' };
  }
  function supplierDebt(id) { return invoices.filter((i) => i.supplier === id).reduce((s, i) => s + invoiceDebt(i), 0); }
  function supplierOverdue(id) { return invoices.filter((i) => i.supplier === id && invoiceDebt(i) > 0 && i.dueIn < 0).reduce((s, i) => s + invoiceDebt(i), 0); }
  function lastInvoice(id) { const list = invoices.filter((i) => i.supplier === id); return list.length ? list[0].date : '—'; }
  function lastPayment(id) { const list = purchasePayments.filter((p) => p.supplier === id); return list.length ? list[0].date : '—'; }
  function paidTotal() { return purchasePayments.reduce((s, p) => s + p.amount, 0); }
  function reconMeta(status) {
    return {
      draft: { label: 'Черновик', cls: 'gray' },
      sent: { label: 'Отправлен', cls: 'navy' },
      agreed: { label: 'Согласован', cls: 'green' },
      mismatch: { label: 'Расхождение', cls: 'red' }
    }[status] || { label: 'Черновик', cls: 'gray' };
  }

  function renderPurchasesOverview() {
    const debt = invoices.reduce((s, i) => s + invoiceDebt(i), 0);
    const overdueRows = invoices.filter((i) => invoiceDebt(i) > 0 && i.dueIn < 0);
    const overdue = overdueRows.reduce((s, i) => s + invoiceDebt(i), 0);
    const unpaid = invoices.filter((i) => invoiceDebt(i) > 0).length;
    document.getElementById('purDebt').innerHTML = nf.format(debt) + ' <small>₽</small>';
    document.getElementById('purOverdue').innerHTML = nf.format(overdue) + ' <small>₽</small>';
    document.getElementById('purPaid').innerHTML = nf.format(paidTotal()) + ' <small>₽</small>';
    document.getElementById('purUnpaid').innerHTML = unpaid + ' <small>накладных</small>';
    document.getElementById('purDebtNote').textContent = unpaid + ' накладных';
    document.getElementById('purOverdueNote').textContent = overdueRows.length + ' ' + plural(overdueRows.length, 'накладная', 'накладные', 'накладных');
    document.getElementById('purDebtPill').textContent = nf.format(debt) + ' ₽';
    document.getElementById('purOverdueCount').textContent = overdueRows.length;
    const nav = document.getElementById('purchasesNavCount');
    if (nav) nav.textContent = overdueRows.length;
    document.getElementById('purInvCount').textContent = invoices.length;
    document.getElementById('purSupCount').textContent = suppliers.length;
    document.getElementById('purPayCount').textContent = purchasePayments.length;
    document.getElementById('purReconCount').textContent = reconciliations.length;

    const buckets = [
      { label: '0–7 дней', min: 0, max: 7 },
      { label: '8–14 дней', min: 8, max: 14 },
      { label: '15+ дней', min: 15, max: 9999 },
      { label: 'Просрочено', min: -9999, max: -1, over: true }
    ].map((b) => {
      const amount = invoices.filter((i) => invoiceDebt(i) > 0 && i.dueIn >= b.min && i.dueIn <= b.max).reduce((s, i) => s + invoiceDebt(i), 0);
      return Object.assign({}, b, { amount });
    });
    const max = Math.max.apply(null, buckets.map((b) => b.amount)) || 1;
    document.getElementById('agingBars').innerHTML = buckets.map((b) => (
      '<div class="aging-row ' + (b.over ? 'is-over' : b.amount / max > 0.7 ? 'is-warn' : '') + '">' +
        '<span class="aging-label">' + b.label + '</span>' +
        '<div class="aging-track"><div class="aging-fill" style="width:' + (b.amount ? Math.max(3, b.amount / max * 100) : 0) + '%"></div></div>' +
        '<span class="aging-amt">' + nf.format(b.amount) + ' ₽</span>' +
      '</div>'
    )).join('');
    const attention = document.getElementById('purAttention');
    const invOverdue = overdueRows[0];
    const reconMismatch = reconciliations.find((r) => r.status === 'mismatch');
    const unreceived = invoices.find((i) => !i.received);
    attention.innerHTML =
      (invOverdue ? '<button class="att-item" data-pur-invoice="' + invOverdue.id + '"><span class="att-ic red"><svg width="13" height="13" viewBox="0 0 18 18" fill="none"><path d="M9 2.8 16 15H2L9 2.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 7.2v3.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span class="att-body"><span class="att-t">' + invOverdue.id + ' просрочена</span><span class="att-d">' + supById(invOverdue.supplier).name + ' · ' + nf.format(invoiceDebt(invOverdue)) + ' ₽</span></span><span class="att-n red">' + nf.format(invoiceDebt(invOverdue)) + ' ₽</span></button>' : '') +
      (reconMismatch ? '<button class="att-item" data-pur-recon="' + reconMismatch.id + '"><span class="att-ic"><svg width="13" height="13" viewBox="0 0 18 18" fill="none"><path d="M4 4h10v10H4z" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 9h5" stroke="currentColor" stroke-width="1.4"/></svg></span><span class="att-body"><span class="att-t">Сверка с расхождением</span><span class="att-d">' + supById(reconMismatch.supplier).name + ' · ' + nf.format(reconMismatch.balance) + ' ₽</span></span><span class="att-n">' + nf.format(reconMismatch.balance) + ' ₽</span></button>' : '') +
      (unreceived ? '<button class="att-item" data-pur-invoice="' + unreceived.id + '"><span class="att-ic green"><svg width="13" height="13" viewBox="0 0 18 18" fill="none"><path d="m10 2.8 6.3 3.4v7.6L10 17.2l-6.3-3.4V6.2L10 2.8Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></span><span class="att-body"><span class="att-t">' + unreceived.id + ' ждёт приёмки</span><span class="att-d">' + supById(unreceived.supplier).name + ' · ' + nf.format(unreceived.amount) + ' ₽</span></span><span class="att-n">→</span></button>' : '');

    const upcoming = invoices.filter((i) => invoiceDebt(i) > 0 && i.dueIn >= 0 && i.dueIn <= 7).sort((a, b) => a.dueIn - b.dueIn);
    document.getElementById('upcomingBody').innerHTML = upcoming.length ? upcoming.map((i) => (
      '<tr class="clickable" data-pur-invoice="' + i.id + '"><td><span class="t-id">' + i.id + '</span></td><td><span class="t-muted">' + supById(i.supplier).name + '</span></td><td><span class="t-muted">' + (i.dueIn === 0 ? 'сегодня' : 'через ' + i.dueIn + ' дн.') + '</span></td><td class="num-r"><span class="t-money">' + nf.format(invoiceDebt(i)) + ' ₽</span></td><td><span class="pill ' + invoiceStatus(i).cls + '"><i></i>' + invoiceStatus(i).label + '</span></td></tr>'
    )).join('') : '<tr><td colspan="5"><span class="t-muted">Нет накладных к оплате на этой неделе</span></td></tr>';

    const withDebt = suppliers.map((s) => ({ s, debt: supplierDebt(s.id) })).filter((x) => x.debt > 0).sort((a, b) => b.debt - a.debt);
    document.getElementById('supplierDebtList').innerHTML = withDebt.slice(0, 4).map(({ s, debt }) => (
      '<button class="q-item" data-pur-supplier="' + s.id + '"><span class="q-ic">' + s.name.charAt(0) + '</span><span><span class="q-t">' + s.name + '</span><span class="q-d">отсрочка ' + s.delay + ' дней</span></span><span class="q-n">' + nf.format(debt) + ' ₽</span><span class="q-arrow">›</span></button>'
    )).join('') || '<div class="stock-norm-empty">Долгов нет.</div>';
  }

  function renderInvoices() {
    const debtInvoices = invoices.filter((i) => invoiceDebt(i) > 0);
    const counts = {
      all: invoices.length,
      unpaid: debtInvoices.filter((i) => i.paid === 0).length,
      partial: debtInvoices.filter((i) => i.paid > 0).length,
      overdue: debtInvoices.filter((i) => i.dueIn < 0).length,
      paid: invoices.filter((i) => invoiceDebt(i) <= 0.001).length
    };
    document.querySelectorAll('#invoiceChips .chip').forEach((b) => {
      const n = b.querySelector('.n');
      if (n) n.textContent = counts[b.dataset.invFilter];
      b.classList.toggle('is-on', b.dataset.invFilter === invoiceFilter);
    });
    const q = invoiceQuery.toLowerCase();
    const rows = invoices.filter((i) => {
      const debt = invoiceDebt(i) > 0;
      const okFilter = invoiceFilter === 'all'
        || (invoiceFilter === 'unpaid' && debt && i.paid === 0)
        || (invoiceFilter === 'partial' && debt && i.paid > 0)
        || (invoiceFilter === 'overdue' && debt && i.dueIn < 0)
        || (invoiceFilter === 'paid' && !debt);
      const okQ = !q || i.id.toLowerCase().includes(q) || supById(i.supplier).name.toLowerCase().includes(q);
      return okFilter && okQ;
    });
    document.getElementById('invoicesBody').innerHTML = rows.map((i) => {
      const st = invoiceStatus(i);
      return '<tr class="clickable" data-pur-invoice="' + i.id + '">' +
        '<td><span class="t-id">' + i.id + '</span>' + (!i.received ? '<span class="t-sub" style="color:var(--amber)">ждёт приёмки</span>' : '') + '</td>' +
        '<td><span class="t-muted">' + i.date + '</span><span class="t-sub">до ' + i.due + '</span></td>' +
        '<td><span class="t-type" style="font-size:11px;font-weight:550">' + supById(i.supplier).name + '</span></td>' +
        '<td><span class="t-muted">' + i.point + '</span></td>' +
        '<td class="num-r"><span class="t-money">' + nf.format(i.amount) + ' ₽</span></td>' +
        '<td class="num-r"><span class="cmp-val">' + nf.format(i.paid) + ' ₽</span></td>' +
        '<td class="num-r"><span class="' + (invoiceDebt(i) > 0 ? 'var-neg' : 't-muted') + '">' + (invoiceDebt(i) ? nf.format(invoiceDebt(i)) + ' ₽' : '—') + '</span></td>' +
        '<td><span class="pill ' + st.cls + '"><i></i>' + st.label + '</span></td>' +
        '<td><span class="q-arrow">›</span></td>' +
      '</tr>';
    }).join('');
    document.getElementById('invoicesEmpty').style.display = rows.length ? 'none' : 'block';
    document.getElementById('invoicesInfo').textContent = 'Показано ' + rows.length + ' из ' + invoices.length;
  }

  function renderSuppliers() {
    const counts = {
      all: suppliers.length,
      debt: suppliers.filter((s) => supplierDebt(s.id) > 0).length,
      active: suppliers.filter((s) => s.status === 'active').length,
      archive: suppliers.filter((s) => s.status === 'archive').length
    };
    document.querySelectorAll('#supplierChips .chip').forEach((b) => {
      const n = b.querySelector('.n');
      if (n) n.textContent = counts[b.dataset.supFilter];
      b.classList.toggle('is-on', b.dataset.supFilter === supplierFilter);
    });
    const q = supplierQuery.toLowerCase();
    const rows = suppliers.filter((s) => {
      const debt = supplierDebt(s.id);
      const okFilter = supplierFilter === 'all' || (supplierFilter === 'debt' ? debt > 0 : s.status === supplierFilter);
      const okQ = !q || s.name.toLowerCase().includes(q) || s.inn.includes(q);
      return okFilter && okQ;
    });
    document.getElementById('suppliersBody').innerHTML = rows.map((s) => {
      const debt = supplierDebt(s.id);
      return '<tr class="clickable" data-pur-supplier="' + s.id + '"><td><span class="t-type" style="font-size:11.5px">' + s.name + '</span><span class="t-sub">' + s.contact + '</span></td><td><span class="cmp-val">' + s.inn + '</span></td><td><span class="t-muted">' + s.phone + '</span></td><td class="num-r"><span class="' + (debt ? 'var-neg' : 't-muted') + '">' + (debt ? nf.format(debt) + ' ₽' : '—') + '</span></td><td><span class="t-muted">' + lastInvoice(s.id) + '</span></td><td><span class="pill ' + (s.status === 'active' ? 'green' : 'gray') + '"><i></i>' + (s.status === 'active' ? 'Активен' : 'Архив') + '</span></td><td><span class="q-arrow">›</span></td></tr>';
    }).join('');
    document.getElementById('suppliersEmpty').style.display = rows.length ? 'none' : 'block';
  }

  function renderPayments() {
    document.getElementById('paymentsBody').innerHTML = purchasePayments.map((p) => (
      '<tr><td><span class="t-id">' + p.id + '</span></td><td><span class="t-muted">' + p.date + '</span></td><td><span class="t-type" style="font-size:11px;font-weight:550">' + supById(p.supplier).name + '</span></td><td class="num-r"><span class="t-money">' + nf.format(p.amount) + ' ₽</span></td><td><span class="t-muted">' + p.method + '</span></td><td><span class="t-muted">' + p.invoices.join(', ') + '</span></td><td><span class="pill green"><i></i>' + p.status + '</span></td></tr>'
    )).join('');
  }

  function renderSettlements() {
    const debt = invoices.reduce((s, i) => s + invoiceDebt(i), 0);
    const overdue = invoices.filter((i) => invoiceDebt(i) > 0 && i.dueIn < 0).reduce((s, i) => s + invoiceDebt(i), 0);
    const withDebt = suppliers.filter((s) => supplierDebt(s.id) > 0).length;
    document.getElementById('settleSummary').innerHTML =
      '<div class="card"><div class="l">Общий долг</div><div class="v">' + nf.format(debt) + ' ₽</div><div class="n">' + withDebt + ' ' + plural(withDebt, 'контрагент', 'контрагента', 'контрагентов') + '</div></div>' +
      '<div class="card"><div class="l">Просрочено</div><div class="v" style="color:var(--red)">' + nf.format(overdue) + ' ₽</div><div class="n">требует оплаты</div></div>' +
      '<div class="card"><div class="l">Оплачено за месяц</div><div class="v">' + nf.format(paidTotal()) + ' ₽</div><div class="n">' + purchasePayments.length + ' платежей</div></div>';
    document.getElementById('settlementsBody').innerHTML = suppliers.filter((s) => supplierDebt(s.id) > 0).map((s) => {
      const debt = supplierDebt(s.id);
      const over = supplierOverdue(s.id);
      const next = invoices.filter((i) => i.supplier === s.id && invoiceDebt(i) > 0 && i.dueIn >= 0).sort((a, b) => a.dueIn - b.dueIn)[0];
      return '<tr class="clickable" data-pur-supplier="' + s.id + '"><td><span class="t-type" style="font-size:11.5px">' + s.name + '</span><span class="t-sub">отсрочка ' + s.delay + ' дней</span></td><td class="num-r"><span class="t-money">' + nf.format(debt) + ' ₽</span></td><td class="num-r"><span class="' + (over ? 'var-neg' : 't-muted') + '">' + (over ? nf.format(over) + ' ₽' : '—') + '</span></td><td><span class="t-muted">' + (next ? (next.dueIn === 0 ? 'сегодня' : 'через ' + next.dueIn + ' дн.') : '—') + '</span></td><td><span class="t-muted">' + lastPayment(s.id) + '</span></td><td><span class="pill ' + (over ? 'red' : 'amber') + '"><i></i>' + (over ? 'Просрочка' : 'Долг') + '</span></td><td><span class="q-arrow">›</span></td></tr>';
    }).join('') || '<tr><td colspan="7"><span class="t-muted">Долгов перед поставщиками нет.</span></td></tr>';
  }

  function renderRecon() {
    document.getElementById('reconBody').innerHTML = reconciliations.map((r) => {
      const m = reconMeta(r.status);
      return '<tr class="clickable" data-pur-recon="' + r.id + '"><td><span class="t-id">' + r.id + '</span></td><td><span class="t-type" style="font-size:11px;font-weight:550">' + supById(r.supplier).name + '</span></td><td><span class="t-muted">' + r.period + '</span></td><td class="num-r"><span class="cmp-val">' + nf.format(r.turnover) + ' ₽</span></td><td class="num-r"><span class="' + (r.balance ? 'var-neg' : 't-muted') + '">' + nf.format(r.balance) + ' ₽</span></td><td><span class="pill ' + m.cls + '"><i></i>' + m.label + '</span></td><td><span class="t-muted">' + r.date + '</span></td></tr>';
    }).join('');
  }

  function renderBank() {
    document.getElementById('bankBody').innerHTML = bankRows.map((b) => (
      '<tr><td><span class="t-muted">' + b.date + '</span></td><td><span class="t-type" style="font-size:11px;font-weight:550">' + b.party + '</span></td><td><span class="t-muted">' + b.purpose + '</span></td><td class="num-r"><span class="t-money">' + nf.format(b.amount) + ' ₽</span></td><td><span class="pill ' + b.cls + '"><i></i>' + b.match + '</span></td><td><button class="card-link" data-toast="Демо: сопоставление появится после подключения банка">Связать</button></td></tr>'
    )).join('');
  }

  function renderPurchases() {
    renderPurchasesOverview();
    renderInvoices();
    renderSuppliers();
    renderPayments();
    renderSettlements();
    renderRecon();
    renderBank();
  }

  function setPurTab(tab) {
    purTab = tab;
    document.querySelectorAll('[data-pur-tab]').forEach((b) => b.classList.toggle('is-on', b.dataset.purTab === tab));
    document.querySelectorAll('[data-pur-panel]').forEach((p) => { p.hidden = p.dataset.purPanel !== tab; });
    document.querySelector('.content').scrollTop = 0;
  }

  document.getElementById('purTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pur-tab]');
    if (b) setPurTab(b.dataset.purTab);
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pur-tab]');
    if (b && !b.closest('#purTabs')) { e.preventDefault(); setPurTab(b.dataset.purTab); }
  });
  document.getElementById('invoiceChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-inv-filter]');
    if (!b) return;
    invoiceFilter = b.dataset.invFilter;
    renderInvoices();
  });
  document.getElementById('invoiceSearch').addEventListener('input', (e) => { invoiceQuery = e.target.value.trim(); renderInvoices(); });
  document.getElementById('supplierChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sup-filter]');
    if (!b) return;
    supplierFilter = b.dataset.supFilter;
    renderSuppliers();
  });
  document.getElementById('supplierSearch').addEventListener('input', (e) => { supplierQuery = e.target.value.trim(); renderSuppliers(); });
  document.getElementById('newInvoiceBtn').addEventListener('click', () => openInvoice(null));
  document.getElementById('newInvoiceBtn2').addEventListener('click', () => openInvoice(null));
  document.getElementById('newSupplierBtn').addEventListener('click', () => openSupplier(null));
  document.getElementById('newPaymentBtn').addEventListener('click', () => openPayment());
  document.getElementById('newReconBtn').addEventListener('click', () => openRecon(null));
  document.addEventListener('click', (e) => {
    const inv = e.target.closest('[data-pur-invoice]');
    if (inv) { openInvoice(inv.dataset.purInvoice); return; }
    const sup = e.target.closest('[data-pur-supplier]');
    if (sup) { openSupplier(sup.dataset.purSupplier); return; }
    const rec = e.target.closest('[data-pur-recon]');
    if (rec) { openRecon(rec.dataset.purRecon); }
  });

  /* invoice drawer */
  let invoiceEditId = null;
  let invoiceDraft = null;
  function openInvoice(id) {
    invoiceEditId = id;
    const inv = id ? invById(id) : null;
    invoiceDraft = inv
      ? { supplier: inv.supplier, point: inv.point, date: inv.date, due: inv.due, dueIn: inv.dueIn, paid: inv.paid, received: inv.received, lines: inv.items.map((x) => ({ item: x.item, qty: x.qty, price: x.price })) }
      : { supplier: suppliers[0].id, point: 'Покровка', date: '18 окт 2026', due: '1 ноя 2026', dueIn: 14, paid: 0, received: true, lines: [{ item: 'coffee', qty: 5, price: 1200 }, { item: 'milk', qty: 20, price: 90 }] };
    renderInvoiceDrawer();
    closeAll();
    document.getElementById('invoiceDrawer').classList.add('is-on');
    syncScrim();
  }
  function invSum() { return invoiceDraft.lines.reduce((s, l) => s + l.qty * l.price, 0); }
  function renderInvoiceDrawer() {
    const inv = invoiceEditId ? invById(invoiceEditId) : null;
    const st = inv ? invoiceStatus(inv) : { label: 'новая', cls: 'gray' };
    document.getElementById('invoiceKicker').textContent = inv ? st.label : 'приёмка';
    document.getElementById('invoiceTitle').textContent = inv ? inv.id : 'Новая накладная';
    document.getElementById('invoiceMeta').textContent = (inv ? inv.date + ' · ' : '') + supById(invoiceDraft.supplier).name;
    const body = document.getElementById('invoiceBody');
    const foot = document.getElementById('invoiceFoot');
    if (!inv) {
      body.innerHTML =
        '<div class="pd-grid"><label class="field"><span>Контрагент</span><select id="invSupplier">' + suppliers.filter((s) => s.status === 'active').map((s) => '<option value="' + s.id + '"' + (s.id === invoiceDraft.supplier ? ' selected' : '') + '>' + s.name + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Точка</span><select id="purInvPoint">' + stockPoints.map((p) => '<option' + (p === invoiceDraft.point ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Дата</span><input id="invDate" value="' + invoiceDraft.date + '"></label>' +
        '<label class="field"><span>Срок оплаты</span><input id="invDue" value="' + invoiceDraft.due + '"></label></div>' +
        '<button class="card-link" id="qsToggle" style="margin-top:8px">+ Новый контрагент</button>' +
        '<div class="quick-sup" id="qsForm" hidden><div style="font-size:10px;font-weight:650">Быстрое создание контрагента</div><div class="row"><input id="qsName" placeholder="Название"><input id="qsInn" placeholder="ИНН"></div><div class="row"><button class="btn btn-primary btn-sm" id="qsAdd">Добавить</button><button class="btn btn-ghost btn-sm" id="qsCancel">Отмена</button></div></div>' +
        '<div class="pd-sec-head" style="margin-top:14px"><h3>Позиции</h3><button class="card-link" id="invAddLine">+ Позиция</button></div>' +
        '<div class="pur-line-head"><span>Товар</span><span>Кол-во</span><span>Ед.</span><span>Цена</span><span>Сумма</span><span></span></div>' +
        '<div id="invLines"></div>' +
        '<div class="pur-summary"><div><span>Сумма</span><b id="invTotal">0 ₽</b></div><div><span>Оплачено сразу</span><b><input id="invPaid" type="number" min="0" step="1" value="' + invoiceDraft.paid + '" style="width:100%;height:26px;border:1px solid var(--line);border-radius:5px;padding:0 5px;font-family:var(--mono);font-size:12px"></b></div><div><span>Долг</span><b id="invDebt" class="red">0 ₽</b></div></div>' +
        '<label class="pur-check"><input type="checkbox" class="check" id="invReceived"' + (invoiceDraft.received ? ' checked' : '') + '> Принять на склад: увеличить остатки</label>' +
        '<p class="pd-note">Накладная — это и товар, и деньги. После проведения она появится в приходах склада, а долг — во взаиморасчётах.</p>';
      foot.innerHTML = '<button class="btn btn-ghost" id="purInvCancel">Закрыть</button><button class="btn btn-primary" id="purInvSave">Провести накладную</button>';
      renderInvLines();
      updateInvoiceTotal();
    } else {
      const debt = invoiceDebt(inv);
      const paidList = purchasePayments.filter((p) => p.invoices.indexOf(inv.id) > -1);
      body.innerHTML =
        '<div class="pur-summary"><div><span>Сумма</span><b>' + nf.format(inv.amount) + ' ₽</b></div><div><span>Оплачено</span><b class="green">' + nf.format(inv.paid) + ' ₽</b></div><div><span>Долг</span><b class="red">' + nf.format(debt) + ' ₽</b></div></div>' +
        (debt > 0 && inv.dueIn < 0 ? aiCardHTML({ id: 'ai-inv-' + inv.id, sev: 'urgent', title: 'Просрочено на ' + Math.abs(inv.dueIn) + ' дн.', why: supById(inv.supplier).name + ' · долг ' + nf.format(debt) + ' ₽', primary: { label: 'Создать оплату', action: 'draft-pay', invoice: inv.id } }, 'compact') : '') +
        '<div class="dl" style="margin-bottom:14px"><dt>Контрагент</dt><dd><button class="card-link" data-pur-supplier="' + inv.supplier + '">' + supById(inv.supplier).name + ' →</button></dd><dt>Точка</dt><dd>' + inv.point + '</dd><dt>Дата / срок</dt><dd>' + inv.date + ' · до ' + inv.due + '</dd><dt>Статус</dt><dd><span class="pill ' + invoiceStatus(inv).cls + '"><i></i>' + invoiceStatus(inv).label + '</span></dd></div>' +
        '<div class="pd-sec-head"><h3>Позиции</h3></div><div class="pur-items-static">' + inv.items.map((x) => { const it = itemById(x.item); return '<div class="pur-item-row"><span class="q">' + fmtQ(x.qty) + ' ' + (it ? it.unit : '') + '</span><span class="n">' + (it ? it.name : x.item) + '</span><span class="s">' + nf.format(x.qty * x.price) + ' ₽</span></div>'; }).join('') + '</div>' +
        '<div class="pd-sec"><div class="pd-sec-head"><h3>Склад</h3></div><div class="' + (inv.received ? 'inv-diff good' : 'inv-diff warn') + '" style="margin:0">' + (inv.received ? 'Принято на склад · остаток увеличен' : 'Ожидает приёмки · остаток ещё не увеличен') + '</div>' + (!inv.received ? '<button class="btn btn-ghost btn-sm" id="purInvReceive" style="margin-top:8px">Принять на склад</button>' : '') + '</div>' +
        '<div class="pd-sec"><div class="pd-sec-head"><h3>Оплаты</h3></div>' + (paidList.length ? '<div class="pay-timeline">' + paidList.map((p) => '<div class="pay-row"><span class="id">' + p.id + '</span><span>' + p.date + ' · ' + p.method + '</span><span class="amt">' + nf.format(p.amount) + ' ₽</span></div>').join('') + '</div>' : '<p class="pd-note">Оплат по накладной пока нет.</p>') + '</div>';
      foot.innerHTML = '<button class="btn btn-ghost" id="purInvCancel">Закрыть</button>' + (debt > 0 ? '<button class="btn btn-primary" id="purInvPay">Оплатить ' + nf.format(debt) + ' ₽</button>' : '<button class="btn btn-primary" disabled>Оплачена</button>');
    }
  }
  function renderInvLines() {
    const box = document.getElementById('invLines');
    if (!box) return;
    box.innerHTML = invoiceDraft.lines.map((l, i) => {
      const it = itemById(l.item);
      return '<div class="pur-line"><select data-inv-item="' + i + '">' + stockItems.map((o) => '<option value="' + o.id + '"' + (o.id === l.item ? ' selected' : '') + '>' + o.name + '</option>').join('') + '</select>' +
        '<input data-inv-qty="' + i + '" type="number" min="0" step="0.01" value="' + l.qty + '">' +
        '<span class="u">' + (it ? it.unit : '') + '</span>' +
        '<input data-inv-price="' + i + '" type="number" min="0" step="1" value="' + l.price + '">' +
        '<span class="sum" data-inv-sum="' + i + '">' + nf.format(l.qty * l.price) + ' ₽</span>' +
        '<button class="rm" data-inv-rm="' + i + '">×</button></div>';
    }).join('');
  }
  function updateInvoiceTotal() {
    if (!invoiceDraft || invoiceEditId) return;
    const total = invSum();
    const paidEl = document.getElementById('invPaid');
    const paid = paidEl ? Math.max(0, Number(paidEl.value) || 0) : 0;
    const totalEl = document.getElementById('invTotal');
    const debtEl = document.getElementById('invDebt');
    if (totalEl) totalEl.textContent = nf.format(Math.round(total)) + ' ₽';
    if (debtEl) debtEl.textContent = nf.format(Math.max(0, Math.round(total - paid))) + ' ₽';
    invoiceDraft.lines.forEach((l, i) => {
      const s = document.querySelector('[data-inv-sum="' + i + '"]');
      if (s) s.textContent = nf.format(l.qty * l.price) + ' ₽';
    });
  }
  document.getElementById('invoiceBody').addEventListener('input', (e) => {
    const q = e.target.dataset.invQty, p = e.target.dataset.invPrice, paid = e.target.id === 'invPaid';
    if (q !== undefined) { invoiceDraft.lines[Number(q)].qty = Math.max(0, Number(e.target.value) || 0); updateInvoiceTotal(); }
    if (p !== undefined) { invoiceDraft.lines[Number(p)].price = Math.max(0, Number(e.target.value) || 0); updateInvoiceTotal(); }
    if (paid) { invoiceDraft.paid = Math.max(0, Number(e.target.value) || 0); updateInvoiceTotal(); }
  });
  document.getElementById('invoiceBody').addEventListener('change', (e) => {
    const item = e.target.dataset.invItem;
    if (item !== undefined) {
      const it = itemById(e.target.value);
      invoiceDraft.lines[Number(item)].item = e.target.value;
      invoiceDraft.lines[Number(item)].price = it.cost;
      renderInvLines();
      updateInvoiceTotal();
    }
    if (e.target.id === 'invSupplier') invoiceDraft.supplier = e.target.value;
    if (e.target.id === 'purInvPoint') invoiceDraft.point = e.target.value;
    if (e.target.id === 'invDate') invoiceDraft.date = e.target.value;
    if (e.target.id === 'invDue') invoiceDraft.due = e.target.value;
    if (e.target.id === 'invReceived') invoiceDraft.received = e.target.checked;
  });
  document.getElementById('invoiceBody').addEventListener('click', (e) => {
    if (e.target.closest('#invAddLine')) {
      invoiceDraft.lines.push({ item: stockItems[0].id, qty: 1, price: stockItems[0].cost });
      renderInvLines(); updateInvoiceTotal(); return;
    }
    const rm = e.target.closest('[data-inv-rm]');
    if (rm) { invoiceDraft.lines.splice(Number(rm.dataset.invRm), 1); renderInvLines(); updateInvoiceTotal(); return; }
    if (e.target.closest('#qsToggle')) { document.getElementById('qsForm').hidden = false; return; }
    if (e.target.closest('#qsCancel')) { document.getElementById('qsForm').hidden = true; return; }
    if (e.target.closest('#qsAdd')) {
      const name = document.getElementById('qsName').value.trim();
      if (!name) { document.getElementById('qsName').focus(); return; }
      const id = 's' + (suppliers.length + 1);
      suppliers.push({ id, name, legal: name, type: 'Юрлицо', inn: document.getElementById('qsInn').value || '—', kpp: '', ogrn: '', phone: '', email: '', legalAddr: '', addr: '', contact: '', delay: 7, status: 'active', bank: '', rs: '', bik: '', ks: '', comment: 'Создан из накладной' });
      invoiceDraft.supplier = id;
      renderInvoiceDrawer();
      toast('Контрагент «' + name + '» создан и выбран');
      return;
    }
    if (e.target.closest('#purInvReceive')) {
      receiveInvoice(invById(invoiceEditId));
      renderInvoiceDrawer();
      return;
    }
  });
  document.getElementById('invoiceFoot').addEventListener('click', (e) => {
    if (e.target.id === 'purInvCancel') { document.getElementById('invoiceDrawer').classList.remove('is-on'); syncScrim(); }
    if (e.target.id === 'purInvPay') { const inv = invById(invoiceEditId); openPayment(inv.supplier, inv.id); }
    if (e.target.id === 'purInvSave') {
      const lines = invoiceDraft.lines.filter((l) => l.qty > 0);
      if (!lines.length) { toast('Добавьте хотя бы одну позицию'); return; }
      const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
      const paid = Math.min(total, Math.max(0, Number(document.getElementById('invPaid').value) || 0));
      const id = 'ПР-' + String(242 + invoices.length - 8).padStart(4, '0');
      const inv = { id, date: invoiceDraft.date, due: invoiceDraft.due, dueIn: invoiceDraft.dueIn, supplier: invoiceDraft.supplier, point: invoiceDraft.point, amount: total, paid, received: invoiceDraft.received, items: lines.map((l) => ({ item: l.item, qty: l.qty, price: l.price })) };
      invoices.unshift(inv);
      if (inv.received) receiveInvoice(inv);
      if (paid > 0) {
        purchasePayments.unshift({ id: 'ОП-' + String(121 + purchasePayments.length - 5).padStart(4, '0'), date: invoiceDraft.date, supplier: invoiceDraft.supplier, amount: paid, method: 'При поставке', invoices: [id], status: 'Проведён' });
      }
      document.getElementById('invoiceDrawer').classList.remove('is-on');
      syncScrim();
      renderPurchases();
      toast('Накладная проведена · долг обновлён');
    }
  });
  function receiveInvoice(inv) {
    if (!inv || inv.received && inv.stockReceived) return;
    inv.items.forEach((l) => {
      const it = itemById(l.item);
      if (it && it.balances[inv.point]) it.balances[inv.point].opening += l.qty;
    });
    inv.received = true;
    inv.stockReceived = true;
    if (typeof receipts !== 'undefined') {
      receipts.unshift({ id: inv.id, date: inv.date, point: inv.point, supplier: supById(inv.supplier).name, positions: inv.items.length, amount: inv.amount, status: 'Проведён' });
      renderStock();
    }
    toast('Принято на склад · остаток увеличен');
  }

  /* payment drawer */
  let payDraft = null;
  function openPayment(supplierId, invoiceId) {
    const fallback = suppliers.find((s) => supplierDebt(s.id) > 0) || suppliers[0];
    const sid = supplierId || fallback.id;
    payDraft = { supplier: sid, amount: 0, date: '18 окт 2026', method: 'Банк', selected: invoiceId ? [invoiceId] : [] };
    const debt = invoices.filter((i) => i.supplier === sid && invoiceDebt(i) > 0);
    payDraft.amount = debt.filter((i) => payDraft.selected.indexOf(i.id) > -1).reduce((s, i) => s + invoiceDebt(i), 0);
    renderPaymentDrawer();
    closeAll();
    document.getElementById('paymentDrawer').classList.add('is-on');
    syncScrim();
  }
  function renderPaymentDrawer() {
    const body = document.getElementById('paymentBody');
    const foot = document.getElementById('paymentFoot');
    const debtInvoices = invoices.filter((i) => i.supplier === payDraft.supplier && invoiceDebt(i) > 0);
    body.innerHTML =
      '<div class="pd-grid"><label class="field"><span>Контрагент</span><select id="paySupplier">' + suppliers.filter((s) => s.status === 'active').map((s) => '<option value="' + s.id + '"' + (s.id === payDraft.supplier ? ' selected' : '') + '>' + s.name + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Дата</span><input id="payDate" value="' + payDraft.date + '"></label>' +
      '<label class="field"><span>Сумма, ₽</span><input id="payAmount" type="number" min="0" step="1" value="' + Math.round(payDraft.amount) + '"></label>' +
      '<label class="field"><span>Способ</span><select id="payMethod"><option>Банк</option><option>Карта</option><option>Наличные</option></select></label></div>' +
      '<div class="pd-sec-head" style="margin-top:14px"><h3>Закрыть накладные</h3><span class="st-week-count">' + debtInvoices.length + ' с долгом</span></div>' +
      '<div class="pay-alloc">' + (debtInvoices.length ? debtInvoices.map((i) => '<label class="alloc-row"><input type="checkbox" class="check" data-alloc="' + i.id + '"' + (payDraft.selected.indexOf(i.id) > -1 ? ' checked' : '') + '><span class="info"><span class="id">' + i.id + ' · ' + i.date + '</span>' + supById(i.supplier).name + '</span><span class="debt">' + nf.format(invoiceDebt(i)) + ' ₽</span></label>').join('') : '<p class="pd-note">У контрагента нет накладных с долгом.</p>') + '</div>' +
      '<div class="pay-total"><span>Оплата распределится по выбранным накладным</span><b id="payTotal">' + nf.format(payDraft.amount) + ' ₽</b></div>' +
      '<p class="pd-note">Оплата без привязки к накладной не закроет долг. Сумма распределяется по порядку выбранных документов.</p>';
    foot.innerHTML = '<button class="btn btn-ghost" id="payCancel">Закрыть</button><button class="btn btn-primary" id="paySave">Провести оплату</button>';
  }
  document.getElementById('paymentBody').addEventListener('input', (e) => {
    if (e.target.id === 'payAmount') { payDraft.amount = Math.max(0, Number(e.target.value) || 0); const t = document.getElementById('payTotal'); if (t) t.textContent = nf.format(payDraft.amount) + ' ₽'; }
    if (e.target.id === 'payDate') payDraft.date = e.target.value;
  });
  document.getElementById('paymentBody').addEventListener('change', (e) => {
    if (e.target.id === 'paySupplier') {
      payDraft.supplier = e.target.value;
      payDraft.selected = [];
      payDraft.amount = 0;
      renderPaymentDrawer();
    }
    if (e.target.id === 'payMethod') payDraft.method = e.target.value;
    const alloc = e.target.dataset.alloc;
    if (alloc) {
      const idx = payDraft.selected.indexOf(alloc);
      if (e.target.checked) { if (idx === -1) payDraft.selected.push(alloc); } else if (idx > -1) payDraft.selected.splice(idx, 1);
      payDraft.amount = invoices.filter((i) => payDraft.selected.indexOf(i.id) > -1).reduce((s, i) => s + invoiceDebt(i), 0);
      const amountInput = document.getElementById('payAmount');
      if (amountInput) amountInput.value = Math.round(payDraft.amount);
      const t = document.getElementById('payTotal');
      if (t) t.textContent = nf.format(payDraft.amount) + ' ₽';
    }
  });
  document.getElementById('paymentFoot').addEventListener('click', (e) => {
    if (e.target.id === 'payCancel') { document.getElementById('paymentDrawer').classList.remove('is-on'); syncScrim(); }
    if (e.target.id === 'paySave') {
      if (!payDraft.selected.length) { toast('Выберите накладную'); return; }
      if (payDraft.amount <= 0) { toast('Введите сумму оплаты'); return; }
      let left = payDraft.amount;
      const ids = payDraft.selected.slice();
      ids.forEach((id) => {
        const inv = invById(id);
        if (!inv || left <= 0) return;
        const debt = invoiceDebt(inv);
        const part = Math.min(debt, left);
        inv.paid += part;
        left -= part;
      });
      purchasePayments.unshift({ id: 'ОП-' + String(121 + purchasePayments.length - 5).padStart(4, '0'), date: payDraft.date, supplier: payDraft.supplier, amount: payDraft.amount, method: payDraft.method, invoices: ids, status: 'Проведён' });
      document.getElementById('paymentDrawer').classList.remove('is-on');
      syncScrim();
      renderPurchases();
      toast('Оплата проведена · долг обновлён');
    }
  });

  /* supplier drawer */
  let supEditId = null;
  let supTab = 'requisites';
  let supDraft = null;
  function openSupplier(id) {
    supEditId = id;
    supTab = 'requisites';
    const existing = id ? supById(id) : null;
    supDraft = existing ? Object.assign({}, existing) : {
      name: '', legal: '', type: 'Юрлицо', inn: '', kpp: '', ogrn: '', phone: '', email: '',
      legalAddr: '', addr: '', contact: '', delay: 7, status: 'active', bank: '', rs: '', bik: '', ks: '', comment: ''
    };
    renderSupplierDrawer();
    closeAll();
    document.getElementById('supplierDrawer').classList.add('is-on');
    syncScrim();
  }
  function renderSupplierDrawer() {
    const s = supEditId ? supById(supEditId) : null;
    const name = supDraft.name || 'Новый контрагент';
    document.getElementById('supplierKicker').textContent = s ? 'поставщик' : 'новый';
    document.getElementById('supplierTitle').textContent = name;
    document.getElementById('supplierMeta').textContent = (supDraft.inn ? 'ИНН ' + supDraft.inn + ' · ' : '') + 'отсрочка ' + supDraft.delay + ' дней';
    const body = document.getElementById('supplierBody');
    const foot = document.getElementById('supplierFoot');
    const req = supDraft;
    const tabs = s ? '<div class="sup-tabs">' + [['requisites', 'Реквизиты'], ['invoices', 'Накладные'], ['payments', 'Оплаты'], ['settlements', 'Взаиморасчёты'], ['recon', 'Сверки']].map(([k, l]) => '<button data-sup-tab="' + k + '"' + (supTab === k ? ' class="is-on"' : '') + '>' + l + '</button>').join('') + '</div>' : '';
    if (!s || supTab === 'requisites') {
      body.innerHTML = tabs +
        '<div class="req-grid">' +
        fieldHTML('Название', 'name', req.name, 'pd-span2') +
        fieldHTML('Юр. название', 'legal', req.legal, 'pd-span2') +
        '<label class="field"><span>Тип</span><select data-sup="type"><option' + (req.type === 'Юрлицо' ? ' selected' : '') + '>Юрлицо</option><option' + (req.type === 'ИП' ? ' selected' : '') + '>ИП</option><option' + (req.type === 'Физлицо' ? ' selected' : '') + '>Физлицо</option></select></label>' +
        fieldHTML('ИНН', 'inn', req.inn) + fieldHTML('КПП', 'kpp', req.kpp) + fieldHTML('ОГРН / ОГРНИП', 'ogrn', req.ogrn) +
        fieldHTML('Телефон', 'phone', req.phone) + fieldHTML('E-mail', 'email', req.email) +
        fieldHTML('Юр. адрес', 'legalAddr', req.legalAddr, 'pd-span2') + fieldHTML('Фактический адрес', 'addr', req.addr, 'pd-span2') +
        fieldHTML('Контактное лицо', 'contact', req.contact) + fieldHTML('Отсрочка, дней', 'delay', req.delay) +
        '<label class="field"><span>Статус</span><select data-sup="status"><option value="active"' + (req.status === 'active' ? ' selected' : '') + '>Активен</option><option value="archive"' + (req.status === 'archive' ? ' selected' : '') + '>Архив</option></select></label>' +
        '</div>' +
        '<div class="sup-sec-title">Как платить</div>' +
        '<div class="req-grid">' + fieldHTML('Банк', 'bank', req.bank, 'pd-span2') + fieldHTML('Расчётный счёт', 'rs', req.rs, 'pd-span2') + fieldHTML('БИК', 'bik', req.bik) + fieldHTML('Корр. счёт', 'ks', req.ks) + '</div>' +
        '<div class="sup-sec-title">Условия</div>' + fieldHTML('Комментарий к оплате', 'comment', req.comment, 'pd-span2');
    } else if (supTab === 'invoices') {
      const list = invoices.filter((i) => i.supplier === s.id);
      body.innerHTML = tabs + '<div class="sup-balance"><span>Долг</span><b>' + nf.format(supplierDebt(s.id)) + ' ₽</b><span>· ' + list.length + ' накладных</span></div><div class="sup-list">' + list.map((i) => '<button class="sup-list-row" data-pur-invoice="' + i.id + '"><span>' + i.id + '</span><span class="muted">' + i.date + '</span><span class="r">' + nf.format(invoiceDebt(i)) + ' ₽</span><span class="pill ' + invoiceStatus(i).cls + '"><i></i>' + invoiceStatus(i).label + '</span></button>').join('') + '</div>';
    } else if (supTab === 'payments') {
      const list = purchasePayments.filter((p) => p.supplier === s.id);
      body.innerHTML = tabs + '<div class="sup-list">' + (list.length ? list.map((p) => '<div class="sup-list-row"><span>' + p.id + '</span><span class="muted">' + p.date + ' · ' + p.method + '</span><span class="r">' + nf.format(p.amount) + ' ₽</span></div>').join('') : '<p class="pd-note">Оплат нет.</p>') + '</div>';
    } else if (supTab === 'settlements') {
      const list = invoices.filter((i) => i.supplier === s.id).map((i) => ({ date: i.date, type: 'Накладная ' + i.id, amount: i.amount })).concat(purchasePayments.filter((p) => p.supplier === s.id).map((p) => ({ date: p.date, type: 'Оплата ' + p.id, amount: -p.amount })));
      const debt = supplierDebt(s.id);
      const target = invoices.filter((i) => i.supplier === s.id && invoiceDebt(i) > 0).sort((a, b) => a.dueIn - b.dueIn)[0];
      body.innerHTML = tabs +
        (debt > 0 && target ? aiCardHTML({ id: 'ai-sup-' + s.id, sev: supplierOverdue(s.id) ? 'urgent' : 'warn', title: supplierOverdue(s.id) ? 'Есть просроченный долг' : 'Долг перед поставщиком', why: 'Ближайшая накладная ' + target.id + ' · ' + nf.format(invoiceDebt(target)) + ' ₽', primary: { label: 'Создать оплату', action: 'draft-pay', invoice: target.id } }, 'compact') : '') +
        '<div class="sup-balance"><span>Баланс</span><b>' + nf.format(debt) + ' ₽</b><span>накладные − оплаты</span></div><div class="sup-list" style="margin-top:9px">' + list.map((m) => '<div class="sup-list-row"><span class="muted">' + m.date + '</span><span>' + m.type + '</span><span class="r">' + nf.format(m.amount) + ' ₽</span></div>').join('') + '</div>';
    } else {
      const list = reconciliations.filter((r) => r.supplier === s.id);
      body.innerHTML = tabs + '<div class="sup-list">' + (list.length ? list.map((r) => '<button class="sup-list-row" data-pur-recon="' + r.id + '"><span>' + r.id + '</span><span class="muted">' + r.period + '</span><span class="r">' + nf.format(r.balance) + ' ₽</span><span class="pill ' + reconMeta(r.status).cls + '"><i></i>' + reconMeta(r.status).label + '</span></button>').join('') : '<p class="pd-note">Актов сверки нет.</p>') + '</div>';
    }
    foot.innerHTML = '<button class="btn btn-ghost" id="supCancel">Закрыть</button><button class="btn btn-primary" id="supSave">' + (s ? 'Сохранить' : 'Создать контрагента') + '</button>';
  }
  function fieldHTML(label, key, value, cls) {
    return '<label class="field ' + (cls || '') + '"><span>' + label + '</span><input data-sup="' + key + '" value="' + esc(String(value || '')) + '"></label>';
  }
  document.getElementById('supplierBody').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-sup-tab]');
    if (tab) { supTab = tab.dataset.supTab; renderSupplierDrawer(); }
  });
  document.getElementById('supplierBody').addEventListener('input', (e) => {
    const k = e.target.dataset.sup;
    if (k) supDraft[k] = e.target.value;
  });
  document.getElementById('supplierBody').addEventListener('change', (e) => {
    const k = e.target.dataset.sup;
    if (k) supDraft[k] = e.target.value;
  });
  document.getElementById('supplierFoot').addEventListener('click', (e) => {
    if (e.target.id === 'supCancel') { document.getElementById('supplierDrawer').classList.remove('is-on'); syncScrim(); }
    if (e.target.id === 'supSave') {
      const vals = {};
      document.querySelectorAll('#supplierBody [data-sup]').forEach((el) => { vals[el.dataset.sup] = el.value; });
      Object.assign(supDraft, vals);
      if (!supDraft.name) { toast('Введите название контрагента'); return; }
      supDraft.delay = Number(supDraft.delay) || 0;
      if (supEditId) {
        Object.assign(supById(supEditId), supDraft);
      } else {
        suppliers.push(Object.assign({ id: 's' + (suppliers.length + 1) }, supDraft));
      }
      document.getElementById('supplierDrawer').classList.remove('is-on');
      syncScrim();
      renderPurchases();
      toast(supEditId ? 'Контрагент сохранён' : 'Контрагент создан');
    }
  });

  /* reconciliation drawer */
  let reconEditId = null;
  let reconDraft = null;
  function openRecon(id, supplierId) {
    reconEditId = id;
    const r = id ? reconciliations.find((x) => x.id === id) : null;
    reconDraft = r ? { supplier: r.supplier, period: r.period, status: r.status } : { supplier: supplierId || suppliers[0].id, period: 'Октябрь 2026', status: 'draft' };
    renderReconDrawer();
    closeAll();
    document.getElementById('reconDrawer').classList.add('is-on');
    syncScrim();
  }
  function reconTotals() {
    const invSum = invoices.filter((i) => i.supplier === reconDraft.supplier).reduce((s, i) => s + i.amount, 0);
    const paySum = purchasePayments.filter((p) => p.supplier === reconDraft.supplier).reduce((s, p) => s + p.amount, 0);
    return { invSum, paySum, balance: invSum - paySum };
  }
  function renderReconDrawer() {
    const r = reconEditId ? reconciliations.find((x) => x.id === reconEditId) : null;
    const t = r ? { invSum: r.turnover, paySum: r.turnover - r.balance, balance: r.balance } : reconTotals();
    document.getElementById('reconKicker').textContent = r ? reconMeta(r.status).label.toLowerCase() : 'новый';
    document.getElementById('reconTitle').textContent = r ? r.id : 'Акт сверки';
    document.getElementById('reconMeta').textContent = supById(reconDraft.supplier).name + ' · ' + reconDraft.period;
    document.getElementById('reconDrawerBody').innerHTML =
      '<div class="recon-grid"><label class="field"><span>Контрагент</span><select id="reconSupplier">' + suppliers.filter((s) => s.status === 'active').map((s) => '<option value="' + s.id + '"' + (s.id === reconDraft.supplier ? ' selected' : '') + '>' + s.name + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Период</span><input id="reconPeriod" value="' + esc(reconDraft.period) + '"></label></div>' +
      '<div class="recon-big"><div><span>Накладные</span><b>' + nf.format(t.invSum) + ' ₽</b></div><div><span>Оплаты</span><b>' + nf.format(t.paySum) + ' ₽</b></div><div><span>Баланс</span><b style="color:' + (t.balance ? 'var(--red)' : 'var(--green)') + '">' + nf.format(t.balance) + ' ₽</b></div></div>' +
      '<div class="sup-sec-title">Статус сверки</div><div class="recon-status-row">' + [['draft', 'Черновик'], ['sent', 'Отправлен'], ['agreed', 'Согласован'], ['mismatch', 'Расхождение']].map(([k, l]) => '<button data-recon-status="' + k + '"' + (reconDraft.status === k ? ' class="is-on"' : '') + '>' + l + '</button>').join('') + '</div>' +
      '<div class="recon-note">' + (t.balance ? 'Обороты не сходятся: баланс ' + nf.format(t.balance) + ' ₽. Расхождение фиксируется, но не меняет долг автоматически.' : 'Обороты сходятся. Можно отправлять контрагенту на согласование.') + '</div>';
    document.getElementById('reconFoot').innerHTML = '<button class="btn btn-ghost" id="reconCancel">Закрыть</button><button class="btn btn-primary" id="reconSave">' + (r ? 'Сохранить' : 'Создать акт') + '</button>';
  }
  document.getElementById('reconDrawerBody').addEventListener('change', (e) => {
    if (e.target.id === 'reconSupplier') { reconDraft.supplier = e.target.value; renderReconDrawer(); }
    if (e.target.id === 'reconPeriod') reconDraft.period = e.target.value;
  });
  document.getElementById('reconDrawerBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-recon-status]');
    if (b) { reconDraft.status = b.dataset.reconStatus; renderReconDrawer(); }
  });
  document.getElementById('reconFoot').addEventListener('click', (e) => {
    if (e.target.id === 'reconCancel') { document.getElementById('reconDrawer').classList.remove('is-on'); syncScrim(); }
    if (e.target.id === 'reconSave') {
      const t = reconTotals();
      if (reconEditId) {
        Object.assign(reconciliations.find((x) => x.id === reconEditId), { supplier: reconDraft.supplier, period: reconDraft.period, status: reconDraft.status, turnover: t.invSum, balance: t.balance });
      } else {
        reconciliations.unshift({ id: 'СВ-' + String(44 + reconciliations.length - 4).padStart(4, '0'), supplier: reconDraft.supplier, period: reconDraft.period, turnover: t.invSum, balance: t.balance, status: reconDraft.status, date: '18 окт' });
      }
      document.getElementById('reconDrawer').classList.remove('is-on');
      syncScrim();
      renderPurchases();
      toast('Акт сверки сохранён');
    }
  });

  /* drawer close buttons */
  [['invoiceClose', 'invoiceDrawer'], ['supplierClose', 'supplierDrawer'], ['paymentClose', 'paymentDrawer'], ['reconClose', 'reconDrawer']].forEach(([btn, drawer]) => {
    const b = document.getElementById(btn);
    if (b) b.addEventListener('click', () => { document.getElementById(drawer).classList.remove('is-on'); syncScrim(); });
  });

  renderPurchases();

  /* ---------------- orders & supplier returns ---------------- */
  const orderStatus = {
    draft: { label: 'Черновик', cls: 'gray' },
    confirmed: { label: 'Подтверждён', cls: 'navy' },
    sent: { label: 'Отправлен', cls: 'amber' },
    partial: { label: 'Частично принят', cls: 'amber' },
    closed: { label: 'Закрыт', cls: 'green' }
  };
  const returnStatus = {
    draft: { label: 'Черновик', cls: 'gray' },
    shipped: { label: 'Отгружен', cls: 'navy' },
    posted: { label: 'Проведён', cls: 'green' },
    cancelled: { label: 'Отменён', cls: 'red' }
  };
  let purchaseOrders = [
    { id: 'ЗК-0018', date: '17 окт', supplier: 's2', point: 'Покровка', delivery: '20 окт', status: 'sent', lines: [{ item: 'milk', qty: 60, price: 90 }, { item: 'vanilla', qty: 6, price: 800 }] },
    { id: 'ЗК-0017', date: '16 окт', supplier: 's1', point: 'Покровка', delivery: '24 окт', status: 'confirmed', lines: [{ item: 'coffee', qty: 10, price: 1200 }, { item: 'vanilla', qty: 3, price: 800 }] },
    { id: 'ЗК-0016', date: '15 окт', supplier: 's3', point: 'Арбат', delivery: '19 окт', status: 'partial', lines: [{ item: 'croissant', qty: 240, price: 45 }, { item: 'syrniki', qty: 30, price: 60 }] },
    { id: 'ЗК-0015', date: '14 окт', supplier: 's4', point: 'Депо', delivery: '18 окт', status: 'draft', lines: [{ item: 'matcha', qty: 5, price: 4200 }, { item: 'tea', qty: 6, price: 600 }] }
  ];
  let supplierReturns = [
    { id: 'ВЗ-0007', date: '17 окт', supplier: 's2', point: 'Покровка', basis: 'Срок', status: 'posted', lines: [{ item: 'milk', qty: 12, price: 90 }] },
    { id: 'ВЗ-0006', date: '15 окт', supplier: 's3', point: 'Арбат', basis: 'Брак', status: 'draft', lines: [{ item: 'croissant', qty: 12, price: 45 }] }
  ];
  let orderFilter = 'all';
  let orderHelperState = null;
  let orderId = null;
  let returnId = null;
  let returnDraft = null;

  function orderAmount(o) { return o.lines.reduce((s, l) => s + l.qty * l.price, 0); }
  function renderOrders() {
    const rows = purchaseOrders.filter((o) => orderFilter === 'all' || o.status === orderFilter);
    document.getElementById('ordersBody').innerHTML = rows.map((o) => {
      const st = orderStatus[o.status] || orderStatus.draft;
      return '<tr class="clickable" data-order="' + o.id + '"><td><span class="t-id">' + o.id + '</span><span class="t-sub">' + o.date + '</span></td><td><span class="t-type" style="font-size:11px;font-weight:550">' + supById(o.supplier).name + '</span></td><td><span class="t-muted">' + o.point + '</span></td><td><span class="t-muted">' + o.delivery + '</span></td><td class="num-r"><span class="t-money">' + nf.format(orderAmount(o)) + ' ₽</span></td><td><span class="pill ' + st.cls + '"><i></i>' + st.label + '</span></td><td class="num-r"><span class="t-num">' + o.lines.length + '</span></td><td><span class="q-arrow">›</span></td></tr>';
    }).join('');
    document.getElementById('ordersEmpty').style.display = rows.length ? 'none' : 'block';
    const c = document.getElementById('purOrderCount');
    if (c) c.textContent = purchaseOrders.length;
  }

  function renderReturns() {
    document.getElementById('returnsBody').innerHTML = supplierReturns.map((r) => {
      const st = returnStatus[r.status] || returnStatus.draft;
      return '<tr class="clickable" data-return="' + r.id + '"><td><span class="t-id">' + r.id + '</span></td><td><span class="t-muted">' + r.date + '</span></td><td><span class="t-type" style="font-size:11px;font-weight:550">' + supById(r.supplier).name + '</span></td><td><span class="t-muted">' + r.point + '</span></td><td><span class="t-muted">' + r.basis + '</span></td><td class="num-r"><span class="t-money">' + nf.format(r.lines.reduce((s, l) => s + l.qty * l.price, 0)) + ' ₽</span></td><td><span class="pill ' + st.cls + '"><i></i>' + st.label + '</span></td><td><span class="q-arrow">›</span></td></tr>';
    }).join('');
    document.getElementById('returnsEmpty').style.display = supplierReturns.length ? 'none' : 'block';
    const c = document.getElementById('purReturnCount');
    if (c) c.textContent = supplierReturns.length;
  }

  document.getElementById('orderFilters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-order-filter]');
    if (!b) return;
    orderFilter = b.dataset.orderFilter;
    document.querySelectorAll('#orderFilters .chip').forEach((x) => x.classList.toggle('is-on', x === b));
    renderOrders();
  });
  document.getElementById('ordersBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-order]');
    if (b) openOrder(b.dataset.order);
  });
  document.getElementById('returnsBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-return]');
    if (b) openReturn(b.dataset.return);
  });
  document.getElementById('calcOrderBtn').addEventListener('click', () => openOrderHelper('rules'));
  document.getElementById('manualOrderBtn').addEventListener('click', () => openOrderHelper('manual'));
  document.getElementById('newReturnBtn').addEventListener('click', () => openReturn(null));

  function needFor(item, point, horizon) {
    const stock = stockAgg(item, point).expected;
    const daily = item.daily || 0;
    const raw = daily * horizon * 1.15 + (item.min || 0) - stock;
    const mult = item.multiple || 1;
    return { stock, need: raw > 0 ? Math.ceil(raw / mult) * mult : 0 };
  }
  function openOrderHelper(mode) {
    const point = stockPoint === 'all' ? 'Покровка' : stockPoint;
    orderHelperState = { point, supplier: 's1', horizon: 3, mode: mode || 'rules' };
    closeAll();
    document.getElementById('orderHelper').classList.add('is-on');
    renderOrderHelper();
  }
  function renderOrderHelper() {
    const h = orderHelperState;
    const supplier = supById(h.supplier);
    const items = stockItems.filter((it) => it.defaultSupplier === h.supplier);
    const proposals = items.map((it) => {
      const n = needFor(it, h.point, h.horizon);
      const batches = getBatches(it, h.point);
      const burning = batches.filter((b) => b.days !== null && b.days <= 2).sort((a, b) => a.days - b.days)[0];
      const excluded = h.mode !== 'manual' && burning && n.stock >= (it.daily || 0) * 1.5;
      const need = h.mode === 'manual' ? 0 : n.need;
      const why = excluded ? 'Партия горит: сначала продать' : n.stock < (it.min || 0) ? 'Ниже минимума' : n.need ? 'Расход на ' + h.horizon + ' дн. + минимум' : 'Остатка хватает';
      return { item: it, stock: n.stock, need, why, excluded, burning };
    });
    const included = proposals.filter((p) => !p.excluded && (h.mode === 'manual' || p.need > 0));
    const excluded = proposals.filter((p) => p.excluded);
    document.getElementById('orderHelperCard').innerHTML =
      '<div class="inv-modal-head"><span class="ai-badge">ЗАКАЗ · ПОМОЩНИК</span><button class="ai-modal-close" id="orderHelperClose" aria-label="Закрыть">×</button></div>' +
      '<h3>Помощник заказа</h3><p>Считаем потребность по расходу, минимуму и остатку. Заказ не отправляется сам — только черновик.</p>' +
      '<div class="order-helper-controls"><label class="field"><span>Точка</span><select id="ohPoint">' + stockPoints.map((p) => '<option' + (p === h.point ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Поставщик</span><select id="ohSupplier">' + suppliers.filter((sp) => sp.status === 'active').map((sp) => '<option value="' + sp.id + '"' + (sp.id === h.supplier ? ' selected' : '') + '>' + sp.name + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Горизонт, дней</span><input id="ohHorizon" type="number" min="1" max="30" value="' + h.horizon + '"></label></div>' +
      '<div class="order-modes" id="orderModes"><button data-order-mode="rules"' + (h.mode === 'rules' ? ' class="is-on"' : '') + '>По правилам</button><button data-order-mode="ai"' + (h.mode === 'ai' ? ' class="is-on"' : '') + '>С ИИ</button><button data-order-mode="manual"' + (h.mode === 'manual' ? ' class="is-on"' : '') + '>Ручной</button></div>' +
      (included.length ? '<div class="order-helper-table"><div class="order-helper-head"><span></span><span>Позиция</span><span class="num">Остаток</span><span class="num">Мин.</span><span class="num">К заказу</span><span>Почему</span></div>' +
        included.map((p) => '<div class="order-helper-row"><input type="checkbox" class="check" data-order-check="' + p.item.id + '"' + (h.mode !== 'manual' && p.need > 0 ? ' checked' : '') + '><div><b>' + p.item.name + '</b><span>' + (h.mode === 'ai' ? 'ИИ: ' : '') + p.why + '</span></div><span class="num">' + fmtQ(p.stock) + ' ' + p.item.unit + '</span><span class="num">' + fmtQ(p.item.min) + '</span><div class="order-qty"><input type="number" min="0" step="' + (p.item.multiple || 1) + '" data-order-qty="' + p.item.id + '" value="' + (h.mode === 'manual' ? 0 : p.need) + '"><span>' + p.item.unit + '</span></div><span class="order-why">' + (p.burning ? 'Партия ' + p.burning.lot + ' · ' + expLabel(p.burning.days) : '') + '</span></div>').join('') + '</div>' : '<div class="ai-empty" style="margin-top:12px"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><path d="m9 2.8 1.5 4 4 1.4-4 1.5L9 13.7 7.5 9.7 3.5 8.2l4-1.4L9 2.8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg></span><span><b>Заказывать нечего</b>Остатков достаточно на горизонт ' + h.horizon + ' дней или партии ещё горят.</span></div>') +
      (excluded.length ? '<div class="order-exclusions"><div class="sup-sec-title">Почему не в заказе</div>' + excluded.map((p) => '<div class="order-exclusion"><span>' + p.item.name + '</span><span>' + fmtQ(p.stock) + ' ' + p.item.unit + ' · партия ' + (p.burning ? p.burning.lot + ' ' + expLabel(p.burning.days) : '—') + ' — сначала продать</span></div>').join('') + '</div>' : '') +
      '<div class="inv-modal-actions"><button class="btn btn-ghost" id="orderHelperCancel">Отмена</button><button class="btn btn-primary" id="orderHelperCreate">Создать черновик заказа</button></div>';
    document.getElementById('orderHelperCard').querySelectorAll('[data-order-qty]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const cb = document.querySelector('[data-order-check="' + inp.dataset.orderQty + '"]');
        if (cb) cb.checked = Number(inp.value) > 0;
      });
    });
  }
  document.getElementById('orderHelperCard').addEventListener('click', (e) => {
    if (e.target.closest('#orderHelperClose') || e.target.closest('#orderHelperCancel')) {
      document.getElementById('orderHelper').classList.remove('is-on');
      return;
    }
    const mode = e.target.closest('[data-order-mode]');
    if (mode) {
      orderHelperState.mode = mode.dataset.orderMode;
      renderOrderHelper();
      return;
    }
    if (e.target.closest('#orderHelperCreate')) {
      const lines = [];
      document.querySelectorAll('#orderHelperCard [data-order-check]:checked').forEach((cb) => {
        const qty = Number(document.querySelector('[data-order-qty="' + cb.dataset.orderCheck + '"]').value) || 0;
        if (qty > 0) lines.push({ item: cb.dataset.orderCheck, qty, price: itemById(cb.dataset.orderCheck).cost });
      });
      if (!lines.length) { toast('Отметьте хотя бы одну позицию'); return; }
      const id = 'ЗК-' + String(19 + purchaseOrders.length - 4).padStart(4, '0');
      purchaseOrders.unshift({ id, date: '18 окт', supplier: orderHelperState.supplier, point: orderHelperState.point, delivery: 'через ' + orderHelperState.horizon + ' дн.', status: 'draft', lines });
      document.getElementById('orderHelper').classList.remove('is-on');
      renderOrders();
      toast('Черновик заказа создан');
      openOrder(id);
    }
  });
  document.getElementById('orderHelperCard').addEventListener('change', (e) => {
    if (e.target.id === 'ohPoint') { orderHelperState.point = e.target.value; renderOrderHelper(); }
    if (e.target.id === 'ohSupplier') { orderHelperState.supplier = e.target.value; renderOrderHelper(); }
    if (e.target.id === 'ohHorizon') { orderHelperState.horizon = Math.max(1, Number(e.target.value) || 3); renderOrderHelper(); }
  });

  function openOrder(id) {
    orderId = id;
    renderOrderDrawer();
    closeAll();
    document.getElementById('orderDrawer').classList.add('is-on');
    syncScrim();
  }
  function renderOrderDrawer() {
    const o = purchaseOrders.find((x) => x.id === orderId);
    if (!o) return;
    const st = orderStatus[o.status] || orderStatus.draft;
    document.getElementById('orderKicker').textContent = st.label.toLowerCase();
    document.getElementById('orderTitle').textContent = o.id;
    document.getElementById('orderMeta').textContent = supById(o.supplier).name + ' · ' + o.point + ' · поставка ' + o.delivery;
    document.getElementById('orderBody').innerHTML =
      '<div class="dl" style="margin-bottom:12px"><dt>Статус</dt><dd><span class="pill ' + st.cls + '"><i></i>' + st.label + '</span></dd><dt>Создан</dt><dd>' + o.date + '</dd><dt>Позиций</dt><dd>' + o.lines.length + '</dd></dl>' +
      '<div class="pur-items-static">' + o.lines.map((l) => { const it = itemById(l.item); return '<div class="pur-item-row"><span class="q">' + fmtQ(l.qty) + ' ' + it.unit + '</span><span class="n">' + it.name + '</span><span class="s">' + nf.format(l.qty * l.price) + ' ₽</span></div>'; }).join('') + '</div>' +
      '<div class="pay-total" style="margin-top:12px"><span>Сумма заказа</span><b>' + nf.format(orderAmount(o)) + ' ₽</b></div>' +
      '<p class="pd-note" style="margin-top:10px">Заказ не отправляется автоматически. Подтверждение делает человек.</p>';
    document.getElementById('orderFoot').innerHTML = '<button class="btn btn-ghost" id="orderCancel">Закрыть</button>' +
      (o.status === 'draft' ? '<button class="btn btn-primary" id="orderConfirm">Подтвердить заказ</button>' : '') +
      (o.status === 'confirmed' || o.status === 'sent' ? '<button class="btn btn-primary" id="orderReceive">Создать приход</button>' : '');
  }
  document.getElementById('orderFoot').addEventListener('click', (e) => {
    if (e.target.id === 'orderCancel') { document.getElementById('orderDrawer').classList.remove('is-on'); syncScrim(); }
    if (e.target.id === 'orderConfirm') {
      const o = purchaseOrders.find((x) => x.id === orderId);
      o.status = 'confirmed';
      renderOrderDrawer();
      renderOrders();
      toast('Заказ подтверждён');
    }
    if (e.target.id === 'orderReceive') {
      const o = purchaseOrders.find((x) => x.id === orderId);
      document.getElementById('orderDrawer').classList.remove('is-on');
      syncScrim();
      openReceipt({ point: o.point, supplier: supById(o.supplier).name, lines: o.lines });
      toast('Накладная предзаполнена из заказа');
    }
  });
  document.getElementById('orderClose').addEventListener('click', () => { document.getElementById('orderDrawer').classList.remove('is-on'); syncScrim(); });

  /* supplier returns */
  function openReturnFromRec(rec) {
    openReturn(null, rec);
  }
  function openReturn(id, rec) {
    returnId = id;
    if (id) {
      const r = supplierReturns.find((x) => x.id === id);
      returnDraft = { id: r.id, supplier: r.supplier, point: r.point, basis: r.basis, status: r.status, date: r.date, lines: r.lines.map((l) => ({ item: l.item, qty: l.qty, price: l.price })) };
    } else {
      const item = rec ? itemById(rec.itemId) : stockItems[0];
      returnDraft = { id: null, supplier: item.defaultSupplier || 's1', point: rec ? rec.point : 'Покровка', basis: rec ? 'Срок' : 'Срок', status: 'draft', date: '18 окт', lines: [{ item: item.id, qty: rec ? rec.qty : 1, price: item.cost }] };
    }
    renderReturnDrawer();
    closeAll();
    document.getElementById('returnDrawer').classList.add('is-on');
    syncScrim();
  }
  function renderReturnDrawer() {
    const r = returnDraft;
    const st = returnStatus[r.status] || returnStatus.draft;
    document.getElementById('returnKicker').textContent = r.id ? st.label.toLowerCase() : 'новый';
    document.getElementById('returnTitle').textContent = r.id || 'Возврат поставщику';
    document.getElementById('returnMeta').textContent = supById(r.supplier).name + ' · ' + r.point;
    document.getElementById('returnBody').innerHTML =
      '<div class="pd-grid"><label class="field"><span>Поставщик</span><select id="retSupplier">' + suppliers.filter((sp) => sp.status === 'active').map((sp) => '<option value="' + sp.id + '"' + (sp.id === r.supplier ? ' selected' : '') + '>' + sp.name + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Точка</span><select id="retPoint">' + stockPoints.map((p) => '<option' + (p === r.point ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Основание</span><select id="retBasis"><option' + (r.basis === 'Срок' ? ' selected' : '') + '>Срок</option><option' + (r.basis === 'Брак' ? ' selected' : '') + '>Брак</option><option' + (r.basis === 'Пересорт' ? ' selected' : '') + '>Пересорт</option><option' + (r.basis === 'Другое' ? ' selected' : '') + '>Другое</option></select></label>' +
      '<label class="field"><span>Накладная прихода</span><select id="retInvoice"><option value="">Не выбрана</option>' + invoices.filter((i) => i.supplier === r.supplier).map((i) => '<option>' + i.id + '</option>').join('') + '</select></label></div>' +
      '<div class="pd-sec-head" style="margin-top:14px"><h3>Позиции возврата</h3><button class="card-link" id="retAdd">+ Позиция</button></div>' +
      '<div class="rec-lines">' + r.lines.map((l, i) => { const it = itemById(l.item); return '<div class="rec-line ret-line"><select data-ret-item="' + i + '">' + stockItems.map((o) => '<option value="' + o.id + '"' + (o.id === l.item ? ' selected' : '') + '>' + o.name + '</option>').join('') + '</select><input data-ret-qty="' + i + '" type="number" min="0" step="0.01" value="' + l.qty + '"><span class="u">' + it.unit + '</span><button class="rm" data-ret-rm="' + i + '">×</button></div>'; }).join('') + '</div>' +
      '<div class="pay-total" style="margin-top:10px"><span>Сумма возврата</span><b>' + nf.format(Math.round(r.lines.reduce((s, l) => s + l.qty * l.price, 0))) + ' ₽</b></div>' +
      '<p class="pd-note">Количество не больше остатка партии. После проведения остаток уменьшится; взаиморасчёты в v1 не меняются.</p>';
    const posted = r.status === 'posted';
    document.getElementById('returnFoot').innerHTML = '<button class="btn btn-ghost" id="retCancel">Закрыть</button>' +
      (r.id ? '<button class="btn btn-ghost" id="retPrint">Акт</button>' : '') +
      (posted ? '' : '<button class="btn btn-ghost" id="retDraft">Черновик</button><button class="btn btn-primary" id="retPost">Провести возврат</button>');
  }
  document.getElementById('returnBody').addEventListener('input', (e) => {
    const i = e.target.dataset.retQty;
    if (i !== undefined) {
      returnDraft.lines[Number(i)].qty = Math.max(0, Number(e.target.value) || 0);
      const total = document.querySelector('#returnBody .pay-total b');
      if (total) total.textContent = nf.format(Math.round(returnDraft.lines.reduce((s, l) => s + l.qty * l.price, 0))) + ' ₽';
    }
  });
  document.getElementById('returnBody').addEventListener('change', (e) => {
    if (e.target.id === 'retSupplier') { returnDraft.supplier = e.target.value; renderReturnDrawer(); }
    if (e.target.id === 'retPoint') returnDraft.point = e.target.value;
    if (e.target.id === 'retBasis') returnDraft.basis = e.target.value;
    const item = e.target.dataset.retItem;
    if (item !== undefined) {
      const it = itemById(e.target.value);
      returnDraft.lines[Number(item)].item = e.target.value;
      returnDraft.lines[Number(item)].price = it.cost;
      renderReturnDrawer();
    }
  });
  document.getElementById('returnBody').addEventListener('click', (e) => {
    if (e.target.closest('#retAdd')) {
      returnDraft.lines.push({ item: stockItems[0].id, qty: 1, price: stockItems[0].cost });
      renderReturnDrawer();
      return;
    }
    const rm = e.target.closest('[data-ret-rm]');
    if (rm) {
      if (returnDraft.lines.length === 1) { toast('Оставьте хотя бы одну позицию'); return; }
      returnDraft.lines.splice(Number(rm.dataset.retRm), 1);
      renderReturnDrawer();
    }
  });
  document.getElementById('returnFoot').addEventListener('click', (e) => {
    if (e.target.id === 'retCancel') { document.getElementById('returnDrawer').classList.remove('is-on'); syncScrim(); }
    if (e.target.id === 'retPrint') openReturnPrint(returnDraft);
    if (e.target.id === 'retDraft' || e.target.id === 'retPost') {
      const post = e.target.id === 'retPost';
      const lines = returnDraft.lines.filter((l) => l.qty > 0);
      if (!lines.length) { toast('Добавьте позицию с количеством'); return; }
      if (!returnDraft.id) returnDraft.id = 'ВЗ-' + String(8 + supplierReturns.length - 2).padStart(4, '0');
      const doc = { id: returnDraft.id, date: returnDraft.date, supplier: returnDraft.supplier, point: returnDraft.point, basis: returnDraft.basis, status: post ? 'posted' : 'draft', lines };
      const idx = supplierReturns.findIndex((x) => x.id === doc.id);
      if (idx > -1) supplierReturns[idx] = doc; else supplierReturns.unshift(doc);
      if (post) lines.forEach((l) => reduceStock(l.item, doc.point, l.qty));
      document.getElementById('returnDrawer').classList.remove('is-on');
      syncScrim();
      renderReturns();
      if (post) {
        renderStock();
        if (typeof renderExpiry === 'function') renderExpiry();
        toast('Возврат проведён · остаток уменьшен');
      } else {
        toast('Черновик возврата сохранён');
      }
    }
  });
  document.getElementById('returnClose').addEventListener('click', () => { document.getElementById('returnDrawer').classList.remove('is-on'); syncScrim(); });
  function openReturnPrint(r) {
    document.getElementById('returnPrintBody').innerHTML = '<div class="inv-print-wrap"><div class="inv-print-bar"><button class="btn btn-ghost btn-sm" data-toast="Демо: акт возврата отправлен на печать">Печать / PDF</button><button class="btn btn-primary btn-sm" id="retPrintClose">Закрыть</button></div><div class="inv-sheet"><div class="inv-sheet-head"><div><div class="inv-sheet-brand">6.7 Coffee · закупки</div><h2>Акт возврата поставщику</h2></div><div class="inv-sheet-meta">Документ: ' + r.id + '<br>Поставщик: ' + supById(r.supplier).name + '<br>Точка: ' + r.point + '<br>Основание: ' + r.basis + '</div></div><table><thead><tr><th>№</th><th>Позиция</th><th>Ед.</th><th class="num">Кол-во</th><th class="num">Цена</th><th class="num">Сумма</th></tr></thead><tbody>' + r.lines.map((l, i) => { const it = itemById(l.item); return '<tr><td>' + (i + 1) + '</td><td>' + it.name + '</td><td>' + it.unit + '</td><td class="num">' + fmtQ(l.qty) + '</td><td class="num">' + nf.format(l.price) + ' ₽</td><td class="num">' + nf.format(l.qty * l.price) + ' ₽</td></tr>'; }).join('') + '</tbody></table><div class="inv-sheet-totals"><span>Итого: <b>' + nf.format(r.lines.reduce((s, l) => s + l.qty * l.price, 0)) + ' ₽</b></span></div><div class="inv-signs"><div class="inv-sign"><span>Сдал</span></div><div class="inv-sign"><span>Принял поставщик</span></div></div></div></div>';
    document.getElementById('returnPrintModal').classList.add('is-on');
    document.getElementById('retPrintClose').addEventListener('click', () => document.getElementById('returnPrintModal').classList.remove('is-on'));
  }

  function renderTodayExtra() {
    const exp = expiryRecs('Покровка').filter((r) => r.sev === 'urgent' || r.sev === 'warn').slice(0, 3);
    const el = document.getElementById('todayExpiryList');
    if (el) el.innerHTML = exp.length ? exp.map((r) => '<button class="mini-row" data-today-dates><span class="mini-dot ' + r.sev + '"></span><span class="mini-main"><b>' + r.item.name + '</b><span>' + fmtQ(r.qty) + ' ' + r.item.unit + ' · до ' + r.expiry + '</span></span><span class="mini-badge ' + r.sev + '">' + expLabel(r.days) + '</span></button>').join('') : '<div class="stock-norm-empty">Партий с близким сроком нет.</div>';
    const sugg = stockItems.map((it) => ({ it, n: needFor(it, 'Покровка', 3).need })).filter((x) => x.n > 0).slice(0, 3);
    const ol = document.getElementById('todayOrderList');
    if (ol) ol.innerHTML = sugg.length ? sugg.map(({ it, n }) => '<button class="mini-row" data-today-orders><span class="mini-main"><b>' + it.name + '</b><span>заказать ' + fmtQ(n) + ' ' + it.unit + ' · ' + (it.supplierName || 'поставщик') + '</span></span><span class="mini-qty">' + fmtQ(n) + ' ' + it.unit + '</span></button>').join('') : '<div class="stock-norm-empty">Остатков достаточно на 3 дня.</div>';
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-today-dates]')) { go('stock'); setStockTab('dates'); return; }
    if (e.target.closest('[data-today-orders]')) { go('purchases'); setPurTab('orders'); return; }
    if (e.target.closest('#todayCalcOrder')) { openOrderHelper('rules'); }
  });
  renderTodayExtra();
  renderOrders();
  renderReturns();

  /* ---------------- ai layer ---------------- */
  const aiFeed = [
    { id: 'pay-0237', sev: 'urgent', title: 'ПР-0237 просрочена', why: 'Чай и матча · 9 600 ₽ · срок 15 окт', primary: { label: 'Создать оплату', action: 'draft-pay', invoice: 'ПР-0237' }, secondary: { label: 'Накладные', nav: 'purchases' } },
    { id: 'stock-coffee', sev: 'warn', title: 'Недостача кофе 0,3 кг', why: 'Покровка · факт 2,9 кг против 3,2 кг', primary: { label: 'Инвентаризация', action: 'inventory', item: 'coffee', point: 'Покровка' }, secondary: { label: 'Остатки', nav: 'stock' } },
    { id: 'no-norm', sev: 'warn', title: '2 позиции без нормы', why: 'Ледяной чай и Сэндвич · списание не работает', primary: { label: 'Заполнить нормы', action: 'stock-recipes-none' }, secondary: { label: 'Нормы', nav: 'stock' } },
    { id: 'no-photo', sev: 'info', title: '14 товаров без фото', why: 'В PWA покажется серая заглушка', primary: { label: 'Открыть без фото', action: 'menu-no-photo' }, secondary: { label: 'Меню', nav: 'menu' } },
    { id: 'no-card', sev: 'info', title: '27 продаж без карты', why: '6,3% чеков · чашки не начислены', primary: { label: 'Открыть операции', action: 'operations-nocard' }, secondary: { label: 'Скрыть', hide: true } }
  ];
  const aiSev = {
    urgent: { label: 'Срочно', cls: 'urgent' },
    warn: { label: 'Внимание', cls: 'warn' },
    info: { label: 'Инфо', cls: 'info' },
    good: { label: 'Норма', cls: 'good' }
  };
  const hiddenAI = new Set();
  let assistantFeedState = 'ok';
  let assistantInitialized = false;
  let aiDraftCallback = null;

  function aiAttrs(target) {
    if (!target) return '';
    if (target.nav) return ' data-ai-nav="' + target.nav + '"';
    if (target.action) {
      return ' data-ai-action="' + target.action + '"' +
        (target.invoice ? ' data-invoice="' + target.invoice + '"' : '') +
        (target.item ? ' data-item="' + target.item + '"' : '') +
        (target.point ? ' data-point="' + target.point + '"' : '');
    }
    return '';
  }

  function aiCardHTML(card, compact) {
    if (!card || hiddenAI.has(card.id)) return '';
    const sev = aiSev[card.sev] || aiSev.info;
    const primary = card.primary && !card.primary.hide
      ? '<button class="ai-action ' + (card.sev === 'urgent' ? 'urgent' : '') + '"' + aiAttrs(card.primary) + '>' + card.primary.label + '</button>'
      : '';
    const secondary = card.secondary && card.secondary.hide
      ? '<button class="ai-hide" data-ai-hide="' + card.id + '">Скрыть на 7 дней</button>'
      : card.secondary
        ? '<button class="ai-link"' + aiAttrs(card.secondary) + '>' + card.secondary.label + '</button>'
        : '';
    return '<div class="ai-card-ui ' + compact + '" data-ai-card="' + card.id + '">' +
      '<div class="ai-card-top"><span class="ai-badge"><svg width="10" height="10" viewBox="0 0 20 20" fill="none"><path d="m10 2.8 1.7 4.4 4.5 1.6-4.5 1.8L10 15l-1.7-4.4L3.8 8.8l4.5-1.6L10 2.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg> AI</span>' +
        '<span class="ai-sev ' + sev.cls + '">' + sev.label + '</span>' +
        '<button class="ai-dismiss" data-ai-hide="' + card.id + '" aria-label="Скрыть на 7 дней" title="Скрыть на 7 дней">×</button></div>' +
      '<div class="ai-card-title">' + card.title + '</div>' +
      '<div class="ai-card-why">' + card.why + '</div>' +
      '<div class="ai-card-actions">' + primary + secondary + '</div>' +
      '<div class="ai-source">На основе данных учёта на 18 окт, 12:41</div>' +
    '</div>';
  }

  function aiList(cards, compact) {
    const visible = cards.filter((c) => !hiddenAI.has(c.id));
    if (!visible.length) {
      return '<div class="ai-empty"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><path d="m9 2.8 1.5 4 4 1.4-4 1.5L9 13.7 7.5 9.7 3.5 8.2l4-1.4L9 2.8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg></span><span><b>Пока всё спокойно</b>Система не нашла новых отклонений. Добавьте приход или контрагента — ИИ начнёт искать закономерности.</span><button class="btn btn-ghost btn-sm" data-ai-action="new-receipt">Новый приход</button></div>';
    }
    return visible.map((c) => aiCardHTML(c, compact || '')).join('');
  }

  function renderAssistantFeed() {
    const feed = document.getElementById('assistantFeed');
    if (!feed) return;
    if (assistantFeedState === 'error') {
      feed.innerHTML = '<div class="ai-empty ai-error"><span class="q-ic red"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><path d="M9 2.8 16 15H2L9 2.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 7.2v3.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span><b>Не удалось обновить подсказки</b>Показаны данные на 18 окт, 12:41. Проверьте соединение.</span><button class="btn btn-ghost btn-sm" data-ai-retry>Повторить</button></div>';
      return;
    }
    if (assistantFeedState === 'empty') {
      feed.innerHTML = '<div class="ai-empty"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><path d="m9 2.8 1.5 4 4 1.4-4 1.5L9 13.7 7.5 9.7 3.5 8.2l4-1.4L9 2.8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg></span><span><b>Пока всё спокойно</b>Новых проблем нет. Добавьте приход или контрагента — ИИ начнёт искать закономерности.</span><button class="btn btn-ghost btn-sm" data-ai-action="new-receipt">Новый приход</button></div>';
      return;
    }
    feed.innerHTML = aiList(aiFeed, 'compact');
  }

  function renderAIFeeds() {
    const today = document.getElementById('todayAIFeed');
    if (today) today.innerHTML = aiList(aiFeed.slice(0, 3), 'compact');
    const page = document.getElementById('assistantPageFeed');
    if (page) page.innerHTML = aiList(aiFeed.slice(0, 4), 'compact');
    const stock = document.getElementById('stockAIContext');
    if (stock) stock.innerHTML = aiCardHTML(aiFeed.find((c) => c.id === 'stock-coffee'), 'compact');
    const menu = document.getElementById('menuAIContext');
    if (menu) menu.innerHTML = aiCardHTML(aiFeed.find((c) => c.id === 'no-photo'), 'compact');
    renderAssistantFeed();
  }

  function openAssistant() {
    closeAll();
    document.getElementById('assistantDrawer').classList.add('is-on');
    syncScrim();
    renderAssistantFeed();
    if (!assistantInitialized) {
      assistantInitialized = true;
      appendAIMessage('ai', '<p>Я вижу остатки, закупки, меню и продажи. Спросите про цифры или попросите найти проблему — покажу источник и дам кнопку действия.</p>', 'Демо-режим. Ключ DeepSeek — в разделе «Система».');
    }
    setTimeout(() => document.getElementById('assistantInput').focus(), 80);
  }

  function appendAIMessage(role, html, source) {
    const chat = document.getElementById('assistantChat');
    const div = document.createElement('div');
    div.className = 'ai-msg ' + role;
    if (role === 'user') {
      div.textContent = html;
    } else {
      div.innerHTML = '<div class="ai-msg-head"><span>Ассистент 6.7</span><span>12:41</span></div>' + html + (source ? '<div class="ai-msg-source">' + source + '</div>' : '');
    }
    chat.appendChild(div);
    chat.scrollIntoView({ block: 'nearest' });
    document.querySelector('.assistant-scroll').scrollTop = 99999;
  }

  function askAssistant(text, key) {
    const q = (text || '').toLowerCase();
    const k = key || (q.includes('долг') || q.includes('постав') || q.includes('оплат') ? 'debt'
      : q.includes('остат') || q.includes('склад') || q.includes('кофе') ? 'stock'
      : q.includes('продаж') || q.includes('выручк') || q.includes('вчера') ? 'sales'
      : q.includes('провер') || q.includes('сегодня') ? 'today' : 'generic');
    appendAIMessage('user', text);
    const answer = buildAIAnswer(k);
    appendAIMessage('ai', answer.html, answer.source);
  }

  function buildAIAnswer(key) {
    if (key === 'stock') {
      const coffee = itemById('coffee');
      const a = stockAgg(coffee, stockPoint);
      const short = shortageStats();
      return {
        html: '<h4>' + fmtQ(a.expected) + ' кг кофе · ' + pointLabel() + '</h4>' +
          '<p>Ожидаемо ' + fmtQ(a.expected) + ' кг, факт ' + (a.fact === null ? '—' : fmtQ(a.fact) + ' кг') + '. Недостача ' + fmtQ(Math.abs(a.variance || 0)) + ' кг.</p>' +
          '<ul><li>Всего недостач: ' + short.count + ' на ' + nf.format(Math.round(short.money)) + ' ₽</li><li>Матча ещё не инвентаризирована</li><li>2 позиции без нормы — списание не работает</li></ul>' +
          '<div class="ai-msg-actions"><button class="ai-action" data-ai-nav="stock">Открыть остатки</button><button class="ai-link" data-ai-action="inventory" data-item="coffee" data-point="Покровка">Инвентаризация</button></div>',
        source: 'По остаткам, нормам и инвентаризации на 18 окт, 12:41'
      };
    }
    if (key === 'debt') {
      const debt = invoices.reduce((s, i) => s + invoiceDebt(i), 0);
      const over = invoices.filter((i) => invoiceDebt(i) > 0 && i.dueIn < 0);
      const overSum = over.reduce((s, i) => s + invoiceDebt(i), 0);
      return {
        html: '<h4>' + nf.format(debt) + ' ₽ долга</h4>' +
          '<p>Просрочено ' + nf.format(overSum) + ' ₽ — ' + over.length + ' накладные. Больше всего: ' + over.map((i) => i.id).join(', ') + '.</p>' +
          '<ul>' + over.slice(0, 3).map((i) => '<li>' + i.id + ' · ' + supById(i.supplier).name + ' · ' + nf.format(invoiceDebt(i)) + ' ₽</li>').join('') + '</ul>' +
          '<div class="ai-msg-actions"><button class="ai-action" data-ai-nav="purchases">Открыть закупки</button>' + (over[0] ? '<button class="ai-link" data-ai-action="draft-pay" data-invoice="' + over[0].id + '">Создать оплату</button>' : '') + '</div>',
        source: 'По проведённым накладным и оплатам на 18 окт, 12:41'
      };
    }
    if (key === 'sales') {
      const a = compareData['24h'];
      const b = compareData.yesterday;
      return {
        html: '<h4>' + nf.format(b.checks) + ' чеков вчера</h4>' +
          '<p>Сегодня ' + a.checks + '. Вчера чашек ' + b.cups + ', средний чек ' + nf.format(Math.round(b.revenue / b.checks)) + ' ₽.</p>' +
          '<ul><li>Выручка вчера: ' + nf.format(b.revenue) + ' ₽</li><li>27 продаж без карты за 24 часа</li><li>2 чека с ошибкой</li></ul>' +
          '<div class="ai-msg-actions"><button class="ai-action" data-ai-nav="compare">Сравнить периоды</button><button class="ai-link" data-ai-nav="operations">Операции</button></div>',
        source: 'По документам и начислениям на 18 окт, 12:41'
      };
    }
    if (key === 'today') {
      return {
        html: '<h4>Три проверки на сегодня</h4><ul><li>Просрочена накладная ПР-0237 на 9 600 ₽</li><li>Инвентаризация матчи — факт не введён</li><li>14 товаров без фото в PWA</li></ul><p>Начните с оплаты или инвентаризации — остальное подождёт.</p>' +
          '<div class="ai-msg-actions"><button class="ai-action" data-ai-action="draft-pay" data-invoice="ПР-0237">Создать оплату</button><button class="ai-link" data-ai-nav="stock">Остатки</button></div>',
        source: 'По складу, закупкам и каталогу на 18 окт, 12:41'
      };
    }
    return {
      html: '<h4>Нет данных для точного ответа</h4><p>В системе нет документа или контрагента по этому запросу. Не буду придумывать цифру. Могу показать остатки, долг или продажи.</p><div class="ai-msg-actions"><button class="ai-link" data-ai-nav="stock">Остатки</button><button class="ai-link" data-ai-nav="purchases">Долг</button><button class="ai-link" data-ai-nav="compare">Продажи</button></div>',
      source: 'Данные на 18 окт, 12:41'
    };
  }

  function openAIDraft(config) {
    aiDraftCallback = config.onConfirm || null;
    document.getElementById('aiDraftTitle').textContent = config.title;
    document.getElementById('aiDraftText').textContent = config.text || '';
    document.getElementById('aiDraftRows').innerHTML = (config.rows || []).map((r) => '<div class="ai-draft-row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>').join('');
    document.getElementById('aiDraftConfirm').textContent = config.confirmLabel || 'Создать черновик';
    document.getElementById('aiDraftModal').classList.add('is-on');
  }
  function closeAIDraft() {
    document.getElementById('aiDraftModal').classList.remove('is-on');
    aiDraftCallback = null;
  }
  function openPaymentDraft(invoiceId) {
    const inv = invById(invoiceId);
    if (!inv) return;
    const debt = invoiceDebt(inv);
    openAIDraft({
      title: 'Черновик оплаты',
      text: 'Проверьте реквизиты и сумму. После подтверждения откроется форма оплаты — проводить её нужно вручную.',
      rows: [['Накладная', inv.id], ['Контрагент', supById(inv.supplier).name], ['Сумма к оплате', nf.format(debt) + ' ₽'], ['Срок', inv.dueIn < 0 ? 'просрочен на ' + Math.abs(inv.dueIn) + ' дн.' : 'до ' + inv.due]],
      confirmLabel: 'Создать черновик оплаты',
      onConfirm: () => openPayment(inv.supplier, inv.id)
    });
  }

  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-ai-nav]');
    if (nav) {
      e.preventDefault();
      const v = nav.dataset.aiNav;
      go(v);
      if (v === 'stock') setStockTab('balances');
      if (v === 'purchases') setPurTab('invoices');
      if (v === 'menu') setMenuTab('products');
      return;
    }
    const action = e.target.closest('[data-ai-action]');
    if (action) {
      e.preventDefault();
      const a = action.dataset.aiAction;
      if (a === 'inventory') openInventory(action.dataset.item, action.dataset.point);
      if (a === 'stock-recipes-none') {
        go('stock');
        setStockTab('recipes');
        recipeFilter = 'none';
        renderRecipes();
      }
      if (a === 'draft-pay') openPaymentDraft(action.dataset.invoice);
      if (a === 'menu-no-photo') { go('menu'); setMenuIssue('noPhoto'); }
      if (a === 'operations-nocard') { go('operations'); setOpsFilter('nocard'); }
      if (a === 'new-receipt') { go('stock'); openReceipt(); }
      if (a === 'analytics-hours') { go('analytics'); setAnaTab('hours'); }
      if (a === 'analytics-sales') { go('analytics'); setAnaTab('sales'); }
      if (a === 'analytics-customers') { go('analytics'); setAnaTab('customers'); }
      if (a === 'analytics-stores') { go('analytics'); setAnaTab('stores'); }
      return;
    }
    const hide = e.target.closest('[data-ai-hide]');
    if (hide) {
      hiddenAI.add(hide.dataset.aiHide);
      const card = hide.closest('.ai-card-ui');
      if (card) card.remove();
      renderAIFeeds();
      toast('Подсказка скрыта на 7 дней (демо)');
      return;
    }
    const retry = e.target.closest('[data-ai-retry]');
    if (retry) {
      assistantFeedState = 'ok';
      renderAssistantFeed();
      toast('Подсказки обновлены');
    }
  });

  ['openAssistant', 'openAssistant2', 'openAssistant3'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', openAssistant);
  });
  document.getElementById('assistantClose').addEventListener('click', () => {
    document.getElementById('assistantDrawer').classList.remove('is-on');
    syncScrim();
  });
  document.getElementById('assistantRefresh').addEventListener('click', () => {
    assistantFeedState = 'ok';
    renderAssistantFeed();
    toast('Подсказки обновлены · данные на 12:41');
  });
  document.getElementById('assistantChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-assistant-ask]');
    if (!b) return;
    const labels = { stock: 'Что с остатками', debt: 'Кто должен', sales: 'Продажи вчера', today: 'Что проверить сегодня' };
    askAssistant(labels[b.dataset.assistantAsk], b.dataset.assistantAsk);
  });
  function sendAssistant() {
    const input = document.getElementById('assistantInput');
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    askAssistant(text);
    input.value = '';
  }
  document.getElementById('assistantSend').addEventListener('click', sendAssistant);
  document.getElementById('assistantInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendAssistant(); });

  document.getElementById('aiDraftClose').addEventListener('click', closeAIDraft);
  document.getElementById('aiDraftCancel').addEventListener('click', closeAIDraft);
  document.getElementById('aiDraftConfirm').addEventListener('click', () => {
    const cb = aiDraftCallback;
    closeAIDraft();
    if (cb) cb();
  });
  document.getElementById('aiDraftModal').addEventListener('click', (e) => { if (e.target.id === 'aiDraftModal') closeAIDraft(); });

  document.querySelectorAll('[data-ai-state]').forEach((b) => {
    b.addEventListener('click', () => {
      assistantFeedState = b.dataset.aiState;
      document.querySelectorAll('[data-ai-state]').forEach((x) => x.classList.toggle('is-on', x === b));
      renderAssistantFeed();
      openAssistant();
      toast('Состояние ленты: ' + b.textContent.toLowerCase() + ' (демо)');
    });
  });

  renderAIFeeds();

  /* ---------------- analytics ---------------- */
  const anaData = {
    '24h': {
      labels: ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22'],
      values: [3200, 5100, 7800, 11200, 12400, 8900, 7300, 8600, 10400, 13900, 12100, 9600, 6100, 3400, 1500],
      checks: 428, loyalty: 74, delta: '+8,2%', note: 'по часам · сегодня'
    },
    '7d': {
      labels: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
      values: [88400, 92600, 101200, 98400, 112300, 124500, 95000],
      checks: 3104, loyalty: 72, delta: '+11,4%', note: 'по дням · 7 дней'
    },
    '30d': {
      labels: ['19.09', '20.09', '21.09', '22.09', '23.09', '24.09', '25.09', '26.09', '27.09', '28.09', '29.09', '30.09', '01.10', '02.10', '03.10', '04.10', '05.10', '06.10', '07.10', '08.10', '09.10', '10.10', '11.10', '12.10', '13.10', '14.10', '15.10', '16.10', '17.10', '18.10'],
      values: [92000, 98000, 101000, 97000, 104000, 112000, 118000, 96000, 99000, 103000, 107000, 115000, 121000, 98000, 102000, 106000, 110000, 119000, 126000, 101000, 105000, 109000, 113000, 122000, 129000, 103000, 108000, 117000, 124000, 99000],
      checks: 12980, loyalty: 69, delta: '+9,8%', note: 'по дням · 30 дней'
    }
  };
  const anaTopBase = [
    { name: 'Капучино 300 мл', cat: 'Кофе', qty: 1640, rev: 164000, trend: 12 },
    { name: 'Латте 400 мл', cat: 'Кофе', qty: 1180, rev: 142000, trend: 8 },
    { name: 'Раф ванильный', cat: 'Кофе', qty: 720, rev: 98000, trend: 4 },
    { name: 'Матча латте', cat: 'Напитки', qty: 420, rev: 76000, trend: -6 },
    { name: 'Эспрессо', cat: 'Кофе', qty: 900, rev: 54000, trend: 2 },
    { name: 'Круассан', cat: 'Выпечка', qty: 980, rev: 46000, trend: 17 },
    { name: 'Флэт уайт', cat: 'Кофе', qty: 310, rev: 38000, trend: 6 },
    { name: 'Сырники', cat: 'Выпечка', qty: 420, rev: 32000, trend: 9 },
    { name: 'Сэндвич с индейкой', cat: 'Еда', qty: 210, rev: 24000, trend: -3 },
    { name: 'Ледяной чай', cat: 'Напитки', qty: 180, rev: 18000, trend: -8 }
  ];
  const anaAffinity = [
    { pair: 'Капучино + Круассан', support: 18, confidence: 31, note: 'ниже обычных 25%' },
    { pair: 'Латте + Сырники', support: 12, confidence: 24, note: 'стабильно' },
    { pair: 'Раф + Круассан', support: 9, confidence: 19, note: 'можно усилить' },
    { pair: 'Матча + Круассан', support: 6, confidence: 14, note: 'редко' }
  ];
  const anaStaffBase = [
    { name: 'Анна Ковалёва', role: 'Кассир', shifts: 5, rev: 198400, checks: 812, loyalty: 76, food: 27 },
    { name: 'Игорь Соколов', role: 'Бариста', shifts: 4, rev: 171200, checks: 704, loyalty: 71, food: 22 },
    { name: 'Мария Полякова', role: 'Кассир', shifts: 3, rev: 118600, checks: 498, loyalty: 69, food: 20 },
    { name: 'Роман Титов', role: 'Управляющий', shifts: 6, rev: 224200, checks: 890, loyalty: 78, food: 29 }
  ];
  const anaHeatBase = [
    [18, 34, 42, 58, 72, 84, 79, 65, 72, 80, 68, 52, 30],
    [16, 30, 38, 55, 88, 96, 92, 74, 66, 71, 60, 45, 26],
    [20, 36, 46, 62, 78, 86, 81, 70, 76, 84, 72, 54, 32],
    [22, 40, 52, 68, 84, 92, 89, 78, 82, 90, 76, 58, 34],
    [24, 44, 58, 76, 92, 100, 96, 84, 88, 94, 82, 64, 38],
    [28, 52, 68, 88, 100, 108, 104, 96, 98, 102, 90, 72, 44],
    [26, 48, 62, 82, 96, 102, 98, 90, 94, 98, 86, 68, 40]
  ];
  const anaDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const anaHours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  let anaPeriod = '7d';
  let anaPoint = 'all';
  let anaChannel = 'all';
  let anaTab = 'overview';
  let anaStaffEmpty = false;

  function anaScale() {
    const p = anaPoint === 'all' ? 1 : anaPoint === 'Покровка' ? 0.52 : anaPoint === 'Арбат' ? 0.3 : 0.18;
    const c = anaChannel === 'card' ? 0.74 : 1;
    return p * c;
  }
  function anaFactorForStore(name) {
    return name === 'Покровка' ? 0.52 : name === 'Арбат' ? 0.3 : 0.18;
  }
  function anaTotal() { return anaData[anaPeriod].values.reduce((s, v) => s + v, 0) * anaScale(); }
  function anaPeriodFactor() { return anaData[anaPeriod].values.reduce((s, v) => s + v, 0) / 712400; }
  function anaChannelFactor() { return anaChannel === 'card' ? 0.74 : 1; }
  function anaChecks() { return Math.round(anaData[anaPeriod].checks * anaScale()); }
  function anaAvg() { const c = anaChecks(); return c ? anaTotal() / c : 0; }
  function anaPeriodLabel() { return anaPeriod === '24h' ? 'сегодня' : anaPeriod === '7d' ? '7 дней' : '30 дней'; }
  function anaDelta(cls) {
    const d = anaData[anaPeriod].delta;
    return '<span class="delta ' + (d.indexOf('-') === 0 ? 'down' : 'up') + '">' + (d.indexOf('-') === 0 ? '↓ ' : '↑ ') + d + '</span>';
  }

  function renderAnaKpis() {
    const total = anaTotal();
    const checks = anaChecks();
    const loyalty = anaChannel === 'card' ? 100 : anaData[anaPeriod].loyalty;
    document.getElementById('anaRevenue').innerHTML = nf.format(Math.round(total)) + ' <small>₽</small>';
    document.getElementById('anaChecks').textContent = nf.format(checks);
    document.getElementById('anaAvg').innerHTML = nf.format(Math.round(anaAvg())) + ' <small>₽</small>';
    document.getElementById('anaLoyalty').innerHTML = loyalty + ' <small>%</small>';
    const days = anaPeriod === '24h' ? 1 : anaPeriod === '7d' ? 7 : 30;
    document.getElementById('anaPerHour').textContent = nf.format(Math.round(total / (days * 14))) + ' ₽';
    document.getElementById('anaFood').textContent = anaChannel === 'card' ? '22%' : '24%';
    document.getElementById('anaRepeat').textContent = '38%';
    document.getElementById('anaRevenueDelta').textContent = '↑ ' + anaData[anaPeriod].delta;
    document.getElementById('anaChecksDelta').textContent = '↑ 8,2%';
    document.getElementById('anaAvgDelta').textContent = '→ 0,5%';
    document.getElementById('anaTopPeriod').textContent = anaPeriodLabel();
    document.getElementById('anaHeatPeriod').textContent = anaPeriodLabel();
  }

  function renderAnaChart() {
    const d = anaData[anaPeriod];
    const vals = d.values.map((v) => v * anaScale());
    const max = Math.max.apply(null, vals) * 1.12;
    const W = 720, H = 210, pt = 16, pb = 10;
    const innerH = H - pt - pb;
    const pts = vals.map((v, i) => [(i / (vals.length - 1)) * W, pt + innerH - (v / max) * innerH]);
    let line = 'M' + pts[0][0] + ',' + pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], mx = (a[0] + b[0]) / 2;
      line += ' C' + mx + ',' + a[1] + ' ' + mx + ',' + b[1] + ' ' + b[0] + ',' + b[1];
    }
    const base = H - pb;
    const grid = [0.25, 0.5, 0.75].map((f) => '<line x1="0" x2="' + W + '" y1="' + (pt + innerH * f) + '" y2="' + (pt + innerH * f) + '" stroke="#ece5d8" stroke-dasharray="2 5" vector-effect="non-scaling-stroke"/>').join('');
    document.getElementById('anaRevenueChart').innerHTML =
      '<defs><linearGradient id="anaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f172a" stop-opacity=".14"/><stop offset="1" stop-color="#0f172a" stop-opacity="0"/></linearGradient></defs>' + grid +
      '<path d="' + line + ' L' + W + ',' + base + ' L0,' + base + ' Z" fill="url(#anaGrad)"/>' +
      '<path d="' + line + '" fill="none" stroke="#0f172a" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
      pts.map((p, i) => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4" fill="#fffdf8" stroke="#0f172a" stroke-width="2" style="cursor:pointer" data-ana-day="' + i + '" vector-effect="non-scaling-stroke"/>').join('');
    const tick = anaPeriod === '24h' ? [0, 3, 6, 9, 12, 14] : anaPeriod === '7d' ? [0, 1, 2, 3, 4, 5, 6] : [0, 5, 10, 15, 20, 25, 29];
    document.getElementById('anaChartX').innerHTML = d.labels.map((l, i) => '<span>' + (tick.indexOf(i) > -1 ? l : '') + '</span>').join('');
    document.getElementById('anaChartSub').textContent = d.note;
    const total = vals.reduce((s, v) => s + v, 0);
    document.getElementById('anaRevenueChart').dataset.total = total;
  }

  function renderAnaCategory() {
    const parts = anaChannel === 'card'
      ? [{ l: 'Напитки', v: 70, c: '#0f172a' }, { l: 'Еда', v: 22, c: '#fbbf24' }, { l: 'Прочее', v: 8, c: '#d3c9b7' }]
      : [{ l: 'Напитки', v: 64, c: '#0f172a' }, { l: 'Еда', v: 24, c: '#fbbf24' }, { l: 'Прочее', v: 12, c: '#d3c9b7' }];
    const total = anaTotal();
    document.getElementById('anaCategoryBar').innerHTML = parts.map((p) => '<span style="width:' + p.v + '%;background:' + p.c + '" title="' + p.l + ' ' + p.v + '%"></span>').join('');
    document.getElementById('anaCategoryLegend').innerHTML = parts.map((p) => '<div><i style="background:' + p.c + '"></i><span>' + p.l + '</span><b>' + p.v + '%</b><span class="muted">' + nf.format(Math.round(total * p.v / 100)) + ' ₽</span></div>').join('');
  }

  function renderAnaTop() {
    const pf = anaPeriodFactor();
    const rows = anaTopBase.map((x) => ({ name: x.name, cat: x.cat, qty: Math.round(x.qty * pf * anaScale()), rev: x.rev * pf * anaScale(), trend: x.trend }));
    const max = Math.max.apply(null, rows.map((x) => x.rev)) || 1;
    document.getElementById('anaTopList').innerHTML = rows.map((r) => '<div class="ana-top-row"><span class="nm">' + r.name + '</span><span class="bar"><i style="width:' + Math.max(2, r.rev / max * 100) + '%"></i></span><span class="val">' + nf.format(Math.round(r.rev)) + ' ₽</span></div>').join('');
    const total = rows.reduce((s, x) => s + x.rev, 0);
    document.getElementById('anaMenuBody').innerHTML = rows.map((r) => '<tr><td><span class="t-type" style="font-size:11.5px">' + r.name + '</span></td><td><span class="t-muted">' + r.cat + '</span></td><td class="num-r"><span class="t-num">' + nf.format(r.qty) + '</span></td><td class="num-r"><span class="t-money">' + nf.format(Math.round(r.rev)) + ' ₽</span></td><td class="num-r"><span class="t-num">' + (total ? Math.round(r.rev / total * 100) : 0) + '%</span></td><td><span class="delta ' + (r.trend >= 0 ? 'up' : 'down') + '">' + (r.trend >= 0 ? '↑' : '↓') + ' ' + Math.abs(r.trend) + '%</span></td></tr>').join('');
    document.getElementById('anaAffinity').innerHTML = anaAffinity.map((a) => '<div class="affinity-row"><div><b>' + a.pair + '</b><span>' + a.note + '</span></div><div class="aff-metrics"><span>support <b>' + a.support + '%</b></span><span>confidence <b>' + a.confidence + '%</b></span></div></div>').join('');
  }

  function renderAnaHeat() {
    const factor = anaScale() * (anaPeriod === '30d' ? 1.7 : 1);
    const matrix = anaHeatBase.map((row) => row.map((v) => Math.round(v * 1000 * factor / 7)));
    const max = Math.max.apply(null, matrix.flat());
    let peak = { v: -1, d: 0, h: 0 };
    document.getElementById('anaHeatmap').innerHTML = '<span></span>' + anaHours.map((h) => '<span class="ana-heat-h">' + h + '</span>').join('') +
      matrix.map((row, di) => '<span class="ana-heat-d">' + anaDays[di] + '</span>' + row.map((v, hi) => {
        if (v > peak.v) peak = { v, d: di, h: hi };
        return '<button class="ana-heat-cell" data-ana-heat="' + di + '-' + hi + '" data-value="' + v + '" style="background:rgba(15,23,42,' + Math.max(0.05, v / max * 0.92) + ')" title="' + anaDays[di] + ' ' + anaHours[hi] + ':00 · ' + nf.format(v) + ' ₽"></button>';
      }).join('')).join('');
    document.getElementById('anaPeakNote').innerHTML = '<div class="peak-big">' + anaDays[peak.d] + ', ' + anaHours[peak.h] + ':00–' + (anaHours[peak.h] + 1) + ':00</div><p>Пик нагрузки. Поставьте в это окно второго бариста и заранее подготовьте выпечку.</p><div class="peak-row"><span>Выручка в пик</span><b>' + nf.format(peak.v) + ' ₽</b></div><div class="peak-row"><span>Провал</span><b>' + anaDays[0] + ', 08:00 · ' + nf.format(matrix[0][0]) + ' ₽</b></div>';
  }

  function renderAnaCustomers() {
    const newC = anaPeriod === '24h' ? 6 : anaPeriod === '7d' ? 37 : 142;
    document.getElementById('anaNewCards').textContent = newC;
    document.getElementById('anaActiveCards').textContent = nf.format(anaPeriod === '24h' ? 214 : 1106);
    document.getElementById('anaSleeping').textContent = nf.format(anaPeriod === '24h' ? 412 : 412);
    document.getElementById('anaSegments').innerHTML = '<div class="seg-bar"><i style="width:22%;background:#0f172a"></i><i style="width:58%;background:#1b6b52"></i><i style="width:20%;background:#fbbf24"></i></div><div class="seg-legend"><span><i style="background:#0f172a"></i>Новые <b>' + newC + '</b></span><span><i style="background:#1b6b52"></i>Активные <b>1 106</b></span><span><i style="background:#fbbf24"></i>Спящие <b>412</b></span></div>';
    const cups = [1240, 980, 760, 540, 410, 360];
    const max = cups[0];
    document.getElementById('anaCupsFunnel').innerHTML = cups.map((v, i) => '<div class="funnel-row"><span>' + (i + 1) + ' чашка</span><div><i style="width:' + (v / max * 100) + '%"></i></div><b>' + nf.format(v) + '</b></div>').join('');
    document.getElementById('anaGuestsBody').innerHTML = [
      ['•• 4821', 38, 38600, 'сегодня', 'Постоянный'],
      ['•• 2270', 44, 42800, 'сегодня', 'Постоянный'],
      ['•• 3907', 31, 29400, 'вчера', 'Активный'],
      ['•• 5120', 27, 24100, '17 окт', 'Активный'],
      ['•• 8842', 19, 16800, '15 окт', 'Спящий']
    ].map((g) => '<tr><td><span class="t-id">' + g[0] + '</span></td><td><span class="t-num">' + g[1] + '</span></td><td class="num-r"><span class="t-money">' + nf.format(g[2]) + ' ₽</span></td><td><span class="t-muted">' + g[3] + '</span></td><td><span class="pill ' + (g[4] === 'Спящий' ? 'amber' : g[4] === 'Постоянный' ? 'green' : 'navy') + '"><i></i>' + g[4] + '</span></td></tr>').join('');
  }

  function renderAnaStaff() {
    const body = document.getElementById('anaStaffBody');
    const empty = document.getElementById('anaStaffEmpty');
    const scroll = body.closest('.table-scroll');
    if (anaStaffEmpty) {
      body.innerHTML = '';
      if (scroll) scroll.style.display = 'none';
      empty.style.display = 'flex';
      return;
    }
    if (scroll) scroll.style.display = '';
    empty.style.display = 'none';
    const pf = anaPeriodFactor();
    const rows = anaStaffBase.map((x) => ({ name: x.name, role: x.role, shifts: x.shifts, rev: x.rev * pf * anaScale(), checks: Math.round(x.checks * pf * anaScale()), loyalty: x.loyalty, food: x.food }));
    const median = rows.slice().sort((a, b) => a.rev - b.rev)[Math.floor(rows.length / 2)].rev;
    body.innerHTML = rows.map((r) => '<tr><td><div class="staff-cell"><span class="avatar">' + initials(r.name) + '</span><span><span class="staff-name">' + r.name + '</span><span class="staff-uuid">' + r.role + '</span></span></div></td><td class="num-r"><span class="t-num">' + r.shifts + '</span></td><td class="num-r"><span class="t-money">' + nf.format(Math.round(r.rev)) + ' ₽</span></td><td class="num-r"><span class="t-num">' + nf.format(r.checks) + '</span></td><td class="num-r"><span class="t-num">' + nf.format(Math.round(r.rev / (r.checks || 1))) + ' ₽</span></td><td class="num-r"><span class="t-num">' + r.loyalty + '%</span></td><td class="num-r"><span class="t-num">' + r.food + '%</span></td><td class="num-r"><span class="delta ' + (r.rev >= median ? 'up' : 'down') + '">' + (r.rev >= median ? '+' : '−') + Math.abs(Math.round((r.rev - median) / (median || 1) * 100)) + '%</span></td></tr>').join('');
  }

  function renderAnaStores() {
    const pf = anaPeriodFactor() * anaChannelFactor();
    const stores = [
      { name: 'Покровка', rev: 370400, checks: 1610, loyalty: 74, delta: 12, spark: '0,17 12,14 24,12 36,9 48,10 60,5 72,6' },
      { name: 'Арбат', rev: 213800, checks: 980, loyalty: 71, delta: 6, spark: '0,7 12,9 24,8 36,4 48,6 60,3 72,5' },
      { name: 'Депо', rev: 128200, checks: 514, loyalty: 68, delta: -4, spark: '0,4 12,3 24,6 36,5 48,8 60,7 72,9' }
    ].filter((s) => anaPoint === 'all' || s.name === anaPoint);
    document.getElementById('anaStoresBody').innerHTML = stores.map((s) => {
      const rev = s.rev * pf;
      const checks = Math.round(s.checks * pf);
      return '<tr class="clickable" data-ana-store="' + s.name + '"><td><span class="t-type" style="font-size:11.5px">' + s.name + '</span></td><td class="num-r"><span class="t-money">' + nf.format(Math.round(rev)) + ' ₽</span></td><td class="num-r"><span class="t-num">' + nf.format(checks) + '</span></td><td class="num-r"><span class="t-num">' + nf.format(Math.round(rev / (checks || 1))) + ' ₽</span></td><td class="num-r"><span class="t-num">' + s.loyalty + '%</span></td><td class="num-r"><span class="delta ' + (s.delta >= 0 ? 'up' : 'down') + '">' + (s.delta >= 0 ? '↑' : '↓') + ' ' + Math.abs(s.delta) + '%</span></td><td><svg width="86" height="22" viewBox="0 0 72 22" fill="none" preserveAspectRatio="none"><polyline points="' + s.spark + '" stroke="' + (s.delta >= 0 ? '#1b6b52' : '#a83a2c') + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></td></tr>';
    }).join('');
  }

  function renderAnaAI() {
    const cards = {
      overview: [
        { id: 'ana-rev', sev: 'warn', title: 'Провал вторника 14:00–16:00', why: 'Выручка ниже среднего на 18% — стоит проверить график смен', primary: { label: 'Открыть тепловую карту', action: 'analytics-hours' }, secondary: { label: 'Сравнить', nav: 'compare' } },
        { id: 'ana-aff', sev: 'info', title: 'Круассан к капучино — 18%', why: 'Ниже обычных 25%: есть куда расти в рекомендациях', primary: { label: 'Открыть меню', action: 'analytics-sales' }, secondary: { label: 'Меню', nav: 'menu' } },
        { id: 'ana-sleep', sev: 'warn', title: 'Спящих стало на 40 больше', why: '412 карт без покупок 45+ дней — повод для напоминания', primary: { label: 'Открыть клиентов', action: 'analytics-customers' }, secondary: { label: 'Клиенты', nav: 'customers' } }
      ],
      sales: [
        { id: 'ana-sales-1', sev: 'info', title: 'Круассан — точка роста', why: 'Высокий средний чек, но связка с капучино ниже нормы', primary: { label: 'Открыть клиентов', action: 'analytics-customers' }, secondary: { label: 'Контент', nav: 'content' } }
      ],
      hours: [
        { id: 'ana-hours-1', sev: 'warn', title: 'Пик в 15:00–17:00', why: 'Поставьте второго бариста и подготовьте выпечку заранее', primary: { label: 'Открыть персонал', action: 'analytics-sales' }, secondary: { label: 'Смены', nav: 'staff' } }
      ],
      customers: [
        { id: 'ana-cust-1', sev: 'warn', title: 'Спящие +40 карт', why: 'Сегмент вырос; мягкое напоминание в PWA может вернуть часть', primary: { label: 'Открыть клиентов', action: 'analytics-customers' }, secondary: { label: 'Контент', nav: 'content' } }
      ],
      stores: [
        { id: 'ana-stores-1', sev: 'info', title: 'Покровка растёт быстрее сети', why: '+12% против +6% у Арбата и −4% у Депо', primary: { label: 'Сравнить точки', action: 'analytics-stores' }, secondary: { label: 'Сравнение', nav: 'compare' } }
      ]
    };
    const map = { overview: 'anaAIFeed', sales: 'anaSalesAI', hours: 'anaHoursAI', customers: 'anaCustAI', stores: 'anaStoresAI' };
    Object.keys(map).forEach((k) => {
      const el = document.getElementById(map[k]);
      if (el) el.innerHTML = aiList(cards[k], 'compact');
    });
  }

  function renderAnalytics() {
    renderAnaKpis();
    renderAnaChart();
    renderAnaCategory();
    renderAnaTop();
    renderAnaHeat();
    renderAnaCustomers();
    renderAnaStaff();
    renderAnaStores();
    renderAnaAI();
  }

  function setAnaTab(tab) {
    anaTab = tab;
    document.querySelectorAll('[data-ana-tab]').forEach((b) => b.classList.toggle('is-on', b.dataset.anaTab === tab));
    document.querySelectorAll('[data-ana-panel]').forEach((p) => { p.hidden = p.dataset.anaPanel !== tab; });
    document.querySelector('.content').scrollTop = 0;
  }

  document.getElementById('anaTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ana-tab]');
    if (b) setAnaTab(b.dataset.anaTab);
  });
  document.getElementById('anaPeriod').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ana-period]');
    if (!b) return;
    anaPeriod = b.dataset.anaPeriod;
    document.querySelectorAll('#anaPeriod button').forEach((x) => x.classList.toggle('is-on', x === b));
    renderAnalytics();
  });
  document.getElementById('anaPoint').addEventListener('change', (e) => { anaPoint = e.target.value; renderAnalytics(); });
  document.getElementById('anaChannel').addEventListener('change', (e) => { anaChannel = e.target.value; renderAnalytics(); });
  document.getElementById('anaStaffEmptyBtn').addEventListener('click', () => {
    anaStaffEmpty = !anaStaffEmpty;
    document.getElementById('anaStaffEmptyBtn').textContent = anaStaffEmpty ? 'Демо: вернуть данные' : 'Демо: нет данных';
    renderAnaStaff();
  });

  function openAnaDrill(title, meta, kpis, rows) {
    document.getElementById('anaDrawerTitle').textContent = title;
    document.getElementById('anaDrawerMeta').textContent = meta;
    document.getElementById('anaDrawerBody').innerHTML =
      '<div class="pur-summary">' + kpis.map((k) => '<div><span>' + k[0] + '</span><b>' + k[1] + '</b></div>').join('') + '</div>' +
      '<div class="sup-sec-title">Детали</div><div class="sup-list">' + rows.map((r) => '<div class="sup-list-row"><span>' + r[0] + '</span><span class="r">' + r[1] + '</span></div>').join('') + '</div>' +
      '<p class="pd-note" style="margin-top:12px">Drill-down по фактам: дальше можно открыть список чеков или позиций.</p>';
    closeAll();
    document.getElementById('anaDrawer').classList.add('is-on');
    syncScrim();
  }
  document.getElementById('anaClose').addEventListener('click', () => { document.getElementById('anaDrawer').classList.remove('is-on'); syncScrim(); });

  document.getElementById('anaRevenueChart').addEventListener('pointermove', (e) => {
    const d = anaData[anaPeriod];
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const i = Math.round(ratio * (d.values.length - 1));
    const tip = document.getElementById('anaChartTip');
    tip.querySelector('b').textContent = nf.format(Math.round(d.values[i] * anaScale())) + ' ₽';
    tip.querySelector('span').textContent = d.labels[i];
    tip.style.left = (ratio * r.width) + 'px';
    tip.style.top = Math.max(30, e.clientY - r.top) + 'px';
    tip.style.opacity = 1;
  });
  document.getElementById('anaRevenueChart').addEventListener('pointerleave', () => { document.getElementById('anaChartTip').style.opacity = 0; });
  document.getElementById('anaRevenueChart').addEventListener('click', (e) => {
    const c = e.target.closest('[data-ana-day]');
    if (!c) return;
    const d = anaData[anaPeriod];
    const i = Number(c.dataset.anaDay);
    const rev = d.values[i] * anaScale();
    openAnaDrill(d.labels[i], (anaPoint === 'all' ? 'Все точки' : anaPoint) + ' · ' + anaChannelLabel(), [['Выручка', nf.format(Math.round(rev)) + ' ₽'], ['Чеков', nf.format(Math.round(anaChecks() / d.values.length * (anaPeriod === '24h' ? 1 : 1)))], ['Средний чек', nf.format(Math.round(anaAvg())) + ' ₽']], [['Капучино', '31%'], ['Латте', '22%'], ['Раф', '14%'], ['Круассан', '9%']]);
  });
  function anaChannelLabel() { return anaChannel === 'card' ? 'только с картой' : 'все чеки'; }
  document.getElementById('anaHeatmap').addEventListener('click', (e) => {
    const c = e.target.closest('[data-ana-heat]');
    if (!c) return;
    const [d, h] = c.dataset.anaHeat.split('-').map(Number);
    openAnaDrill(anaDays[d] + ', ' + anaHours[h] + ':00', (anaPoint === 'all' ? 'Все точки' : anaPoint) + ' · ' + anaChannelLabel(), [['Выручка', nf.format(Number(c.dataset.value)) + ' ₽'], ['Чеков', nf.format(Math.round(Number(c.dataset.value) / (anaAvg() || 230)))], ['Средний чек', nf.format(Math.round(anaAvg())) + ' ₽']], [['Пик часа', '15:00–17:00'], ['Позиция №1', 'Капучино'], ['Позиция №2', 'Латте']]);
  });
  document.getElementById('anaStoresBody').addEventListener('click', (e) => {
    const r = e.target.closest('[data-ana-store]');
    if (r) openAnaDrill(r.dataset.anaStore, 'Точка · ' + anaPeriodLabel(), [['Выручка', r.children[1].textContent], ['Чеков', r.children[2].textContent], ['Ср. чек', r.children[3].textContent]], [['С картой', r.children[4].textContent], ['Динамика', r.children[5].textContent]]);
  });

  renderAnalytics();

  /* ---------------- help / knowledge base ---------------- */
  const docShotInvoice = `
    <div class="doc-shot">
      <div class="doc-shot-bar"><i></i><i></i><i></i><span>Закупки / новая накладная</span></div>
      <div class="doc-shot-body"><div class="dui">
        <div class="dui-top"><b>Новая накладная</b><span class="pill gray"><i></i>Черновик</span></div>
        <div class="dui-grid">
          <div class="dui-field"><span>Контрагент</span><div class="dui-input sel">Кофейная компания</div></div>
          <div class="dui-field"><span>Точка</span><div class="dui-input sel">Покровка</div></div>
          <div class="dui-field"><span>Дата</span><div class="dui-input">18 окт 2026</div></div>
          <div class="dui-field"><span>Срок оплаты</span><div class="dui-input">1 ноя 2026</div></div>
        </div>
        <div class="dui-table">
          <div class="dui-tr head"><span>Товар</span><span>Кол-во</span><span>Годен до</span><span class="r">Сумма</span></div>
          <div class="dui-tr"><span>Кофе зерно</span><span>5 кг</span><span>2 дек</span><span class="r">6 000 ₽</span></div>
          <div class="dui-tr"><span>Молоко 3,2%</span><span>20 л</span><span>26 окт</span><span class="r">1 800 ₽</span></div>
        </div>
        <div class="dui-summary"><div><span>Сумма</span><b>7 800 ₽</b></div><div><span>Оплачено</span><b>0 ₽</b></div><div><span>Долг</span><b>7 800 ₽</b></div></div>
        <div class="dui-check"><i>✓</i> Принять на склад · остаток увеличится</div>
        <div class="dui-actions"><span class="dui-btn">Отмена</span><span class="dui-btn primary">Провести накладную</span></div>
      </div></div>
      <span class="doc-pin" style="left:42%;top:23%">1</span>
      <span class="doc-pin" style="left:86%;top:23%">2</span>
      <span class="doc-pin" style="left:53%;top:48%">3</span>
      <span class="doc-pin" style="left:86%;top:84%">4</span>
    </div>`;
  const docShotPayment = `
    <div class="doc-shot">
      <div class="doc-shot-bar"><i></i><i></i><i></i><span>Закупки / оплата поставщику</span></div>
      <div class="doc-shot-body"><div class="dui">
        <div class="dui-top"><b>Оплата поставщику</b><span class="pill green"><i></i>Черновик</span></div>
        <div class="dui-grid">
          <div class="dui-field"><span>Контрагент</span><div class="dui-input sel">Молочная ферма</div></div>
          <div class="dui-field"><span>Сумма, ₽</span><div class="dui-input">6 200</div></div>
        </div>
        <div class="dui-table">
          <div class="dui-tr head"><span>Накладная</span><span>Дата</span><span>Долг</span><span class="r">Выбрать</span></div>
          <div class="dui-tr"><span>ПР-0240</span><span>16 окт</span><span>6 200 ₽</span><span class="r">✓</span></div>
          <div class="dui-tr"><span>ПР-0236</span><span>9 окт</span><span>2 700 ₽</span><span class="r">—</span></div>
        </div>
        <div class="dui-summary"><div><span>К оплате</span><b>6 200 ₽</b></div><div><span>Закроет долг</span><b>ПР-0240</b></div></div>
        <div class="dui-actions"><span class="dui-btn">Отмена</span><span class="dui-btn primary">Провести оплату</span></div>
      </div></div>
      <span class="doc-pin" style="left:42%;top:23%">1</span>
      <span class="doc-pin" style="left:86%;top:23%">2</span>
      <span class="doc-pin" style="left:86%;top:49%">3</span>
      <span class="doc-pin" style="left:84%;top:85%">4</span>
    </div>`;
  const docShotInventory = `
    <div class="doc-shot">
      <div class="doc-shot-bar"><i></i><i></i><i></i><span>Склад / инвентаризация</span></div>
      <div class="doc-shot-body"><div class="dui">
        <div class="dui-top"><b>ИНВ-0032 · Покровка</b><span class="pill navy"><i></i>В работе</span></div>
        <div class="dui-zones"><span class="dui-zone on">Все</span><span class="dui-zone">Холодильник</span><span class="dui-zone">Бар</span><span class="dui-zone">Витрина</span></div>
        <div class="dui-inv">
          <div class="dui-inv-row"><div><b>Кофе зерно</b><span>Сухой склад · кг</span></div><input value="3,2"><span class="u">кг</span></div>
          <div class="dui-inv-row"><div><b>Молоко 3,2%</b><span>Холодильник · л</span></div><input value="7,4"><span class="u">л</span></div>
          <div class="dui-inv-row"><div><b>Круассан</b><span>Витрина · шт</span></div><input placeholder="0"><span class="u">шт</span></div>
        </div>
        <div class="dui-progress"><span>3/6</span><i><b></b></i><span>50%</span></div>
        <div class="dui-actions"><span class="dui-btn">Сохранить</span><span class="dui-btn primary">Сдать на проверку</span></div>
      </div></div>
      <span class="doc-pin" style="left:58%;top:25%">1</span>
      <span class="doc-pin" style="left:82%;top:51%">2</span>
      <span class="doc-pin" style="left:44%;top:77%">3</span>
      <span class="doc-pin" style="left:85%;top:87%">4</span>
    </div>`;

  const helpArticles = {
    welcome: {
      group: 'Начать', title: 'Что такое админка 6.7', time: '3 мин', lead: 'Админка 6.7 — это рабочее место владельца и менеджера: касса продаёт, склад считает, закупки закрывают долг, ИИ подсказывает. Начните с этой статьи, чтобы понять границы системы.',
      body: `
        <h2 class="doc-h2">Что внутри</h2>
        <div class="doc-cards">
          <div class="doc-card"><span class="num">01</span><b>Смена</b><span>Чеки, чашки, кэшбэк, ошибки и состояние касс — на одном экране.</span></div>
          <div class="doc-card"><span class="num">02</span><b>Склад и закупки</b><span>Партии, нормы, приходы, долг, оплаты и сверки.</span></div>
          <div class="doc-card"><span class="num">03</span><b>Меню и гости</b><span>Каталог, добавки, лояльность, рефералка и контент PWA.</span></div>
          <div class="doc-card"><span class="num">04</span><b>Аналитика и ИИ</b><span>Цифры по точке, меню и людям; подсказки, которые ведут к действию.</span></div>
        </div>
        <h2 class="doc-h2">Чего в админке нет</h2>
        <ul class="doc-list">
          <li><b>Фискализация</b> остаётся на кассе Эвотор — админка не заменяет налоговый регистратор.</li>
          <li><b>Гостевая PWA</b> — отдельное приложение; здесь только контент и управление.</li>
          <li><b>ИИ не проводит документы</b> и не меняет остатки — решения подтверждает человек.</li>
        </ul>
        <div class="doc-callout info"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M9 8v4M9 5.5v.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span><b>Как читать эту справку</b>Сценарии — для действий. Логика — чтобы понять «почему так». Глоссарий — если встретили незнакомое слово.</span></div>
        <div class="doc-related"><button data-help-article="principles">Принципы учёта</button><button data-help-article="map">Карта разделов</button><button data-help-article="roles">Роли</button></div>`
    },
    principles: {
      group: 'Начать', title: 'Принципы учёта', time: '2 мин', lead: 'Четыре правила, из которых следует всё остальное. Если сомневаетесь, что делать — начните отсюда.',
      body: `
        <div class="doc-principles">
          <div class="doc-principle"><div class="n">01</div><b>Касса продаёт — склад списывает</b><span>Чек в Эвотор — это продажа. Склад списывает сырьё по норме (18 г кофе) или штуку 1:1.</span></div>
          <div class="doc-principle"><div class="n">02</div><b>Приход и деньги — документами</b><span>Накладная создаёт остаток и долг. Оплата закрывает накладную. Без связи с накладной деньги не работают.</span></div>
          <div class="doc-principle"><div class="n">03</div><b>Остаток не правят в ячейке</b><span>Любое расхождение оформляется инвентаризацией, приходом, списанием или возвратом.</span></div>
          <div class="doc-principle"><div class="n">04</div><b>ИИ советует — человек решает</b><span>Подсказка объясняет цифру и предлагает шаг. Проведение и оплату подтверждает пользователь.</span></div>
        </div>
        <h2 class="doc-h2">Быстрый пример</h2>
        <div class="doc-formula">5 кг приход − 1,8 кг расход по 100 чашкам × 18 г<br>= 3,2 кг ожидаемый остаток<br>факт 2,9 кг → недостача 0,3 кг</div>
        <p class="doc-p">Если факт не совпал — не «исправляйте» остаток. Проведите инвентаризацию: она создаст документ, движение и запись в журнале.</p>
        <div class="doc-callout warn"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><path d="M9 2.8 16 15H2L9 2.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 7.2v3.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span><b>Частая ошибка</b>Считать «кружки» складской единицей. Кружка — это продажа; склад кофе — килограммы и граммы.</span></div>
        <div class="doc-related"><button data-help-article="stock-logic">Как списывается кофе</button><button data-help-article="money-logic">Как связаны накладная и оплата</button><button data-help-article="fefo">Что такое FEFO</button></div>`
    },
    map: {
      group: 'Начать', title: 'Карта разделов', time: '4 мин', lead: 'Один экран — один вопрос. Вот куда идти за ответом.',
      body: `
        <div class="doc-map">
          <button data-view="today"><span><b>Сегодня</b><span>Смена: чеки, чашки, ошибки, кассы и задачи.</span></span></button>
          <button data-view="stock"><span><b>Склад</b><span>Партии, сроки, нормы, остатки, инвентаризация.</span></span></button>
          <button data-view="purchases"><span><b>Закупки</b><span>Контрагенты, накладные, долг, оплаты, сверки.</span></span></button>
          <button data-view="menu"><span><b>Меню</b><span>Товары, группы, добавки и выгрузка в Эвотор.</span></span></button>
          <button data-view="customers"><span><b>Клиенты</b><span>Карты, чашки, кэшбэк, приглашения.</span></span></button>
          <button data-view="staff"><span><b>Сотрудники</b><span>Команда, кассы, график и пожелания.</span></span></button>
          <button data-view="analytics"><span><b>Аналитика</b><span>Выручка, меню, часы, клиенты и точки.</span></span></button>
          <button data-view="assistant"><span><b>Помощник</b><span>ИИ-лента, чат и черновики действий.</span></span></button>
        </div>
        <div class="doc-callout info"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M9 8v4M9 5.5v.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span><b>Не ищите «правильную кнопку»</b>Почти всё создаётся из журнала раздела: Накладные → Новая, Инвентаризации → Новая, Заказы → Рассчитать. Кнопка создания всегда в правом верхнем углу.</span></div>
        <div class="doc-related"><button data-help-article="receipt-debt">Приёмка товара</button><button data-help-article="partial-inventory">Инвентаризация</button><button data-help-article="order">Заказ поставщику</button></div>`
    },
    roles: {
      group: 'Начать', title: 'Роли и безопасность', time: '2 мин', lead: 'Кто что видит и почему ИИ не проводит документы за спиной.',
      body: `
        <table class="doc-glossary">
          <tr><td>Владелец</td><td>Все точки, склад, деньги, персонал, аналитика, настройки ИИ. Может проводить инвентаризацию и подтверждать оплаты.</td></tr>
          <tr><td>Менеджер точки</td><td>Своя точка: остатки, приходы, инвентаризация, заказы и возвраты. Не видит чужие точки, если так настроено.</td></tr>
          <tr><td>Исполнитель / бариста</td><td>Ввод факта в инвентаризации без учётного остатка. Не проводит документы и не видит деньги.</td></tr>
          <tr><td>Маркетолог</td><td>Контент, акции и сегменты — без склада и долгов.</td></tr>
        </table>
        <div class="doc-callout warn"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><path d="M9 2.8 16 15H2L9 2.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 7.2v3.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span><b>ИИ никогда не проводит</b>Он готовит черновик, объясняет и предлагает. Оплату, списание, возврат и инвентаризацию подтверждает человек с правами.</span></div>
        <p class="doc-p">Если сотрудник не привязан к чеку, аналитика по людям покажет empty state — это не ошибка, а честное «нет данных».</p>
        <div class="doc-related"><button data-help-article="ai">Что делает ИИ</button><button data-help-article="settlements">Долг и оплата</button></div>`
    },
    'receipt-debt': {
      group: 'Сценарии', title: 'Как принять товар в долг', time: '4 мин', lead: 'Накладная одновременно создаёт остаток и долг перед поставщиком. Оплата может быть сразу, частично или позже.',
      body: `
        <div class="doc-callout info"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M9 8v4M9 5.5v.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span><b>Зачем</b>Без накладной склад не узнает о приходе, а долг поставщику потеряется. Складской приход без денег — дыра в учёте.</span></div>
        <h2 class="doc-h2">Что нужно заранее</h2>
        <ul class="doc-list"><li>Поставщик в справочнике контрагентов (можно создать из накладной).</li><li>Точка и позиции склада.</li><li>Права менеджера точки или владельца.</li></ul>
        <div class="doc-step"><div class="doc-step-n">1</div><div><h4>Откройте «Закупки → Накладные»</h4><p>Нажмите «Новая накладная». Черновик создастся сразу.</p></div></div>
        ${docShotInvoice}
        <div class="doc-step-caption">Накладная: 1 — контрагент, 2 — срок оплаты, 3 — «Годен до» для партии, 4 — провести и принять на склад.</div>
        <div class="doc-step"><div class="doc-step-n">2</div><div><h4>Выберите контрагента и точку</h4><p>Поставщик выбирается только из справочника. Если его нет — «Новый контрагент» рядом с полем: имя и ИНН, затем вернитесь в накладную.</p><p>Срок оплаты задаёт отсрочку. Для постоплаты оставьте «Оплачено сразу» = 0 — вся сумма станет долгом.</p></div></div>
        <div class="doc-step"><div class="doc-step-n">3</div><div><h4>Добавьте позиции</h4><p>Товар, количество в единицах склада, цена и <b>«Годен до»</b>. Для молока, выпечки и другой скоропортящейся продукции срок обязателен: без него партия попадёт в «рисковые».</p></div></div>
        <div class="doc-step"><div class="doc-step-n">4</div><div><h4>Проведите накладную</h4><p>Оставьте «Принять на склад», если товар физически пришёл. Накладная проведётся, остаток увеличится, долг появится во взаиморасчётах.</p></div></div>
        <div class="doc-callout success"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><path d="M3 9.5 7 13.5 15 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span><b>Результат</b>Остаток вырос на 7 800 ₽, долг перед «Кофейной компанией» — 7 800 ₽, в приходах склада появился документ.</span></div>
        <h2 class="doc-h2">Частые ошибки</h2>
        <ul class="doc-list"><li><b>Не проведена накладная</b> — черновик не меняет остаток и не создаёт долг.</li><li><b>Поставщик введён текстом</b> — справочник обязателен: иначе оплата и сверка не свяжутся.</li><li><b>Забыли «Годен до»</b> — партия не попадёт в монитор сроков и FEFO.</li></ul>
        <div class="doc-related"><button data-help-article="pay-invoice">Оплатить накладную</button><button data-help-article="create-supplier">Создать контрагента</button><button data-help-article="money-logic">Как считается долг</button></div>`
    },
    'pay-invoice': {
      group: 'Сценарии', title: 'Как оплатить накладную', time: '3 мин', lead: 'Оплата закрывает долг только тогда, когда связана с накладной. Без привязки деньги не сойдутся со складом.',
      body: `
        <div class="doc-callout info"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M9 8v4M9 5.5v.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span><b>Зачем</b>Оплата без накладной оставит долг висеть, а деньги уйдут «в никуда». Связка «платёж → накладная» — основа сверки.</span></div>
        <div class="doc-step"><div class="doc-step-n">1</div><div><h4>Откройте накладную с долгом</h4><p>«Закупки → Накладные» → фильтр «Без оплаты» или «Просрочены». В карточке нажмите «Оплатить».</p></div></div>
        ${docShotPayment}
        <div class="doc-step-caption">Оплата: 1 — контрагент, 2 — сумма, 3 — какие накладные закрываем, 4 — провести.</div>
        <div class="doc-step"><div class="doc-step-n">2</div><div><h4>Проверьте сумму и накладные</h4><p>Сумма подставится из остатка долга. Можно распределить её по нескольким накладным — отметьте нужные галочками.</p></div></div>
        <div class="doc-step"><div class="doc-step-n">3</div><div><h4>Проведите оплату</h4><p>Статус накладной станет «Оплачена» или «Частично», долг уменьшится, платёж появится в журнале.</p></div></div>
        <div class="doc-callout success"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><path d="M3 9.5 7 13.5 15 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span><b>Результат</b>Долг перед «Молочной фермой» уменьшился на 6 200 ₽, накладная ПР-0240 закрыта.</span></div>
        <div class="doc-callout error"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.3" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 7 11.5 12M11.5 7l-5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span><span><b>Частая ошибка</b>Создать оплату без выбранной накладной. Такой платёж не закроет долг и не пройдёт сверку.</span></div>
        <div class="doc-related"><button data-help-article="settlements">Взаиморасчёты</button><button data-help-article="money-logic">Логика долга</button></div>`
    },
    'partial-inventory': {
      group: 'Сценарии', title: 'Как провести частичную инвентаризацию', time: '4 мин', lead: 'Частичная инвентаризация меняет только выбранные позиции. Остальные остатки не трогает — это не «обнулить склад».',
      body: `
        <div class="doc-callout info"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M9 8v4M9 5.5v.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span><b>Зачем</b>Проверить молоко и выпечку в конце дня, не пересчитывая весь склад. Расхождения станут документом, а не правкой ячейки.</span></div>
        <div class="doc-step"><div class="doc-step-n">1</div><div><h4>Создайте документ</h4><p>«Склад → Инвентаризации» → «Новая инвентаризация». Выберите точку и тип <b>Частичная</b>. Для выбора позиций используйте категории, зоны и поиск.</p></div></div>
        ${docShotInventory}
        <div class="doc-step-caption">Пересчёт: 1 — зоны, 2 — факт, 3 — прогресс, 4 — сдать на проверку.</div>
        <div class="doc-step"><div class="doc-step-n">2</div><div><h4>Введите факт на точке</h4><p>Бариста видит только поле «Факт» — учётный остаток скрыт, чтобы не подгонять цифры. Штуки целые, вес — с десятичными. Можно закрывать зоны по мере обхода.</p></div></div>
        <div class="doc-step"><div class="doc-step-n">3</div><div><h4>Сдайте на проверку</h4><p>Когда все выбранные позиции заполнены, нажмите «Сдать на проверку». Менеджер увидит учёт, факт, разницу и сумму отклонения.</p></div></div>
        <div class="doc-step"><div class="doc-step-n">4</div><div><h4>Проведите</h4><p>После подтверждения остатки по затронутым позициям выравниваются по факту. Документ становится только для чтения, создаётся сличительная ведомость.</p></div></div>
        <div class="doc-callout success"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><path d="M3 9.5 7 13.5 15 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span><b>Результат</b>Молоко: было 7,6 л, факт 7,2 л → недостача 0,4 л. Остальные позиции не изменились.</span></div>
        <div class="doc-callout warn"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><path d="M9 2.8 16 15H2L9 2.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 7.2v3.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span><b>Не оставляйте пустые строки</b>Сплошная инвентаризация не завершится, пока есть незаполненные строки. Для частичной незаполненные позиции просто не входят в документ.</span></div>
        <div class="doc-related"><button data-help-article="full-inventory">Сплошная инвентаризация</button><button data-help-article="stock-logic">Как считается остаток</button><button data-help-article="expiry">Сроки и партии</button></div>`
    },
    'create-supplier': {
      group: 'Сценарии', title: 'Как создать контрагента', time: '2 мин', lead: 'Поставщик — отдельная карточка, а не текст в накладной. Без неё не сойдутся оплаты и сверки.',
      body: `<div class="doc-step"><div class="doc-step-n">1</div><div><h4>Откройте «Закупки → Контрагенты»</h4><p>Нажмите «+ Контрагент». Минимум — название; ИНН желателен для сверки.</p></div></div>
        <div class="doc-step"><div class="doc-step-n">2</div><div><h4>Заполните реквизиты и условия</h4><p>Тип, ИНН/КПП, контакты, отсрочка по умолчанию и банк. Это ускорит накладные и оплаты.</p></div></div>
        <div class="doc-step"><div class="doc-step-n">3</div><div><h4>Сохраните</h4><p>Карточка сразу доступна в накладной. Из накладной можно создать контрагента быстрым способом — имя и ИНН.</p></div></div>
        <div class="doc-callout warn"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><path d="M9 2.8 16 15H2L9 2.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 7.2v3.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span><b>Не заменяйте справочник текстом</b>Иначе у одного поставщика появятся две несвязанные истории.</span></div>
        <div class="doc-related"><button data-help-article="receipt-debt">Приёмка</button><button data-help-article="settlements">Долг</button></div>`
    },
    settlements: {
      group: 'Сценарии', title: 'Смотреть взаиморасчёты', time: '2 мин', lead: '«Взаиморасчёты» отвечают на вопрос: кому и сколько мы должны, что просрочено и когда платить.',
      body: `<p class="doc-p">Откройте «Закупки → Взаиморасчёты». Сверху — общий долг, просрочка и оплачено за месяц. В таблице — долг по каждому поставщику, ближайший срок и последняя оплата.</p>
        <div class="doc-callout info"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M9 8v4M9 5.5v.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span><b>Формула</b>Долг = сумма проведённых накладных − оплаты. Просрочка = долг с истёкшим сроком оплаты.</span></div>
        <p class="doc-p">Нажмите на поставщика — откроется карточка с балансом, движениями и актами сверки. Дальше можно создать оплату или сверку.</p>
        <div class="doc-related"><button data-help-article="pay-invoice">Оплатить</button><button data-help-article="money-logic">Логика</button></div>`
    },
    'full-inventory': {
      group: 'Сценарии', title: 'Сплошная инвентаризация', time: '2 мин', lead: 'Сплошная проверяет все позиции точки. Незаполненные строки блокируют завершение — это защита от случайного обнуления.',
      body: `<p class="doc-p">В мастере выберите тип «Сплошная». Система добавит все позиции склада точки. Заполнять нужно каждую строку; кнопка «Сдать на проверку» заблокируется, пока есть пропуски.</p>
        <div class="doc-callout warn"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><path d="M9 2.8 16 15H2L9 2.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 7.2v3.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span><b>Опасная опция</b>«Остальные = 0» — только для владельца и только осознанно. По умолчанию её нет.</span></div>
        <p class="doc-p">После проверки менеджер видит отклонения и может отправить крупные на пересчёт. Проведение выравнивает остатки и создаёт сличительную ведомость.</p>
        <div class="doc-related"><button data-help-article="partial-inventory">Частичная</button><button data-help-article="stock-logic">Остатки</button></div>`
    },
    expiry: {
      group: 'Сценарии', title: 'Работа со сроками', time: '2 мин', lead: 'Срок живёт на партии, а не только в приходе. Следите за ним в «Складе → Сроки».',
      body: `<p class="doc-p">Партия появляется из накладной: количество и «Годен до». В «Остатках» у позиции есть бейдж срока и раскрытие партий; в карточке номенклатуры — список партий и FEFO.</p>
        <ul class="doc-list"><li><b>Срочно:</b> 0–2 дня или просрочено.</li><li><b>Внимание:</b> 3–14 дней.</li><li><b>Без срока:</b> позиция в рисковых, укажите срок в следующем приходе.</li></ul>
        <p class="doc-p">Для партии доступны «Ускорить продажу», «Списать» и «Вернуть поставщику», если окно возврата ещё открыто.</p>
        <div class="doc-related"><button data-help-article="return">Возврат</button><button data-help-article="fefo">FEFO</button><button data-help-article="order">Заказ</button></div>`
    },
    return: {
      group: 'Сценарии', title: 'Вернуть поставщику', time: '2 мин', lead: 'Возврат — отдельный документ. Он уменьшает остаток и создаёт акт, но не меняет взаиморасчёты в v1.',
      body: `<p class="doc-p">Возврат можно начать из рекомендации по сроку или вручную: «Закупки → Возвраты → + Возврат».</p>
        <div class="doc-step"><div class="doc-step-n">1</div><div><h4>Выберите поставщика, точку и основание</h4><p>Срок, брак или пересорт. При наличии свяжите с накладной прихода.</p></div></div>
        <div class="doc-step"><div class="doc-step-n">2</div><div><h4>Укажите партии и количество</h4><p>Количество не больше остатка партии. Строки можно добавить вручную.</p></div></div>
        <div class="doc-step"><div class="doc-step-n">3</div><div><h4>Проведите</h4><p>Остаток уменьшится, статус станет «Проведён». Распечатайте акт с подписями.</p></div></div>
        <div class="doc-related"><button data-help-article="expiry">Сроки</button><button data-help-article="money-logic">Долг</button></div>`
    },
    order: {
      group: 'Сценарии', title: 'Заказ поставщику', time: '3 мин', lead: 'Заказ можно собрать вручную или рассчитать по расходу, минимуму и кратности. Отправляет его человек.',
      body: `<p class="doc-p">«Закупки → Заказы → Рассчитать заказ». Выберите точку, поставщика и горизонт. Режим «По правилам» считает потребность, «С ИИ» добавляет пояснения, «Ручной» позволяет ввести количество самому.</p>
        <div class="doc-formula">к заказу ≈ max(0,<br>расход × горизонт × 1,15 + минимум − остаток − в пути)<br>с округлением до кратности</div>
        <p class="doc-p">Система покажет «Почему не в заказе», если партия уже горит и заказывать рано. После создания заказа его нужно подтвердить; из подтверждённого можно создать приход.</p>
        <div class="doc-related"><button data-help-article="receipt-debt">Приёмка</button><button data-help-article="expiry">Сроки</button></div>`
    },
    ai: {
      group: 'Сценарии', title: 'Что делает ИИ и чего не делает', time: '2 мин', lead: 'ИИ объясняет цифры и предлагает шаг, но не проводит документы и не меняет остатки.',
      body: `<p class="doc-p">Иконка ✦ в шапке открывает «Ассистента 6.7». Там есть проактивные карточки, чипы вопросов и чат. На рабочих экранах — контекстные подсказки.</p>
        <ul class="doc-list"><li><b>ИИ не считает выручку</b> — цифры приходят из агрегатов.</li><li><b>Не проводит оплату, списание, возврат</b> — только черновик и кнопка перехода.</li><li><b>Не выдумывает</b>: если данных нет, честно пишет об этом.</li></ul>
        <div class="doc-callout info"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M9 8v4M9 5.5v.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span><b>Ключ</b>DeepSeek подключается в «Система → ИИ». Без ключа ассистент работает в mock-режиме.</span></div>
        <div class="doc-related"><button data-help-article="roles">Роли</button><button data-help-article="map">Карта</button></div>`
    },
    'stock-logic': {
      group: 'Логика', title: 'Как списывается кофе и молоко', time: '3 мин', lead: 'Склад считает в килограммах, литрах и штуках. Нормы задаются в граммах и миллилитрах на одну продажу.',
      body: `<p class="doc-p">Капучино 300 мл: кофе 18 г, молоко 150 мл. 40 продаж за день → 720 г кофе и 6 л молока. Склад хранит это в кг и л.</p>
        <div class="doc-formula">расход = продажи × норма на 1 продажу<br>остаток ожидаемый = приход − расход</div>
        <p class="doc-p">Штучные позиции списываются 1:1: продали круассан — минус одна штука. Если у напитка нет нормы, он не списывается: это видно в «Нормах» и в ИИ-подсказках.</p>
        <div class="doc-callout success"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><path d="M3 9.5 7 13.5 15 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span><b>Пример</b>5 кг приход − 1,8 кг расход = 3,2 кг ожидаемо. Факт 2,9 кг → недостача 0,3 кг.</span></div>
        <div class="doc-related"><button data-help-article="partial-inventory">Инвентаризация</button><button data-help-article="fefo">FEFO</button><button data-help-article="principles">Принципы</button></div>`
    },
    'money-logic': {
      group: 'Логика', title: 'Как связаны накладная, долг и оплата', time: '3 мин', lead: 'Три сущности, которые нельзя смешивать: товар пришёл, деньги должны, деньги уплачены.',
      body: `<div class="doc-formula">накладная → остаток + долг<br>оплата → долг − сумма платежа<br>сверка → проверка оборотов</div>
        <p class="doc-p">Накладная проведена — товар на складе, долг в взаиморасчётах. Оплата обязательно связывается с накладной; иначе она не закроет долг. Акт сверки показывает обороты и расхождения, но не меняет долг автоматически.</p>
        <div class="doc-callout warn"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><path d="M9 2.8 16 15H2L9 2.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 7.2v3.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span><b>Частая ошибка</b>Оплатить «просто поставщику» без накладной. Тогда и склад, и сверка будут расходиться.</span></div>
        <div class="doc-related"><button data-help-article="receipt-debt">Приёмка</button><button data-help-article="pay-invoice">Оплата</button><button data-help-article="settlements">Взаиморасчёты</button></div>`
    },
    fefo: {
      group: 'Логика', title: 'Партии и FEFO', time: '2 мин', lead: 'FEFO — «first expired, first out»: списываем с ближайшего срока. В интерфейсе это подпись и приоритет партии.',
      body: `<p class="doc-p">Каждая партия хранит количество, срок и поставщика. Если у молока две партии — 4,2 л до 20 окт и 3,4 л до 26 окт — первой уходит та, что истекает раньше.</p>
        <p class="doc-p">В «Остатках» откройте бейдж срока, чтобы увидеть партии. В «Сроки» — карточки с действиями: ускорить продажу, списать, вернуть. В карточке номенклатуры — минимум, кратность и срок хранения.</p>
        <div class="doc-callout info"><span class="q-ic"><svg width="12" height="12" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M9 8v4M9 5.5v.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span><b>Без срока</b>Позиция попадёт в «рисковые» и не будет корректно участвовать в FEFO. Срок указывается в приходе.</span></div>
        <div class="doc-related"><button data-help-article="expiry">Сроки</button><button data-help-article="return">Возврат</button></div>`
    },
    glossary: {
      group: 'Справочник', title: 'Глоссарий', time: '3 мин', lead: 'Слова, которые встречаются в админке — без жаргона.',
      body: `<table class="doc-glossary">
        <tr><td>Накладная</td><td>Документ прихода товара: позиции, сумма, срок оплаты, долг.</td></tr>
        <tr><td>Оприходование</td><td>Проведение накладной: товар появляется на складе, создаётся долг или оплата.</td></tr>
        <tr><td>Контрагент</td><td>Поставщик в справочнике, с реквизитами и условиями оплаты.</td></tr>
        <tr><td>Долг</td><td>Сумма проведённых накладных минус оплаты. Может быть просроченным.</td></tr>
        <tr><td>Акт сверки</td><td>Документ сверки оборотов с поставщиком за период.</td></tr>
        <tr><td>Складская позиция</td><td>То, что хранится: кофе, молоко, стакан. Не путать с позицией меню.</td></tr>
        <tr><td>Норма / техкарта</td><td>Сколько сырья уходит на одну продажу: 18 г кофе, 150 мл молока.</td></tr>
        <tr><td>Партия</td><td>Количество с одним сроком годности и поставщиком.</td></tr>
        <tr><td>FEFO</td><td>Списание с ближайшего срока годности.</td></tr>
        <tr><td>Инвентаризация</td><td>Документ пересчёта: сплошная (все позиции) или частичная (выбранные).</td></tr>
        <tr><td>Списание порчи</td><td>Уменьшение остатка из-за истечения срока или порчи.</td></tr>
      </table>
      <div class="doc-related"><button data-help-article="principles">Принципы</button><button data-help-article="stock-logic">Логика склада</button></div>`
    }
  };

  const helpGroups = [
    { name: 'Начать', ids: ['welcome', 'principles', 'map', 'roles'] },
    { name: 'Сценарии', ids: ['receipt-debt', 'pay-invoice', 'partial-inventory', 'create-supplier', 'settlements', 'full-inventory', 'expiry', 'return', 'order', 'ai'] },
    { name: 'Логика', ids: ['stock-logic', 'money-logic', 'fefo'] },
    { name: 'Справочник', ids: ['glossary'] }
  ];
  let currentHelp = 'welcome';

  function renderHelpNav() {
    document.getElementById('helpNav').innerHTML = helpGroups.map((g) =>
      '<div class="help-nav-group">' + g.name + '</div>' + g.ids.map((id) =>
        '<button data-help-article="' + id + '"' + (id === currentHelp ? ' class="is-on"' : '') + '>' + helpArticles[id].title + '</button>'
      ).join('')
    ).join('');
  }
  function openHelpArticle(id) {
    const a = helpArticles[id] || helpArticles.welcome;
    currentHelp = id in helpArticles ? id : 'welcome';
    renderHelpNav();
    document.getElementById('helpArticle').innerHTML =
      '<div class="doc-kicker">' + a.group + ' · ' + a.time + ' чтения</div>' +
      '<h1 class="doc-title">' + a.title + '</h1>' +
      '<div class="doc-meta">Обновлено 18 окт 2026<span class="dot"></span>6.7 Coffee<span class="dot"></span>' + a.time + '</div>' +
      '<p class="doc-lead">' + a.lead + '</p>' +
      '<div class="doc-actions"><button class="btn btn-ghost btn-sm" data-toast="Демо: PDF статьи сформирован">Печать / PDF</button><button class="btn btn-ghost btn-sm" data-help-copy>Поделиться</button></div>' +
      a.body +
      '<div class="doc-related"><button data-help-article="welcome">К началу</button><button data-help-article="map">Карта разделов</button><button data-help-article="glossary">Глоссарий</button></div>';
    const content = document.querySelector('.content');
    if (content) content.scrollTop = 0;
  }
  function openHelpFromHash() {
    const h = (location.hash || '').replace('#', '');
    if (h.indexOf('help') === 0) {
      go('help');
      const id = h.replace('help-', '');
      openHelpArticle(id && helpArticles[id] ? id : (helpArticles[h] ? h : 'welcome'));
    }
  }

  document.getElementById('helpNav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-help-article]');
    if (b) openHelpArticle(b.dataset.helpArticle);
  });
  document.getElementById('helpArticle').addEventListener('click', (e) => {
    const b = e.target.closest('[data-help-article]');
    if (b) openHelpArticle(b.dataset.helpArticle);
  });
  document.getElementById('helpSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) { openHelpArticle(currentHelp); return; }
    const hits = Object.keys(helpArticles).filter((id) => (helpArticles[id].title + ' ' + helpArticles[id].lead).toLowerCase().includes(q));
    document.getElementById('helpArticle').innerHTML = '<div class="doc-kicker">Поиск по справке</div><h1 class="doc-title">«' + esc(e.target.value.trim()) + '»</h1><p class="doc-lead">Найдено статей: ' + hits.length + '</p>' + (hits.length ? '<div class="help-results">' + hits.map((id) => '<button class="help-result" data-help-article="' + id + '"><b>' + helpArticles[id].title + '</b><span>' + helpArticles[id].lead + '</span></button>').join('') + '</div>' : '<div class="ai-empty" style="margin-top:12px"><span class="q-ic">?</span><span><b>Ничего не нашлось</b>Попробуйте «накладная», «инвентаризация», «долг» или «FEFO».</span></div>');
  });

  /* public link and share */
  function copyHelpLink() {
    const url = 'help.67coffee.ru';
    if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
    toast('Публичная ссылка скопирована: ' + url);
  }
  document.getElementById('helpShare').addEventListener('click', copyHelpLink);
  document.getElementById('helpCopyLink').addEventListener('click', copyHelpLink);

  /* contextual help */
  const helpContextMap = {
    today: { article: 'principles', title: 'Как читать «Сегодня»', time: '2 мин', tips: ['Сначала смотрите «Требует внимания», потом цифры.', 'Смена — это не отчёт за месяц: период переключается в карточке графика.', 'Касса в шапке — состояние опроса, а не статус смены.'] },
    stock: { article: 'stock-logic', title: 'Склад: с чего начать', time: '3 мин', tips: ['Остаток = приход − расход по нормам.', 'Отклонение оформляется инвентаризацией, а не правкой ячейки.', 'Сроки и партии — вкладка «Сроки».'] },
    purchases: { article: 'receipt-debt', title: 'Закупки: товар и деньги', time: '4 мин', tips: ['Накладная создаёт остаток и долг.', 'Оплата должна быть связана с накладной.', 'Проведённая накладная с приёмкой увеличивает склад.'] },
    menu: { article: 'principles', title: 'Меню и склад', time: '2 мин', tips: ['Позиция меню — не складская позиция.', 'Норма связывает продажу с сырьём.', 'Без фото и категории товар хуже виден в PWA.'] },
    analytics: { article: 'map', title: 'Как читать аналитику', time: '3 мин', tips: ['Сначала цифра, потом ИИ-вывод.', 'Фильтры периода применяются ко всем виджетам.', 'Клик по точке графика — детализация.'] },
    customers: { article: 'glossary', title: 'Клиенты и лояльность', time: '2 мин', tips: ['Клиент определяется картой.', 'Чашки и кэшбэк — разные сущности.', 'Телефон скрыт и показывается по действию.'] },
    staff: { article: 'roles', title: 'Сотрудники и роли', time: '2 мин', tips: ['Без привязки кассы табель не привязан к сотруднику.', 'Исполнитель видит только факт.', 'График сохраняется перед отправкой на кассы.'] },
    assistant: { article: 'ai', title: 'Что делает ИИ', time: '2 мин', tips: ['ИИ не проводит документы.', 'Ответ всегда содержит источник.', 'Черновик действия подтверждает человек.'] },
    system: { article: 'roles', title: 'Система и доступ', time: '2 мин', tips: ['Ключ DeepSeek хранится на сервере.', 'Сброс данных отключён защитой.', 'Логи и журнал — для разбора ошибок.'] }
  };
  let helpCtxArticle = 'welcome';
  function openContextHelp() {
    const active = document.querySelector('.view.is-active');
    const view = active ? active.dataset.view : 'today';
    const c = helpContextMap[view] || helpContextMap.today;
    helpCtxArticle = c.article;
    document.getElementById('helpCtxTitle').textContent = c.title;
    document.getElementById('helpCtxMeta').textContent = (helpArticles[c.article] ? helpArticles[c.article].group : 'Справка') + ' · 6.7 Coffee';
    document.getElementById('helpCtxTime').textContent = c.time;
    document.getElementById('helpCtxBody').innerHTML =
      '<p class="doc-p">' + (helpArticles[c.article] ? helpArticles[c.article].lead : 'Короткая справка по разделу.') + '</p>' +
      '<div class="help-ctx-tips">' + c.tips.map((t, i) => '<div class="help-tip"><span class="n">' + (i + 1) + '</span><span>' + t + '</span></div>').join('') + '</div>' +
      '<div class="help-ctx-related"><button data-help-article="' + c.article + '">Открыть статью полностью →</button><button data-help-article="map">Карта всех разделов →</button></div>';
    closeAll();
    document.getElementById('helpDrawer').classList.add('is-on');
    syncScrim();
  }
  document.getElementById('openContextHelp').addEventListener('click', openContextHelp);
  document.getElementById('helpCtxClose').addEventListener('click', () => { document.getElementById('helpDrawer').classList.remove('is-on'); syncScrim(); });
  document.getElementById('helpCtxOpen').addEventListener('click', () => { go('help'); openHelpArticle(helpCtxArticle); });
  document.getElementById('helpCtxShare').addEventListener('click', copyHelpLink);
  document.getElementById('helpDrawer').addEventListener('click', (e) => {
    const b = e.target.closest('[data-help-article]');
    if (b) { go('help'); openHelpArticle(b.dataset.helpArticle); }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-help-copy]');
    if (b) copyHelpLink();
  });

  renderHelpNav();
  openHelpArticle('welcome');

  /* ---------------- content ---------------- */
  function setContentTab(tab) {
    document.querySelectorAll('[data-content-tab]').forEach((b) => b.classList.toggle('is-on', b.dataset.contentTab === tab));
    document.querySelectorAll('[data-content-panel]').forEach((p) => { p.hidden = p.dataset.contentPanel !== tab; });
  }
  document.getElementById('contentTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-content-tab]');
    if (b) setContentTab(b.dataset.contentTab);
  });
  document.getElementById('contentGrid').addEventListener('click', (e) => {
    const t = e.target.closest('[data-content-toggle]');
    if (!t) return;
    const card = t.closest('[data-content-id]');
    const status = card.querySelector('[data-content-status]');
    const published = status.textContent.indexOf('Опубликовано') > -1;
    status.className = 'pill ' + (published ? 'amber' : 'green');
    status.innerHTML = '<i></i>' + (published ? 'Черновик' : 'Опубликовано');
    t.textContent = published ? 'Опубликовать' : 'Снять';
    toast(published ? 'Контент снят с публикации' : 'Контент опубликован');
  });

  /* ---------------- referrals ---------------- */
  const referralData = {
    '24h': {
      invited: 19, bought: 12, bonus: 1840, links: 19,
      rows: [
        { from: 'anna_k', to: 'elena_l', status: 'bought', bonus: 149, date: '18 окт' },
        { from: 'm_petrov', to: 'roma_t', status: 'wait', bonus: 0, date: '18 окт' },
        { from: 'kate_s', to: 'olga_m', status: 'bought', bonus: 212, date: '18 окт' },
        { from: 'd_volkov', to: 's_belova', status: 'bought', bonus: 96, date: '18 окт' }
      ]
    },
    '7d': {
      invited: 128, bought: 84, bonus: 12480, links: 128,
      rows: [
        { from: 'anna_k', to: 'elena_l', status: 'bought', bonus: 149, date: '18 окт' },
        { from: 'm_petrov', to: 'roma_t', status: 'wait', bonus: 0, date: '17 окт' },
        { from: 'kate_s', to: 'olga_m', status: 'bought', bonus: 212, date: '16 окт' },
        { from: 'd_volkov', to: 's_belova', status: 'bought', bonus: 96, date: '15 окт' },
        { from: 'anna_k', to: 'p_orlov', status: 'wait', bonus: 0, date: '14 окт' },
        { from: 'elena_l', to: 'm_polyakova', status: 'bought', bonus: 184, date: '13 окт' }
      ]
    },
    '30d': {
      invited: 512, bought: 341, bonus: 48620, links: 512,
      rows: [
        { from: 'kate_s', to: 'olga_m', status: 'bought', bonus: 212, date: '18 окт' },
        { from: 'anna_k', to: 'elena_l', status: 'bought', bonus: 149, date: '17 окт' },
        { from: 'd_volkov', to: 's_belova', status: 'bought', bonus: 96, date: '16 окт' },
        { from: 'm_petrov', to: 'roma_t', status: 'wait', bonus: 0, date: '15 окт' },
        { from: 'elena_l', to: 'm_polyakova', status: 'bought', bonus: 184, date: '13 окт' },
        { from: 'anna_k', to: 'p_orlov', status: 'wait', bonus: 0, date: '11 окт' }
      ]
    }
  };
  let refPeriod = '7d';
  function renderReferrals() {
    const d = referralData[refPeriod];
    document.getElementById('refInvited').textContent = d.invited;
    document.getElementById('refBought').textContent = d.bought;
    document.getElementById('refBonus').textContent = nf.format(d.bonus) + ' ₽';
    document.getElementById('refLinks').textContent = d.links;
    document.getElementById('refBody').innerHTML = d.rows.map((r) => (
      '<tr>' +
        '<td><div class="client-cell"><span class="avatar">' + r.from.slice(0, 2).toUpperCase() + '</span><span class="c-name">' + r.from + '</span></div></td>' +
        '<td><span class="c-name" style="font-size:11px">' + r.to + '</span></td>' +
        '<td><span class="pill ' + (r.status === 'bought' ? 'green' : 'amber') + '"><i></i>' + (r.status === 'bought' ? 'покупка была' : 'ожидание') + '</span></td>' +
        '<td class="num-r"><span class="t-money">' + (r.bonus ? nf.format(r.bonus) + ' ₽' : '—') + '</span></td>' +
        '<td><span class="t-muted">' + r.date + '</span></td>' +
      '</tr>'
    )).join('');
    document.getElementById('refInfo').textContent = 'Показано ' + d.rows.length + ' из ' + d.invited;
  }
  document.getElementById('refPeriod').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ref]');
    if (!b) return;
    refPeriod = b.dataset.ref;
    document.querySelectorAll('#refPeriod button').forEach((x) => x.classList.toggle('is-on', x === b));
    renderReferrals();
  });
  document.getElementById('refCopy').addEventListener('click', () => {
    const val = document.getElementById('refLink').value;
    if (navigator.clipboard) navigator.clipboard.writeText(val).catch(() => {});
    toast('Ссылка скопирована: ' + val);
  });

  /* ---------------- compare ---------------- */
  const compareData = {
    '24h': { label: '24 часа', checks: 428, card: 318, cups: 386, revenue: 96480, noCard: 27, cashback: 1240, gifts: 24 },
    yesterday: { label: 'Вчера', checks: 421, card: 312, cups: 298, revenue: 98400, noCard: 27, cashback: 1180, gifts: 22 },
    '7d': { label: '7 дней', checks: 3104, card: 2210, cups: 2837, revenue: 712400, noCard: 164, cashback: 8920, gifts: 171 },
    '30d': { label: '30 дней', checks: 12980, card: 9430, cups: 12110, revenue: 3042600, noCard: 690, cashback: 38200, gifts: 720 }
  };
  const cmpMetrics = [
    { key: 'checks', label: 'Чеки SELL', fmt: 'num' },
    { key: 'card', label: 'С картой (ops)', fmt: 'num' },
    { key: 'cups', label: 'Чашки', fmt: 'num' },
    { key: 'revenue', label: 'Выручка ops, ₽', fmt: 'money' },
    { key: 'noCard', label: 'Без карты', fmt: 'num', invert: true },
    { key: 'cashback', label: 'Кэшбэк, ₽', fmt: 'money' },
    { key: 'gifts', label: 'Подарки', fmt: 'num' }
  ];
  function cmpFmt(v, fmt) {
    return fmt === 'money' ? nf.format(v) + ' ₽' : nf.format(v);
  }
  function renderCompare() {
    const a = compareData[document.getElementById('cmpA').value];
    const b = compareData[document.getElementById('cmpB').value];
    document.getElementById('cmpSummary').textContent = 'A: ' + a.label + ' · B: ' + b.label;
    document.getElementById('cmpBody').innerHTML = cmpMetrics.map((m) => {
      const av = a[m.key], bv = b[m.key];
      const pct = av ? ((bv - av) / av) * 100 : 0;
      const good = m.invert ? pct < 0 : pct > 0;
      const cls = Math.abs(pct) < 0.05 ? 'flat' : good ? 'up' : 'down';
      const arrow = Math.abs(pct) < 0.05 ? '→' : pct > 0 ? '↑' : '↓';
      const width = Math.min(100, Math.abs(pct) * 3.2);
      return '<tr>' +
        '<td><span class="t-type" style="font-size:11.5px">' + m.label + '</span></td>' +
        '<td class="num-r"><span class="cmp-val">' + cmpFmt(av, m.fmt) + '</span></td>' +
        '<td class="num-r"><span class="cmp-val">' + cmpFmt(bv, m.fmt) + '</span></td>' +
        '<td class="num-r"><span class="cmp-delta ' + cls + '">' + arrow + ' ' + (pct > 0 ? '+' : '') + pct.toFixed(1) + '%</span></td>' +
        '<td><div class="bar-track"><div class="bar-fill ' + (cls === 'flat' ? 'flat' : good ? '' : 'down') + '" style="width:' + Math.max(2, width) + '%"></div></div></td>' +
      '</tr>';
    }).join('');
  }
  ['cmpA', 'cmpB'].forEach((id) => document.getElementById(id).addEventListener('change', renderCompare));
  document.getElementById('cmpSwap').addEventListener('click', () => {
    const a = document.getElementById('cmpA');
    const b = document.getElementById('cmpB');
    const t = a.value; a.value = b.value; b.value = t;
    renderCompare();
    toast('Периоды поменяны местами');
  });

  /* ---------------- events ---------------- */
  const events = [
    { time: '12:41', type: 'doc', title: 'SELL № 008412', sub: 'документ Эвотор', point: 'Покровка', card: '•• 4821', amount: 420, status: 'Обработан' },
    { time: '12:38', type: 'doc', title: 'SELL № 008411', sub: 'документ Эвотор', point: 'Арбат', card: 'без карты', amount: 260, status: 'Получен' },
    { time: '12:31', type: 'doc', title: 'PAYBACK № 008409', sub: 'возврат', point: 'Покровка', card: '•• 4821', amount: -260, status: 'Обработан' },
    { time: '12:27', type: 'loyalty', title: 'Начисление чашек', sub: '2 чашки · продажа', point: 'Депо', card: '•• 3907', amount: 0, status: 'Ошибка' },
    { time: '12:22', type: 'loyalty', title: 'Кэшбэк 3%', sub: 'реферальная связка', point: 'Арбат', card: '•• 5120', amount: 16.2, status: 'Обработан' },
    { time: '12:09', type: 'doc', title: 'SELL № 008406', sub: 'документ Эвотор', point: 'Покровка', card: 'без карты', amount: 240, status: 'Обработан' },
    { time: '11:58', type: 'loyalty', title: 'Спор по чеку', sub: 'начисление чашек', point: 'Депо', card: '•• 8842', amount: 0, status: 'Спор' },
    { time: '11:47', type: 'doc', title: 'SELL № 008404', sub: 'документ Эвотор', point: 'Арбат', card: '•• 2270', amount: 260, status: 'Ошибка' },
    { time: '11:35', type: 'doc', title: 'SELL № 008403', sub: 'документ Эвотор', point: 'Покровка', card: '•• 4821', amount: 620, status: 'Обработан' },
    { time: '11:21', type: 'doc', title: 'PAYBACK № 008401', sub: 'возврат', point: 'Арбат', card: '•• 2270', amount: -180, status: 'Обработан' },
    { time: '11:14', type: 'loyalty', title: 'Начисление чашек', sub: '2 чашки · продажа', point: 'Депо', card: '•• 3907', amount: 0, status: 'Обработан' },
    { time: '10:58', type: 'doc', title: 'SELL № 008399', sub: 'документ Эвотор', point: 'Покровка', card: '•• 7712', amount: 300, status: 'Обработан' }
  ];
  const eventMeta = {
    'Обработан': 'green', 'Получен': 'navy', 'Ошибка': 'red', 'Спор': 'amber'
  };
  let eventType = 'all';
  function renderEvents() {
    const q = document.getElementById('eventSearch').value.trim().toLowerCase();
    const rows = events.filter((e) => {
      const okType = eventType === 'all' || e.type === eventType;
      const okQ = !q || e.card.toLowerCase().includes(q) || e.title.toLowerCase().includes(q) || e.point.toLowerCase().includes(q);
      return okType && okQ;
    });
    document.getElementById('eventsBody').innerHTML = rows.map((e) => (
      '<tr>' +
        '<td><span class="t-time">' + e.time + '</span></td>' +
        '<td><span class="event-type ' + e.type + '"><i></i>' + e.title + '</span><span class="event-sub">' + e.sub + '</span></td>' +
        '<td><span class="t-muted">' + (e.type === 'doc' ? 'Документ' : 'Лояльность') + '</span></td>' +
        '<td><span class="t-muted">' + e.point + '</span></td>' +
        '<td><span class="t-muted">' + e.card + '</span></td>' +
        '<td class="num-r"><span class="t-money">' + (e.amount ? money(e.amount) : '—') + '</span></td>' +
        '<td><span class="pill ' + (eventMeta[e.status] || 'gray') + '"><i></i>' + e.status + '</span></td>' +
      '</tr>'
    )).join('');
    document.getElementById('eventsEmpty').style.display = rows.length ? 'none' : 'block';
    document.getElementById('eventsInfo').textContent = 'Показано ' + rows.length + ' из 248';
  }
  document.getElementById('eventChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-event]');
    if (!b) return;
    eventType = b.dataset.event;
    document.querySelectorAll('#eventChips .chip').forEach((x) => x.classList.toggle('is-on', x === b));
    renderEvents();
  });
  document.getElementById('eventSearch').addEventListener('input', renderEvents);

  /* ---------------- assistant ---------------- */
  const aiAnswers = {
    catalog: '<h4>Каталог: три проблемы</h4><p>14 товаров без фото, 3 без категории, 5 напитков без схемы добавок. Это влияет на гостя и на работу бариста.</p><ul><li><b>Фото:</b> начните с 5 самых продаваемых — Латте, Раф, Флэт уайт, Круассан, Ледяной чай.</li><li><b>Категории:</b> три позиции не попадут в фильтры PWA.</li><li><b>Схемы:</b> Раф и Матча латте останутся без добавок на кассе.</li></ul><p>Предлагаю сегодня закрыть фото и категории, схемы — после согласования с бариста.</p>',
    cups: '<h4>Почему чашки отстают от чеков</h4><p>За 24 часа 27 продаж прошли без карты. Это 6,3% чеков: чашки не начислены, гость не получил прогресс.</p><ul><li>Пик — с 12:00 до 15:00, чаще на Арбате.</li><li>Средний чек без карты — 248 ₽.</li><li>Если вернуть половину, это +13 чашек в день.</li></ul><p>Черновик для бариста: «Спросите карту до оплаты — 6-й напиток ближе».</p>',
    summary: '<h4>Сводка за смену</h4><p>412 продаж, 386 чашек, 2 ошибки обработки, 27 продаж без карты. Выручка по 6.7 — 96 480 ₽.</p><ul><li>Касса работает, но Арбат не опрашивался 3 часа.</li><li>2 чека ждут повторной обработки.</li><li>14 товаров без фото — это следующий быстрый шаг.</li></ul>',
    drink: '<h4>Идея новинки: Раф «Лаванда»</h4><p>Эспрессо, сливки, лавандовый сироп. Подача в 300 мл, цена 340 ₽ — как текущий Раф ванильный.</p><ul><li>Схема: Все сиропы + молочная альтернатива.</li><li>Считается чашкой: да.</li><li>Фото: верхний кадр с сухоцветом на крафте.</li></ul><p>Это черновик: цену и состав нужно подтвердить перед публикацией.</p>',
    text: '<h4>Текст для карточки в PWA</h4><p><b>Раф «Лаванда»</b><br>Мягкий раф с лавандовым сиропом и сливками. Осень в стакане — пока не закончилась.</p><p>Короткая версия для баннера: «Лаванда. Тепло. 340 ₽».</p><p>Ничего не публикуется автоматически — проверьте тон и цену.</p>',
    generic: '<h4>Черновик ответа</h4><p>Я вижу данные смены, каталог и лояльность. Могу собрать сводку, найти проблемы в каталоге или предложить текст для PWA.</p><p>Уточните, что важнее: деньги, чашки, каталог или гости.</p>'
  };
  function showAI(key, query) {
    const html = aiAnswers[key] || aiAnswers.generic;
    const answer = document.getElementById('aiAnswer');
    answer.innerHTML = html;
    document.getElementById('aiSub').textContent = query ? 'запрос: «' + query + '»' : 'готовый сценарий · отредактируйте перед публикацией';
    document.querySelectorAll('#aiPrompts button').forEach((b) => b.classList.toggle('is-on', b.dataset.ai === key));
  }
  document.getElementById('aiPrompts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ai]');
    if (b) showAI(b.dataset.ai);
  });
  function sendAI() {
    const inp = document.getElementById('aiInput');
    const q = inp.value.trim();
    if (!q) { inp.focus(); return; }
    showAI('generic', q);
    inp.value = '';
    toast('Черновик готов · проверьте перед публикацией');
  }
  document.getElementById('aiSend').addEventListener('click', sendAI);
  document.getElementById('aiInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendAI(); });
  document.getElementById('aiCopy').addEventListener('click', () => {
    const text = document.getElementById('aiAnswer').innerText;
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  });

  /* ---------------- system ---------------- */
  const journal = [
    { time: '12:41', section: 'Товары', change: '«Латте 400 мл» — загружено фото', who: 'Дмитрий' },
    { time: '12:20', section: 'Меню', change: 'Выгрузка в Эвотор: 86 товаров', who: 'Дмитрий' },
    { time: '11:58', section: 'Клиенты', change: 'Карта •• 3907 — открыт телефон', who: 'Анна' },
    { time: '11:32', section: 'Группы', change: '«Еда» скрыта в PWA', who: 'Дмитрий' },
    { time: '10:05', section: 'Контент', change: '«Осеннее меню» опубликовано', who: 'Мария' },
    { time: '09:18', section: 'Система', change: 'Включён ИИ, модель deepseek-chat', who: 'Дмитрий' }
  ];
  function renderJournal() {
    document.getElementById('journalBody').innerHTML = journal.map((j) => (
      '<tr><td><span class="t-time">' + j.time + '</span></td><td><span class="t-muted">' + j.section + '</span></td><td><span class="t-type" style="font-size:11.5px;font-weight:550">' + esc(j.change) + '</span></td><td><span class="t-muted">' + j.who + '</span></td></tr>'
    )).join('');
  }
  const logRows = [
    { time: '12:41:03', level: 'info', src: 'server', msg: 'POST /api/admin/menu/products/1 200 142ms' },
    { time: '12:40:58', level: 'warn', src: 'cash', msg: 'evotor poll store=arbat: last success 3h ago' },
    { time: '12:38:12', level: 'info', src: 'app', msg: 'GET /api/admin/dashboard?period=24h 200 64ms' },
    { time: '12:31:44', level: 'error', src: 'cash', msg: 'document 008409: card not found, queued for retry' },
    { time: '12:22:09', level: 'info', src: 'server', msg: 'loyalty accrual card=5120 cups=3' },
    { time: '12:09:51', level: 'warn', src: 'app', msg: 'search query "4821" returned 1 customer' },
    { time: '11:58:26', level: 'error', src: 'cash', msg: 'document 008404: loyalty dispute opened' },
    { time: '11:47:02', level: 'info', src: 'server', msg: 'GET /api/admin/operations?view=errors 200 38ms' }
  ];
  let logSrc = 'all';
  function renderLogs() {
    const rows = logRows.filter((l) => logSrc === 'all' || l.src === logSrc);
    document.getElementById('logList').innerHTML = rows.map((l) => (
      '<div class="log-row"><span class="log-time">' + l.time + '</span><span class="log-level ' + l.level + '">' + l.level + '</span><span class="log-src">' + l.src + '</span><span class="log-msg">' + esc(l.msg) + '</span></div>'
    )).join('');
    document.getElementById('logInfo').textContent = 'Показано ' + rows.length + ' из 248 · буфер 500 строк';
  }
  document.getElementById('logChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-log]');
    if (!b) return;
    logSrc = b.dataset.log;
    document.querySelectorAll('#logChips .chip').forEach((x) => x.classList.toggle('is-on', x === b));
    renderLogs();
  });
  document.getElementById('copyLogs').addEventListener('click', () => {
    const text = document.getElementById('logList').innerText;
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    toast('Логи скопированы');
  });

  function setSysTab(tab) {
    document.querySelectorAll('[data-sys-tab]').forEach((b) => b.classList.toggle('is-on', b.dataset.sysTab === tab));
    document.querySelectorAll('[data-sys-panel]').forEach((p) => { p.hidden = p.dataset.sysPanel !== tab; });
  }
  document.getElementById('sysTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sys-tab]');
    if (b) setSysTab(b.dataset.sysTab);
  });
  let aiEnabled = true;
  document.getElementById('aiEnableRow').addEventListener('click', () => {
    aiEnabled = !aiEnabled;
    document.getElementById('aiEnableSwitch').classList.toggle('on', aiEnabled);
    document.getElementById('aiEnableRow').setAttribute('aria-pressed', aiEnabled);
    const pill = document.getElementById('aiStatusPill');
    pill.className = 'pill ' + (aiEnabled ? 'green' : 'gray');
    pill.innerHTML = '<i></i>' + (aiEnabled ? 'подключён' : 'выключен');
    toast('ИИ ' + (aiEnabled ? 'включён' : 'выключен'));
  });
  document.getElementById('saveAI').addEventListener('click', () => toast('Настройки ИИ сохранены'));

  function renderStaffInit() { renderStaff(); renderWishes(); }
  renderStaffInit();
  renderSchedule();
  renderReferrals();
  renderCompare();
  renderEvents();
  renderJournal();
  renderLogs();

  fillGroupFilter();
  updateQualityUI();
  renderMenu();
  renderGroups();
  renderSchemes();

  const initialView = (location.hash || '').replace('#', '');
  if (initialView === 'stock-inventory') {
    go('stock');
    setStockTab('inventory');
  } else if (initialView === 'stock-dates') {
    go('stock');
    setStockTab('dates');
  } else if (initialView === 'purchases-orders') {
    go('purchases');
    setPurTab('orders');
  } else if (initialView === 'purchases-returns') {
    go('purchases');
    setPurTab('returns');
  } else if (initialView === 'help' || initialView.indexOf('help-') === 0) {
    go('help');
    openHelpArticle(initialView.indexOf('help-') === 0 ? initialView.replace('help-', '') : 'welcome');
  } else if (navNames[initialView]) {
    go(initialView);
  }
  /* ---------------- cash ---------------- */
  const cashBody = document.getElementById('cashBody');
  function renderCash() {
    cashBody.innerHTML = points.map((p, i) => (
      '<tr>' +
        '<td><div class="point-name"><span class="point-ic"><svg width="13" height="13" viewBox="0 0 18 18" fill="none"><path d="M2.5 7.5 9 2.8l6.5 4.7V15a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V7.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></span><span><b>' + p.name + '</b><span>' + p.addr + '</span></span></div></td>' +
        '<td><button class="sync-toggle ' + (p.enabled ? 'on' : '') + '" data-sync="' + i + '" aria-label="Синхронизация ' + p.name + '" aria-pressed="' + p.enabled + '"></button></td>' +
        '<td><span class="pill ' + (p.status === 'ok' ? 'green' : p.status === 'warn' ? 'amber' : 'red') + '"><i></i>' + p.label + '</span></td>' +
        '<td><span class="t-muted">' + p.last + '</span></td>' +
        '<td class="num-r"><span class="t-num">' + p.queue + '</span></td>' +
        '<td class="num-r"><span class="t-num" ' + (p.errors ? 'style="color:var(--red)"' : '') + '>' + p.errors + '</span></td>' +
        '<td style="text-align:right"><button class="btn btn-ghost btn-sm" data-pollpoint="' + i + '">Опросить</button></td>' +
      '</tr>'
    )).join('');
  }
  renderCash();

  cashBody.addEventListener('click', (e) => {
    const t = e.target.closest('[data-sync]');
    if (t) {
      const i = +t.dataset.sync;
      points[i].enabled = !points[i].enabled;
      toast('Sync для точки «' + points[i].name + '» ' + (points[i].enabled ? 'включён' : 'выключен'));
      renderCash();
    }
  });

  /* polls (all buttons via delegation) */
  function pollPoint(i) {
    points[i].last = 'только что';
    points[i].status = 'ok';
    points[i].label = 'Работает';
    points[i].queue = 0;
    points[i].errors = 0;
    renderPoints();
    renderCash();
    toast('Опрос точки «' + points[i].name + '» выполнен');
  }

  let polling = false;
  function pollAll(btn) {
    if (polling) return;
    polling = true;
    const icon = btn ? btn.querySelector('svg') : null;
    if (icon) icon.classList.add('spin');
    if (btn) btn.disabled = true;
    setTimeout(() => {
      points.forEach((p) => { p.last = 'только что'; p.status = 'ok'; p.label = 'Работает'; p.queue = 0; p.errors = 0; });
      renderPoints();
      renderCash();
      if (icon) icon.classList.remove('spin');
      if (btn) btn.disabled = false;
      polling = false;
      const pill = document.querySelector('.cash-pill');
      if (pill) pill.innerHTML = '<i style="background:var(--green);box-shadow:0 0 0 3px rgba(31,122,90,.12)"></i><span>Касса: 3 из 3</span><span class="t">· только что</span>';
      toast('Синхронизация выполнена: 3 точки, ошибок нет');
    }, 900);
  }

  document.addEventListener('click', (e) => {
    const p = e.target.closest('[data-pollpoint]');
    if (p) { e.preventDefault(); pollPoint(+p.dataset.pollpoint); return; }
    const b = e.target.closest('#pollBtn, #pollAll, #opsPoll');
    if (b) { e.preventDefault(); pollAll(b); }
  });

  /* ---------------- drawer ---------------- */
  const dwBody = document.getElementById('dwBody');
  function openOperation(id) {
    const o = operations.find((x) => x.id === id);
    if (!o) return;
    document.getElementById('dwKicker').textContent = o.status === 'Ошибка' ? 'Операция · ошибка' : o.type + ' · ' + o.status;
    document.getElementById('dwTitle').textContent = o.type + ' № ' + o.id;
    document.getElementById('dwMeta').textContent = '18 октября, ' + o.time + ' · ' + o.store + ' · документ Эвотор';
    const good = o.status === 'Начислено' || o.status === 'Возврат';
    const timeline = [
      { t: 'Документ получен', d: o.time, cls: 'done' },
      { t: 'Обработан', d: o.time, cls: 'done' },
      {
        t: o.status === 'Ошибка' ? 'Ошибка обработки' : o.status === 'Без карты' ? 'Карта не указана' : o.status === 'Спор' ? 'Открыт спор' : 'Начисление записано',
        d: o.status === 'Ошибка' ? 'карта не найдена в базе' : o.status === 'Без карты' ? 'чашки не начислены' : o.status === 'Спор' ? 'ждёт решения администратора' : '+' + o.cups + ' чашек на карту',
        cls: good ? 'done' : 'now'
      }
    ];
    dwBody.innerHTML =
      '<div class="drawer-sec"><h3>Итог</h3><dl class="dl">' +
        '<dt>Сумма чека</dt><dd class="mono">' + money(o.amount) + '</dd>' +
        '<dt>Чашек засчитано</dt><dd class="mono">' + (o.cups > 0 ? '+' : '') + o.cups + '</dd>' +
        '<dt>Кэшбэк</dt><dd class="mono">' + (o.cashback ? money(o.cashback) : '—') + '</dd>' +
        '<dt>Статус</dt><dd><span class="pill ' + (statusPill[o.status] || 'gray') + '"><i></i>' + o.status + '</span></dd>' +
      '</dl></div>' +
      '<div class="drawer-sec"><h3>Карта</h3><dl class="dl">' +
        '<dt>Номер</dt><dd class="mono">' + (o.card === '—' ? 'не указана' : '•• ' + o.card) + '</dd>' +
        '<dt>Ник</dt><dd>' + (o.nick || '—') + '</dd>' +
      '</dl></div>' +
      '<div class="drawer-sec"><h3>Позиции чека</h3><div class="items">' +
        o.items.map((it) => '<div class="item-row"><span class="qty">×' + it.q + '</span><span class="nm">' + esc(it.n) + '</span><span class="pr">' + money(it.p) + '</span></div>').join('') +
      '</div></div>' +
      '<div class="drawer-sec"><h3>Что сделала система</h3><div class="timeline">' +
        timeline.map((x) => '<div class="tl-item ' + x.cls + '"><div class="tl-t">' + x.t + '</div><div class="tl-d">' + x.d + '</div></div>').join('') +
      '</div></div>' +
      (o.status === 'Ошибка' ? '<div class="drawer-sec" style="padding:10px 12px;border-radius:8px;background:var(--red-soft);color:var(--red);font-size:10.5px;line-height:1.55"><b>Почему ошибка:</b> карта •• ' + o.card + ' не найдена в базе 6.7. Чек остался в очереди, повторная обработка не удалит историю.</div>' : '');
    closeAll();
    drawer.classList.add('is-on');
    syncScrim();
  }
  document.getElementById('drawerClose').addEventListener('click', () => { closeDrawer(); syncScrim(); });

  document.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-op]');
    if (row) openOperation(row.dataset.op);
  });

  /* ---------------- palette ---------------- */
  const palInput = document.getElementById('palInput');
  const palList = document.getElementById('palList');
  let palIndex = -1;

  const pages = [
    { label: 'Сегодня', view: 'today', icon: 'home' },
    { label: 'Операции', view: 'operations', icon: 'doc' },
    { label: 'Клиенты', view: 'customers', icon: 'users' },
    { label: 'Меню', view: 'menu', icon: 'cup' },
    { label: 'Касса', view: 'cash', icon: 'card' },
    { label: 'Склад', view: 'stock', icon: 'box' },
    { label: 'Закупки', view: 'purchases', icon: 'purchase' },
    { label: 'Аналитика', view: 'analytics', icon: 'chart' },
    { label: 'Справка', view: 'help', icon: 'book' },
    { label: 'Сотрудники', view: 'staff', icon: 'users' },
    { label: 'Контент', view: 'content', icon: 'photo' },
    { label: 'Рефералка', view: 'referrals', icon: 'share' },
    { label: 'Сравнение', view: 'compare', icon: 'chart' },
    { label: 'События', view: 'events', icon: 'activity' },
    { label: 'Помощник', view: 'assistant', icon: 'star' },
    { label: 'Система', view: 'system', icon: 'sliders' }
  ];
  const icons = {
    home: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M3 8.2 10 2.8l7 5.4V16a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16V8.2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    doc: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M6 2.8h8a1.5 1.5 0 0 1 1.5 1.5v12.4L12.5 15 10 16.6 7.5 15 4.5 16.7V4.3A1.5 1.5 0 0 1 6 2.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    users: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><circle cx="8" cy="7" r="2.9" stroke="currentColor" stroke-width="1.5"/><path d="M2.8 16.4c.5-2.9 2.7-4.5 5.2-4.5s4.7 1.6 5.2 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    cup: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M4 8h9.2v4.2a3.6 3.6 0 0 1-3.6 3.6H7.6A3.6 3.6 0 0 1 4 12.2V8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    card: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><rect x="2.8" y="5" width="14.4" height="10.2" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2.8 8.4h14.4" stroke="currentColor" stroke-width="1.5"/></svg>',
    photo: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><rect x="3" y="3.5" width="14" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="7.5" cy="8" r="1.3" stroke="currentColor" stroke-width="1.4"/><path d="m4.6 14 3.8-3.4 2.7 2.3 2.2-1.9 2.1 3" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    share: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><circle cx="6" cy="10" r="2.2" stroke="currentColor" stroke-width="1.4"/><circle cx="14" cy="5.5" r="2" stroke="currentColor" stroke-width="1.4"/><circle cx="14" cy="14.5" r="2" stroke="currentColor" stroke-width="1.4"/><path d="m8 9 4-2.3M8 11l4 2.3" stroke="currentColor" stroke-width="1.3"/></svg>',
    chart: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M3.5 16.5h13" stroke="currentColor" stroke-width="1.5"/><rect x="4.5" y="9.5" width="2.6" height="4.5" rx=".7" stroke="currentColor" stroke-width="1.3"/><rect x="8.7" y="5.5" width="2.6" height="8.5" rx=".7" stroke="currentColor" stroke-width="1.3"/><rect x="12.9" y="7.6" width="2.6" height="6.4" rx=".7" stroke="currentColor" stroke-width="1.3"/></svg>',
    activity: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M3 10.5h3l1.6-4.2 3 8.2 1.8-5 1.4 2.5H17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    star: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="m10 2.8 1.7 4.4 4.5 1.6-4.5 1.8L10 15l-1.7-4.4L3.8 8.8l4.5-1.6L10 2.8Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    sliders: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M4 6h12M4 10h12M4 14h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="6" r="1.4" stroke="currentColor" stroke-width="1.3"/><circle cx="12.5" cy="10" r="1.4" stroke="currentColor" stroke-width="1.3"/><circle cx="8.5" cy="14" r="1.4" stroke="currentColor" stroke-width="1.3"/></svg>',
    book: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M4 4.5h5.2c.7 0 1.3.6 1.3 1.3v10c0-.7-.6-1.3-1.3-1.3H4v-10ZM16 4.5h-5.2c-.7 0-1.3.6-1.3 1.3v10c0-.7.6-1.3 1.3-1.3H16v-10Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    box: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="m10 2.8 6.3 3.4v7.6L10 17.2l-6.3-3.4V6.2L10 2.8Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="m3.9 6.3 6.1 3.3 6.1-3.3M10 9.6v7.4" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
    purchase: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M4 5.5h12v9H4z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7 9h6M7 12h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
  };

  function paletteItems() {
    return Array.from(palList.querySelectorAll('.pal-item')).filter((el) => el.style.display !== 'none');
  }

  function renderPalette() {
    const q = palInput.value.trim().toLowerCase();
    palList.innerHTML = '';
    palIndex = -1;
    if (!q) {
      palList.innerHTML += '<div class="pal-group">Перейти</div>';
      pages.forEach((p) => {
        palList.innerHTML += '<button class="pal-item" data-palview="' + p.view + '">' + icons[p.icon] + p.label + '<span class="r">↩</span></button>';
      });
      palList.innerHTML += '<div class="pal-group">Действия</div>';
      palList.innerHTML += '<button class="pal-item" data-palaction="poll">' + icons.card + 'Опросить все кассы<span class="r">⌘ ↵</span></button>';
      palList.innerHTML += '<button class="pal-item" data-palaction="export">' + icons.doc + 'Экспорт отчёта<span class="r">⌘ E</span></button>';
      return;
    }
    const pageHits = pages.filter((p) => p.label.toLowerCase().includes(q));
    const custHits = customers.filter((c) => c.card.includes(q) || c.nick.toLowerCase().includes(q)).slice(0, 3);
    const prodHits = products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 3);
    const opHits = operations.filter((o) => o.id.includes(q) || o.card.includes(q) || o.nick.toLowerCase().includes(q)).slice(0, 4);

    if (pageHits.length) {
      palList.innerHTML += '<div class="pal-group">Разделы</div>';
      pageHits.forEach((p) => {
        palList.innerHTML += '<button class="pal-item" data-palview="' + p.view + '">' + icons[p.icon] + p.label + '</button>';
      });
    }
    if (custHits.length) {
      palList.innerHTML += '<div class="pal-group">Клиенты</div>';
      custHits.forEach((c) => {
        palList.innerHTML += '<button class="pal-item" data-palcust="' + c.card + '">' + icons.users + c.nick + '<span class="r">•• ' + c.card + ' · ' + c.cups + ' чаш.</span></button>';
      });
    }
    if (prodHits.length) {
      palList.innerHTML += '<div class="pal-group">Меню</div>';
      prodHits.forEach((p) => {
        palList.innerHTML += '<button class="pal-item" data-palprod="' + esc(p.name) + '">' + icons.cup + esc(p.name) + '<span class="r">' + nf.format(p.price) + ' ₽</span></button>';
      });
    }
    if (opHits.length) {
      palList.innerHTML += '<div class="pal-group">Операции</div>';
      opHits.forEach((o) => {
        palList.innerHTML += '<button class="pal-item" data-palop="' + o.id + '">' + icons.doc + '#' + o.id + ' · ' + (o.nick || 'без карты') + '<span class="r">' + money(o.amount) + '</span></button>';
      });
    }
    if (!palList.children.length) {
      palList.innerHTML = '<div class="empty" style="display:block">Ничего не найдено. Проверьте карту, ник или название.</div>';
    }
  }

  function openPalette() {
    closeSheet(); closeDrawer();
    palette.classList.add('is-on');
    syncScrim();
    palInput.value = '';
    renderPalette();
    setTimeout(() => palInput.focus(), 30);
  }
  document.getElementById('openPalette').addEventListener('click', openPalette);
  palInput.addEventListener('input', renderPalette);

  function runPalItem(el) {
    if (!el) return;
    if (el.dataset.palview) { go(el.dataset.palview); return; }
    if (el.dataset.palcust) {
      go('customers');
      custSearch.value = el.dataset.palcust;
      renderCustomers();
      custSearch.focus();
      return;
    }
    if (el.dataset.palprod) {
      go('menu');
      setMenuTab('products');
      menuSearch.value = el.dataset.palprod;
      renderMenu();
      menuSearch.focus();
      return;
    }
    if (el.dataset.palop) { go('operations'); openOperation(el.dataset.palop); return; }
    if (el.dataset.palaction === 'poll') { go('today'); pollAll(document.getElementById('pollBtn')); return; }
    if (el.dataset.palaction === 'export') { toast('Демо: отчёт за 24 часа собран'); go('today'); }
  }

  palInput.addEventListener('keydown', (e) => {
    const items = paletteItems();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      palIndex = Math.min(items.length - 1, palIndex + 1);
      items.forEach((el, i) => el.classList.toggle('is-sel', i === palIndex));
      if (items[palIndex]) items[palIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      palIndex = Math.max(0, palIndex - 1);
      items.forEach((el, i) => el.classList.toggle('is-sel', i === palIndex));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runPalItem(items[palIndex] || items[0]);
    }
  });
  palList.addEventListener('click', (e) => {
    const el = e.target.closest('.pal-item');
    if (el) runPalItem(el);
  });

  /* ---------------- global overlays ---------------- */
  scrim.addEventListener('click', closeAll);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (palette.classList.contains('is-on')) closeAll(); else openPalette();
    }
    if (e.key === 'Escape') closeAll();
  });

  /* export buttons */
  ['exportBtn', 'opsExport', 'custExport'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => toast('Демо: файл сформирован · строк: 428'));
  });
})();
