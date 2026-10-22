/* Data layer, part 2: chart, stock, purchases, analytics, AI, system. Registered as SC.boot2. */
(function () {
  'use strict';
  const SC = window.SC = window.SC || {};
  const f = () => SC.fmt;
  const safe = async (name, p, fb) => { try { return await p; } catch (e) { (SC.errors = SC.errors || []).push(name + ': ' + e.message); return fb; } };
  const pad = (n) => String(n).padStart(2, '0');
  const pct = (cur, prev) => {
    if (!prev) return '';
    const d = ((cur - prev) / prev) * 100;
    return (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1).replace('.', ',') + '%';
  };

  /* ---------- chart (Today) ---------- */
  function adaptSeries(res, period) {
    const pts = (res && res.points) || [];
    const hourly = period === '24h' || period === 'yesterday';
    const labels = pts.map((p) => {
      if (hourly) { const d = new Date(p.t + ':00:00Z'); return pad(d.getHours()); }
      const d = new Date(p.t + 'T00:00:00Z'); return pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth() + 1);
    });
    const n = labels.length;
    const step = n <= 8 ? 1 : n <= 16 ? 2 : Math.ceil(n / 6);
    const ticks = []; for (let i = 0; i < n; i += step) ticks.push(i);
    if (n && ticks[ticks.length - 1] !== n - 1 && !hourly) ticks.push(n - 1);
    const checks = pts.map((p) => Math.max(p.sellDocs, p.sellWithCard));
    return {
      labels, checks, cups: pts.map((p) => p.cups), ticks,
      note: { yesterday: 'по часам · вчера', '24h': 'по часам · последние 24 часа', '7d': 'по дням · 7 дней', '30d': 'по дням · 30 дней' }[period],
      delta: '', totals: (res && res.totals) || null
    };
  }

  async function loadChart() {
    const periods = ['yesterday', '24h', '7d', '30d'];
    const res = await Promise.all(periods.map((p) => safe('series ' + p, SC.get('/analytics/series?period=' + p), null)));
    const out = {};
    periods.forEach((p, i) => { out[p] = adaptSeries(res[i], p); });
    // deltas: compare to previous window of the same length (from the same series API)
    const cmp = await Promise.all(['24h', '7d', '30d'].map((p) => safe('compare ' + p, SC.get('/analytics/compare?period=' + p), null)));
    ['24h', '7d', '30d'].forEach((p, i) => {
      const c = cmp[i];
      if (c && c.previous && c.previous.n) out[p].delta = pct(c.current.n, c.previous.n) + ' к ' + { '24h': 'вчера', '7d': 'прошлой неделе', '30d': 'прошлому периоду' }[p];
      else out[p].delta = 'нет данных за прошлый период';
    });
    out.yesterday.delta = 'сутки целиком';
    SC.data.chartData = out;
    SC.data.compare24 = cmp[0] || {};
  }

  SC.boot2 = async function () {
    SC.data = SC.data || {};
    await loadChart();
    if (SC.boot3) await SC.boot3();
  };
})();
