/**
 * F9: «Загрузить» — Excel/CSV, вставка текста и ИИ-прайс пишут в модель v2
 * (позиции склада + техкарты), а не в старые cost_*.
 */
import { useState } from 'react'

import { Button, Card, Spinner, cx, useToast } from '../../ui/kit'
import { Upload } from 'lucide-react'

import { api, tokenStore } from '../../api/client'

const API = (import.meta as any).env?.VITE_API_URL ?? ''

type ImportResult = {
  parsed: number
  cardsCreated: number
  cardsUpdated: number
  linesAdded: number
  itemsCreated: number
  itemsWithoutPrice?: string[]
}

type AiItem = {
  name: string
  unit: string
  packQty: number
  packPriceRub: number | null
  confidence?: string
  selected?: boolean
}

export default function ImportPanel({ onClose, onImported }: { onClose: () => void; onImported: (summary: string) => void }) {
  const toast = useToast()
  const [section, setSection] = useState<'file' | 'text' | 'ai'>('file')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const describe = (r: ImportResult) => {
    const parts = [
      `Рецептов: ${r.parsed}`,
      `новых карт: ${r.cardsCreated}`,
      `обновлено: ${r.cardsUpdated}`,
      `строк: ${r.linesAdded}`,
      `новых ингредиентов: ${r.itemsCreated}`,
    ]
    if (r.itemsWithoutPrice?.length) parts.push(`без цены: ${r.itemsWithoutPrice.length}`)
    return parts.join(' · ')
  }

  const runText = async () => {
    setBusy(true)
    try {
      const res = await api<ImportResult>('/cost/import/techcards-text', { method: 'POST', body: { text } })
      const summary = describe(res)
      setResult(summary)
      onImported(summary)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка импорта', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const runFile = async (file: File) => {
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${API}/api/admin/cost/import/techcards-file`, {
        method: 'POST',
        headers: { 'X-Admin-Token': tokenStore.get() },
        body: fd,
      })
      const j = (await res.json().catch(() => ({}))) as ImportResult & { error?: string; message?: string }
      if (!res.ok) throw new Error(j.error || j.message || res.statusText)
      const summary = describe(j)
      setResult(summary)
      onImported(summary)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка файла', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const sectionBtn = (key: 'file' | 'text' | 'ai', label: string) => (
    <button key={key} type="button" onClick={() => setSection(key)} className={cx('seg-item', section === key && 'is-on')} aria-pressed={section === key}>
      {label}
    </button>
  )

  return (
    <Card className="space-y-3 border-brand p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold">
          <Upload size={18} /> Загрузить
        </div>
        <Button variant="ghost" onClick={onClose}>
          Закрыть
        </Button>
      </div>
      <p className="text-sm text-ink-secondary">
        Техкарта из Excel/CSV или текстом — карты создадутся черновиками, ингредиенты появятся в складе.
        Позиции без цены подсветятся в «Сигналах».
      </p>
      <div className="seg inline-flex flex-wrap gap-[2px] rounded-[10px] border border-line bg-surface-2 p-[3px]">
        {sectionBtn('file', 'Excel / файл')}
        {sectionBtn('text', 'Вставить текст')}
        {sectionBtn('ai', 'ИИ-прайс')}
      </div>

      {section === 'file' && (
        <div className="space-y-2">
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.tsv,.txt"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void runFile(f)
            }}
          />
          <div className="text-xs text-ink-secondary">Excel (.xlsx/.xls), CSV/TSV или TXT. Техкарты и цены сопоставятся по названию.</div>
        </div>
      )}

      {section === 'text' && (
        <div className="space-y-2">
          <textarea
            className="min-h-[140px] w-full rounded-xl border border-line p-3 font-mono text-sm"
            placeholder={'КАПУЧИНО 200\nкофе молотый — 10 г\nмолоко — 150 мл\nстакан 200 мл — 1 шт'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button disabled={busy || !text.trim()} onClick={runText}>
            {busy ? 'Импорт…' : 'Импортировать текст'}
          </Button>
        </div>
      )}

      {section === 'ai' && <AiSection onDone={onImported} />}

      {busy && <Spinner />}
      {result && <div className="rounded-lg bg-surface-2 p-3 text-sm">{result}</div>}
    </Card>
  )
}

/** ИИ-прайс: разбор текста в позиции склада с ценой за единицу. */
function AiSection({ onDone }: { onDone: (summary: string) => void }) {
  const toast = useToast()
  const [text, setText] = useState('Молоко 3,2% 1 л — 95 ₽\nСтаканы 200 мл, 50 шт — 310 ₽\nКрышки 80 мм, 50 шт — 190 ₽')
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<AiItem[]>([])

  const parse = async () => {
    setBusy(true)
    try {
      const res = await api<{ items: AiItem[] }>('/cost/ai/parse', { method: 'POST', body: { text } })
      setItems((res.items || []).map((i) => ({ ...i, selected: true })))
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка ИИ', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    const sel = items.filter((i) => i.selected !== false)
    if (!sel.length) return
    setBusy(true)
    try {
      const res = await api<{ created: number }>('/cost/import/items-bulk', {
        method: 'POST',
        body: {
          items: sel.map((i) => ({ name: i.name, unit: i.unit, packQty: i.packQty, packPriceRub: i.packPriceRub })),
        },
      })
      const summary = `Позиций добавлено: ${res.created}`
      toast.push(summary, 'ok')
      onDone(summary)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-sm text-ink-secondary">Вставьте прайс поставщика — ИИ предложит позиции с фасовкой и ценой. Проверьте и добавьте.</div>
      <textarea className="min-h-[100px] w-full rounded-xl border border-line p-3 text-sm" value={text} onChange={(e) => setText(e.target.value)} />
      <Button disabled={busy} onClick={parse}>
        {busy ? 'Разбираю…' : 'Извлечь'}
      </Button>
      {!!items.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary">
                <th className="p-1"></th>
                <th className="p-1">Название</th>
                <th className="p-1">Фасовка</th>
                <th className="p-1">₽</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx} className={cx('border-t border-line', it.packPriceRub == null && 'bg-red-50')}>
                  <td className="p-1">
                    <input
                      type="checkbox"
                      checked={it.selected !== false}
                      onChange={(e) => {
                        const next = [...items]
                        next[idx] = { ...it, selected: e.target.checked }
                        setItems(next)
                      }}
                    />
                  </td>
                  <td className="p-1">{it.name}</td>
                  <td className="p-1">
                    {it.packQty} {it.unit}
                  </td>
                  <td className="p-1">{it.packPriceRub ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button className="mt-2" disabled={busy} onClick={commit}>
            Добавить выбранные
          </Button>
        </div>
      )}
    </div>
  )
}
