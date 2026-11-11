/**
 * Себестоимость: техкарты на складе (v2).
 *
 * Вкладки: Техкарты · Ингредиенты · Расходы · Прибыльность · Сигналы · Сводка.
 * Импорт пишет в ту же модель,
 * старых таблиц `cost_*` страница больше не касается (они живут только для совместимости API).
 */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { PageHeader, Button, Banner, cx, useToast } from '../ui/kit'
import { RefreshCw, Upload } from 'lucide-react'

import { initialCostTab, type CostTabKey } from '../lib/costTabs'
import TechCardsTab from '../components/cost/TechCardsTab'
import ItemsTab from '../components/cost/ItemsTab'
import OverheadsTab from '../components/cost/OverheadsTab'
import MenuTab from '../components/cost/MenuTab'
import SignalsTab from '../components/cost/SignalsTab'
import OverviewTab from '../components/cost/OverviewTab'
import ImportPanel from '../components/cost/ImportPanel'

const TABS: { key: CostTabKey; label: string }[] = [
  { key: 'tech', label: 'Техкарты' },
  { key: 'items', label: 'Ингредиенты' },
  { key: 'overheads', label: 'Расходы' },
  { key: 'menu', label: 'Прибыльность' },
  { key: 'signals', label: 'Сигналы' },
  { key: 'summary', label: 'Сводка' },
]

export default function Cost() {
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const [tab, setTab] = useState<CostTabKey>(initialCostTab(params.get('focus')))
  const [importOpen, setImportOpen] = useState(false)
  const [openCardId, setOpenCardId] = useState<number | null>(null)
  /** Перезагрузка вкладок после импорта: ключ вместо событийной шины. */
  const [reloadKey, setReloadKey] = useState(0)
  const [importSummary, setImportSummary] = useState<string | null>(null)

  // Ссылку можно открыть в уже работающей вкладке: слушаем `focus` и переключаемся.
  const focus = params.get('focus')
  useEffect(() => {
    const want = initialCostTab(focus)
    setTab((cur) => (cur === want ? cur : want))
  }, [focus])

  const selectTab = (k: CostTabKey) => {
    setTab(k)
    // Держим адрес в согласии с вкладкой: ссылку можно переслать.
    const next = new URLSearchParams(params)
    if (k === 'tech') next.delete('focus')
    else next.set('focus', k === 'items' ? 'missing' : k)
    setParams(next, { replace: true })
  }

  return (
    <div>
      <PageHeader
        title="Себестоимость"
        subtitle="Техкарты, заготовки, цены из накладных, постоянные расходы и прибыльность меню."
        actions={
          <>
            <Button variant="secondary" onClick={() => setReloadKey((n) => n + 1)} aria-label="Обновить">
              <RefreshCw size={14} /> Обновить
            </Button>
            <Button onClick={() => setImportOpen((v) => !v)}>
              <Upload size={14} /> Загрузить
            </Button>
          </>
        }
      />

      <div className="mb-3 inline-flex flex-wrap gap-[2px] rounded-[10px] border border-line bg-surface-2 p-[3px]" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => selectTab(t.key)}
            className={cx('seg-item', tab === t.key && 'is-on')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {importSummary && (
        <div className="mb-3">
          <Banner tone="ok">
            Импорт: {importSummary}. Новые карты — черновики, проверьте цены в «Сигналах».{' '}
            <button type="button" className="underline" onClick={() => setImportSummary(null)}>
              скрыть
            </button>
          </Banner>
        </div>
      )}

      {importOpen && (
        <div className="mb-3">
          <ImportPanel
            onClose={() => setImportOpen(false)}
            onImported={(summary) => {
              setImportSummary(summary)
              setReloadKey((n) => n + 1)
              toast.push('Импорт завершён')
            }}
          />
        </div>
      )}

      {tab === 'tech' && (
        <TechCardsTab key={`tech-${reloadKey}`} initialCardId={openCardId ?? undefined} onOpenSignals={() => selectTab('signals')} />
      )}
      {tab === 'items' && <ItemsTab reloadKey={reloadKey} onImport={() => setImportOpen(true)} />}
      {tab === 'overheads' && <OverheadsTab reloadKey={reloadKey} />}
      {tab === 'menu' && (
        <MenuTab
          reloadKey={reloadKey}
          onOpenCard={(id) => {
            setOpenCardId(id)
            selectTab('tech')
          }}
        />
      )}
      {tab === 'signals' && (
        <SignalsTab
          key={`signals-${reloadKey}`}
          onOpenCard={(id) => {
            setOpenCardId(id)
            selectTab('tech')
          }}
        />
      )}
      {tab === 'summary' && (
        <OverviewTab
          reloadKey={reloadKey}
          onOpenCard={(id) => {
            setOpenCardId(id)
            selectTab('tech')
          }}
        />
      )}
    </div>
  )
}
