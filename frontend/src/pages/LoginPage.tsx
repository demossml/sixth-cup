import { Navigate } from 'react-router-dom'

/** SMS/телефон отключены: карта выдаётся через POST /auth/guest. */
export default function LoginPage() {
  return <Navigate to="/" replace />
}
