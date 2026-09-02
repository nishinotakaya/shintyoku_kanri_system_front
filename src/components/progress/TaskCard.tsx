import { memo, useEffect, useRef, useState } from 'react'
import { Draggable } from '@hello-pangea/dnd'
import AutoGrowTextarea from '../AutoGrowTextarea'
import { COLUMNS, PROGRESS_OPTIONS } from './board'
import type { BLTask } from './board'

// 入力が止まってから保存するまでの待ち時間。打鍵ごとに投げると通信が詰まる。
const SAVE_DELAY_MS = 500

export type TaskCardHandlers = {
  onTaskMoved: (taskId: number, newStatusId: number) => void
  onMemoChanged: (taskId: number, memo: string) => void
  onProgressChanged: (taskId: number, progress: number) => void
  // 日付と備考は別々に送る。1リクエストにまとめると、片方の保存が
  // もう片方の古い値を巻き添えで書き戻してしまう。
  onDeployChanged: (taskId: number, patch: { deploy_date?: string; deploy_note?: string }) => void
  onDelete?: (taskId: number) => void
  onSummaryChanged?: (taskId: number, summary: string) => void
  onUrlChanged?: (taskId: number, url: string) => void
  onAssigneeChanged?: (taskId: number, name: string) => void
  onFlagChanged?: (taskId: number, patch: { did_previous?: boolean; do_today?: boolean }) => void
  // リビング(Notion)タスクの LINE 報告選択。ハンドラが渡っているときだけチェックボックスを出す
  onLineSelectChanged?: (taskId: number, selected: boolean) => void
  lineSelectedIds?: Set<number>
}

type TaskCardProps = TaskCardHandlers & {
  task: BLTask
  index: number
  layout: 'board' | 'row'
  assigneeOptions: string[]
}

const stopPropagation = (e: { stopPropagation: () => void }) => e.stopPropagation()

// javascript: など危険なスキームをリンクにしない。URL は手入力や外部サービス取込で入ってくる。
const isSafeLink = (url: string) => /^https?:\/\//i.test(url.trim())

// 入力中の値をカード内に持つ。保存が届いてサーバ値と一致したら下書きを畳み、
// 以後は同期・取込でサーバ側が変わったときにそちらへ追随できるようにする。
function useDraft(serverValue: string) {
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => {
    if (draft !== null && draft === serverValue) setDraft(null)
  }, [draft, serverValue])
  return [draft ?? serverValue, setDraft] as const
}

// 期限までの残り日数から警告表示を決める。
const dueState = (dueDate: string | null) => {
  if (!dueDate) return { daysLeft: null, overdue: false, urgent: false }
  const daysLeft = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86400000)
  return { daysLeft, overdue: daysLeft < 0, urgent: daysLeft >= 0 && daysLeft <= 3 }
}

const elapsedDaysBadge = (createdOn: string | null) => {
  if (!createdOn) return null
  const days = Math.floor((Date.now() - new Date(createdOn).getTime()) / 86400000)
  const tone = days > 30 ? 'bg-red-100 text-red-600' : days > 14 ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-600'
  return <span className={`rounded px-1.5 py-0.5 font-semibold ${tone}`}>{days}日経過</span>
}

const shortTitle = (task: BLTask) => {
  const title = task.summary || task.issue_key
  return title.length > 20 ? `${title.slice(0, 20)}...` : title
}

// カンバンの 1 タスク。入力中の値をこのカードの中だけで持つので、
// 打鍵しても他のカードやボード全体は再描画されない(以前は全カードが再描画され入力が詰まっていた)。
function TaskCard({
  task,
  index,
  layout,
  assigneeOptions,
  onTaskMoved,
  onMemoChanged,
  onProgressChanged,
  onDeployChanged,
  onDelete,
  onSummaryChanged,
  onUrlChanged,
  onAssigneeChanged,
  onFlagChanged,
  onLineSelectChanged,
  lineSelectedIds,
}: TaskCardProps) {
  const [summaryText, setSummaryDraft] = useDraft(task.summary)
  const [urlText, setUrlDraft] = useDraft(task.url ?? '')
  const [memoText, setMemoDraft] = useDraft(task.memo ?? '')
  const [deployDate, setDeployDateDraft] = useDraft(task.deploy_date ?? '')
  const [deployNote, setDeployNoteDraft] = useDraft(task.deploy_note ?? '')

  // 項目ごとに 1 本ずつ保存待ちを持つ。カードを跨がないので他タスクの入力と干渉しない。
  const pendingSaves = useRef<Record<string, { timer: ReturnType<typeof setTimeout>; save: () => void }>>({})
  const saveAfterTypingStops = (field: string, save: () => void) => {
    const pending = pendingSaves.current[field]
    if (pending) clearTimeout(pending.timer)
    pendingSaves.current[field] = {
      timer: setTimeout(() => { delete pendingSaves.current[field]; save() }, SAVE_DELAY_MS),
      save,
    }
  }

  const discardPendingSaves = () => {
    Object.values(pendingSaves.current).forEach(({ timer }) => clearTimeout(timer))
    pendingSaves.current = {}
  }

  // 絞り込みやタブ切替でカードが消えても、入力途中の内容を落とさずに送り切る。
  useEffect(() => () => {
    Object.values(pendingSaves.current).forEach(({ timer, save }) => { clearTimeout(timer); save() })
    pendingSaves.current = {}
  }, [])

  const changeSummary = (value: string) => {
    setSummaryDraft(value)
    saveAfterTypingStops('summary', () => onSummaryChanged?.(task.id, value))
  }
  const changeUrl = (value: string) => {
    setUrlDraft(value)
    saveAfterTypingStops('url', () => onUrlChanged?.(task.id, value))
  }
  const changeMemo = (value: string) => {
    setMemoDraft(value)
    saveAfterTypingStops('memo', () => onMemoChanged(task.id, value))
  }
  const changeDeployDate = (value: string) => {
    setDeployDateDraft(value)
    // 日付ピッカーはキーボード入力の途中で空文字を流すので、確定を待ってから送る。
    saveAfterTypingStops('deploy_date', () => onDeployChanged(task.id, { deploy_date: value }))
  }
  const changeDeployNote = (value: string) => {
    setDeployNoteDraft(value)
    saveAfterTypingStops('deploy_note', () => onDeployChanged(task.id, { deploy_note: value }))
  }

  const { daysLeft, overdue, urgent } = dueState(task.due_date)
  const editable = task.source !== 'backlog' && !!onSummaryChanged
  const deadlineBorder = overdue ? 'border-l-4 border-l-red-500' : urgent ? 'border-l-4 border-l-amber-400' : ''

  const titleLink = task.source !== 'backlog' ? (
    isSafeLink(urlText) ? (
      <a href={urlText} target="_blank" rel="noreferrer"
        className={`text-sm font-semibold text-[var(--color-primary)] hover:underline cursor-pointer ${layout === 'board' ? 'font-mono' : 'flex-shrink-0 truncate max-w-[200px]'}`}
        onClick={stopPropagation} onMouseDown={stopPropagation} onPointerDown={stopPropagation}>
        {shortTitle(task)}
      </a>
    ) : (
      <span className={`text-sm font-semibold text-[var(--color-text-sub)] ${layout === 'row' ? 'flex-shrink-0' : ''}`}>{shortTitle(task)}</span>
    )
  ) : (
    <a href={`https://tamahome.backlog.com/view/${task.issue_key}`} target="_blank" rel="noreferrer"
      className={`text-sm font-mono font-semibold text-[var(--color-primary)] hover:underline cursor-pointer ${layout === 'row' ? 'flex-shrink-0' : ''}`}
      onClick={stopPropagation} onMouseDown={stopPropagation} onPointerDown={stopPropagation}>
      {task.issue_key}
    </a>
  )

  const flagCheckboxes = (
    <div className="mt-1.5 inline-flex items-center gap-3 text-[11px]"
      onMouseDown={stopPropagation} onPointerDown={stopPropagation}>
      <label className="flex items-center gap-1 cursor-pointer select-none" onClick={stopPropagation}>
        <input type="checkbox" checked={!!task.do_today} className="accent-amber-500"
          onChange={(e) => onFlagChanged?.(task.id, { do_today: e.target.checked })} onClick={stopPropagation} />
        <span className={`font-semibold ${task.do_today ? 'text-amber-600' : 'text-[var(--color-text-sub)]'}`}>本日行う</span>
      </label>
      <label className="flex items-center gap-1 cursor-pointer select-none" onClick={stopPropagation}>
        <input type="checkbox" checked={!!task.did_previous} className="accent-sky-500"
          onChange={(e) => onFlagChanged?.(task.id, { did_previous: e.target.checked })} onClick={stopPropagation} />
        <span className={`font-semibold ${task.did_previous ? 'text-sky-600' : 'text-[var(--color-text-sub)]'}`}>前回行った</span>
      </label>
      {onLineSelectChanged && (
        <label className="flex items-center gap-1 cursor-pointer select-none" onClick={stopPropagation}>
          <input type="checkbox" checked={!!lineSelectedIds?.has(task.id)} className="accent-emerald-500"
            onChange={(e) => onLineSelectChanged(task.id, e.target.checked)} onClick={stopPropagation} />
          <span className={`font-semibold ${lineSelectedIds?.has(task.id) ? 'text-emerald-600' : 'text-[var(--color-text-sub)]'}`}>LINE報告</span>
        </label>
      )}
    </div>
  )

  const progressBar = (barHeight: string, selectSize: string) => (
    <div className="flex items-center gap-2">
      <div className={`flex-1 ${barHeight} rounded-full bg-gray-100 overflow-hidden`}>
        <div className="h-full rounded-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-primary-light)] transition-all"
          style={{ width: `${(task.progress ?? 0) * 100}%` }} />
      </div>
      <select
        value={Math.round((task.progress ?? 0) * 100)}
        onChange={(e) => onProgressChanged(task.id, Number(e.target.value) / 100)}
        onClick={stopPropagation}
        className={`rounded border border-[var(--color-border)] bg-white text-[var(--color-text)] ${selectSize}`}
      >
        {PROGRESS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  )

  const deployFields = (labelClass: string, fieldClass: string) => (
    <div className="mt-2 flex items-center gap-2">
      <span className={`${labelClass} text-[var(--color-text-sub)] whitespace-nowrap`}>適用予定:</span>
      <input type="date" value={deployDate}
        onChange={(e) => changeDeployDate(e.target.value)}
        onClick={stopPropagation}
        className={`rounded border border-[var(--color-border)] bg-white text-[var(--color-text)] ${fieldClass}`} />
      <input value={deployNote}
        onChange={(e) => changeDeployNote(e.target.value)}
        onClick={stopPropagation}
        placeholder="例: 4/14夜適用"
        className={`flex-1 rounded border border-[var(--color-border)] bg-white text-[var(--color-text)] placeholder-gray-400 ${fieldClass}`} />
    </div>
  )

  const memoField = (className: string) => (
    <AutoGrowTextarea
      value={memoText}
      onChange={(e) => changeMemo(e.target.value)}
      onClick={stopPropagation}
      placeholder="備考…"
      className={className}
    />
  )

  return (
    <Draggable draggableId={String(task.id)} index={index}>
      {(provided, snapshot) => layout === 'board' ? (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`rounded-xl bg-white p-4 shadow-sm border border-[var(--color-border)] cursor-grab active:cursor-grabbing transition ${
            snapshot.isDragging ? 'shadow-xl ring-2 ring-[var(--color-primary)]/30 rotate-1 scale-105' : 'hover:shadow-md'
          } ${deadlineBorder}`}
        >
          <div className="flex items-start justify-between gap-2">
            {titleLink}
            {overdue && <span className="whitespace-nowrap rounded-lg bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white animate-pulse">⚠{Math.abs(daysLeft!)}日超過</span>}
            {urgent && !overdue && <span className="whitespace-nowrap rounded-lg bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-white">🔥あと{daysLeft}日</span>}
          </div>

          {task.source === 'trello' && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">📋 Trello</span>
              {task.trello_list_name && (
                <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">{task.trello_list_name}</span>
              )}
            </div>
          )}

          {editable ? (
            <input
              value={summaryText}
              onChange={(e) => changeSummary(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              onClick={stopPropagation}
              className="mt-2 w-full rounded-lg bg-transparent px-1 py-0.5 text-sm font-medium text-[var(--color-text)] outline-none focus:bg-[var(--color-bg)]"
            />
          ) : (
            <div className="mt-2 text-sm font-medium text-[var(--color-text)] leading-snug break-words">{task.summary}</div>
          )}

          {task.source !== 'backlog' && (
            <input
              value={urlText}
              onChange={(e) => changeUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              onClick={stopPropagation}
              placeholder="URL を入力..."
              className="mt-1 w-full rounded-lg bg-transparent px-1 py-0.5 text-xs text-[var(--color-primary)] outline-none focus:bg-[var(--color-bg)] placeholder-gray-400"
            />
          )}

          {task.due_date && !overdue && !urgent && (
            <div className="mt-2 text-xs text-[var(--color-text-sub)]">期限: {task.due_date}</div>
          )}

          {flagCheckboxes}

          <div className="mt-3">{progressBar('h-2', 'px-1 py-0.5 text-[11px]')}</div>

          {memoField('mt-2 w-full min-h-[40px] rounded-lg bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] placeholder-gray-400 outline-none focus:ring-1 focus:ring-[var(--color-primary)]/30')}

          {deployFields('text-[10px]', 'px-1.5 py-0.5 text-[11px]')}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-sub)]">
            {task.source === 'trello' ? (
              <span className="font-semibold">👤 {task.assignee_name ?? '担当なし'}</span>
            ) : (
              <select value={task.assignee_name ?? ''}
                onChange={(e) => onAssigneeChanged?.(task.id, e.target.value)}
                onClick={stopPropagation}
                className="rounded bg-[var(--color-bg)] px-1 py-0.5 text-[11px] font-semibold text-[var(--color-text-sub)] border-none outline-none">
                <option value="">担当</option>
                {assigneeOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            )}
            {task.due_date && <span>完了予定: {task.due_date.slice(5)}</span>}
            <span>作成: {task.created_on?.slice(5) ?? '—'}</span>
            {task.completed_on && <span className="text-emerald-600 font-semibold">完了: {task.completed_on.slice(5)}</span>}
            {elapsedDaysBadge(task.created_on)}
          </div>

          {onDelete && task.source !== 'backlog' && (
            <button onClick={(e) => { e.stopPropagation(); discardPendingSaves(); onDelete(task.id) }}
              className="mt-1 text-[10px] text-gray-400 hover:text-red-500">🗑 削除</button>
          )}
        </div>
      ) : (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`rounded-xl bg-white px-5 py-4 shadow-sm border border-[var(--color-border)] cursor-grab active:cursor-grabbing transition ${
            snapshot.isDragging ? 'shadow-xl ring-2 ring-[var(--color-primary)]/30' : 'hover:shadow-md'
          } ${deadlineBorder}`}
        >
          {/* 上段: チケット + タイトル + 期限 + ステータス + 削除 */}
          <div className="flex items-start gap-4">
            {titleLink}
            <div className="flex-1 min-w-0">
              {editable ? (
                <>
                  <input
                    value={summaryText}
                    onChange={(e) => changeSummary(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                    onClick={stopPropagation}
                    placeholder="タイトル"
                    className="w-full rounded-lg bg-transparent px-1 py-0.5 text-sm font-medium text-[var(--color-text)] outline-none focus:bg-[var(--color-bg)]"
                  />
                  <input
                    value={urlText}
                    onChange={(e) => changeUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                    onClick={stopPropagation}
                    placeholder="URL を入力..."
                    className="mt-1 w-full rounded-lg bg-transparent px-1 py-0.5 text-xs text-[var(--color-primary)] outline-none focus:bg-[var(--color-bg)] placeholder-gray-400"
                  />
                </>
              ) : (
                <div className="text-sm font-medium text-[var(--color-text)] leading-snug break-words">{task.summary}</div>
              )}
            </div>
            <div className="flex-shrink-0 flex items-center gap-2">
              {overdue && <span className="whitespace-nowrap rounded-lg bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white animate-pulse">⚠{task.due_date}({Math.abs(daysLeft!)}日超過)</span>}
              {urgent && !overdue && <span className="whitespace-nowrap rounded-lg bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-white">🔥{task.due_date}(あと{daysLeft}日)</span>}
              {task.due_date && !overdue && !urgent && <span className="text-xs text-[var(--color-text-sub)] whitespace-nowrap">期限: {task.due_date}</span>}
              <select value={task.status_id}
                onChange={(e) => onTaskMoved(task.id, Number(e.target.value))}
                className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1 text-xs text-[var(--color-text)]">
                {COLUMNS.map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}
              </select>
              {onDelete && task.source !== 'backlog' && (
                <button onClick={(e) => { e.stopPropagation(); discardPendingSaves(); onDelete(task.id) }}
                  className="text-xs text-gray-400 hover:text-red-500">🗑</button>
              )}
            </div>
          </div>

          {/* 情報行 + 経過日数 */}
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-text-sub)]">
            <span>作成: {task.created_on ?? '—'}</span>
            {task.completed_on && <span className="text-emerald-600 font-semibold">完了: {task.completed_on}</span>}
            {elapsedDaysBadge(task.created_on)}
            {flagCheckboxes}
          </div>

          <div className="mt-2">{progressBar('h-2.5', 'px-2 py-1 text-xs')}</div>

          {deployFields('text-xs', 'px-2 py-1 text-xs')}

          {memoField('mt-3 w-full min-h-[60px] rounded-lg bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] placeholder-gray-400 outline-none focus:ring-1 focus:ring-[var(--color-primary)]/30')}
        </div>
      )}
    </Draggable>
  )
}

// 他のカードの入力やボードの再描画で巻き添えにならないようにする。
export default memo(TaskCard)
