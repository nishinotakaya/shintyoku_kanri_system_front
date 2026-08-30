import { useState, useRef, useEffect, useMemo } from 'react'
import { DragDropContext, Droppable } from '@hello-pangea/dnd'
import type { DropResult } from '@hello-pangea/dnd'
import TaskCard from './progress/TaskCard'
import type { TaskCardHandlers } from './progress/TaskCard'
import { COLUMNS, COMPLETED_STATUS_ID, wholeColumnOrder } from './progress/board'
import type { BLTask } from './progress/board'

type ViewMode = 'board' | 'tab'

// 担当者セレクトに必ず出す固定メンバー。
const DEFAULT_ASSIGNEES = ['西野 鷹也', '川村卓也']

// 完了列の初期表示件数。完了は 9 割近くが「もう触らない過去ぶん」で、
// 全部描くと数百枚のカードが常に DOM に居座り、入力もドラッグも詰まる。
// (本番のテックリーダーズは 311 件中 278 件が完了だった)
const COMPLETED_PAGE_SIZE = 20

// 「川村 卓也」と「川村卓也」のように、スペースの有無だけが違う表記を同一人物として扱う。
// Backlog の担当者名とアプリの表示名で空白の入れ方が揃っていないため。
const withoutSpaces = (name: string) => name.replace(/[\s\u3000]/g, '')

export default function KanbanBoard({
  tasks,
  onReorder,
  workspaceId,
  currentUserName,
  isAdmin,
  ...taskHandlers
}: TaskCardHandlers & {
  tasks: BLTask[]
  onReorder: (statusId: number, orderedIds: number[]) => void
  workspaceId?: number | null
  currentUserName?: string | null
  isAdmin?: boolean
}) {
  const [viewMode, setViewMode] = useState<ViewMode>('board')
  const [activeTab, setActiveTab] = useState(1) // 未対応をデフォルト
  const [search, setSearch] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')
  const [completedLimit, setCompletedLimit] = useState(COMPLETED_PAGE_SIZE)
  // 担当者フィルタを初期化済みのワークスペース。一度触ったタブに戻っても選択を巻き戻さない
  const initializedWorkspaceIds = useRef<Set<number>>(new Set())

  // 担当者の顔ぶれ。文字列キーで持つのは、タスクが1件更新されるたびに
  // 配列の同一性が変わって全カードが再描画されるのを避けるため。
  const assigneeNamesKey = useMemo(() => {
    const names = new Set<string>()
    tasks.forEach((task) => { if (task.assignee_name) names.add(task.assignee_name) })
    return [...names].join('\u0000') // 氏名に現れない区切り。改行や中黒だと名前を割ってしまう
  }, [tasks])
  const assignees = useMemo(() => (assigneeNamesKey ? assigneeNamesKey.split('\u0000') : []), [assigneeNamesKey])
  const assigneeOptions = useMemo(() => [...new Set([...DEFAULT_ASSIGNEES, ...assignees])], [assignees])

  // 担当者フィルタの初期値は本人。管理者は全体を見る立場なので「全担当者」のまま。
  // 初期化はワークスペースごとに1回だけなので、そのあと手で切り替えた選択は保たれる。
  useEffect(() => {
    if (workspaceId == null || initializedWorkspaceIds.current.has(workspaceId)) return
    if (assignees.length === 0) return // タスク読み込み前

    initializedWorkspaceIds.current.add(workspaceId)
    if (isAdmin || !currentUserName) {
      setAssigneeFilter('all')
      return
    }
    const mine = assignees.find((name) => withoutSpaces(name) === withoutSpaces(currentUserName))
    setAssigneeFilter(mine ?? 'all')
  }, [workspaceId, assignees, isAdmin, currentUserName])

  // 検索 + 担当者フィルタ → ステータス列ごとに仕分け。
  // 完了列だけ completed_on の新しい順に並べ、既定では直近ぶんだけ描く。
  // 検索中は件数が絞られているので、古い完了も含めて全部出す(検索が素通りしないように)。
  const tasksByStatus = useMemo(() => {
    const keyword = search.toLowerCase()
    let visibleTasks = tasks
    if (assigneeFilter !== 'all') {
      visibleTasks = visibleTasks.filter((task) => (task.assignee_name ?? '') === assigneeFilter)
    }
    if (keyword) {
      visibleTasks = visibleTasks.filter((task) =>
        task.issue_key.toLowerCase().includes(keyword) ||
        task.summary.toLowerCase().includes(keyword) ||
        (task.memo ?? '').toLowerCase().includes(keyword)
      )
    }
    return new Map<number, { shown: BLTask[]; total: number }>(COLUMNS.map((column) => {
      const columnTasks = visibleTasks.filter((task) => task.status_id === column.id)
      if (column.id !== COMPLETED_STATUS_ID) return [column.id, { shown: columnTasks, total: columnTasks.length }]

      columnTasks.sort((left, right) => (right.completed_on ?? '').localeCompare(left.completed_on ?? ''))
      const shown = keyword ? columnTasks : columnTasks.slice(0, completedLimit)
      return [column.id, { shown, total: columnTasks.length }]
    }))
  }, [tasks, search, assigneeFilter, completedLimit])

  const columnTasksOf = (statusId: number) => tasksByStatus.get(statusId)?.shown ?? []
  const columnTotalOf = (statusId: number) => tasksByStatus.get(statusId)?.total ?? 0
  const hiddenCompletedCount = columnTotalOf(COMPLETED_STATUS_ID) - columnTasksOf(COMPLETED_STATUS_ID).length

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return
    const sourceStatusId = Number(result.source.droppableId)
    const destinationStatusId = Number(result.destination.droppableId)
    const taskId = Number(result.draggableId)

    const visibleOrderedIds = columnTasksOf(destinationStatusId).map((task) => task.id)
    if (sourceStatusId === destinationStatusId) {
      const [moved] = visibleOrderedIds.splice(result.source.index, 1)
      visibleOrderedIds.splice(result.destination.index, 0, moved)
    } else {
      taskHandlers.onTaskMoved(taskId, destinationStatusId)
      visibleOrderedIds.splice(result.destination.index, 0, taskId)
    }

    // 完了列は completed_on の新しい順に並べ直して表示するので、手で並べても効かない。
    if (destinationStatusId === COMPLETED_STATUS_ID) return

    const droppedInTaskId = sourceStatusId === destinationStatusId ? undefined : taskId
    onReorder(destinationStatusId, wholeColumnOrder(tasks, destinationStatusId, visibleOrderedIds, droppedInTaskId))
  }

  return (
    <div>
      {/* ビュー切替 + 検索 (sticky) */}
      <div className="sticky top-[57px] z-10 bg-[var(--color-bg)] py-3 -mx-1 px-1 mb-1 flex items-center gap-3">
        <button
          onClick={() => setViewMode('board')}
          className={`shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition ${
            viewMode === 'board' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text-sub)]'
          }`}
        >
          ボード
        </button>
        <button
          onClick={() => setViewMode('tab')}
          className={`shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition ${
            viewMode === 'tab' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text-sub)]'
          }`}
        >
          タブ
        </button>
        {assignees.length > 0 && (
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}
            className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)]">
            <option value="all">全担当者</option>
            {assignees.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
        {/* 検索欄は狭い画面で幅いっぱい、sm以上で従来の固定幅(288px) */}
        <div className="relative w-full sm:ml-auto sm:w-auto">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 チケット・タイトル・備考で検索"
            className="w-full rounded-xl border border-[var(--color-border)] bg-white px-4 py-2 text-sm text-[var(--color-text)] placeholder-gray-400 outline-none focus:border-[var(--color-primary)]/60 sm:w-72"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-sub)] hover:text-[var(--color-text)]">×</button>
          )}
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        {viewMode === 'board' ? (
          /* ===== ボードモード: 横4列 ===== */
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
            {COLUMNS.map((column) => {
              const columnTasks = columnTasksOf(column.id)
              return (
                <div key={column.id} className={`rounded-2xl border-t-4 ${column.color} ${column.bg} p-2 sm:p-3 max-h-[80vh] flex flex-col`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className={`whitespace-nowrap rounded-lg px-2 py-1 text-xs font-bold sm:px-3 sm:text-sm ${column.badge}`}>{column.label}</span>
                    <span className="text-sm font-semibold text-[var(--color-text-sub)]">
                      {columnTasks.length < columnTotalOf(column.id) ? `${columnTasks.length} / ${columnTotalOf(column.id)}` : columnTasks.length}
                    </span>
                  </div>
                  <Droppable droppableId={String(column.id)}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`space-y-3 min-h-[60vh] overflow-y-auto rounded-xl p-1 transition ${
                          snapshot.isDraggingOver ? 'bg-[var(--color-primary)]/10 ring-2 ring-[var(--color-primary)]/20' : ''
                        }`}
                      >
                        {columnTasks.map((task, index) => (
                          <TaskCard key={task.id} task={task} index={index} layout="board"
                            assigneeOptions={assigneeOptions} {...taskHandlers} />
                        ))}
                        {provided.placeholder}
                        {column.id === COMPLETED_STATUS_ID && hiddenCompletedCount > 0 && (
                          <button onClick={() => setCompletedLimit((shown) => shown + COMPLETED_PAGE_SIZE)}
                            className="w-full rounded-lg border border-[var(--color-border)] bg-white py-2 text-xs font-semibold text-[var(--color-text-sub)] hover:bg-gray-50">
                            過去の完了をさらに {Math.min(hiddenCompletedCount, COMPLETED_PAGE_SIZE)} 件表示（残り {hiddenCompletedCount} 件）
                          </button>
                        )}
                      </div>
                    )}
                  </Droppable>
                </div>
              )
            })}
          </div>
        ) : (
          /* ===== タブモード: 横長1列 ===== */
          <div>
            {/* タブヘッダ (sticky + ドロップターゲット) */}
            <div className="sticky top-[105px] z-10 bg-[var(--color-bg)] flex gap-1 border-b border-[var(--color-border)] pb-0">
              {COLUMNS.map((column) => (
                <Droppable key={column.id} droppableId={String(column.id)} direction="horizontal">
                  {(provided, snapshot) => (
                    <div ref={provided.innerRef} {...provided.droppableProps} className="relative">
                      <button
                        onClick={() => setActiveTab(column.id)}
                        className={`whitespace-nowrap rounded-t-xl px-3 py-2.5 text-xs font-bold transition sm:px-6 sm:py-3 sm:text-sm ${
                          activeTab === column.id ? column.tabActive : `bg-[var(--color-bg)] ${column.tabInactive} hover:bg-gray-100`
                        } ${snapshot.isDraggingOver ? 'ring-2 ring-[var(--color-primary)] scale-105' : ''}`}
                      >
                        {column.label} ({columnTotalOf(column.id)})
                      </button>
                      <div className="hidden">{provided.placeholder}</div>
                    </div>
                  )}
                </Droppable>
              ))}
            </div>

            {/* タブ内容: 横1列リスト */}
            {COLUMNS.filter((column) => column.id === activeTab).map((column) => {
              const columnTasks = columnTasksOf(column.id)
              return (
                <Droppable key={column.id} droppableId={String(column.id)}>
                  {(provided) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`rounded-b-2xl ${column.bg} p-4 min-h-[60vh]`}
                    >
                      <div className="space-y-2">
                        {columnTasks.map((task, index) => (
                          <TaskCard key={task.id} task={task} index={index} layout="row"
                            assigneeOptions={assigneeOptions} {...taskHandlers} />
                        ))}
                      </div>
                      {columnTasks.length === 0 && (
                        <div className="py-16 text-center text-[var(--color-text-sub)]">タスクなし</div>
                      )}
                      {column.id === COMPLETED_STATUS_ID && hiddenCompletedCount > 0 && (
                        <button onClick={() => setCompletedLimit((shown) => shown + COMPLETED_PAGE_SIZE)}
                          className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-white py-2 text-xs font-semibold text-[var(--color-text-sub)] hover:bg-gray-50">
                          過去の完了をさらに {Math.min(hiddenCompletedCount, COMPLETED_PAGE_SIZE)} 件表示（残り {hiddenCompletedCount} 件）
                        </button>
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
