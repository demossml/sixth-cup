import { useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { getAdminToken } from './api/client'
import { Layout } from './ui/Layout'
import { Login } from './pages/Login'
import { TodayPage } from './pages/today/TodayPage'
import { OperationsPage, OperationDetailPage } from './pages/operations/OperationsPage'
import { CustomersPage, CustomerDetailPage } from './pages/customers/CustomersPage'
import { ProductsPage } from './pages/menu/ProductsPage'
import { GroupsPage } from './pages/menu/GroupsPage'
import { ModifiersPage } from './pages/menu/ModifiersPage'
import { EvotorPage } from './pages/evotor/EvotorPage'
import { MarketingPage } from './pages/marketing/MarketingPage'
import { SystemPage } from './pages/system/SystemPage'
import { LegacyGate } from './pages/legacy/LegacyGate'

export default function App() {
  const [authed, setAuthed] = useState(() => !!getAdminToken())

  if (!authed) return <Login onOk={() => setAuthed(true)} />

  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<TodayPage />} />
          <Route path="operations" element={<OperationsPage />} />
          <Route path="operations/:store/:doc" element={<OperationDetailPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="customers/:id" element={<CustomerDetailPage />} />
          <Route path="menu/products" element={<ProductsPage />} />
          <Route path="menu/groups" element={<GroupsPage />} />
          <Route path="menu/modifiers" element={<ModifiersPage />} />
          <Route path="evotor" element={<EvotorPage />} />
          <Route path="marketing" element={<MarketingPage />} />
          <Route path="system" element={<SystemPage />} />
          <Route path="legacy" element={<LegacyGate />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
