import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { Badge, Button, Card, PageHeader, EmptyState, ErrorBox, Field, Input, Select, Skeleton, useToast } from '../ui/kit'
import type { Tone } from '../ui/kit'
import { HelpLink } from '../components/HelpLink'

type Mode = 'catalog' | 'content' | 'anomaly' | 'shift'

type FeedAction = { label: string; action?: string; nav?: string; invoiceId?: number }
type FeedCard = { key: string; sev: 'urgent' | 'warn' | 'info' | 'good'; title: string; why: string; primary: FeedAction; secondary?: FeedAction }
type Feed = { cards: FeedCard[]; generatedAt: number }

const SEV: Record<string, { label: string; tone: Tone }> = {
  urgent: { label: 'срочно', tone: 'bad' },
  warn: { label: 'внимание', tone: 'warn' },
  info: { label: 'к сведению', tone: 'neutral' },
  good: { label: 'хорошо', tone: 'ok' },
}

/** Куда ведёт nav-действие карточки ленты. */
const NAV: Record<string, string> = {
  purchases: '/purchases',
  stock: '/stock',
  menu: '/menu',
  customers: '/customers',
  cash: '/cash',
  today: '/',
}

export default function Assistant() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [product, setProduct] = useState('')
  const [question, setQuestion] = useState('')
  const [period, setPeriod] = useState('24h')
  const feed = useApi<Feed>('/ai/feed')

  const askFree = async () => {
    if (!question.trim()) {
      toast.push('Введите вопрос', 'bad')
      return
    }
    setBusy(true)
    setText('')
    try {
      const r = await api<{ text: string; provider: string }>('/ai/ask', {
        method: 'POST',
        body: { question: question.trim(), period },
      })
      setText(r.text || '')
      toast.push(r.provider === 'mock' ? 'Ответ-заготовка: модель не подключена' : 'Готово')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка'
      // 503 от /ai/ask — не сбой, а выключенный ИИ: показываем причину в поле ответа.
      setText(msg)
      toast.push(msg, 'bad')
    } finally {
      setBusy(false)
    }
  }

  const hideCard = async (key: string) => {
    try {
      await api(`/ai/feed/${encodeURIComponent(key)}/hide`, { method: 'POST' })
      feed.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }

  const draftPayment = async (invoiceId: number) => {
    setBusy(true)
    try {
      const r = await api<{ draft: { supplierId: number; amountKop: number; allocations: { invoiceId: number; amountKop: number }[]; notes?: string } }>(
        `/ai/draft/payment?invoiceId=${invoiceId}`,
      )
      await api('/purchases/payments', {
        method: 'POST',
        body: { ...r.draft, notes: r.draft.notes ?? null },
      })
      toast.push('Оплата создана по предложенному распределению')
      feed.reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const run = async (mode: Mode) => {
    setBusy(true)
    setText('')
    try {
      const path =
        mode === 'catalog'
          ? '/ai/catalog-advice'
          : mode === 'content'
            ? '/ai/content-draft'
            : mode === 'anomaly'
              ? '/ai/anomaly-explain'
              : '/ai/shift-summary'
      const body =
        mode === 'content'
          ? { productName: product || undefined }
          : mode === 'anomaly' || mode === 'shift'
            ? { period: '24h' }
            : {}
      const r = await api<{ text: string; draft?: { title: string; body: string; ctaLabel: string; badge: string } }>(path, {
        method: 'POST',
        body,
      })
      setText(r.text || '')
      if (r.draft) {
        setText(
          (r.text || '') +
            `\n\n---\nЧерновик:\nЗаголовок: ${r.draft.title}\nCTA: ${r.draft.ctaLabel}\nBadge: ${r.draft.badge}\n${r.draft.body}`,
        )
      }
      toast.push(r ? 'Готово (проверьте перед публикацией)' : 'Пусто')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка AI', 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageHeader
        title="Помощник"
        subtitle="Черновики и подсказки. Ничего не публикуется само. Ключ и модель — в Система → ИИ (DeepSeek)."
       actions={<HelpLink article="principles" />} />
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button loading={busy} onClick={() => run('catalog')}>Разобрать каталог</Button>
        <Button loading={busy} variant="secondary" onClick={() => run('anomaly')}>Почему мало чашек</Button>
        <Button loading={busy} variant="secondary" onClick={() => run('shift')}>Сводка за день</Button>
        <div className="flex gap-2">
          <Input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Напиток для новинки" />
          <Button loading={busy} onClick={() => run('content')}>Текст новинки</Button>
        </div>
      </div>
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
          <Field label="Свободный вопрос">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Например: почему упала выручка за сутки?"
            />
          </Field>
          <Field label="Период">
            <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="24h">Сутки</option>
              <option value="7d">7 дней</option>
              <option value="30d">30 дней</option>
            </Select>
          </Field>
          <Button loading={busy} onClick={askFree}>Спросить</Button>
        </div>
      </Card>

      <Card className="mb-4" pad={false}>
        <div className="border-b border-line px-4 py-3 text-[14px] font-semibold">Лента подсказок</div>
        {feed.loading && !feed.data && <div className="p-4"><Skeleton className="h-20" /></div>}
        {feed.error && <div className="p-4"><ErrorBox message={feed.error} onRetry={feed.reload} /></div>}
        {feed.data && !feed.data.cards.length && (
          <div className="p-4">
            <EmptyState title="Подсказок нет" text="Лента строится по реальным данным: просрочки, остатки, каталог." />
          </div>
        )}
        {!!feed.data?.cards.length && (
          <ul className="divide-y divide-line">
            {feed.data.cards.map((c) => {
              const s = SEV[c.sev] ?? { label: c.sev, tone: 'neutral' as Tone }
              return (
                <li key={c.key} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone={s.tone}>{s.label}</Badge>
                      <span className="text-[13px] font-medium">{c.title}</span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-secondary">{c.why}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.primary?.action === 'draft-pay' && typeof c.primary.invoiceId === 'number' && (
                      <Button size="sm" loading={busy} onClick={() => draftPayment(c.primary.invoiceId!)}>
                        Создать оплату
                      </Button>
                    )}
                    {c.primary?.nav && NAV[c.primary.nav] && (
                      <Link to={NAV[c.primary.nav]} className="text-sm font-semibold text-brand hover:underline">
                        {c.primary.label}
                      </Link>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => hideCard(c.key)}>Скрыть</Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card>
        <textarea
          className="min-h-[240px] w-full rounded-lg border border-line p-3 text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Здесь появится ответ помощника — отредактируйте перед использованием"
        />
        <p className="mt-2 text-xs text-ink-secondary">
          Включите AI_ASSISTANT=1 и AI_API_KEY на сервере для реальной модели. Иначе работает mock.
        </p>
      </Card>
    </>
  )
}
