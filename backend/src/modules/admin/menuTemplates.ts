/**
 * Библиотека шаблонов листа (аудит, задача 3.4, MVP).
 *
 * Шаблон — это не картинка, а набор правил раскладки: колонки, высота позиции, отступы.
 * Один и тот же каталог в разных шаблонах даёт разный лист, а блоки остаются обычными.
 */
import type { FlowOptions } from './menuLayoutFlow'

export type MenuTemplate = {
  id: string
  name: string
  goal: string
  format: 'a4_portrait' | 'a4_landscape' | 'a3_portrait' | 'ratio_1_1' | 'screen_16_9'
  /** Пресет темы, который ставится вместе с шаблоном. */
  theme: 'classic' | 'dark' | 'season'
  options: FlowOptions
}

export const MENU_TEMPLATES: MenuTemplate[] = [
  {
    id: 'classic-two-column',
    name: 'Классика · две колонки',
    goal: 'Плотный лист для кофейни: много позиций, спокойная типографика',
    format: 'a4_portrait',
    theme: 'classic',
    options: { columns: 2, itemHeight: 5, itemHeightWithSizes: 7, sectionHeight: 5.5 },
  },
  {
    id: 'one-column-large',
    name: 'Крупный список · одна колонка',
    goal: 'Читается с расстояния: крупные строки, меньше позиций',
    format: 'a4_portrait',
    theme: 'classic',
    options: { columns: 1, itemHeight: 8, itemHeightWithSizes: 11, sectionHeight: 7 },
  },
  {
    id: 'compact-price-list',
    name: 'Компактный прайс',
    goal: 'Максимум позиций на листе, как прайс-лист',
    format: 'a4_portrait',
    theme: 'classic',
    options: { columns: 2, itemHeight: 4.2, itemHeightWithSizes: 5.6, sectionHeight: 4.8, gap: 4 },
  },
  {
    id: 'photo-menu',
    name: 'Фотоменю',
    goal: 'Позиции с фото: крупные строки, акцент на картинке',
    format: 'a4_portrait',
    theme: 'season',
    options: { columns: 2, itemHeight: 11, itemHeightWithSizes: 14, sectionHeight: 6.5 },
  },
  {
    id: 'dark-bar',
    name: 'Тёмный бар',
    goal: 'Вечерний лист на тёмном фоне',
    format: 'a4_portrait',
    theme: 'dark',
    options: { columns: 2, itemHeight: 6, itemHeightWithSizes: 8, sectionHeight: 6 },
  },
  {
    id: 'screen-16-9',
    name: 'Экран · 16:9',
    goal: 'Витрина для монитора или телевизора над баром',
    format: 'screen_16_9',
    theme: 'classic',
    options: { columns: 2, itemHeight: 9, itemHeightWithSizes: 12, sectionHeight: 8, top: 15 },
  },
]

export const findTemplate = (id: string | null | undefined): MenuTemplate | null =>
  MENU_TEMPLATES.find((t) => t.id === id) ?? null
