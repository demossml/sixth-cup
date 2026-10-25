import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Ни один тест не должен писать в backend/data. Этот файл подключается как setupFiles,
// поэтому каждый тестовый файл получает свою временную БД, даже если сам её не настроил:
// те, что задают DB_PATH в шапке, всё равно перекрывают эти значения.
if (!process.env.DB_PATH) {
  const dir = mkdtempSync(join(tmpdir(), 'sc-suite-'))
  process.env.DB_PATH = join(dir, 'test.db')
  process.env.KEYS_PATH = join(dir, 'keys.json')
  process.env.UPLOADS_DIR = join(dir, 'uploads')
}
