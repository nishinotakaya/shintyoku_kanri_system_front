import { useMemo, useState } from 'react'
import type { Expense, WorkReport } from '../lib/api'
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
}: {
  year: number
  month: number
  expenses: Expense[]
  reports: WorkReport[]
  category?: string
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
          />
        </div>
      </div>

      <div className="mt-1.5 flex items-baseline justify-between">
        <span className="text-xs text-[var(--color-text-sub)]">交通費 {transitCount} 日分</span>
        <div className="font-mono tabular-nums text-lg text-amber-600">¥{transitTotal.toLocaleString()}</div>
      </div>
    </div>
  )
}
