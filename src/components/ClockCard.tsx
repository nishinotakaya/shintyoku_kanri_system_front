import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { WorkReport } from '../lib/api'

const fmtDate = (d: Date) =>
  `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} (${'日月火水木金土'[d.getDay()]})`

export default function ClockCard({
  today,
  enabled,
  onChanged,
}: {
  today: WorkReport | null
  enabled: boolean
  onChanged: () => void
}) {
  const [now, setNow] = useState(new Date())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const clockIn = async () => {
    setBusy(true)
    try {
      await api.post('/work_reports/clock_in')
      onChanged()
    } finally {
      setBusy(false)
    }
  }
  const clockOut = async () => {
    setBusy(true)
    try {
      await api.post('/work_reports/clock_out')
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="glass rounded-2xl p-4 shadow-md">
      <div className="text-[10px] uppercase tracking-widest text-[var(--color-text-sub)]">本日</div>
      {/* 狭い画面で日付と時計がくっつかないよう gap を空け、時計側は縮めない */}
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="text-sm font-medium text-[var(--color-text)] sm:text-base">{fmtDate(now)}</div>
        <div className="shrink-0 font-mono tabular-nums text-xl text-[var(--color-text)] sm:text-2xl">{now.toTimeString().slice(0, 8)}</div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={clockIn}
          disabled={busy || !enabled || !!today?.clock_in}
          className="flex items-center justify-between gap-2 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow shadow-blue-500/20 transition active:scale-95 disabled:opacity-40 disabled:active:scale-100"
        >
          <span>出勤</span>
          <span className="font-mono tabular-nums text-[11px] font-normal text-white/80">{today?.clock_in ?? '—'}</span>
        </button>
        <button
          onClick={clockOut}
          disabled={busy || !enabled || !today?.clock_in || !!today?.clock_out}
          className="flex items-center justify-between gap-2 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 px-4 py-2.5 text-sm font-semibold text-white shadow shadow-pink-500/20 transition active:scale-95 disabled:opacity-40 disabled:active:scale-100"
        >
          <span>退勤</span>
          <span className="font-mono tabular-nums text-[11px] font-normal text-white/80">{today?.clock_out ?? '—'}</span>
        </button>
      </div>
      {!enabled && (
        <div className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-600">
          ⚠ 当月以外を表示中のため打刻はできません
        </div>
      )}
    </div>
  )
}
