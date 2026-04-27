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
import { getStoredDirHandle, saveDirHandle, ensureRwPermission, clearDirHandle } from '../lib/dirHandleStore'
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
    if (savingBusy) return
    setSavingBusy(true); setSavingMsg(null)
    try {
      const res = await api.get('/exports/invoice.pdf', {
        params: { month: monthParam, category },
        responseType: 'blob',
      })
      const surname = (me?.display_name ?? '').split(/[\s　]/)[0] ?? ''
      const baseName = `請求書_${year}年_${month}月分.pdf`
      const filename = surname ? `${surname}_${baseName}` : baseName
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setLastSavedTo(`Downloads/${filename}`)
      setSavingMsg('ダウンロードしました')
    } catch (e: any) {
      setSavingMsg(`失敗: ${e?.message ?? ''}`)
    } finally {
      setSavingBusy(false)
    }
  }

  const [savingMsg, setSavingMsg] = useState<string | null>(null)
  const [lastSavedTo, setLastSavedTo] = useState<string | null>(null)
  const [savingBusy, setSavingBusy] = useState(false)
  const [savedDirName, setSavedDirName] = useState<string | null>(null)

  const HANDLE_KEY = 'invoice-save-root'
  const fsaSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window

  // マウント時に保存済みハンドルがあれば復元（権限再取得は picker 押下時に行う）
  useEffect(() => {
    if (!fsaSupported) return
    getStoredDirHandle(HANDLE_KEY).then((h) => { if (h) setSavedDirName(h.name) })
  }, [fsaSupported])

  // 共通: 渡された dirHandle に PDF を {月}月/ファイル名 で書き込む
  const writeInvoiceTo = async (dirHandle: FileSystemDirectoryHandle): Promise<string> => {
    const monthFolderName = `${month}月`
    const monthDir = await dirHandle.getDirectoryHandle(monthFolderName, { create: true })

    const res = await api.get('/exports/invoice.pdf', {
      params: { month: monthParam, category },
      responseType: 'blob',
    })
    const surname = (me?.display_name ?? '').split(/[\s　]/)[0] ?? ''
    const baseName = `請求書_${year}年_${month}月分.pdf`
    const filename = surname ? `${surname}_${baseName}` : baseName

    const fileHandle = await monthDir.getFileHandle(filename, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(res.data as Blob)
    await writable.close()
    return `${dirHandle.name}/${monthFolderName}/${filename}`
  }

  // 「📁 ここに保存」: 既に記憶しているフォルダがあれば即書き込み（picker 出さない）
  const saveToRememberedFolder = async () => {
    if (savingBusy) return
    setSavingBusy(true); setSavingMsg(null)
    try {
      const stored = await getStoredDirHandle(HANDLE_KEY)
      if (!stored) { setSavingMsg('保存先が未設定です。「フォルダを変更」からどうぞ'); return }
      const ok = await ensureRwPermission(stored)
      if (!ok) { setSavingMsg('書き込み権限が拒否されました'); return }
      const where = await writeInvoiceTo(stored)
      setLastSavedTo(where); setSavingMsg('保存しました')
    } catch (e: any) {
      setSavingMsg(`保存失敗: ${e?.message ?? ''}`)
    } finally {
      setSavingBusy(false)
    }
  }

  // 「📂 フォルダを変更（または初回設定）」: picker → IndexedDB に記憶 → 即書き込み
  const pickFolderAndSave = async () => {
    if (savingBusy) return
    if (!fsaSupported) {
      setSavingMsg('お使いのブラウザはフォルダ選択 API 非対応です（Chrome / Edge / Brave をご利用ください）')
      return
    }
    setSavingBusy(true); setSavingMsg(null)
    try {
      const win = window as unknown as { showDirectoryPicker: (opts?: any) => Promise<FileSystemDirectoryHandle> }
      const dirHandle = await win.showDirectoryPicker({ mode: 'readwrite' })
      await saveDirHandle(HANDLE_KEY, dirHandle)
      setSavedDirName(dirHandle.name)
      const where = await writeInvoiceTo(dirHandle)
      setLastSavedTo(where); setSavingMsg('保存しました')
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setSavingMsg('キャンセルしました')
      } else if (typeof e?.message === 'string' && e.message.includes('system files')) {
        setSavingMsg('Chrome の制約でこのフォルダは使えません。Documents 配下など、書き込み可能な場所を選んでください')
      } else {
        setSavingMsg(`保存失敗: ${e?.message ?? ''}`)
      }
    } finally {
      setSavingBusy(false)
    }
  }

  // 「保存先を解除」
  const forgetSavedFolder = async () => {
    await clearDirHandle(HANDLE_KEY)
    setSavedDirName(null)
    setSavingMsg('保存先を解除しました')
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
          <div className="flex flex-col items-end gap-1">
            <div className="flex gap-1.5">
              {savedDirName && (
                <button
                  onClick={saveToRememberedFolder}
                  disabled={savingBusy}
                  className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50"
                  title={`記憶済み: ${savedDirName}/${month}月/`}
                >
                  {savingBusy ? '保存中…' : `📁 ${savedDirName}/${month}月 に保存`}
                </button>
              )}
              <button
                onClick={pickFolderAndSave}
                disabled={savingBusy}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold shadow disabled:opacity-50 ${
                  savedDirName ? 'bg-white border border-[var(--color-border)] text-[var(--color-text-sub)] hover:bg-gray-50' : 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white'
                }`}
                title="フォルダ選択ダイアログを開く"
              >
                {savedDirName ? '📂 フォルダを変更' : '📂 フォルダを選んで保存'}
              </button>
              <button
                onClick={downloadInvoice}
                disabled={savingBusy}
                className="rounded-lg bg-white border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-sub)] hover:bg-gray-50 disabled:opacity-50"
                title="ブラウザのダウンロードフォルダに保存"
              >
                📥 ダウンロード
              </button>
            </div>
            {savedDirName && (
              <button onClick={forgetSavedFolder} className="text-[10px] text-[var(--color-text-sub)] hover:text-red-500">
                記憶済み保存先を解除
              </button>
            )}
            {(lastSavedTo || savingMsg) && (
              <div className="max-w-[420px] text-right text-[10px] text-[var(--color-text-sub)] break-all">
                {savingMsg && <div className={savingMsg.startsWith('保存しました') || savingMsg.startsWith('ダウンロードしました') ? 'text-emerald-600' : 'text-red-500'}>{savingMsg}</div>}
                {lastSavedTo && <div className="font-mono">{lastSavedTo}</div>}
              </div>
            )}
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

    </div>
  )
}
