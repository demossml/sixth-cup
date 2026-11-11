import { Layers, RefreshCw, Sparkles } from "lucide-react"
import { Button } from "../../ui/kit"
import type { Blocker } from "./ExportModal"

type AiState = {
  prompt: string
  setPrompt: (v: string) => void
  busy: boolean
  plan: { summary: string; ops: unknown[] } | null
  propose: () => void
  apply: () => void
  clear: () => void
}

type Props = {
  onboardingHidden: boolean
  setOnboardingHidden: (v: boolean) => void
  driftText: string | null
  priceMode: "live" | "frozen"
  onSyncPrices: () => void
  ai: AiState | null
  draftSavedAt: number | null
  onRestoreDraft: () => void
  onDropDraft: () => void
  hasConflict: boolean
  onTakeServer: () => void
  onOverwriteServer: () => void
  blockers: Blocker[]
  goToBlock: (blockId: string, pageIdx: number) => void
}

/** Баннеры над листом: онбординг, расхождение цен, AI, черновик, конфликт и блокеры печати. */
export default function EditorBanners({
  onboardingHidden,
  setOnboardingHidden,
  driftText,
  priceMode,
  onSyncPrices,
  ai,
  draftSavedAt,
  onRestoreDraft,
  onDropDraft,
  hasConflict,
  onTakeServer,
  onOverwriteServer,
  blockers,
  goToBlock,
}: Props) {
  return (
    <>
  {onboardingHidden ? (
    <p className="mb-3 flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-4 text-ink-secondary">
      <Layers size={14} className="mt-0.5 flex-none text-brand" aria-hidden />
      Перетащите позицию на листе, тяните угол — блок меняет размер; края прилипают к полям и соседям
      (Alt — без прилипания). ⌘K — все команды.
    </p>
  ) : (
    <div className="mb-3 rounded-xl border border-brand/30 bg-brand/5 px-3 py-2.5" data-testid="onboarding">
      <div className="mb-1.5 flex items-center gap-2">
        <Sparkles size={14} className="flex-none text-brand" aria-hidden />
        <span className="min-w-0 flex-1 text-[12.5px] font-semibold text-ink">Три шага до готового макета</span>
        <button
          type="button"
          onClick={() => {
            setOnboardingHidden(true)
            try {
              localStorage.setItem('menu-layout-onboarding', 'done')
            } catch {
              /* приватный режим */
            }
          }}
          className="text-[12px] font-semibold text-brand underline"
        >
          Понятно
        </button>
      </div>
      <ol className="ml-4 list-decimal space-y-0.5 text-[12px] leading-4 text-ink-secondary">
        <li>«Собрать из каталога» — лист заполнится товарами с ценами.</li>
        <li>Перетащите блоки, тяните угол для размера; края прилипают к полям.</li>
        <li>«Экспорт PDF» — файл с полями под рез. ⌘K открывает все команды.</li>
      </ol>
    </div>
  )}

  {driftText && (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-warn/40 bg-warn-soft px-3 py-2 text-[13px] text-warn">
      <RefreshCw size={15} className="flex-none" aria-hidden />
      <span className="min-w-0 flex-1">{driftText}</span>
      <Button size="sm" variant="secondary" onClick={() => onSyncPrices()}>
        {priceMode === 'frozen' ? 'Проверить' : 'Обновить с каталога'}
      </Button>
    </div>
  )}

  {ai && (
    <div className="mb-3 rounded-xl border border-line bg-surface-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles size={15} className="flex-none text-brand" aria-hidden />
        <input
          value={ai.prompt}
          onChange={(e) => ai.setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void ai.propose()}
          placeholder="Опишите правку: «добавь напитки», «убери корицу», «переименуй добавки в топпинги»"
          aria-label="Запрос к AI"
          className="min-h-9 min-w-0 flex-1 rounded-lg border border-line bg-white px-2 text-[13px] outline-none"
        />
        <Button size="sm" variant="secondary" loading={ai.busy} onClick={() => void ai.propose()}>
          Предложить
        </Button>
      </div>
      {ai.plan && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="min-w-0 flex-1">
            {ai.plan.summary} · операций: {ai.plan.ops.length}. Запишем только после подтверждения.
          </span>
          <Button size="sm" onClick={() => void ai.apply()} loading={ai.busy}>
            Применить
          </Button>
          <Button size="sm" variant="secondary" onClick={() => ai.clear()} disabled={ai.busy}>
            Отмена
          </Button>
        </div>
      )}
    </div>
  )}

  {draftSavedAt && (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-warn/40 bg-warn-soft px-3 py-2 text-[13px] text-warn">
      <span className="min-w-0 flex-1">
        Найден несохранённый черновик от {new Date(draftSavedAt).toLocaleString('ru-RU')} — он новее
        сохранённой версии. Восстановить?
      </span>
      <Button size="sm" onClick={onRestoreDraft}>
        Восстановить
      </Button>
      <Button size="sm" variant="secondary" onClick={onDropDraft}>
        Выбросить
      </Button>
    </div>
  )}

  {hasConflict && (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-bad/40 bg-bad-soft px-3 py-2 text-[13px] text-bad">
      <RefreshCw size={15} className="flex-none" aria-hidden />
      <span className="min-w-0 flex-1">
        Макет изменили в другом окне. Ваши правки ещё не сохранены — выберите, чью версию оставить.
      </span>
      <Button size="sm" variant="secondary" onClick={onTakeServer}>
        Взять серверную
      </Button>
      <Button size="sm" onClick={() => void onOverwriteServer()}>
        Перезаписать своей
      </Button>
    </div>
  )}

  {blockers.length > 0 && (
    <div className="mb-3 rounded-xl border border-warn/40 bg-warn-soft px-3 py-2">
      <p className="text-[13px] font-semibold text-warn">Перед печатью: {blockers.length}</p>
      <ul className="mt-1 space-y-0.5">
        {blockers.slice(0, 8).map((b) => (
          <li key={`${b.blockId}-${b.text}`}>
            <button
              type="button"
              onClick={() => goToBlock(b.blockId, b.pageIdx)}
              className="text-left text-[12.5px] text-ink-secondary hover:text-brand hover:underline"
            >
              {b.label} — {b.text}
            </button>
          </li>
        ))}
      </ul>
      {blockers.length > 8 && <p className="mt-1 text-[12px] text-ink-tertiary">и ещё {blockers.length - 8}</p>}
    </div>
  )}

    </>
  )
}
