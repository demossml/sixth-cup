import { Loader2, Trash2, Upload, X } from "lucide-react"
import { Button, Field, Input, Select, cx } from "../../../ui/kit"
import ColorField from "../ColorField"
import { BRAND_COLORS, FONT_FAMILIES, FONT_LABELS, THEME_PRESETS, type BlockStyle, type MenuDoc, type MenuTheme } from "../../../lib/menuLayout"
import { styleUsage } from "../../../lib/blockStyles"

type OwnFont = { id: number; family: string; url: string; boldUrl: string | null }
type Palette = { id: number; name: string; colors: string[] }

type Props = {
  theme: MenuTheme
  setTheme: (t: MenuTheme | ((cur: MenuTheme) => MenuTheme)) => void
  styles: BlockStyle[]
  doc: MenuDoc | null
  styleTargets: string[]
  bindSelectedToStyle: (styleId: string) => void
  deleteStyle: (styleId: string) => void
  ownFonts: OwnFont[]
  fontBusy: boolean
  uploadFont: (file: File, bold: File | null) => Promise<void>
  removeFont: (id: number) => Promise<void>
  applyThemeColor: (key: "bg" | "text" | "accent", next: string) => void
  palettes: Palette[]
  applyPalette: (colors: string[]) => void
  removePalette: (id: number) => Promise<void>
  paletteName: string
  setPaletteName: (v: string) => void
  savePalette: () => Promise<void>
  uploadInto: (file: File, apply: (url: string) => void, full?: boolean) => Promise<void>
}

/** Панель «Оформление»: тема, стили, шрифты, цвета, градиент, палитры и фон листа. */
export default function DesignPane({
  theme,
  setTheme,
  styles,
  doc,
  styleTargets,
  bindSelectedToStyle,
  deleteStyle,
  ownFonts,
  fontBusy,
  uploadFont,
  removeFont,
  applyThemeColor,
  palettes,
  applyPalette,
  removePalette,
  paletteName,
  setPaletteName,
  savePalette,
  uploadInto,
}: Props) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="border-b border-line px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold">Тема</h3>
          <span className="text-[11px] text-ink-tertiary">3 пресета</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(THEME_PRESETS) as MenuTheme['preset'][]).map((p) => {
            const preset = THEME_PRESETS[p]
            const active = theme.preset === p
            return (
              <button
                key={p}
                type="button"
                onClick={() => setTheme({ ...theme, preset: p, bg: preset.bg, text: preset.text, accent: preset.accent })}
                aria-pressed={active}
                className={cx('rounded-lg border p-1 text-left', active ? 'border-brand ring-2 ring-brand/15' : 'border-line')}
              >
                <span className="flex h-11 flex-col justify-end gap-0.5 rounded p-1.5" style={{ background: preset.bg }}>
                  <i className="block h-[3px] w-3/5" style={{ background: preset.text }} />
                  <i className="block h-[2px] w-2/5" style={{ background: preset.text, opacity: 0.5 }} />
                  <i className="block h-[2px] w-1/5" style={{ background: preset.accent }} />
                </span>
                <span className="mt-1 block truncate text-[11px] text-ink-secondary">{preset.label}</span>
              </button>
            )
          })}
        </div>
      </section>

      {styles.length > 0 && (
        <section className="border-b border-line px-3 py-3">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold">Стили блоков</h3>
            <span className="text-[11px] text-ink-tertiary">{styles.length}</span>
          </div>
          <ul className="space-y-1">
            {styles.map((s) => {
              const used = doc ? styleUsage(doc, s.id) : 0
              return (
                <li key={s.id} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-ink">{s.name}</span>
                    <span className="block text-[11px] text-ink-tertiary">
                      {s.fontSizePt} pt{used > 0 ? ` · блоков: ${used}` : ' · не используется'}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => bindSelectedToStyle(s.id)}
                    disabled={styleTargets.length === 0}
                    className="h-7 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand disabled:opacity-40"
                    title="Применить стиль к выделенным блокам"
                  >
                    применить
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteStyle(s.id)}
                    className="grid h-7 w-7 place-items-center rounded text-ink-tertiary hover:text-bad"
                    aria-label={`Удалить стиль ${s.name}`}
                    title="Удалить стиль"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="mt-1.5 text-[11px] text-ink-tertiary">
            Стиль создаётся из выбранного блока на вкладке «Блок». Удаление стиля оставляет блокам их настройки.
          </p>
        </section>
      )}

      <section className="border-b border-line px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold">Шрифты и цвета</h3>
        </div>
        <Field label="Заголовки">
          <Select value={theme.fontHeading} onChange={(e) => setTheme({ ...theme, fontHeading: e.target.value })}>
            <optgroup label="Встроенные">
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f}>
                  {FONT_LABELS[f]}
                </option>
              ))}
            </optgroup>
            {ownFonts.length > 0 && (
              <optgroup label="Свои">
                {ownFonts.map((f) => (
                  <option key={f.id} value={f.family}>
                    {f.family}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        <div className="mt-2">
          <Field label="Позиции и цены">
            <Select value={theme.fontBody} onChange={(e) => setTheme({ ...theme, fontBody: e.target.value })}>
              <optgroup label="Встроенные">
                {FONT_FAMILIES.map((f) => (
                  <option key={f} value={f}>
                    {FONT_LABELS[f]}
                  </option>
                ))}
              </optgroup>
              {ownFonts.length > 0 && (
                <optgroup label="Свои">
                  {ownFonts.map((f) => (
                    <option key={f.id} value={f.family}>
                      {f.family}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </Field>
        </div>

        <div className="mt-2 rounded-lg border border-line p-2">
          <p className="text-[11.5px] text-ink-secondary">Свой шрифт</p>
          <p className="mt-0.5 text-[10.5px] text-ink-tertiary">TTF, OTF, WOFF или WOFF2 с кириллицей и знаком ₽. До 8 МБ.</p>
          <label className={cx('mt-1.5 inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-line px-2 text-[12px] font-semibold text-brand', fontBusy && 'opacity-50')}>
            {fontBusy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Загрузить
            <input
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void uploadFont(f, null)
                e.target.value = ''
              }}
            />
          </label>
          {ownFonts.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {ownFonts.map((f) => (
                <li key={f.id} className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-[12px]" style={{ fontFamily: `"${f.family}", sans-serif` }}>
                    {f.family}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeFont(f.id)}
                    className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-bad"
                    aria-label={`Удалить шрифт ${f.family}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {(
          [
            ['bg', 'Фон листа', undefined],
            ['text', 'Текст', theme.bg],
            ['accent', 'Акцент', theme.bg],
          ] as const
        ).map(([key, label, pair]) => (
          <ColorField
            key={key}
            label={label}
            value={theme[key]}
            contrastWith={pair}
            swatches={BRAND_COLORS}
            onChange={(next) => applyThemeColor(key, next)}
          />
        ))}
        <div className="mt-2 flex flex-wrap gap-1">
          {theme.recentColors && theme.recentColors.length > 0 && (
            <p className="w-full text-[10.5px] uppercase tracking-wide text-ink-tertiary">недавние</p>
          )}
          {(theme.recentColors ?? []).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => applyThemeColor('accent', c)}
              aria-label={`Недавний цвет ${c}`}
              title={c}
              style={{ background: c }}
              className="h-5 w-5 rounded-full border border-line"
            />
          ))}
        </div>
      </section>

      <section className="border-b border-line px-3 py-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold">Градиент фона</h3>
          <label className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
            <input
              type="checkbox"
              checked={!!theme.gradient}
              onChange={(e) =>
                setTheme({ ...theme, gradient: e.target.checked ? { from: theme.bg, to: '#FFFFFF', angle: 135 } : null })
              }
            />
            включить
          </label>
        </div>
        {theme.gradient && (
          <>
            <ColorField
              label="От"
              value={theme.gradient.from}
              onChange={(next) => setTheme({ ...theme, gradient: { ...theme.gradient!, from: next } })}
            />
            <ColorField
              label="До"
              value={theme.gradient.to}
              onChange={(next) => setTheme({ ...theme, gradient: { ...theme.gradient!, to: next } })}
            />
            <label className="mt-2 block text-[12px] text-ink-secondary">
              Угол {theme.gradient.angle}°
              <input
                type="range"
                min={0}
                max={360}
                step={15}
                value={theme.gradient.angle}
                onChange={(e) => setTheme({ ...theme, gradient: { ...theme.gradient!, angle: Number(e.target.value) } })}
                className="mt-1 w-full"
                aria-label="Угол градиента"
              />
            </label>
            <p className="mt-1 text-[10.5px] text-ink-tertiary">Печатается в PDF так же, как на холсте.</p>
          </>
        )}
      </section>

      <section className="border-b border-line px-3 py-3">
        <h3 className="mb-2 text-[13px] font-semibold">Палитры бренда</h3>
        {palettes.length === 0 && (
          <p className="text-[11.5px] text-ink-tertiary">
            Пока нет сохранённых палитр. Настройте цвета выше и сохраните — они будут доступны во всех макетах.
          </p>
        )}
        <ul className="space-y-1">
          {palettes.map((p) => (
            <li key={p.id} className="flex items-center gap-1 rounded-lg border border-line px-1.5 py-1">
              <button
                type="button"
                onClick={() => applyPalette(p.colors)}
                className="min-w-0 flex-1 truncate text-left text-[12.5px] hover:text-brand"
                title="Применить палитру: фон, текст, акцент"
              >
                {p.name}
              </button>
              <span className="flex flex-none gap-0.5">
                {p.colors.slice(0, 4).map((c) => (
                  <i key={c} className="h-4 w-4 rounded border border-line" style={{ background: c }} />
                ))}
              </span>
              <button
                type="button"
                onClick={() => void removePalette(p.id)}
                className="grid h-6 w-6 flex-none place-items-center rounded text-ink-tertiary hover:text-bad"
                aria-label={`Удалить палитру ${p.name}`}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-1">
          <Input
            value={paletteName}
            onChange={(e) => setPaletteName(e.target.value)}
            placeholder="Название палитры"
            aria-label="Название новой палитры"
            className="!h-8 text-[12px]"
          />
          <Button size="sm" variant="secondary" onClick={() => void savePalette()}>
            Сохранить
          </Button>
        </div>
      </section>

      <section className="border-b border-line px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold">Фон листа</h3>
          <span className="text-[11px] text-ink-tertiary">картинка</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-line px-2 text-[12px] font-semibold text-brand">
            <Upload size={13} /> Загрузить
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void uploadInto(f, (url) => setTheme({ ...theme, backgroundImageUrl: url }))
                e.target.value = ''
              }}
            />
          </label>
          <span className="text-[11px] text-ink-tertiary">или</span>
          <Input
            value={theme.backgroundImageUrl ?? ''}
            placeholder="https://…"
            onChange={(e) => setTheme({ ...theme, backgroundImageUrl: e.target.value.trim() || null })}
            className="!h-8 flex-1 text-[12px]"
          />
          {theme.backgroundImageUrl && (
            <button type="button" onClick={() => setTheme({ ...theme, backgroundImageUrl: null })} className="text-ink-tertiary hover:text-bad" aria-label="Убрать фон">
              <X size={14} />
            </button>
          )}
        </div>
        {theme.backgroundImageUrl && (
          <label className="mt-2 block text-[12px] text-ink-secondary">
            Затемнение · {theme.backgroundDim}%
            <input
              type="range"
              min={0}
              max={80}
              value={theme.backgroundDim}
              onChange={(e) => setTheme({ ...theme, backgroundDim: Number(e.target.value) })}
              className="mt-1 w-full"
            />
          </label>
        )}
      </section>

      <section className="px-3 py-3">
        <h3 className="mb-2 text-[13px] font-semibold">Логотип в подвале</h3>
        <Field label="Где рисовать 6.7">
          <Select value={theme.logoPosition} onChange={(e) => setTheme({ ...theme, logoPosition: e.target.value as MenuTheme['logoPosition'] })}>
            <option value="left">Не в подвале</option>
            <option value="footer">В подвале</option>
          </Select>
        </Field>
      </section>
    </div>
  )
}
