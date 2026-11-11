import { useEffect, useState } from 'react'
import { Check, Download, X } from 'lucide-react'
import { Button, cx, Field, Input, Select } from '../../ui/kit'
import { formatFull, type LayoutFormat } from '../../lib/menuLayout'
import { IMPOSE_LABELS, type ExportRequest, type ImposePreset } from '../../lib/exportQueue'

/** Замечание печати, мешающее собрать PDF: показываем в диалоге со ссылкой на блок. */
export type Blocker = { blockId: string; code: string; text: string; label: string; pageIdx: number }

export type ExportProps = {
  open: boolean
  onClose: () => void
  layoutId: number
  format: LayoutFormat
  pages: number
  blockers: Blocker[]
  onGoToBlock: (blockId: string, pageIdx: number) => void
  /** Экспорт ставится в очередь: модалка закрывается сразу, прогресс — в панели задач. */
  onStart: (req: ExportRequest) => void
  /** Сколько открытых замечаний: их можно положить в PDF стикерами. */
  notesCount: number
}

/**
 * Диалог экспорта. Сам ничего не скачивает: только собирает настройки и ставит
 * задачу в очередь редактора, поэтому «Скачать» больше не блокирует интерфейс.
 */
export default function ExportModal({
  open,
  onClose,
  layoutId,
  format,
  pages,
  blockers,
  onGoToBlock,
  onStart,
  notesCount,
}: ExportProps) {
  const [preset, setPreset] = useState<'print' | 'screen'>('print')
  const [bleed, setBleed] = useState(3)
  const [cmyk, setCmyk] = useState(false)
  /** Спуск полос: только для печати, для экрана бессмысленнен. */
  const [impose, setImpose] = useState<ImposePreset>('off')
  // Есть замечания — по умолчанию кладём их в PDF: в этом и смысл замечаний.
  const [notes, setNotes] = useState(notesCount > 0)

  // Модалка живёт между открытиями, поэтому состояние подтягиваем при каждом показе:
  // иначе чекбокс «Замечания» оставался бы выключенным, если замечание добавили позже.
  useEffect(() => {
    if (!open) return
    setNotes(notesCount > 0)
    setImpose('off')
  }, [open, notesCount])

  if (!open) return null

  /** При спуске полос аннотации не ставятся: лист масштабирован, стикер уехал бы не туда. */
  const notesAllowed = notesCount > 0 && impose === 'off'
  /** Сколько листов выйдет при выбранном спуске. */
  const perSheet = impose === 'a3-2' ? 2 : impose === 'off' ? 1 : 4
  const sheets = Math.max(1, Math.ceil(pages / perSheet))

  const submit = (force: boolean) => {
    onStart({
      layoutId,
      preset,
      bleed: preset === 'print' ? bleed : 0,
      cmyk,
      notes: notes && notesAllowed,
      impose: preset === 'print' ? impose : 'off',
      force,
    })
    onClose()
  }

  const hard = blockers.filter((b) => b.code !== 'notice')

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Экспорт PDF" className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-ink-tertiary">Печать и экран</p>
            <h2 className="text-lg font-bold">Экспорт PDF</h2>
            <p className="mt-0.5 text-[13px] text-ink-secondary">Файл для типографии или отправки гостю.</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full hover:bg-surface-2" aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
              {(
                [
                  ['print', 'Для печати'],
                  ['screen', 'Для экрана'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPreset(k)}
                  aria-pressed={preset === k}
                  className={cx('min-h-8 flex-1 rounded-md text-[12.5px] font-semibold', preset === k ? 'bg-white text-brand shadow-sm' : 'text-ink-secondary')}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3 space-y-2">
              <Field label="Формат">
                <Input value={formatFull(format)} readOnly />
              </Field>
              <Field label="Поля под обрез">
                <Select value={String(bleed)} onChange={(e) => setBleed(Number(e.target.value))} disabled={preset === 'screen'}>
                  <option value="3">3 мм (рекомендуется)</option>
                  <option value="0">0 мм</option>
                  <option value="5">5 мм</option>
                </Select>
              </Field>
              {preset === 'print' && (
                <Field label="Спуск полос" hint={`${pages} стр. → ${sheets} л.`}>
                  <Select value={impose} onChange={(e) => setImpose(e.target.value as ImposePreset)} aria-label="Спуск полос">
                    {(Object.keys(IMPOSE_LABELS) as ImposePreset[]).map((k) => (
                      <option key={k} value={k}>
                        {IMPOSE_LABELS[k]}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
                <input type="checkbox" checked={cmyk} onChange={(e) => setCmyk(e.target.checked)} />
                Цвета в CMYK (для типографии)
              </label>
              <label className={cx('flex items-start gap-2 text-[12.5px]', notesCount > 0 && impose === 'off' ? 'text-ink-secondary' : 'text-ink-tertiary')}>
                <input
                  type="checkbox"
                  checked={notes && notesAllowed}
                  disabled={!notesAllowed}
                  onChange={(e) => setNotes(e.target.checked)}
                />
                <span>
                  Замечания к блокам{notesCount > 0 ? ` (${notesCount})` : ''} — стикерами в PDF
                  {notesCount === 0 ? ': открытых замечаний нет' : impose !== 'off' ? ': при спуске полос не ставятся' : ''}
                </span>
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-line p-3">
            <p className="mb-2 text-[12px] font-semibold text-ink-secondary">Что будет в файле</p>
            <ul className="space-y-1.5 text-[12.5px]">
              <li className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 flex-none text-ok" aria-hidden /> Блоки печатаются на своих координатах
              </li>
              <li className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 flex-none text-ok" aria-hidden /> Текст векторный, шрифты встроены
              </li>
              <li className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 flex-none text-ok" aria-hidden /> {pages} стр. · метки реза при полях
              </li>
              <li className={cx('flex items-start gap-2', cmyk ? 'text-ink-secondary' : 'text-warn')}>
                <span className="mt-[3px] flex-none text-[11px] font-bold">{cmyk ? 'CMYK' : 'RGB'}</span>
                {cmyk
                  ? 'Цвета текста и плашек — Device CMYK. Фото остаются RGB, их конвертирует печатная машина.'
                  : 'Цвета в PDF — RGB. Для типографии включите CMYK или согласуйте профиль.'}
              </li>
              {hard.length > 0 && (
                <li className="flex items-start gap-2 text-bad">
                  <X size={14} className="mt-0.5 flex-none" aria-hidden /> {hard.length} позиц. без цены/удалены из каталога
                </li>
              )}
            </ul>
            {hard.length > 0 && (
              <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-[12px]">
                {hard.map((b) => (
                  <li key={`${b.blockId}-${b.text}`}>
                    <button type="button" onClick={() => onGoToBlock(b.blockId, b.pageIdx)} className="text-left text-brand hover:underline">
                      {b.label} — {b.text} → открыть блок
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-ink-tertiary">
            PDF векторный: текст не растрируется. Сборка идёт в фоне — можно продолжать работать.
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Отмена
            </Button>
            {hard.length > 0 ? (
              <Button icon={<Download size={15} />} onClick={() => submit(true)}>
                Всё равно скачать
              </Button>
            ) : (
              <Button icon={<Download size={15} />} onClick={() => submit(false)}>
                Скачать PDF
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
