import { useEffect, useRef, useState } from 'react'
import * as holidayJp from '@holiday-jp/holiday_jp'
import { api } from '../lib/api'
import type { Period, WorkReport } from '../lib/api'
import { workedHoursBetween } from '../lib/workedHours'

// 運送(transport)の勤怠表。紙の「稼働報告書」と同じ列を締日期間ぶん並べ、
// カレンダー(DayDetailModal)から入れた内容がそのまま出る・ここから直しても同じ勤怠に入る。
// 列: 日付 / 開始時間 / 終了時間 / 稼働時間 / 走行距離(km) / 備考 / 検印 / 週払 / 配送件数(件) / 開始メーター(km) / 終了メーター(km)

const WEEKDAY_LABELS = '日月火水木金土'

type DayCell = {
  date: string
  month: number
  day: number
  weekdayLabel: string
  weekend: boolean
  holiday: string | null
}

function daysInPeriod(period: Period | null): DayCell[] {
  if (!period) return []
  const cells: DayCell[] = []
  const from = new Date(period.from + 'T00:00:00')
  const to = new Date(period.to + 'T00:00:00')
  for (const cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
    const weekday = cursor.getDay()
    const holiday = holidayJp.between(cursor, cursor)[0]
    cells.push({
      date: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`,
      month: cursor.getMonth() + 1,
      day: cursor.getDate(),
      weekdayLabel: WEEKDAY_LABELS[weekday],
      weekend: weekday === 0 || weekday === 6,
      holiday: holiday ? holiday.name : null,
    })
  }
  return cells
}

type TransportRow = {
  clockIn: string
  clockOut: string
  distanceKm: string
  note: string
  weeklyPayment: boolean
  deliveryCount: string
  meterStart: string
  meterEnd: string
}

const EMPTY_ROW: TransportRow = {
  clockIn: '', clockOut: '', distanceKm: '', note: '',
  weeklyPayment: false, deliveryCount: '', meterStart: '', meterEnd: '',
}

function rowFromReport(report: WorkReport | undefined): TransportRow {
  if (!report) return EMPTY_ROW
  return {
    clockIn: report.clock_in ?? '',
    clockOut: report.clock_out ?? '',
    distanceKm: report.distance_km != null ? String(report.distance_km) : '',
    note: report.note ?? '',
    weeklyPayment: !!report.weekly_payment,
    deliveryCount: report.delivery_count != null ? String(report.delivery_count) : '',
    meterStart: report.meter_start != null ? String(report.meter_start) : '',
    meterEnd: report.meter_end != null ? String(report.meter_end) : '',
  }
}

function hasAnyValue(row: TransportRow): boolean {
  return !!(row.clockIn || row.clockOut || row.distanceKm || row.note ||
    row.weeklyPayment || row.deliveryCount || row.meterStart || row.meterEnd)
}

export default function TransportWorkReportTable({
  year,
  month,
  period,
  reports,
  onChanged,
  asUserId,
}: {
  year: number
  month: number
  period: Period | null
  reports: WorkReport[]
  onChanged: () => void
  asUserId?: number | null
}) {
  const asUserParam = asUserId ? { as_user_id: asUserId } : {}
  const transportReports = reports.filter((report) => report.category === 'transport')
  const days = daysInPeriod(period)
  const byDate = new Map<string, WorkReport>(transportReports.map((report) => [report.work_date, report]))

  const [editing, setEditing] = useState<Record<string, TransportRow>>({})
  const [savedAt, setSavedAt] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState<string | null>(null)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // サーバ側の変更(カレンダーからの入力など)を検知して編集中の値を差し替えるためのハッシュ
  const dataKey = transportReports
    .map((r) => [r.id, r.work_date, r.clock_in, r.clock_out, r.distance_km, r.note,
      r.weekly_payment, r.delivery_count, r.meter_start, r.meter_end, r.approved_at].join('|'))
    .join(',')

  useEffect(() => {
    const next: Record<string, TransportRow> = {}
    days.forEach((day) => { next[day.date] = rowFromReport(byDate.get(day.date)) })
    setEditing(next)
    return () => {
      Object.values(timers.current).forEach(clearTimeout)
      timers.current = {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, period?.from, period?.to])

  const save = async (date: string, row: TransportRow) => {
    setError(null)
    const existing = byDate.get(date)
    try {
      if (!hasAnyValue(row)) {
        // 全項目が空になったらその日の勤怠は削除する(空レコードを残さない)
        if (existing) {
          await api.delete(`/work_reports/${existing.id}`, { params: asUserParam })
          onChanged()
        }
        return
      }
      await api.post('/work_reports', {
        work_date: date,
        category: 'transport',
        clock_in: row.clockIn || null,
        clock_out: row.clockOut || null,
        distance_km: row.distanceKm === '' ? null : Number(row.distanceKm),
        note: row.note || null,
        weekly_payment: row.weeklyPayment,
        delivery_count: row.deliveryCount === '' ? null : Number(row.deliveryCount),
        meter_start: row.meterStart === '' ? null : Number(row.meterStart),
        meter_end: row.meterEnd === '' ? null : Number(row.meterEnd),
      }, { params: asUserParam })
      setSavedAt((prev) => ({ ...prev, [date]: Date.now() }))
      onChanged()
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? '保存に失敗しました')
    }
  }

  const scheduleSave = (date: string, row: TransportRow) => {
    if (timers.current[date]) clearTimeout(timers.current[date])
    timers.current[date] = setTimeout(() => save(date, row), 600)
  }

  const set = (date: string, key: keyof TransportRow, value: string | boolean) => {
    setEditing((prev) => {
      const nextRow = { ...(prev[date] ?? EMPTY_ROW), [key]: value } as TransportRow
      scheduleSave(date, nextRow)
      return { ...prev, [date]: nextRow }
    })
  }

  const toggleApproval = async (date: string) => {
    const existing = byDate.get(date)
    if (!existing) return
    setApproving(date)
    setError(null)
    try {
      if (existing.approved_at) {
        await api.delete(`/work_reports/${existing.id}/approve`, { params: asUserParam })
      } else {
        await api.patch(`/work_reports/${existing.id}/approve`, {}, { params: asUserParam })
      }
      onChanged()
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? '検印の更新に失敗しました')
    } finally {
      setApproving(null)
    }
  }

  const colorFor = (day: DayCell) => {
    if (day.holiday || day.weekdayLabel === '日') return 'text-red-500'
    if (day.weekdayLabel === '土') return 'text-blue-500'
    return 'text-[var(--color-text)]'
  }

  // 紙の稼働報告書のフッタと同じ集計
  const workedDays = days.filter((day) => {
    const row = editing[day.date]
    return !!row && !!row.clockIn && !!row.clockOut
  }).length
  const totalWorkedHours = days.reduce((sum, day) => {
    const row = editing[day.date]
    return sum + workedHoursBetween(row?.clockIn, row?.clockOut)
  }, 0)
  const totalDistanceKm = days.reduce((sum, day) => sum + (Number(editing[day.date]?.distanceKm) || 0), 0)
  const totalDeliveryCount = days.reduce((sum, day) => sum + (Number(editing[day.date]?.deliveryCount) || 0), 0)

  const inputClass = 'w-full rounded-lg bg-transparent px-1.5 py-1 text-[var(--color-text)] placeholder-gray-400 outline-none focus:bg-gray-50'
  const numberClass = `${inputClass} text-right font-mono tabular-nums`

  return (
    <div className="glass overflow-hidden rounded-2xl shadow-md">
      <div className="flex flex-col gap-1 border-b border-[var(--color-border)] px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold text-[var(--color-text)]">
            稼働報告書 — {year}年 {month}月分
            {period && <span className="ml-2 text-[11px] text-[var(--color-text-sub)]">({period.from} 〜 {period.to})</span>}
          </div>
          <div className="flex items-center gap-3 text-[11px] tabular-nums font-mono">
            <span className="text-[var(--color-text-sub)]">月度稼働日数 <span className="font-semibold text-sky-700">{workedDays}日</span></span>
            <span className="text-[var(--color-text-sub)]">稼働時間 <span className="font-semibold text-indigo-700">{totalWorkedHours.toFixed(1)}h</span></span>
            <span className="text-[var(--color-text-sub)]">走行距離 <span className="font-semibold text-emerald-700">{totalDistanceKm.toFixed(1)}km</span></span>
            <span className="text-[var(--color-text-sub)]">配送件数 <span className="font-semibold text-fuchsia-600">{totalDeliveryCount}件</span></span>
          </div>
        </div>
        <div className="text-[10px] text-[var(--color-text-sub)]">※各締日にご担当者様の検印を頂いて下さい／高速・駐車場代の合計は備考欄に記入</div>
        {error && <div className="text-[11px] text-red-500">{error}</div>}
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 backdrop-blur">
            <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--color-text-sub)]">
              <th className="px-3 py-1.5 w-28">日付</th>
              <th className="px-2 py-1.5 w-20">開始時間</th>
              <th className="px-2 py-1.5 w-20">終了時間</th>
              <th className="px-2 py-1.5 w-16 text-right">稼働時間</th>
              <th className="px-2 py-1.5 w-24 text-right">走行距離(km)</th>
              <th className="px-2 py-1.5">備考</th>
              <th className="px-2 py-1.5 w-16 text-center">検印</th>
              <th className="px-2 py-1.5 w-12 text-center">週払</th>
              <th className="px-2 py-1.5 w-20 text-right">配送件数(件)</th>
              <th className="px-2 py-1.5 w-24 text-right">開始メーター(km)</th>
              <th className="px-2 py-1.5 w-24 text-right">終了メーター(km)</th>
              <th className="px-2 py-1.5 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const row = editing[day.date] ?? EMPTY_ROW
              const report = byDate.get(day.date)
              const justSaved = savedAt[day.date] && Date.now() - savedAt[day.date] < 1500
              const meterInvalid = row.meterStart !== '' && row.meterEnd !== '' && Number(row.meterEnd) < Number(row.meterStart)
              return (
                <tr
                  key={day.date}
                  className={`border-t border-[var(--color-border)] ${
                    day.holiday ? 'bg-red-50' : day.weekend ? 'bg-gray-50/50' : ''
                  } hover:bg-gray-50`}
                >
                  <td className={`px-3 py-1 whitespace-nowrap ${colorFor(day)}`}>
                    {day.month}/{String(day.day).padStart(2, '0')} ({day.weekdayLabel})
                  </td>
                  <td className="px-1 py-1">
                    <input type="time" value={row.clockIn} onChange={(e) => set(day.date, 'clockIn', e.target.value)} className={inputClass} />
                  </td>
                  <td className="px-1 py-1">
                    <input type="time" value={row.clockOut} onChange={(e) => set(day.date, 'clockOut', e.target.value)} className={inputClass} />
                  </td>
                  <td className="px-1 py-1 text-right font-mono tabular-nums text-[var(--color-text-sub)]">
                    {workedHoursBetween(row.clockIn, row.clockOut) > 0
                      ? `${workedHoursBetween(row.clockIn, row.clockOut).toFixed(1)}h`
                      : '—'}
                  </td>
                  <td className="px-1 py-1">
                    <div className="flex items-baseline">
                      <input inputMode="decimal" value={row.distanceKm} onChange={(e) => set(day.date, 'distanceKm', e.target.value)} placeholder="—" className={numberClass} />
                      <span className="pl-0.5 text-[10px] text-[var(--color-text-sub)]">km</span>
                    </div>
                  </td>
                  <td className="px-1 py-1">
                    <input value={row.note} onChange={(e) => set(day.date, 'note', e.target.value)} placeholder="—" className={inputClass} />
                  </td>
                  <td className="px-1 py-1 text-center">
                    {report ? (
                      <button
                        onClick={() => toggleApproval(day.date)}
                        disabled={approving === day.date}
                        className={`rounded-full px-2 py-0.5 text-[10px] ${
                          report.approved_at
                            ? 'bg-rose-100 text-rose-600 hover:bg-rose-200'
                            : 'border border-[var(--color-border)] text-[var(--color-text-sub)] hover:bg-gray-100'
                        }`}
                        title={report.approved_at ? '検印済み（クリックで解除）' : 'クリックで検印'}
                      >
                        {approving === day.date ? '…' : report.approved_at ? '㊞' : '押す'}
                      </button>
                    ) : (
                      <span className="text-[10px] text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-1 py-1 text-center">
                    <input type="checkbox" checked={row.weeklyPayment} onChange={(e) => set(day.date, 'weeklyPayment', e.target.checked)} className="h-3.5 w-3.5 accent-fuchsia-500" />
                  </td>
                  <td className="px-1 py-1">
                    <div className="flex items-baseline">
                      <input inputMode="numeric" value={row.deliveryCount} onChange={(e) => set(day.date, 'deliveryCount', e.target.value)} placeholder="—" className={numberClass} />
                      <span className="pl-0.5 text-[10px] text-[var(--color-text-sub)]">件</span>
                    </div>
                  </td>
                  <td className="px-1 py-1">
                    <div className="flex items-baseline">
                      <input inputMode="numeric" value={row.meterStart} onChange={(e) => set(day.date, 'meterStart', e.target.value)} placeholder="—" className={numberClass} />
                      <span className="pl-0.5 text-[10px] text-[var(--color-text-sub)]">km</span>
                    </div>
                  </td>
                  <td className="px-1 py-1">
                    <div className="flex items-baseline">
                      <input
                        inputMode="numeric"
                        value={row.meterEnd}
                        onChange={(e) => set(day.date, 'meterEnd', e.target.value)}
                        placeholder="—"
                        className={`${numberClass} ${meterInvalid ? 'text-red-500' : ''}`}
                        title={meterInvalid ? '終了メーターは開始メーターより小さい値にできません' : undefined}
                      />
                      <span className="pl-0.5 text-[10px] text-[var(--color-text-sub)]">km</span>
                    </div>
                  </td>
                  <td className="px-1 py-1 text-right">
                    {justSaved ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-600">✓</span>
                    ) : report ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-600">●</span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
