/**
 * «Логины сотрудников» — учётные записи приложения (login/password) для интерфейса бариста.
 *
 * Отдельно от страницы «Сотрудники»: там табель, график и пожелания кассы, паролей нет.
 * Здесь — только доступ: роль, точка (для бариста обязательна), активность и сброс пароля.
 */
import { useMemo, useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { Banner, Button, Card, EmptyState, ErrorBox, Input, PageHeader, Select, Spinner, useToast } from '../ui/kit'
import { HelpLink } from '../components/HelpLink'

type AppUser = {
  id: number
  login: string
  role: 'owner' | 'admin' | 'barista'
  storeUuid: string | null
  active: boolean
  alertBlink: boolean
  displayName: string | null
  createdAt: number
}

type StoreRow = { id: number; name: string; evotorUuid: string | null }

const ROLE_LABEL: Record<AppUser['role'], string> = {
  owner: 'Владелец',
  admin: 'Администратор',
  barista: 'Бариста',
}

export default function AppUsers() {
  const { push } = useToast()
  const usersApi = useApi<{ users: AppUser[] }>('/app-users')
  const storesApi = useApi<{ stores: StoreRow[] }>('/stores')

  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<AppUser['role']>('barista')
  const [storeUuid, setStoreUuid] = useState('')
  const [busy, setBusy] = useState(false)

  const [resetId, setResetId] = useState<number | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [rowBusy, setRowBusy] = useState<number | null>(null)

  const stores = useMemo(
    () => (storesApi.data?.stores ?? []).filter((s) => Boolean(s.evotorUuid)),
    [storesApi.data],
  )
  const storeName = (uuid: string | null) =>
    uuid ? stores.find((s) => s.evotorUuid === uuid)?.name ?? uuid : 'Все точки'

  const create = async () => {
    if (!login.trim() || password.length < 8) {
      push('Логин обязателен, пароль — не короче 8 символов', 'bad')
      return
    }
    if (role === 'barista' && !storeUuid) {
      push('Для бариста выберите точку', 'bad')
      return
    }
    setBusy(true)
    try {
      await api('/app-users', {
        method: 'POST',
        body: {
          login: login.trim(),
          password,
          role,
          storeUuid: role === 'barista' ? storeUuid : null,
          displayName: displayName.trim() || null,
        },
      })
      push('Пользователь создан')
      setLogin('')
      setPassword('')
      setDisplayName('')
      usersApi.reload()
    } catch (e) {
      push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const patch = async (user: AppUser, body: Record<string, unknown>, okText: string) => {
    setRowBusy(user.id)
    try {
      await api(`/app-users/${user.id}`, { method: 'PATCH', body })
      push(okText)
      usersApi.reload()
    } catch (e) {
      push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setRowBusy(null)
    }
  }

  const saveReset = async (user: AppUser) => {
    if (resetPassword.length < 8) {
      push('Пароль — не короче 8 символов', 'bad')
      return
    }
    await patch(user, { password: resetPassword }, 'Пароль сброшен, старые сессии закрыты')
    setResetId(null)
    setResetPassword('')
  }

  if (usersApi.loading) return <Spinner />
  if (usersApi.error) return <ErrorBox message={usersApi.error} onRetry={usersApi.reload} />

  const users = usersApi.data?.users ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Логины сотрудников"
        subtitle="Вход в интерфейс бариста (телефон) по логину и паролю"
        actions={<HelpLink article="staff" />}
      />

      <Banner tone="neutral">
        Бариста видит только очередь заказов своей точки. Владелец и администратор видят все точки.
        Админский токен (ADMIN_TOKEN) продолжает работать как аварийный вход.
      </Banner>

      <Card>
        <h2 className="mb-3 text-base font-semibold">Новый пользователь</h2>
        <div className="flex flex-wrap gap-2">
          <Input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="Логин"
            aria-label="Логин"
            autoComplete="off"
            className="min-w-[11rem]"
          />
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль (мин. 8)"
            aria-label="Пароль"
            type="password"
            autoComplete="new-password"
            className="min-w-[11rem]"
          />
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Имя (необязательно)"
            aria-label="Имя"
            className="min-w-[10rem]"
          />
          <Select value={role} onChange={(e) => setRole(e.target.value as AppUser['role'])} aria-label="Роль">
            <option value="barista">Бариста</option>
            <option value="admin">Администратор</option>
            <option value="owner">Владелец</option>
          </Select>
          {role === 'barista' && (
            <Select
              value={storeUuid}
              onChange={(e) => setStoreUuid(e.target.value)}
              aria-label="Точка"
              className="min-w-[12rem]"
            >
              <option value="">Выберите точку…</option>
              {stores.map((s) => (
                <option key={s.evotorUuid!} value={s.evotorUuid!}>{s.name}</option>
              ))}
            </Select>
          )}
          <Button onClick={create} loading={busy} disabled={!login.trim() || password.length < 8}>
            Создать
          </Button>
        </div>
        {role === 'barista' && stores.length === 0 && !storesApi.loading && (
          <p className="mt-2 text-[12px] text-ink-secondary">
            Нет точек с uuid Эвотора. Сначала привяжите точку в разделе «Касса».
          </p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold">Пользователи</h2>
        {users.length === 0 ? (
          <EmptyState title="Пока нет пользователей" text="Создайте логин для бариста — он войдёт с телефона." />
        ) : (
          <div className="space-y-3">
            {users.map((u) => (
              <div key={u.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-[12rem] flex-1">
                    <div className="font-semibold">{u.login}</div>
                    <div className="text-[12px] text-ink-secondary">
                      {ROLE_LABEL[u.role]} · {storeName(u.storeUuid)}
                      {u.displayName ? ` · ${u.displayName}` : ''}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={u.active}
                      disabled={rowBusy === u.id}
                      onChange={(e) => patch(u, { active: e.target.checked }, e.target.checked ? 'Доступ включён' : 'Доступ отключён')}
                    />
                    Активен
                  </label>
                  <label className="flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={u.alertBlink}
                      disabled={rowBusy === u.id}
                      onChange={(e) => patch(u, { alertBlink: e.target.checked }, 'Настройка моргания сохранена')}
                    />
                    Моргание
                  </label>
                  <Button size="sm" variant="ghost" onClick={() => { setResetId(u.id); setResetPassword('') }}>
                    Сбросить пароль
                  </Button>
                </div>
                {resetId === u.id && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Input
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                      placeholder="Новый пароль (мин. 8)"
                      aria-label="Новый пароль"
                      type="password"
                      autoComplete="new-password"
                      className="min-w-[12rem]"
                    />
                    <Button size="sm" onClick={() => saveReset(u)} loading={rowBusy === u.id} disabled={resetPassword.length < 8}>
                      Сохранить
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setResetId(null)}>Отмена</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
