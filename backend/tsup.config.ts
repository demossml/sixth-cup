import { defineConfig } from 'tsup'

// Общая модель конструктора меню — исходники TS без сборки: вшиваем в бандл.
export default defineConfig({ noExternal: ['@sixth-cup/menu-core'] })
