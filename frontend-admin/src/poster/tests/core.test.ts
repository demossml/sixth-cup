/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { diffWorkspace } from "@/lib/diff";
import { docChanges, priceChangesText } from "@/lib/changes";
import { changesForBatch, docDue, dueRank, fingerprint, isChanged, printStatus, sentMark } from "@/lib/fingerprint";
import { createFromTemplate, menuTemplates, templatePreview } from "@/lib/templates";
import { MENU as M, PRINTER_MARGIN } from "@/lib/layout/design";
import { FIT_MIN, layoutMenu } from "@/lib/layout/menu";
import { layoutTag } from "@/lib/layout/tag";
import { addCafe, applyPriceUpdates, cafeLabel, sameTemplate, tagTemplates, addonGroups, addonJoins, addonLine, cafeGroups, contactServes, groupAddons, splitAddons, cafeMenus, deepCopyMenu, menuFamily, migrateWorkspace, removeFormat, removeMenu, resolveTag, syncSharedPrices, variationTitle, type MenuDoc, type TagDoc, type Workspace } from "@/lib/model";
import { sceneToPdf } from "@/lib/render/pdf";
import { previewHeight, sceneToSvg } from "@/lib/render/svg";
import { changedTexts, layoutSent } from "@/lib/snapshot";
import { seedWorkspace } from "@/lib/seed";
import { coalesce } from "@/lib/changelog";
import { nodeFontBook } from "./helpers";

const fb = nodeFontBook();
const menus = (ws: Workspace) => ws.documents.filter((d): d is MenuDoc => d.kind === "menu");
const tag = (ws: Workspace) => ws.documents.find((d): d is TagDoc => d.kind === "tag")!;

describe("форматы меню", () => {
  const withFormats = () => {
    const ws = seedWorkspace();
    const root = menus(ws)[0];
    const sizes = [{ w: 148, h: 210 }, { w: 297, h: 420 }];
    const copies = sizes.map((size, i) => ({ ...structuredClone(root), id: `fmt-${i}`, size, copyOf: root.id }));
    ws.documents.push(...copies);
    return { ws, root, copies };
  };

  it("копию формата убирают, основной лист остаётся", () => {
    const { ws, root, copies } = withFormats();
    expect(removeFormat(ws, copies[0])?.id).toBe(root.id);
    expect(menuFamily(ws, root).map((d) => d.id)).toEqual([root.id, copies[1].id]);
  });

  it("основной формат тоже можно убрать — основным становится следующий, таблицы и название те же", () => {
    const { ws, root, copies } = withFormats();
    const next = removeFormat(ws, root)!;
    expect(next.id).toBe(copies[0].id);
    expect(next.copyOf).toBeUndefined();
    expect(next.groupIds).toEqual(root.groupIds);
    expect(ws.documents.some((d) => d.id === root.id)).toBe(false);
    expect(menuFamily(ws, next).map((d) => d.id)).toEqual([copies[0].id, copies[1].id]);
    expect(menus(ws).filter((d) => !d.copyOf).map((d) => d.id)).toContain(next.id);
  });

  it("последний формат так не убрать", () => {
    const ws = seedWorkspace();
    const root = menus(ws)[0];
    expect(removeFormat(ws, root)).toBeNull();
    expect(ws.documents.some((d) => d.id === root.id)).toBe(true);
  });
});

describe("вёрстка меню", () => {
  it.each([
    ["A5", 148, 210],
    ["A4", 210, 297],
    ["A3", 297, 420],
    ["A2", 420, 594],
  ])("стартовое меню помещается без предупреждений в %s", (_, w, h) => {
    const ws = seedWorkspace();
    for (const doc of menus(ws)) {
      const scene = layoutMenu(ws, { ...doc, size: { w, h } }, fb);
      expect(scene.warnings).toEqual([]);
      for (const e of scene.els) if (e.kind === "text") expect(e.y).toBeLessThan(h);
    }
  });

  it("предупреждает, когда групп больше, чем влезает на лист", () => {
    const ws = seedWorkspace();
    const doc = { ...menus(ws)[0], groupIds: ws.groups.map((g) => g.id) };
    expect(layoutMenu(ws, doc, fb).warnings.join(" ")).toMatch(/не помещается/);
  });

  describe("когда не хватает места", () => {
    const grow = (ws: Workspace, extra: number) => {
      const g = ws.groups.find((x) => x.id === menus(ws)[0].groupIds[0])!;
      for (let i = 0; i < extra; i++) g.items.push({ id: `x${i}`, name: `Новый напиток ${i}`, prices: g.columns.map(() => 300 + i), variations: [] });
    };
    const sizes = (scene: ReturnType<typeof layoutMenu>, test: (t: string) => boolean) =>
      scene.els.filter((e) => e.kind === "text" && test(e.text)).map((e) => (e.kind === "text" ? +e.size.toFixed(3) : 0));

    it("уменьшает текст меню и линии, остальное не трогает", () => {
      const ws = seedWorkspace();
      const before = layoutMenu(ws, menus(ws)[0], fb);
      expect(before.fit).toBe(1);
      grow(ws, 3);
      const after = layoutMenu(ws, menus(ws)[0], fb);
      const k = after.fit!;
      expect(k).toBeLessThan(1);
      expect(k).toBeGreaterThanOrEqual(FIT_MIN);
      expect(after.warnings).toEqual([]);
      expect(after.overflow).toBe(0);
      // лист тот же
      expect([after.w, after.h]).toEqual([before.w, before.h]);
      // строки меню и линии уменьшились в одну и ту же меру
      expect(sizes(after, (t) => t === "КАПУЧИНО")).toEqual([+(M.text * k).toFixed(3)]);
      const rules = (sc: typeof after) => sc.els.filter((e) => e.kind === "line" && e.y1 === e.y2 && !e.dash).map((e) => (e.kind === "line" ? e.width : 0));
      expect(rules(after)[0]).toBeCloseTo(M.ruleSolid * k, 5);
      expect(rules(before)[0]).toBeCloseTo(M.ruleSolid, 5);
      // добавки, сноска и логотип — как в макете
      expect(sizes(after, (t) => t === "ДЕКАФ")).toEqual([M.addons.size]);
      expect(sizes(after, (t) => t.startsWith("Цены указаны"))).toEqual([M.footnote.size]);
      const paths = (sc: typeof after) => sc.els.filter((e) => e.kind === "path").map((e) => (e.kind === "path" ? [e.x, e.y, e.scale] : []));
      expect(paths(after)).toEqual(paths(before));
      // ширина блоков: линии и колонки цен стоят там же
      const xs = (sc: typeof after) => sc.els.filter((e) => e.kind === "line" && e.y1 === e.y2).map((e) => (e.kind === "line" ? [e.x1, e.x2] : []))[0];
      expect(xs(after)).toEqual(xs(before));
      const priceRight = (sc: typeof after, label = "0.40") => {
        const e = sc.els.find((x) => x.kind === "text" && x.text === label)!;
        return e.kind === "text" ? e.x + fb.measure(e.text, e.weight, e.size) - fb.bearings(e.text, e.weight, e.size).rsb : 0;
      };
      expect(priceRight(after)).toBeCloseTo(priceRight(before), 3);
      // колонки сужаются вместе с текстом: правый край последней на месте, шаг — в той же мере
      const pitch = (sc: typeof after) => (priceRight(sc) - priceRight(sc, "0.25")) / 2;
      expect(pitch(before)).toBeCloseTo(M.colPitch, 3);
      expect(pitch(after)).toBeCloseTo(M.colPitch * k, 3);
      // всё содержимое выше сноски
      expect(after.contentBottom!).toBeLessThanOrEqual(after.limitY! + 1e-6);
    });

    it("подбирает наибольший размер, при котором помещается", () => {
      const ws = seedWorkspace();
      grow(ws, 1);
      const one = layoutMenu(ws, menus(ws)[0], fb).fit!;
      grow(ws, 3);
      const four = layoutMenu(ws, menus(ws)[0], fb).fit!;
      expect(one).toBeLessThan(1);
      expect(four).toBeLessThan(one);
    });

    it("если не влезает и мелким текстом — лист не меняется, показывается, сколько вылезло", () => {
      const ws = seedWorkspace();
      grow(ws, 30);
      const doc = menus(ws)[0];
      const scene = layoutMenu(ws, doc, fb);
      expect(scene.fit).toBe(FIT_MIN);
      expect([scene.w, scene.h]).toEqual([doc.size.w, doc.size.h]);
      expect(scene.overflow!).toBeGreaterThan(0);
      expect(scene.contentBottom!).toBeGreaterThan(scene.h);
      expect(scene.warnings.join(" ")).toMatch(/не помещается на лист: вылезает \d+ мм/);
      expect(previewHeight(scene)).toBeGreaterThan(scene.h);
      expect(sceneToSvg(scene, { overflow: true })).toContain(`viewBox="0 0 ${scene.w} `);
      expect(sceneToSvg(scene)).toContain(`viewBox="0 0 ${scene.w} ${scene.h}"`);
    });

    it("в поля принтера ничего не попадает на любом формате", () => {
      const ws = seedWorkspace();
      for (const [w, h] of [[148, 210], [210, 297], [297, 420]]) {
        const scene = layoutMenu(ws, { ...menus(ws)[0], size: { w, h } }, fb);
        const m = scene.margin!;
        expect(m).toBe(PRINTER_MARGIN);
        for (const e of scene.els) if (e.kind === "text") expect(e.y + e.size * 0.25).toBeLessThanOrEqual(h - m + 1e-6);
        expect(sceneToSvg(scene, { margins: true })).toContain("evenodd");
        expect(scene.inMargin).toBe(false);
        // ничего не заехало — поля нейтральные и сами не показываются
        expect(sceneToSvg(scene, { margins: true })).not.toContain("#e5484d");
        expect(sceneToSvg(scene, { autoMargins: true })).not.toContain("evenodd");
      }
    });

    it("первая таблица без крупного заголовка встаёт верхом к верху крупного заголовка", () => {
      const ws = seedWorkspace();
      const doc = menus(ws)[0];
      const g = ws.groups.find((x) => x.id === doc.groupIds[0])!;
      const heroTop = M.hero.firstBaseline - M.hero.size * fb.capHeight;
      for (const style of ["section", "compact"] as const) {
        g.style = style;
        const scene = layoutMenu(ws, doc, fb);
        const k = scene.fit ?? 1;
        const title = scene.els.find((e) => e.kind === "text" && e.text === g.title.toUpperCase());
        expect(title?.kind).toBe("text");
        if (title?.kind !== "text") continue;
        // верх заглавных первого заголовка — там же, где был бы верх крупного (до подгонки текста)
        expect(title.y - title.size * fb.capHeight).toBeCloseTo(k === 1 ? heroTop : title.y - title.size * fb.capHeight, 3);
        expect(title.y).toBeLessThan(M.hero.firstBaseline);
      }
    });

    it("заехало в поля или лист переполнен — поля красные и видны без переключателя", () => {
      const ws = seedWorkspace();
      const base = layoutMenu(ws, menus(ws)[0], fb);
      const into = { ...base, inMargin: true };
      expect(sceneToSvg(into, { autoMargins: true })).toMatch(/evenodd[^>]*fill="#e5484d"/);
      expect(sceneToSvg(into)).not.toContain("evenodd"); // миниатюры и PDF-превью — без автополей
      grow(ws, 30);
      const over = layoutMenu(ws, menus(ws)[0], fb);
      expect(sceneToSvg(over, { autoMargins: true, overflow: true })).toMatch(/evenodd[^>]*fill="#e5484d"/);
    });
  });

  it("пунктир между колонками пропускает строки без цены", () => {
    const ws = seedWorkspace();
    const scene = layoutMenu(ws, menus(ws)[1], fb); // «Не кофе»: у чая нет 0.25
    const vertical = scene.els.filter((e) => e.kind === "line" && e.x1 === e.x2);
    expect(vertical.length).toBeGreaterThan(2);
  });
});

describe("вариации", () => {
  const priceTexts = (ws: Workspace) =>
    layoutMenu(ws, menus(ws)[0], fb).els.filter((e) => e.kind === "text" && /^\d+$/.test(e.text)).length;

  it("виды молока — отдельные вариации, но на листе один блок с общей ценой", () => {
    const ws = seedWorkspace();
    const cap = ws.groups[0].items[0];
    expect(cap.variations.map((v) => v.name)).toEqual(["Овсяное", "Безлактозное", "Миндальное", "Кокосовое"]);
    const before = priceTexts(ws);
    // своя цена у кокосового — отдельная строка со своими ценами
    const coco = cap.variations[3];
    coco.sharePrice = undefined;
    coco.prices = [260, 290, 320];
    syncSharedPrices(cap);
    expect(priceTexts(ws)).toBe(before + 3);
    expect(layoutMenu(ws, menus(ws)[0], fb).warnings).toEqual([]);
  });

  it("правка цены блока доходит до всех присоединённых вариаций и ценников", () => {
    const ws = seedWorkspace();
    const cap = ws.groups[0].items[0];
    cap.variations[0].prices[0] = 245;
    syncSharedPrices(cap);
    expect(cap.variations.map((v) => v.prices[0])).toEqual([245, 245, 245, 245]);
    const t: TagDoc = { id: "t", kind: "tag", name: "", cafeId: "c-main", size: { w: 90, h: 45 }, showInfo: false, createdAt: "", ref: { groupId: "g-coffee", itemId: cap.id, variationId: cap.variations[2].id, column: 0 } };
    expect(resolveTag(ws, t)).toMatchObject({ name: "Капучино миндальное", price: 245 });
  });

  it("старые данные: строки с общей ценой становятся отдельными вариациями", () => {
    const ws = seedWorkspace();
    const legacy = { id: "v1", lines: [{ name: "Овсяное" }, { name: "Миндальное", allergen: true }], prices: [240, 270, 300] };
    (ws.groups[0].items[0] as unknown as { variations: unknown[] }).variations = [legacy];
    migrateWorkspace(ws);
    expect(ws.groups[0].items[0].variations).toEqual([
      { id: "v1", name: "Овсяное", prices: [240, 270, 300] },
      { id: "v1-1", name: "Миндальное", allergen: true, prices: [240, 270, 300], sharePrice: true },
    ]);
  });

  it("название ценника вариации", () => {
    expect(variationTitle("Раф", "Раф халва")).toBe("Раф халва");
    expect(variationTitle("Капучино", "Овсяное")).toBe("Капучино овсяное");
  });
});

describe("вёрстка ценника", () => {
  it.each([
    [90, 45], [70, 35], [120, 60], [58, 40], [60, 30],
  ])("название влезает в %i×%i", (w, h) => {
    const ws = seedWorkspace();
    const scene = layoutTag(ws, { ...tag(ws), size: { w, h } }, fb);
    expect(scene.warnings).toEqual([]);
    for (const e of scene.els) {
      if (e.kind !== "text") continue;
      expect(e.x + fb.measure(e.text, e.weight, e.size)).toBeLessThanOrEqual(w + 0.01);
    }
  });

  it("полоса слева одной ширины при любом размере", () => {
    const ws = seedWorkspace();
    const widths = [[90, 45], [120, 60], [58, 40]].map(([w, h]) => {
      const bar = layoutTag(ws, { ...tag(ws), size: { w, h } }, fb).els.find((e) => e.kind === "rect");
      return bar && bar.kind === "rect" ? bar.w : 0;
    });
    expect(new Set(widths).size).toBe(1);
  });
});

describe("отпечатки и статус «изменён»", () => {
  it("меняется от цены и только у затронутых документов", () => {
    const ws = seedWorkspace();
    const before = Object.fromEntries(ws.documents.map((d) => [d.id, fingerprint(ws, d)]));
    for (const d of ws.documents) d.lastSent = { hash: before[d.id], at: "x", sendId: "s" };
    ws.groups.find((g) => g.id === "g-food")!.items[0].prices[0] = 170; // круассан
    const changed = ws.documents.filter((d) => isChanged(ws, d)).map((d) => d.id).sort();
    expect(changed).toEqual(["d-menu-notcoffee", "d-tag-croissant", "d-tag-croissant-small"]);
  });

  it("не зависит от порядка документов в списке", () => {
    const ws = seedWorkspace();
    const a = fingerprint(ws, ws.documents[0]);
    ws.documents.reverse();
    expect(fingerprint(ws, ws.documents.find((d) => d.id === "d-menu-coffee")!)).toBe(a);
  });
});

describe("журнал изменений", () => {
  it("описывает цены, вариации, группы и документы", () => {
    const a = seedWorkspace();
    const b = structuredClone(a);
    const coffee = b.groups[0];
    coffee.items[0].prices[2] = 360;
    coffee.items[2].variations[0].name = "Раф лаванда";
    coffee.title = "Кофе и эспрессо";
    b.groups.push({ id: "g-new", title: "Сезонное", style: "section", columns: ["0.35"], items: [] });
    b.documents[2].size = { w: 70, h: 35 };
    const log = diffWorkspace(a, b);
    expect(log).toContain("Капучино 0.40: 350 → 360");
    expect(log).toContain("«Раф»: вариация «Раф халва» → «Раф лаванда»");
    expect(log).toContain("Группа «Кофе» переименована в «Кофе и эспрессо»");
    expect(log).toContain("Добавлена группа «Сезонное»");
    expect(log.some((l) => l.includes("размер 90×45 → 70×35"))).toBe(true);
  });

  it("склеивает набор цены по цифрам в одну строку", () => {
    const t = (s: number) => new Date(Date.UTC(2026, 10, 15, 10, 0, s)).toISOString();
    let log = coalesce([], [{ at: t(0), text: "Капучино 0.40: 350 → 3" }]);
    log = coalesce(log, [{ at: t(1), text: "Капучино 0.40: 3 → 36" }]);
    log = coalesce(log, [{ at: t(2), text: "Капучино 0.40: 36 → 360" }]);
    expect(log.map((l) => l.text)).toEqual(["Капучино 0.40: 350 → 360"]);
    log = coalesce(log, [{ at: t(3), text: "Капучино 0.40: 360 → 350" }]);
    expect(log).toEqual([]);
  });
});

describe("PDF", () => {
  it("лёгкий, с вылетами и обрезным форматом", async () => {
    const ws = seedWorkspace();
    const scene = layoutMenu(ws, menus(ws)[0], fb);
    const bytes = await sceneToPdf(scene, fb, { print: true, title: "Кофе" });
    expect(bytes.byteLength).toBeLessThan(60_000);
    expect(new TextDecoder("latin1").decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});

describe("кафе, статусы, перенос", () => {
  it("новое кафе с копией меню: свои группы и позиции, ценники привязаны к копиям", () => {
    const ws = seedWorkspace();
    const id = addCafe(ws, "ул. Ленина, 12", "c-main");
    const menus = cafeMenus(ws, id);
    expect(menus.map((m) => m.name)).toEqual(["Кофе", "Не кофе"]);
    const orig = new Set(cafeGroups(ws, "c-main").map((g) => g.id));
    expect(cafeGroups(ws, id).every((g) => !orig.has(g.id))).toBe(true);
    const tags = ws.documents.filter((d): d is TagDoc => d.kind === "tag" && d.cafeId === id);
    expect(tags).toHaveLength(2);
    expect(tags.every((t) => !resolveTag(ws, t).broken && resolveTag(ws, t).price === 160)).toBe(true);
    // цена в копии не трогает оригинал
    const food = cafeGroups(ws, id).find((g) => g.title === "К кофе")!;
    food.items[0].prices[0] = 175;
    expect(resolveTag(ws, tags[0]).price).toBe(175);
    expect(resolveTag(ws, tag(ws)).price).toBe(160);
  });

  it("копия меню независима, удаление убирает её группы", () => {
    const ws = seedWorkspace();
    const before = ws.groups.length;
    const id = deepCopyMenu(ws, menus(ws)[0], "c-main", "Кофе зима");
    expect(ws.groups.length).toBe(before + 2);
    removeMenu(ws, ws.documents.find((d): d is MenuDoc => d.id === id)!);
    expect(ws.groups.length).toBe(before);
  });

  it("статус: ожидает печати → заказ отправлен → без изменений", () => {
    const ws = seedWorkspace();
    const t = tag(ws);
    expect(printStatus(ws, t)).toBe("pending");
    ws.sends.push({ id: "s1", at: "2026-11-16T00:00:00Z", to: "x", docIds: [t.id], files: [], bytes: 0, changes: 0 });
    t.lastSent = { hash: fingerprint(ws, t), at: "2026-11-16T00:00:00Z", sendId: "s1" };
    expect(printStatus(ws, t)).toBe("ordered");
    ws.sends.push({ id: "s2", at: "2026-11-17T00:00:00Z", to: "x", docIds: [], files: [], bytes: 0, changes: 0 });
    expect(printStatus(ws, t)).toBe("ok");
    ws.groups.find((g) => g.id === "g-food")!.items[0].prices[0] = 165;
    expect(printStatus(ws, t)).toBe("pending");
  });

  it("перенос позиции в другую таблицу: журнал и ценник идут за ней", () => {
    const prev = seedWorkspace();
    const next = structuredClone(prev);
    const food = next.groups.find((g) => g.title === "К кофе")!;
    const cold = next.groups.find((g) => g.title === "Холодные")!;
    const [croissant] = food.items.splice(0, 1);
    cold.items.push(croissant);
    expect(diffWorkspace(prev, next)).toContain("«Круассан классический» перенесена в «Холодные»");
    expect(resolveTag(next, tag(next)).broken).toBe(false);
  });

  it("старые данные без кафе получают одно кафе", () => {
    const ws = seedWorkspace() as unknown as { cafes?: unknown; documents: { cafeId?: string }[] };
    delete ws.cafes;
    for (const d of ws.documents) delete d.cafeId;
    const m = migrateWorkspace(ws as unknown as Workspace);
    expect(m.cafes).toHaveLength(1);
    expect(m.documents.every((d) => d.cafeId === m.cafes[0].id)).toBe(true);
  });
});

describe("таблицы: рамка «А», группы добавок", () => {
  it("рамка аллергена без подгонки — как в макете, у любой строки", () => {
    const ws = seedWorkspace();
    const g = ws.groups[0];
    g.items[0].allergen = true;
    g.items[3].allergen = true;
    const boxes = layoutMenu(ws, menus(ws)[0], fb).els.filter((e) => e.kind === "rect" && e.stroke);
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    // габарит рамки (с линией) — как в макете: высотой с прописную букву строки, линия как штрих букв
    for (const b of boxes)
      if (b.kind === "rect") {
        expect(b.w + b.strokeWidth!).toBeCloseTo(M.allergen.w, 5);
        expect(b.h + b.strokeWidth!).toBeCloseTo(M.allergen.h, 5);
        expect([M.allergen.stroke.Medium, M.allergen.stroke.Regular]).toContain(+b.strokeWidth!.toFixed(5)); // у позиции — Medium, у вариации — Regular
      }
  });

  it("соседние добавки с одной ценой печатаются одной строкой через запятую, вперемешку — нет", () => {
    const ws = seedWorkspace();
    const addons = ws.groups.find((g) => g.style === "addons")!;
    const texts = () => layoutMenu(ws, menus(ws)[0], fb).els.flatMap((e) => (e.kind === "text" ? [e.text] : []));
    const groups = () => addonGroups(addons.items).map((grp) => grp.map((i) => i.name));
    expect(groups()[0]).toEqual(["Сироп ваниль", "Карамель", "Лесной орех", "Кокос", "Шоколад"]);
    // за пределами списка — не группа (редактор спрашивает про строку после последней)
    expect(addonJoins(addons.items, addons.items.length)).toBe(false);
    expect(addonJoins(addons.items, 0)).toBe(false);
    expect(addonLine(addonGroups(addons.items)[0]).name).toBe("Сироп ваниль, карамель, лесной орех, кокос, шоколад");
    // одна цена на всю группу; «Взбитые сливки» с той же ценой стоят не рядом — отдельной строкой
    expect(texts().filter((t) => t === "+40" || t.startsWith("+40 ")).length).toBe(2);
    expect(texts().join(" ")).toContain("+40 СИРОП ВАНИЛЬ,");
    expect(groups()).toContainEqual(["Взбитые сливки"]);
    // пометка последней в группе печатается у группы
    expect(addonLine(addonGroups(addons.items).find((g) => g[0].name === "Корица")!)).toMatchObject({ name: "Корица, какао", note: "сверху" });

    // разделить: «Кокос» своей строкой, остальные остаются группами по соседству
    const before = fingerprint(ws, menus(ws)[0]);
    splitAddons(addons, [addons.items.find((i) => i.name === "Кокос")!.id]);
    expect(groups().slice(0, 3)).toEqual([["Сироп ваниль", "Карамель", "Лесной орех"], ["Кокос"], ["Шоколад"]]);
    expect(fingerprint(ws, menus(ws)[0])).not.toBe(before);

    // объединить вручную то, что стояло вперемешку: встают подряд, цена — первой
    const cream = addons.items.find((i) => i.name === "Взбитые сливки")!;
    const decaf = addons.items.find((i) => i.name === "Декаф")!;
    groupAddons(addons, [cream.id, decaf.id]);
    expect(decaf.prices[0]).toBe(cream.prices[0]);
    expect(groups()).toContainEqual(["Взбитые сливки", "Декаф"]);
  });

  it("старая запись добавок через запятую один раз делится на отдельные позиции, лист и отпечаток не меняются", () => {
    const fresh = seedWorkspace();
    const old = seedWorkspace();
    delete old.schema;
    const g = old.groups.find((x) => x.style === "addons")!;
    g.items = [
      { id: "a1", name: "Сироп ваниль, карамель, лесной орех, кокос, шоколад", prices: [40], variations: [] },
      { id: "a2", name: "Доп. эспрессо", prices: [50], variations: [] },
      { id: "a3", name: "Взбитые сливки", prices: [40], variations: [] },
      { id: "a4", name: "Маршмеллоу", prices: [35], variations: [] },
      { id: "a5", name: "Корица, какао", prices: [20], variations: [], note: "сверху" },
      { id: "a6", name: "Декаф", prices: [30], variations: [] },
    ];
    const hashBefore = fingerprint(old, menus(old)[0]);
    migrateWorkspace(old);
    expect(g.items.map((i) => i.name)).toEqual(fresh.groups.find((x) => x.style === "addons")!.items.map((i) => i.name));
    expect(g.items[0].id).toBe("a1"); // ценники, привязанные к позиции, остаются при ней
    expect(fingerprint(old, menus(old)[0])).toBe(hashBefore);
    expect(layoutMenu(old, menus(old)[0], fb).els).toEqual(layoutMenu(fresh, menus(fresh)[0], fb).els);
    // второй раз не делит
    g.items[1].name = "Сливки, корица";
    migrateWorkspace(old);
    expect(g.items[1].name).toBe("Сливки, корица");
  });
});

describe("колонки объёма", () => {
  it("лишняя колонка, которая сталкивается с крупным заголовком, даёт предупреждение", () => {
    const ws = seedWorkspace();
    const doc = menus(ws)[1]; // «Не кофе» — самая широкая надпись
    const g = ws.groups.find((x) => x.id === doc.groupIds[0])!;
    expect(layoutMenu(ws, doc, fb).warnings).toEqual([]);
    g.columns.push("0.50");
    for (const it of g.items) it.prices.push(300);
    expect(layoutMenu(ws, doc, fb).warnings.join(" ")).toMatch(/наезжает на колонки объёма/);
  });
});

describe("«Было / Будет»", () => {
  it("отметка об отправке хранит копию листа, и она верстается так же", () => {
    const ws = seedWorkspace();
    const doc = menus(ws)[0];
    const now = layoutMenu(ws, doc, fb);
    doc.lastSent = sentMark(ws, doc, fingerprint(ws, doc), "2026-01-01T00:00:00Z", "s1");
    expect(doc.lastSent.snap).toBeTruthy();
    const was = layoutSent(doc, fb)!;
    expect(was.els).toEqual(now.els);
    expect(changedTexts(now, was).size).toBe(0);
    // чужой отпечаток — копию не пишем: она была бы не тем, что ушло в печать
    expect(sentMark(ws, doc, "другой", "2026-01-01T00:00:00Z", "s1").snap).toBeUndefined();
    // документ без копии (отправлен раньше)
    expect(layoutSent({ ...doc, lastSent: { hash: "x", at: "", sendId: "s0" } }, fb)).toBeNull();
  });

  it("подсвечивает только изменившееся, даже если такая же цена есть в другой строке", () => {
    const ws = seedWorkspace();
    const doc = menus(ws)[0];
    doc.lastSent = sentMark(ws, doc, fingerprint(ws, doc), "2026-01-01T00:00:00Z", "s1");
    const g = ws.groups[0];
    const same = g.items[g.items.length - 1].prices.find((p) => p != null)!; // цена, которая уже есть ниже
    g.items.splice(1, 0, { id: "new", name: "Какао", prices: [same, same, same], variations: [] });
    g.items[0].prices[0] = 999;
    const now = layoutMenu(ws, doc, fb);
    const was = layoutSent(doc, fb)!;
    const marked = [...changedTexts(now, was)].map((i) => {
      const e = now.els[i];
      return e.kind === "text" ? e.text : "";
    });
    expect(marked.sort()).toEqual(["999", "КАКАО", String(same), String(same), String(same)].sort());
    // и в обратную сторону: в «Было» подсвечено то, что уйдёт
    const gone = [...changedTexts(was, now)].map((i) => {
      const e = was.els[i];
      return e.kind === "text" ? e.text : "";
    });
    expect(gone.length).toBe(1);
    // ценник тоже
    const t = tag(ws);
    t.lastSent = sentMark(ws, t, fingerprint(ws, t), "2026-01-01T00:00:00Z", "s1");
    expect(layoutSent(t, fb)!.els).toEqual(layoutTag(ws, t, fb).els);
  });
});

describe("кафе: общее название и адрес", () => {
  it("старое «Кафе 6.7» в поле адреса становится пустым адресом, настоящий адрес остаётся", () => {
    const ws = seedWorkspace();
    delete ws.schema;
    ws.cafes = [
      { id: "a", address: "Кафе 6.7" },
      { id: "b", address: "ул. Мира, 5" },
    ];
    migrateWorkspace(ws);
    expect(ws.cafes.map((c) => c.address)).toEqual(["", "ул. Мира, 5"]);
    expect(ws.cafes.map((c) => cafeLabel(c))).toEqual(["Кафе 6.7", "ул. Мира, 5"]);
  });
});

describe("получатели по кафе", () => {
  it("получатель без списка кафе печатает для всех, со списком — только для своих", () => {
    expect(contactServes({ id: "a", name: "A", email: "a@x.ru" }, "c1")).toBe(true);
    expect(contactServes({ id: "a", name: "A", email: "a@x.ru", cafeIds: ["c2"] }, "c1")).toBe(false);
    expect(contactServes({ id: "a", name: "A", email: "a@x.ru", cafeIds: ["c2"] }, "c2")).toBe(true);
  });

  it("письма разным типографиям из одной отправки — один заказ, и журнал правок у них общий", () => {
    const ws = seedWorkspace();
    const [a, b] = menus(ws);
    ws.changeLog.push({ at: "2026-01-01T10:00:00Z", text: "Капучино 0.25: 190 → 200" });
    ws.sends.push({ id: "s1", at: "2026-01-02T10:00:00Z", to: "a@x.ru", docIds: [a.id], files: [], bytes: 0, changes: 1, batch: "b1" });
    ws.changeLog.push({ at: "2026-01-02T10:00:00Z", text: "Отправлено в типографию: 1 файл(ов) → a@x.ru" });
    a.lastSent = { hash: fingerprint(ws, a), at: "2026-01-02T10:00:00Z", sendId: "s1" };
    // второму получателю той же партии журнал приходит тот же, без строки про первое письмо
    expect(changesForBatch(ws, "b1").map((c) => c.text)).toEqual(["Капучино 0.25: 190 → 200"]);
    ws.sends.push({ id: "s2", at: "2026-01-02T10:00:05Z", to: "b@x.ru", docIds: [b.id], files: [], bytes: 0, changes: 1, batch: "b1" });
    b.lastSent = { hash: fingerprint(ws, b), at: "2026-01-02T10:00:05Z", sendId: "s2" };
    expect(printStatus(ws, a)).toBe("ordered");
    expect(printStatus(ws, b)).toBe("ordered");
    // следующая отправка — прошлый заказ считается напечатанным
    ws.sends.push({ id: "s3", at: "2026-02-01T10:00:00Z", to: "a@x.ru", docIds: [], files: [], bytes: 0, changes: 0, batch: "b2" });
    expect(printStatus(ws, a)).toBe("ok");
  });
});

describe("цены из базы: срочно или к дате", () => {
  const sendAll = (ws: Workspace, at: string) => {
    ws.sends.push({ id: "s1", at, to: "a@x.ru", docIds: ws.documents.map((d) => d.id), files: [], bytes: 0, changes: 0 });
    for (const d of ws.documents) d.lastSent = { hash: fingerprint(ws, d), at, sendId: "s1" };
  };

  it("цена без даты активации — срочно; с датой в будущем — к этой дате; ручная правка — без срока", () => {
    const ws = seedWorkspace();
    sendAll(ws, "2026-01-01T00:00:00Z");
    const [coffee, notCoffee] = menus(ws);
    const cap = ws.groups[0].items[0];
    expect(docDue(ws, coffee, "2026-01-10")).toBeNull(); // всё напечатано

    // ручная правка: документ ждёт печати, но срока нет
    cap.prices[0] = 191;
    expect(printStatus(ws, coffee)).toBe("pending");
    expect(docDue(ws, coffee, "2026-01-10")).toBeNull();

    // из базы с датой в будущем
    expect(applyPriceUpdates(ws, [{ itemId: cap.id, column: 1, price: 999, activeFrom: "2026-02-01" }], "2026-01-10T09:00:00Z")).toBe(1);
    expect(cap.prices[1]).toBe(999);
    expect(docDue(ws, coffee, "2026-01-10")).toEqual({ urgent: false, date: "2026-02-01" });
    expect(docDue(ws, notCoffee, "2026-01-10")).toBeNull(); // другого листа не касается
    // дата наступила — уже срочно
    expect(docDue(ws, coffee, "2026-02-01")).toEqual({ urgent: true });

    // из базы без даты — срочно, и это важнее любой даты
    applyPriceUpdates(ws, [{ itemId: ws.groups[0].items[1].id, column: 0, price: 555 }], "2026-01-10T10:00:00Z");
    expect(docDue(ws, coffee, "2026-01-10")).toEqual({ urgent: true });
    // та же цена второй раз — не изменение
    expect(applyPriceUpdates(ws, [{ itemId: ws.groups[0].items[1].id, column: 0, price: 555 }])).toBe(0);
  });

  it("ценник помечается по своей позиции, а после отправки срок снимается", () => {
    const ws = seedWorkspace();
    sendAll(ws, "2026-01-01T00:00:00Z");
    const t = tag(ws);
    applyPriceUpdates(ws, [{ itemId: t.ref!.itemId, column: t.ref!.column, price: 321 }], "2026-01-10T09:00:00Z");
    expect(resolveTag(ws, t).price).toBe(321);
    expect(docDue(ws, t, "2026-01-10")).toEqual({ urgent: true });
    expect(dueRank(docDue(ws, t, "2026-01-10"))).toBe("0");
    expect(dueRank({ urgent: false, date: "2026-02-01" }) < dueRank(null)).toBe(true);
    // отправили — срока больше нет
    t.lastSent = { hash: fingerprint(ws, t), at: "2026-01-11T00:00:00Z", sendId: "s2" };
    expect(docDue(ws, t, "2026-01-12")).toBeNull();
  });
});

describe("шаблоны", () => {
  it("шаблоны ценников — встроенные размеры плюс добавленные; свой размер не дублируется", () => {
    const ws = seedWorkspace();
    const base = tagTemplates(ws);
    expect(base.map((t) => `${t.size.w}×${t.size.h}`)).toEqual(["90×45", "70×35", "120×60", "58×40"]);
    ws.tagTemplates = [
      { id: "t1", size: { w: 100, h: 50 }, design: "classic" },
      { id: "t2", size: { w: 90, h: 45 }, design: "classic" }, // такой уже есть
    ];
    expect(tagTemplates(ws).length).toBe(base.length + 1);
    expect(sameTemplate({ size: { w: 90, h: 45 } }, { size: { w: 90, h: 45 }, design: "classic" })).toBe(true);
    // дизайн «основной» не меняет отпечаток уже отправленных ценников
    const t = tag(ws);
    const before = fingerprint(ws, t);
    t.design = "classic";
    expect(fingerprint(ws, t)).toBe(before);
  });

  it("меню из шаблона — своя копия таблиц; все шаблоны верстаются без предупреждений", () => {
    const ws = seedWorkspace();
    const groupsBefore = ws.groups.length;
    for (const t of menuTemplates()) {
      const p = templatePreview(ws, t);
      expect(layoutMenu(p.ws, p.doc, fb).warnings).toEqual([]);
    }
    const tpl = menuTemplates()[0];
    const id = createFromTemplate(ws, tpl, ws.cafes[0].id);
    const doc = ws.documents.find((d) => d.id === id) as MenuDoc;
    expect(doc.size).toEqual(tpl.size);
    expect(ws.groups.length).toBe(groupsBefore + tpl.groups.length);
    expect(doc.groupIds.some((g) => tpl.groups.some((x) => x.id === g))).toBe(false);
    // правка нового меню шаблон не трогает
    ws.groups.find((g) => g.id === doc.groupIds[0])!.items[0].name = "Другое";
    expect(tpl.groups[0].items[0].name).not.toBe("Другое");
  });
});

describe("что изменилось с прошлой отправки", () => {
  const send = (ws: Workspace, d: MenuDoc | TagDoc) => (d.lastSent = sentMark(ws, d, fingerprint(ws, d), "2026-01-01T00:00:00Z", "s1"));

  it("меню: цены отдельно (было → стало), остальное — словами", () => {
    const ws = seedWorkspace();
    const doc = menus(ws)[0];
    expect(docChanges(ws, doc).state).toBe("new");
    send(ws, doc);
    expect(docChanges(ws, doc).state).toBe("same");

    const g = ws.groups[0];
    g.items[0].prices[0] = 200; // Капучино 0.25
    let c = docChanges(ws, doc);
    expect(c.state).toBe("changed");
    expect(c.prices).toEqual([{ what: "Капучино 0.25", from: 190, to: 200 }]);
    expect(priceChangesText(c)).toBe("Капучино 0.25: 190 → 200");
    expect(c.other).toEqual([]);

    // переставили строки и добавили позицию — цены тех же строк не считаются изменёнными
    g.items.reverse();
    g.items.push({ id: "n", name: "Какао", prices: [180, 210, 240], variations: [] });
    c = docChanges(ws, doc);
    expect(c.prices.length).toBe(1);
    expect(c.other).toContain("добавлено: Какао");
    expect(c.other).toContain("порядок позиций");
  });

  it("ценник: цена, размер и дата; без копии прошлой отправки — «изменён» без подробностей", () => {
    const ws = seedWorkspace();
    const t = tag(ws);
    send(ws, t);
    const item = ws.groups.flatMap((x) => x.items).find((i) => i.id === t.ref!.itemId)!;
    const old = item.prices[t.ref!.column];
    item.prices[t.ref!.column] = 185;
    t.size = { w: 70, h: 35 };
    t.date = "2026-03-01";
    const c = docChanges(ws, t);
    expect(c.prices).toEqual([{ what: "Цена", from: old, to: 185 }]);
    expect(c.other).toEqual(["размер 90×45 → 70×35", "дата"]);
    delete t.lastSent!.snap;
    expect(docChanges(ws, t).state).toBe("unknown");
  });
});
