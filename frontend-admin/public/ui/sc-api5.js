/* Data layer, part 5: staff (employees, week schedule, wishes). */
(function () {
  'use strict';
  const SC = window.SC;
  const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const SHIFT = { morning: { start: '10:00', end: '16:00' }, evening: { start: '16:00', end: '22:00' } };

  function weekOf(base) {
    const d = new Date(base); d.setHours(0, 0, 0, 0);
    const off = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - off);
    return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return x; });
  }
  SC.weekOf = weekOf; SC.ymd = ymd;

  function codeOf(row) {
    if (!row || row.status === 'off' || row.status === 'day_off') return 'off';
    const h = Number(String(row.start || '').slice(0, 2));
    return !row.start ? 'off' : h >= 14 ? 'evening' : 'morning';
  }

  function wishText(w) {
    let sel = []; try { sel = JSON.parse(w.selectedJson || '[]'); } catch (e) { /* ignore */ }
    const [y, m] = String(w.targetMonth || '').split('-').map(Number);
    const days = (Array.isArray(sel) ? sel : []).map((x) => (typeof x === 'object' && x ? x.day : x)).filter((x) => x != null);
    return { days, text: days.length ? 'Просит ' + days.join(' и ') + ' ' + (MONTHS_GEN[(m || 1) - 1] || '') : 'Пожеланий нет' };
  }
  const WISH_STATUS = { open: 'new', draft: 'new', reviewing: 'new', accepted: 'accept', partial: 'part', declined: 'reject', closed: 'accept' };

  SC.loadStaff = async function () {
    const D = SC.data;
    const put = (k, v) => { if (!D[k]) D[k] = Array.isArray(v) ? [] : {}; if (Array.isArray(v)) { D[k].length = 0; Array.prototype.push.apply(D[k], v); } else { Object.keys(D[k]).forEach((x) => delete D[k][x]); Object.assign(D[k], v); } };
    const staff = (D.staffRaw || []).filter((s) => s.active);
    const [wr, st] = await Promise.all([SC.get('/staff/wishes').catch(() => ({ wishes: [] })), SC.get('/staff').catch(() => ({ staff }))]);
    const list = (st.staff || staff).filter((s) => s.active);
    D.staffRaw = st.staff || staff;
    put('employees', list.map((s) => ({
      name: s.name, role: s.role, _id: s.id, uuid: s.storeUuid ? s.storeUuid : '', device: (D.storeName || {})[s.storeUuid] || (s.storeUuid ? s.storeUuid.slice(0, 6) : '')
    })));
    put('cashOptions', (D.points || []).map((p) => ({ name: p.name, uuid: p.uuid })));
    const week = weekOf(Date.now());
    put('weekDays', week.map((d, i) => ({ label: DAYS[i], date: String(d.getDate()), ymd: ymd(d) })));
    const months = Array.from(new Set(week.map((d) => ymd(d).slice(0, 7))));
    const sched = {};
    await Promise.all(list.map(async (s) => {
      const rows = {};
      await Promise.all(months.map(async (m) => {
        try { ((await SC.get('/staff/schedule?month=' + m + '&staffId=' + s.id)).days || []).forEach((r) => { rows[r.day] = r; }); } catch (e) { /* none */ }
      }));
      sched[s.name] = week.map((d) => codeOf(rows[ymd(d)]));
    }));
    put('schedule', sched);
    put('wishes', (wr.wishes || []).map((w) => {
      const t = wishText(w);
      return { name: (w.staffName || '').split(' ').slice(0, 1).join('') + ' ' + ((w.staffName || '').split(' ')[1] || '').charAt(0) + (((w.staffName || '').split(' ')[1]) ? '.' : ''), full: w.staffName, text: t.text, days: t.days, status: WISH_STATUS[w.status] || 'new', _id: w.id, _month: w.targetMonth };
    }));
    D.wishRulesRaw = (await SC.get('/staff/wish-rules').catch(() => ({ rules: [] }))).rules || [];
  };

  function tgt(o) {
    if (!o) return undefined;
    const t = { label: o.label };
    if (o.nav) t.nav = o.nav;
    if (o.action) { t.action = o.action; if (o.invoiceId) t.invoice = SC.docNo('ПР', o.invoiceId); if (o.stockItemId) t.item = String(o.stockItemId); }
    return t;
  }
  SC.loadAi = async function () {
    const r = await SC.get('/ai/feed').catch(() => ({ cards: [] }));
    if (!SC.data.aiFeed) SC.data.aiFeed = [];
    SC.inplace(SC.data.aiFeed, (r.cards || []).map((c) => ({ id: c.key, sev: c.sev, title: c.title, why: c.why, primary: tgt(c.primary), secondary: tgt(c.secondary) })));
  };
  SC.refreshers = SC.refreshers || {};
  SC.refreshers.staff = SC.loadStaff;
  SC.refreshers.ai = SC.loadAi;
  SC.boot5 = async function () { await SC.loadAi(); await SC.loadStaff(); };
})();
