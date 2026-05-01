import { useMemo, useState } from 'react'
import type { Expense, WorkReport } from '../lib/api'
import { api } from '../lib/api'
import FolderSaveButtons, { fetchExportBlob } from './FolderSaveButtons'

const CATEGORIES = [
  { key: 'wings', label: 'Wings' },
  { key: 'living', label: 'リビング勤怠' },
] as const
type CategoryKey = (typeof CATEGORIES)[number]['key']

export default function ExpenseTable({
  year,
  month,
  expenses,
  reports,
  category = 'wings',
  onPdfDownloaded,
}: {
  year: number
  month: number
  expenses: Expense[]
  reports: WorkReport[]
  category?: string
  onPdfDownloaded?: () => void
}) {
  const mp = `${year}-${String(month).padStart(2, '0')}`

  // 業務報告の交通費合計（カテゴリ別）
  const transitTotal = useMemo(() => {
    return reports
      .filter((r) => (r.category ?? 'wings') === category)
      .reduce((s, r) => s + (r.transit_fee ?? 0), 0)
  }, [reports, category])

  // 立替金の合計
  const expenseTotal = useMemo(() => {
    return expenses
      .filter((e) => (e.category ?? 'wings') === category)
      .reduce((s, e) => s + (e.amount || 0), 0)
  }, [expenses, category])

  const transitCount = reports.filter((r) => (r.category ?? 'wings') === category && r.transit_fee).length

  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => (e.category ?? 'wings') === category)
      .sort((a, b) => a.expense_date.localeCompare(b.expense_date))
  }, [expenses, category])

  const [showList, setShowList] = useState(false)
  const [updating, setUpdating] = useState<number | null>(null)

  const toggleCompanyBurden = async (expense: Expense) => {
    setUpdating(expense.id)
    try {
      await api.patch(`/expenses/${expense.id}`, { company_burden: !(expense.company_burden ?? true) })
      // ローカル state は親で再フェッチされる想定。expenses を直接書き換えできないので reload を期待
      window.dispatchEvent(new Event('focus')) // hint to react-query refetch
    } finally {
      setUpdating(null)
    }
  }

  return (
    <div className="glass rounded-2xl px-4 py-3 shadow-md">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-[var(--color-text)]">立替金 — {year}年 {month}月分</div>
          <div className="text-[11px] text-[var(--color-text-sub)]">※ 業務報告の乗車区間・交通費から自動計算</div>
        </div>
        <div className="flex flex-col gap-1 items-end">
          <FolderSaveButtons
            label="立替金Excel"
            monthFolderName={`${month}月`}
            fetchSpec={async () => {
              const fallback = `立替金_${year}年_${month}月分.xlsx`
              const { blob, filename } = await fetchExportBlob('/exports/expense.xlsx', { month: mp, category }, fallback)
              return { blob, filename, monthFolderName: `${month}月` }
            }}
          />
          <FolderSaveButtons
            label="立替金PDF"
            monthFolderName={`${month}月`}
            fetchSpec={async () => {
              const fallback = `立替金_${year}年_${month}月分.pdf`
              const { blob, filename } = await fetchExportBlob('/exports/expense.pdf', { month: mp, category }, fallback)
              return { blob, filename, monthFolderName: `${month}月` }
            }}
            onDownloaded={onPdfDownloaded}
          />
        </div>
      </div>

      <div className="mt-1.5 flex items-baseline justify-between">
        <span className="text-xs text-[var(--color-text-sub)]">交通費 {transitCount} 日分 ／ 立替金 {filteredExpenses.length} 件</span>
        <div className="font-mono tabular-nums text-lg text-amber-600">¥{(transitTotal + expenseTotal).toLocaleString()}</div>
      </div>

      {filteredExpenses.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setShowList((v) => !v)}
            className="text-[11px] text-fuchsia-500 hover:text-fuchsia-400">
            {showList ? '▲ 立替金一覧を閉じる' : '▼ 立替金一覧を開く（会社負担を切替）'}
          </button>
          {showList && (
            <div className="mt-1 rounded border border-[var(--color-border)] overflow-hidden text-[11px]">
              <table className="w-full">
                <thead className="bg-gray-50 text-[var(--color-text-sub)]">
                  <tr>
                    <th className="px-2 py-1 text-left">日付</th>
                    <th className="px-2 py-1 text-left">用途</th>
                    <th className="px-2 py-1 text-left">区間/路線</th>
                    <th className="px-2 py-1 text-right">金額</th>
                    <th className="px-2 py-1 text-center">会社負担</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExpenses.map((e) => {
                    const burden = e.company_burden ?? true
                    return (
                      <tr key={e.id} className={`border-t border-[var(--color-border)] ${burden ? '' : 'bg-gray-50 text-gray-400'}`}>
                        <td className="px-2 py-1 font-mono">{e.expense_date}</td>
                        <td className="px-2 py-1">{e.purpose ?? '—'}</td>
                        <td className="px-2 py-1 text-[10px]">
                          {e.from_station} 〜 {e.to_station} {e.payee_or_line ? `(${e.payee_or_line})` : ''}
                        </td>
                        <td className="px-2 py-1 text-right font-mono tabular-nums">¥{e.amount.toLocaleString()}</td>
                        <td className="px-2 py-1 text-center">
                          <input type="checkbox" checked={burden} disabled={updating === e.id}
                            onChange={() => toggleCompanyBurden(e)} className="accent-emerald-500" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="px-2 py-1 text-[10px] text-[var(--color-text-sub)] bg-amber-50">
                ※ 会社負担を外したものは請求書 PDF/Excel に含まれません（押上以外のシェアラウンジ等）
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
