/**
 * Evotor Cloud paths — aligned with working workApp client.
 * Primary: API v1 inventories (X-Authorization + EVOTOR_API_TOKEN from env).
 * Token is FIXED in server .env — no /user/token webhook required for 6.7.
 */
export const evotorPaths = {
  /** workApp: stores/search */
  storesSearch: '/api/v1/inventories/stores/search',
  employeesSearch: '/api/v1/inventories/employees/search',
  products: (storeId: string) => `/api/v1/inventories/stores/${storeId}/products`,
  /** Documents: gtCloseDate & ltCloseDate (ISO-like strings from workApp formatDateWithTime) */
  documents: (storeId: string) => `/api/v1/inventories/stores/${storeId}/documents`,
  /** Optional V2 (probe only if v1 fails) */
  v2Stores: '/stores',
  v2Documents: (storeId: string) => `/stores/${storeId}/documents`,
} as const
