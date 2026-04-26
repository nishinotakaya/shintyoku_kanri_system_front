import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { ExpenseResponse, WorkReportResponse } from '../lib/api'
import CalendarView from '../components/CalendarView'

type TeamScheduleEntry = { id: number; date: string; person: string; status: string; location: string | null; memo: string | null }

export default function CalendarPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const mp = `${year}-${String(month).padStart(2, '0')}`

  const reportsQ = useQuery({
    queryKey: ['work_reports', mp],
    queryFn: async () => (await api.get<WorkReportResponse>('/work_reports', { params: { month: mp } })).data,
  })
  const expensesQ = useQuery({
    queryKey: ['expenses', mp],
    queryFn: async () => (await api.get<ExpenseResponse>('/expenses', { params: { month: mp } })).data,
  })
  const teamQ = useQuery({
    queryKey: ['team_schedules', mp],
    queryFn: async () => (await api.get<TeamScheduleEntry[]>('/team_schedules', { params: { month: mp } })).data,
  })

  const reports = reportsQ.data?.reports ?? []
  const expenses = expensesQ.data?.expenses ?? []
  const teamSchedules = teamQ.data ?? []

  const monthShift = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth() + 1)
  }

  const importTeam = async () => {
    setImporting(true); setImportMsg(null)
    try {
      const r = await api.post('/team_schedules/import', null, { params: { month: mp } })
      setImportMsg(`${r.data.imported} 件取込（${r.data.persons.join(' / ')}）`)
      teamQ.refetch()
    } catch (e: any) {
      setImportMsg(`取込失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => monthShift(-1)} className="rounded-md bg-[var(--color-bg)] px-2 py-0.5 text-[var(--color-text-sub)] hover:bg-gray-50 border border-[var(--color-border)]">←</button>
          <div className="text-lg font-semibold tracking-tight text-[var(--color-text)]">{year}年 {month}月</div>
          <button onClick={() => monthShift(1)} className="rounded-md bg-[var(--color-bg)] px-2 py-0.5 text-[var(--color-text-sub)] hover:bg-gray-50 border border-[var(--color-border)]">→</button>
        </div>
        <div className="flex items-center gap-2">
          {importMsg && <span className="text-xs text-emerald-600">{importMsg}</span>}
          <button
            onClick={importTeam}
            disabled={importing}
            className="rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50"
          >
            {importing ? '取込中…' : '📅 チーム予定を取込'}
          </button>
        </div>
      </div>

      <CalendarView year={year} month={month} reports={reports} expenses={expenses} teamSchedules={teamSchedules} />
    </div>
  )
}
