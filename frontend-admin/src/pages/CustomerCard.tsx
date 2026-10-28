import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Eye } from 'lucide-react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import type { VoucherTemplate } from '../api/types'
import { fmtDate, fmtDateTime, fmtKop, fmtKopFixed, fmtNum, shortId } from '../lib/format'
import { Badge, Banner, Button, Card, ConfirmDialog, cx, ErrorBox, KpiTile, PageHeader, Select, Spinner, useToast } from '../ui/kit'

type Detail = {
  user: { id: number; nickname: string; cardId: string | null; cardCode: string | null; inviteCode: string; invitedBy: number | null; cashbackBalance: number; createdAt: number; paidTotal: number; freeUsed: number; seq: number }
  hasPhone: boolean
  blocked: boolean
  invitedBy: { id: number; nickname: string; cardCode: string | null } | null
  ops: { storeUuid: string; storeName: string | null; docId: string; kind: string; cups: number | null; free: number | null; cashbackKopecks: number | null; resultRub: number | null; createdAt: number }[]
  cashback: { id: number; amount: number; receiptId: string | null; createdAt: number; fromUserId: number | null; fromNickname: string | null }[]
  vouchers: {
    id: number; title: string; kind: string; value: number; expiresDay: string | number | null
    usedAt: number | null; redemptionsCount?: number; redemptionMode?: 'once' | 'multi'
  }[]
  referrals: { id: number; nickname: string; cardCode: string | null; createdAt: number; paidTotal: number }[]
  receipts: { id: string; amount: number; dp: number; df: number; dcb: number; ts: number }[]
  hints: string[]
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card className="mb-3"><h2 className="mb-2 text-base font-bold">{title}</h2>{children}</Card>
}
const none = <p className="text-sm text-ink-secondary">Пока ничего нет</p>

export default function CustomerCard() {
  const id = useParams().id
  const nav = useNavigate()
  const toast = useToast()
  const { data, error, loading, reload } = useApi<Detail>(`/customers/${id}`)
  const tpl = useApi<{ templates: VoucherTemplate[] }>('/voucher-templates')
  const [code, setCode] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [phone, setPhone] = useState<string | null | undefined>(undefined)

  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data) return null
  const u = data.user

  const grant = async () => {
    setBusy(true)
    try {
      await api(`/customers/${u.id}/vouchers`, { method: 'POST', body: { code } })
      toast.push('Ваучер выдан')
      setConfirm(false)
      reload()
    } catch (e) { toast.push(e instanceof Error ? e.message : 'Не удалось выдать', 'bad') } finally { setBusy(false) }
  }
  const showPhone = async () => {
    try { setPhone((await api<{ phone: string | null }>(`/customers/${u.id}/phone`)).phone) }
    catch (e) { toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad') }
  }
  // Выключенный шаблон сервер выдавать не будет — в списке только активные.
  const activeTpl = (tpl.data?.templates ?? []).filter((t) => t.active !== false)
  const selTpl = activeTpl.find((t) => t.code === code)

  return (
    <>
      <button type="button" onClick={() => nav(-1)} className="mb-2 inline-flex min-h-[40px] items-center gap-1 text-sm font-medium text-brand"><ArrowLeft size={16} /> Назад</button>
      <PageHeader
        title={u.cardCode ? `Карта №${u.cardCode}` : `Клиент #${u.id}`}
        subtitle={<>{u.nickname} · регистрация {fmtDate(u.createdAt)} · код приглашения {u.inviteCode}</>}
        actions={data.blocked ? <Badge tone="bad">Карта в стоп-листе</Badge> : undefined}
      />
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile label="Оплаченных чашек" value={fmtNum(u.paidTotal)} sub={`бесплатных использовано: ${u.freeUsed}`} />
        <KpiTile label="Кэшбэк, ₽" value={fmtKop(u.cashbackBalance)} />
        <KpiTile label="Приглашено" value={fmtNum(data.referrals.length)} />
        <KpiTile label="Операций с кассы" value={fmtNum(data.ops.length)} sub="последние 50" />
      </div>
      {data.hints.length > 0 && (
        <Banner tone="neutral"><ul className="list-disc space-y-1 pl-4">{data.hints.map((h) => <li key={h}>{h}</li>)}</ul></Banner>
      )}

      <Section title="Телефон">
        {!data.hasPhone ? <p className="text-sm text-ink-secondary">Телефон не указан — клиент идентифицируется только картой.</p> : phone ? <p className="font-mono text-sm">{phone}</p> : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink-secondary">Скрыт. Показ записывается в журнал действий.</span>
            <Button size="sm" variant="secondary" icon={<Eye size={14} />} onClick={showPhone}>Показать номер</Button>
          </div>
        )}
      </Section>

      <Section title="Операции с кассы">
        {!data.ops.length ? none : (
          <ul className="divide-y divide-line text-sm">
            {data.ops.map((o) => (
              <li key={`${o.storeUuid}/${o.docId}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <Link to={`/operations?open=${o.storeUuid}/${o.docId}`} className="font-semibold text-brand hover:underline">{o.kind === 'PAYBACK' ? 'Возврат' : 'Продажа'}</Link>
                  <span className="text-ink-secondary"> · {fmtDateTime(o.createdAt)} · {o.storeName ?? shortId(o.storeUuid)}</span>
                </div>
                <div className="text-right">
                  {o.kind === 'PAYBACK' ? '−' : '+'}{o.cups ?? 0} чаш.{o.free ? `, бесплатных ${o.free}` : ''}{o.cashbackKopecks ? `, кэшбэк ${o.kind === 'PAYBACK' ? '+' : '−'}${fmtKop(o.cashbackKopecks)}` : ''}
                  {o.resultRub != null && <span className="text-ink-secondary"> · чек {fmtNum(o.resultRub)} ₽</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Кэшбэк (рефералы)">
        {!data.cashback.length ? none : (
          <ul className="divide-y divide-line text-sm">
            {data.cashback.map((c) => (
              <li key={c.id} className="flex justify-between gap-2 py-2">
                <span>{fmtDateTime(c.createdAt)}{c.fromNickname ? ` · от ${c.fromNickname}` : ''}</span>
                <b className={cx('tabular-nums', c.amount < 0 ? 'text-bad' : 'text-ok')}>{c.amount > 0 ? '+' : ''}{fmtKopFixed(c.amount)} ₽</b>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Ваучеры">
        {!data.vouchers.length ? none : (
          <ul className="mb-3 divide-y divide-line text-sm">
            {data.vouchers.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {v.title}
                  {v.redemptionMode === 'multi' && <span className="text-ink-secondary"> · многоразовый, гашений: {v.redemptionsCount ?? 0}</span>}
                </span>
                {v.usedAt ? <Badge tone="neutral">Использован {fmtDate(v.usedAt)}</Badge> : <Badge tone="ok">Активен</Badge>}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={code} onChange={(e) => setCode(e.target.value)} aria-label="Шаблон ваучера" className="!w-auto min-w-[200px] flex-1">
            <option value="">Выберите ваучер…</option>
            {activeTpl.map((t) => <option key={t.code} value={t.code}>{t.title}</option>)}
          </Select>
          <Button disabled={!code} onClick={() => setConfirm(true)}>Выдать клиенту</Button>
        </div>
        {!activeTpl.length && (
          <p className="mt-2 text-sm text-ink-secondary">
            Нет активных шаблонов. Создайте их в «Маркетинг → Ваучеры».
          </p>
        )}
      </Section>

      <Section title="Приглашённые">
        {data.invitedBy && <p className="mb-2 text-sm">Пригласил: <Link className="font-semibold text-brand hover:underline" to={`/customers/${data.invitedBy.id}`}>{data.invitedBy.cardCode ? `№${data.invitedBy.cardCode}` : `#${data.invitedBy.id}`} {data.invitedBy.nickname}</Link></p>}
        {!data.referrals.length ? none : (
          <ul className="divide-y divide-line text-sm">
            {data.referrals.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 py-2">
                <Link to={`/customers/${r.id}`} className="font-semibold text-brand hover:underline">{r.cardCode ? `№${r.cardCode}` : `#${r.id}`} {r.nickname}</Link>
                <span className="text-ink-secondary">чашек: {r.paidTotal} · {fmtDate(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {data.receipts.length > 0 && (
        <Section title="Старые чеки (до интеграции с Эвотор)">
          <ul className="divide-y divide-line text-sm">
            {data.receipts.map((r) => <li key={r.id} className="flex justify-between gap-2 py-2"><span>{fmtDateTime(r.ts)}</span><span>{fmtNum(r.amount)} ₽ · чашек {r.dp}{r.df ? ` · бесплатных ${r.df}` : ''}</span></li>)}
          </ul>
        </Section>
      )}

      <ConfirmDialog open={confirm} title="Выдать ваучер?" confirmLabel="Выдать" busy={busy} onConfirm={grant} onCancel={() => setConfirm(false)}>
        «{selTpl?.title}» будет выдан клиенту {u.cardCode ? `№${u.cardCode}` : `#${u.id}`}. Действие записывается в журнал.
      </ConfirmDialog>
    </>
  )
}
