/**
 * F13: печатная технологическая карта (ТТК).
 *
 * Открывается по ссылке `#/cost/card/:id/print` — без админ-оболочки, чтобы в PDF
 * не попали меню и кнопки. Содержимое считает `lib/techcardPrint.ts` (там же тесты),
 * страница только рисует лист А4.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { Button, ErrorBox, Spinner } from '../ui/kit'
import { Printer, X } from 'lucide-react'

import { costApi, type TechCard } from '../lib/costApi'
import { techCardPrint } from '../lib/techcardPrint'
import '../styles/techcardPrint.css'

export default function CostCardPrint() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [card, setCard] = useState<TechCard | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const cardId = Number(id)
    if (!Number.isFinite(cardId)) {
      setError(new Error('Некорректный номер техкарты'))
      return
    }
    costApi
      .card(cardId)
      .then((r) => setCard(r.card))
      .catch((e) => setError(e instanceof Error ? e : new Error('Не удалось загрузить техкарту')))
  }, [id])

  // Имя файла при «Сохранить как PDF» берётся из заголовка документа.
  useEffect(() => {
    if (!card) return
    const prev = document.title
    document.title = `ТТК-${card.id} ${card.name}`
    return () => {
      document.title = prev
    }
  }, [card])

  if (error) return <ErrorBox message={error.message} />
  if (!card) return <Spinner />

  const p = techCardPrint(card)

  return (
    <div className="min-h-screen bg-page py-6">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center gap-2 px-3">
        <Button variant="secondary" onClick={() => navigate('/cost?focus=tech')}>
          <X size={14} /> Закрыть
        </Button>
        <div className="text-[12px] text-ink-secondary">
          Печать технологической карты № {p.number}. В диалоге печати выберите «Сохранить как PDF», если нужен файл.
        </div>
        <Button className="ml-auto" onClick={() => window.print()}>
          <Printer size={14} /> Печать
        </Button>
      </div>

      <div className="ttk-sheet">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide">6.7 Coffee</div>
            <h1 className="mt-1 text-[16px] font-bold">Технологическая карта № {p.number}</h1>
            <div className="text-[13px] font-semibold">{p.title}</div>
            <div className="text-[11px]">
              {p.kind} · {p.versionText}
            </div>
          </div>
          <div className="text-right text-[11px]">
            <div>Выход изделия: {p.outputText}</div>
            <div>Дата печати: {new Date().toLocaleDateString('ru-RU')}</div>
          </div>
        </div>

        {p.warnings.length > 0 && (
          <div className="ttk-block mb-3 border border-[#999] px-2 py-1 text-[11px]">
            <span className="font-semibold">Внимание: </span>
            {p.warnings.join(' ')}
          </div>
        )}

        <div className="ttk-block mb-2 text-[12px] font-semibold">Рецептура</div>
        <table className="ttk-table">
          <thead>
            <tr>
              <th className="num" style={{ width: '8mm' }}>
                №
              </th>
              <th>Наименование сырья</th>
              <th className="num">Брутто</th>
              <th className="num">Нетто</th>
              <th className="num">Выход</th>
              <th>Ед.</th>
              <th className="num">Цена, ₽</th>
              <th className="num">Сумма, ₽</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center' }}>
                  Состав не заполнен
                </td>
              </tr>
            )}
            {p.rows.map((r) => (
              <tr key={r.n}>
                <td className="num">{r.n}</td>
                <td>
                  {r.name}
                  {r.isSemi && <span className="text-[10px]"> (заготовка)</span>}
                  {r.losses && <div className="text-[10px]">{r.losses}</div>}
                </td>
                <td className="num">{r.brutto}</td>
                <td className="num">{r.netto}</td>
                <td className="num">{r.out}</td>
                <td>{r.unit}</td>
                <td className="num">{r.unitPriceRub}</td>
                <td className="num">{r.sumRub}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ttk-block mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
          {p.totals.map((t) => (
            <div key={t.label} className={`flex justify-between border-b border-dotted border-[#bbb] ${t.strong ? 'font-bold' : ''}`}>
              <span>{t.label}</span>
              <span className="tabular-nums">{t.value}</span>
            </div>
          ))}
        </div>

        <div className="ttk-block mt-4">
          <div className="mb-1 text-[12px] font-semibold">Технология приготовления</div>
          <div className="whitespace-pre-wrap text-[11.5px]">{p.technology}</div>
        </div>

        <div className="ttk-sign">
          <div>
            Заведующий производством <span className="ttk-line" />
          </div>
          <div>
            Калькулятор <span className="ttk-line" />
          </div>
          <div>
            Дата «____» ____________ 20___ г.
          </div>
          <div>
            Подпись ответственного <span className="ttk-line" />
          </div>
        </div>

        <div className="mt-6 text-[9.5px] text-[#555]">
          Себестоимость рассчитана по ценам склада (накладные, история, ручная цена). Изменение цены сырья
          меняет карточку автоматически — перед печатью проверьте дату версии.
        </div>
      </div>
    </div>
  )
}
