import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Me } from '../lib/api'

type PO = {
  id: number
  user_id: number
  user_display_name: string | null
  order_no: string
  customer_name: string | null
  category: string | null
  subject: string | null
  period_start: string | null
  period_end: string | null
  total_amount: number | null
  note: string | null
  file_url: string | null
  invoice_submission_count: number
}

type PickableUser = { id: number; display_name: string; email: string; admin: boolean }

const CATEGORY_LABELS: Record<string, string> = {
  wings: 'Wings (タマ)',
  living: 'タマリビング',
  techleaders: 'テックリーダーズ',
  resystems: 'REシステムズ',
}

export default function PurchaseOrdersPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [items, setItems] = useState<PO[]>([])
  const [users, setUsers] = useState<PickableUser[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<PO> | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const isAdmin = !!me?.admin

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get<PO[]>('/received_purchase_orders')
      setItems(r.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    api.get<Me>('/me').then((r) => setMe(r.data)).catch(() => {})
    load().catch(() => {})
    api.get<PickableUser[]>('/users/pickable').then((r) => setUsers(r.data)).catch(() => {})
  }, [])

  const startNew = () => setEditing({
    user_id: me?.id, order_no: '', customer_name: '', category: 'wings', subject: '',
    period_start: '', period_end: '', total_amount: null, note: '', file_url: '',
  })
  const startEdit = (po: PO) => setEditing({ ...po })
  const cancel = () => { setEditing(null); setMsg(null) }

  const save = async () => {
    if (!editing) return
    if (!editing.order_no?.trim()) { setMsg('発注番号を入力してください'); return }
    setBusy(true); setMsg(null)
    try {
      const payload = {
        order_no: editing.order_no,
        customer_name: editing.customer_name,
        category: editing.category,
        subject: editing.subject,
        period_start: editing.period_start || null,
        period_end: editing.period_end || null,
        total_amount: editing.total_amount,
        note: editing.note,
        file_url: editing.file_url,
        user_id: editing.user_id,
      }
      if (editing.id) {
        await api.patch(`/received_purchase_orders/${editing.id}`, payload)
      } else {
        await api.post('/received_purchase_orders', payload)
      }
      setMsg('保存しました')
      setEditing(null)
      await load()
    } catch (e: any) {
      setMsg(`保存失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setBusy(false) }
  }

  const remove = async (po: PO) => {
    if (!confirm(`${po.order_no} を削除しますか？`)) return
    setBusy(true)
    try {
      await api.delete(`/received_purchase_orders/${po.id}`)
      await load()
    } catch (e: any) {
      alert(`削除失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold tracking-tight">📋 注文書一覧</div>
          <div className="text-[11px] text-[var(--color-text-sub)]">
            ラボップから受領した注文書を管理。請求書は注文書ごとに紐付けて発行
          </div>
        </div>
        {isAdmin && (
          <button onClick={startNew}
            className="rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-1.5 text-xs font-semibold text-white shadow">
            ＋ 新規追加
          </button>
        )}
      </div>

      {msg && <div className={`text-[11px] ${msg.includes('失敗') ? 'text-red-500' : 'text-emerald-600'}`}>{msg}</div>}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={cancel}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-auto rounded-xl bg-white p-4 shadow-xl space-y-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">{editing.id ? '📋 注文書を編集' : '📋 注文書を新規追加'}</div>
            <button onClick={cancel} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">発注番号 *</div>
              <input value={editing.order_no ?? ''} onChange={(e) => setEditing({ ...editing, order_no: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="ORD-010014" />
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">案件名</div>
              <input value={editing.subject ?? ''} onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="タマリビング様新ISN基幹システム開発" />
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">受注者</div>
              <select value={editing.user_id ?? me?.id ?? ''} onChange={(e) => setEditing({ ...editing, user_id: Number(e.target.value) })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm">
                {users.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
              </select>
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">カテゴリ</div>
              <select value={editing.category ?? 'wings'} onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm">
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">顧客</div>
              <input value={editing.customer_name ?? ''} onChange={(e) => setEditing({ ...editing, customer_name: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="タマホーム" />
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">金額（税込）</div>
              <input type="number" value={editing.total_amount ?? ''}
                onChange={(e) => setEditing({ ...editing, total_amount: e.target.value === '' ? null : Number(e.target.value) })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">期間 開始</div>
              <input type="date" value={editing.period_start ?? ''} onChange={(e) => setEditing({ ...editing, period_start: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">期間 終了</div>
              <input type="date" value={editing.period_end ?? ''} onChange={(e) => setEditing({ ...editing, period_end: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
            </label>
            <label className="block col-span-2">
              <div className="text-[11px] font-semibold mb-0.5">注文書 PDF URL（Google Drive 等）</div>
              <input value={editing.file_url ?? ''} onChange={(e) => setEditing({ ...editing, file_url: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="https://drive.google.com/file/..." />
            </label>
            <label className="block col-span-2">
              <div className="text-[11px] font-semibold mb-0.5">備考（注文書の特記事項。例: ※シェアラウンジ回数券（押上5回分）支給）</div>
              <textarea value={editing.note ?? ''} onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                rows={2} className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
            <button onClick={cancel} className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs">キャンセル</button>
            <button onClick={save} disabled={busy}
              className="rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
              {busy ? '保存中…' : '💾 保存'}
            </button>
          </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-[var(--color-text-sub)]">読み込み中…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-[var(--color-text-sub)]">注文書が登録されていません</div>
      ) : (
        <div className="glass rounded-xl shadow-md overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-[var(--color-text-sub)]">
              <tr>
                <th className="px-2 py-2 text-left">発注番号</th>
                <th className="px-2 py-2 text-left">受注者</th>
                <th className="px-2 py-2 text-left">案件名</th>
                <th className="px-2 py-2 text-left">期間</th>
                <th className="px-2 py-2 text-right">金額</th>
                <th className="px-2 py-2 text-center">紐付請求書</th>
                <th className="px-2 py-2 text-center">PDF</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((po) => (
                <tr key={po.id} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-2 font-mono font-semibold">{po.order_no}</td>
                  <td className="px-2 py-2">{po.user_display_name ?? '—'}</td>
                  <td className="px-2 py-2">{po.subject ?? '—'}</td>
                  <td className="px-2 py-2 text-[10px] text-[var(--color-text-sub)]">
                    {po.period_start ?? '—'} 〜 {po.period_end ?? '—'}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">
                    {po.total_amount ? `¥${po.total_amount.toLocaleString()}` : '—'}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${po.invoice_submission_count > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {po.invoice_submission_count}件
                    </span>
                  </td>
                  <td className="px-2 py-2 text-center">
                    {po.file_url ? <a href={po.file_url} target="_blank" rel="noreferrer" className="text-fuchsia-500 hover:underline">📎 開く</a> : '—'}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {isAdmin && (
                      <>
                        <button onClick={() => startEdit(po)} className="text-fuchsia-500 hover:text-fuchsia-400 mr-2">編集</button>
                        <button onClick={() => remove(po)} className="text-gray-400 hover:text-red-500">🗑</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
