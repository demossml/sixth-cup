import { describe, expect, it } from "vitest";
import { isBlankItem, printedGroup, removeVariations, shareVariations, splitVariations, variationBlocks, type Group, type Item } from "./model";

// «Капучино»: Овсяное и Безлактозное — общая цена, Миндальное и Кокосовое — свои
const make = (): Item => ({
  id: "i",
  name: "Капучино",
  prices: [200, 230, 260],
  variations: [
    { id: "a", name: "Овсяное", prices: [260, 290, 320] },
    { id: "b", name: "Безлактозное", prices: [260, 290, 320], sharePrice: true },
    { id: "c", name: "Миндальное", prices: [270, 300, 330] },
    { id: "d", name: "Кокосовое", prices: [null, null, null] },
  ],
});
const blocks = (it: Item) => variationBlocks(it.variations).map((b) => b.map((v) => v.id).join("+"));
const price = (it: Item, id: string) => it.variations.find((v) => v.id === id)!.prices;

describe("выбранные вариации", () => {
  it("общая цена: встают подряд за первой выбранной и берут её цену", () => {
    const it = make();
    shareVariations(it, ["c", "a"]);
    expect(blocks(it)).toEqual(["a+c+b", "d"]);
    expect(price(it, "c")).toEqual([260, 290, 320]);
  });

  it("общая цена у вариаций без цены берётся у первой выбранной, у которой цена есть", () => {
    const it = make();
    it.variations.unshift({ id: "x", name: "Новое", prices: [null, null, null] });
    shareVariations(it, ["x", "c"]);
    expect(blocks(it)).toEqual(["x+c", "a+b", "d"]);
    expect(price(it, "x")).toEqual([270, 300, 330]);
  });

  it("унесённая первая вариация блока не ломает цену оставшихся", () => {
    const it = make();
    shareVariations(it, ["c", "d"]);
    expect(blocks(it)).toEqual(["a+b", "c+d"]);
    shareVariations(it, ["a", "d"]);
    expect(blocks(it)).toEqual(["a+d+b", "c"]);
    expect(price(it, "c")).toEqual([270, 300, 330]);
  });

  it("своя цена: каждая выбранная печатается отдельно с прежней ценой", () => {
    const it = make();
    splitVariations(it, ["a"]);
    expect(blocks(it)).toEqual(["a", "b", "c", "d"]);
    expect(price(it, "b")).toEqual([260, 290, 320]);
  });

  it("удаление первой вариации блока: следующая становится во главе", () => {
    const it = make();
    it.variations.splice(2, 0, { id: "e", name: "Банановое", prices: [260, 290, 320], sharePrice: true }); // a+b+e
    removeVariations(it, ["a"]);
    expect(blocks(it)).toEqual(["b+e", "c", "d"]);
    removeVariations(it, ["c", "b"]);
    expect(blocks(it)).toEqual(["e", "d"]);
    expect(price(it, "e")).toEqual([260, 290, 320]);
  });
});

describe("пустые строки-заготовки", () => {
  it("пустая позиция не печатается, а позиция с названием, ценой или надписью — печатается", () => {
    const blank: Item = { id: "b", name: "  ", prices: [null, null], variations: [] };
    const g: Group = {
      id: "g", title: "Кофе", style: "section", columns: ["0.25", "0.35"],
      items: [
        { id: "a", name: "Латте", prices: [200, 230], variations: [] },
        blank,
        { id: "p", name: "", prices: [null, 150], variations: [] },
        { id: "n", name: "", note: "новинка", prices: [null, null], variations: [] },
      ],
    };
    expect(isBlankItem(blank)).toBe(true);
    expect(printedGroup(g).items.map((it) => it.id)).toEqual(["a", "p", "n"]);
    const clean = { ...g, items: g.items.filter((it) => it !== blank) };
    expect(printedGroup(clean)).toBe(clean); // убирать нечего — та же таблица, без копии
  });
});
