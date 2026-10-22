/* Data layer, part 4: purchases (suppliers, invoices, payments, reconciliations, bank, orders, returns). */
(function () {
  'use strict';
  const SC = window.SC;
  const DAY = 86400000;
  const f = () => SC.fmt;
  const MONTH_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const sid = (id) => 's' + id;
  const rub = (kop) => Math.round(kop) / 100;

  function periodLabel(a, b) {
    const da = new Date(a), db = new Date(b);
    const monthStart = da.getDate() === 1;
    const monthEnd = new Date(db.getTime() + DAY).getDate() === 1;
    if (monthStart && monthEnd && da.getMonth() === db.getMonth() && da.getFullYear() === db.getFullYear()) return MONTH_NOM[da.getMonth()] + ' ' + da.getFullYear();
    return f().day(a) + ' – ' + f().day(b);
  }
  SC.periodLabel = periodLabel;

  function adaptPurchases(p) {
    const nameByUuid = SC.data.nameByUuid || {};
    const sups = (p.suppliers || []);
    const supBy = new Map(sups.map((s) => [s.id, s]));
    const now = Date.now();
    const suppliers = sups.map((s) => {
      const x = s.extra || {};
      return {
        id: sid(s.id), _id: s.id, name: s.name, legal: s.legalName || s.name, type: s.legalType || 'Юрлицо', inn: s.inn || '', kpp: s.kpp || '', ogrn: s.ogrn || '',
        phone: s.phone || '', email: s.email || '', legalAddr: s.legalAddr || '', addr: s.deliveryAddr || '', contact: s.contact || '', delay: s.paymentDelayDays || 0,
        status: s.active ? 'active' : 'archive', bank: x.bank || s.bankDetails || '', rs: x.rs || '', bik: x.bik || '', ks: x.ks || '', comment: s.notes || ''
      };
    });
    const invoices = (p.invoices || []).filter((i) => i.status !== 'cancelled').map((i) => {
      const sup = supBy.get(i.supplierId);
      const base = i.postedAt || i.createdAt;
      const due = i.dueAt || (base + ((sup && sup.paymentDelayDays) || 0) * DAY);
      return {
        id: SC.docNo('ПР', i.id), _id: i.id, number: i.number || '', date: f().day(base), due: f().day(due), dueIn: Math.round((due - now) / DAY), supplier: sid(i.supplierId),
        point: i.storeName || nameByUuid[i.storeUuid] || '—', amount: rub(i.totalKop), paid: rub(i.paidKop), received: i.status === 'posted', status: i.status,
        items: (i.lines || []).map((l) => ({ item: String(l.stockItemId), qty: l.qty, price: rub(l.unitCostKop), expiry: l.expiresAt ? f().day(l.expiresAt) : '', _expiresAt: l.expiresAt, lot: l.lotCode || '' }))
      };
    });
    const invId = new Map((p.invoices || []).map((i) => [i.id, SC.docNo('ПР', i.id)]));
    const purchasePayments = (p.payments || []).map((x) => {
      const m = /^\[(.+?)\]\s*/.exec(x.notes || '');
      return { id: SC.docNo('ОП', x.id), _id: x.id, date: f().day(x.paidAt), supplier: sid(x.supplierId), amount: rub(x.amountKop), method: m ? m[1] : 'Банк',
        invoices: (x.allocations || []).map((a) => invId.get(a.invoiceId)).filter(Boolean), status: 'Проведён', note: (x.notes || '').replace(/^\[.+?\]\s*/, '') };
    });
    const reconciliations = (p.reconciliations || []).map((r) => ({
      id: SC.docNo('СВ', r.id), _id: r.id, supplier: sid(r.supplierId), period: periodLabel(r.periodFrom, r.periodTo), turnover: rub(r.turnoverKop), balance: rub(r.ourBalanceKop),
      their: r.theirBalanceKop == null ? null : rub(r.theirBalanceKop), status: r.status, date: f().day(r.updatedAt), _from: r.periodFrom, _to: r.periodTo
    }));
    const bankRows = (p.bankRows || []).map((b) => ({
      _id: b.id, date: f().day(b.dateAt), party: b.party || '—', purpose: b.purpose || '', amount: rub(b.amountKop),
      match: b.matched ? 'Найдена накладная' : 'Не сопоставлено', cls: b.matched ? 'green' : 'red'
    }));
    const purchaseOrders = (p.orders || []).map((o) => ({
      id: SC.docNo('ЗК', o.id), _id: o.id, date: f().day(o.createdAt), supplier: sid(o.supplierId), point: nameByUuid[o.storeUuid] || '—', delivery: o.deliveryAt ? f().day(o.deliveryAt) : '—',
      status: o.status, lines: (o.lines || []).map((l) => ({ item: String(l.stockItemId), qty: l.qty, price: rub(l.priceKop), received: l.receivedQty || 0 }))
    }));
    const supplierReturns = (p.returns || []).map((r) => ({
      id: SC.docNo('ВЗ', r.id), _id: r.id, date: f().day(r.createdAt), supplier: sid(r.supplierId), point: nameByUuid[r.storeUuid] || '—', basis: r.basis, status: r.status,
      lines: (r.lines || []).map((l) => ({ item: String(l.stockItemId), qty: l.qty, price: rub(l.priceKop) }))
    }));
    return { suppliers, invoices, purchasePayments, reconciliations, bankRows, purchaseOrders, supplierReturns };
  }

  SC.applyPurchases = function (p) {
    const a = adaptPurchases(p);
    const d = SC.data;
    Object.keys(a).forEach((k) => { if (!d[k]) d[k] = []; SC.inplace(d[k], a[k]); });
    const overdue = a.invoices.filter((i) => i.amount - i.paid > 0.001 && i.received && i.dueIn < 0).length;
    const mism = a.reconciliations.filter((r) => r.status === 'mismatch').length;
    d.purchaseProblems = overdue + mism;
  };

  SC.refreshers = SC.refreshers || {};
  SC.refreshers.purchases = async function () {
    const p = await SC.get('/purchases/snapshot');
    SC.data._purRaw = p;
    SC.applyPurchases(p);
  };

  SC.boot4 = async function () {
    SC.applyPurchases(SC.data._purRaw || { suppliers: [], invoices: [] });
    if (SC.boot5) await SC.boot5();
  };
})();
