import type { Attachment } from './types'

/** Largest single file accepted (kept in IndexedDB; browsers allow far more, but memory is the limit). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
/** Files accepted per task */
export const MAX_ATTACHMENTS_PER_TASK = 30

export type AttachmentKind = 'image' | 'pdf' | 'sheet' | 'doc' | 'slides' | 'text' | 'archive' | 'other'

const EXT: Record<string, AttachmentKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', avif: 'image',
  pdf: 'pdf',
  xls: 'sheet', xlsx: 'sheet', xlsm: 'sheet', csv: 'sheet', ods: 'sheet', tsv: 'sheet',
  doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc',
  ppt: 'slides', pptx: 'slides', odp: 'slides',
  txt: 'text', md: 'text', json: 'text', xml: 'text', log: 'text',
  zip: 'archive', rar: 'archive', '7z': 'archive', gz: 'archive',
}

/** `accept` attribute of the file picker: documents people actually attach to tasks. */
export const ATTACHMENT_ACCEPT = 'image/*,.pdf,.doc,.docx,.odt,.rtf,.xls,.xlsx,.xlsm,.csv,.tsv,.ods,.ppt,.pptx,.odp,.txt,.md,.zip'

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : ''
}

export function attachmentKind(a: Pick<Attachment, 'name' | 'type'>): AttachmentKind {
  if (a.type.startsWith('image/')) return 'image'
  if (a.type === 'application/pdf') return 'pdf'
  return EXT[extensionOf(a.name)] ?? 'other'
}

export const KIND_LABEL: Record<AttachmentKind, string> = {
  image: 'Imagem',
  pdf: 'PDF',
  sheet: 'Planilha',
  doc: 'Documento',
  slides: 'Apresentação',
  text: 'Texto',
  archive: 'Compactado',
  other: 'Arquivo',
}

/** Can the browser show this inside the app (image or PDF)? Everything else is download-only. */
export function canPreview(a: Pick<Attachment, 'name' | 'type'>): boolean {
  const k = attachmentKind(a)
  // SVG can carry scripts: it is only ever shown through <img>, never embedded
  return k === 'image' || k === 'pdf'
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

export type FileCheck = { ok: true } | { ok: false; reason: string }

/** Pure validation of a candidate file against the limits (count is the number already attached). */
export function checkFile(file: { name: string; size: number }, attached: number): FileCheck {
  if (attached >= MAX_ATTACHMENTS_PER_TASK) return { ok: false, reason: `Limite de ${MAX_ATTACHMENTS_PER_TASK} anexos por tarefa.` }
  if (file.size === 0) return { ok: false, reason: `“${file.name}” está vazio.` }
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, reason: `“${file.name}” passa de ${formatSize(MAX_ATTACHMENT_BYTES)}.` }
  return { ok: true }
}

/** A file name safe to hand to the browser as a download name. */
export function safeFileName(name: string): string {
  let out = ''
  for (const ch of name) out += ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch
  return out.trim().slice(0, 200) || 'arquivo'
}
