import { useEffect, useRef, useState } from 'react'
import * as holidayJp from '@holiday-jp/holiday_jp'
import { api, downloadXlsx, saveToFolder } from '../lib/api'
import type { Period, WorkReport } from '../lib/api'

const wd = '日月火水木金土'

type DayCell = {
  date: string
  mm: number
  dd: number
  w: string
  weekend: boolean
  holiday: string | null
}

function daysInPeriod(period: Period | null): DayCell[] {
  if (!period) return []
  const arr: DayCell[] = []
  const from = new Date(period.from + 'T00:00:00')
  const to = new Date(period.to + 'T00:00:00')
  for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const wDay = d.getDay()
    const hol = holidayJp.between(d, d)[0]
    arr.push({
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      mm: d.getMonth() + 1,
      dd: d.getDate(),
      w: wd[wDay],
      weekend: wDay === 0 || wDay === 6,
      holiday: hol ? hol.name : null,
    })
  }
  return arr
}

type Row = { content: string; hours: string; transit_section: string; transit_fee: string }

const CATEGORIES = [
  { key: 'wings', label: 'Wings' },
  { key: 'living', label: 'リビング勤怠' },
] as const
type CategoryKey = (typeof CATEGORIES)[number]['key']

export default function WorkReportTable({
  year,
  month,
  period,
  reports,
  onChanged,
  defaultTransit,
  category = 'wings',
}: {
  year: number
  month: number
  period: Period | null
  reports: WorkReport[]
  onChanged: () => void
  defaultTransit?: { section: string; fee: number } | null
  category?: string
}) {
  const filtered = reports.filter((r) => (r.category ?? 'wings') === category)
  const days = daysInPeriod(period)
  const byDate = new Map<string, WorkReport>(filtered.map((r) => [r.work_date, r]))
  const [editing, setEditing] = useState<Record<string, Row>>({})
  const [savedAt, setSavedAt] = useState<Record<string, number>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const initialized = useRef(false)

  useEffect(() => {
    const next: Record<string, Row> = {}
    days.forEach((d) => {
      const r = byDate.get(d.date)
      next[d.date] = {
        content: r?.content ?? '',
        hours: r?.hours != null ? String(r.hours) : '',
        transit_section: r?.transit_section ?? '',
        transit_fee: r?.transit_fee != null ? String(r.transit_fee) : '',
      }
    })
    setEditing(next)
    initialized.current = true
    return () => {
      Object.values(timers.current).forEach(clearTimeout)
      timers.current = {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.length, period?.from, period?.to, category])

  const save = async (date: string, row: Row) => {
    await api.post('/work_reports', {
      work_date: date,
      content: row.content,
      hours: row.hours === '' ? null : Number(row.hours),
      transit_section: row.transit_section,
      transit_fee: row.transit_fee === '' ? null : Number(row.transit_fee),
      category,
    })
    setSavedAt((p) => ({ ...p, [date]: Date.now() }))
    onChanged()
  }

  const scheduleSave = (date: string, row: Row) => {
    if (timers.current[date]) clearTimeout(timers.current[date])
    timers.current[date] = setTimeout(() => save(date, row), 500)
  }

  const set = (date: string, key: keyof Row, value: string) => {
    setEditing((prev) => {
      const nextRow = { ...prev[date], [key]: value }
      // 乗車区間を入力したら、交通費が空ならデフォルト値を自動入力
      if (key === 'transit_section' && value && !nextRow.transit_fee && defaultTransit?.fee) {
        nextRow.transit_fee = String(defaultTransit.fee)
      }
      scheduleSave(date, nextRow)
      return { ...prev, [date]: nextRow }
    })
  }

  const colorFor = (d: DayCell) => {
    if (d.holiday || d.w === '日') return 'text-red-500'
    if (d.w === '土') return 'text-blue-500'
    return 'text-[var(--color-text)]'
  }

  return (
    <div className="glass overflow-hidden rounded-2xl shadow-md">
      <div className="flex flex-col gap-1 border-b border-[var(--color-border)] px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-[var(--color-text)]">
            業務報告 — {year}年 {month}月分
            {period && <span className="ml-2 text-[11px] text-[var(--color-text-sub)]">({period.from} 〜 {period.to})</span>}
          </div>
        <div className="flex gap-1.5 items-center">
          <button
            onClick={async () => {
              try {
                const r = await api.get('/me')
                const current = r.data.local_save_dir ?? ''
                const next = prompt('保存先フォルダ（{year} {month} {cat} プレースホルダ可）', current)
                if (next == null) return
                await api.patch('/me', { user: { local_save_dir: next } })
              } catch (e: any) {
                alert(`保存先の更新失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
              }
            }}
            className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs font-semibold text-[var(--color-text-sub)] hover:bg-gray-50"
            title="保存先フォルダの設定"
          >
            ⚙ 保存先フォルダ
          </button>
          <button
            onClick={async () => {
              try {
                const dest = await saveToFolder(`/exports/work_report.xlsx?month=${year}-${String(month).padStart(2, '0')}&category=${category}`)
                alert(`保存しました:\n${dest}`)
              } catch (e: any) {
                alert(`保存失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
              }
            }}
            className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow"
            title="現在の保存先フォルダに保存"
          >
            📁 保存
          </button>
        </div>
        </div>
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 backdrop-blur">
            <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--color-text-sub)]">
              <th className="px-4 py-1.5 w-32">日付</th>
              <th className="px-2 py-1.5">作業内容</th>
              <th className="px-2 py-1.5 w-20 text-right">時間</th>
              <th className="px-2 py-1.5 w-32">乗車区間</th>
              <th className="px-2 py-1.5 w-24 text-right">交通費</th>
              <th className="px-2 py-1.5 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const e = editing[d.date] ?? { content: '', hours: '', transit_section: '', transit_fee: '' }
              const has = e.content || e.hours || e.transit_section || e.transit_fee
              const justSaved = savedAt[d.date] && Date.now() - savedAt[d.date] < 1500
              return (
                <tr
                  key={d.date}
                  className={`border-t border-[var(--color-border)] ${
                    d.holiday ? 'bg-red-50' : d.weekend ? 'bg-gray-50/50' : ''
                  } hover:bg-gray-50`}
                >
                  <td className={`px-4 py-1 ${colorFor(d)}`}>
                    <div className="flex items-baseline gap-2">
                      <span>{d.mm}/{String(d.dd).padStart(2, '0')} ({d.w})</span>
                      {d.holiday && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] text-red-500">
                          {d.holiday}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={e.content}
                      onChange={(ev) => set(d.date, 'content', ev.target.value)}
                      placeholder="—"
                      className="w-full rounded-lg bg-transparent px-2 py-1 font-mono text-[var(--color-text)] placeholder-gray-400 outline-none focus:bg-gray-50"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      value={e.hours}
                      onChange={(ev) => set(d.date, 'hours', ev.target.value)}
                      placeholder="—"
                      className="w-16 rounded-lg bg-transparent px-2 py-1 text-right font-mono tabular-nums text-[var(--color-text)] placeholder-gray-400 outline-none focus:bg-gray-50"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={e.transit_section}
                      onChange={(ev) => set(d.date, 'transit_section', ev.target.value)}
                      placeholder="—"
                      className="w-full rounded-lg bg-transparent px-2 py-1 text-[var(--color-text)] placeholder-gray-400 outline-none focus:bg-gray-50"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      value={e.transit_fee}
                      onChange={(ev) => set(d.date, 'transit_fee', ev.target.value)}
                      placeholder="—"
                      className="w-20 rounded-lg bg-transparent px-2 py-1 text-right font-mono tabular-nums text-[var(--color-text)] placeholder-gray-400 outline-none focus:bg-gray-50"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {justSaved ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-600">
                        ✓
                      </span>
                    ) : has ? (
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
