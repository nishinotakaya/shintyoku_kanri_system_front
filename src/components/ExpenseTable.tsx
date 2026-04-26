import { useMemo, useState } from 'react'
import { api, downloadXlsx, saveToFolder } from '../lib/api'
import type { Expense, WorkReport } from '../lib/api'

async function downloadPdf(path: string, filename: string) {
  const res = await api.get(path, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

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
        <div className="flex gap-1.5">
          {(() => {
            const saveLocal = async (path: string) => {
              try { const dest = await saveToFolder(path); alert(`保存しました:\n${dest}`) }
              catch (e: any) { alert(`保存失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`) }
            }
            const changeSaveDir = async () => {
              try {
                const r = await api.get('/me')
                const current = r.data.local_save_dir ?? ''
                const next = prompt('保存先フォルダ（{year} {month} {cat} プレースホルダ可）', current)
                if (next == null) return
                await api.patch('/me', { user: { local_save_dir: next } })
              } catch (e: any) {
                alert(`保存先の更新失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
              }
            }
            return (
              <>
                <button onClick={changeSaveDir}
                  className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs font-semibold text-[var(--color-text-sub)] hover:bg-gray-50"
                  title="保存先フォルダの設定">⚙ 保存先フォルダ</button>
                <button onClick={() => saveLocal(`/exports/expense.xlsx?month=${mp}&category=${category}`)}
                  className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow">📁 Excel 保存</button>
                <button onClick={() => saveLocal(`/exports/expense.pdf?month=${mp}&category=${category}`)}
                  className="rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 px-3 py-1.5 text-xs font-semibold text-white shadow">📁 PDF 保存</button>
              </>
            )
          })()}
        </div>
      </div>

      <div className="mt-1.5 flex items-baseline justify-between">
        <span className="text-xs text-[var(--color-text-sub)]">交通費 {transitCount} 日分</span>
        <div className="font-mono tabular-nums text-lg text-amber-600">¥{transitTotal.toLocaleString()}</div>
      </div>
    </div>
  )
}
