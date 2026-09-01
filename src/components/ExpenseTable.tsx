import { useMemo, useState } from 'react'
import type { Expense, WorkReport } from '../lib/api'
import { api } from '../lib/api'
import type { WorkCategory } from '../lib/workCategories'
import FolderSaveButtons, { fetchExportBlob } from './FolderSaveButtons'


export default function ExpenseTable({
  year,
  month,
  expenses,
  reports,
  category = 'wings',
  onPdfDownloaded,
  onChanged,
  asUserId,
  surname,
}: {
  year: number
  month: number
  expenses: Expense[]
  reports: WorkReport[]
  category?: WorkCategory
  onPdfDownloaded?: () => void
  onChanged?: () => void
  asUserId?: number | null
  surname?: string
}) {
  const mp = `${year}-${String(month).padStart(2, '0')}`
  const asUserParam = asUserId ? { as_user_id: asUserId } : {}
  const filenamePrefix = surname ? `${surname}_` : ''

  // シェアラウンジ(押上)の既定文言・ヒントは Tama(wings) / リビング(living) の立替金でしか意味を持たないため、
  // 運送(transport)など他カテゴリでは出さない
  const isShareLoungeCategory = category === 'wings' || category === 'living'
  const defaultExpensePurpose = isShareLoungeCategory ? '押上シェアラウンジ利用料' : ''

  // 立替金の合計（expense レコードのみ。work_reports.transit_fee はここでは加算しない＝
  // apply_transit で Expense にも複製作成済み → 二重計上防止）
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
  const [adding, setAdding] = useState(false)
  const [newExpense, setNewExpense] = useState<{ expense_date: string; purpose: string; amount: string }>(
    () => ({ expense_date: `${year}-${String(month).padStart(2, '0')}-01`, purpose: defaultExpensePurpose, amount: '' })
  )
  const [creating, setCreating] = useState(false)

  const toggleCompanyBurden = async (expense: Expense) => {
    setUpdating(expense.id)
    try {
      await api.patch(`/expenses/${expense.id}`, { company_burden: !(expense.company_burden ?? true) })
      onChanged?.()
    } finally {
      setUpdating(null)
    }
  }

  const removeExpense = async (id: number) => {
    if (!confirm('この立替金を削除しますか？')) return
    setUpdating(id)
    try {
      await api.delete(`/expenses/${id}`)
      onChanged?.()
    } finally {
      setUpdating(null)
    }
  }

  const submitNewExpense = async () => {
    if (!newExpense.expense_date || !newExpense.amount) { alert('日付と金額は必須です'); return }
    setCreating(true)
    try {
      await api.post('/expenses', {
        expense_date: newExpense.expense_date,
        purpose: newExpense.purpose,
        amount: Number(newExpense.amount),
        category,
        billing_month: `${year}-${String(month).padStart(2, '0')}`, // 表示中の月に紐づける（締日跨ぎでもこの月に入る）
      })
      setNewExpense({ expense_date: `${year}-${String(month).padStart(2, '0')}-01`, purpose: defaultExpensePurpose, amount: '' })
      setAdding(false)
      onChanged?.()
    } catch (e: any) {
      alert(`追加失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setCreating(false)
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
              const fallback = `${filenamePrefix}立替金_${year}年_${month}月分.xlsx`
              const { blob, filename } = await fetchExportBlob('/exports/expense.xlsx', { month: mp, category, ...asUserParam }, fallback)
              return { blob, filename, monthFolderName: `${month}月` }
            }}
            onDownloaded={onPdfDownloaded}
          />
          <FolderSaveButtons
            label="立替金PDF"
            monthFolderName={`${month}月`}
            fetchSpec={async () => {
              const fallback = `${filenamePrefix}立替金_${year}年_${month}月分.pdf`
              const { blob, filename } = await fetchExportBlob('/exports/expense.pdf', { month: mp, category, ...asUserParam }, fallback)
              return { blob, filename, monthFolderName: `${month}月` }
            }}
            onDownloaded={onPdfDownloaded}
          />
        </div>
      </div>

      <div className="mt-1.5 flex items-baseline justify-between">
        <span className="text-xs text-[var(--color-text-sub)]">交通費 {transitCount} 日分 ／ 立替金 {filteredExpenses.length} 件</span>
        <div className="font-mono tabular-nums text-lg text-amber-600">¥{expenseTotal.toLocaleString()}</div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button onClick={() => setAdding((v) => !v)}
          className="text-[11px] rounded border border-emerald-400 bg-white px-2 py-0.5 text-emerald-600 hover:bg-emerald-50">
          {adding ? '× 追加をキャンセル' : (isShareLoungeCategory ? '＋ 立替金を追加（押上シェアラウンジ利用料 等）' : '＋ 立替金を追加')}
        </button>
      </div>
      {adding && (
        <div className="mt-1.5 rounded border border-[var(--color-border)] bg-emerald-50/40 p-2 grid grid-cols-12 gap-1.5 text-[11px]">
          <label className="col-span-3"><div className="text-[10px] mb-0.5">日付</div>
            <input type="date" value={newExpense.expense_date}
              onChange={(e) => setNewExpense({ ...newExpense, expense_date: e.target.value })}
              className="w-full rounded border border-[var(--color-border)] px-2 py-1 text-xs" /></label>
          <label className="col-span-5"><div className="text-[10px] mb-0.5">{isShareLoungeCategory ? '用途（"押上 シェアラウンジ" を含むと会社負担=ON）' : '用途'}</div>
            <input value={newExpense.purpose}
              onChange={(e) => setNewExpense({ ...newExpense, purpose: e.target.value })}
              placeholder={isShareLoungeCategory ? '押上シェアラウンジ利用料' : '高速代'}
              className="w-full rounded border border-[var(--color-border)] px-2 py-1 text-xs" /></label>
          <label className="col-span-2"><div className="text-[10px] mb-0.5">金額(円)</div>
            <input type="text" inputMode="numeric" value={newExpense.amount}
              onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value.replace(/[^\d-]/g, '') })}
              className="w-full rounded border border-[var(--color-border)] px-2 py-1 text-xs font-mono" /></label>
          <div className="col-span-2 flex items-end">
            <button onClick={submitNewExpense} disabled={creating}
              className="w-full rounded bg-gradient-to-r from-emerald-500 to-teal-500 px-2 py-1 text-xs font-semibold text-white shadow disabled:opacity-50">
              {creating ? '保存中…' : '＋ 追加'}
            </button>
          </div>
        </div>
      )}
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
                    <th className="px-2 py-1 text-center">操作</th>
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
                        <td className="px-2 py-1 text-center">
                          <button onClick={() => removeExpense(e.id)} disabled={updating === e.id}
                            className="text-rose-500 hover:text-rose-700 disabled:opacity-50">🗑</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {isShareLoungeCategory && (
                <div className="px-2 py-1 text-[10px] text-[var(--color-text-sub)] bg-amber-50">
                  ※ 会社負担を外したものは請求書 PDF/Excel に含まれません（押上以外のシェアラウンジ等）
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
