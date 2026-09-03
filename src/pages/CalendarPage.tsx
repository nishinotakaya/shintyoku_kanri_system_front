import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { ExpenseResponse, WorkReportResponse, Me } from '../lib/api'
import CalendarView from '../components/CalendarView'
import UserPickerSelect from '../components/UserPickerSelect'
import DayDetailModal from '../components/DayDetailModal'
import { billingMonthForToday } from '../lib/billingMonth'
import { billingPeriodRange, formatIsoDate, formatJpDate } from '../lib/billingPeriod'

type TeamScheduleEntry = { id?: number; date: string; person: string; status: string; location?: string | null; memo?: string | null }

export default function CalendarPage() {
  const initial = billingMonthForToday(25)
  const [year, setYear] = useState(initial.year)
  const [month, setMonth] = useState(initial.month)
  const [didAlignToBilling, setDidAlignToBilling] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [openDate, setOpenDate] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const mp = `${year}-${String(month).padStart(2, '0')}`
  // 締日はログインユーザー基準（CalendarView 内の集計と同じ）。25日固定にすると末日締めのユーザーで見出しと集計の期間が食い違う
  const closingDay = me?.closing_day ?? 25
  const billingPeriod = billingPeriodRange(year, month, closingDay)

  // 業務報告関連のあらゆるクエリを無効化（Dashboard 含む）
  const invalidateReports = () => {
    queryClient.invalidateQueries({ queryKey: ['work_reports'] })
    queryClient.invalidateQueries({ queryKey: ['work_reports_pair'] })
    queryClient.invalidateQueries({ queryKey: ['expenses'] })
    queryClient.invalidateQueries({ queryKey: ['invoice_preview'] })
  }

  useEffect(() => {
    api.get<Me>('/me').then((r) => {
      setMe(r.data)
      if (!didAlignToBilling && r.data.closing_day && r.data.closing_day !== 25) {
        const billing = billingMonthForToday(r.data.closing_day)
        setYear(billing.year); setMonth(billing.month)
      }
      setDidAlignToBilling(true)
    }).catch(() => {})
  }, [didAlignToBilling])

  // 苗字「西野」で判定すると同姓の一般ユーザーも管理者UIになるので、サーバの admin 判定を使う
  const isAdmin = !!me?.admin
  const isOsumi = (me?.display_name ?? '').includes('大隅')

  // admin / サブ管理者(テナント代表): 「他ユーザーとして閲覧」で管理対象のカレンダーに切替。
  // 候補はサーバ(/users/pickable)が管理対象に絞って返す
  const canPickUsers = !!me?.admin || !!me?.sub_admin
  const [asUserId, setAsUserId] = useState<number | null>(null)
  const [pickableUsers, setPickableUsers] = useState<{ id: number; display_name: string; email: string; admin: boolean }[]>([])
  useEffect(() => {
    if (!canPickUsers) return
    api.get('/users/pickable').then((r) => setPickableUsers(r.data)).catch(() => {})
  }, [canPickUsers])

  const asUserParam = canPickUsers && asUserId && asUserId !== me?.id ? { as_user_id: asUserId } : {}
  // 閲覧対象ユーザーの苗字（admin が他人をセレクトしてる時は切替先の苗字、それ以外は自分）
  const viewingUser = pickableUsers.find((u) => u.id === asUserId) ?? me
  const viewingSurname = (viewingUser?.display_name ?? '').split(/[\s　]/)[0] ?? ''
  // 編集権限は常に自分基準（admin はすべて編集可）。
  // 苗字の部分一致で判定すると同姓の別ユーザー（西野 鷹也さんと西野 雄太郎さん）の行まで
  // 編集できてしまうので、サーバが返す「操作できる人物行」だけを許可する。
  const editablePersons = me?.editable_calendar_persons ?? []
  const canEditPerson = (person: string) => isAdmin || editablePersons.includes(person)

  // 当月 + 翌月分も取得（カレンダー表示日が次の締日期間に属する分をカバー）
  const nextMonthDate = new Date(year, month, 1)
  const nmp = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}`

  const reportsQ = useQuery({
    queryKey: ['work_reports_pair', mp, nmp, asUserId],
    queryFn: async () => {
      const [current, next] = await Promise.all([
        api.get<WorkReportResponse>('/work_reports', { params: { month: mp, ...asUserParam } }),
        api.get<WorkReportResponse>('/work_reports', { params: { month: nmp, ...asUserParam } }),
      ])
      const seen = new Set<number>()
      const reports = [...current.data.reports, ...next.data.reports].filter((r) => {
        if (seen.has(r.id)) return false
        seen.add(r.id)
        return true
      })
      return { period: current.data.period, reports }
    },
  })
  const expensesQ = useQuery({
    queryKey: ['expenses', mp, asUserId],
    queryFn: async () => (await api.get<ExpenseResponse>('/expenses', { params: { month: mp, ...asUserParam } })).data,
  })
  // 前月+当月の team_schedules を取得（締日(25日)期間が前月26日から始まるため）
  const prevMonthDate = new Date(year, month - 2, 1)
  const pmp = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`
  const teamQ = useQuery({
    queryKey: ['team_schedules_pair', mp, pmp],
    queryFn: async () => {
      const [current, previous] = await Promise.all([
        api.get<TeamScheduleEntry[]>('/team_schedules', { params: { month: mp } }),
        api.get<TeamScheduleEntry[]>('/team_schedules', { params: { month: pmp } }),
      ])
      const seen = new Set<number>()
      return [...current.data, ...previous.data].filter((entry) => {
        if (entry.id != null && seen.has(entry.id)) return false
        if (entry.id != null) seen.add(entry.id)
        return true
      })
    },
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
      queryClient.invalidateQueries({ queryKey: ['team_schedules_pair'] })
    } catch (e: any) {
      setImportMsg(`取込失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setImporting(false)
    }
  }

  const exportTeam = async () => {
    setImporting(true); setImportMsg(null)
    try {
      const r = await api.post('/team_schedules/export', null, { params: { month: mp } })
      setImportMsg(`${r.data.updated} 件をシートへ書き戻し`)
    } catch (e: any) {
      setImportMsg(`エクスポート失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setImporting(false)
    }
  }

  // team_schedule の status を変えると、バックエンドが
  // person → user を逆引きして、そのユーザー自身の default_transit_* を使って
  // 出社日の work_report + expense を upsert する。
  // 誰がカレンダーを操作したかに依らず、各人のデフォルト乗車区間が入る。
  const updateTeamSchedule = async (id: number, status: string) => {
    try {
      await api.patch(`/team_schedules/${id}`, { status })
      queryClient.invalidateQueries({ queryKey: ['team_schedules_pair'] })
      invalidateReports()
    } catch (e: any) {
      alert(`更新失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }

  const createTeamSchedule = async (date: string, person: string, status: string) => {
    try {
      await api.post('/team_schedules', { date, person, status })
      queryClient.invalidateQueries({ queryKey: ['team_schedules_pair'] })
      invalidateReports()
    } catch (e: any) {
      alert(`作成失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }

  return (
    <div className="space-y-3">
      {/* 狭い画面ではラベルが1文字ずつ縦積みになるので nowrap + 行の折り返しを許可 */}
      {me?.attendance_schedule_url && (
        <div className="text-[11px] text-[var(--color-text-sub)] flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="whitespace-nowrap">連動スプレッドシート:</span>
          <a
            href={me.attendance_schedule_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fuchsia-600 underline decoration-dotted hover:text-fuchsia-500 truncate max-w-full sm:max-w-md"
          >
            {me.attendance_schedule_url}
          </a>
          <span className="whitespace-nowrap text-gray-400">URL の修正は ⚙ 設定 から</span>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => monthShift(-1)} className="shrink-0 rounded-md bg-white px-2 py-0.5 text-[var(--color-text-sub)] hover:bg-gray-50 border border-[var(--color-border)]">←</button>
          <div>
            <div className="flex items-center gap-2">
              <div className="text-lg font-semibold tracking-tight text-[var(--color-text)] whitespace-nowrap">{year}年 {month}月分</div>
              {/* 会社(テナント)名。稼働報告書の取引先名にあたる見出し。行は本人名のまま */}
              {me?.tenant_name && (
                <span className="rounded-full bg-[var(--color-bg)] border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-sub)] whitespace-nowrap">
                  {me.tenant_name}
                </span>
              )}
            </div>
            <div className="text-[11px] text-[var(--color-text-sub)]">
              締日({closingDay}日)：{formatJpDate(formatIsoDate(billingPeriod.start))} 〜 {formatJpDate(formatIsoDate(billingPeriod.end))}
            </div>
          </div>
          <button onClick={() => monthShift(1)} className="rounded-md bg-white px-2 py-0.5 text-[var(--color-text-sub)] hover:bg-gray-50 border border-[var(--color-border)]">→</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canPickUsers && pickableUsers.length > 1 && (
            <UserPickerSelect
              users={pickableUsers}
              value={asUserId ?? me?.id ?? 0}
              meId={me?.id}
              onChange={setAsUserId}
            />
          )}
          {importMsg && <span className="text-xs text-emerald-600">{importMsg}</span>}
          <button
            onClick={importTeam}
            disabled={importing}
            className="rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50"
          >
            {importing ? '取込中…' : '📥 シートから取込'}
          </button>
          {/* 大隅は書き戻し不可。admin (西野) のみ表示 */}
          {!isOsumi && (
            <button
              onClick={exportTeam}
              disabled={importing}
              className="rounded-md bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50"
            >
              📤 シートに書き戻し
            </button>
          )}
        </div>
      </div>

      <CalendarView
        year={year}
        month={month}
        reports={reports}
        expenses={expenses}
        teamSchedules={teamSchedules}
        onDayClick={setOpenDate}
        onUpdateTeamSchedule={updateTeamSchedule}
        onCreateTeamSchedule={createTeamSchedule}
        canEditPerson={canEditPerson}
        currentSurname={viewingSurname}
        visiblePersons={me?.calendar_persons}
        me={me}
      />

      {openDate && (
        <DayDetailModal
          date={openDate}
          onClose={() => setOpenDate(null)}
          workReports={reports}
          expenses={expenses}
          teamSchedules={teamSchedules}
          onChanged={invalidateReports}
          canEditPerson={canEditPerson}
          isAdmin={isAdmin}
          asUserId={asUserId}
          onExportSchedule={exportTeam}
          canExport={!isOsumi}
          me={me}
        />
      )}
    </div>
  )
}
