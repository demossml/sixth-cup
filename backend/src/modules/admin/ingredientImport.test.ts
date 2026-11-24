import { describe, expect, it } from 'vitest'

import { parseIngredientLines } from './ingredientImport'

const order = `Состав заказа:
Сироп Кокос (COCO.IN) 0,7 - 2 шт x 810 ₽
Сироп Табак-Ваниль (ARÔME DE TABAC) 0,7 - 1 шт x 810 ₽
Сироп Сгущенное молоко (ARMORED COW) 0,7 - 2 шт x 810 ₽
Сироп Черная смородина (BLACK CURRANT) 0,7 - 1 шт x 692 ₽
Сироп Ваниль (BOURBON VANILLA) 0,7 - 2 шт x 810 ₽
Сироп Ирис (BUTTERSCOTCH) 0,7 - 1 шт x 810 ₽
Сироп Корица (CEYLON CINNAMON) 0,7 - 1 шт x 692 ₽
Сироп Вишня (CHERRY LADY) 0,7 - 1 шт x 692 ₽
Сироп Шоколад (CHOCO BOMB) 0,7 - 2 шт x 692 ₽
Сироп Карамель (DOUBLE BURN CARAMEL) 0,7 - 2 шт x 810 ₽
Сироп Миндаль (DR. ALMOND) 0,7 - 2 шт x 757 ₽
Сироп Клубника (DOUBLE STRAWBERRY) 0,7 - 1 шт x 692 ₽
Сироп Груша (EROS PEAR ELIXIR) 0,7 - 1 шт x 692 ₽
Сироп Имбирный пряник (GINGERBREAD) 0,7 - 1 шт x 757 ₽
Сироп Банан (KING KONG) 0,7 - 1 шт x 692 ₽
Сироп Макадамия (MACADAMIA VON MUELLER) 0,7 - 1 шт x 810 ₽
Сироп Фисташка (PISTACHIO) 0,7 - 2 шт x 757 ₽
Сироп Попкорн (POPCORN) 0,7 - 2 шт x 757 ₽
Сироп Малина (RASPBERRY SHOW) 0,7 - 2 шт x 810 ₽
Сироп Красный апельсин (RED ORANGE) 0,7 - 1 шт x 810 ₽
Сироп Лесной орех (THE NUTCRACKER) 0,7 - 2 шт x 810 ₽
Сироп Бобы Тонка (PHENOMENAL TONKA) 0,7 - 1 шт x 810 ₽
Сироп Соленая карамель (DOUBLE BURN SALTED CARAMEL) 0,7 - 2 шт x 810 ₽
Сироп Орхидея (FLEUR ORHIDEE) 0,7 - 1 шт x 810 ₽`

describe('ingredient import text parser', () => {
  it('parses the supplied syrup order without confusing order count and bottle size', () => {
    const items = parseIngredientLines(order)

    expect(items).toHaveLength(24)
    expect(items[0]).toMatchObject({
      name: 'Сироп Кокос (COCO.IN)',
      unit: 'ml',
      packQty: 700,
      packPriceRub: 810,
      orderQty: 2,
      confidence: 'medium',
    })
    expect(items[3]).toMatchObject({
      name: 'Сироп Черная смородина (BLACK CURRANT)',
      packQty: 700,
      packPriceRub: 692,
      orderQty: 1,
    })
    expect(items[0]?.notes[0]).toMatch(/принята за литры/)
  })

  it('converts explicit liters and kilograms to base units', () => {
    const items = parseIngredientLines('Сироп Ваниль 0,7 л — 1 шт x 810 ₽\nКофе зерно 1,5 кг — 1 уп x 2400 ₽')

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ unit: 'ml', packQty: 700, confidence: 'high' })
    expect(items[1]).toMatchObject({ unit: 'g', packQty: 1500, packPriceRub: 2400 })
  })

  it('marks missing required fields instead of inventing a package price', () => {
    const [item] = parseIngredientLines('Сироп Малина 0,7 л — 1 шт')

    expect(item).toMatchObject({
      name: 'Сироп Малина',
      unit: 'ml',
      packQty: 700,
      packPriceRub: null,
      confidence: 'low',
    })
    expect(item?.notes).toContain('Не удалось определить цену одной упаковки')
  })
})
