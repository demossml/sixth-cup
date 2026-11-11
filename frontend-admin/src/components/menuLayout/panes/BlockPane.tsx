import { Eye, EyeOff, Layers, Loader2, Lock, LockOpen, Trash2, Type, Upload } from "lucide-react"
import { Button, Field, Input, Select, cx } from "../../../ui/kit"
import { ago } from "../../../lib/format"
import { effectiveType, clampRect, MIN_H, MIN_W, LAYOUT_FORMATS, bringToFront, sendToBack, toggleHidden, type BlockStyle, type LayoutComment, type LayoutFormat, type MenuBlock, type MenuDoc } from "../../../lib/menuLayout"
import { styleUsage } from "../../../lib/blockStyles"
import { mmToPct, pctToMm, sheetMm } from "../../../lib/sheetGeometry"
import PhotoDpiHint from "../PhotoDpiHint"

type Props = {
  selected: MenuBlock | null
  layerName: (b: MenuBlock) => string
  toggleLock: (id: string) => void
  format: LayoutFormat
  unit: "pct" | "mm"
  setUnit: (u: "pct" | "mm") => void
  patchBlock: (patch: Partial<MenuBlock>, id?: string | null) => void
  boundStyle: BlockStyle | null
  styles: BlockStyle[]
  doc: MenuDoc | null
  bindSelectedToStyle: (id: string) => void
  detachSelectedFromStyle: () => void
  refreshStyleFromBlock: () => void
  createStyleFromBlock: () => void
  newStyleName: string
  setNewStyleName: (v: string) => void
  blockNotes: LayoutComment[]
  toggleNote: (id: string, resolved: boolean) => void
  deleteNote: (id: string) => void
  noteText: string
  setNoteText: (v: string) => void
  addNote: () => void
  autofitText: (id: string) => void
  busyUpload: boolean
  uploadInto: (file: File, apply: (url: string) => void, full?: boolean) => Promise<void>
  setImageUrl: (value: string, field: "url" | "photoUrlOverride") => void
  updatePage: (updater: (blocks: MenuBlock[]) => MenuBlock[]) => void
  deleteBlock: (id: string) => void
}

/** Панель «Блок»: положение, стиль, замечания, содержимое и действия. */
export default function BlockPane({
  selected,
  layerName,
  toggleLock,
  format,
  unit,
  setUnit,
  patchBlock,
  boundStyle,
  styles,
  doc,
  bindSelectedToStyle,
  detachSelectedFromStyle,
  refreshStyleFromBlock,
  createStyleFromBlock,
  newStyleName,
  setNewStyleName,
  blockNotes,
  toggleNote,
  deleteNote,
  noteText,
  setNoteText,
  addNote,
  autofitText,
  busyUpload,
  uploadInto,
  setImageUrl,
  updatePage,
  deleteBlock,
}: Props) {
  if (!selected) {
    return (
      <div className="p-3 text-[13px] text-ink-secondary">
        Выберите блок на холсте или в списке слоёв — здесь появятся его координаты и свойства.
      </div>
    )
  }
  const selectedType = effectiveType(selected)
  /** Кадр фото: масштаб и точка фокуса. Один и тот же блок настроек для фото и позиции. */
  const cropControls = (block: MenuBlock) => {
    const crop = block.photoCrop ?? { zoom: 1, x: 0.5, y: 0.5 }
    const setCrop = (next: { zoom: number; x: number; y: number } | null) => patchBlock({ photoCrop: next }, block.id)
    return (
      <div className="mt-2 rounded-lg border border-line p-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[12px] text-ink-secondary">Кадрирование</span>
          <button
            type="button"
            onClick={() => setCrop(null)}
            className="text-[11px] text-ink-tertiary hover:text-brand"
            disabled={!block.photoCrop}
          >
            сбросить
          </button>
        </div>
        <label className="block text-[11px] text-ink-tertiary">
          масштаб ×{crop.zoom.toFixed(1)}
          <input
            type="range"
            min={1}
            max={3}
            step={0.1}
            value={crop.zoom}
            onChange={(e) => setCrop({ ...crop, zoom: Number(e.target.value) })}
            className="mt-1 w-full"
            aria-label="Масштаб кадра"
          />
        </label>
        <div className="mt-1.5 grid w-[72px] grid-cols-3 gap-0.5" role="group" aria-label="Точка фокуса">
          {[0, 0.5, 1].map((y) =>
            [0, 0.5, 1].map((x) => (
              <button
                key={`${x}-${y}`}
                type="button"
                onClick={() => setCrop({ ...crop, x, y })}
                aria-label={`Фокус ${Math.round(x * 100)}% / ${Math.round(y * 100)}%`}
                aria-pressed={Math.abs(crop.x - x) < 0.01 && Math.abs(crop.y - y) < 0.01}
                className={cx(
                  'h-5 w-5 rounded-sm border',
                  Math.abs(crop.x - x) < 0.01 && Math.abs(crop.y - y) < 0.01 ? 'border-brand bg-brand/20' : 'border-line hover:border-brand/50',
                )}
              />
            )),
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-start gap-2 border-b border-line px-3 py-3">
        {selected.displayImageUrl ? (
          <img src={selected.displayImageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
        ) : (
          <span className="grid h-12 w-12 place-items-center rounded-lg bg-surface-2 text-ink-tertiary">
            <Type size={16} aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-ink-tertiary">{selectedType === 'product' ? 'Позиция' : 'Блок'}</p>
          <p className="truncate text-[13px] font-semibold text-ink">{layerName(selected)}</p>
          <p className="truncate text-[11px] text-ink-tertiary">
            {selected.productId
              ? [selected.displayCategory ?? 'Каталог 6.7', selected.displaySizes && selected.displaySizes.length > 1
                  ? `${selected.displaySizes.length} объёма`
                  : selected.product?.variantLabel ?? null]
                  .filter(Boolean)
                  .join(' · ')
              : `слой ${selected.zIndex}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => toggleLock(selected.id)}
          className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-md', selected.locked ? 'bg-surface-2 text-brand' : 'text-ink-tertiary hover:text-brand')}
          aria-pressed={!!selected.locked}
          aria-label={selected.locked ? 'Снять замок' : 'Закрепить блок'}
          title={selected.locked ? 'Снять замок' : 'Закрепить блок'}
        >
          {selected.locked ? <Lock size={14} /> : <LockOpen size={14} />}
        </button>
      </div>

      <section className="border-b border-line px-3 py-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold">Положение и размер</h3>
          <div className="flex gap-1 rounded-md bg-surface-2 p-0.5">
            {(sheetMm(format) ? (['pct', 'mm'] as const) : (['pct'] as const)).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                aria-pressed={unit === u}
                className={cx('rounded px-1.5 py-0.5 text-[10.5px] font-semibold', unit === u ? 'bg-white text-brand shadow-sm' : 'text-ink-tertiary')}
              >
                {u === 'pct' ? '%' : 'мм'}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(unit === 'pct'
            ? ([
                ['xPct', 'X, %'],
                ['yPct', 'Y, %'],
                ['wPct', 'Ширина, %'],
                ['hPct', 'Высота, %'],
              ] as [string, string][])
            : ([
                ['x', 'X, мм'],
                ['y', 'Y, мм'],
                ['w', 'Ширина, мм'],
                ['h', 'Высота, мм'],
              ] as [string, string][])
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <Input
                type="number"
                step={unit === 'pct' ? '0.5' : '1'}
                min={0}
                max={unit === 'pct' ? 100 : Math.round(sheetMm(format)?.width ?? 100)}
                value={
                  unit === 'pct'
                    ? Math.round(Number((selected as unknown as Record<string, number>)[key]) * 10) / 10
                    : Number((pctToMm(selected, format) as unknown as Record<string, number>)[key])
                }
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v)) return
                  const mmRect = pctToMm(selected, format)
                  if (unit === 'pct' || !mmRect) {
                    patchBlock(clampRect({ ...selected, [key]: v }))
                    return
                  }
                  const next = mmToPct({ ...mmRect, [key]: v }, format)
                  if (next) patchBlock({ ...selected, ...clampRect({ ...selected, ...next }) })
                }}
                className="!h-8 text-[12px]"
              />
            </Field>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-ink-tertiary">
          {unit === 'mm' && sheetMm(format)
            ? `Лист ${sheetMm(format)!.width} × ${sheetMm(format)!.height} мм, поля 4,4 % по бокам и сверху и 6 % снизу. Значения — от края листа.`
            : `Минимум ${MIN_W}×${MIN_H} %. Стрелки двигают на 0,5 %, с Shift — на 5 %.`}
        </p>
        <PhotoDpiHint
          url={selected.displayImageUrl ?? selected.url ?? null}
          widthPct={selected.wPct}
          ratio={LAYOUT_FORMATS.find((f) => f.id === format)?.ratio ?? 210 / 297}
        />
      </section>

      <section className="border-b border-line px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold">Стиль блока</h3>
          {boundStyle && <span className="text-[11px] text-ink-tertiary">следует за стилем</span>}
        </div>
        <Field label="Стиль">
          <Select
            value={boundStyle?.id ?? ''}
            onChange={(e) => (e.target.value ? bindSelectedToStyle(e.target.value) : detachSelectedFromStyle())}
            aria-label="Стиль блока"
          >
            <option value="">Индивидуальный</option>
            {styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.fontSizePt} pt{doc ? ` · ${styleUsage(doc, s.id)} бл.` : ''}
              </option>
            ))}
          </Select>
        </Field>
        {boundStyle ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" onClick={refreshStyleFromBlock}>
              Обновить стиль по блоку
            </Button>
            <Button size="sm" variant="secondary" onClick={detachSelectedFromStyle}>
              Отвязать
            </Button>
          </div>
        ) : (
          <div className="mt-2 flex items-end gap-1.5">
            <div className="min-w-0 flex-1">
              <Field label="Новый стиль">
                <Input
                  value={newStyleName}
                  onChange={(e) => setNewStyleName(e.target.value)}
                  placeholder="Например, «Название»"
                  maxLength={40}
                  aria-label="Имя нового стиля"
                  className="!h-8 text-[12px]"
                />
              </Field>
            </div>
            <Button size="sm" onClick={createStyleFromBlock}>
              Создать
            </Button>
          </div>
        )}
        <p className="mt-1.5 text-[11px] text-ink-tertiary">
          Стиль хранит кегль, жирность, выравнивание, интерлиньяж, трекинг и капс. Правка этих полей у привязанного
          блока меняет все блоки стиля.
        </p>
      </section>

      <section className="border-b border-line px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold">Замечания</h3>
          <span className="text-[11px] text-ink-tertiary">
            {blockNotes.filter((c) => !c.resolved).length > 0
              ? `открытых: ${blockNotes.filter((c) => !c.resolved).length}`
              : 'нет'}
          </span>
        </div>
        {blockNotes.length === 0 ? (
          <p className="text-[11.5px] text-ink-tertiary">
            Правка от типографии или дизайнера: напишите — замечание повиснет на блоке и уйдёт в PDF стикером.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {blockNotes.map((c) => (
              <li key={c.id} className={cx('rounded-lg border px-2 py-1.5', c.resolved ? 'border-line bg-surface-2/60' : 'border-warn/40 bg-warn-soft/40')}>
                <p className={cx('text-[12px] leading-4', c.resolved ? 'text-ink-tertiary line-through' : 'text-ink')}>
                  {c.text}
                </p>
                <div className="mt-1 flex items-center gap-2 text-[10.5px] text-ink-tertiary">
                  <span>{c.author ? `${c.author} · ` : ''}{ago(c.createdAt)}</span>
                  <button
                    type="button"
                    onClick={() => toggleNote(c.id, !c.resolved)}
                    className="ml-auto font-semibold text-brand hover:underline"
                  >
                    {c.resolved ? 'вернуть' : 'решено'}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteNote(c.id)}
                    className="text-ink-tertiary hover:text-bad"
                    aria-label="Удалить замечание"
                  >
                    удалить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Например: цена не совпадает с каталогом"
            aria-label="Текст замечания"
            className="w-full resize-none rounded-lg border border-line px-2 py-1.5 text-[12px] outline-none focus:border-brand"
            onKeyDown={(e) => {
              // Enter добавляет, Shift+Enter — перенос строки: как в мессенджерах.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                addNote()
              }
            }}
          />
          <Button size="sm" variant="secondary" className="mt-1.5" onClick={addNote} disabled={!noteText.trim()}>
            Добавить замечание
          </Button>
        </div>
      </section>

      <section className="border-b border-line px-3 py-3">
        <h3 className="mb-2 text-[13px] font-semibold">Содержимое</h3>
        {(selectedType === 'product' || selectedType === 'category') && (
          <Field label="Название в макете">
            <Input
              value={selected.titleOverride ?? ''}
              placeholder={selected.displayName ?? 'Как в каталоге'}
              onChange={(e) => patchBlock({ titleOverride: e.target.value || null })}
            />
          </Field>
        )}
        {selectedType === 'product' && (
          <>
            <div className="mt-2">
              <Field label="Цена в макете" hint="Пусто — из каталога. Можно «169 / 269».">
                <Input
                  value={selected.priceText ?? ''}
                  placeholder={selected.product?.priceRub != null ? String(selected.product.priceRub) : '169 / 269'}
                  onChange={(e) => {
                    const v = e.target.value.trim()
                    patchBlock({ priceText: v || null, priceRubOverride: /^\d+$/.test(v) ? Number(v) : null })
                  }}
                />
              </Field>
            </div>
            <label className="mt-2 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={!!selected.uppercase} onChange={(e) => patchBlock({ uppercase: e.target.checked })} />
              Название капсом
            </label>
            <div className="mt-2">
              <Field label="Интерлиньяж" hint={(selected.lineHeight ?? 1.15).toFixed(2)}>
                <input
                  type="range"
                  min={0.9}
                  max={1.8}
                  step={0.05}
                  value={selected.lineHeight ?? 1.15}
                  onChange={(e) => patchBlock({ lineHeight: Number(e.target.value) })}
                  className="w-full"
                  aria-label="Интерлиньяж позиции"
                />
              </Field>
            </div>
            <div className="mt-2">
              <Field label="Трекинг" hint={`${selected.tracking ?? 0}`}>
                <input
                  type="range"
                  min={-50}
                  max={200}
                  step={5}
                  value={selected.tracking ?? 0}
                  onChange={(e) => patchBlock({ tracking: Number(e.target.value) })}
                  className="w-full"
                  aria-label="Трекинг позиции"
                />
              </Field>
            </div>
            <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => autofitText(selected.id)}>
              Вписать название в блок
            </Button>
            <div className="mt-2">
              <Field label="Бейдж">
                <Select value={selected.badge ?? ''} onChange={(e) => patchBlock({ badge: e.target.value || null })}>
                  <option value="">Без бейджа</option>
                  <option value="new">NEW</option>
                  <option value="hit">ХИТ</option>
                  <option value="vegan">VEGAN</option>
                </Select>
              </Field>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[12px] text-ink-secondary">Своё фото позиции</span>
              <label className={cx('inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-line px-2 text-[12px] font-semibold text-brand', busyUpload && 'opacity-50')}>
                {busyUpload ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Загрузить
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    // В макет берём полный размер (960), иначе на печати картинка мыльная.
                    if (f) void uploadInto(f, (url) => patchBlock({ photoUrlOverride: url, showPhoto: true }), true)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
            <Input
              value={selected.photoUrlOverride ?? ''}
              placeholder="/uploads/… или загрузите файл"
              onChange={(e) => setImageUrl(e.target.value, 'photoUrlOverride')}
              className="mt-1.5 !h-8 text-[12px]"
            />
            <label className="mt-2 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={selected.showPhoto} onChange={(e) => patchBlock({ showPhoto: e.target.checked })} />
              Показывать фото в блоке
            </label>
            {selected.showPhoto && cropControls(selected)}
          </>
        )}

        {selectedType === 'text' && (
          <>
            <Field label="Текст">
              <textarea
                value={selected.text ?? ''}
                onChange={(e) => patchBlock({ text: e.target.value })}
                rows={3}
                className="w-full rounded-lg border border-line px-2 py-1.5 text-[13px] outline-none focus:border-brand"
              />
            </Field>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Кегль, pt">
                <Input
                  type="number"
                  min={5}
                  max={72}
                  value={selected.fontSizePt}
                  onChange={(e) => patchBlock({ fontSizePt: Number(e.target.value) || 10 })}
                  className="!h-8 text-[12px]"
                />
              </Field>
              <Field label="Выравнивание">
                <Select value={selected.align} onChange={(e) => patchBlock({ align: e.target.value as MenuBlock['align'] })}>
                  <option value="left">Слева</option>
                  <option value="center">По центру</option>
                  <option value="right">Справа</option>
                </Select>
              </Field>
            </div>
            <label className="mt-2 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={selected.bold} onChange={(e) => patchBlock({ bold: e.target.checked })} />
              Жирный (Unbounded)
            </label>
            <label className="mt-1 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={!!selected.uppercase} onChange={(e) => patchBlock({ uppercase: e.target.checked })} />
              Капсом (заглавными)
            </label>
            <div className="mt-2">
              <Field label="Интерлиньяж" hint={`${(selected.lineHeight ?? 1.15).toFixed(2)} — расстояние между строками`}>
                <input
                  type="range"
                  min={0.9}
                  max={1.8}
                  step={0.05}
                  value={selected.lineHeight ?? 1.15}
                  onChange={(e) => patchBlock({ lineHeight: Number(e.target.value) })}
                  className="w-full"
                  aria-label="Интерлиньяж"
                />
              </Field>
            </div>
            <div className="mt-2">
              <Field label="Трекинг" hint={`${selected.tracking ?? 0} — разрежение букв, −50…+200`}>
                <input
                  type="range"
                  min={-50}
                  max={200}
                  step={5}
                  value={selected.tracking ?? 0}
                  onChange={(e) => patchBlock({ tracking: Number(e.target.value) })}
                  className="w-full"
                  aria-label="Трекинг"
                />
              </Field>
            </div>
            <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => autofitText(selected.id)}>
              Вписать текст в блок
            </Button>
          </>
        )}

        {selectedType === 'image' && (
          <>
            <div className="flex items-center gap-2">
              <label className={cx('inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-line px-2 text-[12px] font-semibold text-brand', busyUpload && 'opacity-50')}>
                {busyUpload ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Загрузить
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void uploadInto(f, (url) => patchBlock({ url }), true)
                    e.target.value = ''
                  }}
                />
              </label>
              <span className="text-[11px] text-ink-tertiary">или ссылка</span>
            </div>
            <Input
              value={selected.url ?? ''}
              placeholder="/uploads/… или загрузите файл"
              onChange={(e) => setImageUrl(e.target.value, 'url')}
              className="mt-1.5 !h-8 text-[12px]"
            />
            <div className="mt-2">
              <Field label="Вписывание">
                <Select value={selected.fit} onChange={(e) => patchBlock({ fit: e.target.value as MenuBlock['fit'] })}>
                  <option value="cover">Заполнить (обрезать)</option>
                  <option value="contain">Вписать целиком</option>
                </Select>
              </Field>
            </div>
            {cropControls(selected)}
            <div className="mt-2">
              <Field label="Подпись (для скринридера)">
                <Input value={selected.titleOverride ?? ''} onChange={(e) => patchBlock({ titleOverride: e.target.value || null })} className="!h-8 text-[12px]" />
              </Field>
            </div>
          </>
        )}

        {selectedType === 'logo' && (
          <Field label="Подпись справа (например, сезон)">
            <Input value={selected.text ?? ''} onChange={(e) => patchBlock({ text: e.target.value || null })} placeholder="весна / лето 2026" />
          </Field>
        )}

        {selectedType === 'divider' && <p className="text-[12px] text-ink-secondary">Линия-разделитель. Меняйте ширину и положение выше.</p>}

        <p className="mt-2 text-[11px] leading-4 text-ink-tertiary">
          Данные из каталога. Правки здесь меняют только макет — не кассу и не карточку товара.
        </p>
      </section>

      <section className="px-3 py-3">
        <h3 className="mb-2 text-[13px] font-semibold">Действия</h3>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Layers size={14} />} onClick={() => updatePage((bs) => bringToFront(bs, selected.id))}>
            На передний
          </Button>
          <Button size="sm" variant="secondary" icon={<Layers size={14} />} onClick={() => updatePage((bs) => sendToBack(bs, selected.id))}>
            На задний
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={selected.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
            onClick={() => updatePage((bs) => toggleHidden(bs, selected.id))}
          >
            {selected.hidden ? 'Показать' : 'Скрыть'}
          </Button>
          <Button size="sm" variant="secondary" icon={<Trash2 size={14} />} onClick={() => deleteBlock(selected.id)}>
            Удалить блок
          </Button>
        </div>
      </section>
    </div>  )
}
