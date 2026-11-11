import { useCallback, useEffect, useState } from 'react'
import { Copy, ExternalLink, Link2, Trash2 } from 'lucide-react'
import { Button, Drawer, ErrorBox, Field, Input, Spinner, useToast } from '../../ui/kit'
import { api } from '../../api/client'

type Share = { id: number; token: string; note: string | null; createdAt: number; revokedAt: number | null; path: string }

type Props = {
  open: boolean
  onClose: () => void
  layoutId: number
  /** Заголовок макета: ссылка подписывается им в письме/чате. */
  title: string
}

/** Абсолютная ссылка из относительного пути: origin зависит от стенда. */
export const shareUrl = (path: string, origin: string): string => {
  const base = origin.replace(/\/+$/, '')
  const clean = path.startsWith('/') ? path : `/${path}`
  // Роутер хэшный: путь вида «#/share/<token>» не должен получить второй «/».
  return clean.startsWith('/#') ? `${base}${clean}` : `${base}/${clean.replace(/^\/+/, '')}`
}

/** P2-5: ссылка на просмотр макета — создать, скопировать, отозвать. */
export default function ShareDrawer({ open, onClose, layoutId, title }: Props) {
  const toast = useToast()
  const [shares, setShares] = useState<Share[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api<{ shares: Share[] }>(`/menu-layouts/${layoutId}/shares`)
      setShares(res.shares ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить ссылки')
    } finally {
      setLoading(false)
    }
  }, [layoutId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const create = async () => {
    setBusy(true)
    try {
      const res = await api<{ share: Share }>(`/menu-layouts/${layoutId}/shares`, {
        method: 'POST',
        body: note.trim() ? { note: note.trim() } : {},
      })
      setShares((cur) => [{ ...res.share, createdAt: Date.now(), revokedAt: null }, ...cur])
      setNote('')
      const url = shareUrl(res.share.path, window.location.origin)
      try {
        await navigator.clipboard.writeText(url)
        toast.push('Ссылка создана и скопирована', 'ok')
      } catch {
        // Буфер обмена может быть закрыт политикой браузера — ссылку видно в списке.
        toast.push('Ссылка создана — скопируйте её из списка', 'ok')
      }
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось создать ссылку', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: number) => {
    try {
      await api(`/menu-layouts/${layoutId}/shares/${id}`, { method: 'DELETE' })
      setShares((cur) => cur.map((s) => (s.id === id ? { ...s, revokedAt: Date.now() } : s)))
      toast.push('Ссылка отозвана — она больше не открывается')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось отозвать ссылку', 'bad')
    }
  }

  const copy = async (share: Share) => {
    try {
      await navigator.clipboard.writeText(shareUrl(share.path, window.location.origin))
      toast.push('Ссылка скопирована', 'ok')
    } catch {
      toast.push('Браузер не дал доступ к буферу — скопируйте вручную', 'bad')
    }
  }

  const active = shares.filter((s) => !s.revokedAt)
  return (
    <Drawer open={open} onClose={onClose} title="Ссылка на просмотр" layer={66}>
      <p className="mb-3 text-[12.5px] text-ink-secondary">
        Ссылку можно отправить дизайнеру или в типографию: макет открывается на чтение без входа в админку.
        Показывается текущая версия — правки в редакторе видны сразу, отдельная копия не создаётся.
      </p>
      <div className="mb-3 flex items-end gap-1.5">
        <div className="min-w-0 flex-1">
          <Field label="Подпись (для себя)">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={120}
              placeholder="Например, «типография, сентябрь»"
              aria-label="Подпись ссылки"
              className="!h-8 text-[12px]"
            />
          </Field>
        </div>
        <Button size="sm" icon={<Link2 size={14} />} loading={busy} onClick={() => void create()}>
          Создать
        </Button>
      </div>
      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {loading && shares.length === 0 && <Spinner />}
      {!loading && shares.length === 0 && (
        <p className="text-[12px] text-ink-tertiary">Ссылок пока нет — создайте первую.</p>
      )}
      <ul className="space-y-1.5">
        {shares.map((s) => {
          const url = shareUrl(s.path, window.location.origin)
          return (
            <li
              key={s.id}
              className={`rounded-lg border px-2 py-1.5 ${s.revokedAt ? 'border-line bg-surface-2/60 opacity-70' : 'border-line'}`}
            >
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-ink">
                    {s.note || `Ссылка №${s.id}`}
                  </span>
                  <span className="block truncate text-[10.5px] text-ink-tertiary">
                    {s.revokedAt ? 'отозвана · ' : ''}
                    {new Date(s.createdAt).toLocaleString('ru-RU')} · {url}
                  </span>
                </span>
                {!s.revokedAt && (
                  <>
                    <button
                      type="button"
                      onClick={() => void copy(s)}
                      className="grid h-7 w-7 place-items-center rounded text-ink-tertiary hover:text-brand"
                      aria-label="Скопировать ссылку"
                      title="Скопировать ссылку"
                    >
                      <Copy size={13} />
                    </button>
                    <a
                      href={s.path}
                      target="_blank"
                      rel="noreferrer"
                      className="grid h-7 w-7 place-items-center rounded text-ink-tertiary hover:text-brand"
                      aria-label="Открыть ссылку"
                      title="Открыть ссылку"
                    >
                      <ExternalLink size={13} />
                    </a>
                    <button
                      type="button"
                      onClick={() => void revoke(s.id)}
                      className="grid h-7 w-7 place-items-center rounded text-ink-tertiary hover:text-bad"
                      aria-label="Отозвать ссылку"
                      title="Отозвать ссылку"
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {active.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-tertiary">
          Активных ссылок: {active.length}. Отзыв не удаляет ссылку из списка — видно, что и когда выдавали.
        </p>
      )}
      <p className="mt-2 text-[11px] leading-4 text-ink-tertiary">
        «{title}» — внутри ссылки только лист, оформление и предупреждения печати. Замечания, версии и данные
        каталога наружу не уходят.
      </p>
    </Drawer>
  )
}
