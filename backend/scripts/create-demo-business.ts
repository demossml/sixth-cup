/**
 * Dev helper: create org → store → category → product via admin API.
 * Usage: ADMIN_TOKEN=dev-admin npx tsx scripts/create-demo-business.ts
 */
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000'
const TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin'

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'X-Admin-Token': TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${JSON.stringify(data)}`)
  return data
}

async function main() {
  const org = await api('POST', '/api/admin/organizations', {
    name: 'Пилот ООО',
    legalName: 'ООО «Пилот»',
    inn: '7705555666',
    taxRegime: 'usn_income',
    vatRate: 0,
  })
  console.log('org', org)

  const store = await api('POST', '/api/admin/stores', {
    name: 'Пилот точка',
    address: 'Тестовая 1',
    organizationId: org.id,
  })
  console.log('store', store)

  const cat = await api('POST', '/api/admin/categories', { name: 'Сезонное', sortOrder: 10 })
  console.log('cat', cat)

  await api('POST', '/api/admin/products', {
    name: 'Раф',
    price: 250,
    categoryId: cat.id,
    description: 'Ванильный раф',
    icon: 'Coffee',
  })
  console.log('product ok')

  const dir = await fetch(`${BASE}/api/directory`).then((r) => r.json())
  console.log('directory products', dir.products?.length, 'orgs', dir.organizations?.length)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
