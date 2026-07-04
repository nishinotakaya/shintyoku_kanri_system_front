import { useState, useRef } from 'react'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import type { DropResult } from '@hello-pangea/dnd'

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

const COLUMNS = [
  { id: 1, label: '未対応', color: 'border-t-gray-400', bg: 'bg-gray-50', badge: 'bg-gray-200 text-gray-700', tabActive: 'bg-gray-500 text-white', tabInactive: 'text-gray-500' },
  { id: 2, label: '処理中', color: 'border-t-blue-500', bg: 'bg-blue-50/50', badge: 'bg-blue-100 text-blue-700', tabActive: 'bg-blue-500 text-white', tabInactive: 'text-blue-500' },
  { id: 3, label: '処理済', color: 'border-t-amber-500', bg: 'bg-amber-50/50', badge: 'bg-amber-100 text-amber-700', tabActive: 'bg-amber-500 text-white', tabInactive: 'text-amber-600' },
  { id: 4, label: '完了', color: 'border-t-emerald-500', bg: 'bg-emerald-50/50', badge: 'bg-emerald-100 text-emerald-700', tabActive: 'bg-emerald-500 text-white', tabInactive: 'text-emerald-600' },
]

type ViewMode = 'board' | 'tab'

export default function KanbanBoard({
  tasks,
  onTaskMoved,
  onMemoChanged,
  onReorder,
  onProgressChanged,
  onDeployChanged,
  onDelete,
  onSummaryChanged,
  onUrlChanged,
  onAssigneeChanged,
  onFlagChanged,
}: {
  tasks: BLTask[]
  onTaskMoved: (taskId: number, newStatusId: number) => void
  onMemoChanged: (taskId: number, memo: string) => void
  onReorder: (statusId: number, orderedIds: number[]) => void
  onProgressChanged: (taskId: number, progress: number) => void
  onDeployChanged: (taskId: number, deploy_date: string, deploy_note: string) => void
  onDelete?: (taskId: number) => void
  onSummaryChanged?: (taskId: number, summary: string) => void
  onUrlChanged?: (taskId: number, url: string) => void
  onAssigneeChanged?: (taskId: number, name: string) => void
  onFlagChanged?: (taskId: number, patch: { did_previous?: boolean; do_today?: boolean }) => void
}) {
  const [editingMemo, setEditingMemo] = useState<Record<number, string>>({})
  const [editingSummary, setEditingSummary] = useState<Record<number, string>>({})
  const [editingUrl, setEditingUrl] = useState<Record<number, string>>({})
  const [editingDeploy, setEditingDeploy] = useState<Record<number, { date: string; note: string }>>({})
  const [viewMode, setViewMode] = useState<ViewMode>('board')
  const [activeTab, setActiveTab] = useState(1) // 未対応をデフォルト
  const [search, setSearch] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  const updateMemo = (taskId: number, value: string) => {
    setEditingMemo((prev) => ({ ...prev, [taskId]: value }))
    if (timers.current[taskId]) clearTimeout(timers.current[taskId])
    timers.current[taskId] = setTimeout(() => onMemoChanged(taskId, value), 500)
  }

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return
    const srcStatusId = Number(result.source.droppableId)
    const dstStatusId = Number(result.destination.droppableId)
    const taskId = Number(result.draggableId)

    if (srcStatusId !== dstStatusId) {
      // 列間移動 → ステータス変更
      onTaskMoved(taskId, dstStatusId)
    } else {
      // 同一列内の並び替え
      const colTasks = [...sortedTasks(dstStatusId)]
      const [moved] = colTasks.splice(result.source.index, 1)
      colTasks.splice(result.destination.index, 0, moved)
      onReorder(dstStatusId, colTasks.map((t) => t.id))
    }
  }

  // 担当者一覧
  const assignees = [...new Map(tasks.filter((t) => t.assignee_name).map((t) => [t.assignee_name!, t.assignee_name!])).values()]

  // 検索 + 担当者フィルタ
  const q = search.toLowerCase()
  let filteredTasks = tasks
  if (assigneeFilter !== 'all') {
    filteredTasks = filteredTasks.filter((t) => (t.assignee_name ?? '') === assigneeFilter)
  }
  if (q) {
    filteredTasks = filteredTasks.filter((t) =>
      t.issue_key.toLowerCase().includes(q) ||
      t.summary.toLowerCase().includes(q) ||
      (editingMemo[t.id] ?? t.memo ?? '').toLowerCase().includes(q)
    )
  }

  // ソート: 完了は completed_on 降順、それ以外はそのまま
  const sortedTasks = (statusId: number) => {
    const col = filteredTasks.filter((t) => t.status_id === statusId)
    if (statusId === 4) {
      return col.sort((a, b) => (b.completed_on ?? '').localeCompare(a.completed_on ?? ''))
    }
    return col
  }


  const FlagCheckboxes = ({ t }: { t: BLTask }) => (
    <div
      className="mt-1.5 inline-flex items-center gap-3 text-[11px]"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <label className="flex items-center gap-1 cursor-pointer select-none" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={!!t.do_today}
          onChange={(e) => onFlagChanged?.(t.id, { do_today: e.target.checked })}
          onClick={(e) => e.stopPropagation()}
          className="accent-amber-500"
        />
        <span className={`font-semibold ${t.do_today ? 'text-amber-600' : 'text-[var(--color-text-sub)]'}`}>本日行う</span>
      </label>
      <label className="flex items-center gap-1 cursor-pointer select-none" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={!!t.did_previous}
          onChange={(e) => onFlagChanged?.(t.id, { did_previous: e.target.checked })}
          onClick={(e) => e.stopPropagation()}
          className="accent-sky-500"
        />
        <span className={`font-semibold ${t.did_previous ? 'text-sky-600' : 'text-[var(--color-text-sub)]'}`}>前回行った</span>
      </label>
    </div>
  )

  const renderCard = (t: BLTask, index: number) => {
    const dueDiff = t.due_date ? Math.ceil((new Date(t.due_date).getTime() - Date.now()) / 86400000) : null
    const overdue = dueDiff !== null && dueDiff < 0
    const urgent = dueDiff !== null && dueDiff >= 0 && dueDiff <= 3
    return (
      <Draggable key={t.id} draggableId={String(t.id)} index={index}>
        {(prov, snap) => (
          <div
            ref={prov.innerRef}
            {...prov.draggableProps}
            {...prov.dragHandleProps}
            className={`rounded-xl bg-white p-4 shadow-sm border border-[var(--color-border)] cursor-grab active:cursor-grabbing transition ${
              snap.isDragging ? 'shadow-xl ring-2 ring-[var(--color-primary)]/30 rotate-1 scale-105' : 'hover:shadow-md'
            } ${overdue ? 'border-l-4 border-l-red-500' : urgent ? 'border-l-4 border-l-amber-400' : ''}`}
          >
            <div className="flex items-start justify-between gap-2">
              {t.source !== 'backlog' ? (
                (editingUrl[t.id] ?? t.url) ? (
                  <a href={editingUrl[t.id] ?? t.url!} target="_blank" rel="noreferrer"
                    className="text-sm font-mono font-semibold text-[var(--color-primary)] hover:underline cursor-pointer"
                    onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                    {(t.summary || t.issue_key).length > 20 ? (t.summary || t.issue_key).slice(0, 20) + '...' : (t.summary || t.issue_key)}
                  </a>
                ) : (
                  <span className="text-sm font-semibold text-[var(--color-text-sub)]">{(t.summary || t.issue_key).length > 20 ? (t.summary || t.issue_key).slice(0, 20) + '...' : (t.summary || t.issue_key)}</span>
                )
              ) : (
                <a href={`https://tamahome.backlog.com/view/${t.issue_key}`} target="_blank" rel="noreferrer"
                  className="text-sm font-mono font-semibold text-[var(--color-primary)] hover:underline cursor-pointer"
                  onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                  {t.issue_key}
                </a>
              )}
              {overdue && <span className="whitespace-nowrap rounded-lg bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white animate-pulse">⚠{Math.abs(dueDiff!)}日超過</span>}
              {urgent && !overdue && <span className="whitespace-nowrap rounded-lg bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-white">🔥あと{dueDiff}日</span>}
            </div>

            {t.source !== 'backlog' && onSummaryChanged ? (
              <input
                value={editingSummary[t.id] ?? t.summary}
                onChange={(e) => {
                  e.stopPropagation()
                  setEditingSummary((p) => ({ ...p, [t.id]: e.target.value }))
                  if (timers.current[t.id + 80000]) clearTimeout(timers.current[t.id + 80000])
                  timers.current[t.id + 80000] = setTimeout(() => onSummaryChanged!(t.id, e.target.value), 500)
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                onClick={(e) => e.stopPropagation()}
                className="mt-2 w-full rounded-lg bg-transparent px-1 py-0.5 text-sm font-medium text-[var(--color-text)] outline-none focus:bg-[var(--color-bg)]"
              />
            ) : (
              <div className="mt-2 text-sm font-medium text-[var(--color-text)] leading-snug break-words">
                {t.summary}
              </div>
            )}

            {/* ローカルタスク: URL 編集 */}
            {t.source !== 'backlog' && (
              <input
                value={editingUrl[t.id] ?? t.url ?? ''}
                onChange={(e) => {
                  e.stopPropagation()
                  setEditingUrl((p) => ({ ...p, [t.id]: e.target.value }))
                  if (timers.current[t.id + 70000]) clearTimeout(timers.current[t.id + 70000])
                  timers.current[t.id + 70000] = setTimeout(() => onUrlChanged?.(t.id, e.target.value), 500)
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                onClick={(e) => e.stopPropagation()}
                placeholder="URL を入力..."
                className="mt-1 w-full rounded-lg bg-transparent px-1 py-0.5 text-xs text-[var(--color-primary)] outline-none focus:bg-[var(--color-bg)] placeholder-gray-400"
              />
            )}

            {t.due_date && !overdue && !urgent && (
              <div className="mt-2 text-xs text-[var(--color-text-sub)]">期限: {t.due_date}</div>
            )}

            <FlagCheckboxes t={t} />

            {/* 進捗率 */}
            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-primary-light)] transition-all" style={{ width: `${(t.progress ?? 0) * 100}%` }} />
              </div>
              <select
                value={Math.round((t.progress ?? 0) * 100)}
                onChange={(e) => { e.stopPropagation(); onProgressChanged(t.id, Number(e.target.value) / 100) }}
                onClick={(e) => e.stopPropagation()}
                className="rounded border border-[var(--color-border)] bg-white px-1 py-0.5 text-[11px] text-[var(--color-text)]"
              >
                {[
                  { v: 0, l: '0%' },
                  { v: 20, l: '20% 調査中' },
                  { v: 40, l: '40% 実装中' },
                  { v: 60, l: '60% 実装完了' },
                  { v: 80, l: '80% エビデンス完了' },
                  { v: 100, l: '100% 完了' },
                ].map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </div>

            <textarea
              value={editingMemo[t.id] ?? t.memo ?? ''}
              onChange={(e) => {
                updateMemo(t.id, e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = e.target.scrollHeight + 'px'
              }}
              ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
              onClick={(e) => e.stopPropagation()}
              placeholder="備考…"
              rows={2}
              className="mt-2 w-full min-h-[40px] overflow-hidden resize-none rounded-lg bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] placeholder-gray-400 outline-none focus:ring-1 focus:ring-[var(--color-primary)]/30"
            />

            {/* 適用予定 */}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px] text-[var(--color-text-sub)] whitespace-nowrap">適用予定:</span>
              <input
                type="date"
                value={editingDeploy[t.id]?.date ?? t.deploy_date ?? ''}
                onChange={(e) => {
                  e.stopPropagation()
                  const d = { date: e.target.value, note: editingDeploy[t.id]?.note ?? t.deploy_note ?? '' }
                  setEditingDeploy((p) => ({ ...p, [t.id]: d }))
                  onDeployChanged(t.id, d.date, d.note)
                }}
                onClick={(e) => e.stopPropagation()}
                className="rounded border border-[var(--color-border)] bg-white px-1.5 py-0.5 text-[11px] text-[var(--color-text)]"
              />
              <input
                value={editingDeploy[t.id]?.note ?? t.deploy_note ?? ''}
                onChange={(e) => {
                  e.stopPropagation()
                  const d = { date: editingDeploy[t.id]?.date ?? t.deploy_date ?? '', note: e.target.value }
                  setEditingDeploy((p) => ({ ...p, [t.id]: d }))
                  if (timers.current[t.id + 90000]) clearTimeout(timers.current[t.id + 90000])
                  timers.current[t.id + 90000] = setTimeout(() => onDeployChanged(t.id, d.date, d.note), 500)
                }}
                onClick={(e) => e.stopPropagation()}
                placeholder="例: 4/14夜適用"
                className="flex-1 rounded border border-[var(--color-border)] bg-white px-2 py-0.5 text-[11px] text-[var(--color-text)] placeholder-gray-400"
              />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-sub)]">
              <select value={t.assignee_name ?? ''} onChange={(e) => { e.stopPropagation(); onAssigneeChanged?.(t.id, e.target.value) }}
                onClick={(e) => e.stopPropagation()}
                className="rounded bg-[var(--color-bg)] px-1 py-0.5 text-[11px] font-semibold text-[var(--color-text-sub)] border-none outline-none">
                <option value="">担当</option>
                <option value="西野 鷹也">西野 鷹也</option>
                <option value="川村卓也">川村卓也</option>
              </select>
              <span>作成: {t.created_on?.slice(5) ?? '—'}</span>
              {t.completed_on && <span className="text-emerald-600 font-semibold">完了: {t.completed_on.slice(5)}</span>}
              {t.created_on && (() => {
                const days = Math.floor((Date.now() - new Date(t.created_on).getTime()) / 86400000)
                return (
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${
                    days > 30 ? 'bg-red-100 text-red-600' : days > 14 ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-600'
                  }`}>{days}日経過</span>
                )
              })()}
            </div>

            {/* 削除ボタン (ローカルタスクのみ) */}
            {onDelete && t.source !== 'backlog' && (
              <button onClick={(e) => { e.stopPropagation(); onDelete(t.id) }} className="mt-1 text-[10px] text-gray-400 hover:text-red-500">🗑 削除</button>
            )}

            {/* タブモード時: ステータス変更ドロップダウン */}
            {viewMode === 'tab' && (
              <select
                value={t.status_id}
                onChange={(e) => {
                  e.stopPropagation()
                  onTaskMoved(t.id, Number(e.target.value))
                }}
                className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-text)]"
              >
                {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            )}
          </div>
        )}
      </Draggable>
    )
  }

  return (
    <div>
      {/* ビュー切替 + 検索 (sticky) */}
      <div className="sticky top-[57px] z-10 bg-[var(--color-bg)] py-3 -mx-1 px-1 mb-1 flex items-center gap-3">
        <button
          onClick={() => setViewMode('board')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
            viewMode === 'board' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text-sub)]'
          }`}
        >
          ボード
        </button>
        <button
          onClick={() => setViewMode('tab')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
            viewMode === 'tab' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text-sub)]'
          }`}
        >
          タブ
        </button>
        {assignees.length > 0 && (
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}
            className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)]">
            <option value="all">全担当者</option>
            {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <div className="ml-auto relative">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 チケット・タイトル・備考で検索"
            className="w-72 rounded-xl border border-[var(--color-border)] bg-white px-4 py-2 text-sm text-[var(--color-text)] placeholder-gray-400 outline-none focus:border-[var(--color-primary)]/60"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-sub)] hover:text-[var(--color-text)]">×</button>
          )}
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        {viewMode === 'board' ? (
          /* ===== ボードモード: 横4列 ===== */
          <div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
              {COLUMNS.map((col) => {
                const colTasks = sortedTasks(col.id)
                return (
                  <div key={col.id} className={`rounded-2xl border-t-4 ${col.color} ${col.bg} p-2 sm:p-3 max-h-[80vh] flex flex-col`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className={`whitespace-nowrap rounded-lg px-2 py-1 text-xs font-bold sm:px-3 sm:text-sm ${col.badge}`}>{col.label}</span>
                      <span className="text-sm font-semibold text-[var(--color-text-sub)]">{colTasks.length}</span>
                    </div>
                    <Droppable droppableId={String(col.id)}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`space-y-3 min-h-[60vh] overflow-y-auto rounded-xl p-1 transition ${
                            snapshot.isDraggingOver ? 'bg-[var(--color-primary)]/10 ring-2 ring-[var(--color-primary)]/20' : ''
                          }`}
                        >
                          {colTasks.map((t, i) => renderCard(t, i))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          /* ===== タブモード: 横長1列 ===== */
          <div>
            {/* タブヘッダ (sticky + ドロップターゲット) */}
            <div className="sticky top-[105px] z-10 bg-[var(--color-bg)] flex gap-1 border-b border-[var(--color-border)] pb-0">
              {COLUMNS.map((col) => {
                const count = sortedTasks(col.id).length
                return (
                  <Droppable key={col.id} droppableId={String(col.id)} direction="horizontal">
                    {(provided, snapshot) => (
                      <div ref={provided.innerRef} {...provided.droppableProps} className="relative">
                        <button
                          onClick={() => setActiveTab(col.id)}
                          className={`whitespace-nowrap rounded-t-xl px-3 py-2.5 text-xs font-bold transition sm:px-6 sm:py-3 sm:text-sm ${
                            activeTab === col.id ? col.tabActive : `bg-[var(--color-bg)] ${col.tabInactive} hover:bg-gray-100`
                          } ${snapshot.isDraggingOver ? 'ring-2 ring-[var(--color-primary)] scale-105' : ''}`}
                        >
                          {col.label} ({count})
                        </button>
                        <div className="hidden">{provided.placeholder}</div>
                      </div>
                    )}
                  </Droppable>
                )
              })}
            </div>

            {/* タブ内容: 横1列リスト */}
            {COLUMNS.filter((c) => c.id === activeTab).map((col) => {
              const colTasks = sortedTasks(col.id)
              return (
                <Droppable key={col.id} droppableId={String(col.id)}>
                  {(provided) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`rounded-b-2xl ${col.bg} p-4 min-h-[60vh]`}
                    >
                      <div className="space-y-2">
                        {colTasks.map((t, i) => {
                          const dueDiff = t.due_date ? Math.ceil((new Date(t.due_date).getTime() - Date.now()) / 86400000) : null
                          const overdue = dueDiff !== null && dueDiff < 0
                          const urgent = dueDiff !== null && dueDiff >= 0 && dueDiff <= 3
                          return (
                            <Draggable key={t.id} draggableId={String(t.id)} index={i}>
                              {(prov, snap) => (
                                <div
                                  ref={prov.innerRef}
                                  {...prov.draggableProps}
                                  {...prov.dragHandleProps}
                                  className={`rounded-xl bg-white px-5 py-4 shadow-sm border border-[var(--color-border)] cursor-grab active:cursor-grabbing transition ${
                                    snap.isDragging ? 'shadow-xl ring-2 ring-[var(--color-primary)]/30' : 'hover:shadow-md'
                                  } ${overdue ? 'border-l-4 border-l-red-500' : urgent ? 'border-l-4 border-l-amber-400' : ''}`}
                                >
                                  {/* 上段: チケット + タイトル + 期限 + ステータス + 削除 */}
                                  <div className="flex items-start gap-4">
                                    {t.source !== 'backlog' ? (
                                      (editingUrl[t.id] ?? t.url) ? (
                                        <a href={editingUrl[t.id] ?? t.url!} target="_blank" rel="noreferrer"
                                          className="flex-shrink-0 text-sm font-semibold text-[var(--color-primary)] hover:underline cursor-pointer truncate max-w-[200px]"
                                          onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                                          {(t.summary || t.issue_key).length > 20 ? (t.summary || t.issue_key).slice(0, 20) + '...' : (t.summary || t.issue_key)}</a>
                                      ) : (
                                        <span className="flex-shrink-0 text-sm font-semibold text-[var(--color-text-sub)]">{(t.summary || t.issue_key).length > 20 ? (t.summary || t.issue_key).slice(0, 20) + '...' : (t.summary || t.issue_key)}</span>
                                      )
                                    ) : (
                                      <a href={`https://tamahome.backlog.com/view/${t.issue_key}`} target="_blank" rel="noreferrer"
                                        className="flex-shrink-0 text-sm font-mono font-semibold text-[var(--color-primary)] hover:underline cursor-pointer"
                                        onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                                        {t.issue_key}</a>
                                    )}
                                    <div className="flex-1 min-w-0">
                                      {t.source !== 'backlog' && onSummaryChanged ? (
                                        <>
                                          <input
                                            value={editingSummary[t.id] ?? t.summary}
                                            onChange={(e) => {
                                              e.stopPropagation()
                                              setEditingSummary((p) => ({ ...p, [t.id]: e.target.value }))
                                              if (timers.current[t.id + 80000]) clearTimeout(timers.current[t.id + 80000])
                                              timers.current[t.id + 80000] = setTimeout(() => onSummaryChanged!(t.id, e.target.value), 500)
                                            }}
                                            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                                            onClick={(e) => e.stopPropagation()}
                                            placeholder="タイトル"
                                            className="w-full rounded-lg bg-transparent px-1 py-0.5 text-sm font-medium text-[var(--color-text)] outline-none focus:bg-[var(--color-bg)]"
                                          />
                                          <input
                                            value={editingUrl[t.id] ?? t.url ?? ''}
                                            onChange={(e) => {
                                              e.stopPropagation()
                                              setEditingUrl((p) => ({ ...p, [t.id]: e.target.value }))
                                              if (timers.current[t.id + 70000]) clearTimeout(timers.current[t.id + 70000])
                                              timers.current[t.id + 70000] = setTimeout(() => onUrlChanged?.(t.id, e.target.value), 500)
                                            }}
                                            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                                            onClick={(e) => e.stopPropagation()}
                                            placeholder="URL を入力..."
                                            className="mt-1 w-full rounded-lg bg-transparent px-1 py-0.5 text-xs text-[var(--color-primary)] outline-none focus:bg-[var(--color-bg)] placeholder-gray-400"
                                          />
                                        </>
                                      ) : (
                                        <div className="text-sm font-medium text-[var(--color-text)] leading-snug break-words">{t.summary}</div>
                                      )}
                                    </div>
                                    <div className="flex-shrink-0 flex items-center gap-2">
                                      {overdue && <span className="whitespace-nowrap rounded-lg bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white animate-pulse">⚠{t.due_date}({Math.abs(dueDiff!)}日超過)</span>}
                                      {urgent && !overdue && <span className="whitespace-nowrap rounded-lg bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-white">🔥{t.due_date}(あと{dueDiff}日)</span>}
                                      {t.due_date && !overdue && !urgent && <span className="text-xs text-[var(--color-text-sub)] whitespace-nowrap">期限: {t.due_date}</span>}
                                      <select
                                        value={t.status_id}
                                        onChange={(e) => { e.stopPropagation(); onTaskMoved(t.id, Number(e.target.value)) }}
                                        className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1 text-xs text-[var(--color-text)]"
                                      >
                                        {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                                      </select>
                                      {onDelete && t.source !== 'backlog' && (
                                        <button onClick={(e) => { e.stopPropagation(); onDelete(t.id) }}
                                          className="text-xs text-gray-400 hover:text-red-500">🗑</button>
                                      )}
                                    </div>
                                  </div>
                                  {/* 情報行 + 経過日数 */}
                                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-text-sub)]">
                                    <span>作成: {t.created_on ?? '—'}</span>
                                    {t.completed_on && <span className="text-emerald-600 font-semibold">完了: {t.completed_on}</span>}
                                    {t.created_on && (() => {
                                      const days = Math.floor((Date.now() - new Date(t.created_on).getTime()) / 86400000)
                                      return (
                                        <span className={`rounded px-1.5 py-0.5 font-semibold ${
                                          days > 30 ? 'bg-red-100 text-red-600' : days > 14 ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-600'
                                        }`}>
                                          {days}日経過
                                        </span>
                                      )
                                    })()}
                                    <FlagCheckboxes t={t} />
                                  </div>
                                  {/* 進捗率 */}
                                  <div className="mt-2 flex items-center gap-2">
                                    <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
                                      <div className="h-full rounded-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-primary-light)] transition-all" style={{ width: `${(t.progress ?? 0) * 100}%` }} />
                                    </div>
                                    <select
                                      value={Math.round((t.progress ?? 0) * 100)}
                                      onChange={(e) => { e.stopPropagation(); onProgressChanged(t.id, Number(e.target.value) / 100) }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="rounded border border-[var(--color-border)] bg-white px-2 py-1 text-xs text-[var(--color-text)]"
                                    >
                                      {[
                  { v: 0, l: '0%' },
                  { v: 20, l: '20% 調査中' },
                  { v: 40, l: '40% 実装中' },
                  { v: 60, l: '60% 実装完了' },
                  { v: 80, l: '80% エビデンス完了' },
                  { v: 100, l: '100% 完了' },
                ].map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                                    </select>
                                  </div>
                                  {/* 適用予定 */}
                                  <div className="mt-2 flex items-center gap-2">
                                    <span className="text-xs text-[var(--color-text-sub)] whitespace-nowrap">適用予定:</span>
                                    <input
                                      type="date"
                                      value={editingDeploy[t.id]?.date ?? t.deploy_date ?? ''}
                                      onChange={(e) => {
                                        e.stopPropagation()
                                        const d = { date: e.target.value, note: editingDeploy[t.id]?.note ?? t.deploy_note ?? '' }
                                        setEditingDeploy((p) => ({ ...p, [t.id]: d }))
                                        onDeployChanged(t.id, d.date, d.note)
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="rounded border border-[var(--color-border)] bg-white px-2 py-1 text-xs text-[var(--color-text)]"
                                    />
                                    <input
                                      value={editingDeploy[t.id]?.note ?? t.deploy_note ?? ''}
                                      onChange={(e) => {
                                        e.stopPropagation()
                                        const d = { date: editingDeploy[t.id]?.date ?? t.deploy_date ?? '', note: e.target.value }
                                        setEditingDeploy((p) => ({ ...p, [t.id]: d }))
                                        if (timers.current[t.id + 90000]) clearTimeout(timers.current[t.id + 90000])
                                        timers.current[t.id + 90000] = setTimeout(() => onDeployChanged(t.id, d.date, d.note), 500)
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      placeholder="例: 4/14夜適用"
                                      className="flex-1 rounded border border-[var(--color-border)] bg-white px-2 py-1 text-xs text-[var(--color-text)] placeholder-gray-400"
                                    />
                                  </div>
                                  {/* 下段: 備考（横幅いっぱい） */}
                                  <textarea
                                    value={editingMemo[t.id] ?? t.memo ?? ''}
                                    onChange={(e) => {
                                      updateMemo(t.id, e.target.value)
                                      e.target.style.height = 'auto'
                                      e.target.style.height = e.target.scrollHeight + 'px'
                                    }}
                                    ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                                    onClick={(e) => e.stopPropagation()}
                                    placeholder="備考…"
                                    rows={2}
                                    className="mt-3 w-full min-h-[60px] overflow-hidden resize-none rounded-lg bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] placeholder-gray-400 outline-none focus:ring-1 focus:ring-[var(--color-primary)]/30"
                                  />
                                </div>
                              )}
                            </Draggable>
                          )
                        })}
                      </div>
                      {colTasks.length === 0 && (
                        <div className="py-16 text-center text-[var(--color-text-sub)]">タスクなし</div>
                      )}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              )
            })}
          </div>
        )}
      </DragDropContext>
    </div>
  )
}
