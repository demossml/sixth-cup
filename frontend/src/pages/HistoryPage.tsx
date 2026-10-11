import { useCallback, useEffect, useState } from 'react'
import { getJwt } from '../api'
import { formatRub } from '../lib/money'
import { RefreshCw } from '../lib/icons'

type Item = { id:string; at:string; kind:string; title:string; cupsDelta:number; cashbackDeltaKop:number; resultRub:number|null; status:string }
type Response = { items:Item[]; nextCursor:string|null }
export default function HistoryPage() {
 const [items,setItems]=useState<Item[]>([]), [cursor,setCursor]=useState<string|null>(null), [busy,setBusy]=useState(false), [error,setError]=useState('')
 const load=useCallback(async (next:string|null=null, append=false)=>{setBusy(true);setError('');try{const r=await fetch(`/api/sync/history?limit=30${next?`&cursor=${encodeURIComponent(next)}`:''}`,{headers:{Authorization:`Bearer ${getJwt()}`}});if(!r.ok)throw new Error('Не удалось загрузить историю');const d=await r.json() as Response;setItems(old=>{const merged=append?[...old,...d.items.filter(item=>!old.some(existing=>existing.id===item.id))]:d.items;try{localStorage.setItem('sc-history-cache',JSON.stringify({items:merged,at:Date.now()}))}catch{}return merged});setCursor(d.nextCursor)}catch{setError('Нет связи. Если история уже загружалась, попробуйте позже.');try{const cache=localStorage.getItem('sc-history-cache');if(cache&&!items.length)setItems(JSON.parse(cache).items??[])}catch{}}finally{setBusy(false)}},[])
 useEffect(()=>{void load()},[])
 return <div className="pb-6"><header className="bg-white px-4 pt-10 pb-5 border-b border-line"><h1 className="text-2xl font-bold text-ink">История</h1><p className="text-ink-secondary text-sm mt-1">Только подтверждённые сервером операции</p></header><div className="p-4 space-y-2">
 {error&&<p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}{!items.length&&!busy&&!error&&<div className="card text-center py-8"><b>Пока нет подтверждённых операций</b><p className="text-ink-secondary text-sm mt-2">Покупки и начисления появятся после обработки кассой.</p></div>}
 {items.map(i=><article key={i.id} className="card !mb-0 flex gap-3 items-start"><div className="min-w-0 flex-1"><b className="text-sm text-ink">{i.title}</b><p className="text-xs text-ink-secondary mt-1">{new Date(i.at).toLocaleString('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</p>{i.cupsDelta!==0&&<p className="text-xs text-ink-secondary mt-1">Стаканы: {i.cupsDelta>0?'+':''}{i.cupsDelta}</p>}</div><div className="text-right text-sm font-semibold tabular-nums">{i.cashbackDeltaKop?`${i.cashbackDeltaKop>0?'+':''}${formatRub(Math.abs(i.cashbackDeltaKop))} ₽`:i.resultRub!==null?`${Math.round(i.resultRub)} ₽`:''}</div></article>)}
 <button className="btn-ghost w-full flex justify-center items-center gap-2" disabled={busy} onClick={()=>void load(null)}><RefreshCw size={16} className={busy?'animate-spin':''}/>Обновить</button>{cursor&&<button className="btn w-full" disabled={busy} onClick={()=>void load(cursor,true)}>Показать ещё</button>}
 </div></div>
}
