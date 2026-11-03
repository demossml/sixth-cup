import { useSearchParams } from 'react-router-dom'
import { PageHeader, Tabs } from '../ui/kit'
import { HelpLink } from '../components/HelpLink'
import { setParams } from '../lib/query'
import MenuProducts from './MenuProducts'
import MenuGroups from './MenuGroups'
import CatalogReadiness from './CatalogReadiness'

type Section = 'products' | 'groups' | 'modifiers' | 'readiness'

export default function Menu() {
  const [sp, setSp] = useSearchParams()
  const section = (sp.get('section') ?? 'products') as Section
  return (
    <>
      <PageHeader title="Меню" subtitle="Товары, группы и добавки. Схемы объёмов, молока и добавок — отдельные разделы слева. Нормы списания — в карточке товара" actions={<HelpLink article="logic-coffee" label="Нормы" />} />
      <Tabs
        items={[
          { key: 'products', label: 'Товары' },
          { key: 'groups', label: 'Группы' },
          { key: 'modifiers', label: 'Добавки' },
          { key: 'readiness', label: 'Готовность кассы' },
        ]}
        value={section}
        onChange={(k) => setSp(setParams(sp, { section: k === 'products' ? null : k, q: null, tab: null }), { replace: true })}
      />
      {section === 'products' ? <MenuProducts /> : section === 'readiness' ? <CatalogReadiness /> : <MenuGroups section={section} />}
    </>
  )
}
