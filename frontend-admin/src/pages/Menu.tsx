import { useSearchParams } from 'react-router-dom'
import { PageHeader, Tabs } from '../ui/kit'
import { HelpLink } from '../components/HelpLink'
import { setParams } from '../lib/query'
import MenuProducts from './MenuProducts'
import MenuGroups from './MenuGroups'

type Section = 'products' | 'groups' | 'modifiers' | 'schemes' | 'milk'

export default function Menu() {
  const [sp, setSp] = useSearchParams()
  const section = (sp.get('section') ?? 'products') as Section
  return (
    <>
      <PageHeader title="Меню" subtitle="Товары, группы, добавки и молоко; нормы списания — в карточке товара. Синк в Эвотор на включённые точки" actions={<HelpLink article="logic-coffee" label="Нормы" />} />
      <Tabs
        items={[
          { key: 'products', label: 'Товары' },
          { key: 'groups', label: 'Группы' },
          { key: 'modifiers', label: 'Добавки' },
          { key: 'schemes', label: 'Схемы добавок' },
          { key: 'milk', label: 'Схемы молока' },
        ]}
        value={section}
        onChange={(k) => setSp(setParams(sp, { section: k === 'products' ? null : k, q: null, tab: null }), { replace: true })}
      />
      {section === 'products' ? <MenuProducts /> : <MenuGroups section={section} />}
    </>
  )
}
