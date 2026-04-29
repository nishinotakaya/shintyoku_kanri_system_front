import { useEffect, useState } from 'react'
import { api } from '../lib/api'

type Submission = {
  id: number
  user_display_name: string
  year: number
  month: number
  category: string
  kind: 'invoice' | 'expense'
  total_override: number | null
  default_total: number | null
}

type Props = {
  invoice: Submission // 承認済の invoice (必須)
  expense: Submission | null // 同月の承認済 expense (任意)
  onClose: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  wings: 'Wings',
  living: 'リビング',
  techleaders: 'テックリーダーズ',
  resystems: 'REシステムズ',
}

export default function LabopMailModal({ invoice, expense, onClose }: Props) {
  const [to, setTo] = useState('k-osumi@rabop.jp')
  const [recipientName, setRecipientName] = useState('大隅')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [extraFiles, setExtraFiles] = useState<File[]>([])
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [draftLoaded, setDraftLoaded] = useState(false)

  // 開いた直後に AI 下書き取得
  useEffect(() => {
    void requestDraft()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const requestDraft = async () => {
    setDrafting(true); setMsg(null)
    try {
      const r = await api.post<{ subject: string; body: string }>('/emails/labop_draft', {
        invoice_submission_id: invoice.id,
        expense_submission_id: expense?.id,
        recipient_name: recipientName,
        extra_count: extraFiles.length,
      })
      setSubject(r.data.subject)
      setBody(r.data.body)
      setDraftLoaded(true)
    } catch (e: any) {
      setMsg(`AI下書き失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setDrafting(false)
    }
  }

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setExtraFiles((prev) => [...prev, ...files])
    e.target.value = ''
  }
  const removeExtra = (i: number) => setExtraFiles((prev) => prev.filter((_, idx) => idx !== i))

  const send = async () => {
    if (!subject.trim() || !body.trim()) {
      setMsg('件名・本文を入力してください')
      return
    }
    setSending(true); setMsg(null)
    try {
      const fd = new FormData()
      fd.append('invoice_submission_id', String(invoice.id))
      if (expense) fd.append('expense_submission_id', String(expense.id))
      fd.append('to', to)
      fd.append('subject', subject)
      fd.append('body', body)
      extraFiles.forEach((f) => fd.append('extra_files[]', f))
      const r = await api.post<{ ok: boolean; sent_to: string }>('/emails/labop_send', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setMsg(`✅ 送信しました (実宛先: ${r.data.sent_to})`)
    } catch (e: any) {
      setMsg(`送信失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="text-sm font-semibold text-[var(--color-text)]">📧 ラボップへメール送付</div>
            <div className="text-[11px] text-[var(--color-text-sub)]">
              {invoice.user_display_name} ／ {invoice.year}年{invoice.month}月（{CATEGORY_LABELS[invoice.category] ?? invoice.category}）
              {expense ? ' ／ 立替金もあり' : ' ／ 立替金なし'}
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-sub)] hover:text-red-500" aria-label="閉じる">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="block">
            <div className="text-[11px] font-semibold mb-0.5">宛先</div>
            <input value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
          </label>
          <label className="block">
            <div className="text-[11px] font-semibold mb-0.5">宛名 (xxx様)</div>
            <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
          </label>
        </div>

        <label className="block mb-2">
          <div className="text-[11px] font-semibold mb-0.5">件名</div>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" placeholder={drafting ? 'AI 下書き生成中…' : ''} />
        </label>

        <label className="block mb-2">
          <div className="text-[11px] font-semibold mb-0.5">本文</div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm font-mono" placeholder={drafting ? 'AI 下書き生成中…' : ''} />
          <div className="mt-1 flex justify-end">
            <button onClick={requestDraft} disabled={drafting} className="rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-3 py-1 text-[11px] font-semibold text-[var(--color-text-sub)] hover:bg-gray-50 disabled:opacity-50">
              {drafting ? 'AI 生成中…' : '🤖 AI で再生成'}
            </button>
          </div>
        </label>

        <div className="rounded-md bg-gray-50 px-2 py-1.5 text-[11px] text-[var(--color-text-sub)]">
          標準添付:
          <ul className="ml-4 list-disc">
            <li>ラボップ宛 請求書 PDF</li>
            {expense && <li>立替金 PDF</li>}
            {expense && <li>立替金 Excel</li>}
          </ul>
        </div>

        <div className="mt-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[11px] font-semibold">追加添付（領収書など）</div>
            <label className="cursor-pointer rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-2 py-0.5 text-[11px] font-semibold text-[var(--color-text-sub)] hover:bg-gray-50">
              + ファイル追加
              <input type="file" multiple onChange={handleFiles} className="hidden" />
            </label>
          </div>
          {extraFiles.length === 0 ? (
            <div className="text-[10px] text-[var(--color-text-sub)]">なし</div>
          ) : (
            <ul className="text-[11px] space-y-0.5">
              {extraFiles.map((f, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span>📎 {f.name}（{Math.round(f.size / 1024)} KB）</span>
                  <button onClick={() => removeExtra(i)} className="text-gray-400 hover:text-red-500">🗑</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className={`text-[11px] ${msg?.includes('失敗') ? 'text-red-500' : 'text-emerald-600'}`}>{msg ?? ''}</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text-sub)] hover:bg-gray-50">閉じる</button>
            <button onClick={send} disabled={sending || drafting || !draftLoaded} className="rounded-md whitespace-nowrap bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
              {sending ? '送信中…' : '📧 送信'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
