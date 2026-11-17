import { DEFAULT_CAFE_ADDRESS, type Group, type Item, type Variation, type Workspace } from "./model";

// Стартовое меню: структура — как в макетах «coffee menu.pdf» и «not coffee menu.pdf»,
// цены — из выгрузки кассы data/products.csv. Цены вариаций на альтернативном молоке
// в кассе не заведены — они взяты из макета.

const n = null;
let seq = 0;
const id = (p: string) => `${p}${(++seq).toString(36)}`;

function item(name: string, prices: (number | null)[], variations: Variation[] = [], extra: Partial<Item> = {}): Item {
  return { id: id("i"), name, prices, variations, ...extra };
}
function vari(name: string, prices: (number | null)[], extra: { allergen?: boolean; sharePrice?: boolean } = {}): Variation {
  return { id: id("v"), name, ...extra, prices: [...prices] };
}
// в макете у всех видов молока одна цена — на листе они идут одним блоком с общей ценой
const milk = (prices: number[]) => [
  vari("Овсяное", prices),
  vari("Безлактозное", prices, { sharePrice: true }),
  vari("Миндальное", prices, { allergen: true, sharePrice: true }),
  vari("Кокосовое", prices, { sharePrice: true }),
];

export function seedWorkspace(): Workspace {
  seq = 0;
  const coffee: Group = {
    id: "g-coffee",
    title: "Кофе",
    style: "hero",
    columns: ["0.25", "0.35", "0.40"],
    items: [
      item("Капучино", [190, 220, 350], milk([240, 270, 300])),
      item("Латте", [200, 230, 260], milk([250, 280, 310])),
      item("Раф", [240, 270, 300], [vari("Раф халва", [260, 290, 320])]),
      item("Флэт уайт", [210, 240, n]),
      item("Моккачино", [220, 250, 280]),
      item("Бамбл", [n, 250, 280]),
      item("Эспрессо", [140, 180, n]),
    ],
  };
  const addons: Group = {
    id: "g-addons",
    title: "Добавки",
    style: "addons",
    columns: ["+"],
    items: [
      // отдельные добавки с одной ценой: стоят подряд — на листе одной строкой через запятую
      item("Сироп ваниль", [40]),
      item("Карамель", [40]),
      item("Лесной орех", [40]),
      item("Кокос", [40]),
      item("Шоколад", [40]),
      item("Доп. эспрессо", [50]),
      item("Взбитые сливки", [40]),
      item("Маршмеллоу", [35]),
      item("Корица", [20]),
      item("Какао", [20], [], { note: "сверху" }),
      item("Декаф", [30]),
    ],
  };
  const notCoffee: Group = {
    id: "g-notcoffee",
    title: "Не кофе",
    style: "hero",
    columns: ["0.25", "0.35", "0.40"],
    items: [
      item("Какао", [180, 210, 240]),
      item("Матча латте", [230, 260, 290]),
      item("Горячий шоколад", [220, 250, n]),
      item("Чай чёрный", [n, 130, 150]),
      item("Чай ягодный", [n, 170, 190]),
      item("Чай зелёный", [n, 130, 150]),
    ],
  };
  const cold: Group = {
    id: "g-cold",
    title: "Холодные",
    style: "section",
    columns: ["0.30", "0.40", "0.50"],
    items: [
      item("Айс латте", [210, 240, 270]),
      item("Айс американо", [160, 180, 200]),
      item("Лимонад ягодный", [n, 200, 230]),
      item("Лимонад", [n, 180, 210]),
    ],
  };
  const food: Group = {
    id: "g-food",
    title: "К кофе",
    style: "compact",
    columns: ["1 шт"],
    items: [
      item("Круассан классический", [160]),
      item("Круассан с миндалём", [200]),
      item("Сырник", [170]),
      item("Чизкейк Нью-Йорк", [280]),
      item("Сэндвич с курицей", [260]),
      item("Брауни", [200]),
      item("Тирамису", [290]),
      item("Печенье шоколадное", [90]),
    ],
  };
  const now = "2026-11-15T00:00:00.000Z";
  const croissant = food.items[0];
  return {
    rev: 1,
    schema: 2,
    brand: {
      accent: "#0D0DDE",
      priceNote: "Цены указаны в рублях РФ, с учетом НДС",
      allergenNote: "А — аллерген",
      maker: "ИП «Алексеева А.Б.»",
    },
    cafes: [{ id: "c-main", address: DEFAULT_CAFE_ADDRESS }],
    groups: [coffee, addons, notCoffee, cold, food],
    documents: [
      { id: "d-menu-coffee", kind: "menu", cafeId: "c-main", name: "Кофе", size: { w: 210, h: 297 }, groupIds: [coffee.id, addons.id], createdAt: now },
      { id: "d-menu-notcoffee", kind: "menu", cafeId: "c-main", name: "Не кофе", size: { w: 210, h: 297 }, groupIds: [notCoffee.id, cold.id, food.id], createdAt: now },
      {
        id: "d-tag-croissant", kind: "tag", cafeId: "c-main", name: "Круассан классический", size: { w: 90, h: 45 },
        ref: { groupId: food.id, itemId: croissant.id, column: 0 }, showInfo: true, date: "2026-11-20", createdAt: now,
      },
      {
        id: "d-tag-croissant-small", kind: "tag", cafeId: "c-main", name: "Круассан классический", size: { w: 70, h: 35 }, copyOf: "d-tag-croissant",
        ref: { groupId: food.id, itemId: croissant.id, column: 0 }, showInfo: true, date: "2026-11-20", createdAt: now,
      },
    ],
    contacts: [],
    sends: [],
    changeLog: [],
  };
}
