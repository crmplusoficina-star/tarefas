import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ATTACHMENT_ACCEPT, KIND_LABEL, MAX_ATTACHMENTS_PER_TASK, MAX_ATTACHMENT_BYTES, attachmentKind, canPreview, formatSize } from '../domain/attachments'
import type { Attachment, Task } from '../domain/types'
import { attachFiles, downloadAttachment, loadAttachmentBlob, requestRemoveAttachment } from '../state/commands'
import { pushToast } from '../state/uiStore'
import { Icon } from './Icon'
import { Modal } from './primitives'

const formatDay = (t: number) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })

/** Files attached to a task: add (button or drop), view images/PDFs, download, delete. Stored only in this browser. */
export function AttachmentsSection({ task }: { task: Task }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [viewing, setViewing] = useState<Attachment | null>(null)
  const list = task.attachments

  const add = async (files: FileList | File[] | null) => {
    const picked = files ? [...files] : []
    if (picked.length === 0 || busy) return
    setBusy(true)
    try {
      await attachFiles(task.id, picked)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div
      className={`field attach ${over ? 'over' : ''}`}
      data-testid="attachments"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        void add(e.dataTransfer.files)
      }}
    >
      <span className="label">Anexos {list.length > 0 && `· ${list.length}`}</span>
      {list.length > 0 && (
        <ul className="attach-list">
          {list.map((a) => {
            const kind = attachmentKind(a)
            return (
              <li className="attach-item" key={a.id} data-testid="attachment">
                <span className={`attach-kind k-${kind}`} aria-hidden="true">
                  {KIND_LABEL[kind].slice(0, 3).toUpperCase()}
                </span>
                <span className="attach-text">
                  <span className="attach-name" title={a.name}>
                    {a.name}
                  </span>
                  <span className="attach-meta">
                    {KIND_LABEL[kind]} · {formatSize(a.size)} · {formatDay(a.addedAt)}
                  </span>
                </span>
                {canPreview(a) && (
                  <button className="mini-btn" aria-label={`Visualizar ${a.name}`} title="Visualizar" onClick={() => setViewing(a)} data-testid="attachment-view">
                    <Icon name="eye" />
                  </button>
                )}
                <button className="mini-btn" aria-label={`Baixar ${a.name}`} title="Baixar" onClick={() => void downloadAttachment(a.id)} data-testid="attachment-download">
                  <Icon name="download" />
                </button>
                <button className="mini-btn danger" aria-label={`Excluir anexo ${a.name}`} title="Excluir" onClick={() => requestRemoveAttachment(task.id, a.id)} data-testid="attachment-delete">
                  <Icon name="trash" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <input ref={input} type="file" multiple hidden accept={ATTACHMENT_ACCEPT} onChange={(e) => void add(e.target.files)} data-testid="attach-input" aria-label="Escolher arquivos para anexar" />
      <button className="btn ghost" onClick={() => input.current?.click()} disabled={busy || list.length >= MAX_ATTACHMENTS_PER_TASK} data-testid="attach-btn">
        <Icon name="clip" /> {busy ? 'Guardando…' : 'Anexar arquivos'}
      </button>
      <p className="hint">
        PDFs, imagens, documentos e planilhas (até {formatSize(MAX_ATTACHMENT_BYTES)} cada). Ficam guardados só neste navegador e entram no backup. Também dá para soltar arquivos aqui.
      </p>
      {viewing && <AttachmentViewer attachment={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

function AttachmentViewer({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const kind = attachmentKind(attachment)
  useEffect(() => {
    let alive = true
    let made: string | null = null
    void loadAttachmentBlob(attachment.id).then((f) => {
      if (!alive) return
      if (!f) {
        pushToast('O arquivo deste anexo não foi encontrado neste navegador.', 'error')
        onClose()
        return
      }
      made = URL.createObjectURL(f.blob)
      setUrl(made)
    })
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [attachment.id, onClose])

  // portal: the task panel has a backdrop filter, which would trap a fixed-position dialog inside the panel
  return createPortal(
    <Modal
      title={attachment.name}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={() => void downloadAttachment(attachment.id)}>
            <Icon name="download" /> Baixar
          </button>
          <span className="grow" />
          <button className="btn primary" onClick={onClose}>
            Fechar
          </button>
        </>
      }
    >
      <div className="attach-viewer" data-testid="attachment-viewer">
        {!url ? (
          <p className="hint">Abrindo…</p>
        ) : kind === 'image' ? (
          <img src={url} alt={attachment.name} />
        ) : (
          <iframe src={url} title={attachment.name} />
        )}
      </div>
    </Modal>,
    document.body,
  )
}
