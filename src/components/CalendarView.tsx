import { useEffect, useMemo, useState } from 'react'
import * as holidayJp from '@holiday-jp/holiday_jp'
import { api } from '../lib/api'
import type { WorkReport, Expense, Me } from '../lib/api'
import { visibleWorkCategories } from '../lib/workCategories'
import { workedHoursBetween } from '../lib/workedHours'
import { isDailyPay, overtimeHoursOf, standardHoursOf } from '../lib/transportPay'
import type { TransportPaySetting } from '../lib/transportPay'
import { billingPeriodRange, formatIsoDate, formatJpDate } from '../lib/billingPeriod'

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
  visiblePersons?: string[]
  // 複数チェックで同時表示する追加ユーザーの稼働(日セルにチップ表示する)
  extraUserReports?: { userId: number; userName: string; reports: WorkReport[] }[]
  /** 締日・見えるカテゴリの判定に使う。未取得(null)時は締日25日・既定4カテゴリにフォールバックする */
  me?: Me | null
}

// 1日のステータス → { living, tama } 予定時間
function expectedHours(status: string, _dow: number): { living: number; tama: number } {
  const s = status || ''
  if (!s || s.includes('休み') || s.includes('定休')) return { living: 0, tama: 0 }
  // 午前/午後 等で分割パターン
  if (s.includes('午前') && s.includes('リビング')) return { living: 5, tama: 3 }
  if (s.includes('リビング') && /[/／]/.test(s)) return { living: 5, tama: 3 }
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

export default function CalendarView({ year, month, reports, expenses, teamSchedules = [], onDayClick, onUpdateTeamSchedule, onCreateTeamSchedule, canEditPerson, currentSurname, visiblePersons, extraUserReports = [], me }: Props) {
  // 締日は me.closing_day を使う。未取得(null/undefined)のうちだけ 25 にフォールバック
  const closingDay = me?.closing_day ?? 25
  const visibleCategories = useMemo(() => visibleWorkCategories(me), [me])
  // 運送(transport)専用ユーザーかどうか。この場合だけ「予定/実績/差」表を稼働報告書用の集計に差し替える
  const isTransportOnly = visibleCategories.length === 1 && visibleCategories[0] === 'transport'
  // 運送の報酬形態。日給のときだけ「時間外」を集計に出す
  const [paySetting, setPaySetting] = useState<TransportPaySetting | null>(null)
  useEffect(() => {
    if (!isTransportOnly) { setPaySetting(null); return }
    api.get<TransportPaySetting>('/invoice_setting', { params: { category: 'transport' } })
      .then((res) => setPaySetting(res.data))
      .catch(() => setPaySetting(null))
  }, [isTransportOnly])
  const teamMap = useMemo(() => {
    const map = new Map<string, TeamScheduleEntry[]>()
    teamSchedules.forEach((entry) => {
      const arr = map.get(entry.date) || []
      arr.push(entry)
      map.set(entry.date, arr)
    })
    return map
  }, [teamSchedules])

  // 表示する人物行: 管理者が設定した「見える人」だけを出す。
  // 未取得(undefined)のうちは1人も出さない。既定リストを先に描くと、見えてはいけない人が
  // 一瞬表示されてしまうため。取込データから動的に足すこともしない(設定で隠せなくなる)。
  const persons = visiblePersons ?? []

  // 追加ユーザーの稼働を日付ごとにまとめる(チップ表示用)。時間が無い日は「稼働」とだけ出す
  const extraByDate = useMemo(() => {
    const map = new Map<string, { userId: number; userName: string; totalH: number }[]>()
    extraUserReports.forEach(({ userId, userName, reports: userReports }) => {
      const hoursByDate = new Map<string, number>()
      userReports.forEach((r) => {
        hoursByDate.set(r.work_date, (hoursByDate.get(r.work_date) ?? 0) + (r.hours ?? 0))
      })
      hoursByDate.forEach((totalH, dateStr) => {
        const list = map.get(dateStr) ?? []
        list.push({ userId, userName, totalH: Math.round(totalH * 10) / 10 })
        map.set(dateStr, list)
      })
    })
    return map
  }, [extraUserReports])

  // ステータスの選択肢: 固定リスト + 取込データに現れたステータス（作業日・東栄＠リモート等も選べる）。
  // 運送(transport)ユーザーはタマ向けの既定ステータス（出社 / リビング リモート / TL@… ）が
  // 当てはまらないので、最初は空にして「…自由入力」で足したものが選択肢に増えていくようにする。
  const statusOptions = useMemo(() => {
    const set = new Set<string>(isTransportOnly ? [] : STATUS_OPTIONS)
    teamSchedules.forEach((entry) => { if (entry.status) set.add(entry.status) })
    return [...set]
  }, [teamSchedules, isTransportOnly])

  // 締日(me.closing_day)まで: 前月(締日+1)日〜当月締日 の範囲で集計
  const periodTotals = useMemo(() => {
    const { start, end } = billingPeriodRange(year, month, closingDay)
    const periodStart = formatIsoDate(start)
    const periodEnd = formatIsoDate(end)

    // 実績（カテゴリごとに正しく集計。運送(transport)は「タマ」に含めない）
    let livingHours = 0
    let tamaHours = 0
    let transportWorkedDays = 0
    let transportDistanceKm = 0
    let transportWorkedHours = 0
    let transportOvertimeHours = 0
    reports.forEach((report) => {
      if (report.work_date < periodStart || report.work_date > periodEnd) return
      const hours = Number(report.hours) || 0
      if (report.category === 'living') {
        livingHours += hours
      } else if (report.category === 'transport') {
        transportDistanceKm += Number(report.distance_km) || 0
        const workedHours = workedHoursBetween(report.clock_in, report.clock_out)
        transportWorkedHours += workedHours
        transportOvertimeHours += overtimeHoursOf(workedHours, paySetting)
        // 稼働した日 = 開始・終了時間が両方入っている、または hours > 0
        const worked = (!!report.clock_in && !!report.clock_out) || hours > 0
        if (worked) transportWorkedDays += 1
      } else {
        tamaHours += hours
      }
    })

    // 予定（自分のチーム予定から推計）
    // person 名は team_schedules では「西野」「川村」「大隅」、currentSurname は display_name の先頭 token
    // ("西野 鷹也" → "西野"、"川村卓也" → "川村卓也") なので互換マッチで判定
    const personMatches = (person: string) =>
      !!currentSurname && (person === currentSurname || currentSurname.includes(person) || person.includes(currentSurname))

    let plannedLiving = 0
    let plannedTama = 0
    // 本日までの予定 (今日時点で消化されていなければならない予定時間)
    let plannedLivingToToday = 0
    let plannedTamaToToday = 0
    const today = new Date()
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    if (currentSurname) {
      teamSchedules.forEach((entry) => {
        if (!personMatches(entry.person)) return
        if (entry.date < periodStart || entry.date > periodEnd) return
        const dt = new Date(entry.date)
        const eh = expectedHours(entry.status, dt.getDay())
        plannedLiving += eh.living
        plannedTama += eh.tama
        if (entry.date <= todayIso) {
          plannedLivingToToday += eh.living
          plannedTamaToToday += eh.tama
        }
      })
    }

    return {
      livingHours, tamaHours, plannedLiving, plannedTama, plannedLivingToToday, plannedTamaToToday,
      transportWorkedDays, transportDistanceKm, transportWorkedHours, transportOvertimeHours, periodStart, periodEnd,
    }
  }, [reports, year, month, teamSchedules, currentSurname, closingDay, paySetting])

  // 締日(me.closing_day)期間でセルを構築: 前月(締日+1)日〜当月締日
  const cells = useMemo(() => {
    const { start: periodStart, end: periodEnd } = billingPeriodRange(year, month, closingDay)
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
  }, [year, month, reports, expenses, closingDay])

  const maxH = 15 // 工数バーの最大基準

  return (
    <div className="glass rounded-2xl shadow-md relative">
      {/* sticky ヘッダ: タイトル + 合計 + 曜日 を一塊で固定 */}
      <div className="sticky top-[56px] z-20 bg-white rounded-t-2xl px-3 pt-3 pb-1 border-b border-[var(--color-border)]">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3">
          <div>
            <div className="text-xs uppercase tracking-widest text-[var(--color-text-sub)]">
              カレンダー — {year}年 {month}月分
            </div>
            <div className="text-[11px] text-[var(--color-text-sub)] mt-0.5">
              締日({closingDay}日) — {formatJpDate(periodTotals.periodStart)}〜{formatJpDate(periodTotals.periodEnd)}
            </div>
          </div>
          <div className="flex flex-col items-start sm:items-end text-xs leading-tight">
            <div className="flex items-baseline gap-1 text-[10px] text-[var(--color-text-sub)]">
              <span className="font-semibold">締日({closingDay}日)まで</span>
              <span className="font-mono tabular-nums">{periodTotals.periodStart}〜{periodTotals.periodEnd}</span>
            </div>
            {isTransportOnly ? (
              // 運送ユーザー: 「予定/実績/差」表の代わりに稼働報告書フッタと同じ集計(月度稼働日数・走行距離)を出す
              <table className="mt-0.5 text-[11px] tabular-nums font-mono">
                <thead>
                  <tr className="text-[10px] text-[var(--color-text-sub)]">
                    <th className="text-left pr-2">　</th>
                    <th className="text-right px-2 text-sky-600">月度稼働日数(日)</th>
                    <th className="text-right px-2 text-indigo-600">稼働時間(h)</th>
                    {isDailyPay(paySetting) && (
                      <th className="text-right px-2 text-rose-600" title={`1日 ${standardHoursOf(paySetting)} 時間を超えた分`}>時間外(h)</th>
                    )}
                    <th className="text-right pl-2 text-emerald-600">走行距離(km)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="text-left pr-2 text-[var(--color-text-sub)] font-semibold">合計</td>
                    <td className="text-right px-2 text-sky-700 font-semibold">{periodTotals.transportWorkedDays}日</td>
                    <td className="text-right px-2 text-indigo-700 font-semibold">{periodTotals.transportWorkedHours.toFixed(1)}h</td>
                    {isDailyPay(paySetting) && (
                      <td className="text-right px-2 text-rose-700 font-semibold">{periodTotals.transportOvertimeHours.toFixed(1)}h</td>
                    )}
                    <td className="text-right pl-2 text-emerald-700 font-semibold">{periodTotals.transportDistanceKm.toFixed(1)}km</td>
                  </tr>
                </tbody>
              </table>
            ) : (
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
                  {(() => {
                    const diffLiving = periodTotals.livingHours - periodTotals.plannedLivingToToday
                    const diffTama = periodTotals.tamaHours - periodTotals.plannedTamaToToday
                    const diffTotal = diffLiving + diffTama
                    const fmt = (n: number) => `${n > 0 ? '+' : n < 0 ? '' : '±'}${n.toFixed(1)}h`
                    const cls = (n: number) => n > 0 ? 'text-emerald-600 font-semibold' : n < 0 ? 'text-red-500 font-semibold' : 'text-[var(--color-text-sub)]'
                    return (
                      <tr title="本日までの予定との差 (+ なら進捗、- なら遅れ)">
                        <td className="text-left pr-2 text-[var(--color-text-sub)]">差(本日)</td>
                        <td className={`text-right px-2 ${cls(diffLiving)}`}>{fmt(diffLiving)}</td>
                        <td className={`text-right px-2 ${cls(diffTama)}`}>{fmt(diffTama)}</td>
                        <td className={`text-right pl-2 ${cls(diffTotal)}`}>{fmt(diffTotal)}</td>
                      </tr>
                    )
                  })()}
                </tbody>
              </table>
            )}
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
            return <div key={`e${i}`} className="bg-white min-h-[76px] md:min-h-[140px]" />
          }
          const isWeekend = c.dow === 0 || c.dow === 6
          const isHoliday = !!c.holiday
          const barW = c.totalH ? Math.min(100, (c.totalH / maxH) * 100) : 0
          return (
            <div
              key={c.date}
              onClick={onDayClick ? () => onDayClick(c.date) : undefined}
              className={`bg-white min-h-[76px] md:min-h-[140px] p-1 md:p-1.5 flex flex-col gap-0.5 ${
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
                <div className="hidden md:block text-[8px] text-red-400 truncate">{c.holiday}</div>
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

              {/* 複数チェックされた他ユーザーの稼働チップ */}
              {(extraByDate.get(c.date) ?? []).map((extra) => (
                <div
                  key={extra.userId}
                  className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap rounded bg-sky-100 px-1 text-[9px] leading-4 text-sky-700"
                  title={`${extra.userName} ${extra.totalH > 0 ? `${extra.totalH}h` : '稼働'}`}
                >
                  {extra.userName.split(/[\s\u3000]/)[0]} {extra.totalH > 0 ? `${extra.totalH}h` : '稼働'}
                </div>
              ))}

              {/* 作業内容（短縮、tooltip でフル表示） */}
              {c.reports.length > 0 && c.reports[0].content && (
                <div className="hidden md:block">
                  <div
                    className="text-[10px] text-[var(--color-text-sub)] leading-tight line-clamp-2"
                    title={c.reports[0].content}
                  >
                    {c.reports[0].content}
                  </div>
                </div>
              )}

              {/* 立替金 */}
              {c.expenses.length > 0 && (
                <div className="text-[9px] md:text-[10px] text-amber-500 truncate">
                  ¥{c.expenses.reduce((s, e) => s + e.amount, 0).toLocaleString()}
                </div>
              )}


              {/* チーム予定（基本メンバー + 取込データの人物を全行表示） */}
              {/* スマホ: 予定チップ (Googleカレンダー風・タップで日別モーダルへ) */}
              {(teamMap.get(c.date) ?? []).length > 0 && (
                <div className="md:hidden mt-auto flex flex-col gap-px overflow-hidden">
                  {persons.map((person) => {
                    const entry = (teamMap.get(c.date) ?? []).find((target) => target.person === person)
                    if (!entry?.status) return null
                    return (
                      <div key={person} className={`rounded-sm px-0.5 text-[8px] leading-[11px] truncate ${statusClass(entry.status)}`}>
                        {person.charAt(0)} {entry.status}
                      </div>
                    )
                  })}
                </div>
              )}

              {(onCreateTeamSchedule || onUpdateTeamSchedule || (teamMap.get(c.date) ?? []).length > 0) && (
                <div className="hidden md:block mt-1 space-y-0.5 border-t border-[var(--color-border)] pt-1">
                  {persons.map((person) => {
                    const entry = (teamMap.get(c.date) ?? []).find((target) => target.person === person)
                    const status = entry?.status ?? ''
                    const personEditable = canEditPerson ? canEditPerson(person) : true
                    const editable = personEditable && (!!onUpdateTeamSchedule || !!onCreateTeamSchedule)
                    const knownOption = !!status && statusOptions.includes(status)
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
                      // status="出社" の乗車区間連携はバックエンドが
                      // team_schedule の person から該当ユーザの default_transit_* で自動 upsert する
                    }
                    return (
                      <div key={person} className="flex items-center gap-1 text-[10px] min-w-0" onClick={(e) => e.stopPropagation()}>
                        {/* 「西野 雄太郎」のような長い人物名でも折り返さず1行に収める（はみ出す分は省略、全体は title で見せる） */}
                        <span
                          title={person}
                          className={`font-semibold shrink-0 whitespace-nowrap overflow-hidden text-ellipsis ${
                            person.length > 3 ? 'max-w-[4rem] text-[8px]' : 'w-7'
                          } ${editable ? 'text-[var(--color-text-sub)]' : 'text-gray-400'}`}
                        >
                          {person}
                        </span>
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
                            {statusOptions.map((option) => (
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
