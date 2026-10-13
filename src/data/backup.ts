import { sanitizeUniverse } from '../domain/sanitize'
import { SCHEMA_VERSION, type UniverseData } from '../domain/types'

export interface BackupFile {
  app: 'orbita'
  schema: number
  exportedAt: string
  data: UniverseData
}

export function serializeBackup(data: UniverseData, now = new Date()): string {
  const file: BackupFile = { app: 'orbita', schema: SCHEMA_VERSION, exportedAt: now.toISOString(), data }
  return JSON.stringify(file, null, 2)
}

export type ParseResult = { ok: true; data: UniverseData; dropped: number } | { ok: false; error: string }

export function parseBackup(text: string): ParseResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'O arquivo não é um JSON válido.' }
  }
  if (typeof json !== 'object' || json === null) return { ok: false, error: 'Formato de backup não reconhecido.' }
  const file = json as Partial<BackupFile>
  if (file.app !== 'orbita' || typeof file.data !== 'object' || file.data === null) {
    return { ok: false, error: 'Este arquivo não é um backup do ÓRBITA.' }
  }
  if (typeof file.schema === 'number' && file.schema > SCHEMA_VERSION) {
    return { ok: false, error: 'O backup foi gerado por uma versão mais nova do aplicativo.' }
  }
  const { data, report } = sanitizeUniverse(file.data)
  return { ok: true, data, dropped: report.dropped }
}
