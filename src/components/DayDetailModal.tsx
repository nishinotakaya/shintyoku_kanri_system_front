import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { api } from '../lib/api'
import type { WorkReport, Expense } from '../lib/api'
import SapLink from './SapLink'
import Modal from './Modal'
import BacklogTaskDetailModal from './BacklogTaskDetailModal'
import TaskMemoEditor from './TaskMemoEditor'

function CommentMarkdown({ children }: { children: string }) {
  return (
    <div className="markdown-comment break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" className="text-fuchsia-600 hover:underline" />
          ),
          code: ({ node: _node, className, children, ...props }) => {
            const isInline = !/\blanguage-/.test(className ?? '')
            return isInline ? (
              <code {...props} className="rounded bg-gray-200 px-1 py-[1px] text-[10px] font-mono">{children}</code>
            ) : (
              <code {...props} className={`block rounded bg-gray-100 p-1.5 text-[10px] font-mono whitespace-pre-wrap ${className ?? ''}`}>{children}</code>
            )
          },
          pre: ({ node: _node, children, ...props }) => (
            <pre {...props} className="my-1 overflow-x-auto rounded bg-gray-100 p-1.5">{children}</pre>
          ),
          ul: ({ node: _node, ...props }) => <ul {...props} className="list-disc pl-4 my-0.5 space-y-0.5" />,
          ol: ({ node: _node, ...props }) => <ol {...props} className="list-decimal pl-4 my-0.5 space-y-0.5" />,
          h1: ({ node: _node, ...props }) => <h1 {...props} className="text-[12px] font-bold mt-1 mb-0.5" />,
          h2: ({ node: _node, ...props }) => <h2 {...props} className="text-[11px] font-bold mt-1 mb-0.5" />,
          h3: ({ node: _node, ...props }) => <h3 {...props} className="text-[11px] font-semibold mt-1 mb-0.5" />,
          p: ({ node: _node, ...props }) => <p {...props} className="my-0.5" />,
          blockquote: ({ node: _node, ...props }) => (
            <blockquote {...props} className="border-l-2 border-gray-300 pl-2 my-0.5 text-[var(--color-text-sub)]" />
          ),
          table: ({ node: _node, ...props }) => <table {...props} className="my-1 border-collapse text-[10px]" />,
          th: ({ node: _node, ...props }) => <th {...props} className="border border-gray-300 px-1 py-0.5 bg-gray-50 font-semibold" />,
          td: ({ node: _node, ...props }) => <td {...props} className="border border-gray-300 px-1 py-0.5" />,
          img: ({ node: _node, ...props }) => <img {...props} className="max-w-full rounded" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

type TeamScheduleEntry = { date: string; person: string; status: string }
type BacklogTask = {
  id: number
  issue_key: string
  summary: string
  status_id: number
  status_name: string
  url: string | null
  start_date: string | null
  end_date: string | null
  completed_on?: string | null
  memo?: string | null
}

type NotionTask = {
  id: number
  notion_block_id: string
  wbs_level: string | null
  title: string
  parent_task: string | null
  assignee_name: string | null
  start_date: string | null
  end_date: string | null
  workload: number | null
  progress_rate: number | null
  status: string | null
  priority: string | null
  note: string | null
  memo?: string | null
}

type TrelloTask = {
  id: number
  trello_card_id: string
  title: string
  description: string | null
  list_name: string | null
  board_name: string | null
  assignee_name: string | null
  start_date: string | null
  due_date: string | null
  url: string | null
  memo: string | null
  synced_at: string | null
}

type SapEntry = { key: string; hours: string }

const HOURS_OPTIONS = ['', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10']
const REPORT_HOURS_OPTIONS = ['', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12']

const STATUS_BADGE: Record<number, { label: string; class: string }> = {
  1: { label: '未対応', class: 'bg-amber-100 text-amber-700' },
  2: { label: '処理中', class: 'bg-sky-100 text-sky-700' },
  3: { label: '処理済', class: 'bg-emerald-100 text-emerald-700' },
}

type TaskComment = { id: number; content: string; created_user_name?: string | null; created?: string | null }

function TaskCard({ task, badge, onAddToWorkReport, onEditWings, alreadyInWings, editable = true, assignee, onMemoChanged, onOpenDetail, refreshTick = 0 }: {
  task: BacklogTask
  badge?: { label: string; class: string }
  assignee?: string
  editable?: boolean
  onAddToWorkReport: (issueKey: string, hours: string) => Promise<void> | void
  onEditWings: () => void
  alreadyInWings: boolean
  onMemoChanged?: (taskId: number, memo: string) => void
  onOpenDetail?: (task: BacklogTask) => void
  refreshTick?: number
}) {
  const [hours, setHours] = useState('1')
  const [adding, setAdding] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comments, setComments] = useState<TaskComment[] | null>(null)
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsError, setCommentsError] = useState<string | null>(null)
  const [latestComment, setLatestComment] = useState<TaskComment | null>(null)
  const [latestOpen, setLatestOpen] = useState(false)
  const saveMemo = async (value: string) => {
    await api.patch(`/backlog/tasks/${task.id}`, { memo: value })
    onMemoChanged?.(task.id, value)
  }

  const [unreadCount, setUnreadCount] = useState(0)
  const [mentionUnreadCount, setMentionUnreadCount] = useState(0)
  const [myName, setMyName] = useState<string | null>(null)
  const seenKey = `commentsSeen:${task.issue_key}`

  useEffect(() => {
    api.get<{ display_name?: string }>('/me').then((r) => setMyName(r.data.display_name ?? null)).catch(() => {})
  }, [])

  // 最新1件は自動で取得（メモ代わりに常時表示） + 未読件数を計算
  useEffect(() => {
    let cancelled = false
    api.get<TaskComment[]>(`/backlog/tasks/${encodeURIComponent(task.issue_key)}/comments`)
      .then((r) => {
        if (cancelled) return
        const filtered = r.data.filter((c) => (c.content ?? '').trim().length > 0)
        setLatestComment(filtered.length > 0 ? filtered[filtered.length - 1] : null)
        const seen = localStorage.getItem(seenKey)
        const seenAt = seen ? new Date(seen).getTime() : 0
        const unread = filtered.filter((c) => c.created && new Date(c.created).getTime() > seenAt)
        setUnreadCount(unread.length)
        if (myName) {
          // 自分宛メンション (姓だけ、姓+スペース+名 のどちらでもヒット)
          const lastName = myName.split(/[\s　]/)[0]
          const m = unread.filter((c) => c.content && (c.content.includes(`@${myName}`) || (lastName && c.content.includes(`@${lastName}`))))
          setMentionUnreadCount(m.length)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [task.issue_key, seenKey, myName, refreshTick])

  const markCommentsSeen = () => {
    localStorage.setItem(seenKey, new Date().toISOString())
    setUnreadCount(0)
    setMentionUnreadCount(0)
  }

  const formatUnreadBadge = (n: number): string => {
    if (n <= 0) return ''
    return n > 99 ? '99+' : String(n)
  }
  const handleAdd = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    setAdding(true)
    try {
      await onAddToWorkReport(task.issue_key, hours)
    } finally { setAdding(false) }
  }
  const handleEdit = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    onEditWings()
  }
  const toggleComments = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    if (commentsOpen) { setCommentsOpen(false); return }
    setCommentsOpen(true)
    markCommentsSeen()
    if (comments != null) return
    setCommentsLoading(true); setCommentsError(null)
    try {
      const r = await api.get<TaskComment[]>(`/backlog/tasks/${encodeURIComponent(task.issue_key)}/comments`)
      setComments(r.data.filter((c) => (c.content ?? '').trim().length > 0))
    } catch (err: any) {
      setCommentsError(err?.response?.data?.error ?? err?.message ?? '取得失敗')
    } finally { setCommentsLoading(false) }
  }
  return (
    <div
      className="rounded border border-[var(--color-border)] px-2 py-1 text-[11px] hover:bg-gray-50 cursor-grab active:cursor-grabbing"
      draggable={editable}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/json', JSON.stringify({ issueKey: task.issue_key, hours, assignee }))
        e.dataTransfer.effectAllowed = 'copy'
      }}
    >
      <div className="flex items-baseline justify-between gap-1">
        <a href={task.url ?? undefined} target="_blank" rel="noopener noreferrer" draggable={false} className="flex items-baseline gap-1 min-w-0 flex-1">
          <span className="font-mono text-fuchsia-600">{task.issue_key}</span>
          {badge && <span className={`rounded px-1 text-[9px] ${badge.class}`}>{badge.label}</span>}
        </a>
        <div className="flex items-center gap-1 shrink-0">
          {onOpenDetail && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenDetail(task); markCommentsSeen() }}
              className="relative rounded bg-white border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-fuchsia-600 hover:bg-fuchsia-50"
              title={mentionUnreadCount > 0 ? `自分宛未読メンション ${mentionUnreadCount} 件` : '詳細 (チャット / 投稿 / 編集)'}
            >
              📋 詳細
              {mentionUnreadCount > 0 && (
                <span
                  aria-label={`自分宛未読${mentionUnreadCount}件`}
                  className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-white text-[12px] font-bold leading-none flex items-center justify-center shadow ring-2 ring-white"
                >
                  {formatUnreadBadge(mentionUnreadCount)}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={toggleComments}
            className="relative rounded bg-white border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-sub)] hover:bg-gray-50"
            title={unreadCount > 0 ? `未読 ${unreadCount} 件` : 'コメントを見る'}
          >
            💬
            {unreadCount > 0 && (
              <span
                aria-label={`未読${unreadCount}件`}
                className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[12px] font-bold leading-none flex items-center justify-center shadow ring-2 ring-white"
              >
                {formatUnreadBadge(unreadCount)}
              </span>
            )}
          </button>
          {editable && !alreadyInWings && (
            <select
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="rounded border border-[var(--color-border)] px-1 py-0.5 text-[10px]"
            >
              {['0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5', '6', '7', '8'].map((h) => (
                <option key={h} value={h}>{h}h</option>
              ))}
            </select>
          )}
          {editable && (alreadyInWings ? (
            <button
              type="button"
              onClick={handleEdit}
              className="rounded bg-fuchsia-500 hover:bg-fuchsia-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow"
              title="タマの業務報告を編集"
            >
              編集
            </button>
          ) : (
            <button
              type="button"
              onClick={handleAdd}
              disabled={adding}
              className="rounded bg-emerald-500 hover:bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow disabled:opacity-50"
              title="タマの業務報告に追加"
            >
              {adding ? '...' : '勤怠に追加'}
            </button>
          ))}
        </div>
      </div>
      <a href={task.url ?? undefined} target="_blank" rel="noopener noreferrer" draggable={false} className="block text-[var(--color-text)] truncate">{task.summary}</a>
      <TaskMemoEditor value={task.memo} onSave={saveMemo} editable={editable} />
      {latestComment && (
        <div className="mt-1 rounded bg-sky-50 border border-sky-200 text-[10px] text-[var(--color-text)]">
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLatestOpen((v) => !v) }}
            className="w-full flex items-center justify-between px-2 py-1 hover:bg-sky-100"
          >
            <span className="font-semibold text-sky-700">💬 最新コメント {latestOpen ? '▲' : '▼'}</span>
            {!latestOpen && (
              <span className="ml-2 truncate text-[var(--color-text-sub)] flex-1 text-left">
                {(latestComment.created_user_name ?? '?')}: {latestComment.content.replace(/\s+/g, ' ').slice(0, 30)}{latestComment.content.length > 30 && '…'}
              </span>
            )}
          </button>
          {latestOpen && (
            <div className="px-2 pb-1">
              <div className="text-[var(--color-text-sub)] text-[9px] mb-0.5">
                {latestComment.created_user_name ?? '?'} {latestComment.created && new Date(latestComment.created).toLocaleString('ja-JP')}
              </div>
              <CommentMarkdown>{latestComment.content}</CommentMarkdown>
            </div>
          )}
        </div>
      )}
      {commentsOpen && (
        <div className="mt-1 rounded bg-gray-50 border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text)] space-y-1 max-h-48 overflow-y-auto">
          {commentsLoading && <div className="text-[var(--color-text-sub)]">読み込み中…</div>}
          {commentsError && <div className="text-red-500">取得失敗: {commentsError}</div>}
          {!commentsLoading && !commentsError && (comments?.length ?? 0) === 0 && (
            <div className="text-[var(--color-text-sub)]">コメントなし</div>
          )}
          {(comments ?? []).map((c) => (
            <div key={c.id} className="border-t border-[var(--color-border)] pt-1 first:border-t-0 first:pt-0">
              <div className="flex items-center gap-2 text-[var(--color-text-sub)]">
                <span className="font-semibold">{c.created_user_name ?? '?'}</span>
                {c.created && <span className="text-[9px]">{new Date(c.created).toLocaleString('ja-JP')}</span>}
              </div>
              <CommentMarkdown>{c.content}</CommentMarkdown>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function parseSapEntries(content: string): SapEntry[] {
  return (content || '').split('/').map((part) => {
    // 末尾の (時間) を抽出。残りをキーとする。SAP形式以外（日本語タスク名やローカル名）にも対応
    const matched = part.trim().match(/^(.+?)(?:\(([\d.]+)\))?$/)
    if (matched) return { key: matched[1].trim(), hours: matched[2] ?? '' }
    return { key: part.trim(), hours: '' }
  }).filter((entry) => entry.key)
}

function joinSapEntries(entries: SapEntry[]): string {
  return entries
    .filter((entry) => entry.key)
    .map((entry) => (entry.hours ? `${entry.key}(${entry.hours})` : entry.key))
    .join('/')
}

export default function DayDetailModal({
  date,
  onClose,
  workReports,
  expenses,
  teamSchedules,
  onChanged,
  canEditPerson,
  currentSurname,
  asUserId,
  onExportSchedule,
  canExport,
}: {
  date: string
  onClose: () => void
  workReports: WorkReport[]
  expenses: Expense[]
  teamSchedules: TeamScheduleEntry[]
  onChanged?: () => void
  canEditPerson?: (person: string) => boolean
  currentSurname?: string
  asUserId?: number | null
  onExportSchedule?: () => Promise<void> | void
  canExport?: boolean
}) {
  const asUserParam = asUserId ? { as_user_id: asUserId } : {}
  const allowEdit = (person: string) => (canEditPerson ? canEditPerson(person) : true)
  const isAdmin = (currentSurname ?? '').includes('西野')
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const handleExport = async () => {
    if (!onExportSchedule || exporting) return
    setExporting(true); setExportMsg(null)
    try {
      await onExportSchedule()
      setExportMsg('書き戻しました')
    } catch (e: any) {
      setExportMsg(`失敗: ${e?.message ?? ''}`)
    } finally { setExporting(false) }
  }
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [commentRefreshTick, setCommentRefreshTick] = useState(0)
  const handleBacklogSync = async () => {
    if (syncing) return
    setSyncing(true); setSyncMsg(null)
    try {
      const { data } = await api.post('/backlog/sync')
      setSyncMsg(`${data.synced} 件同期`)
      // 当日タスクを再取得
      const [n, k] = await Promise.all([
        api.get<BacklogTask[]>('/backlog/tasks_on_date', { params: { date, assignee: '西野' } }),
        api.get<BacklogTask[]>('/backlog/tasks_on_date', { params: { date, assignee: '川村' } }),
      ])
      setTasksByAssignee({ '西野': n.data, '川村': k.data })
      const all = await api.get<BacklogTask[]>('/backlog/tasks')
      setAllTasks(all.data)
      // 同期完了後、各 TaskCard のコメント再 fetch を発火 (バッジ更新)
      setCommentRefreshTick((t) => t + 1)
    } catch (e: any) {
      setSyncMsg(`同期失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setSyncing(false) }
  }
  const [tasksByAssignee, setTasksByAssignee] = useState<Record<string, BacklogTask[]>>({})
  const [allTasks, setAllTasks] = useState<BacklogTask[]>([])
  const [detailTask, setDetailTask] = useState<BacklogTask | null>(null)
  const [meInfo, setMeInfo] = useState<{ display_name?: string | null; backlog_user_id?: number | null }>({})
  // 閲覧できるデータソース。権限が無いタブは描かず、取得もしない
  const [viewableSources, setViewableSources] = useState<string[]>([])
  const canViewNotion = viewableSources.includes('notion')
  const canViewTrello = viewableSources.includes('trello')
  useEffect(() => {
    api.get<{ display_name?: string; viewable_data_sources?: string[] }>('/me').then((r) => {
      setMeInfo((p) => ({ ...p, display_name: r.data.display_name }))
      setViewableSources(r.data.viewable_data_sources ?? [])
    }).catch(() => {})
    api.get<{ user_backlog_id?: number }>('/backlog/setting').then((r) => setMeInfo((p) => ({ ...p, backlog_user_id: r.data.user_backlog_id }))).catch(() => {})
  }, [])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [newTaskInput, setNewTaskInput] = useState<Record<string, string>>({})
  const [addingTaskFor, setAddingTaskFor] = useState<string | null>(null)
  const reloadTasks = async () => {
    const [n, k] = await Promise.all([
      api.get<BacklogTask[]>('/backlog/tasks_on_date', { params: { date, assignee: '西野' } }),
      api.get<BacklogTask[]>('/backlog/tasks_on_date', { params: { date, assignee: '川村' } }),
    ])
    setTasksByAssignee({ '西野': n.data, '川村': k.data })
  }
  const addLocalTask = async (assignee: string) => {
    const summary = (newTaskInput[assignee] ?? '').trim()
    if (!summary) return
    setAddingTaskFor(assignee)
    try {
      await api.post('/backlog/tasks', {
        summary,
        assignee_name: assignee,
        start_date: date,
        end_date: date,
      })
      setNewTaskInput((prev) => ({ ...prev, [assignee]: '' }))
      await reloadTasks()
    } catch (e: any) {
      alert(`タスク追加失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setAddingTaskFor(null)
    }
  }
  const [editing, setEditing] = useState<Record<number, { hours: string; content: string; sapEntries: SapEntry[] }>>({})
  const [saving, setSaving] = useState<number | null>(null)
  const [creatingCategory, setCreatingCategory] = useState<'living' | 'wings' | null>(null)
  const [draftNew, setDraftNew] = useState<{ hours: string; content: string; sapEntries: SapEntry[] }>({ hours: '', content: '', sapEntries: [] })
  // 当日タスクのステータスフィルタ（既定: 未対応/処理中/処理済 を表示、完了は除外）
  const [taskStatusFilter, setTaskStatusFilter] = useState<Set<number>>(() => new Set([1, 2, 3]))
  const toggleTaskStatus = (id: number) => {
    setTaskStatusFilter((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  useEffect(() => {
    setTasksLoading(true)
    Promise.all([
      api.get<BacklogTask[]>('/backlog/tasks_on_date', { params: { date, assignee: '西野' } }),
      api.get<BacklogTask[]>('/backlog/tasks_on_date', { params: { date, assignee: '川村' } }),
    ])
      .then(([nishino, kawamura]) => setTasksByAssignee({ '西野': nishino.data, '川村': kawamura.data }))
      .catch(() => setTasksByAssignee({}))
      .finally(() => setTasksLoading(false))
    api.get<BacklogTask[]>('/backlog/tasks').then((r) => setAllTasks(r.data)).catch(() => setAllTasks([]))
  }, [date])

  // Notion (リビング) タスク
  const [notionTasksByAssignee, setNotionTasksByAssignee] = useState<Record<string, NotionTask[]>>({ '西野': [], '川村': [] })
  const [taskTab, setTaskTab] = useState<'tama' | 'living' | 'trello'>('tama')
  const [notionSyncing, setNotionSyncing] = useState(false)
  const [notionSyncMsg, setNotionSyncMsg] = useState<string | null>(null)
  const groupNotion = (tasks: NotionTask[]): Record<string, NotionTask[]> => {
    const grouped: Record<string, NotionTask[]> = { '西野': [], '川村': [] }
    tasks.forEach((task) => {
      if (task.assignee_name?.includes('西野')) grouped['西野'].push(task)
      else if (task.assignee_name?.includes('川村')) grouped['川村'].push(task)
    })
    return grouped
  }
  const reloadNotion = async () => {
    try {
      const response = await api.get<NotionTask[]>('/notion_tasks')
      setNotionTasksByAssignee(groupNotion(response.data))
    } catch {
      setNotionTasksByAssignee({ '西野': [], '川村': [] })
    }
  }
  useEffect(() => { if (canViewNotion) reloadNotion() }, [date, canViewNotion])
  const handleNotionSync = async () => {
    if (notionSyncing) return
    setNotionSyncing(true); setNotionSyncMsg(null)
    try {
      const { data } = await api.post('/notion_tasks/sync')
      setNotionSyncMsg(`${data.synced} 件同期`)
      await reloadNotion()
    } catch (e: any) {
      setNotionSyncMsg(`同期失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setNotionSyncing(false)
    }
  }
  const [notionHoursById, setNotionHoursById] = useState<Record<number, string>>({})
  const addNotionToWorkReport = async (task: NotionTask, targetAssignee?: string, hoursOverride?: string) => {
    try {
      const hours = Number(hoursOverride ?? notionHoursById[task.id] ?? '1')
      await api.post('/work_reports/append_task', {
        work_date: date,
        category: 'living',
        issue_key: task.title,
        hours,
        target_assignee: targetAssignee,
      })
      onChanged?.()
    } catch (e: any) {
      alert(`リビング追加失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }

  // Trello (テックリーダー) タスク
  const [trelloTasks, setTrelloTasks] = useState<Record<string, TrelloTask[]>>({})
  const [trelloSyncing, setTrelloSyncing] = useState(false)
  const [trelloSyncMsg, setTrelloSyncMsg] = useState<string | null>(null)
  const reloadTrello = async () => {
    try {
      const response = await api.get<TrelloTask[]>('/trello_tasks')
      const grouped: Record<string, TrelloTask[]> = {}
      response.data.forEach((task) => {
        const listName = task.list_name ?? 'その他'
        if (!grouped[listName]) grouped[listName] = []
        grouped[listName].push(task)
      })
      setTrelloTasks(grouped)
    } catch {
      setTrelloTasks({})
    }
  }
  useEffect(() => { if (canViewTrello) reloadTrello() }, [date, canViewTrello])
  const handleTrelloSync = async () => {
    if (trelloSyncing) return
    setTrelloSyncing(true); setTrelloSyncMsg(null)
    try {
      const { data } = await api.post('/trello_tasks/sync')
      setTrelloSyncMsg(`${data.synced} 件同期`)
      await reloadTrello()
    } catch (e: any) {
      setTrelloSyncMsg(`同期失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setTrelloSyncing(false)
    }
  }

  const dayReports = useMemo(() =>
    workReports
      .filter((r) => r.work_date === date)
      .sort((a, b) => {
        // リビング先、タマ後
        const order = (cat: string | null | undefined) => (cat === 'living' ? 0 : 1)
        return order(a.category) - order(b.category)
      })
  , [workReports, date])

  const existingCategories = useMemo(() => new Set(dayReports.map((r) => r.category ?? 'wings')), [dayReports])

  const startCreate = (category: 'living' | 'wings') => {
    setCreatingCategory(category)
    setDraftNew({ hours: '', content: '', sapEntries: category === 'wings' ? [{ key: '', hours: '' }] : [] })
  }
  const cancelCreate = () => { setCreatingCategory(null); setDraftNew({ hours: '', content: '', sapEntries: [] }) }
  const submitCreate = async () => {
    if (!creatingCategory) return
    const isWings = creatingCategory === 'wings'
    const finalContent = isWings ? joinSapEntries(draftNew.sapEntries) : draftNew.content
    setSaving(-1)
    try {
      await api.post('/work_reports', {
        work_date: date,
        category: creatingCategory,
        hours: draftNew.hours === '' ? null : Number(draftNew.hours),
        content: finalContent,
      }, { params: asUserParam })
      onChanged?.()
      cancelCreate()
    } catch (e: any) {
      alert(`作成失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setSaving(null)
    }
  }
  // タスクを タマ 業務報告に追加（既存があれば追記、なければ作成）
  const addTaskToWorkReport = async (issueKey: string, hours: string, assignee?: string) => {
    if (!hours || hours === '') return
    try {
      await api.post('/work_reports/append_task', {
        work_date: date,
        category: 'wings',
        issue_key: issueKey,
        hours: Number(hours),
        target_assignee: assignee,
      }, { params: asUserParam })
      if (creatingCategory === 'wings') cancelCreate()
      onChanged?.()
    } catch (e: any) {
      const detail = e?.response?.data?.error ?? (e?.response?.data ? JSON.stringify(e.response.data) : '') ?? e?.message ?? ''
      alert(`勤怠追加失敗: ${detail}`)
      throw e
    }
  }

  // リビング(Notion)タスクの手入力メモを保存し、ローカル state にも反映する（タマの onMemoChanged 相当）。
  const saveNotionMemo = async (taskId: number, value: string) => {
    await api.patch(`/notion_tasks/${taskId}`, { memo: value })
    setNotionTasksByAssignee((prev) => {
      const next: Record<string, NotionTask[]> = {}
      for (const [person, tasks] of Object.entries(prev)) {
        next[person] = tasks.map((task) => (task.id === taskId ? { ...task, memo: value } : task))
      }
      return next
    })
  }

  // 新規作成側も SAP 明細を変更/追加/削除すると合計 hours を自動再計算する
  const updateNewSapRow = (index: number, patch: Partial<SapEntry>) => {
    setDraftNew((prev) => {
      const next = [...prev.sapEntries]
      next[index] = { ...next[index], ...patch }
      return { ...prev, sapEntries: next, hours: recalcHours(next) }
    })
  }
  const addNewSapRow = () => setDraftNew((prev) => {
    const next = [...prev.sapEntries, { key: '', hours: '' }]
    return { ...prev, sapEntries: next, hours: recalcHours(next) }
  })
  const removeNewSapRow = (index: number) => setDraftNew((prev) => {
    const next = prev.sapEntries.filter((_, i) => i !== index)
    return { ...prev, sapEntries: next, hours: recalcHours(next) }
  })

  // タスク選択候補: 未対応/処理中/処理済 + 完了は1ヶ月以内
  const eligibleTasks = useMemo(() => {
    const oneMonthAgo = new Date()
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)
    return allTasks.filter((task) => {
      if (task.status_id !== 4) return true
      if (!task.completed_on) return false
      return new Date(task.completed_on) >= oneMonthAgo
    })
  }, [allTasks])
  const dayExpenses = expenses.filter((e) => e.expense_date === date)
  const dayTeam = teamSchedules.filter((t) => t.date === date)

  // 立替金(電車賃)の追加/削除。どちらも勤怠(work_report)の交通費欄に反映される。
  const [expenseBusy, setExpenseBusy] = useState(false)
  const addTransitExpense = async () => {
    if (expenseBusy) return
    setExpenseBusy(true)
    try {
      await api.post('/expenses/add_transit', { date, category: 'wings', ...asUserParam })
      onChanged?.()
    } catch (e: any) {
      alert(`電車賃の追加に失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setExpenseBusy(false)
    }
  }
  const deleteExpense = async (id: number) => {
    if (expenseBusy) return
    if (!confirm('この立替金を削除しますか？')) return
    setExpenseBusy(true)
    try {
      await api.delete(`/expenses/${id}`, { params: asUserParam })
      onChanged?.()
    } catch (e: any) {
      alert(`削除に失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setExpenseBusy(false)
    }
  }

  const startEdit = (report: WorkReport) => {
    setEditing((prev) => ({
      ...prev,
      [report.id]: {
        hours: report.hours != null ? String(report.hours) : '',
        content: report.content ?? '',
        sapEntries: parseSapEntries(report.content ?? ''),
      },
    }))
  }
  const cancelEdit = (id: number) => {
    setEditing((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }
  const saveEdit = async (report: WorkReport) => {
    const draft = editing[report.id]
    if (!draft) return
    const isWings = (report.category ?? 'wings') !== 'living'
    const finalContent = isWings ? joinSapEntries(draft.sapEntries) : draft.content
    setSaving(report.id)
    try {
      await api.patch(`/work_reports/${report.id}`, {
        hours: draft.hours === '' ? null : Number(draft.hours),
        content: finalContent,
      }, { params: asUserParam })
      onChanged?.()
      cancelEdit(report.id)
    } catch (e: any) {
      alert(`保存失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setSaving(null)
    }
  }

  // SAP 明細を変更すると draft.hours も自動再計算
  const recalcHours = (entries: SapEntry[]): string => {
    const sum = entries.reduce((acc, entry) => acc + (Number(entry.hours) || 0), 0)
    return sum > 0 ? String(sum) : ''
  }

  const updateSapRow = (reportId: number, index: number, patch: Partial<SapEntry>) => {
    setEditing((prev) => {
      const draft = prev[reportId]
      if (!draft) return prev
      const next = [...draft.sapEntries]
      next[index] = { ...next[index], ...patch }
      return { ...prev, [reportId]: { ...draft, sapEntries: next, hours: recalcHours(next) } }
    })
  }
  const addSapRow = (reportId: number) => {
    setEditing((prev) => {
      const draft = prev[reportId]
      if (!draft) return prev
      const next = [...draft.sapEntries, { key: '', hours: '' }]
      return { ...prev, [reportId]: { ...draft, sapEntries: next } }
    })
  }
  const removeSapRow = (reportId: number, index: number) => {
    setEditing((prev) => {
      const draft = prev[reportId]
      if (!draft) return prev
      const next = draft.sapEntries.filter((_, i) => i !== index)
      return { ...prev, [reportId]: { ...draft, sapEntries: next, hours: recalcHours(next) } }
    })
  }

  const renderEditor = (report: WorkReport) => {
    const draft = editing[report.id]
    if (!draft) return null
    const isWings = (report.category ?? 'wings') !== 'living'
    return (
      <div className="mt-2 space-y-2 rounded-md bg-gray-50 p-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--color-text-sub)]">合計時間</span>
          {isWings ? (
            // Wings: SAP 明細から自動算出 → 読み取り専用表示
            <span className="text-xs font-mono tabular-nums text-[var(--color-text)] font-semibold">
              {draft.hours || '0'}h
            </span>
          ) : (
            // リビング: 手動入力
            <select
              value={draft.hours}
              onChange={(e) => setEditing((prev) => ({ ...prev, [report.id]: { ...prev[report.id], hours: e.target.value } }))}
              className="rounded border border-[var(--color-border)] px-2 py-1 text-xs"
            >
              {REPORT_HOURS_OPTIONS.map((option) => (
                <option key={option} value={option}>{option || '—'}{option ? 'h' : ''}</option>
              ))}
            </select>
          )}
        </div>

        {isWings ? (
          <div className="space-y-1">
            <div className="text-[10px] text-[var(--color-text-sub)]">タマ（SAP 明細） — 合計は明細から自動反映されます</div>
            {draft.sapEntries.map((entry, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <input
                  list={`sap-tasks-${report.id}-${idx}`}
                  value={entry.key}
                  onChange={(e) => updateSapRow(report.id, idx, { key: e.target.value })}
                  placeholder="ISN-XXX 等（候補から選択 or 直接入力）"
                  className="flex-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs"
                />
                <datalist id={`sap-tasks-${report.id}-${idx}`}>
                  {eligibleTasks.map((task) => (
                    <option key={task.id} value={task.issue_key}>{`[${task.status_name}] ${task.summary?.slice(0, 30) ?? ''}`}</option>
                  ))}
                </datalist>
                <select
                  value={entry.hours}
                  onChange={(e) => updateSapRow(report.id, idx, { hours: e.target.value })}
                  className="w-16 rounded border border-[var(--color-border)] px-1 py-1 text-xs"
                >
                  {HOURS_OPTIONS.map((h) => (
                    <option key={h} value={h}>{h || '—'}</option>
                  ))}
                </select>
                <button onClick={() => removeSapRow(report.id, idx)} className="px-1 text-red-400 hover:text-red-500" title="削除">×</button>
              </div>
            ))}
            <button onClick={() => addSapRow(report.id)} className="text-[11px] text-fuchsia-500 hover:text-fuchsia-400">＋ 行を追加</button>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="text-[10px] text-[var(--color-text-sub)]">リビング（自由入力）</div>
            <textarea
              value={draft.content}
              onChange={(e) => setEditing((prev) => ({ ...prev, [report.id]: { ...prev[report.id], content: e.target.value } }))}
              rows={3}
              className="w-full rounded border border-[var(--color-border)] px-2 py-1 text-xs"
            />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={() => cancelEdit(report.id)} className="rounded border border-[var(--color-border)] bg-white px-3 py-1 text-xs">キャンセル</button>
          <button
            onClick={() => saveEdit(report)}
            disabled={saving === report.id}
            className="rounded bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1 text-xs font-semibold text-white shadow disabled:opacity-50"
          >
            {saving === report.id ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    )
  }

  // 詳細モードはモーダル全体を BacklogTaskDetailModal に差し替え
  if (detailTask) {
    return (
      <Modal onClose={onClose} size="md" panelClassName="!max-w-2xl !rounded-2xl !p-4 md:!p-5 !shadow-2xl max-md:!max-h-[96vh]">
        <BacklogTaskDetailModal
          issueKey={detailTask.issue_key}
          summary={detailTask.summary}
          taskUrl={detailTask.url}
          onBack={() => setDetailTask(null)}
          myName={meInfo.display_name}
          myBacklogUserId={meInfo.backlog_user_id}
        />
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} size="md" panelClassName="!max-w-2xl !rounded-2xl !p-4 md:!p-5 !shadow-2xl max-md:!max-h-[96vh]">
        <div className="border-b border-[var(--color-border)] pb-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-base font-semibold text-[var(--color-text)]">{date} の詳細</div>
            <button onClick={onClose} className="shrink-0 px-1 text-lg leading-none text-[var(--color-text-sub)] hover:text-[var(--color-text)]">×</button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button
              onClick={handleBacklogSync}
              disabled={syncing}
              className="rounded-md whitespace-nowrap bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1 text-xs font-semibold text-white shadow disabled:opacity-50"
              title="バックログから当日タスクを再取得"
            >
              {syncing ? '同期中…' : '🔄 バックログ同期'}
            </button>
            {syncMsg && <span className="text-[10px] text-emerald-600">{syncMsg}</span>}
            {canExport && onExportSchedule && (
              <button
                onClick={handleExport}
                disabled={exporting}
                className="rounded-md whitespace-nowrap bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-1 text-xs font-semibold text-white shadow disabled:opacity-50"
                title="今月分のチーム予定をスプレッドシートに書き戻し"
              >
                {exporting ? '書き戻し中…' : '📤 シートに書き戻し'}
              </button>
            )}
            {exportMsg && <span className="text-[10px] text-emerald-600">{exportMsg}</span>}
          </div>
        </div>

        {/* チーム予定 */}
        {dayTeam.length > 0 && (
          <section className="mt-3">
            <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-sub)]">チーム予定</div>
            <div className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              {dayTeam.map((entry, i) => (
                <div key={i} className="rounded-lg border border-[var(--color-border)] px-2 py-1">
                  <div className="font-semibold">{entry.person}</div>
                  <div className="text-[var(--color-text-sub)]">{entry.status}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 業務報告 */}
        <section className="mt-4">
          <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-sub)]">業務報告</div>
          {dayReports.length === 0 && creatingCategory == null && (
            <div className="mt-1 text-[11px] text-[var(--color-text-sub)]">この日の業務報告はまだありません</div>
          )}
        </section>

        <section className="mt-2">
          <div className="space-y-2">
            {dayReports.map((report) => {
              const categoryLabel = report.category === 'living' ? 'リビング' : 'タマ'
              const isEditing = editing[report.id] != null
              const isWings = (report.category ?? 'wings') !== 'living'
              const dropHandlers = isWings ? {
                onDragOver: (e: React.DragEvent) => {
                  e.preventDefault()
                  e.stopPropagation()
                  e.dataTransfer.dropEffect = 'copy'
                  e.currentTarget.classList.add('ring-2', 'ring-emerald-400', 'bg-emerald-50')
                },
                onDragLeave: (e: React.DragEvent) => {
                  e.currentTarget.classList.remove('ring-2', 'ring-emerald-400', 'bg-emerald-50')
                },
                onDrop: async (e: React.DragEvent) => {
                  e.preventDefault()
                  e.stopPropagation()
                  e.currentTarget.classList.remove('ring-2', 'ring-emerald-400', 'bg-emerald-50')
                  try {
                    const raw = e.dataTransfer.getData('application/json')
                    if (!raw) { alert('ドロップデータが空です'); return }
                    const data = JSON.parse(raw)
                    if (!data?.issueKey) { alert('issueKey なし'); return }
                    await addTaskToWorkReport(data.issueKey, String(data.hours ?? '1'), data.assignee)
                  } catch (err: any) {
                    alert(`ドロップ失敗: ${err?.message ?? err}`)
                  }
                },
              } : {}
              return (
                <div key={report.id} {...dropHandlers} className={`rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs transition ${isWings ? 'hover:border-emerald-400' : ''}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono tabular-nums">{report.hours ?? 0}h</span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-[var(--color-text-sub)]">{categoryLabel}</span>
                    </div>
                    {!isEditing && (
                      <button onClick={() => startEdit(report)} className="text-[11px] text-fuchsia-500 hover:text-fuchsia-400">編集</button>
                    )}
                  </div>
                  {!isEditing && report.content && (
                    <div className="mt-1 leading-relaxed"><SapLink text={report.content} /></div>
                  )}
                  {!isEditing && report.transit_section && (
                    <div className="mt-0.5 text-[var(--color-text-sub)]">{report.transit_section}{report.transit_fee ? ` ¥${report.transit_fee}` : ''}</div>
                  )}
                  {isEditing && renderEditor(report)}
                </div>
              )
            })}

            {/* 新規追加 */}
            {creatingCategory && (
              <div className="rounded-lg border-2 border-dashed border-fuchsia-300 bg-fuchsia-50/30 px-3 py-2 text-xs">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="rounded bg-fuchsia-100 px-1.5 py-0.5 text-[10px] text-fuchsia-700">{creatingCategory === 'living' ? 'リビング' : 'タマ'} 新規</span>
                </div>
                <div className="space-y-2 rounded-md bg-gray-50 p-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--color-text-sub)]">合計時間</span>
                    {creatingCategory === 'wings' ? (
                      // Wings: SAP 明細から自動算出 → 読み取り専用表示
                      <span className="text-xs font-mono tabular-nums text-[var(--color-text)] font-semibold">
                        {draftNew.hours || '0'}h
                      </span>
                    ) : (
                      <select
                        value={draftNew.hours}
                        onChange={(e) => setDraftNew((prev) => ({ ...prev, hours: e.target.value }))}
                        className="rounded border border-[var(--color-border)] px-2 py-1 text-xs"
                      >
                        {REPORT_HOURS_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option || '—'}{option ? 'h' : ''}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  {creatingCategory === 'wings' ? (
                    <div className="space-y-1">
                      <div className="text-[10px] text-[var(--color-text-sub)]">タマ（SAP 明細） — 合計は明細から自動反映されます</div>
                      {draftNew.sapEntries.map((entry, idx) => (
                        <div key={idx} className="flex items-center gap-1">
                          <input
                            list={`sap-tasks-new-${idx}`}
                            value={entry.key}
                            onChange={(e) => updateNewSapRow(idx, { key: e.target.value })}
                            placeholder="ISN-XXX 等（候補から選択 or 直接入力）"
                            className="flex-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs"
                          />
                          <datalist id={`sap-tasks-new-${idx}`}>
                            {eligibleTasks.map((task) => (
                              <option key={task.id} value={task.issue_key}>{`[${task.status_name}] ${task.summary?.slice(0, 30) ?? ''}`}</option>
                            ))}
                          </datalist>
                          <select
                            value={entry.hours}
                            onChange={(e) => updateNewSapRow(idx, { hours: e.target.value })}
                            className="w-16 rounded border border-[var(--color-border)] px-1 py-1 text-xs"
                          >
                            {HOURS_OPTIONS.map((h) => (<option key={h} value={h}>{h || '—'}</option>))}
                          </select>
                          <button onClick={() => removeNewSapRow(idx)} className="px-1 text-red-400 hover:text-red-500">×</button>
                        </div>
                      ))}
                      <button onClick={addNewSapRow} className="text-[11px] text-fuchsia-500 hover:text-fuchsia-400">＋ 行を追加</button>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="text-[10px] text-[var(--color-text-sub)]">リビング（自由入力）</div>
                      <textarea
                        value={draftNew.content}
                        onChange={(e) => setDraftNew((prev) => ({ ...prev, content: e.target.value }))}
                        rows={3}
                        className="w-full rounded border border-[var(--color-border)] px-2 py-1 text-xs"
                      />
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button onClick={cancelCreate} className="rounded border border-[var(--color-border)] bg-white px-3 py-1 text-xs">キャンセル</button>
                    <button
                      onClick={submitCreate}
                      disabled={saving === -1}
                      className="rounded bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1 text-xs font-semibold text-white shadow disabled:opacity-50"
                    >
                      {saving === -1 ? '作成中…' : '作成'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 追加ボタン */}
            {creatingCategory == null && (
              <div className="flex gap-2">
                {!existingCategories.has('living') && (
                  <button
                    onClick={() => startCreate('living')}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      e.dataTransfer.dropEffect = 'copy'
                      e.currentTarget.classList.add('ring-4', 'ring-fuchsia-400', 'bg-fuchsia-50', 'border-fuchsia-500')
                    }}
                    onDragLeave={(e) => {
                      e.currentTarget.classList.remove('ring-4', 'ring-fuchsia-400', 'bg-fuchsia-50', 'border-fuchsia-500')
                    }}
                    onDrop={async (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      e.currentTarget.classList.remove('ring-4', 'ring-fuchsia-400', 'bg-fuchsia-50', 'border-fuchsia-500')
                      try {
                        const raw = e.dataTransfer.getData('application/json')
                        if (!raw) { alert('ドロップデータが空'); return }
                        const dropped = JSON.parse(raw)
                        if (dropped?.source !== 'notion' || !dropped?.title) {
                          alert('リビングへは Notion タスクのみドロップできます')
                          return
                        }
                        await addNotionToWorkReport(
                          { id: -1, title: dropped.title } as NotionTask,
                          dropped.assignee,
                          String(dropped.hours ?? '1'),
                        )
                      } catch (err: any) {
                        alert(`リビング追加失敗: ${err?.message ?? err}`)
                      }
                    }}
                    className="flex-1 rounded-lg border-2 border-dashed border-fuchsia-300 px-3 py-1.5 text-xs text-fuchsia-600 hover:bg-fuchsia-50"
                  >
                    ＋ リビング を追加（Notion タスクをドロップで追加）
                  </button>
                )}
                {!existingCategories.has('wings') && (
                  <button
                    onClick={() => startCreate('wings')}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      e.dataTransfer.dropEffect = 'copy'
                      e.currentTarget.classList.add('ring-4', 'ring-emerald-400', 'bg-emerald-50', 'border-emerald-500')
                    }}
                    onDragLeave={(e) => {
                      e.currentTarget.classList.remove('ring-4', 'ring-emerald-400', 'bg-emerald-50', 'border-emerald-500')
                    }}
                    onDrop={async (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      e.currentTarget.classList.remove('ring-4', 'ring-emerald-400', 'bg-emerald-50', 'border-emerald-500')
                      try {
                        const raw = e.dataTransfer.getData('application/json')
                        if (!raw) { alert('ドロップデータが空（リンク部分からのドラッグ等）'); return }
                        const data = JSON.parse(raw)
                        if (!data?.issueKey) { alert('issueKey なし'); return }
                        await addTaskToWorkReport(data.issueKey, String(data.hours ?? '1'), data.assignee)
                      } catch (err: any) {
                        alert(`タマ追加失敗: ${err?.message ?? err}`)
                      }
                    }}
                    className="flex-[2] rounded-lg border-2 border-dashed border-fuchsia-300 px-4 py-3 text-sm font-semibold text-fuchsia-600 hover:bg-fuchsia-50 hover:border-emerald-400 transition"
                  >
                    ＋ タマ を追加（タスクをドロップで追加）
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 立替金（電車賃の追加/削除 → 勤怠の交通費欄に反映） */}
        <section className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-sub)]">立替金</div>
            <button onClick={addTransitExpense} disabled={expenseBusy}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
              {expenseBusy ? '…' : '＋ 電車賃を追加'}
            </button>
          </div>
          <div className="mt-1 space-y-1">
            {dayExpenses.length === 0 && (
              <div className="text-[10px] text-[var(--color-text-sub)]">立替金なし</div>
            )}
            {dayExpenses.map((e) => (
              <div key={e.id} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs flex items-baseline justify-between gap-2">
                <span className="flex-1">{e.purpose}{e.from_station && e.to_station ? `（${e.from_station}〜${e.to_station}）` : ''}</span>
                <span className="font-mono tabular-nums">¥{e.amount.toLocaleString()}</span>
                <button onClick={() => deleteExpense(e.id)} disabled={expenseBusy}
                  className="text-rose-500 hover:text-rose-700 disabled:opacity-50" title="削除">🗑</button>
              </div>
            ))}
          </div>
          <div className="mt-1 text-[10px] text-[var(--color-text-sub)]">電車賃は設定の「デフォルト交通費」を使用。追加/削除は勤怠の交通費欄にも反映されます。</div>
        </section>

        {/* 当日のタスク */}
        <section className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-sub)]">当日のタスク</div>
            <div className="flex items-center gap-1">
              {[
                { id: 1, label: '未対応', activeCls: 'bg-amber-500 text-white border-amber-500' },
                { id: 2, label: '処理中', activeCls: 'bg-sky-500 text-white border-sky-500' },
                { id: 3, label: '処理済', activeCls: 'bg-emerald-500 text-white border-emerald-500' },
              ].map(({ id, label, activeCls }) => {
                const on = taskStatusFilter.has(id)
                return (
                  <button
                    key={id}
                    onClick={() => toggleTaskStatus(id)}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold transition ${on ? activeCls : 'bg-white border-[var(--color-border)] text-[var(--color-text-sub)] hover:bg-gray-50'}`}
                    title={`${label}を${on ? '非表示' : '表示'}`}
                  >
                    {on ? '✓' : ''} {label}
                  </button>
                )
              })}
            </div>
          </div>
          {/* タマ / リビング タブ + Notion 同期ボタン */}
          <div className="mt-2 flex items-center gap-1">
            <button
              onClick={() => setTaskTab('tama')}
              className={`rounded-t px-3 py-1 text-[11px] font-semibold transition ${taskTab === 'tama' ? 'bg-emerald-500 text-white' : 'bg-white border border-[var(--color-border)] text-[var(--color-text-sub)] hover:bg-gray-50'}`}
            >
              タマ
            </button>
            {canViewNotion && (
              <button
                onClick={() => setTaskTab('living')}
                className={`rounded-t px-3 py-1 text-[11px] font-semibold transition ${taskTab === 'living' ? 'bg-fuchsia-500 text-white' : 'bg-white border border-[var(--color-border)] text-[var(--color-text-sub)] hover:bg-gray-50'}`}
              >
                リビング
              </button>
            )}
            {canViewTrello && (
              <button
                onClick={() => setTaskTab('trello')}
                className={`rounded-t px-3 py-1 text-[11px] font-semibold transition ${taskTab === 'trello' ? 'bg-sky-500 text-white' : 'bg-white border border-[var(--color-border)] text-[var(--color-text-sub)] hover:bg-gray-50'}`}
              >
                テックリーダー
              </button>
            )}
            {taskTab === 'living' && canViewNotion && (
              <>
                <button
                  onClick={handleNotionSync}
                  disabled={notionSyncing}
                  className="ml-auto rounded border border-fuchsia-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-fuchsia-600 hover:bg-fuchsia-50 disabled:opacity-50"
                  title="Notion から最新の WBS タスクを取得"
                >
                  {notionSyncing ? '同期中…' : '🔄 Notion 同期'}
                </button>
                {notionSyncMsg && <span className="text-[10px] text-[var(--color-text-sub)]">{notionSyncMsg}</span>}
              </>
            )}
            {taskTab === 'trello' && canViewTrello && (
              <>
                <button
                  onClick={handleTrelloSync}
                  disabled={trelloSyncing}
                  className="ml-auto rounded border border-sky-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-sky-600 hover:bg-sky-50 disabled:opacity-50"
                  title="Trello から最新のカードを取得"
                >
                  {trelloSyncing ? '同期中…' : '🔄 Trello 同期'}
                </button>
                {trelloSyncMsg && <span className="text-[10px] text-[var(--color-text-sub)]">{trelloSyncMsg}</span>}
              </>
            )}
          </div>
          {taskTab === 'living' && canViewNotion ? (
            <div className="mt-1 grid gap-2 md:grid-cols-2">
              {(['西野', '川村'] as const).map((person) => {
                const tasks = notionTasksByAssignee[person] ?? []
                const editable = isAdmin || allowEdit(person)
                const targetAssignee = isAdmin ? undefined : person
                return (
                  <div key={person} className="rounded-lg border border-fuchsia-200 bg-fuchsia-50/30 p-2">
                    <div className="text-xs font-semibold text-[var(--color-text)] mb-1">
                      {person} リビング タスク（{tasks.length}）
                      {!editable && <span className="ml-1 text-[10px] font-normal text-gray-400">閲覧のみ</span>}
                    </div>
                    {tasks.length === 0 ? (
                      <div className="text-[11px] text-[var(--color-text-sub)]">該当なし（Notion 同期 で取得）</div>
                    ) : (
                      <div className="space-y-1">
                        {tasks.map((task) => {
                          const livingReport = workReports.find((r) => r.work_date === date && r.category === 'living')
                          const alreadyInLiving = !!livingReport && (livingReport.content ?? '').includes(task.title)
                          return (
                          <div
                            key={task.id}
                            className="rounded border border-fuchsia-200 bg-white p-1.5 text-[11px]"
                            draggable={editable}
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = 'copy'
                              e.dataTransfer.setData('application/json', JSON.stringify({
                                source: 'notion',
                                title: task.title,
                                hours: Number(notionHoursById[task.id] ?? '1'),
                                assignee: targetAssignee,
                              }))
                            }}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <div className="flex-1 min-w-0">
                                <div className="font-mono text-[9px] text-fuchsia-500">{task.wbs_level}</div>
                                <a
                                  href={`https://www.notion.so/21e123f261d2802b93bae6e0f9406682?v=21e123f261d280b29c52000c51b8b437&p=${task.notion_block_id.replace(/-/g, '')}&pm=s`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block font-semibold truncate text-fuchsia-700 hover:underline"
                                  title={task.title}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {task.title} ↗
                                </a>
                                <div className="text-[10px] text-[var(--color-text-sub)] flex gap-2 flex-wrap">
                                  {task.start_date && <span>{task.start_date}〜{task.end_date ?? ''}</span>}
                                  {task.workload != null && <span>{task.workload}人日</span>}
                                  {task.status && <span className="rounded bg-gray-100 px-1">{task.status}</span>}
                                  {task.progress_rate != null && task.progress_rate > 0 && (
                                    <span>{Math.round(Number(task.progress_rate) * 100)}%</span>
                                  )}
                                </div>
                                {task.note && <div className="text-[10px] text-gray-500 mt-0.5 truncate" title={task.note}>{task.note}</div>}
                                <TaskMemoEditor
                                  value={task.memo}
                                  onSave={(value) => saveNotionMemo(task.id, value)}
                                  editable={editable}
                                />
                              </div>
                              {editable && (
                                <div className="flex shrink-0 items-center gap-1">
                                  {alreadyInLiving && livingReport ? (
                                    <button
                                      onClick={() => startEdit(livingReport)}
                                      className="rounded bg-fuchsia-500 hover:bg-fuchsia-600 px-2 py-0.5 text-[10px] font-semibold text-white"
                                      title="リビング業務報告を編集"
                                    >
                                      編集
                                    </button>
                                  ) : (
                                    <>
                                      <select
                                        value={notionHoursById[task.id] ?? '1'}
                                        onChange={(e) => setNotionHoursById((prev) => ({ ...prev, [task.id]: e.target.value }))}
                                        onClick={(e) => e.stopPropagation()}
                                        className="rounded border border-[var(--color-border)] px-1 py-0.5 text-[10px]"
                                      >
                                        {['0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5', '6', '7', '8'].map((h) => (
                                          <option key={h} value={h}>{h}h</option>
                                        ))}
                                      </select>
                                      <button
                                        onClick={() => addNotionToWorkReport(task, targetAssignee)}
                                        className="rounded bg-emerald-500 hover:bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white"
                                        title="リビング業務報告に追加"
                                      >
                                        勤怠に追加
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : taskTab === 'trello' && canViewTrello ? (
            <div className="mt-1 space-y-2">
              {Object.keys(trelloTasks).length === 0 ? (
                <div className="text-[11px] text-[var(--color-text-sub)]">該当なし（Trello 同期 で取得）</div>
              ) : (
                Object.entries(trelloTasks).map(([listName, tasks]) => {
                  if (tasks.length === 0) return null
                  return (
                    <div key={listName} className="rounded-lg border border-sky-200 bg-sky-50/30 p-2">
                      <div className="text-xs font-semibold text-[var(--color-text)] mb-1">
                        {listName}（{tasks.length}）
                      </div>
                      <div className="space-y-1">
                        {tasks.map((task) => (
                          <div key={task.id} className="rounded border border-sky-200 bg-white p-1.5 text-[11px]">
                            {task.url ? (
                              <a
                                href={task.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block font-semibold truncate text-sky-700 hover:underline"
                                title={task.title}
                              >
                                {task.title} ↗
                              </a>
                            ) : (
                              <div className="font-semibold truncate text-[var(--color-text)]" title={task.title}>{task.title}</div>
                            )}
                            <div className="text-[10px] text-[var(--color-text-sub)] flex gap-2 flex-wrap">
                              {task.assignee_name && <span>{task.assignee_name}</span>}
                              {task.due_date && <span>期限: {task.due_date}</span>}
                              {task.start_date && <span>{task.start_date}〜</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          ) : tasksLoading ? (
            <div className="mt-1 text-xs text-[var(--color-text-sub)]">読み込み中…</div>
          ) : (
            <div className="mt-1 grid gap-2 md:grid-cols-2">
              {(['西野', '川村'] as const).map((person) => {
                const tasks = (tasksByAssignee[person] ?? []).filter((task) => taskStatusFilter.has(task.status_id))
                // 西野 (admin) は全タスクを自分の勤怠に追加可、それ以外は自分のタスクのみ
                const editable = isAdmin || allowEdit(person)
                // 西野が他人のタスクをいじる場合は自分の勤怠に追加（target_assignee=undefined）
                const targetAssignee = isAdmin ? undefined : person
                return (
                  <div key={person} className="rounded-lg border border-[var(--color-border)] p-2">
                    <div className="text-xs font-semibold text-[var(--color-text)] mb-1">
                      {person} タスク（{tasks.length}）
                      {!editable && <span className="ml-1 text-[10px] font-normal text-gray-400">閲覧のみ</span>}
                      {isAdmin && person !== '西野' && <span className="ml-1 text-[10px] font-normal text-fuchsia-500">レビュー → 自分の勤怠へ</span>}
                    </div>
                    {editable && (
                      <div className="mb-1 flex gap-1">
                        <input
                          type="text"
                          value={newTaskInput[person] ?? ''}
                          onChange={(e) => setNewTaskInput((prev) => ({ ...prev, [person]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); addLocalTask(person) }
                          }}
                          placeholder="＋ 新規タスク (この日に追加)"
                          className="flex-1 rounded border border-[var(--color-border)] bg-white px-2 py-1 text-[11px]"
                        />
                        <button
                          onClick={() => addLocalTask(person)}
                          disabled={!(newTaskInput[person] ?? '').trim() || addingTaskFor === person}
                          className="rounded bg-gradient-to-r from-fuchsia-500 to-pink-500 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
                        >
                          {addingTaskFor === person ? '…' : '追加'}
                        </button>
                      </div>
                    )}
                    {tasks.length === 0 ? (
                      <div className="text-[11px] text-[var(--color-text-sub)]">該当なし</div>
                    ) : (
                      <div className="space-y-1">
                        {tasks.map((task) => {
                          const badge = STATUS_BADGE[task.status_id]
                          const wingsReport = workReports.find((r) => r.work_date === date && (r.category ?? 'wings') === 'wings')
                          const alreadyInWings = !!wingsReport && parseSapEntries(wingsReport.content ?? '').some((entry) => entry.key === task.issue_key)
                          return (
                            <TaskCard
                              key={task.id}
                              task={task}
                              badge={badge}
                              assignee={person}
                              editable={editable}
                              onAddToWorkReport={(issueKey, hours) => addTaskToWorkReport(issueKey, hours, targetAssignee)}
                              onEditWings={() => wingsReport && startEdit(wingsReport)}
                              alreadyInWings={alreadyInWings}
                              onMemoChanged={(taskId, memo) => {
                                setTasksByAssignee((prev) => {
                                  const next = { ...prev }
                                  for (const k of Object.keys(next)) {
                                    next[k] = next[k].map((t) => t.id === taskId ? { ...t, memo } : t)
                                  }
                                  return next
                                })
                                setAllTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, memo } : t))
                              }}
                              onOpenDetail={(t) => setDetailTask(t)}
                              refreshTick={commentRefreshTick}
                            />
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
    </Modal>
  )
}
