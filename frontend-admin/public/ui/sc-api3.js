/* Data layer, part 3: stock, recipes, receipts, inventory. */
(function () {
  'use strict';
  const SC = window.SC;
  const D = () => SC.data;
  const f = () => SC.fmt;
  const safe = async (name, p, fb) => { try { return await p; } catch (e) { (SC.errors = SC.errors || []).push(name + ': ' + e.message); return fb; } };
  const pad = (n) => String(n).padStart(2, '0');
  const UNIT = { kg: 'кг', l: 'л', pcs: 'шт', g: 'г', ml: 'мл' };
  const UNIT_BACK = { 'кг': 'kg', 'л': 'l', 'шт': 'pcs', 'г': 'g', 'мл': 'ml' };
  SC.unit = { toUi: (u) => UNIT[u] || u, toApi: (u) => UNIT_BACK[u] || u };
  /* norms in the prototype are in g / ml for kg / l items */
  SC.normToUi = (qty, unit) => (unit === 'kg' || unit === 'l' ? Math.round(qty * 1000 * 1000) / 1000 : qty);
  SC.normToApi = (qty, unitUi) => (unitUi === 'кг' || unitUi === 'л' ? qty / 1000 : qty);

  /** in-place replace so references held by coffee.js stay valid */
  SC.inplace = function (target, src) { target.length = 0; Array.prototype.push.apply(target, src); return target; };

  function docNo(prefix, id) { return prefix + '-' + String(id).padStart(4, '0'); }
  SC.docNo = docNo;

  function adaptStock(snap, recipesRes, invoices, suppliers) {
    const stores = snap.stores || [];
    const nameByUuid = {}, uuidByName = {};
    stores.forEach((s) => { nameByUuid[s.uuid] = s.name || s.uuid.slice(0, 6); uuidByName[nameByUuid[s.uuid]] = s.uuid; });
    const supName = new Map((suppliers || []).map((s) => [s.id, s.name]));
    const items = (snap.items || []).map((it) => {
      const balances = {};
      stores.forEach((s) => {
        const expected = (it.byStore || {})[s.uuid] || 0;
        const consumed = (it.consumed24 || {})[s.uuid] || 0;
        const lc = (it.lastCount || {})[s.uuid];
        balances[nameByUuid[s.uuid]] = {
          opening: Math.round((expected + consumed) * 1000) / 1000,
          consumed: Math.round(consumed * 1000) / 1000,
          fact: lc ? Math.round((expected + (lc.fact - lc.book)) * 1000) / 1000 : null
        };
      });
      const unit = UNIT[it.unit] || it.unit;
      const daily = Object.values(it.consumed24 || {}).reduce((a, b) => a + b, 0);
      return {
        id: String(it.id), _id: it.id, name: it.name, type: it.kind === 'raw' ? 'raw' : 'piece', unit, _unit: it.unit,
        min: it.minQty || 0, cost: Math.round((it.avgCostKop || 0)) / 100, multiple: it.multiplicity || 1, shelf: it.shelfLifeDays || 30,
        defaultSupplier: it.defaultSupplierId ? 's' + it.defaultSupplierId : '', supplierName: supName.get(it.defaultSupplierId) || '—',
        daily, balances, _batches: it.batches || [], sku: it.sku || ''
      };
    });
    const recipes = (recipesRes.recipes || []).map((r) => ({
      product: r.product, productId: r.productId, group: r.group || 'Без группы',
      mode: r.mode === 'unset' ? 'none' : r.mode, sold: Math.round((r.sold30d || 0) / 30), components: (r.components || []).map((c) => ({
        item: String(c.stockItemId), qty: SC.normToApi ? SC.normToUi(c.qty, items.find((x) => x._id === c.stockItemId) ? items.find((x) => x._id === c.stockItemId)._unit : 'pcs') : c.qty
      }))
    }));
    const receipts = (invoices || []).map((i) => ({
      id: i.number || docNo('ПР', i.id), _id: i.id, date: f().day(i.postedAt || i.createdAt), point: i.storeName || nameByUuid[i.storeUuid] || '—',
      supplier: supName.get(i.supplierId) || '—', positions: (i.lines || []).length, amount: Math.round(i.totalKop / 100),
      status: i.status === 'posted' ? 'Проведён' : i.status === 'draft' ? 'Черновик' : 'Отменён'
    }));
    const problems = items.filter((it) => {
      const tot = Object.values(it.balances).reduce((a, b) => a + (b.opening - b.consumed), 0);
      return it.min > 0 && tot < it.min;
    });
    return { items, recipes, receipts, stockPoints: stores.map((s) => nameByUuid[s.uuid]), nameByUuid, uuidByName, problems };
  }

  const INV_STATUS = { draft: 'draft', counting: 'in_progress', review: 'review', posted: 'posted', cancelled: 'cancelled' };
  function adaptInv(overview, sheets, stockItems) {
    const byId = new Map(stockItems.map((i) => [i._id, i]));
    return (overview.docs || []).map((d) => {
      const sh = sheets[d.id];
      const items = sh ? sh.lines.map((l) => ({
        itemId: String(l.stockItemId), _lineId: l.id, book: l.bookQty == null ? 0 : l.bookQty, fact: l.factQty, counted: l.factQty != null,
        zone: l.zone || 'Склад', category: l.category || 'Сырьё', recount: !!l.recount
      })) : [];
      const dt = d.postedAt || d.updatedAt || d.createdAt;
      const dd = new Date(dt);
      return {
        id: docNo('ИНВ', d.id), _id: d.id, date: f().day(dt) + ', ' + pad(dd.getHours()) + ':' + pad(dd.getMinutes()), point: d.storeName || '—', _store: d.storeUuid,
        type: d.kind, status: INV_STATUS[d.status] || 'draft', author: d.author || '—', total: d.total || 0, counted: d.counted || 0, items, _real: true
      };
    });
    void byId;
  }

  SC.loadStock = async function () {
    const [snap, rec, pur, inv, exp] = await Promise.all([
      safe('stock snapshot', SC.get('/stock/snapshot'), { stores: [], items: [] }),
      safe('recipes', SC.get('/stock/recipes'), { recipes: [] }),
      safe('purchases snapshot', SC.get('/purchases/snapshot'), { suppliers: [], invoices: [] }),
      safe('inventory', SC.get('/inventory/overview'), { docs: [] }),
      safe('expiry', SC.get('/stock/expiry?days=30'), { batches: [] })
    ]);
    const st = adaptStock(snap, rec, pur.invoices, pur.suppliers);
    const sheets = {};
    await Promise.all((inv.docs || []).slice(0, 40).map(async (d) => { sheets[d.id] = await safe('sheet ' + d.id, SC.get('/inventory/' + d.id + '/sheet'), null); }));
    const docs = adaptInv(inv, sheets, st.items);
    // 7-day consumption of the headline item (coffee if present) per store and overall
    const main = st.items.find((x) => x.type === 'raw' && /кофе|coffee/i.test(x.name)) || st.items.find((x) => x.type === 'raw');
    const consumption = {};
    if (main) {
      const names = ['all'].concat(st.stockPoints);
      await Promise.all(names.map(async (n) => {
        const q = '/stock/consumption?itemId=' + main._id + '&days=7' + (n === 'all' ? '' : '&storeUuid=' + st.uuidByName[n]);
        const r = await safe('consumption', SC.get(q), { days: [] });
        consumption[n] = r.days;
      }));
    }
    return { st, docs, pur, exp, consumption };
  };

  /** fill / refresh arrays in place */
  SC.applyStock = function (r) {
    const d = D();
    const slot = (k, v) => { if (!d[k]) d[k] = []; SC.inplace(d[k], v); };
    slot('stockItems', r.st.items);
    slot('recipes', r.st.recipes);
    slot('receipts', r.st.receipts);
    slot('stockPoints', r.st.stockPoints);
    slot('inventoryDocs', r.docs);
    d.nameByUuid = r.st.nameByUuid; d.uuidByName = r.st.uuidByName;
    const names = r.st.problems.map((p) => p.name);
    d.stockProblems = { n: names.length, names: names.slice(0, 3).join(', '), sumRub: 0 };
    d.expiryRaw = (r.exp && r.exp.batches) || [];
    d.consumption = r.consumption || {};
  };

  SC.boot3 = async function () {
    const r = await SC.loadStock();
    SC.applyStock(r);
    SC.data._purRaw = r.pur;
    if (SC.boot4) await SC.boot4();
  };

  /** refresh a domain after a write: reload → update arrays in place → re-render */
  SC.refresh = async function (domain) {
    try {
      if (domain === 'stock' || domain === 'inventory') {
        const r = await SC.loadStock();
        SC.applyStock(r);
        SC.data._purRaw = r.pur;
        if (SC.applyPurchases) SC.applyPurchases(r.pur);
      } else if (SC.refreshers && SC.refreshers[domain]) {
        await SC.refreshers[domain]();
      }
    } finally {
      if (SC.render && SC.render[domain]) SC.render[domain]();
      if (SC.render && SC.render.all) SC.render.all();
      if (SC.bind && SC.bind.all) SC.bind.all();
    }
  };
})();
