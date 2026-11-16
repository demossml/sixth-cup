import { useEffect, useState } from 'react'
import { Coins } from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { fmtDateTime } from '../lib/format'
import { Banner, Button, Card, ErrorBox, Input, PageHeader, Spinner, useToast } from '../ui/kit'

type Settings = {
  earnPercent: number
  earnBps: number
  maxPercent: number
  updatedAt: number | null
  updatedBy: string | null
  bonusMode: boolean
}

/**
 * BONUS-LOYALTY: процент начисления бонусов (вариант B).
 * Глобальный процент — база для всех гостей; индивидуальный задаётся в карточке клиента.
 */
export default function Loyalty() {
  const toast = useToast()
  const { data, error, loading, reload } = useApi<{ settings: Settings }>('/loyalty/settings')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (data) setValue(String(data.settings.earnPercent).replace('.', ','))
  }, [data])

  const save = async () => {
    const parsed = Number(value.replace(',', '.').trim())
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > (data?.settings.maxPercent ?? 100)) {
      toast.push(`Процент должен быть от 0 до ${data?.settings.maxPercent ?? 100}`, 'bad')
      return
    }
    setBusy(true)
    try {
      await api('/loyalty/settings', { method: 'PUT', body: { earnPercent: parsed } })
      toast.push('Процент начисления сохранён')
      reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось сохранить', 'bad')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data) return null
  const s = data.settings

  return (
    <>
      <PageHeader
        title="Бонусы"
        subtitle="Гость копит процент с оплаченной суммы и платит ими до 100 % чека"
      />
      {!s.bonusMode && (
        <Banner tone="warn">
          На сервере включён старый режим лояльности (чашки-подарки): процент начисляться не будет.
          Включите переменную окружения <code>LOYALTY_BONUS_MODE=1</code>.
        </Banner>
      )}
      <Card className="mb-3">
        <h2 className="mb-1 text-base font-bold">Процент начисления</h2>
        <p className="mb-3 text-sm text-ink-secondary">
          Сколько процентов от оплаченной суммы гость получает бонусами. Начисляется при каждой продаже
          через кассу и в приложении. Индивидуальный процент клиента (в его карточке) важнее этого значения.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[13px] text-ink-secondary">Процент, %</span>
            <Input
              className="w-28"
              value={value}
              inputMode="decimal"
              onChange={(e) => setValue(e.target.value)}
              aria-label="Процент начисления бонусов"
            />
          </label>
          <Button icon={<Coins size={16} />} loading={busy} onClick={() => void save()}>
            Сохранить
          </Button>
        </div>
        <p className="mt-3 text-sm text-ink-secondary">
          Сейчас: <b>{String(s.earnPercent).replace('.', ',')} %</b>
          {s.updatedAt ? ` · изменено ${fmtDateTime(s.updatedAt)}${s.updatedBy ? ` (${s.updatedBy})` : ''}` : ''}
        </p>
      </Card>
      <Card>
        <h2 className="mb-2 text-base font-bold">Как это работает</h2>
        <ul className="list-disc space-y-1 pl-4 text-sm text-ink-secondary">
          <li>Бонусы начисляются от денег, которые гость реально заплатил, после списания бонусов.</li>
          <li>Списать можно до 100 % суммы чека, но не больше баланса.</li>
          <li>Проценты считаются в целых копейках, округление вниз — в пользу кофейни.</li>
          <li>Возврат чека сторнирует и начисленные по нему бонусы (пропорционально сумме возврата).</li>
        </ul>
      </Card>
    </>
  )
}
