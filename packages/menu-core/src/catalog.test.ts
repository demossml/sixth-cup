import { describe, expect, it } from "vitest";
import { linkByNames, linkToMilk, linkToProduct, matchSizes, syncCatalogPrices, volumeMl, type Catalog, type CatalogProduct } from "./catalog";
import { seedWorkspace } from "./seed";

const cappuccino = (p250 = 200, p350 = 230, p450 = 260): CatalogProduct => ({
  id: "g:1",
  name: "Капучино",
  category: "Кофе",
  addon: false,
  available: true,
  sizes: [
    { key: "p:11", label: "250 мл", price: p250 },
    { key: "p:12", label: "350 мл", price: p350 },
    { key: "p:13", label: "400 мл", price: p450 },
  ],
  milk: [
    { id: 7, label: "Овсяное", surcharge: 60 },
    { id: 8, label: "Обычное", surcharge: 0 },
  ],
});

function setup(product = cappuccino()) {
  const ws = seedWorkspace();
  const g = ws.groups.find((x) => x.id === "g-coffee")!;
  const item = g.items.find((i) => i.name === "Капучино")!;
  linkToProduct(g, item, product);
  return { ws, g, item };
}

describe("volumeMl", () => {
  it("reads liters, millilitres and bare numbers", () => {
    expect(volumeMl("0.25")).toBe(250);
    expect(volumeMl("0,35 л")).toBe(350);
    expect(volumeMl("400 мл")).toBe(400);
    expect(volumeMl("250")).toBe(250);
    expect(volumeMl("1 шт")).toBe(1000); // «1» без единиц похоже на литр — такие колонки сопоставляются по порядку
    expect(volumeMl("S")).toBeNull();
  });
});

describe("matchSizes", () => {
  it("matches columns to sizes by volume and leaves unknown columns empty", () => {
    const p = cappuccino();
    expect(matchSizes(["0.25", "0.35", "0.40"], p.sizes)).toEqual(["p:11", "p:12", "p:13"]);
    expect(matchSizes(["0.35", "0.50"], p.sizes)).toEqual(["p:12", null]);
  });
  it("falls back to order when labels are not volumes, and to the only size for one column", () => {
    const sizes = [{ key: "p:1", label: "S", price: 1 }, { key: "p:2", label: "M", price: 2 }];
    expect(matchSizes(["Малый", "Большой"], sizes)).toEqual(["p:1", "p:2"]);
    expect(matchSizes(["+"], [{ key: "p:9", label: "цена", price: 40 }])).toEqual(["p:9"]);
  });
});

describe("syncCatalogPrices", () => {
  it("takes prices from the catalog when linking", () => {
    const { item } = setup();
    expect(item.prices).toEqual([200, 230, 260]);
    expect(item.link).toEqual({ ref: "g:1", sizes: ["p:11", "p:12", "p:13"] });
  });

  it("applies a changed price, marks it for printing and logs it", () => {
    const { ws, item } = setup();
    const r = syncCatalogPrices(ws, { products: [cappuccino(200, 240, 260)] }, "2026-11-17T10:00:00Z");
    expect(r.changed).toBe(1);
    expect(item.prices).toEqual([200, 240, 260]);
    expect(item.priceNotice).toEqual({ at: "2026-11-17T10:00:00Z" });
    expect(r.log).toEqual(["Цена из базы: Капучино 0.35: 230 → 240"]);
    expect(syncCatalogPrices(ws, { products: [cappuccino(200, 240, 260)] }).changed).toBe(0);
  });

  it("overrides a manual edit of a linked price", () => {
    const { ws, item } = setup();
    item.prices[0] = 999; // клиент попытался поправить руками
    syncCatalogPrices(ws, { products: [cappuccino()] });
    expect(item.prices[0]).toBe(200);
  });

  it("prices a milk variation as base size plus surcharge; joined variations keep the block price", () => {
    const { ws, item } = setup();
    const oat = item.variations.find((v) => v.name === "Овсяное")!;
    const lactoseFree = item.variations.find((v) => v.name === "Безлактозное")!;
    linkToMilk(oat, cappuccino().milk[0]);
    lactoseFree.link = { milkId: 8 }; // присоединена к «Овсяному» — печатается с его ценой
    syncCatalogPrices(ws, { products: [cappuccino()] });
    expect(oat.prices).toEqual([260, 290, 320]);
    expect(lactoseFree.prices).toEqual([260, 290, 320]);
  });

  it("keeps the last price and flags the link when a product or size disappears", () => {
    const { ws, item } = setup();
    const catalog: Catalog = { products: [{ ...cappuccino(), sizes: cappuccino().sizes.slice(0, 2) }] };
    syncCatalogPrices(ws, catalog);
    expect(item.prices).toEqual([200, 230, 260]);
    expect(item.link?.missing).toBe(true);
    syncCatalogPrices(ws, { products: [] });
    expect(item.prices).toEqual([200, 230, 260]);
    syncCatalogPrices(ws, { products: [cappuccino()] });
    expect(item.link?.missing).toBeUndefined();
  });
});

describe("linking", () => {
  it("linkToMilk prices the variation right away when the base is linked", () => {
    const { item } = setup();
    const oat = item.variations.find((v) => v.name === "Овсяное")!;
    linkToMilk(oat, cappuccino().milk[0], item);
    expect(oat.prices).toEqual([260, 290, 320]);
  });

  it("linkByNames links items by name, milk variations by label and skips what does not match", () => {
    const ws = seedWorkspace();
    const syrup: CatalogProduct = { id: "p:40", name: "Сироп ваниль", category: "Добавки", addon: true, available: true, sizes: [{ key: "p:40", label: "цена", price: 45 }], milk: [] };
    const n = linkByNames(ws.groups, { products: [cappuccino(), syrup] });
    const cap = ws.groups.find((g) => g.id === "g-coffee")!.items.find((i) => i.name === "Капучино")!;
    expect(cap.link?.ref).toBe("g:1");
    expect(cap.variations.find((v) => v.name === "Овсяное")!.link).toEqual({ milkId: 7 });
    expect(cap.variations.find((v) => v.name === "Безлактозное")!.link).toBeUndefined();
    const addon = ws.groups.find((g) => g.style === "addons")!.items.find((i) => i.name === "Сироп ваниль")!;
    expect(addon.link).toEqual({ ref: "p:40", sizes: ["p:40"] });
    expect(addon.prices).toEqual([45]);
    expect(n).toBe(3);
    expect(linkByNames(ws.groups, { products: [cappuccino(), syrup] })).toBe(0);
  });
});
