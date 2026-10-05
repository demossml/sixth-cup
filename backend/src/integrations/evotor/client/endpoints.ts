/** All Evotor Cloud paths in one place (MASTER-TZ §3–10). */
export const evotorPaths = {
  stores: '/stores',
  devices: '/devices',
  employees: '/employees',
  documents: (storeId: string) => `/stores/${storeId}/documents`,
  document: (storeId: string, docId: string) => `/stores/${storeId}/documents/${docId}`,
  deviceDocuments: (storeId: string, deviceId: string) =>
    `/stores/${storeId}/devices/${deviceId}/documents`,
  products: (storeId: string) => `/stores/${storeId}/products`,
  product: (storeId: string, productId: string) => `/stores/${storeId}/products/${productId}`,
  productGroups: (storeId: string) => `/stores/${storeId}/product-groups`,
  productGroup: (storeId: string, groupId: string) =>
    `/stores/${storeId}/product-groups/${groupId}`,
  bulks: (bulkId: string) => `/bulks/${bulkId}`,
} as const
