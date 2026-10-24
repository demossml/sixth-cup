/* 6.7 Coffee admin — data layer.
 * 1) token login (same localStorage key as the classic admin: "admin_token")
 * 2) loads everything the audit UI needs from /api/admin/* and adapts it to the prototype's shapes
 * 3) then injects coffee.js (UI) which reads window.SC.data
 * Nothing here invents data: when an endpoint is empty/unavailable the arrays are empty and the UI shows empty states.
 */
(function () {
  'use strict';
  const KEY = 'admin_token';
  const SC = (window.SC = { data: {}, me: null, errors: [] });

  /* ---------- tokens / fetch ---------- */
  const tok = {
    get() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode */ } },
    clear() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
  };
  SC.token = tok;

  async function api(method, path, body) {
    if (method !== 'GET' && SC.me && SC.me.role === 'viewer') throw new Error('Режим только для чтения: токен наблюдателя не может менять данные');
    const res = await fetch('/api/admin' + path, {
      method,
      headers: Object.assign({ 'X-Admin-Token': tok.get() }, body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* not json */ }
    if (!res.ok) {
      const e = json && json.error;
      let msg = typeof e === 'string' ? e : (e && e.issues && e.issues[0] ? (e.issues[0].path || []).join('.') + ': ' + e.issues[0].message : 'Ошибка ' + res.status);
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return json;
  }
  SC.api = api;
  SC.get = (p) => api('GET', p);
  SC.post = (p, b) => api('POST', p, b === undefined ? {} : b);
  SC.put = (p, b) => api('PUT', p, b);
  SC.patch = (p, b) => api('PATCH', p, b);
  SC.del = (p) => api('DELETE', p);
  SC.upload = async function (file) {
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('/api/admin/upload', { method: 'POST', headers: { 'X-Admin-Token': tok.get() }, body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.url) throw new Error((j && typeof j.error === 'string' && j.error) || 'Не удалось загрузить файл');
    return j.url;
  };

  /* ---------- formatting helpers ---------- */
  const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const pad = (n) => String(n).padStart(2, '0');
  const f = SC.fmt = {
    day: (ms) => { if (!ms) return '—'; const d = new Date(ms); return d.getDate() + ' ' + MON[d.getMonth()]; },
    dayYear: (ms) => { if (!ms) return '—'; const d = new Date(ms); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); },
    hm: (ms) => { if (!ms) return '—'; const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); },
    ago: (ms) => {
      if (!ms) return 'ни разу';
      const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
      if (m < 1) return 'только что';
      if (m < 60) return m + ' мин назад';
      const h = Math.floor(m / 60);
      if (h < 24) return h + ' ч ' + (m % 60) + ' мин назад';
      return Math.floor(h / 24) + ' д назад';
    },
    rub: (kop) => Math.round(Number(kop || 0)) / 100,
    kop: (rub) => Math.round(Number(rub || 0) * 100)
  };

  /** tolerant date parser for free-text fields: "25.12.2026", "25.12", "2 дек", "2 дек 2026", ISO. Returns ms or null. */
  SC.parseDate = function (str) {
    str = String(str || '').trim().toLowerCase();
    if (!str) return null;
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12).getTime();
    m = /^(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?$/.exec(str);
    let d, mo, y;
    if (m) { d = +m[1]; mo = +m[2] - 1; y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : null; }
    else {
      m = /^(\d{1,2})\s+([а-яё]+)\.?(?:\s+(\d{4}))?$/.exec(str);
      if (!m) return null;
      const idx = MON.findIndex((x) => m[2].indexOf(x.slice(0, 3)) === 0);
      if (idx < 0) return null;
      d = +m[1]; mo = idx; y = m[3] ? +m[3] : null;
    }
    const now = new Date();
    if (y == null) { y = now.getFullYear(); if (new Date(y, mo, d, 23).getTime() < now.getTime() - 30 * 86400000) y += 1; }
    return new Date(y, mo, d, 12).getTime();
  };

  /** "Октябрь 2026" | "01.10.2026 – 31.10.2026" | "1 окт – 18 окт" → {from,to} (ms) or null */
  SC.parsePeriod = function (str) {
    str = String(str || '').trim().toLowerCase();
    const m = /^([а-яё]+)\s+(\d{4})$/.exec(str);
    if (m) {
      const idx = MON.findIndex((x) => m[1].indexOf(x.slice(0, 3)) === 0);
      if (idx >= 0) return { from: new Date(+m[2], idx, 1).getTime(), to: new Date(+m[2], idx + 1, 1).getTime() - 1 };
    }
    const parts = str.split(/\s*[–—-]\s*/);
    if (parts.length === 2) {
      const a = SC.parseDate(parts[0]), b = SC.parseDate(parts[1]);
      if (a && b) return { from: a, to: b + 86399999 };
    }
    return null;
  };

  /* ---------- login overlay ---------- */
  function loginOverlay(msg) {
    return new Promise((resolve) => {
      const o = document.createElement('div');
      o.id = 'scLogin';
      o.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--page,#FFFFFF);display:flex;align-items:center;justify-content:center;padding:16px';
      o.innerHTML = '<form style="background:#fff;border:1px solid #D9E6F5;border-radius:14px;padding:28px;width:100%;max-width:360px;box-shadow:0 12px 40px rgba(7,53,97,.10)">' +
        '<img src="/67coffee-mark.png" alt="" style="width:40px;height:40px;border-radius:10px"><h1 style="font-family:var(--font-display,Unbounded,sans-serif);font-weight:600;font-size:20px;letter-spacing:-.02em;color:#101B2D;margin:14px 0 4px">6<span style="display:inline-block;width:.16em;height:.16em;background:currentColor;margin:0 .06em"></span>7 Coffee · Админка</h1>' +
        '<p style="margin:0 0 16px;color:#586B82;font-size:13px">Введите токен доступа</p>' +
        '<input id="scTok" type="password" autocomplete="current-password" placeholder="X-Admin-Token" style="width:100%;box-sizing:border-box;height:42px;border:1px solid #D9E6F5;border-radius:10px;padding:0 12px;font:inherit">' +
        '<div id="scLoginErr" style="color:var(--red,#B4472C);font-size:12.5px;min-height:18px;margin:8px 0 4px">' + (msg || '') + '</div>' +
        '<button class="btn btn-primary" style="width:100%;justify-content:center;height:42px" type="submit">Войти</button></form>';
      document.body.appendChild(o);
      const input = o.querySelector('#scTok');
      input.focus();
      o.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        tok.set(input.value.trim());
        o.remove();
        resolve();
      });
    });
  }

  async function auth() {
    for (;;) {
      if (tok.get()) {
        try { SC.me = await api('GET', '/me'); return; } catch (e) {
          if (e.status === 403 || e.status === 401) { tok.clear(); await loginOverlay('Неверный токен'); continue; }
          throw e;
        }
      }
      await loginOverlay('');
    }
  }

  /* ---------- adapters ---------- */
  const safe = async (name, p, fallback) => { try { return await p; } catch (e) { SC.errors.push(name + ': ' + e.message); return fallback; } };

  function adaptPoints(health, queueByStore) {
    const stores = (health && health.stores) || [];
    return stores.map((s) => {
      const lvl = s.level === 'ok' ? 'ok' : s.level === 'warn' ? 'warn' : s.level === 'off' ? 'warn' : 'bad';
      const label = !s.enabled ? 'Выключена' : s.level === 'ok' ? 'Работает' : s.level === 'warn' ? 'Давно не опрашивалась' : 'Проблема';
      return {
        uuid: s.uuid, name: s.name || s.uuid.slice(0, 8), addr: '', status: s.enabled ? lvl : 'warn', label,
        last: f.ago(s.lastFastAt), lastAt: s.lastFastAt || null, queue: s.outboxPending || 0, errors: (s.failedDocs || 0) + (s.outboxWithError || 0), enabled: !!s.enabled
      };
    });
  }

  function opStatus(o) {
    if (o.status === 'FAILED') return 'Ошибка';
    if (o.type === 'PAYBACK') return 'Возврат';
    if (!o.cardId) return 'Без карты';
    return 'Начислено';
  }
  function adaptOps(list) {
    return list.map((o) => {
      const ret = o.type === 'PAYBACK';
      const rub = Number(o.resultRub || 0);
      return {
        id: String(o.number != null ? o.number : o.docId), type: ret ? 'Возврат' : 'Продажа', store: o.storeName || '—',
        card: o.cardCode || '—', nick: o.nickname || '', amount: ret ? -Math.abs(rub) : rub,
        cups: ret ? -Math.abs(o.cups || 0) : (o.cups || 0), cashback: (ret ? -1 : 1) * Math.abs(o.cashbackKopecks || 0) / 100,
        status: opStatus(o), time: f.hm(o.closedAt), closedAt: o.closedAt, items: null, _store: o.storeUuid, _doc: o.docId, _err: o.lastError || ''
      };
    });
  }

  function adaptCustomers(list) {
    return list.map((c) => ({
      id: c.id, card: c.cardCode || String(c.id), nick: c.nickname || '', cups: c.cups || 0, paid: c.paidTotal || 0,
      cashback: Math.round((c.cashbackBalance || 0) / 100), invited: c.referrals || 0, reg: f.dayYear(c.createdAt), created: Math.floor((c.createdAt || 0) / 1000)
    }));
  }

  function adaptCatalog(prods, cats, schemes, mods, groups, storeName) {
    const catName = new Map(cats.map((c) => [c.id, c.name]));
    const schemeName = new Map(schemes.map((s) => [s.id, s.name]));
    const groupById = new Map((groups || []).map((g) => [g.id, g]));
    const sorted = prods.slice().sort((a, b) => (a.sortOrder - b.sortOrder) || (a.id - b.id));
    const byGroup = new Map();
    const out = [];
    for (const p of sorted) {
      if (p.groupId && groupById.has(p.groupId)) {
        const base = byGroup.get(p.groupId);
        if (base) { base.sizes.push({ v: p.variantLabel || (p.sizeValue ? p.sizeValue + ' ' + (p.sizeUnit === 'g' ? 'г' : 'мл') : 'шт'), p: p.price, _id: p.id }); base._ids.push(p.id); continue; }
      }
      const links = (p.evotorLinks || []).filter((l) => l.enabled !== 0);
      let sync = 'Не на кассе';
      if (links.length) sync = links.some((l) => l.lastError) ? 'Ошибка выгрузки' : links.some((l) => !l.evotorUuid) ? 'Ждёт выгрузки' : 'В кассе';
      const g = p.groupId ? groupById.get(p.groupId) : null;
      const gname = (g && g.name) || p.name;
      const issues = [];
      if (!p.imageUrl && !(g && g.imageUrl)) issues.push('noPhoto');
      if (!p.categoryId) issues.push('noCategory');
      if (!p.modifierSchemeId && p.countsAsCup) issues.push('noScheme');
      if (!links.length) issues.push('noLink');
      const prod = {
        id: p.id, _ids: [p.id], name: g ? gname : p.name, sku: p.sku || p.evotorUuid || ('№' + p.id), group: catName.get(p.categoryId) || 'Без группы', price: p.price,
        cup: !!p.countsAsCup, free: !!p.freeEligible, photo: !!(p.imageUrl || (g && g.imageUrl)), scheme: schemeName.get(p.modifierSchemeId) || 'Без схемы',
        sync, issues, available: links.map((l) => (storeName && storeName[l.storeUuid]) || l.storeUuid.slice(0, 6)), on: !!p.available, categoryId: p.categoryId || null, schemeId: p.modifierSchemeId || null, imageUrl: p.imageUrl || (g && g.imageUrl) || null,
        sizes: [{ v: p.variantLabel || (p.sizeValue ? p.sizeValue + ' ' + (p.sizeUnit === 'g' ? 'г' : 'мл') : 'шт'), p: p.price, _id: p.id }], _raw: p, _group: g || null
      };
      if (p.groupId && g) byGroup.set(p.groupId, prod);
      out.push(prod);
    }
    return out;
  }

  function adaptGroups(cats, prods) {
    const cnt = new Map();
    prods.forEach((p) => cnt.set(p.categoryId, (cnt.get(p.categoryId) || 0) + 1));
    const noCat = prods.filter((p) => !p.categoryId).length;
    const groups = cats.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((c) => ({ id: c.id, name: c.name, count: cnt.get(c.id) || 0, visible: !!c.available }));
    groups.push({ id: null, name: 'Без группы', count: noCat, visible: true, system: true });
    return groups;
  }

  const GROUP_TYPE = { syrup: 'Сироп', topping: 'Топпинг', milk: 'Молоко', other: 'Другое' };
  function adaptAddons(mods) {
    return mods.map((m) => ({ id: m.id, name: m.name, type: GROUP_TYPE[m.groupKey] || 'Другое', groupKey: m.groupKey, price: m.price, on: !!m.available }));
  }
  function adaptSchemes(schemes, mods, prods) {
    const modName = new Map(mods.map((m) => [m.id, m.name]));
    const used = new Map();
    prods.forEach((p) => { if (p.modifierSchemeId) used.set(p.modifierSchemeId, (used.get(p.modifierSchemeId) || 0) + 1); });
    const out = schemes.map((s) => ({ id: s.id, name: s.name, addons: (s.items || []).map((i) => modName.get(i.modifierId)).filter(Boolean), used: used.get(s.id) || 0, _items: s.items || [] }));
    const none = prods.filter((p) => !p.modifierSchemeId && p.countsAsCup).length;
    out.push({ id: null, name: 'Без схемы', addons: [], used: none, warn: true, system: true });
    return out;
  }

  /* ---------- load ---------- */
  async function loadAll() {
    const g = (p, fb) => safe(p, SC.get(p), fb);
    const [dash, health, ops, custPage, prods, cats, schemes, mods, groups, staff, wishes, rules, stores] = await Promise.all([
      g('/dashboard', null), g('/evotor/health', null), g('/operations?limit=100', { ops: [] }),
      g('/customers?limit=100', { customers: [], total: 0 }), g('/products', { products: [] }), g('/categories', { categories: [] }),
      g('/modifier-schemes', { schemes: [] }), g('/modifiers', { modifiers: [] }), g('/product-groups', { groups: [] }),
      g('/staff', { staff: [] }), g('/staff/wishes', { wishes: [] }), g('/staff/wish-rules', { rules: [] }), g('/stores', { stores: [] })
    ]);
    const D = SC.data;
    D.dashboard = dash || {};
    const put = (k, v) => {
      if (Array.isArray(v) && Array.isArray(D[k])) { D[k].length = 0; Array.prototype.push.apply(D[k], v); }
      else if (v && !Array.isArray(v) && typeof v === 'object' && D[k] && typeof D[k] === 'object' && !Array.isArray(D[k])) { Object.keys(D[k]).forEach((x) => delete D[k][x]); Object.assign(D[k], v); }
      else D[k] = v;
    };
    put('points', adaptPoints(health || dash && dash.health));
    put('operations', adaptOps((ops && ops.ops) || []));
    put('customers', adaptCustomers(custPage.customers || []));
    D.customersTotal = custPage.total || 0;
    D.rawProducts = prods.products || [];
    const storeName = {};
    D.points.forEach((pt) => { storeName[pt.uuid] = pt.name; });
    D.storeName = storeName;
    put('products', adaptCatalog(D.rawProducts, cats.categories || [], schemes.schemes || [], mods.modifiers || [], groups.groups || [], storeName));
    put('groups', adaptGroups(cats.categories || [], D.rawProducts));
    put('addons', adaptAddons(mods.modifiers || []));
    put('schemes', adaptSchemes(schemes.schemes || [], mods.modifiers || [], D.rawProducts));
    D.categories = cats.categories || [];
    D.staffRaw = staff.staff || [];
    D.wishesRaw = wishes.wishes || [];
    D.wishRules = rules.rules || [];
    D.stores = stores.stores || [];
    const q = (dash && dash.quality) || {};
    put('qualityCounts', {
      all: D.products.length,
      noPhoto: D.products.filter((p) => p.issues.indexOf('noPhoto') >= 0).length,
      noCategory: D.products.filter((p) => p.issues.indexOf('noCategory') >= 0).length,
      noScheme: D.products.filter((p) => p.issues.indexOf('noScheme') >= 0).length,
      noLink: D.products.filter((p) => p.issues.indexOf('noLink') >= 0).length
    });
    void q;
  }
  SC.adaptOps = adaptOps; SC.adaptCustomers = adaptCustomers;
  SC.reload = async function (names) { await loadAll(); };
  SC.refreshers = SC.refreshers || {};
  SC.refreshers.menu = async function () { await loadAll(); };
  SC.refreshers.cash = async function () { await loadAll(); };

  /* point selects in the static markup are rebuilt from the real stores */
  SC.fillPointSelects = function () {
    const names = SC.data.stockPoints || [];
    const opt = (n) => '<option value="' + n + '">' + n + '</option>';
    const all = '<option value="all">Все точки</option>';
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    set('stockPoint', names.map(opt).join('') + all);
    set('invFilterPoint', all + names.map(opt).join(''));
    set('anaPoint', all + names.map(opt).join(''));
    set('invPoint', names.map(opt).join(''));
    set('rcPoint', names.map(opt).join(''));
  };

  /* ---------- boot ---------- */
  async function boot() {
    try {
      await auth();
      await loadAll();
      if (SC.boot2) await SC.boot2(); // phase B loaders (stock/purchases/analytics), registered by sc-api2.js
    } catch (e) {
      document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:var(--page,#FFFFFF);z-index:9999;font:14px &quot;Golos Text&quot;,sans-serif;padding:20px;text-align:center">Не удалось загрузить данные: ' + (e.message || e) + '<br><button class="btn" onclick="location.reload()" style="margin-top:12px">Повторить</button></div>');
      return;
    }
    SC.fillPointSelects();
    const s = document.createElement('script');
    s.src = '/ui/coffee.js?v=' + Date.now();
    s.onload = () => { const b = document.createElement('script'); b.src = '/ui/sc-bind.js?v=' + Date.now(); document.body.appendChild(b); };
    document.body.appendChild(s);
  }
  SC.boot = boot;

  // further data-layer files are loaded in order, each registers SC.bootN (chain: boot2 → boot3 → boot4 → …)
  const parts = ['sc-api2.js', 'sc-api3.js', 'sc-api4.js', 'sc-api5.js'];
  (function next(i) {
    if (i >= parts.length) { boot(); return; }
    const sc = document.createElement('script');
    sc.src = '/ui/' + parts[i] + '?v=' + Date.now();
    sc.onload = () => next(i + 1);
    sc.onerror = () => next(i + 1);
    document.body.appendChild(sc);
  })(0);
})();
