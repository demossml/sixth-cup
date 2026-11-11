import { Button, Drawer, cx } from '../../ui/kit'
import { LAYOUT_FORMATS, type LayoutFormat } from '../../lib/menuLayout'

type Props = {
  open: boolean
  onClose: () => void
  format: LayoutFormat
  templates: { id: string; name: string }[]
  showTemplates: boolean
  onApplyTemplate: (templateId: string) => void
  onPickFormat: (format: LayoutFormat) => void
}

/** Шторка «Формат и шаблон»: смена размера листа и пересборка раскладки. */
export default function FormatDrawer({ open, onClose, format, templates, showTemplates, onApplyTemplate, onPickFormat }: Props) {
  return (
    <Drawer open={open} onClose={onClose} title="Формат и шаблон" layer={65}>
      {showTemplates && (
        <div className="mb-3 rounded-lg border border-line p-2">
          <p className="mb-1 text-[12px] font-semibold text-ink-secondary">Шаблон раскладки</p>
          <div className="flex flex-wrap gap-1">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onApplyTemplate(t.id)}
                className="rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-ink-secondary hover:border-brand hover:text-brand"
              >
                {t.name}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-ink-tertiary">Шаблон меняет колонки и плотность, содержимое «Мест» остаётся.</p>
        </div>
      )}
      <div className="space-y-2">
        {LAYOUT_FORMATS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onPickFormat(f.id)}
            className={cx('flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left', format === f.id ? 'border-brand bg-surface-2' : 'border-line')}
          >
            <span className="text-[13px] font-semibold">{f.label}</span>
            <span className="text-[11px] text-ink-tertiary">{f.unit === 'мм' ? `${f.mm} мм` : f.mm}</span>
          </button>
        ))}
      </div>
      <Button size="sm" variant="secondary" className="mt-3 w-full" onClick={onClose}>
        Закрыть
      </Button>
    </Drawer>
  )
}
