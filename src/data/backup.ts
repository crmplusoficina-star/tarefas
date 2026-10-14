import { sanitizeUniverse } from '../domain/sanitize'
import { SCHEMA_VERSION, type UniverseData } from '../domain/types'
import type { FileRecord } from './adapter'

/** A file inside the backup: bytes as base64 so the backup stays a single self-contained JSON. */
export interface BackupFile {
  id: string
  taskId: string
  name: string
  type: string
  size: number
  addedAt: number
  data: string
}

export interface BackupDocument {
  app: 'orbita'
  schema: number
  exportedAt: string
  data: UniverseData
  /** attachments (schema 2+); older backups simply do not have the field */
  files?: BackupFile[]
}

const CHUNK = 0x8000

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

export function fromBase64(text: string): ArrayBuffer {
  const bin = atob(text)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

export function serializeBackup(data: UniverseData, files: FileRecord[] = [], now = new Date()): string {
  // only files that a task still points to travel with the backup
  const wanted = new Set(data.tasks.flatMap((t) => t.attachments.map((a) => a.id)))
  const entries: BackupFile[] = files
    .filter((f) => wanted.has(f.id))
    .map((f) => ({ id: f.id, taskId: f.taskId, name: f.name, type: f.type, size: f.size, addedAt: f.addedAt, data: toBase64(f.data) }))
  const file: BackupDocument = { app: 'orbita', schema: SCHEMA_VERSION, exportedAt: now.toISOString(), data, files: entries }
  return JSON.stringify(file, null, 2)
}

export type ParseResult =
  | { ok: true; data: UniverseData; files: FileRecord[]; dropped: number; missingFiles: number }
  | { ok: false; error: string }

export function parseBackup(text: string): ParseResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'O arquivo não é um JSON válido.' }
  }
  if (typeof json !== 'object' || json === null) return { ok: false, error: 'Formato de backup não reconhecido.' }
  const file = json as Partial<BackupDocument>
  if (file.app !== 'orbita' || typeof file.data !== 'object' || file.data === null) {
    return { ok: false, error: 'Este arquivo não é um backup do ÓRBITA.' }
  }
  if (typeof file.schema === 'number' && file.schema > SCHEMA_VERSION) {
    return { ok: false, error: 'O backup foi gerado por uma versão mais nova do aplicativo.' }
  }
  const { data, report } = sanitizeUniverse(file.data)

  // decode the attached files; keep only those a task refers to and whose size still matches
  const wanted = new Map<string, { taskId: string }>()
  for (const t of data.tasks) for (const a of t.attachments) wanted.set(a.id, { taskId: t.id })
  const files: FileRecord[] = []
  const have = new Set<string>()
  for (const raw of Array.isArray(file.files) ? file.files : []) {
    if (typeof raw !== 'object' || raw === null || typeof raw.id !== 'string' || typeof raw.data !== 'string') continue
    const owner = wanted.get(raw.id)
    if (!owner || have.has(raw.id)) continue
    let data64: ArrayBuffer
    try {
      data64 = fromBase64(raw.data)
    } catch {
      continue
    }
    have.add(raw.id)
    files.push({
      id: raw.id,
      taskId: owner.taskId,
      name: typeof raw.name === 'string' ? raw.name.slice(0, 255) : 'arquivo',
      type: typeof raw.type === 'string' ? raw.type.slice(0, 120) : '',
      size: data64.byteLength,
      addedAt: typeof raw.addedAt === 'number' ? raw.addedAt : Date.now(),
      data: data64,
    })
  }
  // attachments whose bytes are not in the backup are dropped from the tasks so nothing points to a missing file
  let missingFiles = 0
  const tasks = data.tasks.map((t) => {
    const kept = t.attachments.filter((a) => have.has(a.id))
    if (kept.length === t.attachments.length) return t
    missingFiles += t.attachments.length - kept.length
    return { ...t, attachments: kept }
  })
  return { ok: true, data: missingFiles ? { ...data, tasks } : data, files, dropped: report.dropped, missingFiles }
}
