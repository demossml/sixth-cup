import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader, Card, EmptyState, Input } from '../ui/kit'
import { Search } from 'lucide-react'

type Article = { id: string; section: string; title: string; body: string }

/** Content aligned with design-project help (audit): principles, scenarios, glossary — not a full 18-article CMS. */
const ARTICLES: Article[] = [
  {
    id: 'what',
    section: 'Начать',
    title: 'Что такое админка 6.7',
    body: `Админка — рабочее место владельца и менеджера: смена, меню, склад, закупки, люди, аналитика.
Касса на Эвотор продаёт и фискализирует; админка считает остатки, долги и показывает, что делать сейчас.
Начните с раздела «Сегодня»: KPI смены, очередь «Требует внимания», статус касс.`,
  },
  {
    id: 'principles',
    section: 'Начать',
    title: 'Принципы учёта',
    body: `1. Остаток на складе не правят в ячейке — только документами (накладная, инвентаризация, списание с продажи).
2. Черновик накладной не двигает остаток; проведение создаёт партию и приход.
3. Оплата всегда с привязкой к накладной — иначе долг и сверка не сходятся.
4. Сырьё списывается по норме (г/мл); штука — 1:1. Без нормы продажа не уменьшает склад (риск).
5. Партии списываются по FEFO: сначала с ближайшим «Годен до».`,
  },
  {
    id: 'map',
    section: 'Начать',
    title: 'Карта разделов',
    body: `Смена: Сегодня, Операции, Клиенты, Меню.
Управление: Касса, Склад, Закупки, Инвентаризация, Сотрудники, Контент, Рефералка.
Аналитика: Аналитика, Сравнение, События, Помощник.
Система — логи, журнал, опасная зона.

Адрес админки — / (старые ссылки на /classic.html перенаправляются сюда). Других интерфейсов
нет: это единственная админка, все разделы живут здесь.`,
  },
  {
    id: 'roles',
    section: 'Начать',
    title: 'Роли',
    body: `Owner — полный доступ (токен ADMIN_TOKEN).
Manager — контент и операции без опасных сбросов и части системных действий.
Viewer — только чтение (GET).
Точная матрица по точкам и складу уточняется продуктом; сейчас роли задаются тремя env-токенами.`,
  },
  {
    id: 'scenario-receipt',
    section: 'Сценарии',
    title: 'Приёмка в долг',
    body: `1. Склад → создайте позиции (сырьё/штуки).
2. Закупки → поставщик (справочник, не текст).
3. Новая накладная: несколько строк, количество, цена, «Годен до».
4. Сохраните черновик — остаток ещё не изменился.
5. «Провести» — партии и приход, долг поставщику.
6. «Оплатить долг» — сумма с привязкой к накладной.`,
  },
  {
    id: 'scenario-pay',
    section: 'Сценарии',
    title: 'Оплата накладной',
    body: `Оплата без накладной в v1 не проводится: API требует allocations.
На проведённой накладной с недоплатой нажмите «Оплатить долг» — закроется остаток суммы.
Взаиморасчёты: долг = сумма проведённых накладных − оплаты.`,
  },
  {
    id: 'scenario-inv-partial',
    section: 'Сценарии',
    title: 'Частичная инвентаризация',
    body: `1. Инвентаризация → Новая → Частичная → отметьте позиции.
2. Без выбранных позиций «Начать» нельзя.
3. Введите факт по строкам, сохраните.
4. «Провести» — движение inventory_adj, ожидаемый остаток = факт.
Частичная не обнуляет остальной склад.`,
  },
  {
    id: 'scenario-inv-full',
    section: 'Сценарии',
    title: 'Сплошная инвентаризация',
    body: `Тип «Сплошная» подставляет все активные позиции номенклатуры.
Заполните факт по всем строкам — иначе проведение заблокировано.
После проведения документ read-only.`,
  },
  {
    id: 'logic-coffee',
    section: 'Логика',
    title: 'Как списывается кофе',
    body: `На складе позиция «Кофе зерно», единица g или kg.
В «Нормы» свяжите товар меню (например Капучино) с позицией и количеством (18 г).
При SELL с кассы (с картой лояльности) система soft-списывает по FEFO.
Если норм нет — продажа проходит, склад не меняется; товар виден во вкладке «Без нормы».`,
  },
  {
    id: 'logic-fefo',
    section: 'Логика',
    title: 'FEFO и сроки',
    body: `Партия создаётся при проведении накладной.
Списание и расход берут сначала партии с ближайшим expires_at.
Раздел Склад → Сроки показывает горизонт 14 дней: просрочено / срочно / скоро.`,
  },
  {
    id: 'logic-link',
    section: 'Логика',
    title: 'Накладная и оплата',
    body: `Накладная = товар + долг.
Оплата закрывает долг только если распределена по накладным.

Выписка банка — два отдельных шага:
1. Сопоставить — привязать строку выписки к накладной. Долг на этом шаге НЕ меняется.
2. «Провести оплату» — создаёт платёж по этой накладной; только теперь уменьшается долг
   и цифры сходятся в «Сверках».

Проверка расхождений: Закупки → Сверки — оборот и наш долг против данных поставщика.`,
  },
  {
    id: 'gloss-batch',
    section: 'Справочник',
    title: 'Партия',
    body: `Поставка одной позиции с количеством, себестоимостью и опционально «Годен до». Источник — проведённая накладная или инвентаризация.`,
  },
  {
    id: 'gloss-norm',
    section: 'Справочник',
    title: 'Норма',
    body: `Сколько единиц склада списывается на одну единицу товара меню при продаже.`,
  },
  {
    id: 'gloss-expected',
    section: 'Справочник',
    title: 'Ожидаемый остаток',
    body: `Сумма движений: приходы − расходы. Факт — из инвентаризации; расхождение видно при проведении.`,
  },
  {
    id: 'gloss-draft',
    section: 'Справочник',
    title: 'Черновик',
    body: `Документ без влияния на остаток. После проведения — read-only по смыслу учёта (удаление проведённой накладной запрещено).`,
  },
]

const SECTIONS = ['Начать', 'Сценарии', 'Логика', 'Справочник']

export default function Help() {
  const [sp] = useSearchParams()
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string>(ARTICLES[0].id)

  useEffect(() => {
    const a = sp.get('a')
    if (a && ARTICLES.some((x) => x.id === a)) setOpenId(a)
  }, [sp])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return ARTICLES
    return ARTICLES.filter(
      (a) =>
        a.title.toLowerCase().includes(s) ||
        a.body.toLowerCase().includes(s) ||
        a.section.toLowerCase().includes(s),
    )
  }, [q])

  const current = ARTICLES.find((a) => a.id === openId) ?? filtered[0]

  return (
    <section className="view is-active" data-view="help">
      <div className="page-head">
        <div>
          <h1>Справка</h1>
          <p className="page-sub">Принципы учёта, сценарии и глоссарий по дизайн-проекту</p>
        </div>
      </div>

      <div className="relative mb-4 max-w-md">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" />
        <Input
          className="pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по статьям…"
          aria-label="Поиск в справке"
        />
      </div>

      {!filtered.length && (
        <EmptyState title="Ничего не найдено" text="Попробуйте другое слово: накладная, FEFO, норма, инвентаризация." />
      )}

      {!!filtered.length && (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <Card pad={false} className="h-fit">
            {SECTIONS.map((sec) => {
              const items = filtered.filter((a) => a.section === sec)
              if (!items.length) return null
              return (
                <div key={sec} className="border-b border-line last:border-0">
                  <div className="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                    {sec}
                  </div>
                  <ul>
                    {items.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => setOpenId(a.id)}
                          className={`w-full px-3 py-2 text-left text-[13px] ${
                            current?.id === a.id ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-secondary hover:bg-surface-2'
                          }`}
                        >
                          {a.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </Card>

          {current && (
            <Card>
              <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                {current.section}
              </div>
              <h2 className="mb-3 text-lg font-bold text-ink">{current.title}</h2>
              <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-secondary">
                {current.body}
              </div>
            </Card>
          )}
        </div>
      )}
    </section>
  )
}
