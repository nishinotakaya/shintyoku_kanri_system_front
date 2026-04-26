import { useMemo } from 'react'
import * as holidayJp from '@holiday-jp/holiday_jp'
import type { WorkReport, Expense } from '../lib/api'

const wd = '日月火水木金土'

type TeamScheduleEntry = { date: string; person: string; status: string }

type Props = {
  year: number
  month: number
  reports: WorkReport[]
  expenses: Expense[]
  teamSchedules?: TeamScheduleEntry[]
}

const STATUS_CLASS: Record<string, string> = {
  休み: 'bg-rose-100 text-rose-700',
  リモート: 'bg-sky-100 text-sky-700',
  出社: 'bg-emerald-100 text-emerald-700',
  'リビング リモート': 'bg-violet-100 text-violet-700',
  'リビング': 'bg-violet-100 text-violet-700',
}

function statusClass(status: string) {
  for (const key of Object.keys(STATUS_CLASS)) {
    if (status.includes(key)) return STATUS_CLASS[key]
  }
  return 'bg-amber-100 text-amber-700'
}

export default function CalendarView({ year, month, reports, expenses, teamSchedules = [] }: Props) {
  const teamMap = useMemo(() => {
    const map = new Map<string, TeamScheduleEntry[]>()
    teamSchedules.forEach((entry) => {
      const arr = map.get(entry.date) || []
      arr.push(entry)
      map.set(entry.date, arr)
    })
    return map
  }, [teamSchedules])

  const cells = useMemo(() => {
    const first = new Date(year, month - 1, 1)
    const last = new Date(year, month, 0)
    const startDow = first.getDay()
    const days = last.getDate()

    const reportMap = new Map<string, WorkReport[]>()
    reports.forEach((r) => {
      const arr = reportMap.get(r.work_date) || []
      arr.push(r)
      reportMap.set(r.work_date, arr)
    })
    const expenseMap = new Map<string, Expense[]>()
    expenses.forEach((e) => {
      const arr = expenseMap.get(e.expense_date) || []
      arr.push(e)
      expenseMap.set(e.expense_date, arr)
    })

    const grid: {
      day: number | null
      date: string
      dow: number
      holiday: string | null
      reports: WorkReport[]
      expenses: Expense[]
      totalH: number
    }[] = []

    // 前月の空白
    for (let i = 0; i < startDow; i++) {
      grid.push({ day: null, date: '', dow: i, holiday: null, reports: [], expenses: [], totalH: 0 })
    }

    for (let d = 1; d <= days; d++) {
      const dt = new Date(year, month - 1, d)
      const dow = dt.getDay()
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const hol = holidayJp.between(dt, dt)[0]
      const reps = reportMap.get(dateStr) || []
      const exps = expenseMap.get(dateStr) || []
      const totalH = reps.reduce((s, r) => s + (r.hours || 0), 0)
      grid.push({ day: d, date: dateStr, dow, holiday: hol?.name ?? null, reports: reps, expenses: exps, totalH })
    }

    return grid
  }, [year, month, reports, expenses])

  const maxH = 15 // 工数バーの最大基準

  return (
    <div className="glass rounded-3xl p-6 shadow-md">
      <div className="text-xs uppercase tracking-widest text-[var(--color-text-sub)]">
        カレンダー — {year}年 {month}月
      </div>

      <div className="mt-4 grid grid-cols-7 gap-px bg-[var(--color-border)] rounded-xl overflow-hidden">
        {/* ヘッダ */}
        {wd.split('').map((w, i) => (
          <div
            key={w}
            className={`bg-gray-50 py-2 text-center text-xs font-semibold ${
              i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-[var(--color-text-sub)]'
            }`}
          >
            {w}
          </div>
        ))}

        {/* セル */}
        {cells.map((c, i) => {
          if (c.day === null) {
            return <div key={`e${i}`} className="bg-white min-h-[80px]" />
          }
          const isWeekend = c.dow === 0 || c.dow === 6
          const isHoliday = !!c.holiday
          const barW = c.totalH ? Math.min(100, (c.totalH / maxH) * 100) : 0
          return (
            <div
              key={c.date}
              className={`bg-white min-h-[80px] p-1.5 ${
                isHoliday ? 'bg-red-50/50' : isWeekend ? 'bg-gray-50/50' : ''
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span
                  className={`text-xs font-semibold ${
                    isHoliday || c.dow === 0 ? 'text-red-500' : c.dow === 6 ? 'text-blue-500' : 'text-[var(--color-text)]'
                  }`}
                >
                  {c.day}
                </span>
                {c.totalH > 0 && (
                  <span className="text-[10px] font-mono tabular-nums text-[var(--color-text-sub)]">{c.totalH}h</span>
                )}
              </div>

              {c.holiday && (
                <div className="text-[8px] text-red-400 truncate">{c.holiday}</div>
              )}

              {/* 工数バー */}
              {barW > 0 && (
                <div className="mt-1 h-1.5 rounded-full bg-[var(--color-bg)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-primary-light)]"
                    style={{ width: `${barW}%` }}
                  />
                </div>
              )}

              {/* 作業内容 (最初の1件だけ短縮) */}
              {c.reports.length > 0 && c.reports[0].content && (
                <div className="mt-0.5 text-[9px] text-[var(--color-text-sub)] truncate leading-tight">
                  {c.reports[0].content.slice(0, 20)}
                </div>
              )}

              {/* 立替金アイコン */}
              {c.expenses.length > 0 && (
                <div className="mt-0.5 text-[9px] text-amber-500">
                  ¥{c.expenses.reduce((s, e) => s + e.amount, 0).toLocaleString()}
                </div>
              )}

              {/* チーム予定（西野・川村・大隅） */}
              {(teamMap.get(c.date) ?? []).length > 0 && (
                <div className="mt-1 space-y-0.5 border-t border-[var(--color-border)] pt-1">
                  {(teamMap.get(c.date) ?? []).map((entry, idx) => (
                    <div key={idx} className="flex items-center gap-1 text-[9px]">
                      <span className="font-semibold text-[var(--color-text-sub)] w-6 shrink-0">{entry.person}</span>
                      <span className={`rounded px-1 ${statusClass(entry.status)} truncate flex-1`} title={entry.status}>{entry.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
