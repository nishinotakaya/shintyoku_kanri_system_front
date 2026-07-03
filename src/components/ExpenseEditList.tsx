import { useEffect, useState } from 'react'
import { api } from '../lib/api'

type Expense = {
  id: number
  expense_date: string
  purpose: string | null
  from_station: string | null
  to_station: string | null
  payee_or_line: string | null
  amount: number
  company_burden: boolean
  excel_excluded: boolean
  category: string | null
}

type Props = {
  submissionUserId: number
  year: number
  month: number
  category: string
}

export default function ExpenseEditList({ submissionUserId, year, month, category }: Props) {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [draft, setDraft] = useState<{ expense_date: string; purpose: string; amount: string }>(
    () => ({ expense_date: `${year}-${String(month).padStart(2, '0')}-01`, purpose: '押上シェアラウンジ利用料', amount: '' })
  )
  const [creating, setCreating] = useState(false)

  const monthParam = `${year}-${String(month).padStart(2, '0')}`

  const reload = async () => {
    setLoading(true)
    try {
      const r = await api.get<{ expenses: Expense[] }>('/expenses', { params: { month: monthParam, as_user_id: submissionUserId } })
      const all = r.data.expenses ?? []
      setExpenses(all.filter((e) => (e.category ?? 'wings') === category))
    } catch (e: any) {
      console.warn('expense load failed', e)
    } finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [submissionUserId, year, month, category])

  const updateField = async (id: number, patch: Partial<Expense>) => {
    setBusyId(id)
    try { await api.patch(`/expenses/${id}`, patch); await reload() }
    catch (e: any) { alert(`更新失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`) }
    finally { setBusyId(null) }
  }
  const removeExpense = async (id: number) => {
    if (!confirm('この立替金行を削除しますか？')) return
    setBusyId(id)
    try { await api.delete(`/expenses/${id}`); await reload() }
    catch (e: any) { alert(`削除失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`) }
    finally { setBusyId(null) }
  }
  const submitNew = async () => {
    if (!draft.expense_date || !draft.amount) { alert('日付と金額は必須です'); return }
    setCreating(true)
    try {
      await api.post('/expenses', {
        expense_date: draft.expense_date,
        purpose: draft.purpose,
        amount: Number(draft.amount),
        category,
        as_user_id: submissionUserId,
      })
      // 追加後はリセットせず、入力値（日付/用途/金額）をそのまま残す
      // → 続けて似た内容を入れたい場合に便利
      await reload()
    } catch (e: any) { alert(`追加失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`) }
    finally { setCreating(false) }
  }

  const total = expenses.reduce((s, e) => s + (e.company_burden ? e.amount : 0), 0)

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-emerald-50/30 p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold">立替金 明細（対象月の expense — 直接編集 / 追加 / 削除）</div>
        <div className="text-[11px] text-emerald-700">会社負担合計: <span className="font-mono">¥{total.toLocaleString()}</span></div>
      </div>
      <table className="w-full text-[11px]">
        <thead className="text-[var(--color-text-sub)]">
          <tr>
            <th className="text-left w-28">日付</th>
            <th className="text-left">用途</th>
            <th className="text-left w-32">区間/路線</th>
            <th className="text-right w-20">金額</th>
            <th className="text-center w-12">負担</th>
            <th className="text-center w-14">Excel<br />除外</th>
            <th className="w-6"></th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={6} className="text-center text-[10px] py-1">読込中…</td></tr>}
          {!loading && expenses.length === 0 && <tr><td colSpan={6} className="text-center text-[10px] py-1 text-[var(--color-text-sub)]">立替金 なし</td></tr>}
          {expenses.map((e) => (
            <tr key={e.id} className={`border-t ${e.company_burden ? '' : 'bg-gray-50 text-gray-400'}`}>
              <td><input type="date" value={e.expense_date} disabled={busyId === e.id}
                onChange={(ev) => updateField(e.id, { expense_date: ev.target.value })}
                className="w-full px-1 py-0.5 text-[11px] border rounded font-mono" /></td>
              <td><input value={e.purpose ?? ''} disabled={busyId === e.id}
                onChange={(ev) => updateField(e.id, { purpose: ev.target.value })}
                className="w-full px-1 py-0.5 text-[11px] border rounded" /></td>
              <td className="text-[10px]">{e.from_station} 〜 {e.to_station} {e.payee_or_line ? `(${e.payee_or_line})` : ''}</td>
              <td><input type="number" value={e.amount} disabled={busyId === e.id}
                onChange={(ev) => updateField(e.id, { amount: Number(ev.target.value) })}
                className="w-full px-1 py-0.5 text-[11px] text-right border rounded font-mono" /></td>
              <td className="text-center">
                <input type="checkbox" checked={e.company_burden} disabled={busyId === e.id}
                  onChange={() => updateField(e.id, { company_burden: !e.company_burden })}
                  className="accent-emerald-500" />
              </td>
              <td className="text-center">
                <input type="checkbox" checked={e.excel_excluded} disabled={busyId === e.id}
                  onChange={() => updateField(e.id, { excel_excluded: !e.excel_excluded })}
                  className="accent-amber-500" title="チェック=PDFに載せるが Excel には載せない（シェアラウンジ等）" />
              </td>
              <td className="text-center">
                <button onClick={() => removeExpense(e.id)} disabled={busyId === e.id}
                  className="text-rose-500 hover:text-rose-700 disabled:opacity-50">🗑</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t pt-1.5 grid grid-cols-12 gap-1.5 items-end">
        <label className="col-span-3"><div className="text-[10px] mb-0.5">日付</div>
          <input type="date" value={draft.expense_date}
            onChange={(e) => setDraft({ ...draft, expense_date: e.target.value })}
            className="w-full px-1 py-0.5 text-[11px] border rounded font-mono" /></label>
        <label className="col-span-5"><div className="text-[10px] mb-0.5">用途（"押上 シェアラウンジ" を含むと会社負担=ON）</div>
          <input value={draft.purpose}
            onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
            className="w-full px-1 py-0.5 text-[11px] border rounded" /></label>
        <label className="col-span-2"><div className="text-[10px] mb-0.5">金額</div>
          <input type="text" inputMode="numeric" value={draft.amount}
            onChange={(e) => setDraft({ ...draft, amount: e.target.value.replace(/[^\d-]/g, '') })}
            className="w-full px-1 py-0.5 text-[11px] text-right border rounded font-mono" /></label>
        <button onClick={submitNew} disabled={creating}
          className="col-span-2 rounded bg-gradient-to-r from-emerald-500 to-teal-500 px-2 py-1 text-[11px] font-semibold text-white shadow disabled:opacity-50">
          {creating ? '保存中…' : '＋ 追加'}
        </button>
      </div>
    </div>
  )
}
