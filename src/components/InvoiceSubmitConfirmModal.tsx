import { useEffect, useState } from 'react'
import { api } from './../lib/api'

type Row = {
  category: string  // 'wings' | 'living'
  kind: 'invoice' | 'expense'
  label: string     // 表示用 "Tama 請求書" 等
  amount: number    // 税込
  willSkip: boolean // 金額/工数 0 のため添付スキップ
  note: string      // 内訳メモ ("160h × ¥3,250 等" や "稼働 0h")
}

type Props = {
  year: number
  month: number
  // 'bulk' = 4件まとめて / 'single' = 1件のみ
  mode: 'bulk' | 'single'
  // single 時の対象 (mode='single' のみ)
  singleCategory?: string
  singleKind?: 'invoice' | 'expense'
  onConfirm: () => Promise<void> | void
  onClose: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  wings: 'Tama',
  living: 'リビング',
}
const KIND_LABELS: Record<string, string> = {
  invoice: '請求書',
  expense: '立替金',
}

const fmtYen = (n: number) => `¥${n.toLocaleString()}`

export default function InvoiceSubmitConfirmModal({ year, month, mode, singleCategory, singleKind, onConfirm, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void load()
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [])

  const load = async () => {
    setLoading(true); setErr(null)
    try {
      const targets: Array<{ category: string; kind: 'invoice' | 'expense' }> = mode === 'bulk'
        ? [
            { category: 'wings',  kind: 'invoice' },
            { category: 'wings',  kind: 'expense' },
            { category: 'living', kind: 'invoice' },
            { category: 'living', kind: 'expense' },
          ]
        : [{ category: singleCategory ?? 'wings', kind: singleKind ?? 'invoice' }]

      const monthParam = `${year}-${String(month).padStart(2, '0')}`

      // invoice total: /invoice_preview?month=YYYY-MM&category=cat → { total: 税込合計 }
      // expense total: /expenses?month=YYYY-MM → 全 expense を返す。category で絞り込んで合計
      // work_reports for hours: /work_reports?month=YYYY-MM → category で絞り込んで合計
      const uniqueCats = Array.from(new Set(targets.map((t) => t.category)))
      const invoicePreviews: Record<string, number> = {}
      await Promise.all(uniqueCats.map(async (cat) => {
        try {
          const r = await api.get<{ total: number }>('/invoice_preview', { params: { month: monthParam, category: cat } })
          invoicePreviews[cat] = r.data.total ?? 0
        } catch {
          invoicePreviews[cat] = 0
        }
      }))

      const expRes = await api.get<{ expenses: Array<{ category: string | null; amount: number; company_burden?: boolean }> }>('/expenses', { params: { month: monthParam } })
      const expensesByCategory: Record<string, number> = {}
      ;(expRes.data?.expenses ?? []).forEach((e) => {
        if (!e.category) return
        if (e.company_burden === false) return
        expensesByCategory[e.category] = (expensesByCategory[e.category] ?? 0) + (e.amount ?? 0)
      })

      const wrRes = await api.get<{ reports: Array<{ category: string | null; hours: number | null }> }>('/work_reports', { params: { month: monthParam } })
      const hoursByCategory: Record<string, number> = {}
      ;(wrRes.data?.reports ?? []).forEach((r) => {
        if (!r.category) return
        hoursByCategory[r.category] = (hoursByCategory[r.category] ?? 0) + (r.hours ?? 0)
      })

      const out: Row[] = targets.map((t) => {
        const catLabel = CATEGORY_LABELS[t.category] ?? t.category
        const kindLabel = KIND_LABELS[t.kind] ?? t.kind
        const amount = t.kind === 'invoice' ? (invoicePreviews[t.category] ?? 0) : (expensesByCategory[t.category] ?? 0)
        const hours = hoursByCategory[t.category] ?? 0
        const willSkip = amount <= 0
        const note = t.kind === 'invoice'
          ? `稼働 ${hours.toFixed(1)}h`
          : `expense ${(expensesByCategory[t.category] !== undefined ? '対象あり' : '0件')}`
        return {
          category: t.category, kind: t.kind,
          label: `${catLabel} ${kindLabel}`,
          amount, willSkip, note,
        }
      })

      setRows(out)
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? e?.message ?? '取得失敗')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async () => {
    setSubmitting(true); setErr(null)
    try {
      await onConfirm()
      onClose()
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? e?.message ?? '申請失敗')
    } finally {
      setSubmitting(false)
    }
  }

  const willSendCount = rows.filter((r) => !r.willSkip).length
  const skipCount = rows.filter((r) => r.willSkip).length
  const grandTotal = rows.reduce((acc, r) => acc + (r.willSkip ? 0 : r.amount), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="text-sm font-semibold text-[var(--color-text)]">
              {mode === 'bulk' ? '🚀 一括申請の確認' : '📤 申請の確認'}
            </div>
            <div className="text-[11px] text-[var(--color-text-sub)]">
              {year}年{month}月分 — 内容を確認して「申請する」を押してください
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
        </div>

        {loading ? (
          <div className="text-[11px] text-[var(--color-text-sub)] py-4 text-center">金額を取得中…</div>
        ) : (
          <>
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-[var(--color-text-sub)]">
                <tr>
                  <th className="px-2 py-1 text-left">対象</th>
                  <th className="px-2 py-1 text-right">申請金額(税込)</th>
                  <th className="px-2 py-1 text-left">備考</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={`border-t border-[var(--color-border)] ${r.willSkip ? 'bg-amber-50/50' : ''}`}>
                    <td className="px-2 py-1.5">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] mr-1 ${r.kind === 'invoice' ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {r.kind === 'invoice' ? '請求書' : '立替金'}
                      </span>
                      {r.label.replace(/(請求書|立替金)$/, '')}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {r.willSkip ? <span className="text-amber-600">{fmtYen(r.amount)} (スキップ)</span> : fmtYen(r.amount)}
                    </td>
                    <td className="px-2 py-1.5 text-[10px] text-[var(--color-text-sub)]">
                      {r.willSkip ? '⚠ 0円のため添付されません' : r.note}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-fuchsia-50">
                  <td className="px-2 py-1.5 font-semibold">送信合計</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold text-fuchsia-700">{fmtYen(grandTotal)}</td>
                  <td className="px-2 py-1.5 text-[10px] text-[var(--color-text-sub)]">
                    送信 {willSendCount} 件{skipCount > 0 ? ` / スキップ ${skipCount} 件` : ''}
                  </td>
                </tr>
              </tfoot>
            </table>
            <div className="mt-2 text-[10px] text-[var(--color-text-sub)] bg-gray-50 rounded px-2 py-1.5">
              ※ 0円のものはメール添付・通知から自動でスキップされます（記録は残ります）。
            </div>
          </>
        )}

        {err && <div className="mt-2 text-[11px] text-red-500">{err}</div>}

        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} disabled={submitting}
            className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text-sub)] hover:bg-gray-50 disabled:opacity-50">
            キャンセル
          </button>
          <button onClick={handleConfirm} disabled={loading || submitting || rows.length === 0}
            className="rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-4 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
            {submitting ? '送信中…' : '✅ これで申請する'}
          </button>
        </div>
      </div>
    </div>
  )
}
