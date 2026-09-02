import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import KanbanBoard from '../components/KanbanBoard'
import NotionLineReportModal from '../components/NotionLineReportModal'
import WorkspaceTabs from '../components/progress/WorkspaceTabs'
import type { ProgressWorkspace } from '../components/progress/WorkspaceTabs'
import { sortTasks } from '../components/progress/board'
import type { BLTask } from '../components/progress/board'

// 読み込み前に毎回新しい配列を渡すとカンバン側の再計算が無駄に走るので固定する。
const NO_TASKS: BLTask[] = []

export default function ProgressPage() {
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addingTask, setAddingTask] = useState(false)
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
  // 表示名と admin かどうかは、担当者フィルタの初期値(本人 or 全担当者)を決めるのに使う
  const [me, setMe] = useState<{ display_name?: string | null; admin?: boolean }>({})
  useEffect(() => {
    api.get<{ display_name?: string | null; admin?: boolean }>('/me')
      .then((r) => setMe({ display_name: r.data.display_name, admin: r.data.admin }))
      .catch(() => {})
  }, [])

  // スプレッドシートは Wing とリビングで別物なので、ワークスペースごとに持つ。
  // タブを切り替えたら、そのワークスペースに保存されたURLへ入れ替える。
  useEffect(() => {
    setSheetUrl(selectedWorkspace?.sheet_url ?? '')
  }, [selectedWorkspaceId, selectedWorkspace?.sheet_url])

  // sheetUrl を選択中のワークスペースへ保存 (書き出し時に呼ぶ)
  const persistSheetUrl = async (url: string) => {
    if (!selectedWorkspaceId) return
    try {
      await api.patch(`/progress_workspaces/${selectedWorkspaceId}`, { sheet_url: url })
      setWorkspaces((current) =>
        current.map((workspace) => (workspace.id === selectedWorkspaceId ? { ...workspace, sheet_url: url } : workspace)),
      )
    } catch { /* 保存に失敗しても書き出し自体は成功しているので黙って続ける */ }
  }
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  // 楽観更新は画面を先に進めるので、保存が落ちたことは明示しないと気付けない。
  const [saveError, setSaveError] = useState<string | null>(null)


  const queryClient = useQueryClient()
  const tasksQueryKey = useMemo(() => ['backlog_tasks', selectedWorkspaceId], [selectedWorkspaceId])

  const tasksQ = useQuery({
    queryKey: tasksQueryKey,
    queryFn: async () => (await api.get<BLTask[]>('/backlog/tasks', { params: { workspace_id: selectedWorkspaceId } })).data,
    enabled: selectedWorkspaceId != null,
  })

  // 保存のたびに一覧を取り直していたので、ドラッグも入力も往復2回ぶん待たされていた。
  // 画面はキャッシュを先に書き換えて即座に動かし、サーバ応答は後から突き合わせる。
  const updateCachedTasks = useCallback((update: (tasks: BLTask[]) => BLTask[]) => {
    queryClient.setQueryData<BLTask[]>(tasksQueryKey, (cached) => (cached ? sortTasks(update(cached)) : cached))
  }, [queryClient, tasksQueryKey])

  const mergeCachedTask = useCallback((taskId: number, patch: Partial<BLTask>) => {
    updateCachedTasks((tasks) => tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)))
  }, [updateCachedTasks])

  // 保存に失敗したときは楽観更新を捨ててサーバの状態に戻し、黙って無かったことにしない。
  const recoverFromSaveFailure = useCallback(() => {
    setSaveError('保存に失敗しました。通信状態を確認してください')
    queryClient.invalidateQueries({ queryKey: tasksQueryKey })
  }, [queryClient, tasksQueryKey])

  // 先に画面へ反映し、そのあと保存する。
  // 応答は丸ごと取り込まず、サーバ側でしか決まらない値だけを拾う。
  // 全部マージすると、後から届いた古い応答が編集中の備考などを画面から消してしまう。
  const saveTask = useCallback(async (
    taskId: number,
    payload: Record<string, unknown>,
    shownImmediately: Partial<BLTask>,
    { takeServerStatus = false }: { takeServerStatus?: boolean } = {},
  ) => {
    mergeCachedTask(taskId, shownImmediately)
    try {
      const { data } = await api.patch<BLTask>(`/backlog/tasks/${taskId}`, payload)
      setSaveError(null)
      if (takeServerStatus) {
        mergeCachedTask(taskId, { status_name: data.status_name, progress: data.progress, completed_on: data.completed_on })
      }
    } catch {
      recoverFromSaveFailure()
    }
  }, [mergeCachedTask, recoverFromSaveFailure])

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

  const syncTrello = async () => {
    setSyncing(true); setSyncMsg(null)
    try {
      const { data } = await api.post('/backlog/sync_trello')
      setSyncMsg(`${data.synced} 件同期`)
      tasksQ.refetch()
    } catch (e: any) { setSyncMsg(e?.response?.data?.error ?? '同期失敗') }
    finally { setSyncing(false) }
  }

  // プライベートTodo ⇄ 専用Googleカレンダー。取込ボタン。登録(追加/更新/削除)はサーバ側で自動反映。
  const importCalendar = async () => {
    setSyncing(true); setSyncMsg(null)
    try {
      const { data } = await api.post('/backlog/import_calendar')
      setSyncMsg(`カレンダーから ${data.imported} 件取込`)
      tasksQ.refetch()
    } catch (e: any) { setSyncMsg(e?.response?.data?.error ?? 'カレンダー取込に失敗しました') }
    finally { setSyncing(false) }
  }

  // ステータスは進捗率・完了日もサーバ側で決まるので、応答を取り込んで揃える。
  const handleTaskMoved = useCallback((taskId: number, newStatusId: number) => {
    saveTask(taskId, { status_id: newStatusId }, { status_id: newStatusId }, { takeServerStatus: true })
  }, [saveTask])

  const handleMemoChanged = useCallback((taskId: number, memo: string) => {
    saveTask(taskId, { memo }, { memo })
  }, [saveTask])

  // サーバは受け取った id に position を 0..n-1 で振り直すので、画面側も同じ規則で持たせる。
  // (KanbanBoard から渡ってくるのは、絞り込みで隠れている分も含めたその列の全 id)
  const handleReorder = useCallback(async (_statusId: number, orderedIds: number[]) => {
    const positionOf = new Map(orderedIds.map((id, index) => [id, index]))
    updateCachedTasks((tasks) => tasks.map((task) => {
      const position = positionOf.get(task.id)
      return position === undefined ? task : { ...task, position }
    }))
    try {
      await api.post('/backlog/reorder', { ids: orderedIds })
      setSaveError(null)
    } catch {
      recoverFromSaveFailure()
    }
  }, [updateCachedTasks, recoverFromSaveFailure])

  const handleProgressChanged = useCallback((taskId: number, progress: number) => {
    saveTask(taskId, { progress_value: progress }, { progress })
  }, [saveTask])

  const handleDeployChanged = useCallback((taskId: number, patch: { deploy_date?: string; deploy_note?: string }) => {
    saveTask(taskId, patch, patch)
  }, [saveTask])
  // 送信中はボタンを塞ぐ。塞がないとレスポンスが返るまで画面が変わらないので、
  // 連打された分だけ Todo が増える(=Googleカレンダーにも同じ予定が増える)。
  const addTask = async () => {
    if (addingTask || !newTask.summary.trim()) return
    setAddingTask(true)
    try {
      await api.post('/backlog/tasks', { ...newTask, workspace_id: selectedWorkspaceId })
      setNewTask({ summary: '', memo: '', deploy_note: '', due_date: '', assignee_name: '' })
      setShowAddForm(false)
      tasksQ.refetch()
    } finally {
      setAddingTask(false)
    }
  }
  const deleteTask = useCallback(async (id: number) => {
    updateCachedTasks((tasks) => tasks.filter((task) => task.id !== id))
    try {
      await api.delete(`/backlog/tasks/${id}`)
    } catch {
      recoverFromSaveFailure()
    }
  }, [updateCachedTasks, recoverFromSaveFailure])

  const handleSummaryChanged = useCallback((taskId: number, summary: string) => {
    saveTask(taskId, { summary }, { summary })
  }, [saveTask])

  const handleUrlChanged = useCallback((taskId: number, url: string) => {
    saveTask(taskId, { url }, { url })
  }, [saveTask])

  const handleAssigneeChanged = useCallback((taskId: number, name: string) => {
    saveTask(taskId, { assignee_name: name }, { assignee_name: name })
  }, [saveTask])

  const handleFlagChanged = useCallback((taskId: number, patch: { did_previous?: boolean; do_today?: boolean }) => {
    saveTask(taskId, patch, patch)
  }, [saveTask])

  // リビング(Notion)タスクの LINE 報告: 「LINE報告」にチェックしたタスクの文面を組み立てて
  // 西野さんの LINE へ送る。文面はモーダルで確認・編集できる。
  const [lineSelectedIds, setLineSelectedIds] = useState<Set<number>>(new Set())
  const [lineModalOpen, setLineModalOpen] = useState(false)
  useEffect(() => { setLineSelectedIds(new Set()) }, [selectedWorkspaceId])
  const handleLineSelectChanged = useCallback((taskId: number, selected: boolean) => {
    setLineSelectedIds((previous) => {
      const next = new Set(previous)
      if (selected) next.add(taskId)
      else next.delete(taskId)
      return next
    })
  }, [])
  const selectedLineIssueKeys = () =>
    (tasksQ.data ?? []).filter((task) => lineSelectedIds.has(task.id)).map((task) => task.issue_key)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="whitespace-nowrap text-xl font-semibold tracking-tight text-[var(--color-text)] sm:text-2xl">進捗管理</div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {saveError && <span className="text-sm font-semibold text-red-600">{saveError}</span>}
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
            <>
              <button onClick={syncNotion} disabled={syncing} className="whitespace-nowrap rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-2 text-xs font-semibold text-white shadow-md disabled:opacity-50 sm:px-5 sm:py-2.5 sm:text-sm">
                {syncing ? '同期中…' : '🔄 Notion同期'}
              </button>
              <button onClick={() => setLineModalOpen(true)} disabled={lineSelectedIds.size === 0}
                title="カードの「LINE報告」にチェックしたタスクの進捗を、西野さんのLINEへ送信します"
                className="whitespace-nowrap rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-md disabled:opacity-50 sm:px-5 sm:py-2.5 sm:text-sm">
                {`📱 LINE送信 (${lineSelectedIds.size})`}
              </button>
            </>
          )}
          {selectedWorkspace?.source_type === 'trello' && (
            <button onClick={syncTrello} disabled={syncing} className="whitespace-nowrap rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-2 text-xs font-semibold text-white shadow-md disabled:opacity-50 sm:px-5 sm:py-2.5 sm:text-sm">
              {syncing ? '同期中…' : '🔄 Trello同期'}
            </button>
          )}
          {selectedWorkspace?.name === 'プライベート' && (
            <button onClick={importCalendar} disabled={syncing} title="Googleカレンダーの予定を取り込みます。タスクの追加・変更・削除は自動でカレンダーに反映されます。" className="whitespace-nowrap rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-2 text-xs font-semibold text-white shadow-md disabled:opacity-50 sm:px-5 sm:py-2.5 sm:text-sm">
              {syncing ? '取込中…' : '📅 カレンダー取込'}
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
            <button onClick={addTask} disabled={addingTask || !newTask.summary.trim()} className="col-span-1 rounded-lg bg-[var(--color-primary)] py-2.5 text-sm font-semibold text-white disabled:opacity-40">{addingTask ? '追加中…' : '追加'}</button>
          </div>
        </div>
      )}

      {/* スプレッドシート連携。Wing / リビングなど案件ごとに別シートを使うので、
          タブを切り替えると URL もそのワークスペースのものに入れ替わる */}
      {selectedWorkspace && selectedWorkspace.source_type !== 'trello' && (
      <div className="glass rounded-2xl p-5 shadow-md">
        <div className="text-sm font-semibold text-[var(--color-text)]">
          Google スプレッドシート連携（{selectedWorkspace.name}）
        </div>
        <div className="text-xs text-[var(--color-text-sub)]">
          書き出し: DB → シート / インポート: シート → DB（A列のチェックが「本日行う」。J列のidで更新、無ければ追加）
        </div>
        <div className="text-[11px] text-[var(--color-text-sub)]">
          このURLは「{selectedWorkspace.name}」専用に保存され、{selectedWorkspace.name}のタスクだけを書き出します
        </div>
        <div className="mt-3 flex gap-2">
          <input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder={`${selectedWorkspace.name} のスプレッドシート URL`}
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
              const { data } = await api.post('/backlog/export_sheet', { spreadsheet_url: sheetUrl, workspace_id: selectedWorkspaceId })
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
              const { data } = await api.post('/backlog/import_sheet', { spreadsheet_url: sheetUrl, workspace_id: selectedWorkspaceId })
              await persistSheetUrl(sheetUrl)  // 取込成功 → このワークスペースのURLとして保存
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
              const { data } = await api.post('/backlog/export_sheet', { spreadsheet_url: sheetUrl, only_flagged: true, workspace_id: selectedWorkspaceId })
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
              const { data } = await api.post('/backlog/import_sheet', { spreadsheet_url: sheetUrl, only_flagged: true, workspace_id: selectedWorkspaceId })
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
        tasks={tasksQ.data ?? NO_TASKS}
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
        onLineSelectChanged={selectedWorkspace?.source_type === 'notion' ? handleLineSelectChanged : undefined}
        lineSelectedIds={lineSelectedIds}
        workspaceId={selectedWorkspaceId}
        currentUserName={me.display_name}
        isAdmin={me.admin}
      />

      {/* LINE 報告モーダル。文面を確認・編集してから送信する */}
      {lineModalOpen && (
        <NotionLineReportModal
          issueKeys={selectedLineIssueKeys()}
          onClose={() => setLineModalOpen(false)}
          onSent={() => {
            setLineModalOpen(false)
            setLineSelectedIds(new Set())
            setSyncMsg('LINEに送信しました')
          }}
        />
      )}
    </div>
  )
}
