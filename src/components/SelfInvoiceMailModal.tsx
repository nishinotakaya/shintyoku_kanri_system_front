import { useEffect, useState } from 'react'
import { api } from '../lib/api'

type Props = {
  year: number
  month: number
  category: string
  onClose: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  wings: 'Wings',
  living: 'リビング',
  techleaders: 'テックリーダーズ',
  resystems: 'REシステムズ',
}

export default function SelfInvoiceMailModal({ year, month, category, onClose }: Props) {
  const [to, setTo] = useState('')
  const [recipientName, setRecipientName] = useState('株式会社ラボップ 御中')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [extraFiles, setExtraFiles] = useState<File[]>([])
  // 添付タイプ別にチェックボックス（デフォルト全選択）
  const [includeInvoicePdf, setIncludeInvoicePdf] = useState(true)
  const [includeExpensePdf, setIncludeExpensePdf] = useState(true)
  const [includeExpenseXlsx, setIncludeExpenseXlsx] = useState(true)
  const [availableExpenseTotal, setAvailableExpenseTotal] = useState<number | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const expenseDisabled = availableExpenseTotal !== null && availableExpenseTotal <= 0
  const includeExpense = !expenseDisabled && (includeExpensePdf || includeExpenseXlsx)

  const monthParam = `${year}-${String(month).padStart(2, '0')}`

  useEffect(() => { void requestDraft() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const requestDraft = async () => {
    setDrafting(true); setMsg(null)
    try {
      const r = await api.post<{ subject: string; body: string; available_expense_total?: number }>('/emails/self_invoice_draft', {
        month: monthParam, category,
        recipient_name: recipientName,
        include_expense: includeExpense,
      })
      setSubject(r.data.subject)
      setBody(r.data.body)
      setDraftLoaded(true)
      if (typeof r.data.available_expense_total === 'number') {
        setAvailableExpenseTotal(r.data.available_expense_total)
        if (r.data.available_expense_total <= 0) {
          setIncludeExpensePdf(false)
          setIncludeExpenseXlsx(false)
        }
      }
    } catch (e: any) {
      setMsg(`AI下書き失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setDrafting(false) }
  }

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setExtraFiles((prev) => [...prev, ...files])
    e.target.value = ''
  }
  const removeExtra = (i: number) => setExtraFiles((prev) => prev.filter((_, idx) => idx !== i))

  const send = async () => {
    if (!to.trim()) { setMsg('宛先を入力してください'); return }
    if (!subject.trim() || !body.trim()) { setMsg('件名・本文を入力してください'); return }
    setSending(true); setMsg(null)
    try {
      const fd = new FormData()
      fd.append('month', monthParam)
      fd.append('category', category)
      fd.append('to', to)
      fd.append('subject', subject)
      fd.append('body', body)
      fd.append('include_invoice_pdf', includeInvoicePdf ? '1' : '0')
      fd.append('include_expense_pdf', includeExpensePdf && !expenseDisabled ? '1' : '0')
      fd.append('include_expense_xlsx', includeExpenseXlsx && !expenseDisabled ? '1' : '0')
      // 後方互換用
      fd.append('include_expense', includeExpense ? '1' : '0')
      extraFiles.forEach((f) => fd.append('extra_files[]', f))
      const r = await api.post<{ ok: boolean; sent_to: string; attachments: string[] }>('/emails/self_invoice_send', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setMsg(`✅ 送信しました (実宛先: ${r.data.sent_to}, 添付 ${r.data.attachments.length} 件)`)
    } catch (e: any) {
      setMsg(`送信失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="text-sm font-semibold">📧 自分の請求書をメール送付</div>
            <div className="text-[11px] text-[var(--color-text-sub)]">
              {year}年{month}月分（{CATEGORY_LABELS[category] ?? category}）／ オリジナル宛先・発行者の請求書 PDF を送付
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="block">
            <div className="text-[11px] font-semibold mb-0.5">宛先</div>
            <input value={to} onChange={(e) => setTo(e.target.value)} list="self-invoice-to-list" autoComplete="email" className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="someone@example.com" />
            <datalist id="self-invoice-to-list">
              <option value="k-osumi@rabop.jp" />
              <option value="takaya777boxing@gmail.com" />
              <option value="takaya314boxing@gmail.com" />
              <option value="calmdownyourlife@gmail.com" />
            </datalist>
          </label>
          <label className="block">
            <div className="text-[11px] font-semibold mb-0.5">宛名（会社=御中 / 個人=様）</div>
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

        <div className="rounded-md bg-gray-50 px-2 py-1.5 text-[11px] text-[var(--color-text-sub)] space-y-1">
          <div className="font-semibold text-[var(--color-text)]">同梱する添付（デフォルト全選択）</div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeInvoicePdf}
              onChange={(e) => setIncludeInvoicePdf(e.target.checked)}
              className="accent-sky-500"
            />
            <span>請求書 PDF</span>
          </label>
          <label className={`flex items-center gap-2 ${expenseDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={includeExpensePdf && !expenseDisabled}
              disabled={expenseDisabled}
              onChange={(e) => setIncludeExpensePdf(e.target.checked)}
              className="accent-emerald-500"
            />
            <span>立替金 PDF</span>
          </label>
          <label className={`flex items-center gap-2 ${expenseDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={includeExpenseXlsx && !expenseDisabled}
              disabled={expenseDisabled}
              onChange={(e) => setIncludeExpenseXlsx(e.target.checked)}
              className="accent-emerald-500"
            />
            <span>立替金 Excel</span>
          </label>
          {availableExpenseTotal !== null && (
            <div className="text-[10px]">対象月の立替金合計: ¥{availableExpenseTotal.toLocaleString()}</div>
          )}
          {expenseDisabled && <div className="text-amber-600">立替金が 0 円のため、立替金 PDF / Excel は同梱しません。</div>}
        </div>

        <div className="mt-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[11px] font-semibold">追加添付</div>
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
