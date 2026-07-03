import { useState } from 'react'
import { api } from '../lib/api'

export type ScannedInvoice = {
  id: number
  original_filename: string | null
  partner_name: string | null
  subject: string | null
  subtotal_amount: number | null
  tax_amount: number | null
  total_amount: number | null
  issue_date: string | null
  due_date: string | null
  invoice_number: string | null
  status: 'pending' | 'confirmed' | 'rejected'
  freee_deal_id: string | null
  freee_reported_at: string | null
  has_pdf?: boolean
  pdf_url?: string | null
}

// D&D アップロードゾーンのみ。取り込み結果は親 (請求書一覧) に通知して、
// 一覧テーブル内に統合表示してもらう。
export default function ScannedInvoiceUploader({ onUploaded }: { onUploaded?: (rec: ScannedInvoice) => void }) {
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const upload = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
    if (arr.length === 0) {
      setMsg('PDF ファイルをドロップしてください')
      return
    }
    for (const file of arr) {
      setBusy(file.name)
      setMsg(null)
      try {
        const form = new FormData()
        form.append('file', file)
        const r = await api.post<ScannedInvoice>('/scanned_invoices', form, {
          headers: { 'content-type': 'multipart/form-data' },
        })
        onUploaded?.(r.data)
        setMsg(`✅ ${file.name} を読み取りました`)
      } catch (e: unknown) {
        const err = e as { response?: { data?: { error?: string } } }
        setMsg(`❌ ${file.name}: ${err?.response?.data?.error ?? 'OCR 失敗'}`)
      }
    }
    setBusy(null)
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragging(false)
          if (e.dataTransfer.files.length > 0) upload(e.dataTransfer.files)
        }}
        className={`rounded-xl border-2 border-dashed px-4 py-3 text-center transition-colors ${dragging ? 'border-fuchsia-500 bg-fuchsia-50' : 'border-[var(--color-border)] bg-white'}`}
      >
        <span className="text-sm font-semibold text-[var(--color-text)]">📥 請求書 PDF をドラッグ＆ドロップ</span>
        <span className="ml-2 text-[10px] text-[var(--color-text-sub)]">(AI で金額・日付・取引先を自動抽出して一覧に追加)</span>
        <label className="ml-3 inline-block cursor-pointer rounded bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-3 py-1 text-[11px] font-semibold text-white shadow">
          ファイルを選択
          <input type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
        </label>
        {busy && <span className="ml-2 text-[10px] text-[var(--color-text-sub)]">処理中: {busy}…</span>}
      </div>
      {msg && (
        <div className={`mt-1 rounded px-2 py-1 text-[11px] ${msg.startsWith('✅') ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>{msg}</div>
      )}
    </div>
  )
}
