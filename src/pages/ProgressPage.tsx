import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import KanbanBoard from '../components/KanbanBoard'
import * as holidayJp from '@holiday-jp/holiday_jp'

type BLTask = {
  id: number
  issue_key: string
  summary: string
  status_id: number
  status_name: string
  progress: number
  created_on: string | null
  completed_on: string | null
  due_date: string | null
  memo: string | null
  deploy_date: string | null
  deploy_note: string | null
  source: string | null
}

export default function ProgressPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newTask, setNewTask] = useState({ summary: '', memo: '', deploy_note: '', due_date: '', assignee_name: '' })
  const [sheetUrl, setSheetUrl] = useState('https://docs.google.com/spreadsheets/d/14deki-pZJi6uEYxaOvkaiGqTNyjv1fCPdPXcWA3879E/edit')
  const [sheetTabs, setSheetTabs] = useState<string[]>([])
  const [selectedSheet, setSelectedSheet] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [dailyHours, setDailyHours] = useState(8.0)
  const [offDays, setOffDays] = useState<string[]>([])
  const [showOffDays, setShowOffDays] = useState(false)

  const mp = `${year}-${String(month).padStart(2, '0')}`

  const tasksQ = useQuery({
    queryKey: ['backlog_tasks'],
    queryFn: async () => (await api.get<BLTask[]>('/backlog/tasks')).data,
  })

  // カスタム休日を取得
  useEffect(() => {
    api.get('/me').then((r) => setOffDays(r.data.custom_off_days ?? []))
  }, [])

  const sync = async () => {
    setSyncing(true); setSyncMsg(null)
    try {
      const { data } = await api.post('/backlog/sync')
      setSyncMsg(`${data.synced} 件同期`)
      tasksQ.refetch()
    } catch (e: any) { setSyncMsg(e?.response?.data?.error ?? '同期失敗') }
    finally { setSyncing(false) }
  }

  const syncToWorkReports = async () => {
    setSyncing(true); setSyncMsg(null)
    try {
      // まず休日を保存
      await api.patch('/me', { user: { custom_off_days: offDays } })
      const { data } = await api.post('/backlog/sync_to_work_reports', { month: mp, daily_hours: dailyHours })
      setSyncMsg(`勤怠に ${data.applied} 日分を反映しました`)
    } catch (e: any) { setSyncMsg(e?.response?.data?.error ?? '反映失敗') }
    finally { setSyncing(false) }
  }

  const handleTaskMoved = async (taskId: number, newStatusId: number) => {
    await api.patch(`/backlog/tasks/${taskId}`, { status_id: newStatusId })
    tasksQ.refetch()
  }
  const handleMemoChanged = async (taskId: number, memo: string) => {
    await api.patch(`/backlog/tasks/${taskId}`, { memo })
  }
  const handleReorder = async (_: number, orderedIds: number[]) => {
    await api.post('/backlog/reorder', { ids: orderedIds })
    tasksQ.refetch()
  }
  const handleProgressChanged = async (taskId: number, progress: number) => {
    await api.patch(`/backlog/tasks/${taskId}`, { progress_value: progress })
    tasksQ.refetch()
  }
  const handleDeployChanged = async (taskId: number, deploy_date: string, deploy_note: string) => {
    await api.patch(`/backlog/tasks/${taskId}`, { deploy_date, deploy_note })
  }
  const addTask = async () => {
    if (!newTask.summary.trim()) return
    await api.post('/backlog/tasks', newTask)
    setNewTask({ summary: '', memo: '', deploy_note: '', due_date: '', assignee_name: '' })
    setShowAddForm(false)
    tasksQ.refetch()
  }
  const deleteTask = async (id: number) => {
    await api.delete(`/backlog/tasks/${id}`)
    tasksQ.refetch()
  }

  const handleSummaryChanged = async (taskId: number, summary: string) => {
    await api.patch(`/backlog/tasks/${taskId}`, { summary })
  }
  const handleUrlChanged = async (taskId: number, url: string) => {
    await api.patch(`/backlog/tasks/${taskId}`, { url })
    tasksQ.refetch()
  }
  const handleAssigneeChanged = async (taskId: number, name: string) => {
    await api.patch(`/backlog/tasks/${taskId}`, { assignee_name: name })
    tasksQ.refetch()
  }

  const fetchSheetTabs = async () => {
    try {
      const { data } = await api.get('/backlog/sheet_tabs', { params: { spreadsheet_url: sheetUrl } })
      setSheetTabs(data.sheets)
      if (data.sheets.length > 0) setSelectedSheet(data.sheets[0])
    } catch (e: any) { setImportMsg(e?.response?.data?.error ?? 'シート取得失敗') }
  }

  const importSheet = async (sheetName?: string) => {
    setImporting(true); setImportMsg(null)
    try {
      const { data } = await api.post('/backlog/import_sheet', { spreadsheet_url: sheetUrl, sheet_name: sheetName || selectedSheet })
      setImportMsg(`${data.imported} 件インポートしました`)
      tasksQ.refetch()
    } catch (e: any) { setImportMsg(e?.response?.data?.error ?? 'インポート失敗') }
    finally { setImporting(false) }
  }

  // 休日トグル
  const toggleOffDay = (dateStr: string) => {
    setOffDays((prev) => prev.includes(dateStr) ? prev.filter((d) => d !== dateStr) : [...prev, dateStr])
  }

  // 月のカレンダー日一覧（休日選択用）
  const monthDays = (() => {
    const days: { date: string; day: number; dow: number; holiday: string | null }[] = []
    const last = new Date(year, month, 0).getDate()
    for (let d = 1; d <= last; d++) {
      const dt = new Date(year, month - 1, d)
      const hol = holidayJp.between(dt, dt)[0]
      days.push({
        date: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        day: d,
        dow: dt.getDay(),
        holiday: hol?.name ?? null,
      })
    }
    return days
  })()

  const wd = '日月火水木金土'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-2xl font-semibold tracking-tight text-[var(--color-text)]">進捗管理</div>
        <div className="flex items-center gap-3">
          {syncMsg && <span className="text-sm text-emerald-600">{syncMsg}</span>}
          <button onClick={() => setShowAddForm(!showAddForm)} className="rounded-xl bg-[var(--color-primary)] px-5 py-2.5 text-sm font-semibold text-white shadow-md">
            ＋ タスク追加
          </button>
          <button onClick={sync} disabled={syncing} className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-50">
            {syncing ? '同期中…' : '🔄 バックログ同期'}
          </button>
        </div>
      </div>

      {/* タスク追加フォーム */}
      {showAddForm && (
        <div className="glass rounded-2xl p-5 shadow-md">
          <div className="text-sm font-semibold text-[var(--color-text)] mb-3">新規タスク追加</div>
          <div className="grid grid-cols-12 gap-2">
            <input value={newTask.summary} onChange={(e) => setNewTask({ ...newTask, summary: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} placeholder="タイトル（必須）"
              className="col-span-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-sm text-[var(--color-text)] placeholder-gray-400" />
            <input value={newTask.deploy_note} onChange={(e) => setNewTask({ ...newTask, deploy_note: e.target.value })} placeholder="URL"
              className="col-span-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-sm text-[var(--color-text)] placeholder-gray-400" />
            <input value={newTask.memo} onChange={(e) => setNewTask({ ...newTask, memo: e.target.value })} placeholder="備考"
              className="col-span-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-sm text-[var(--color-text)] placeholder-gray-400" />
            <input type="date" value={newTask.due_date} onChange={(e) => setNewTask({ ...newTask, due_date: e.target.value })}
              className="col-span-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-sm text-[var(--color-text)]" />
            <select value={newTask.assignee_name} onChange={(e) => setNewTask({ ...newTask, assignee_name: e.target.value })}
              className="col-span-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-sm text-[var(--color-text)]">
              <option value="">担当者</option>
              <option value="西野 鷹也">西野 鷹也</option>
              <option value="川村卓也">川村卓也</option>
            </select>
            <button onClick={addTask} disabled={!newTask.summary.trim()} className="col-span-1 rounded-lg bg-[var(--color-primary)] py-2.5 text-sm font-semibold text-white disabled:opacity-40">追加</button>
          </div>
        </div>
      )}

      {/* スプレッドシート連携 */}
      <div className="glass rounded-2xl p-5 shadow-md">
        <div className="text-sm font-semibold text-[var(--color-text)]">Google スプレッドシート連携</div>
        <div className="text-xs text-[var(--color-text-sub)]">書き出し: DB → シート / インポート: シート → DB（A列idで更新、無ければ追加）</div>
        <div className="mt-3">
          <input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="スプレッドシートの URL"
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-sm text-[var(--color-text)] placeholder-gray-400" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={async () => {
            setExporting(true); setImportMsg(null)
            try {
              const { data } = await api.post('/backlog/export_sheet', { spreadsheet_url: sheetUrl })
              setImportMsg(`書き出し完了: 現在のタスク ${data.active} 件 / 完了タスク ${data.completed} 件`)
            } catch (e: any) { setImportMsg(e?.response?.data?.error ?? '書き出し失敗') }
            finally { setExporting(false) }
          }} disabled={exporting || !sheetUrl}
            className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-50">
            {exporting ? '書き出し中…' : '📤 スプレッドシートに書き出し'}
          </button>
          <button onClick={async () => {
            setImporting(true); setImportMsg(null)
            try {
              const { data } = await api.post('/backlog/import_sheet', { spreadsheet_url: sheetUrl })
              setImportMsg(`${data.imported} 件インポートしました`)
              window.location.reload()
            } catch (e: any) { setImportMsg(e?.response?.data?.error ?? 'インポート失敗') }
            finally { setImporting(false) }
          }} disabled={importing || !sheetUrl}
            className="rounded-xl bg-gradient-to-r from-sky-500 to-blue-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-50">
            {importing ? 'インポート中…' : '📥 スプレッドシートからインポート'}
          </button>
        </div>
        {importMsg && <div className="mt-2 text-xs text-emerald-600">{importMsg}</div>}
      </div>

      {/* 勤怠同期 + 休日設定 */}
      <div className="glass rounded-2xl p-5 shadow-md">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-[var(--color-text)]">勤怠に同期</div>
            <div className="text-xs text-[var(--color-text-sub)]">バックログのタスクから業務報告を自動生成</div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-sub)]">
              1日
              <input type="number" value={dailyHours} onChange={(e) => setDailyHours(Number(e.target.value))} step={0.5} min={0} max={24}
                className="w-16 rounded border border-[var(--color-border)] bg-white px-2 py-1 text-center text-sm font-mono text-[var(--color-text)]" />
              h
            </label>
            <button onClick={syncToWorkReports} disabled={syncing}
              className="rounded-xl bg-gradient-to-r from-[var(--color-primary)] to-fuchsia-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-50">
              {syncing ? '反映中…' : '📋 勤怠に反映'}
            </button>
          </div>
        </div>
        <button onClick={() => setShowOffDays(!showOffDays)}
          className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
          📅 休日設定 <span className="text-xs font-normal text-[var(--color-text-sub)]">({offDays.length} 日追加)</span>
        </button>
        {showOffDays && (
          <div className="mt-4">
            <div className="text-xs text-[var(--color-text-sub)] mb-2">クリックで休日ON/OFF（土日祝はデフォルト休日）</div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {wd.split('').map((w, i) => (
                <div key={w} className={`text-[10px] font-semibold py-1 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-[var(--color-text-sub)]'}`}>{w}</div>
              ))}
              {Array.from({ length: monthDays[0]?.dow ?? 0 }).map((_, i) => <div key={`e${i}`} />)}
              {monthDays.map((d) => {
                const isWeekend = d.dow === 0 || d.dow === 6
                const isHoliday = !!d.holiday
                const isCustomOff = offDays.includes(d.date)
                return (
                  <button key={d.date} onClick={() => !(isWeekend || isHoliday) && toggleOffDay(d.date)}
                    className={`rounded-lg py-1.5 text-xs transition ${
                      isCustomOff ? 'bg-red-500 text-white font-bold' :
                      isWeekend || isHoliday ? 'bg-red-100 text-red-400 cursor-default' :
                      'bg-white text-[var(--color-text)] hover:bg-gray-100 border border-[var(--color-border)]'
                    }`}
                    title={d.holiday ?? (isCustomOff ? '追加休日' : '')}
                  >{d.day}</button>
                )
              })}
            </div>
            <div className="mt-2 flex gap-4 text-[10px] text-[var(--color-text-sub)]">
              <span><span className="inline-block w-3 h-3 rounded bg-red-100 mr-1" />土日祝</span>
              <span><span className="inline-block w-3 h-3 rounded bg-red-500 mr-1" />追加休日</span>
            </div>
            <button onClick={async () => { await api.patch('/me', { user: { custom_off_days: offDays } }); setSyncMsg('休日保存しました') }}
              className="mt-3 rounded-lg bg-[var(--color-primary)] px-4 py-1.5 text-xs font-semibold text-white">保存</button>
          </div>
        )}
      </div>

      {/* カンバンボード */}
      <KanbanBoard
        tasks={tasksQ.data ?? []}
        onTaskMoved={handleTaskMoved}
        onMemoChanged={handleMemoChanged}
        onReorder={handleReorder}
        onProgressChanged={handleProgressChanged}
        onDeployChanged={handleDeployChanged}
        onDelete={deleteTask}
        onSummaryChanged={handleSummaryChanged}
        onUrlChanged={handleUrlChanged}
        onAssigneeChanged={handleAssigneeChanged}
      />
    </div>
  )
}
