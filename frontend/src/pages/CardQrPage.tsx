import { Navigate } from 'react-router-dom'

/**
 * Legacy deep-link `/card-qr`. Раньше это был отдельный экран с крестиком;
 * теперь QR разворачивается поверх титула, поэтому маршрут ведёт на главную.
 */
export default function CardQrPage() {
  return <Navigate to="/" replace />
}
