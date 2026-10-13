import { useState } from 'react'
import { api } from '../api/client'
import { Button, Card, PageHeader, Input, useToast } from '../ui/kit'

type Mode = 'catalog' | 'content' | 'anomaly' | 'shift'

export default function Assistant() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [product, setProduct] = useState('')
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
        subtitle="Черновики и подсказки. Ничего не публикуется автоматически. Без ключа — mock-ответы."
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <Button loading={busy} onClick={() => run('catalog')}>Разобрать каталог</Button>
        <Button loading={busy} variant="secondary" onClick={() => run('anomaly')}>Почему мало чашек</Button>
        <Button loading={busy} variant="secondary" onClick={() => run('shift')}>Сводка за день</Button>
        <div className="flex gap-2">
          <Input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Напиток для новинки" />
          <Button loading={busy} onClick={() => run('content')}>Текст новинки</Button>
        </div>
      </div>
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
