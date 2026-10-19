import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import type { Dashboard, StoreHealth } from '../api/types'
import { useSyncStores } from '../api/useStores'
import { ago, fmtDateTime, fmtKop, fmtNum } from '../lib/format'
import { qs } from '../lib/query'
import { ErrorBox, Skeleton, useToast } from '../ui/kit'
import { CardRef, DocStatusBadge, opResult, typeLabel } from './shared'
import { SimpleBarChart } from '../components/SimpleChart'
import { HelpLink } from '../components/HelpLink'

function weekdayRu(d: Date) {
  return d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function Today() {
  const quality = useApi<{ total: number; noPhoto: number; noCategory: number; noLink: number; noScheme: number }>('/catalog/quality')
  const [period, setPeriod] = useState<'24h' | 'yesterday' | '7d' | '30d'>('24h')
  const [store, setStore] = useState('')
  const [polling, setPolling] = useState(false)
  const toast = useToast()
  const nav = useNavigate()
  const { data, error, loading, reload } = useApi<Dashboard>(`/dashboard${qs({ period, store })}`, { refreshMs: 60_000 })
  const series = useApi<{
    points: { t: string; sellDocs: number; cups: number; revenueRub: number }[]
    totals: { sellDocs: number; cups: number }
  }>(`/analytics/series${qs({ period, store })}`)
  const { stores: syncStores } = useSyncStores()

  const poll = async () => {
    setPolling(true)
    try {
      await api('/evotor/poll', { method: 'POST' })
      toast.push('Опрос кассы запущен')
      reload()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка опроса', 'bad')
    } finally {
      setPolling(false)
    }
  }

  const enabledStores = (data?.health.stores ?? []).filter((s) => s.enabled)
  const problems = (data?.health.stores ?? []).filter((s) => s.level === 'bad' || s.level === 'warn')
  const failN = data ? data.docs.sellFailed + data.docs.paybackFailed : 0
  const subDate = weekdayRu(new Date())

  return (
    <section className="view is-active" data-view="today">
      <div className="page-head">
        <div>
          <h1>Сегодня</h1>
          <p className="page-sub">
            {subDate} · что происходит на кассе и с начислением чашек
          </p>
        </div>
        <div className="head-actions">
          <HelpLink article="principles" />
          <select
            className="btn btn-ghost"
            style={{ height: 35 }}
            value={store}
            onChange={(e) => setStore(e.target.value)}
            aria-label="Точка"
          >
            <option value="">Все точки</option>
            {syncStores.map((s) => (
              <option key={s.uuid} value={s.uuid}>{s.name ?? s.uuid.slice(0, 8)}</option>
            ))}
          </select>
          <button type="button" className="btn btn-ghost" onClick={() => reload()}>Обновить</button>
          <button type="button" className="btn btn-primary" disabled={polling} onClick={poll}>
            Опросить кассу
          </button>
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && (
        <div className="kpi-grid">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      )}

      {data && (
        <>
          <div className="kpi-grid">
            <div className="card kpi">
              <div className="kpi-top"><span className="kpi-label">Продаж обработано</span></div>
              <div className="kpi-value">{fmtNum(data.ops.sells)}</div>
              <div className="kpi-foot">
                <div>
                  <div className="kpi-note">чеков SELL: {fmtNum(data.docs.sell)}</div>
                </div>
              </div>
            </div>
            <div className="card kpi">
              <div className="kpi-top"><span className="kpi-label">Начислено чашек</span></div>
              <div className="kpi-value">{fmtNum(data.ops.cups)}</div>
              <div className="kpi-foot">
                <div>
                  <div className="kpi-note">
                    {data.ops.cupsReturned ? `возвращено: ${data.ops.cupsReturned}` : 'за период'}
                  </div>
                </div>
              </div>
            </div>
            <div className="card kpi">
              <div className="kpi-top"><span className="kpi-label">Бесплатных выдано</span></div>
              <div className="kpi-value">{fmtNum(data.ops.free)}</div>
              <div className="kpi-foot">
                <div><div className="kpi-note">по лояльности</div></div>
              </div>
            </div>
            <div className="card kpi">
              <div className="kpi-top"><span className="kpi-label">Кэшбэк списан, ₽</span></div>
              <div className="kpi-value">{fmtKop(data.ops.cashbackKopecks)}</div>
              <div className="kpi-foot">
                <div>
                  <div className="kpi-note">сумма чеков: {fmtNum(data.ops.resultRub)} ₽</div>
                </div>
              </div>
            </div>
          </div>

          <div className="card strip">
            <div className="strip-item">
              <div className="strip-label"><span className="dot green" />Клиентов</div>
              <div className="strip-value">{fmtNum(data.customers)}</div>
              <div className="strip-note">новых: {data.newCustomers}</div>
            </div>
            <div className={`strip-item${data.sellWithoutCard ? ' warn' : ''}`}>
              <div className="strip-label"><span className="dot amber" />Без карты</div>
              <div className="strip-value">{fmtNum(data.sellWithoutCard)}</div>
              <div className="strip-note">чашки не начислены</div>
            </div>
            <div className={`strip-item${failN ? ' bad' : ''}`}>
              <div className="strip-label"><span className="dot red" />Ошибки чеков</div>
              <div className="strip-value">{fmtNum(failN)}</div>
              <div className="strip-note">продажи и возвраты</div>
            </div>
            <div className="strip-item">
              <div className="strip-label"><span className="dot" />Последняя</div>
              <div className="strip-value" style={{ fontSize: 16 }}>
                {data.ops.lastOpAt ? ago(data.ops.lastOpAt, data.now) : '—'}
              </div>
              <div className="strip-note">{data.ops.lastOpAt ? fmtDateTime(data.ops.lastOpAt) : 'не было'}</div>
            </div>
          </div>

          <div className="cols">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Динамика</div>
                  <div className="card-sub">Чеки и чашки · данные 6.7</div>
                </div>
                <div className="right">
                  <div className="seg">
                    {(['yesterday', '24h', '7d', '30d'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={period === p ? 'is-on' : ''}
                        onClick={() => setPeriod(p)}
                      >
                        {p === 'yesterday' ? 'Вчера' : p === '24h' ? '24ч' : p === '7d' ? '7д' : '30д'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {series.data?.points?.length ? (
                <div className="chart-wrap">
                  <SimpleBarChart
                    label="Чеки SELL"
                    color="#0f172a"
                    points={series.data.points.map((p) => ({ t: p.t, value: p.sellDocs }))}
                  />
                  <SimpleBarChart
                    label="Чашки"
                    color="#1f7a5a"
                    points={series.data.points.map((p) => ({ t: p.t, value: p.cups }))}
                  />
                </div>
              ) : (
                <p className="card-sub" style={{ padding: '8px 0' }}>Нет ряда за период</p>
              )}
            </div>

            <div className="card attention">
              <div className="card-head">
                <div>
                  <div className="card-title">Требует внимания</div>
                  <div className="card-sub">Очередь из dashboard</div>
                </div>
                <div className="right">
                  <span className="att-count">{(data.exceptions?.length ?? 0) + (failN ? 1 : 0) + (data.sellWithoutCard ? 1 : 0)}</span>
                </div>
              </div>
              <div className="att-list">
                {failN > 0 && (
                  <button type="button" className="att-item" onClick={() => nav('/operations?view=errors')}>
                    <span className="att-ic red" />
                    <span className="att-body">
                      <span className="att-t">Чеки с ошибкой</span>
                      <span className="att-d">Нужна разборка в Операциях</span>
                    </span>
                    <span className="att-n red">{failN}</span>
                  </button>
                )}
                {data.sellWithoutCard > 0 && (
                  <button type="button" className="att-item" onClick={() => nav('/operations?view=nocard')}>
                    <span className="att-ic" />
                    <span className="att-body">
                      <span className="att-t">Продажи без карты</span>
                      <span className="att-d">Чашки не начислены</span>
                    </span>
                    <span className="att-n">{data.sellWithoutCard}</span>
                  </button>
                )}
                {(data.exceptions ?? []).map((ex) => (
                  <button key={ex.id} type="button" className="att-item" onClick={() => nav(ex.href)}>
                    <span className={`att-ic${ex.level === 'bad' ? ' red' : ''}`} />
                    <span className="att-body">
                      <span className="att-t">{ex.title}</span>
                      <span className="att-d">из dashboard</span>
                    </span>
                    <span className="att-n">{ex.count}</span>
                  </button>
                ))}
                {problems.map((s) => (
                  <button key={s.uuid} type="button" className="att-item" onClick={() => nav('/cash')}>
                    <span className={`att-ic${s.level === 'bad' ? ' red' : ''}`} />
                    <span className="att-body">
                      <span className="att-t">{s.name ?? s.uuid.slice(0, 8)}</span>
                      <span className="att-d">{s.reason}</span>
                    </span>
                    <span className="att-n">→</span>
                  </button>
                ))}
                {!failN && !data.sellWithoutCard && !(data.exceptions?.length) && !problems.length && (
                  <p className="card-sub" style={{ padding: 12 }}>Пока спокойно</p>
                )}
              </div>
            </div>
          </div>

          <div className="cols" style={{ marginTop: 12 }}>
            <div className="card table-card">
              <div className="table-toolbar">
                <div>
                  <div className="card-title">Кассы</div>
                  <div className="card-sub">Статус sync и опроса</div>
                </div>
              </div>
              <div className="table-scroll">
                <table className="points-table">
                  <thead>
                    <tr>
                      <th>Точка</th>
                      <th>Статус</th>
                      <th>Опрос</th>
                      <th className="num-r">Очередь</th>
                      <th className="num-r">Ошибки</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(store ? data.health.stores.filter((s) => s.uuid === store) : enabledStores.length ? enabledStores : data.health.stores).map((s: StoreHealth) => (
                      <tr key={s.uuid}>
                        <td>
                          <div className="point-name">
                            <b>{s.name ?? s.uuid.slice(0, 8)}</b>
                            <span>{s.enabled ? 'sync on' : 'sync off'}</span>
                          </div>
                        </td>
                        <td>{s.level}</td>
                        <td>{s.lastFastAt ? ago(s.lastFastAt, data.now) : '—'}</td>
                        <td className="num-r">{s.outboxPending}</td>
                        <td className="num-r">{s.failedDocs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Качество каталога</div>
                  <div className="card-sub">Пробелы в меню</div>
                </div>
                <div className="right">
                  <button type="button" className="card-link" onClick={() => nav('/menu')}>Меню →</button>
                </div>
              </div>
              <div className="quality-list">
                {quality.data && (
                  <>
                    <button type="button" className="q-item" onClick={() => nav('/menu')}>
                      <span className="q-ic red" />
                      <span><span className="q-t">Без фото</span><span className="q-d">карточки товаров</span></span>
                      <span className="q-n red">{quality.data.noPhoto}</span>
                    </button>
                    <button type="button" className="q-item" onClick={() => nav('/menu')}>
                      <span className="q-ic amber" />
                      <span><span className="q-t">Без категории</span><span className="q-d">группировка меню</span></span>
                      <span className="q-n">{quality.data.noCategory}</span>
                    </button>
                    <button type="button" className="q-item" onClick={() => nav('/menu')}>
                      <span className="q-ic amber" />
                      <span><span className="q-t">Без связи с кассой</span><span className="q-d">Evotor link</span></span>
                      <span className="q-n">{quality.data.noLink < 0 ? '—' : quality.data.noLink}</span>
                    </button>
                    <button type="button" className="q-item" onClick={() => nav('/menu')}>
                      <span className="q-ic" />
                      <span><span className="q-t">Без схемы добавок</span><span className="q-d">напитки</span></span>
                      <span className="q-n">{quality.data.noScheme}</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="card table-card" style={{ marginTop: 12 }}>
            <div className="table-toolbar">
              <div>
                <div className="card-title">Последние операции</div>
                <div className="card-sub">Из dashboard.recent</div>
              </div>
              <div className="right">
                <button type="button" className="card-link" onClick={() => nav('/operations')}>Все →</button>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Тип</th>
                    <th>Точка</th>
                    <th>Карта</th>
                    <th>Результат</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.recent ?? []).slice(0, 12).map((o) => (
                    <tr key={`${o.storeUuid}/${o.docId}`}>
                      <td>{fmtDateTime(o.closedAt)}</td>
                      <td>{typeLabel(o.type)}{o.number != null ? ` №${o.number}` : ''}</td>
                      <td>{o.storeName ?? o.storeUuid.slice(0, 8)}</td>
                      <td><CardRef row={o} /></td>
                      <td>{opResult(o)}</td>
                      <td><DocStatusBadge status={o.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
