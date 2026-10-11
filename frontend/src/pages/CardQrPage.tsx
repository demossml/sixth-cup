import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Qr from '../components/Qr'
import { useApp } from '../lib/app'
import { ArrowLeft, WifiOff } from '../lib/icons'
export default function CardQrPage(){
 const {me,best,lastSync}=useApp(); const nav=useNavigate();
 useEffect(()=>{let sentinel: {release:()=>Promise<void>}|null=null;let active=true;const wake=navigator as Navigator&{wakeLock?:{request:(type:'screen')=>Promise<{release:()=>Promise<void>}>}};void wake.wakeLock?.request('screen').then(lock=>{if(active)sentinel=lock;else void lock.release()}).catch(()=>{});return()=>{active=false;if(sentinel)void sentinel.release().catch(()=>{})}},[])
 return <main className="fixed inset-0 z-[60] bg-white text-ink flex flex-col items-center justify-center px-5 py-6" style={{paddingTop:'max(1.5rem, env(safe-area-inset-top))',paddingBottom:'max(1.5rem, env(safe-area-inset-bottom))'}}>
 <button onClick={()=>nav(-1)} className="absolute left-4 top-4 flex items-center gap-2 p-2 text-brand" style={{top:'max(1rem, env(safe-area-inset-top))'}}><ArrowLeft size={20}/>Назад</button>
 <h1 className="text-xl font-bold mb-5">QR карты для кассы</h1>
 {best?.token&&me?<><div className="w-full max-w-[360px] flex justify-center bg-white p-2"><Qr value={best.token} alt="QR карты для кассы"/></div><div className="mt-4 text-4xl font-bold tracking-[0.22em] tabular-nums">{me.cardCode.padStart(4,'0')}</div><p className="text-center text-base mt-3">Если не сканируется — назовите номер карты</p></>:<p className="text-center">QR пока недоступен. Подключитесь к сети и обновите карту.</p>}
 <p className="mt-5 text-sm text-ink-secondary flex items-center gap-2">{!navigator.onLine&&<WifiOff size={16}/>} {!navigator.onLine?'Офлайн · данные могут быть устаревшими':lastSync?`Последняя синхронизация: ${new Date(lastSync).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`:'Нет подтверждённой синхронизации'}</p>
 </main>
}
