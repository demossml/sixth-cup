import AdminPage from './AdminPage'

/** Full previous admin UI */
export function LegacyGate() {
  return (
    <div className="-m-4">
      <div className="bg-amber-50 text-amber-900 text-xs px-3 py-1.5 border-b border-amber-200">
        Legacy-админка (старый UI). Новые экраны: Сегодня / Операции / Клиенты.
      </div>
      <AdminPage />
    </div>
  )
}
