import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { Me } from '../lib/api'
import { fetchExportBlob } from '../components/FolderSaveButtons'

type Submission = {
  id: number
  user_id: number
  user_display_name: string
  year: number
  month: number
  category: string
  kind: 'invoice' | 'expense' | 'work_report'
  status: 'pending' | 'approved' | 'rejected'
  submitted_at: string | null
  reviewed_at: string | null
  note: string | null
  total_override: number | null
  default_total: number | null
  received_purchase_order_no: string | null
  received_purchase_order_subject: string | null
}

const CATEGORY_LABELS: Record<string, string> = {
  wings: 'Tama',
  living: 'タマリビング',
  techleaders: 'テックリーダーズ',
  resystems: 'REシステムズ',
}
const KIND_LABELS: Record<string, string> = {
  invoice: '請求書',
  expense: '立替金',
  work_report: '業務報告書',
}
const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
}

export default function InvoicesPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [items, setItems] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [filterKind, setFilterKind] = useState<'all' | 'invoice' | 'expense'>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [filterMonth, setFilterMonth] = useState<string>('') // YYYY-MM

  const load = async () => {
    setLoading(true)
    try {
      const [inv, exp] = await Promise.all([
        api.get<Submission[]>('/invoice_submissions', { params: { kind: 'invoice', status: 'all' } }),
        api.get<Submission[]>('/invoice_submissions', { params: { kind: 'expense', status: 'all' } }),
      ])
      setItems([...inv.data, ...exp.data])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    api.get<Me>('/me').then((r) => setMe(r.data)).catch(() => {})
    load().catch(() => {})
  }, [])

  const [busyId, setBusyId] = useState<string | null>(null)
  // プレビューモーダル
  const [previewSub, setPreviewSub] = useState<Submission | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  // 編集モーダル
  const [editingSub, setEditingSub] = useState<Submission | null>(null)
  const [editForm, setEditForm] = useState<{ note: string; total_override: string; subject_override: string }>({ note: '', total_override: '', subject_override: '' })
  const [editBusy, setEditBusy] = useState(false)

  const openPreview = async (s: Submission) => {
    setPreviewSub(s); setPreviewUrl(null); setPreviewLoading(true)
    try {
      const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
      const path = s.kind === 'expense' ? '/exports/expense.pdf' : '/exports/invoice.pdf'
      const params: Record<string, unknown> = { month: monthParam, category: s.category, as_user_id: s.user_id }
      if (s.status === 'approved') params.invoice_submission_id = s.id
      const { blob } = await fetchExportBlob(path, params, 'preview.pdf')
      setPreviewUrl(URL.createObjectURL(blob))
    } catch (e: any) {
      alert(`プレビュー失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
      setPreviewSub(null)
    } finally { setPreviewLoading(false) }
  }
  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null); setPreviewSub(null); setPreviewLoading(false)
  }

  const openEdit = (s: Submission) => {
    setEditingSub(s)
    setEditForm({
      note: s.note ?? '',
      total_override: s.total_override != null ? String(s.total_override) : '',
      subject_override: '',
    })
  }
  const closeEdit = () => { setEditingSub(null) }
  const saveEdit = async () => {
    if (!editingSub) return
    setEditBusy(true)
    try {
      await api.patch(`/invoice_submissions/${editingSub.id}`, {
        note: editForm.note,
        total_override: editForm.total_override.replace(/[^\d-]/g, ''),
        subject_override: editForm.subject_override,
      })
      await load()
      closeEdit()
    } catch (e: any) {
      alert(`保存失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setEditBusy(false) }
  }

  const downloadInvoice = async (s: Submission, target: 'self' | 'labop') => {
    setBusyId(`${s.kind}-${s.id}`)
    try {
      const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
      const path = s.kind === 'expense' ? '/exports/expense.pdf' : '/exports/invoice.pdf'
      const params: Record<string, unknown> = { month: monthParam, category: s.category }
      if (target === 'labop') params.invoice_submission_id = s.id
      else params.as_user_id = s.user_id
      const surname = (s.user_display_name ?? '').split(/[\s　]/)[0] ?? ''
      const kindLabel = s.kind === 'expense' ? '立替金' : '請求書'
      const targetSuffix = target === 'labop' ? '_株式会社ラボップ' : ''
      const filename = `${surname}_${kindLabel}_${s.year}年_${s.month}月分${targetSuffix}.pdf`
      const { blob, filename: fn } = await fetchExportBlob(path, params, filename)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(`DL失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setBusyId(null)
    }
  }

  const downloadExpenseXlsx = async (s: Submission, target: 'self' | 'labop') => {
    setBusyId(`${s.kind}-${s.id}-xlsx`)
    try {
      const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
      const params: Record<string, unknown> = { month: monthParam, category: s.category }
      if (target === 'labop') params.invoice_submission_id = s.id
      else params.as_user_id = s.user_id
      const surname = (s.user_display_name ?? '').split(/[\s　]/)[0] ?? ''
      const targetSuffix = target === 'labop' ? '_株式会社ラボップ' : ''
      const filename = `${surname}_立替金_${s.year}年_${s.month}月分${targetSuffix}.xlsx`
      const { blob, filename: fn } = await fetchExportBlob('/exports/expense.xlsx', params, filename)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(`DL失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setBusyId(null)
    }
  }

  const filtered = useMemo(() => {
    return items
      .filter((s) => filterKind === 'all' || s.kind === filterKind)
      .filter((s) => filterStatus === 'all' || s.status === filterStatus)
      .filter((s) => {
        if (!filterMonth) return true
        const ym = `${s.year}-${String(s.month).padStart(2, '0')}`
        return ym === filterMonth
      })
      .sort((a, b) => {
        const ka = `${a.year}-${String(a.month).padStart(2, '0')}-${a.kind}-${a.id}`
        const kb = `${b.year}-${String(b.month).padStart(2, '0')}-${b.kind}-${b.id}`
        return kb.localeCompare(ka)
      })
  }, [items, filterKind, filterStatus, filterMonth])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold tracking-tight">📄 請求書一覧</div>
          <div className="text-[11px] text-[var(--color-text-sub)]">
            {me?.admin ? '全ユーザーの請求書/立替金 申請' : '自分の請求書/立替金 申請'}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {(['all', 'invoice', 'expense'] as const).map((k) => (
            <button key={k} onClick={() => setFilterKind(k)}
              className={`rounded px-2 py-1 text-[11px] font-semibold ${filterKind === k ? 'bg-fuchsia-500 text-white' : 'bg-white border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>
              {k === 'all' ? '全種別' : KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(['all', 'pending', 'approved', 'rejected'] as const).map((s) => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`rounded px-2 py-1 text-[11px] font-semibold ${filterStatus === s ? 'bg-sky-500 text-white' : 'bg-white border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>
              {s === 'all' ? '全ステータス' : s === 'pending' ? '申請中' : s === 'approved' ? '承認済' : '却下'}
            </button>
          ))}
        </div>
        <input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
          className="rounded border border-[var(--color-border)] bg-white px-2 py-1 text-xs" />
        {filterMonth && <button onClick={() => setFilterMonth('')} className="text-[11px] text-[var(--color-text-sub)]">×</button>}
        <span className="ml-auto text-[11px] text-[var(--color-text-sub)]">
          {filtered.length} / {items.length} 件
        </span>
      </div>

      {loading ? (
        <div className="text-sm text-[var(--color-text-sub)]">読み込み中…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-[var(--color-text-sub)]">該当する申請がありません</div>
      ) : (
        <div className="glass rounded-xl shadow-md overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-[var(--color-text-sub)]">
              <tr>
                <th className="px-2 py-2 text-left">年月</th>
                <th className="px-2 py-2 text-left">種別</th>
                <th className="px-2 py-2 text-left">カテゴリ</th>
                <th className="px-2 py-2 text-left">申請者</th>
                <th className="px-2 py-2 text-left">発注番号</th>
                <th className="px-2 py-2 text-right">金額</th>
                <th className="px-2 py-2 text-center">ステータス</th>
                <th className="px-2 py-2 text-left">申請日時</th>
                <th className="px-2 py-2 text-center">DL</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const rowKey = `${s.kind}-${s.id}`
                const busyPdf = busyId === rowKey
                const busyXlsx = busyId === `${rowKey}-xlsx`
                const isApproved = s.status === 'approved'
                return (
                <tr key={rowKey} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-2 font-mono">{s.year}/{String(s.month).padStart(2, '0')}</td>
                  <td className="px-2 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${s.kind === 'invoice' ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {KIND_LABELS[s.kind]}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-[var(--color-text-sub)]">{CATEGORY_LABELS[s.category] ?? s.category}</td>
                  <td className="px-2 py-2 font-semibold">{s.user_display_name}</td>
                  <td className="px-2 py-2 font-mono text-[10px]">
                    {s.received_purchase_order_no ? (
                      <span title={s.received_purchase_order_subject ?? ''}>{s.received_purchase_order_no}</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">
                    {s.total_override != null ? `¥${s.total_override.toLocaleString()}` :
                     s.default_total != null ? `¥${s.default_total.toLocaleString()}` : '—'}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[s.status]}`}>
                      {s.status === 'pending' ? '申請中' : s.status === 'approved' ? '承認済' : '却下'}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-[10px] text-[var(--color-text-sub)]">
                    {s.submitted_at ? new Date(s.submitted_at).toLocaleString('ja-JP') : '—'}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <div className="flex gap-1 justify-center flex-wrap">
                      <button onClick={() => openPreview(s)}
                        className="rounded border border-sky-400 bg-white px-1.5 py-0.5 text-[10px] text-sky-600 hover:bg-sky-50" title="PDF を確認">
                        🔍
                      </button>
                      {me?.admin && (
                        <button onClick={() => openEdit(s)}
                          className="rounded border border-fuchsia-400 bg-white px-1.5 py-0.5 text-[10px] text-fuchsia-600 hover:bg-fuchsia-50" title="編集">
                          ✏️
                        </button>
                      )}
                      <button onClick={() => downloadInvoice(s, 'self')} disabled={busyPdf}
                        className="rounded border border-[var(--color-border)] bg-white px-1.5 py-0.5 text-[10px] hover:bg-gray-50 disabled:opacity-50" title="申請者ベースの PDF">
                        {busyPdf ? '…' : '📥 PDF'}
                      </button>
                      {s.kind === 'expense' && (
                        <button onClick={() => downloadExpenseXlsx(s, 'self')} disabled={busyXlsx}
                          className="rounded border border-[var(--color-border)] bg-white px-1.5 py-0.5 text-[10px] hover:bg-gray-50 disabled:opacity-50" title="申請者ベースの Excel">
                          {busyXlsx ? '…' : '📊 xlsx'}
                        </button>
                      )}
                      {isApproved && me?.admin && (
                        <button onClick={() => downloadInvoice(s, 'labop')} disabled={busyPdf}
                          className="rounded bg-gradient-to-r from-sky-500 to-indigo-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow disabled:opacity-50" title="ラボップ宛 PDF">
                          🏢 ラボップ
                        </button>
                      )}
                      {isApproved && me?.admin && s.kind === 'expense' && (
                        <button onClick={() => downloadExpenseXlsx(s, 'labop')} disabled={busyXlsx}
                          className="rounded bg-gradient-to-r from-emerald-500 to-teal-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow disabled:opacity-50" title="ラボップ宛 Excel">
                          🏢 xlsx
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* プレビューモーダル */}
      {previewSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closePreview}>
          <div className="w-full max-w-4xl h-[85vh] rounded-xl bg-white p-3 shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-sm font-semibold">🔍 {KIND_LABELS[previewSub.kind]} プレビュー</div>
                <div className="text-[11px] text-[var(--color-text-sub)]">
                  {previewSub.user_display_name} ／ {previewSub.year}年{previewSub.month}月（{CATEGORY_LABELS[previewSub.category]}）
                  {previewSub.received_purchase_order_no && <span className="ml-2 font-mono text-fuchsia-600">{previewSub.received_purchase_order_no}</span>}
                </div>
              </div>
              <button onClick={closePreview} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
            </div>
            <div className="flex-1 min-h-0 rounded border border-[var(--color-border)] overflow-hidden">
              {previewLoading && <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-sub)]">読込中…</div>}
              {!previewLoading && previewUrl && <iframe src={previewUrl} className="w-full h-full" title="preview" />}
              {!previewLoading && !previewUrl && <div className="h-full flex items-center justify-center text-sm text-red-500">取得できませんでした</div>}
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <button onClick={() => downloadInvoice(previewSub, 'self')}
                className="rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs">📥 申請者ベースで DL</button>
              {me?.admin && previewSub.status === 'approved' && (
                <button onClick={() => downloadInvoice(previewSub, 'labop')}
                  className="rounded-md whitespace-nowrap bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-1.5 text-xs font-semibold text-white">📥 ラボップ宛で DL</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 編集モーダル */}
      {editingSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeEdit}>
          <div className="w-full max-w-xl rounded-xl bg-white p-4 shadow-xl space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">✏️ {KIND_LABELS[editingSub.kind]} を編集</div>
              <button onClick={closeEdit} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
            </div>
            <div className="text-[11px] text-[var(--color-text-sub)]">
              {editingSub.user_display_name} ／ {editingSub.year}年{editingSub.month}月（{CATEGORY_LABELS[editingSub.category]}）
              {editingSub.received_purchase_order_no && <span className="ml-2 font-mono text-fuchsia-600">{editingSub.received_purchase_order_no}</span>}
            </div>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">備考（発注番号や補足）</div>
              <textarea value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                rows={3} className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-xs"
                placeholder="ORD-010014 / タマリビング案件 西野・川村" />
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">税込合計（ラボップ宛上書き）</div>
              <input type="text" inputMode="numeric" value={editForm.total_override}
                onChange={(e) => setEditForm({ ...editForm, total_override: e.target.value })}
                placeholder="例: 330000 / マイナス値も可（相殺）"
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm font-mono" />
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">件名 上書き（任意）</div>
              <input value={editForm.subject_override} onChange={(e) => setEditForm({ ...editForm, subject_override: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
            </label>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button onClick={closeEdit} className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs">キャンセル</button>
              <button onClick={saveEdit} disabled={editBusy}
                className="rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
                {editBusy ? '保存中…' : '💾 保存'}
              </button>
            </div>
            <div className="text-[10px] text-[var(--color-text-sub)] pt-1">
              ※ 保存後は新しい PDF が再生成されます。「PDF 上で直接編集」は次フェーズ実装予定。
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
