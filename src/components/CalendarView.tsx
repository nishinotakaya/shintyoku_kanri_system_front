import { useMemo } from 'react'
import * as holidayJp from '@holiday-jp/holiday_jp'
import type { WorkReport, Expense } from '../lib/api'

const wd = '日月火水木金土'

type TeamScheduleEntry = { id?: number; date: string; person: string; status: string }

const STATUS_OPTIONS = [
  '出社',
  'リモート',
  'リビング リモート',
  '午前タマ/午後リビング',
  '休み',
  '定休日',
  '高田馬場',
  'TL@新宿',
  'TL@田町',
  'TL@押上',
]

const PERSONS = ['西野', '川村', '大隅'] as const

type Props = {
  year: number
  month: number
  reports: WorkReport[]
  expenses: Expense[]
  teamSchedules?: TeamScheduleEntry[]
  onDayClick?: (date: string) => void
  onUpdateTeamSchedule?: (id: number, status: string) => void
  onCreateTeamSchedule?: (date: string, person: string, status: string) => void
  canEditPerson?: (person: string) => boolean
  currentSurname?: string
}

// 1日のステータス → { living, tama } 予定時間
function expectedHours(status: string, dow: number): { living: number; tama: number } {
  const s = status || ''
  if (!s || s.includes('休み') || s.includes('定休')) return { living: 0, tama: 0 }
  // 午前/午後 等で分割パターン
  if (s.includes('午前') && s.includes('リビング')) return { living: 5, tama: 3.5 }
  if (s.includes('リビング') && /[/／]/.test(s)) return { living: 5, tama: 3.5 }
  // リビング単独（リビング リモート 等）
  if (s.includes('リビング')) return { living: 8, tama: 0 }
  // 火曜のリビング併用パターンが status に "リビング" 含まなければ通常タマ
  // 通常: 出社・リモート・場所名 → タマ 8h
  return { living: 0, tama: 8 }
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

export default function CalendarView({ year, month, reports, expenses, teamSchedules = [], onDayClick, onUpdateTeamSchedule, onCreateTeamSchedule, canEditPerson, currentSurname }: Props) {
  const teamMap = useMemo(() => {
    const map = new Map<string, TeamScheduleEntry[]>()
    teamSchedules.forEach((entry) => {
      const arr = map.get(entry.date) || []
      arr.push(entry)
      map.set(entry.date, arr)
    })
    return map
  }, [teamSchedules])

  // 締日（25日）まで: 前月26日〜当月25日 の範囲で集計
  const periodTotals = useMemo(() => {
    const closingDay = 25
    const periodEnd = `${year}-${String(month).padStart(2, '0')}-${String(closingDay).padStart(2, '0')}`
    const previousMonthDate = new Date(year, month - 2, closingDay + 1)
    const periodStart = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, '0')}-${String(previousMonthDate.getDate()).padStart(2, '0')}`

    // 実績
    let livingHours = 0
    let tamaHours = 0
    reports.forEach((report) => {
      if (report.work_date < periodStart || report.work_date > periodEnd) return
      const hours = Number(report.hours) || 0
      if (report.category === 'living') livingHours += hours
      else tamaHours += hours
    })

    // 予定（自分のチーム予定から推計）
    // person 名は team_schedules では「西野」「川村」「大隅」、currentSurname は display_name の先頭 token
    // ("西野 鷹也" → "西野"、"川村卓也" → "川村卓也") なので互換マッチで判定
    const personMatches = (person: string) =>
      person === currentSurname || currentSurname.includes(person) || person.includes(currentSurname)

    let plannedLiving = 0
    let plannedTama = 0
    if (currentSurname) {
      teamSchedules.forEach((entry) => {
        if (!personMatches(entry.person)) return
        if (entry.date < periodStart || entry.date > periodEnd) return
        const dt = new Date(entry.date)
        const eh = expectedHours(entry.status, dt.getDay())
        plannedLiving += eh.living
        plannedTama += eh.tama
      })
    }

    return { livingHours, tamaHours, plannedLiving, plannedTama, periodStart, periodEnd }
  }, [reports, year, month, teamSchedules, currentSurname])

  // 締日(25日)期間でセルを構築: 前月26日〜当月25日
  const cells = useMemo(() => {
    const closingDay = 25
    const periodStart = new Date(year, month - 2, closingDay + 1) // 前月26日
    const periodEnd = new Date(year, month - 1, closingDay)       // 当月25日
    const startDow = periodStart.getDay()
    const totalDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1

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

    for (let i = 0; i < totalDays; i++) {
      const dt = new Date(periodStart)
      dt.setDate(periodStart.getDate() + i)
      const dow = dt.getDay()
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
      const hol = holidayJp.between(dt, dt)[0]
      const reps = reportMap.get(dateStr) || []
      const exps = expenseMap.get(dateStr) || []
      const totalH = reps.reduce((s, r) => s + (r.hours || 0), 0)
      grid.push({ day: dt.getDate(), date: dateStr, dow, holiday: hol?.name ?? null, reports: reps, expenses: exps, totalH })
    }

    // 末尾の空白（週を埋める）
    while (grid.length % 7 !== 0) {
      grid.push({ day: null, date: '', dow: grid.length % 7, holiday: null, reports: [], expenses: [], totalH: 0 })
    }

    return grid
  }, [year, month, reports, expenses])

  const maxH = 15 // 工数バーの最大基準

  return (
    <div className="glass rounded-2xl shadow-md relative">
      {/* sticky ヘッダ: タイトル + 合計 + 曜日 を一塊で固定 */}
      <div className="sticky top-[56px] z-20 bg-white rounded-t-2xl px-3 pt-3 pb-1 border-b border-[var(--color-border)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-widest text-[var(--color-text-sub)]">
              カレンダー — {year}年 {month}月分
            </div>
            <div className="text-[11px] text-[var(--color-text-sub)] mt-0.5">
              {(() => {
                const prevMonth = month === 1 ? 12 : month - 1
                const prevYear = month === 1 ? year - 1 : year
                return `締日(25日) — ${prevYear}年${prevMonth}月26日〜${year}年${month}月25日`
              })()}
            </div>
          </div>
          <div className="flex flex-col items-end text-xs leading-tight">
            <div className="flex items-baseline gap-1 text-[10px] text-[var(--color-text-sub)]">
              <span className="font-semibold">締日(25日)まで</span>
              <span className="font-mono tabular-nums">{periodTotals.periodStart}〜{periodTotals.periodEnd}</span>
            </div>
            <table className="mt-0.5 text-[11px] tabular-nums font-mono">
              <thead>
                <tr className="text-[10px] text-[var(--color-text-sub)]">
                  <th className="text-left pr-2">　</th>
                  <th className="text-right px-2 text-violet-600">リビング</th>
                  <th className="text-right px-2 text-emerald-600">タマ</th>
                  <th className="text-right pl-2 text-amber-600">合計</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="text-left pr-2 text-[var(--color-text-sub)]">予定</td>
                  <td className="text-right px-2 text-violet-500">{periodTotals.plannedLiving.toFixed(1)}h</td>
                  <td className="text-right px-2 text-emerald-500">{periodTotals.plannedTama.toFixed(1)}h</td>
                  <td className="text-right pl-2 text-amber-500">{(periodTotals.plannedLiving + periodTotals.plannedTama).toFixed(1)}h</td>
                </tr>
                <tr>
                  <td className="text-left pr-2 text-[var(--color-text-sub)] font-semibold">実績</td>
                  <td className="text-right px-2 text-violet-700 font-semibold">{periodTotals.livingHours.toFixed(1)}h</td>
                  <td className="text-right px-2 text-emerald-700 font-semibold">{periodTotals.tamaHours.toFixed(1)}h</td>
                  <td className="text-right pl-2 text-amber-700 font-bold">{(periodTotals.livingHours + periodTotals.tamaHours).toFixed(1)}h</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-7 gap-px bg-[var(--color-border)]">
          {wd.split('').map((w, i) => (
            <div
              key={w}
              className={`bg-gray-50 py-0.5 text-center text-[11px] font-semibold ${
                i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-[var(--color-text-sub)]'
              }`}
            >
              {w}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px bg-[var(--color-border)] rounded-b-2xl overflow-hidden">

        {/* セル */}
        {cells.map((c, i) => {
          if (c.day === null) {
            return <div key={`e${i}`} className="bg-white min-h-[140px]" />
          }
          const isWeekend = c.dow === 0 || c.dow === 6
          const isHoliday = !!c.holiday
          const barW = c.totalH ? Math.min(100, (c.totalH / maxH) * 100) : 0
          return (
            <div
              key={c.date}
              onClick={onDayClick ? () => onDayClick(c.date) : undefined}
              className={`bg-white min-h-[140px] p-1.5 flex flex-col gap-0.5 ${
                isHoliday ? 'bg-red-50/50' : isWeekend ? 'bg-gray-50/50' : ''
              } ${onDayClick ? 'cursor-pointer hover:bg-fuchsia-50/40' : ''}`}
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

              {/* 作業内容（短縮、tooltip でフル表示） */}
              {c.reports.length > 0 && c.reports[0].content && (
                <div
                  className="text-[10px] text-[var(--color-text-sub)] leading-tight line-clamp-2"
                  title={c.reports[0].content}
                >
                  {c.reports[0].content}
                </div>
              )}

              {/* 立替金 */}
              {c.expenses.length > 0 && (
                <div className="text-[10px] text-amber-500">
                  ¥{c.expenses.reduce((s, e) => s + e.amount, 0).toLocaleString()}
                </div>
              )}

              {/* チーム予定（西野・川村・大隅 を常に 3 行表示） */}
              {(onCreateTeamSchedule || onUpdateTeamSchedule || (teamMap.get(c.date) ?? []).length > 0) && (
                <div className="mt-1 space-y-0.5 border-t border-[var(--color-border)] pt-1">
                  {PERSONS.map((person) => {
                    const entry = (teamMap.get(c.date) ?? []).find((target) => target.person === person)
                    const status = entry?.status ?? ''
                    const personEditable = canEditPerson ? canEditPerson(person) : true
                    const editable = personEditable && (!!onUpdateTeamSchedule || !!onCreateTeamSchedule)
                    const knownOption = !!status && STATUS_OPTIONS.includes(status)
                    const handleChange = (value: string) => {
                      let nextStatus = value
                      if (value === '__custom__') {
                        const input = prompt('ステータス（自由入力）', status)
                        if (input == null) return
                        nextStatus = input
                      }
                      if (entry?.id != null) {
                        onUpdateTeamSchedule?.(entry.id, nextStatus)
                      } else if (nextStatus !== '') {
                        onCreateTeamSchedule?.(c.date, person, nextStatus)
                      }
                    }
                    return (
                      <div key={person} className="flex items-center gap-1 text-[10px] min-w-0" onClick={(e) => e.stopPropagation()}>
                        <span className={`font-semibold w-7 shrink-0 ${editable ? 'text-[var(--color-text-sub)]' : 'text-gray-400'}`}>{person}</span>
                        {editable ? (
                          <select
                            value={status === '' ? '' : (knownOption ? status : '__custom__')}
                            onChange={(e) => handleChange(e.target.value)}
                            className={`rounded px-1 py-0.5 min-w-0 flex-1 cursor-pointer outline-none text-ellipsis overflow-hidden border ${
                              status ? `${statusClass(status)} border-transparent` : 'bg-white text-fuchsia-500 border-fuchsia-300 hover:bg-fuchsia-50'
                            }`}
                            title={status || 'ここをクリックで予定を追加'}
                          >
                            <option value="">{status ? '予定なし' : '＋ 予定を追加'}</option>
                            {!knownOption && status !== '' && <option value={status}>{status}</option>}
                            {STATUS_OPTIONS.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                            <option value="__custom__">…自由入力</option>
                          </select>
                        ) : (
                          <span className={`rounded px-1 truncate flex-1 ${status ? statusClass(status) : 'text-gray-300'}`}>{status || '—'}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

    </div>
  )
}
