import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import KanbanBoard from '../components/KanbanBoard'
import WorkspaceTabs from '../components/progress/WorkspaceTabs'
import type { ProgressWorkspace } from '../components/progress/WorkspaceTabs'

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
  assignee_name: string | null
  assignee_id: number | null
  url: string | null
  did_previous: boolean
  do_today: boolean
}

export default function ProgressPage() {
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newTask, setNewTask] = useState({ summary: '', memo: '', deploy_note: '', due_date: '', assignee_name: '' })
  const [sheetUrl, setSheetUrl] = useState('')

  // ワークスペース切替タブ
  const [workspaces, setWorkspaces] = useState<ProgressWorkspace[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null)
  const [workspaceMsg, setWorkspaceMsg] = useState<string | null>(null)
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null

  useEffect(() => {
    api.get<ProgressWorkspace[]>('/progress_workspaces').then((r) => {
      const fetchedWorkspaces = r.data
      setWorkspaces(fetchedWorkspaces)
      const savedWorkspaceId = Number(localStorage.getItem('progressWorkspaceId'))
      const savedWorkspaceExists = fetchedWorkspaces.some((workspace) => workspace.id === savedWorkspaceId)
      setSelectedWorkspaceId(savedWorkspaceExists ? savedWorkspaceId : (fetchedWorkspaces[0]?.id ?? null))
    })
  }, [])

  const selectWorkspace = (workspaceId: number) => {
    setSelectedWorkspaceId(workspaceId)
    localStorage.setItem('progressWorkspaceId', String(workspaceId))
  }

  const addWorkspace = async (name: string) => {
    setWorkspaceMsg(null)
    try {
      const { data } = await api.post<ProgressWorkspace>('/progress_workspaces', { name, source_type: 'manual' })
      setWorkspaces((prev) => [...prev, data])
      selectWorkspace(data.id)
    } catch (e: any) { setWorkspaceMsg(e?.response?.data?.error ?? 'ワークスペース追加に失敗しました') }
  }

  const deleteWorkspace = async (workspaceId: number) => {
    setWorkspaceMsg(null)
    try {
      await api.delete(`/progress_workspaces/${workspaceId}`)
      const remainingWorkspaces = workspaces.filter((workspace) => workspace.id !== workspaceId)
      setWorkspaces(remainingWorkspaces)
      if (selectedWorkspaceId === workspaceId) selectWorkspace(remainingWorkspaces[0]?.id ?? 0)
    } catch (e: any) { setWorkspaceMsg(e?.response?.data?.error ?? 'ワークスペース削除に失敗しました') }
  }
  // 自分の progress_sheet_url を初期ロード (西野はデフォあり、川村はなし)
  useEffect(() => {
    api.get<{ progress_sheet_url?: string | null }>('/me')
      .then((r) => { if (r.data.progress_sheet_url) setSheetUrl(r.data.progress_sheet_url) })
      .catch(() => {})
  }, [])
  // sheetUrl を DB に保存 (書き出し時呼ぶ)
  const persistSheetUrl = async (url: string) => {
    try { await api.patch('/me', { user: { progress_sheet_url: url } }) }
    catch {}
  }
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)


  const tasksQ = useQuery({
    queryKey: ['backlog_tasks', selectedWorkspaceId],
    queryFn: async () => (await api.get<BLTask[]>('/backlog/tasks', { params: { workspace_id: selectedWorkspaceId } })).data,
    enabled: selectedWorkspaceId != null,
  })

  const sync = async () => {
    setSyncing(true); setSyncMsg(null)
    try {
      const { data } = await api.post('/backlog/sync')
      setSyncMsg(`${data.synced} 件同期`)
      tasksQ.refetch()
    } catch (e: any) { setSyncMsg(e?.response?.data?.error ?? '同期失敗') }
    finally { setSyncing(false) }
  }

  const syncNotion = async () => {
    setSyncing(true); setSyncMsg(null)
    try {
      const { data } = await api.post('/backlog/sync_notion')
      setSyncMsg(`${data.synced} 件同期`)
      tasksQ.refetch()
    } catch (e: any) { setSyncMsg(e?.response?.data?.error ?? '同期失敗') }
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
    await api.post('/backlog/tasks', { ...newTask, workspace_id: selectedWorkspaceId })
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
  const handleFlagChanged = async (taskId: number, patch: { did_previous?: boolean; do_today?: boolean }) => {
    await api.patch(`/backlog/tasks/${taskId}`, patch)
    tasksQ.refetch()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="whitespace-nowrap text-xl font-semibold tracking-tight text-[var(--color-text)] sm:text-2xl">進捗管理</div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {syncMsg && <span className="text-sm text-emerald-600">{syncMsg}</span>}
          <button onClick={() => setShowAddForm(!showAddForm)} className="whitespace-nowrap rounded-xl bg-[var(--color-primary)] px-3 py-2 text-xs font-semibold text-white shadow-md sm:px-5 sm:py-2.5 sm:text-sm">
            ＋ タスク追加
          </button>
          {selectedWorkspace?.source_type === 'backlog' && (
            <button onClick={sync} disabled={syncing} className="whitespace-nowrap rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-2 text-xs font-semibold text-white shadow-md disabled:opacity-50 sm:px-5 sm:py-2.5 sm:text-sm">
              {syncing ? '同期中…' : '🔄 バックログ同期'}
            </button>
          )}
          {selectedWorkspace?.source_type === 'notion' && (
            <button onClick={syncNotion} disabled={syncing} className="whitespace-nowrap rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-2 text-xs font-semibold text-white shadow-md disabled:opacity-50 sm:px-5 sm:py-2.5 sm:text-sm">
              {syncing ? '同期中…' : '🔄 Notion同期'}
            </button>
          )}
        </div>
      </div>

      {/* ワークスペース切替タブ */}
      <div className="glass rounded-2xl p-3 shadow-md">
        <WorkspaceTabs
          workspaces={workspaces}
          selectedWorkspaceId={selectedWorkspaceId}
          onSelect={selectWorkspace}
          onAdd={addWorkspace}
          onDelete={deleteWorkspace}
        />
        {workspaceMsg && <div className="mt-2 text-xs text-red-500">{workspaceMsg}</div>}
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

      {/* スプレッドシート連携（Backlogタブのみ） */}
      {selectedWorkspace?.source_type === 'backlog' && (
      <div className="glass rounded-2xl p-5 shadow-md">
        <div className="text-sm font-semibold text-[var(--color-text)]">Google スプレッドシート連携</div>
        <div className="text-xs text-[var(--color-text-sub)]">書き出し: DB → シート / インポート: シート → DB（A列idで更新、無ければ追加）</div>
        <div className="mt-3 flex gap-2">
          <input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="スプレッドシートの URL"
            className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-sm text-[var(--color-text)] placeholder-gray-400" />
          <a
            href={sheetUrl || '#'}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => { if (!sheetUrl) e.preventDefault() }}
            className={`rounded-lg whitespace-nowrap px-3 py-2.5 text-sm font-semibold shadow-md ${sheetUrl ? 'bg-gradient-to-r from-sky-500 to-indigo-500 text-white hover:opacity-90' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
            title="スプレッドシートを別タブで開く"
          >
            🔗 開く
          </a>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={async () => {
            setExporting(true); setImportMsg(null)
            try {
              const { data } = await api.post('/backlog/export_sheet', { spreadsheet_url: sheetUrl })
              await persistSheetUrl(sheetUrl)  // 書き出し成功 → DB に URL 保存
              setImportMsg(`書き出し完了: 現在のタスク ${data.active} 件 / 完了タスク ${data.completed} 件`)
            } catch (e: any) { setImportMsg(e?.response?.data?.error ?? '書き出し失敗') }
            finally { setExporting(false) }
          }} disabled={exporting || !sheetUrl}
            className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-50">
            {exporting ? '書き出し中…' : '📤 全タスクを書き出し'}
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
            {importing ? 'インポート中…' : '📥 全タスクをインポート'}
          </button>
          <button onClick={async () => {
            setExporting(true); setImportMsg(null)
            try {
              const { data } = await api.post('/backlog/export_sheet', { spreadsheet_url: sheetUrl, only_flagged: true })
              await persistSheetUrl(sheetUrl)
              setImportMsg(`前回/今日 書き出し完了: ${data.active} 件`)
            } catch (e: any) { setImportMsg(e?.response?.data?.error ?? '書き出し失敗') }
            finally { setExporting(false) }
          }} disabled={exporting || !sheetUrl}
            className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-50"
            title="do_today か did_previous フラグの立ったタスクのみ書き出し (シート名: 前回/今日 (フラグ付))">
            {exporting ? '書き出し中…' : '⭐ 前回/今日のみ書き出し'}
          </button>
          <button onClick={async () => {
            setImporting(true); setImportMsg(null)
            try {
              const { data } = await api.post('/backlog/import_sheet', { spreadsheet_url: sheetUrl, only_flagged: true })
              setImportMsg(`前回/今日 ${data.imported} 件インポートしました`)
              window.location.reload()
            } catch (e: any) { setImportMsg(e?.response?.data?.error ?? 'インポート失敗') }
            finally { setImporting(false) }
          }} disabled={importing || !sheetUrl}
            className="rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-50"
            title="シート「前回/今日 (フラグ付)」から差分インポート">
            {importing ? 'インポート中…' : '⭐ 前回/今日のみインポート'}
          </button>
        </div>
        {importMsg && <div className="mt-2 text-xs text-emerald-600">{importMsg}</div>}
      </div>
      )}

      {/* 勤怠同期 + 休日設定 — カレンダーで同等機能を提供しているため非表示 (2026-05-13)
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
      */}

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
        onFlagChanged={handleFlagChanged}
      />
    </div>
  )
}
