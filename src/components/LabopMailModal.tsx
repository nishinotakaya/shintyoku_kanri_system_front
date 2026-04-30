import { useEffect, useMemo, useState } from 'react'
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
  // 全ての承認済み (invoice + expense) を渡す
  invoices: Submission[]
  expenses: Submission[]
  onClose: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  wings: 'Wings',
  living: 'リビング',
  techleaders: 'テックリーダーズ',
  resystems: 'REシステムズ',
}

export default function LabopMailModal({ invoices, expenses, onClose }: Props) {
  // 既定で全添付タイプ全選択（請求書PDF / 業務報告書Excel / 立替金PDF / 立替金Excel）
  const [selectedInvoicePdfIds, setSelectedInvoicePdfIds] = useState<Set<number>>(() => new Set(invoices.map((s) => s.id)))
  const [selectedWorkReportXlsxIds, setSelectedWorkReportXlsxIds] = useState<Set<number>>(() => new Set(invoices.map((s) => s.id)))
  const [selectedExpensePdfIds, setSelectedExpensePdfIds] = useState<Set<number>>(() => new Set(expenses.map((s) => s.id)))
  const [selectedExpenseXlsxIds, setSelectedExpenseXlsxIds] = useState<Set<number>>(() => new Set(expenses.map((s) => s.id)))
  const [to, setTo] = useState('takaya777boxing@gmail.com') // テスト送信先を初期値に
  const [recipientName, setRecipientName] = useState('株式会社ラボップ 御中')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [extraFiles, setExtraFiles] = useState<File[]>([])
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [draftLoaded, setDraftLoaded] = useState(false)

  // 立替金は PDF または Excel のどちらかが選ばれていれば「対象」扱い（金額計算用）
  const expenseInvolvedIds = useMemo(() => {
    const s = new Set<number>(); selectedExpensePdfIds.forEach((id) => s.add(id)); selectedExpenseXlsxIds.forEach((id) => s.add(id)); return s
  }, [selectedExpensePdfIds, selectedExpenseXlsxIds])
  const totalSelected = selectedInvoicePdfIds.size + selectedWorkReportXlsxIds.size + selectedExpensePdfIds.size + selectedExpenseXlsxIds.size

  useEffect(() => { void requestDraft() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<number>>>, id: number) => {
    setter((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  const requestDraft = async () => {
    setDrafting(true); setMsg(null)
    try {
      const r = await api.post<{ subject: string; body: string }>('/emails/labop_draft', {
        invoice_submission_ids: Array.from(selectedInvoicePdfIds),
        expense_submission_ids: Array.from(expenseInvolvedIds),
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
    if (!subject.trim() || !body.trim()) { setMsg('件名・本文を入力してください'); return }
    if (totalSelected === 0) { setMsg('送付対象を1件以上選択してください'); return }
    setSending(true); setMsg(null)
    try {
      const fd = new FormData()
      Array.from(selectedInvoicePdfIds).forEach((id) => fd.append('invoice_pdf_submission_ids[]', String(id)))
      Array.from(selectedWorkReportXlsxIds).forEach((id) => fd.append('work_report_xlsx_submission_ids[]', String(id)))
      Array.from(selectedExpensePdfIds).forEach((id) => fd.append('expense_pdf_submission_ids[]', String(id)))
      Array.from(selectedExpenseXlsxIds).forEach((id) => fd.append('expense_xlsx_submission_ids[]', String(id)))
      fd.append('to', to)
      fd.append('subject', subject)
      fd.append('body', body)
      extraFiles.forEach((f) => fd.append('extra_files[]', f))
      const r = await api.post<{ ok: boolean; sent_to: string; attachments: string[] }>('/emails/labop_send', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setMsg(`✅ 送信しました (実宛先: ${r.data.sent_to}, 添付 ${r.data.attachments.length} 件)`)
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
            <div className="text-sm font-semibold text-[var(--color-text)]">📧 ラボップへ一括送付</div>
            <div className="text-[11px] text-[var(--color-text-sub)]">
              請求書PDF {selectedInvoicePdfIds.size}/{invoices.length} ／ 業務報告書Excel {selectedWorkReportXlsxIds.size}/{invoices.length} ／ 立替金PDF {selectedExpensePdfIds.size}/{expenses.length} ／ 立替金Excel {selectedExpenseXlsxIds.size}/{expenses.length}
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-sub)] hover:text-red-500" aria-label="閉じる">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="block">
            <div className="text-[11px] font-semibold mb-0.5">宛先</div>
            <input value={to} onChange={(e) => setTo(e.target.value)} list="labop-mail-to-list" autoComplete="email" className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
            <datalist id="labop-mail-to-list">
              <option value="k-osumi@rabop.jp" />
              <option value="takaya777boxing@gmail.com" />
              <option value="takaya314boxing@gmail.com" />
              <option value="calmdownyourlife@gmail.com" />
            </datalist>
            <div className="mt-0.5 text-[10px] text-[var(--color-text-sub)]">
              テストは <code>takaya777boxing@gmail.com</code> ／ 本番は <code>k-osumi@rabop.jp</code>
            </div>
          </label>
          <label className="block">
            <div className="text-[11px] font-semibold mb-0.5">宛名 (xxx様)</div>
            <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
          </label>
        </div>

        <div className="rounded-md border border-[var(--color-border)] px-2 py-1.5 mb-2">
          <div className="text-[11px] font-semibold mb-1">送付対象を選択（添付タイプ別。デフォルト全選択）</div>
          {invoices.length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] text-sky-600 font-semibold mb-0.5">請求書 PDF</div>
              {invoices.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-[11px] cursor-pointer">
                  <input type="checkbox" checked={selectedInvoicePdfIds.has(s.id)} onChange={() => toggleSet(setSelectedInvoicePdfIds, s.id)} />
                  <span>{s.user_display_name} {s.year}年{s.month}月（{CATEGORY_LABELS[s.category] ?? s.category}）</span>
                  {s.total_override != null && <span className="text-sky-600">¥{s.total_override.toLocaleString()}</span>}
                </label>
              ))}
            </div>
          )}
          {invoices.length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] text-fuchsia-600 font-semibold mb-0.5">業務報告書 Excel</div>
              {invoices.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-[11px] cursor-pointer">
                  <input type="checkbox" checked={selectedWorkReportXlsxIds.has(s.id)} onChange={() => toggleSet(setSelectedWorkReportXlsxIds, s.id)} />
                  <span>{s.user_display_name} {s.year}年{s.month}月（{CATEGORY_LABELS[s.category] ?? s.category}）</span>
                </label>
              ))}
            </div>
          )}
          {expenses.length > 0 && (
            <>
              <div className="mb-2">
                <div className="text-[10px] text-emerald-600 font-semibold mb-0.5">立替金 PDF</div>
                {expenses.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-[11px] cursor-pointer">
                    <input type="checkbox" checked={selectedExpensePdfIds.has(s.id)} onChange={() => toggleSet(setSelectedExpensePdfIds, s.id)} />
                    <span>{s.user_display_name} {s.year}年{s.month}月（{CATEGORY_LABELS[s.category] ?? s.category}）</span>
                  </label>
                ))}
              </div>
              <div>
                <div className="text-[10px] text-emerald-600 font-semibold mb-0.5">立替金 Excel</div>
                {expenses.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-[11px] cursor-pointer">
                    <input type="checkbox" checked={selectedExpenseXlsxIds.has(s.id)} onChange={() => toggleSet(setSelectedExpenseXlsxIds, s.id)} />
                    <span>{s.user_display_name} {s.year}年{s.month}月（{CATEGORY_LABELS[s.category] ?? s.category}）</span>
                  </label>
                ))}
              </div>
            </>
          )}
          {invoices.length === 0 && expenses.length === 0 && (
            <div className="text-[11px] text-[var(--color-text-sub)]">承認済み申請がありません</div>
          )}
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
          自動添付:
          <ul className="ml-4 list-disc">
            {invoices.filter((s) => selectedInvoicePdfIds.has(s.id)).map((s) => (
              <li key={`i${s.id}`}>請求書 PDF（{s.user_display_name} {s.year}/{s.month} {CATEGORY_LABELS[s.category]}）</li>
            ))}
            {expenses.filter((s) => selectedExpensePdfIds.has(s.id)).map((s) => (
              <li key={`ep${s.id}`}>立替金 PDF（{s.user_display_name} {s.year}/{s.month} {CATEGORY_LABELS[s.category]}）</li>
            ))}
            {expenses.filter((s) => selectedExpenseXlsxIds.has(s.id)).map((s) => (
              <li key={`ex${s.id}`}>立替金 Excel（{s.user_display_name} {s.year}/{s.month} {CATEGORY_LABELS[s.category]}）</li>
            ))}
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
              {sending ? '送信中…' : `📧 一括送信 (${totalSelected} 件)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
