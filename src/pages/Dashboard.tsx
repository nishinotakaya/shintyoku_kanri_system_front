import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { ExpenseResponse, WorkReportResponse, Me } from '../lib/api'
import ClockCard from '../components/ClockCard'
import VoiceCommand from '../components/VoiceCommand'
import WorkReportTable from '../components/WorkReportTable'
import ExpenseTable from '../components/ExpenseTable'
import SettingsModal from '../components/SettingsModal'
import PurchaseOrderList from '../components/PurchaseOrderList'
import FolderSaveButtons, { fetchExportBlob } from '../components/FolderSaveButtons'
import InvoiceSubmissionPanel from '../components/InvoiceSubmissionPanel'
import { billingMonthForToday } from '../lib/billingMonth'
// CalendarView moved to /calendar page

const todayIso = () => new Date().toISOString().slice(0, 10)

export default function Dashboard() {
  // 締日基準で今日が含まれる請求月を初期表示（closing_day=25 既定）
  const initial = billingMonthForToday(25)
  const [year, setYear] = useState(initial.year)
  const [month, setMonth] = useState(initial.month)
  const [didAlignToBilling, setDidAlignToBilling] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'account' | 'invoice'>('account')
  const [defaultTransit, setDefaultTransit] = useState<{ section: string; fee: number } | null>(null)
  const [category, setCategory] = useState<'wings' | 'living' | 'techleaders' | 'resystems'>('wings')
  const [me, setMe] = useState<Me | null>(null)

  // 管理者のみ: 「他ユーザーとして閲覧」セレクトボックスで切替
  const [asUserId, setAsUserId] = useState<number | null>(null)
  const [pickableUsers, setPickableUsers] = useState<{ id: number; display_name: string; email: string; admin: boolean }[]>([])
  useEffect(() => {
    if (!me?.admin) return
    api.get('/users/pickable').then((r) => setPickableUsers(r.data)).catch(() => {})
  }, [me?.admin])
  const isAdmin = !!me?.admin
  const isOsumi = (me?.display_name ?? '').includes('大隅')
  const asUserParam = isAdmin && asUserId && asUserId !== me?.id ? { as_user_id: asUserId } : {}

  const monthParam = `${year}-${String(month).padStart(2, '0')}`

  const reportsQ = useQuery({
    queryKey: ['work_reports', monthParam, asUserId],
    queryFn: async () => (await api.get<WorkReportResponse>('/work_reports', { params: { month: monthParam, ...asUserParam } })).data,
  })
  const expensesQ = useQuery({
    queryKey: ['expenses', monthParam, asUserId],
    queryFn: async () => (await api.get<ExpenseResponse>('/expenses', { params: { month: monthParam, ...asUserParam } })).data,
  })

  const reports = reportsQ.data?.reports ?? []
  const expenses = expensesQ.data?.expenses ?? []
  const period = reportsQ.data?.period ?? null
  const today = useMemo(() => reports.find((r) => r.work_date === todayIso()) ?? null, [reports])

  // 表示中の期間に「今日」が含まれているときだけ打刻可能
  const clockEnabled = useMemo(() => {
    if (!period) return false
    const t = todayIso()
    return period.from <= t && t <= period.to
  }, [period])

  const invoiceQ = useQuery({
    queryKey: ['invoice_preview', monthParam, category, asUserId],
    queryFn: async () => (await api.get('/invoice_preview', { params: { month: monthParam, category, ...asUserParam } })).data,
  })

  const totals = useMemo(() => {
    const hours = reports.reduce((s, r) => s + (Number(r.hours) || 0), 0)
    const transit = reports.reduce((s, r) => s + (Number(r.transit_fee) || 0), 0)
    const expense = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
    return { hours, transit, expense }
  }, [reports, expenses])

  useEffect(() => {
    document.title = `進捗管理システム — ${year}年 ${month}月`
    api.get('/me').then((r) => {
      setMe(r.data as Me)
      if (r.data.default_transit_from && r.data.default_transit_fee) {
        setDefaultTransit({ section: `${r.data.default_transit_from} ~ ${r.data.default_transit_to}`, fee: r.data.default_transit_fee })
      }
      // 初回ロード時のみ、ユーザーの締日で「今日が属する請求月」を再算出（既定 25 と違う場合）
      if (!didAlignToBilling && r.data.closing_day && r.data.closing_day !== 25) {
        const billing = billingMonthForToday(r.data.closing_day)
        setYear(billing.year); setMonth(billing.month)
      }
      setDidAlignToBilling(true)
    })
  }, [year, month, didAlignToBilling])

  const refetchAll = () => {
    reportsQ.refetch()
    expensesQ.refetch()
    invoiceQ.refetch()
  }

  const surname = (me?.display_name ?? '').split(/[\s　]/)[0] ?? ''
  const invoiceFilename = (surname ? `${surname}_` : '') + `請求書_${year}年_${month}月分.pdf`
  const monthFolderName = `${month}月`

  const invoiceFetchSpec = async () => {
    const { blob, filename } = await fetchExportBlob('/exports/invoice.pdf', { month: monthParam, category }, invoiceFilename)
    return { blob, filename, monthFolderName }
  }

  // 請求書 PDF を一度でも DL/保存したら、その (年月×カテゴリ) で申請ボタンを解放
  const invoiceDlKey = `invoice_dl_${year}_${month}_${category}`
  const [invoicePdfDownloaded, setInvoicePdfDownloaded] = useState(false)
  useEffect(() => {
    setInvoicePdfDownloaded(localStorage.getItem(invoiceDlKey) === '1')
  }, [invoiceDlKey])
  const markInvoiceDownloaded = () => {
    localStorage.setItem(invoiceDlKey, '1')
    setInvoicePdfDownloaded(true)
  }

  const [syncingWR, setSyncingWR] = useState(false)
  const [syncWRMsg, setSyncWRMsg] = useState<string | null>(null)

  const syncToWorkReports = async () => {
    setSyncingWR(true); setSyncWRMsg(null)
    try {
      const { data } = await api.post('/backlog/sync_to_work_reports', { month: monthParam })
      setSyncWRMsg(`${data.applied} 日分を反映しました`)
      refetchAll()
    } catch (e: any) { setSyncWRMsg(e?.response?.data?.error ?? '反映失敗') }
    finally { setSyncingWR(false) }
  }

  const fmtYen = (n: number | null | undefined) =>
    n == null ? '—' : '¥' + Math.round(n).toLocaleString()

  const monthShift = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth() + 1)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => monthShift(-1)} className="rounded-md bg-[var(--color-bg)] px-2 py-0.5 text-[var(--color-text-sub)] hover:bg-gray-50 border border-[var(--color-border)]">
            ←
          </button>
          <div>
            <div className="text-lg font-semibold tracking-tight text-[var(--color-text)]">{year}年 {month}月分</div>
            {period && (
              <div className="text-[11px] text-[var(--color-text-sub)]">
                期間: {period.from} 〜 {period.to}
              </div>
            )}
          </div>
          <button onClick={() => monthShift(1)} className="rounded-md bg-[var(--color-bg)] px-2 py-0.5 text-[var(--color-text-sub)] hover:bg-gray-50 border border-[var(--color-border)]">
            →
          </button>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && pickableUsers.length > 0 && (
            <select
              value={asUserId ?? me?.id ?? 0}
              onChange={(e) => setAsUserId(Number(e.target.value))}
              className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-xs text-[var(--color-text)]"
              title="閲覧対象ユーザー"
            >
              {pickableUsers.map((u) => (
                <option key={u.id} value={u.id}>👤 {u.display_name}{u.id === me?.id ? '（自分）' : ''}</option>
              ))}
            </select>
          )}
          <div className="flex gap-1">
            {(() => {
              const allCategories = [['wings', 'Wings'], ['living', 'リビング'], ['techleaders', 'テックリーダーズ'], ['resystems', 'REシステムズ']] as const
              const visibleCategories = isAdmin ? allCategories : allCategories.filter(([key]) => key === 'wings' || key === 'living')
              return visibleCategories.map(([key, label]) => (
                <button key={key} onClick={() => setCategory(key)}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                    category === key ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text-sub)] border border-[var(--color-border)]'
                  }`}>{label}</button>
              ))
            })()}
          </div>
          <button
            onClick={() => { setSettingsTab('account'); setSettingsOpen(true) }}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[11px] text-[var(--color-text-sub)] hover:bg-gray-50"
          >
            ⚙ 設定
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ClockCard today={today} enabled={clockEnabled} onChanged={refetchAll} />
        <div className="glass rounded-2xl p-4 shadow-md">
          <div className="text-[10px] uppercase tracking-widest text-[var(--color-text-sub)]">今期サマリ</div>
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-xs text-[var(--color-text-sub)]">稼働</dt>
              <dd className="font-mono tabular-nums text-lg text-[var(--color-text)]">
                {totals.hours.toFixed(1)}
                <span className="text-xs text-[var(--color-text-sub)]">h</span>
              </dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-xs text-[var(--color-text-sub)]">交通費</dt>
              <dd className="font-mono tabular-nums text-[var(--color-text)]">¥{totals.transit.toLocaleString()}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-xs text-[var(--color-text-sub)]">立替金</dt>
              <dd className="font-mono tabular-nums text-[var(--color-text)]">¥{totals.expense.toLocaleString()}</dd>
            </div>
            <div className="border-t border-[var(--color-border)] pt-1.5 flex items-baseline justify-between">
              <dt className="text-xs text-amber-600 font-semibold">合計</dt>
              <dd className="font-mono tabular-nums text-lg text-amber-600">
                {fmtYen(invoiceQ.data?.total)}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="glass rounded-2xl p-4 shadow-md">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[var(--color-text-sub)]">請求書プレビュー — {({ wings: 'Wings', living: 'リビング', techleaders: 'テックリーダーズ', resystems: 'REシステムズ' } as const)[category]}</div>
            <div className="mt-0.5 text-[11px] text-[var(--color-text-sub)]">
              {invoiceQ.data?.invoice_no && <>請求番号: {invoiceQ.data.invoice_no} ／ </>}
              発行日 {invoiceQ.data?.issue_date ?? '—'} ／ 支払期限 {invoiceQ.data?.due_date ?? '—'}
            </div>
          </div>
          <FolderSaveButtons label="請求書" monthFolderName={monthFolderName} fetchSpec={invoiceFetchSpec} onDownloaded={markInvoiceDownloaded} />
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
            <div className="text-[10px] text-[var(--color-text-sub)]">稼働時間</div>
            <div className="font-mono tabular-nums text-lg text-[var(--color-text)]">
              {invoiceQ.data?.hours?.toFixed(1) ?? '—'}
              <span className="ml-1 text-xs text-[var(--color-text-sub)]">h</span>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
            <div className="text-[10px] text-[var(--color-text-sub)]">小計</div>
            <div className="font-mono tabular-nums text-lg text-[var(--color-text)]">{fmtYen(invoiceQ.data?.subtotal)}</div>
          </div>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
            <div className="text-[10px] text-[var(--color-text-sub)]">消費税 ({invoiceQ.data?.tax_rate ?? 10}%)</div>
            <div className="font-mono tabular-nums text-lg text-[var(--color-text)]">{fmtYen(invoiceQ.data?.tax)}</div>
          </div>
          <div className="rounded-xl border border-amber-400/40 bg-amber-50 px-3 py-2">
            <div className="text-[10px] text-amber-600">合計</div>
            <div className="font-mono tabular-nums text-lg text-amber-600">{fmtYen(invoiceQ.data?.total)}</div>
          </div>
        </div>
        {invoiceQ.data?.items && (
          <div className="mt-4 space-y-1 text-xs text-[var(--color-text-sub)]">
            {invoiceQ.data.items.map((it: any, i: number) => (
              <div key={i} className="flex justify-between">
                <span>{it.label}</span>
                <span className="font-mono tabular-nums">
                  {it.qty} × {fmtYen(it.unit_price)} = {fmtYen(it.amount)}
                </span>
              </div>
            ))}
            <button
              onClick={() => {
                setSettingsTab('invoice')
                setSettingsOpen(true)
              }}
              className="mt-2 text-fuchsia-500 hover:text-fuchsia-400"
            >
              ✏️ 単価・控除品目を修正
            </button>
          </div>
        )}
      </div>

      <InvoiceSubmissionPanel
        isAdmin={isAdmin}
        isOsumi={isOsumi}
        year={year}
        month={month}
        category={category}
        pdfDownloaded={invoicePdfDownloaded}
      />

      <div className="glass rounded-xl px-3 py-2 shadow-md flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-[var(--color-text)]">勤怠に同期</div>
          <div className="text-[11px] text-[var(--color-text-sub)]">バックログのタスク（SAP番号 + 期間）から業務報告を自動生成</div>
        </div>
        <div className="flex items-center gap-2">
          {syncWRMsg && <span className="text-[11px] text-emerald-600">{syncWRMsg}</span>}
          <button onClick={syncToWorkReports} disabled={syncingWR}
            className="rounded-md bg-gradient-to-r from-[var(--color-primary)] to-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
            {syncingWR ? '反映中…' : '📋 勤怠に反映'}
          </button>
        </div>
      </div>

      <VoiceCommand onApplied={refetchAll} />

      <WorkReportTable year={year} month={month} period={period} reports={reports} onChanged={refetchAll} defaultTransit={defaultTransit} category={category} asUserId={asUserId} />
      <ExpenseTable year={year} month={month} expenses={expenses} reports={reports} category={category} />

      {me?.can_issue_orders && <PurchaseOrderList me={me} category={category} />}

      <SettingsModal
        open={settingsOpen}
        initialTab={settingsTab}
        year={year}
        month={month}
        onClose={() => setSettingsOpen(false)}
        onSaved={refetchAll}
      />

    </div>
  )
}
