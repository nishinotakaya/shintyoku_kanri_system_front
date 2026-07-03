import { useEffect, useImperativeHandle, useState, forwardRef } from 'react'
import { api } from '../lib/api'
import InvoiceItemsEditor, { applyInvoiceItemPatch, emptyInvoiceItem, type InvoiceItem as ItemRow } from './InvoiceItemsEditor'

// カテゴリ別の税率（ラボップ系=10% / resystems・techleaders=0%）
const taxRateFor = (category: string) => (category === 'resystems' || category === 'techleaders' ? 0 : 10)

type Props = {
  submissionId: number
  userDisplayName: string
  /** 明細から計算した税込合計を親に通知（統合モーダルの合計表示用） */
  onTotalChange?: (submissionId: number, total: number) => void
}

export type InvoiceSubmissionEditorHandle = {
  save: () => Promise<void>
}

const InvoiceSubmissionEditor = forwardRef<InvoiceSubmissionEditorHandle, Props>(({ submissionId, userDisplayName, onTotalChange }, ref) => {
  const [form, setForm] = useState<{ note: string; total_override: string; subject_override: string; items: ItemRow[] }>(
    { note: '', total_override: '', subject_override: '', items: [] }
  )
  const [category, setCategory] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true); setMsg(null)
    try {
      const r = await api.get<any[]>('/invoice_submissions', { params: { kind: 'invoice', status: 'all' } })
      const detail = r.data.find((x: any) => x.id === submissionId)
      if (!detail) throw new Error('元の申請が見つかりませんでした')
      const items: ItemRow[] = (detail.items_override && detail.items_override.length > 0 ? detail.items_override : (detail.default_items ?? [])) as ItemRow[]
      setCategory(detail.category ?? '')
      setForm({
        note: detail.note ?? '',
        total_override: detail.total_override != null ? String(detail.total_override) : '',
        subject_override: detail.subject_override ?? detail.default_subject ?? '',
        items: items.length > 0 ? items : [],
      })
    } catch (e: any) {
      setMsg(`読込失敗: ${e?.message ?? ''}`)
    } finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [submissionId])

  // 明細の金額から税込合計を自動計算して「税込合計」へ反映（手入力で消えない／毎回計算）
  const subtotal = form.items.reduce((acc, it) => acc + (Number(it.amount) || 0), 0)
  const taxRate = taxRateFor(category)
  const computedTotal = subtotal + Math.round(subtotal * taxRate / 100)
  useEffect(() => {
    if (form.items.length === 0) return
    setForm((p) => (p.total_override === String(computedTotal) ? p : { ...p, total_override: String(computedTotal) }))
  }, [computedTotal, form.items.length])
  // 親(統合モーダル)へ税込合計を通知
  useEffect(() => { onTotalChange?.(submissionId, Number(form.total_override) || 0) }, [form.total_override, submissionId])

  const updateItem = (index: number, patch: Partial<ItemRow>) => setForm((p) => ({ ...p, items: applyInvoiceItemPatch(p.items, index, patch) }))
  const addItem = () => setForm((p) => ({ ...p, items: [...p.items, emptyInvoiceItem()] }))
  const removeItem = (index: number) => setForm((p) => ({ ...p, items: p.items.filter((_, idx) => idx !== index) }))

  const save = async () => {
    setSaving(true); setMsg(null)
    try {
      const payload: Record<string, unknown> = {
        note: form.note,
        total_override: form.total_override.replace(/[^\d-]/g, ''),
        subject_override: form.subject_override,
      }
      const itemsClean = form.items.filter((it) => it.label.trim() !== '' || it.amount > 0)
      if (itemsClean.length > 0) {
        payload.items_override = itemsClean.map((it) => ({
          label: it.label, qty: Number(it.qty) || 0, unit: it.unit || '式',
          unit_price: Number(it.unit_price) || 0, amount: Number(it.amount) || 0,
        }))
      }
      await api.patch(`/invoice_submissions/${submissionId}`, payload)
      setMsg('✅ 保存')
    } catch (e: any) { setMsg(`保存失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`); throw e }
    finally { setSaving(false) }
  }

  useImperativeHandle(ref, () => ({ save }), [form, submissionId])

  if (loading) return <div className="text-[11px] text-[var(--color-text-sub)]">読込中…</div>

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-sky-50/30 p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold text-sky-700">👤 {userDisplayName}（申請 #{submissionId}）</div>
        <button onClick={save} disabled={saving}
          className="rounded bg-gradient-to-r from-sky-500 to-indigo-500 px-2 py-0.5 text-[11px] font-semibold text-white shadow disabled:opacity-50">
          {saving ? '保存中…' : '💾 この申請を保存'}
        </button>
      </div>
      <div className="grid grid-cols-12 gap-1.5">
        <label className="col-span-7"><div className="text-[10px] mb-0.5">件名 上書き</div>
          <input value={form.subject_override} onChange={(e) => setForm({ ...form, subject_override: e.target.value })}
            className="w-full px-1 py-0.5 text-[11px] border rounded" /></label>
        <label className="col-span-5"><div className="text-[10px] mb-0.5">税込合計{form.items.length > 0 ? '（明細から自動）' : ' 上書き'}</div>
          <input type="text" inputMode="numeric" value={form.total_override}
            readOnly={form.items.length > 0}
            onChange={(e) => setForm({ ...form, total_override: e.target.value.replace(/[^\d-]/g, '') })}
            className={`w-full px-1 py-0.5 text-[11px] text-right border rounded font-mono ${form.items.length > 0 ? 'bg-slate-50 text-slate-600' : ''}`} /></label>
      </div>
      <label className="block"><div className="text-[10px] mb-0.5">備考</div>
        <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
          className="w-full px-1 py-0.5 text-[11px] border rounded" /></label>
      <InvoiceItemsEditor
        items={form.items}
        category={category}
        onUpdate={updateItem}
        onAdd={addItem}
        onRemove={removeItem}
      />
      {msg && <div className={`text-[11px] ${msg.includes('失敗') ? 'text-red-500' : 'text-emerald-600'}`}>{msg}</div>}
    </div>
  )
})

InvoiceSubmissionEditor.displayName = 'InvoiceSubmissionEditor'
export default InvoiceSubmissionEditor
