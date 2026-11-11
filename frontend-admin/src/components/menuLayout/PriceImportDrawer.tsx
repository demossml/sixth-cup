import { useMemo, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button, Drawer, Field, cx, useToast } from '../../ui/kit'
import { parsePriceRows, priceRowText, type PriceRow } from '../../lib/priceImport'

type Props = {
  open: boolean
  onClose: () => void
  /** Вставить готовые строки на лист: редактор раскладывает их блоками. */
  onImport: (rows: PriceRow[]) => void
}

/**
 * P3-1: импорт прайса из CSV. Показываем построчно, что распознано и где ошибка,
 * и вставляем только валидные строки — «файл не подошёл» ничего не объясняет.
 */
export default function PriceImportDrawer({ open, onClose, onImport }: Props) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)

  const parsed = useMemo(() => (text.trim() ? parsePriceRows(text) : null), [text])
  const ready = parsed?.rows.filter((r) => r.ok) ?? []

  const pick = async (file: File) => {
    try {
      // Excel сохраняет в UTF-8 с BOM или в CP1251: cp1251 узнаём по «кракозябрам».
      const buf = await file.arrayBuffer()
      const utf8 = new TextDecoder('utf-8').decode(buf)
      const text = /�/.test(utf8) ? new TextDecoder('windows-1251').decode(buf) : utf8
      setText(text)
      setFileName(file.name)
      setPasteOpen(false)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось прочитать файл', 'bad')
    }
  }

  const reset = () => {
    setText('')
    setFileName('')
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Импорт прайса из CSV"
      layer={68}
      footer={
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-[11.5px] text-ink-tertiary">
            {parsed ? `Готово к вставке: ${parsed.okCount}${parsed.errorCount ? `, с ошибками: ${parsed.errorCount}` : ''}` : 'Файл не выбран'}
          </span>
          <Button
            size="sm"
            disabled={ready.length === 0}
            onClick={() => {
              onImport(ready)
              toast.push(`Добавлено позиций: ${ready.length}`)
              reset()
              onClose()
            }}
          >
            Вставить на лист
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-[12.5px] text-ink-secondary">
        Колонки: <span className="font-mono">название; цена; объём</span> (объём необязателен). Разделитель «;» или
        «,», заголовок можно оставить — он распознаётся. Позиции добавляются текстовыми блоками и не меняют каталог.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-lg border border-line bg-white px-2.5 text-[12.5px] font-semibold text-brand hover:border-brand">
          <Upload size={14} /> Выбрать файл
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void pick(f)
              e.target.value = ''
            }}
          />
        </label>
        <Button size="sm" variant="secondary" onClick={() => setPasteOpen((v) => !v)}>
          {pasteOpen ? 'Скрыть вставку' : 'Вставить текст'}
        </Button>
        {fileName && <span className="text-[11.5px] text-ink-tertiary">{fileName}</span>}
        {(text || fileName) && (
          <button type="button" onClick={reset} className="text-[11.5px] text-ink-tertiary hover:text-bad">
            очистить
          </button>
        )}
      </div>

      {pasteOpen && (
        <Field label="Вставьте CSV">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setFileName('')
            }}
            rows={5}
            placeholder={'Название;Цена;Объём\nЛатте;220;250 мл'}
            aria-label="CSV для импорта"
            className="w-full rounded-lg border border-line px-2 py-1.5 font-mono text-[12px] outline-none focus:border-brand"
          />
        </Field>
      )}

      {parsed && parsed.rows.length === 0 && <p className="text-[12.5px] text-ink-tertiary">В файле нет строк с данными.</p>}

      {parsed && parsed.rows.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-tertiary">
              <tr>
                <th className="px-2 py-1 font-semibold">#</th>
                <th className="px-2 py-1 font-semibold">Позиция</th>
                <th className="px-2 py-1 font-semibold">Цена</th>
                <th className="px-2 py-1 font-semibold">Объём</th>
                <th className="px-2 py-1 font-semibold">Статус</th>
              </tr>
            </thead>
            <tbody>
              {parsed.rows.slice(0, 200).map((r) => (
                <tr key={r.line} className={cx('border-t border-line', !r.ok && 'bg-bad-soft/30')}>
                  <td className="px-2 py-1 tabular-nums text-ink-tertiary">{r.line}</td>
                  <td className="px-2 py-1">{r.name || '—'}</td>
                  <td className="px-2 py-1 tabular-nums">{r.ok ? `${r.price} ₽` : '—'}</td>
                  <td className="px-2 py-1 text-ink-secondary">{r.volume || '—'}</td>
                  <td className={cx('px-2 py-1', r.ok ? 'text-ok' : 'text-bad')}>{r.ok ? 'ок' : r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {parsed.rows.length > 200 && (
            <p className="px-2 py-1 text-[11px] text-ink-tertiary">Показаны первые 200 строк из {parsed.rows.length}.</p>
          )}
        </div>
      )}

      {ready.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-tertiary">
          На листе будет: {ready.slice(0, 3).map((r) => priceRowText(r)).join(' · ')}
          {ready.length > 3 ? ` и ещё ${ready.length - 3}` : ''}
        </p>
      )}
    </Drawer>
  )
}
