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
// CalendarView moved to /calendar page

const todayIso = () => new Date().toISOString().slice(0, 10)

export default function Dashboard() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'account' | 'invoice'>('account')
  const [defaultTransit, setDefaultTransit] = useState<{ section: string; fee: number } | null>(null)
  const [category, setCategory] = useState<'wings' | 'living' | 'techleaders' | 'resystems'>('wings')
  const [me, setMe] = useState<Me | null>(null)

  const monthParam = `${year}-${String(month).padStart(2, '0')}`

  const reportsQ = useQuery({
    queryKey: ['work_reports', monthParam],
    queryFn: async () => (await api.get<WorkReportResponse>('/work_reports', { params: { month: monthParam } })).data,
  })
  const expensesQ = useQuery({
    queryKey: ['expenses', monthParam],
    queryFn: async () => (await api.get<ExpenseResponse>('/expenses', { params: { month: monthParam } })).data,
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
    queryKey: ['invoice_preview', monthParam, category],
    queryFn: async () => (await api.get('/invoice_preview', { params: { month: monthParam, category: category } })).data,
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
    })
  }, [year, month])

  const refetchAll = () => {
    reportsQ.refetch()
    expensesQ.refetch()
    invoiceQ.refetch()
  }

  const downloadInvoice = async () => {
    const res = await api.get('/exports/invoice.pdf', {
      params: { month: monthParam, category: category },
      responseType: 'blob',
    })
    const url = URL.createObjectURL(res.data as Blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `請求書_${year}年_${month}月分.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const [saveDirOpen, setSaveDirOpen] = useState(false)
  const [saveDir, setSaveDir] = useState<string>('')
  const [savingMsg, setSavingMsg] = useState<string | null>(null)
  const [dirInfo, setDirInfo] = useState<{ path: string; exists: boolean; entries: string[] } | null>(null)

  const fetchDirInfo = async (path: string) => {
    if (!path) { setDirInfo(null); return }
    try {
      const r = await api.get('/exports/list_dirs', { params: { path, year, month, category } })
      setDirInfo(r.data)
    } catch (e: any) {
      setDirInfo({ path: '', exists: false, entries: [] })
    }
  }

  const openSaveDirDialog = async () => {
    setSavingMsg(null)
    try {
      const r = await api.get('/me')
      const value = r.data.local_save_dir ?? ''
      setSaveDir(value)
      fetchDirInfo(value)
    } catch {}
    setSaveDirOpen(true)
  }

  const pickFolderViaOs = async () => {
    setSavingMsg(null)
    try {
      const r = await api.post('/exports/pick_dir')
      if (r.data?.path) {
        setSaveDir(r.data.path)
        fetchDirInfo(r.data.path)
      }
    } catch (e: any) {
      setSavingMsg(`フォルダ選択失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }

  const persistSaveDir = async () => {
    setSavingMsg(null)
    try {
      await api.patch('/me', { user: { local_save_dir: saveDir } })
      setSavingMsg('保存先を更新しました')
    } catch (e: any) {
      setSavingMsg(`保存先の更新失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }

  const saveInvoiceLocal = async () => {
    setSavingMsg(null)
    try {
      const res = await api.get('/exports/invoice.pdf', { params: { month: monthParam, category: category, save_local: true } })
      alert(`保存しました:\n${(res.data as any)?.saved_to}`)
    } catch (e: any) {
      alert(`保存失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
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
          <div className="flex gap-1">
            {(() => {
              const isAdmin = (me?.display_name ?? '').includes('西野')
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
          <div className="flex gap-1.5">
            <button
              onClick={openSaveDirDialog}
              className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs font-semibold text-[var(--color-text-sub)] hover:bg-gray-50"
              title="保存先フォルダの設定"
            >
              ⚙ 保存先フォルダ
            </button>
            <button
              onClick={saveInvoiceLocal}
              className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow"
              title="現在の保存先フォルダに保存"
            >
              📁 保存
            </button>
          </div>
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

      <WorkReportTable year={year} month={month} period={period} reports={reports} onChanged={refetchAll} defaultTransit={defaultTransit} category={category} />
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

      {saveDirOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-6 backdrop-blur" onClick={() => setSaveDirOpen(false)}>
          <div className="glass w-full max-w-xl rounded-3xl p-7 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">📁 保存先フォルダ</div>
              <button onClick={() => setSaveDirOpen(false)} className="text-[var(--color-text-sub)]">×</button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-xs text-[var(--color-text-sub)]">
                フォルダパス（プレースホルダ可: <code>{'{year} {month} {cat} {name}'}</code>）
              </label>
              <textarea
                rows={2}
                value={saveDir}
                onChange={(e) => { setSaveDir(e.target.value); fetchDirInfo(e.target.value) }}
                placeholder="/Users/.../12 請求書類/{year}年/{cat}/請求書"
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm font-mono text-[var(--color-text)]"
              />
              <div className="text-[11px] text-[var(--color-text-sub)]">
                末尾に <code>{`{月}月`}</code> フォルダが自動付与されます。最終保存先: <span className="font-mono">{saveDir.replace('{year}', String(year)).replace('{month}', String(month)).replace('{cat}', ({ wings: 'TAMA', living: 'Living', techleaders: 'テックリーダーズ', resystems: 'REシステムズ' } as const)[category])}/{month}月/</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={pickFolderViaOs} className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs hover:bg-gray-50">
                  📂 macOS のフォルダ選択を開く
                </button>
                <button onClick={() => fetchDirInfo(saveDir)} className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs hover:bg-gray-50">
                  🔄 配下のフォルダを再取得
                </button>
              </div>

              {dirInfo && (
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 space-y-2">
                  <div className="text-[11px] text-[var(--color-text-sub)]">
                    解決後パス: <span className="font-mono">{dirInfo.path || '(取得失敗)'}</span>
                  </div>
                  {!dirInfo.exists ? (
                    <div className="text-[11px] text-amber-600">⚠️ このフォルダは存在しません（保存時に自動作成されます）</div>
                  ) : (
                    <>
                      <div className="text-[11px] text-[var(--color-text-sub)]">配下のフォルダ（クリックで子階層に潜る）:</div>
                      <div className="flex flex-wrap gap-1">
                        {dirInfo.entries.length === 0 && <span className="text-[11px] text-[var(--color-text-sub)]">（空）</span>}
                        {dirInfo.entries.map((entry) => {
                          const isMonth = entry === `${month}月`
                          return (
                            <button
                              key={entry}
                              type="button"
                              onClick={() => {
                                const next = `${dirInfo.path}/${entry}`
                                setSaveDir(next)
                                fetchDirInfo(next)
                              }}
                              className={`rounded px-2 py-1 text-[11px] border ${isMonth ? 'bg-emerald-100 border-emerald-300 text-emerald-700 font-semibold' : 'bg-white border-[var(--color-border)] hover:bg-gray-50'}`}
                              title={isMonth ? '今月分のフォルダ' : ''}
                            >
                              📁 {entry}{isMonth && ' ✓'}
                            </button>
                          )
                        })}
                      </div>
                      {!dirInfo.entries.includes(`${month}月`) && (
                        <div className="text-[11px] text-amber-600">⚠️ <code>{month}月</code> フォルダは未作成（保存時に自動作成されます）</div>
                      )}
                    </>
                  )}
                </div>
              )}
              {savingMsg && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 whitespace-pre-wrap">{savingMsg}</div>}
            </div>
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setSaveDirOpen(false)} className="rounded-xl border border-[var(--color-border)] bg-white px-4 py-2 text-sm">閉じる</button>
              <button
                onClick={persistSaveDir}
                className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-2 text-sm font-semibold text-white shadow-md"
              >
                保存先を更新
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
