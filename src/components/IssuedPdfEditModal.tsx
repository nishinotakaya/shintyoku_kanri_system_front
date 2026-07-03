import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import ExpenseEditList from './ExpenseEditList'
import PurchaseOrderSelect from './PurchaseOrderSelect'
import InvoiceItemsEditor, { applyInvoiceItemPatch, emptyInvoiceItem, type InvoiceItem as ItemRow } from './InvoiceItemsEditor'
import { LabeledField, fieldInputCls } from './InvoiceFormFields'

type IssuedPdf = {
  id: number
  kind: 'invoice' | 'expense'
  file_format: 'pdf' | 'xlsx'
  year: number | null
  month: number | null
  category: string | null
  source_submission_ids: number[]
  filename: string
  total_amount: number | null
  purchase_order_no?: string | null
  application_date?: string | null
  items?: ItemRow[]
}

type Submission = {
  id: number
  user_id: number
  user_display_name: string | null
  year: number
  month: number
  category: string
  kind: 'invoice' | 'expense'
}

type Props = {
  issued: IssuedPdf
  onClose: () => void
  onSaved: () => void
}

export default function IssuedPdfEditModal({ issued, onClose, onSaved }: Props) {
  const [subs, setSubs] = useState<Submission[]>([])
  const [items, setItems] = useState<ItemRow[]>(issued.items ?? [])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [poNo, setPoNo] = useState<string>(issued.purchase_order_no ?? '')
  const [applicationDate, setApplicationDate] = useState<string>((issued.application_date ?? '').slice(0, 10))

  useEffect(() => { setItems(issued.items ?? []) }, [issued.id, issued.items])
  useEffect(() => { setApplicationDate((issued.application_date ?? '').slice(0, 10)) }, [issued.id, issued.application_date])

  // 立替金の編集だけは従来どおり対象申請を取得（請求書は統合PDF自身の明細を編集する）
  useEffect(() => {
    if (issued.kind !== 'expense') return
    void (async () => {
      try {
        const r = await api.get<Submission[]>('/invoice_submissions', { params: { kind: issued.kind, status: 'all' } })
        setSubs((r.data ?? []).filter((s) => issued.source_submission_ids.includes(s.id)))
      } catch (e: any) {
        setMsg(`元の申請を取得できませんでした: ${e?.message ?? ''}`)
      }
    })()
  }, [issued.id, issued.kind, issued.source_submission_ids])

  const uniqueUserSubs = useMemo(() => {
    const seen = new Set<number>()
    return subs.filter((s) => { if (seen.has(s.user_id)) return false; seen.add(s.user_id); return true })
  }, [subs])

  const updateItem = (index: number, patch: Partial<ItemRow>) => setItems((p) => applyInvoiceItemPatch(p, index, patch))
  const addItem = () => setItems((p) => [...p, emptyInvoiceItem()])
  const removeItem = (index: number) => setItems((p) => p.filter((_, idx) => idx !== index))

  const regenerate = async () => {
    setBusy(true); setMsg(null)
    try {
      if (issued.kind === 'invoice') {
        // 注文番号・編集明細(items_override)を統合PDFの再生成リクエストに同梱する。
        // purchase_order_no を渡すことでバックエンドが手入力値を最優先で採用し、
        // 再生成時に元申請の値で上書き（＝手入力POが消える不具合）されないようにする。
        // 元申請(invoice_submissions)は一切書き換えず、この統合PDFだけ更新される。
        await api.post('/exports/merged_invoice.pdf', {
          invoice_submission_ids: issued.source_submission_ids,
          items_override: items.filter((it) => it.label.trim() !== '' || it.amount !== 0),
          purchase_order_no: poNo,
          application_date: applicationDate || null,
          save: 1,
          replace_issued_id: issued.id,
        }, { responseType: 'blob' })
      } else {
        const fd = new FormData()
        issued.source_submission_ids.forEach((id) => fd.append('expense_submission_ids[]', String(id)))
        fd.append('save', '1')
        fd.append('replace_issued_id', String(issued.id))
        const path = issued.file_format === 'xlsx' ? '/exports/merged_expense.xlsx' : '/exports/merged_expense.pdf'
        await api.post(path, fd, { responseType: 'blob' })
      }
      setMsg('✅ 再生成して保存しました')
      onSaved()
    } catch (e: any) {
      setMsg(`再生成失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-xl bg-white p-4 shadow-xl space-y-2">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-semibold">✏️ 保存済 統合 {issued.kind === 'expense' ? '立替金' : '請求書'} を編集</div>
            <div className="text-[11px] text-[var(--color-text-sub)]">{issued.filename}</div>
            <div className="text-[10px] text-emerald-600">この統合PDFだけを編集します（元の各請求書は変更されません）</div>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
        </div>

        {issued.kind === 'invoice' && (
          <div className="grid grid-cols-12 gap-2">
            <LabeledField className="col-span-8" label="注文番号" hint="PDF 備考に「注文番号 / 件名 / 期限」を出力">
              <PurchaseOrderSelect value={poNo} onChange={setPoNo} category={issued.category} placeholder="ORD-010014（検索して選択 / 手入力も可）" />
            </LabeledField>
            <LabeledField className="col-span-4" label="申請日" hint="空欄で月設定の既定日">
              <input type="date" value={applicationDate} onChange={(e) => setApplicationDate(e.target.value)} className={fieldInputCls} />
            </LabeledField>
          </div>
        )}

        {issued.kind === 'expense' && uniqueUserSubs.map((s) => (
          <div key={s.id} className="space-y-1">
            <div className="text-[11px] font-semibold text-emerald-700">👤 {s.user_display_name}（申請 #{s.id}）</div>
            <ExpenseEditList submissionUserId={s.user_id} year={s.year} month={s.month} category={s.category} />
          </div>
        ))}

        {issued.kind === 'invoice' && (
          <InvoiceItemsEditor items={items} category={issued.category ?? ''}
            onUpdate={updateItem} onAdd={addItem} onRemove={removeItem} />
        )}

        <div className="flex justify-between items-center gap-2 pt-2 border-t">
          <span className={`text-[11px] ${msg?.includes('失敗') ? 'text-red-500' : 'text-emerald-600'}`}>{msg ?? ''}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs">閉じる</button>
            <button onClick={regenerate} disabled={busy}
              className="rounded-md bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
              {busy ? '再生成中…' : '🔄 再生成して上書き保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
