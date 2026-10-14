import { describe, expect, it } from 'vitest'
import { attachmentKind, canPreview, checkFile, extensionOf, formatSize, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_TASK, safeFileName } from './attachments'
import { sanitizeTask } from './sanitize'

describe('attachments (domain)', () => {
  it('classifies by MIME type first, then by extension', () => {
    expect(attachmentKind({ name: 'x', type: 'image/webp' })).toBe('image')
    expect(attachmentKind({ name: 'a.PDF', type: '' })).toBe('pdf')
    expect(attachmentKind({ name: 'balanco.xlsx', type: 'application/vnd.ms-excel' })).toBe('sheet')
    expect(attachmentKind({ name: 'contrato.docx', type: '' })).toBe('doc')
    expect(attachmentKind({ name: 'sem-extensao', type: '' })).toBe('other')
    expect(extensionOf('.bashrc')).toBe('')
    expect(extensionOf('a.tar.gz')).toBe('gz')
  })

  it('previews only images and PDFs', () => {
    expect(canPreview({ name: 'a.png', type: 'image/png' })).toBe(true)
    expect(canPreview({ name: 'a.pdf', type: 'application/pdf' })).toBe(true)
    expect(canPreview({ name: 'a.xlsx', type: '' })).toBe(false)
    expect(canPreview({ name: 'a.html', type: 'text/html' })).toBe(false)
  })

  it('formats sizes for people', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2.0 KB')
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(formatSize(40 * 1024 * 1024)).toBe('40 MB')
  })

  it('enforces size, emptiness and count limits', () => {
    expect(checkFile({ name: 'a', size: 10 }, 0).ok).toBe(true)
    expect(checkFile({ name: 'a', size: 0 }, 0).ok).toBe(false)
    expect(checkFile({ name: 'a', size: MAX_ATTACHMENT_BYTES + 1 }, 0).ok).toBe(false)
    expect(checkFile({ name: 'a', size: MAX_ATTACHMENT_BYTES }, 0).ok).toBe(true)
    expect(checkFile({ name: 'a', size: 10 }, MAX_ATTACHMENTS_PER_TASK).ok).toBe(false)
  })

  it('makes download names safe', () => {
    expect(safeFileName('a/b\\c:d.pdf')).toBe('a_b_c_d.pdf')
    expect(safeFileName('   ')).toBe('arquivo')
  })

  it('repairs attachment metadata when loading a task', () => {
    const base = { id: 't', planetId: 'p', groupId: 'g' }
    expect(sanitizeTask(base)!.attachments).toEqual([])
    const t = sanitizeTask({ ...base, attachments: [{ id: 'a1', name: 'x.pdf', type: 'application/pdf', size: 3, addedAt: 5 }, { id: 'a1' }, { name: 'sem id' }, 7] })!
    expect(t.attachments).toHaveLength(1)
    expect(t.attachments[0]).toMatchObject({ id: 'a1', name: 'x.pdf', size: 3 })
  })
})
