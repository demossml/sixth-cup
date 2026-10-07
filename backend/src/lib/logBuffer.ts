/**
 * In-memory ring buffer of recent log lines for admin UI.
 * Optionally mirrors to LOG_PATH file.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const MAX = 2000
const buffer: string[] = []

function ts(): string {
  return new Date().toISOString()
}

function pushLine(line: string) {
  const row = line.endsWith('\n') ? line.slice(0, -1) : line
  buffer.push(row.slice(0, 4000))
  while (buffer.length > MAX) buffer.shift()
}

export function logLine(level: string, message: string, extra?: unknown) {
  const suffix =
    extra === undefined
      ? ''
      : typeof extra === 'string'
        ? ` ${extra}`
        : ` ${JSON.stringify(extra)}`
  const line = `${ts()} [${level}] ${message}${suffix}`
  pushLine(line)
  const logPath = process.env.LOG_PATH
  if (logPath) {
    try {
      const full = resolve(logPath)
      mkdirSync(dirname(full), { recursive: true })
      appendFileSync(full, line + '\n', 'utf8')
    } catch {
      /* ignore */
    }
  }
  return line
}

export function installConsoleCapture() {
  const wrap =
    (level: string, orig: (...a: unknown[]) => void) =>
    (...args: unknown[]) => {
      try {
        const msg = args
          .map((a) => {
            if (typeof a === 'string') return a
            try {
              return JSON.stringify(a)
            } catch {
              return String(a)
            }
          })
          .join(' ')
        pushLine(`${ts()} [${level}] ${msg}`)
      } catch {
        /* ignore */
      }
      orig(...args)
    }
  console.log = wrap('LOG', console.log.bind(console))
  console.info = wrap('INFO', console.info.bind(console))
  console.warn = wrap('WARN', console.warn.bind(console))
  console.error = wrap('ERROR', console.error.bind(console))
}

export function getBufferLines(n: number): string[] {
  const count = Math.min(Math.max(1, n), MAX)
  return buffer.slice(-count)
}

export function bufferSize(): number {
  return buffer.length
}

export function tailFile(path: string, n: number): { lines: string[]; error?: string } {
  try {
    const full = resolve(path)
    if (!existsSync(full)) return { lines: [], error: 'file_not_found' }
    const st = statSync(full)
    const maxRead = Math.min(st.size, 2 * 1024 * 1024)
    const buf = readFileSync(full)
    const text = buf.subarray(Math.max(0, st.size - maxRead)).toString('utf8')
    const all = text.split(/\r?\n/)
    const count = Math.min(Math.max(1, n), 500)
    return { lines: all.slice(-count).filter((l, i, a) => l !== '' || i < a.length - 1) }
  } catch (e) {
    return { lines: [], error: String(e).slice(0, 200) }
  }
}
