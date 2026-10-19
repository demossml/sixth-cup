import { useMemo, useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { Banner, Button, Card, EmptyState, ErrorBox, Input, PageHeader, Select, Spinner, useToast } from '../ui/kit'
import { HelpLink } from '../components/HelpLink'

type StaffRow = {
  id: number
  name: string
  role: string
  active: number
  storeId: number | null
  storeUuid: string | null
}

type WishRule = {
  id: number
  targetMonth: string
  periodLabel: string | null
  closesLabel: string | null
  limitDays: number
  canEdit: number
}

type WishRow = {
  id: number
  staffId: number
  staffName: string
  targetMonth: string
  status: string
  selectedJson: string
  acceptedJson: string
  declinedJson: string
}

export default function Staff() {
  const { push } = useToast()
  const { data, error, loading, reload } = useApi<{ staff: StaffRow[] }>('/staff')
  const rulesApi = useApi<{ rules: WishRule[] }>('/staff/wish-rules')
  const [month, setMonth] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const wishesApi = useApi<{ wishes: WishRow[] }>(`/staff/wishes?month=${encodeURIComponent(month)}`)

  const [name, setName] = useState('')
  const [role, setRole] = useState('Кассир')
  const [deviceUuid, setDeviceUuid] = useState('')
  const [linkStaffId, setLinkStaffId] = useState<number | ''>('')
  const [schedStaffId, setSchedStaffId] = useState<number | ''>('')
  const [schedDay, setSchedDay] = useState('')
  const [schedStatus, setSchedStatus] = useState('work')
  const [schedStart, setSchedStart] = useState('08:00')
  const [schedEnd, setSchedEnd] = useState('16:00')

  const [ruleMonth, setRuleMonth] = useState(month)
  const [ruleLimit, setRuleLimit] = useState(3)
  const [rulePeriod, setRulePeriod] = useState('')
  const [ruleCloses, setRuleCloses] = useState('')

  const staff = data?.staff ?? []
  const activeStaff = useMemo(() => staff.filter((s) => s.active), [staff])

  const addStaff = async () => {
    if (!name.trim()) return
    try {
      await api('/staff', { method: 'POST', body: { name: name.trim(), role: role.trim() || 'Кассир' } })
      setName('')
      push('Сотрудник добавлен')
      reload()
    } catch (e) {
      push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }

  const deactivate = async (id: number) => {
    try {
      await api(`/staff/${id}`, { method: 'DELETE' })
      push('Сотрудник отключён')
      reload()
    } catch (e) {
      push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }

  const linkDevice = async () => {
    if (!linkStaffId || !deviceUuid.trim()) return
    try {
      await api(`/staff/${linkStaffId}/device`, { method: 'PUT', body: { deviceUuid: deviceUuid.trim() } })
      push('Касса привязана к сотруднику')
      setDeviceUuid('')
    } catch (e) {
      push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }

  const saveDay = async () => {
    if (!schedStaffId || !schedDay) return
    try {
      await api('/staff/schedule', {
        method: 'PUT',
        body: {
          staffId: schedStaffId,
          days: [{ day: schedDay, status: schedStatus, start: schedStart || null, end: schedEnd || null }],
        },
      })
      push('День графика сохранён')
    } catch (e) {
      push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }

  const saveRules = async () => {
    try {
      await api('/staff/wish-rules', {
        method: 'POST',
        body: {
          targetMonth: ruleMonth,
          limitDays: ruleLimit,
          periodLabel: rulePeriod || null,
          closesLabel: ruleCloses || null,
          canEdit: true,
        },
      })
      push('Правила пожеланий сохранены')
      rulesApi.reload()
    } catch (e) {
      push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }

  const setWishStatus = async (id: number, status: 'accepted' | 'declined' | 'partial' | 'reviewing') => {
    try {
      await api(`/staff/wishes/${id}`, { method: 'PUT', body: { status } })
      push('Статус обновлён')
      wishesApi.reload()
    } catch (e) {
      push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }

  if (loading) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />

  return (
    <div className="space-y-6">
      <PageHeader title="Сотрудники и табель" subtitle="График и пожелания для экрана «Смена» на кассе Эвотор" actions={<HelpLink article="map" />} />

      <Banner tone="neutral">
        Касса читает табель и пожелания через /api/devices/*. Фискальные операции (внесение, Z-отчёт) по-прежнему делает только Эвотор.
      </Banner>

      <Card>
        <h2 className="mb-3 text-base font-semibold">Сотрудники</h2>
        <div className="mb-4 flex flex-wrap gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ФИО" aria-label="ФИО" className="min-w-[12rem]" />
          <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Роль" aria-label="Роль" className="min-w-[8rem]" />
          <Button onClick={addStaff} disabled={!name.trim()}>Добавить</Button>
        </div>
        {!activeStaff.length ? (
          <EmptyState title="Пока никого нет" text="Добавьте сотрудника, затем привяжите UUID кассы и заполните график." />
        ) : (
          <ul className="divide-y divide-line">
            {activeStaff.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div>
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-ink-secondary">{s.role} · id {s.id}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => deactivate(s.id)}>Отключить</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold">Привязка кассы (device UUID)</h2>
        <p className="mb-3 text-sm text-ink-secondary">Без привязки касса не знает, чей табель показывать. UUID приходит в заголовке X-Evotor-Device-UUID.</p>
        <div className="flex flex-wrap gap-2">
          <Select
            value={linkStaffId === '' ? '' : String(linkStaffId)}
            onChange={(e) => setLinkStaffId(e.target.value ? Number(e.target.value) : '')}
            aria-label="Сотрудник"
          >
            <option value="">Сотрудник…</option>
            {activeStaff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          <Input value={deviceUuid} onChange={(e) => setDeviceUuid(e.target.value)} placeholder="Device UUID" className="min-w-[14rem]" />
          <Button onClick={linkDevice} disabled={!linkStaffId || !deviceUuid.trim()}>Привязать</Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold">День графика</h2>
        <div className="flex flex-wrap gap-2">
          <Select
            value={schedStaffId === '' ? '' : String(schedStaffId)}
            onChange={(e) => setSchedStaffId(e.target.value ? Number(e.target.value) : '')}
            aria-label="Сотрудник графика"
          >
            <option value="">Сотрудник…</option>
            {activeStaff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          <Input type="date" value={schedDay} onChange={(e) => setSchedDay(e.target.value)} aria-label="День" />
          <Select value={schedStatus} onChange={(e) => setSchedStatus(e.target.value)} aria-label="Статус">
            <option value="work">work</option>
            <option value="off">off</option>
            <option value="preliminary">preliminary</option>
            <option value="sick">sick</option>
            <option value="vacation">vacation</option>
          </Select>
          <Input value={schedStart} onChange={(e) => setSchedStart(e.target.value)} placeholder="08:00" className="w-24" />
          <Input value={schedEnd} onChange={(e) => setSchedEnd(e.target.value)} placeholder="16:00" className="w-24" />
          <Button onClick={saveDay} disabled={!schedStaffId || !schedDay}>Сохранить день</Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold">Правила пожеланий</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          <Input value={ruleMonth} onChange={(e) => setRuleMonth(e.target.value)} placeholder="YYYY-MM" className="w-32" />
          <Input type="number" value={ruleLimit} onChange={(e) => setRuleLimit(Number(e.target.value) || 0)} className="w-24" aria-label="Лимит дат" />
          <Input value={rulePeriod} onChange={(e) => setRulePeriod(e.target.value)} placeholder="Период подачи" />
          <Input value={ruleCloses} onChange={(e) => setRuleCloses(e.target.value)} placeholder="Закрытие" />
          <Button onClick={saveRules}>Сохранить правила</Button>
        </div>
        {rulesApi.loading && <Spinner />}
        {rulesApi.data?.rules?.length ? (
          <ul className="space-y-1 text-sm">
            {rulesApi.data.rules.map((r) => (
              <li key={r.id}>{r.targetMonth}: до {r.limitDays} дат · {r.periodLabel || '—'} · {r.canEdit ? 'редактирование вкл' : 'закрыто'}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-secondary">Правил нет — касса вернёт status=no_rules.</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold">Пожелания с касс</h2>
        <div className="mb-3">
          <Input value={month} onChange={(e) => setMonth(e.target.value)} placeholder="YYYY-MM" className="w-32" aria-label="Месяц пожеланий" />
        </div>
        {wishesApi.loading && <Spinner />}
        {wishesApi.error && <ErrorBox message={wishesApi.error} onRetry={wishesApi.reload} />}
        {!wishesApi.loading && !(wishesApi.data?.wishes?.length) && (
          <EmptyState title="Пожеланий нет" text="Появятся после отправки с кассы." />
        )}
        <ul className="space-y-3">
          {(wishesApi.data?.wishes ?? []).map((w) => (
            <li key={w.id} className="rounded-xl border border-line p-3 text-sm">
              <div className="font-semibold">{w.staffName} · {w.targetMonth} · {w.status}</div>
              <div className="text-ink-secondary">Выбрано: {w.selectedJson}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setWishStatus(w.id, 'accepted')}>Принять</Button>
                <Button size="sm" variant="secondary" onClick={() => setWishStatus(w.id, 'partial')}>Частично</Button>
                <Button size="sm" variant="ghost" onClick={() => setWishStatus(w.id, 'declined')}>Отклонить</Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
