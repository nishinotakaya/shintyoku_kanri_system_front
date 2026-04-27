import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { WorkReport, Expense } from '../lib/api'
import SapLink from './SapLink'

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

type SapEntry = { key: string; hours: string }

const HOURS_OPTIONS = ['', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10']
const REPORT_HOURS_OPTIONS = ['', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12']

const STATUS_BADGE: Record<number, { label: string; class: string }> = {
  1: { label: '未対応', class: 'bg-amber-100 text-amber-700' },
  2: { label: '処理中', class: 'bg-sky-100 text-sky-700' },
  3: { label: '処理済', class: 'bg-emerald-100 text-emerald-700' },
}

type TaskComment = { id: number; content: string; created_user_name?: string | null; created?: string | null }

function TaskCard({ task, badge, onAddToWorkReport, onEditWings, alreadyInWings, editable = true, assignee }: {
  task: BacklogTask
  badge?: { label: string; class: string }
  assignee?: string
  editable?: boolean
  onAddToWorkReport: (issueKey: string, hours: string) => Promise<void> | void
  onEditWings: () => void
  alreadyInWings: boolean
}) {
  const [hours, setHours] = useState('1')
  const [adding, setAdding] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comments, setComments] = useState<TaskComment[] | null>(null)
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsError, setCommentsError] = useState<string | null>(null)
  const [latestComment, setLatestComment] = useState<TaskComment | null>(null)
  const [memoOpen, setMemoOpen] = useState(false)
  const [latestOpen, setLatestOpen] = useState(false)

  // 最新1件は自動で取得（メモ代わりに常時表示）
  useEffect(() => {
    let cancelled = false
    api.get<TaskComment[]>(`/backlog/tasks/${encodeURIComponent(task.issue_key)}/comments`)
      .then((r) => {
        if (cancelled) return
        const filtered = r.data.filter((c) => (c.content ?? '').trim().length > 0)
        setLatestComment(filtered.length > 0 ? filtered[filtered.length - 1] : null)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [task.issue_key])
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
        <a href={task.url ?? undefined} target="_blank" rel="noopener noreferrer" className="flex items-baseline gap-1 min-w-0 flex-1">
          <span className="font-mono text-fuchsia-600">{task.issue_key}</span>
          {badge && <span className={`rounded px-1 text-[9px] ${badge.class}`}>{badge.label}</span>}
        </a>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={toggleComments}
            className="rounded bg-white border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-sub)] hover:bg-gray-50"
            title="コメントを見る"
          >
            💬
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
      <a href={task.url ?? undefined} target="_blank" rel="noopener noreferrer" className="block text-[var(--color-text)] truncate">{task.summary}</a>
      {(task.memo ?? '').trim().length > 0 && (
        <div className="mt-1 rounded bg-amber-50 border border-amber-200 text-[10px] text-[var(--color-text)]">
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMemoOpen((v) => !v) }}
            className="w-full flex items-center justify-between px-2 py-1 hover:bg-amber-100"
          >
            <span className="font-semibold text-amber-700">📝 メモ {memoOpen ? '▲' : '▼'}</span>
            {!memoOpen && (
              <span className="ml-2 truncate text-[var(--color-text-sub)] flex-1 text-left">
                {task.memo!.replace(/\s+/g, ' ').slice(0, 30)}{task.memo!.length > 30 && '…'}
              </span>
            )}
          </button>
          {memoOpen && (
            <div className="px-2 pb-1 whitespace-pre-wrap break-words">{task.memo}</div>
          )}
        </div>
      )}
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
              <div className="whitespace-pre-wrap break-words">{latestComment.content}</div>
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
              <div className="whitespace-pre-wrap break-words">{c.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function parseSapEntries(content: string): SapEntry[] {
  return (content || '').split('/').map((part) => {
    const matched = part.trim().match(/^([A-Z]+-\d+)(?:\(([\d.]+)\))?$/)
    if (matched) return { key: matched[1], hours: matched[2] ?? '' }
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
  const [tasksByAssignee, setTasksByAssignee] = useState<Record<string, BacklogTask[]>>({})
  const [allTasks, setAllTasks] = useState<BacklogTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [editing, setEditing] = useState<Record<number, { hours: string; content: string; sapEntries: SapEntry[] }>>({})
  const [saving, setSaving] = useState<number | null>(null)
  const [creatingCategory, setCreatingCategory] = useState<'living' | 'wings' | null>(null)
  const [draftNew, setDraftNew] = useState<{ hours: string; content: string; sapEntries: SapEntry[] }>({ hours: '', content: '', sapEntries: [] })

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

  const updateNewSapRow = (index: number, patch: Partial<SapEntry>) => {
    setDraftNew((prev) => {
      const next = [...prev.sapEntries]
      next[index] = { ...next[index], ...patch }
      return { ...prev, sapEntries: next }
    })
  }
  const addNewSapRow = () => setDraftNew((prev) => ({ ...prev, sapEntries: [...prev.sapEntries, { key: '', hours: '' }] }))
  const removeNewSapRow = (index: number) => setDraftNew((prev) => ({ ...prev, sapEntries: prev.sapEntries.filter((_, i) => i !== index) }))

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
    const totalSapHours = draft.sapEntries.reduce((s, e) => s + (Number(e.hours) || 0), 0)
    return (
      <div className="mt-2 space-y-2 rounded-md bg-gray-50 p-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--color-text-sub)]">合計時間</span>
          <select
            value={draft.hours}
            onChange={(e) => setEditing((prev) => ({ ...prev, [report.id]: { ...prev[report.id], hours: e.target.value } }))}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-xs"
          >
            {REPORT_HOURS_OPTIONS.map((option) => (
              <option key={option} value={option}>{option || '—'}{option ? 'h' : ''}</option>
            ))}
          </select>
          {isWings && totalSapHours > 0 && (
            <span className="text-[10px] text-[var(--color-text-sub)]">明細合計: {totalSapHours}h</span>
          )}
        </div>

        {isWings ? (
          <div className="space-y-1">
            <div className="text-[10px] text-[var(--color-text-sub)]">タマ（SAP 明細）</div>
            {draft.sapEntries.map((entry, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <select
                  value={entry.key}
                  onChange={(e) => updateSapRow(report.id, idx, { key: e.target.value })}
                  className="flex-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs"
                >
                  <option value="">— 選択 —</option>
                  {eligibleTasks.map((task) => (
                    <option key={task.id} value={task.issue_key}>
                      [{task.status_name}] {task.issue_key} {task.summary?.slice(0, 30)}
                    </option>
                  ))}
                  {entry.key && !eligibleTasks.find((task) => task.issue_key === entry.key) && (
                    <option value={entry.key}>{entry.key}（候補外）</option>
                  )}
                </select>
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 gap-2">
          <div className="text-base font-semibold text-[var(--color-text)]">{date} の詳細</div>
          <div className="flex items-center gap-2">
            {canExport && onExportSchedule && (
              <button
                onClick={handleExport}
                disabled={exporting}
                className="rounded-md bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-1 text-xs font-semibold text-white shadow disabled:opacity-50"
                title="今月分のチーム予定をスプレッドシートに書き戻し"
              >
                {exporting ? '書き戻し中…' : '📤 シートに書き戻し'}
              </button>
            )}
            {exportMsg && <span className="text-[10px] text-emerald-600">{exportMsg}</span>}
            <button onClick={onClose} className="text-[var(--color-text-sub)] hover:text-[var(--color-text)]">×</button>
          </div>
        </div>

        {/* チーム予定 */}
        {dayTeam.length > 0 && (
          <section className="mt-3">
            <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-sub)]">チーム予定</div>
            <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
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
                onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' },
                onDrop: async (e: React.DragEvent) => {
                  e.preventDefault()
                  try {
                    const data = JSON.parse(e.dataTransfer.getData('application/json'))
                    if (data?.issueKey) await addTaskToWorkReport(data.issueKey, String(data.hours ?? '1'), data.assignee)
                  } catch {}
                },
              } : {}
              return (
                <div key={report.id} {...dropHandlers} className={`rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs ${isWings ? 'hover:border-emerald-400' : ''}`}>
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
                    <select
                      value={draftNew.hours}
                      onChange={(e) => setDraftNew((prev) => ({ ...prev, hours: e.target.value }))}
                      className="rounded border border-[var(--color-border)] px-2 py-1 text-xs"
                    >
                      {REPORT_HOURS_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option || '—'}{option ? 'h' : ''}</option>
                      ))}
                    </select>
                  </div>
                  {creatingCategory === 'wings' ? (
                    <div className="space-y-1">
                      <div className="text-[10px] text-[var(--color-text-sub)]">タマ（SAP 明細）</div>
                      {draftNew.sapEntries.map((entry, idx) => (
                        <div key={idx} className="flex items-center gap-1">
                          <select
                            value={entry.key}
                            onChange={(e) => updateNewSapRow(idx, { key: e.target.value })}
                            className="flex-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs"
                          >
                            <option value="">— 選択 —</option>
                            {eligibleTasks.map((task) => (
                              <option key={task.id} value={task.issue_key}>[{task.status_name}] {task.issue_key} {task.summary?.slice(0, 30)}</option>
                            ))}
                          </select>
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
                    className="flex-1 rounded-lg border-2 border-dashed border-fuchsia-300 px-3 py-1.5 text-xs text-fuchsia-600 hover:bg-fuchsia-50"
                  >
                    ＋ リビング を追加
                  </button>
                )}
                {!existingCategories.has('wings') && (
                  <button
                    onClick={() => startCreate('wings')}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
                    onDrop={async (e) => {
                      e.preventDefault()
                      try {
                        const data = JSON.parse(e.dataTransfer.getData('application/json'))
                        if (data?.issueKey) await addTaskToWorkReport(data.issueKey, String(data.hours ?? '1'), data.assignee)
                      } catch {}
                    }}
                    className="flex-1 rounded-lg border-2 border-dashed border-fuchsia-300 px-3 py-1.5 text-xs text-fuchsia-600 hover:bg-fuchsia-50 hover:border-emerald-400"
                  >
                    ＋ タマ を追加（タスクをドロップで追加）
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 立替金 */}
        {dayExpenses.length > 0 && (
          <section className="mt-4">
            <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-sub)]">立替金</div>
            <div className="mt-1 space-y-1">
              {dayExpenses.map((e) => (
                <div key={e.id} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs flex items-baseline justify-between">
                  <span>{e.purpose}</span>
                  <span className="font-mono tabular-nums">¥{e.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 当日のタスク */}
        <section className="mt-4">
          <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-sub)]">当日のタスク</div>
          {tasksLoading ? (
            <div className="mt-1 text-xs text-[var(--color-text-sub)]">読み込み中…</div>
          ) : (
            <div className="mt-1 grid gap-2 md:grid-cols-2">
              {(['西野', '川村'] as const).map((person) => {
                const tasks = tasksByAssignee[person] ?? []
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
      </div>
    </div>
  )
}
