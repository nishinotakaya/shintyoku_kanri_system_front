import { useState } from 'react'
import { api } from '../lib/api'

type Props = {
  ids: number[]
  currentPo: string | null
  kind: 'merged_expense' | 'merged_invoice'
  onClose: () => void
  onSaved: () => void
}

export default function MergedRowEditModal({ ids, currentPo, kind, onClose, onSaved }: Props) {
  const [poNo, setPoNo] = useState<string>(currentPo ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      await Promise.all(ids.map((id) => api.patch(`/invoice_submissions/${id}`, { purchase_order_no_override: poNo })))
      onSaved()
    } catch (e: any) {
      setMsg(`保存失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl space-y-2">
        <div className="flex items-start justify-between">
          <div className="text-sm font-semibold">✏️ 統合 {kind === 'merged_expense' ? '立替金' : '請求書'} の注文番号を一括上書き</div>
          <button onClick={onClose} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
        </div>
        <div className="text-[10px] text-[var(--color-text-sub)]">対象申請 ID: {ids.join(', ')}</div>
        <label className="block">
          <div className="text-[11px] font-semibold mb-0.5">注文番号</div>
          <input value={poNo} onChange={(e) => setPoNo(e.target.value)}
            placeholder="ORD-010014"
            className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm font-mono" />
        </label>
        {msg && <div className={`text-[11px] ${msg.includes('失敗') ? 'text-red-500' : 'text-emerald-600'}`}>{msg}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button onClick={onClose} className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs">キャンセル</button>
          <button onClick={save} disabled={busy}
            className="rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
            {busy ? '保存中…' : '💾 一括保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
