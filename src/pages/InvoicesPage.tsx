import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { Me } from '../lib/api'

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
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={`${s.kind}-${s.id}`} className="border-t border-[var(--color-border)]">
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
