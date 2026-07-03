import { useEffect, useRef, useState } from 'react'

// タスクカードの「📝 メモ」エディタ。タマ(Backlog)/リビング(Notion) 両方で使う共通パーツ。
// 折りたたみ + 入力デバウンス自動保存 + 保存ステータス表示を内包する。
// 保存先(API)は onSave で差し替える（タマ: /backlog/tasks/:id, リビング: /notion_tasks/:id）。
type Props = {
  value: string | null | undefined
  onSave: (value: string) => Promise<void>
  editable?: boolean
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function TaskMemoEditor({ value, onSave, editable = true }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string>(value ?? '')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setDraft(value ?? '') }, [value])

  const scheduleSave = (next: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setSaveState('saving')
      try {
        await onSave(next)
        setSaveState('saved')
        setTimeout(() => setSaveState((prev) => (prev === 'saved' ? 'idle' : prev)), 1200)
      } catch {
        setSaveState('error')
      }
    }, 400)
  }

  const preview = draft.trim().length > 0
    ? `${draft.replace(/\s+/g, ' ').slice(0, 30)}${draft.length > 30 ? '…' : ''}`
    : '（未入力）'

  return (
    <div className="mt-1 rounded bg-amber-50 border border-amber-200 text-[10px] text-[var(--color-text)]">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v) }}
        className="w-full flex items-center justify-between px-2 py-1 hover:bg-amber-100"
      >
        <span className="font-semibold text-amber-700">📝 メモ {open ? '▲' : '▼'}</span>
        {!open && (
          <span className="ml-2 truncate text-[var(--color-text-sub)] flex-1 text-left">{preview}</span>
        )}
        {saveState !== 'idle' && (
          <span className={`ml-1 text-[9px] font-semibold ${
            saveState === 'saving' ? 'text-gray-500' :
            saveState === 'saved' ? 'text-emerald-600' :
            'text-red-500'
          }`}>
            {saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '✓保存' : '失敗'}
          </span>
        )}
      </button>
      {open && (
        <div className="px-2 pb-1.5">
          {editable ? (
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                scheduleSave(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = e.target.scrollHeight + 'px'
              }}
              ref={(el) => {
                if (el) {
                  el.style.height = 'auto'
                  el.style.height = el.scrollHeight + 'px'
                }
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              placeholder="メモを入力…"
              rows={1}
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              className="w-full resize-none overflow-hidden min-h-[24px] rounded border border-amber-200 bg-white px-2 py-1 text-[11px] text-[var(--color-text)] placeholder-gray-400 outline-none focus:border-amber-400"
            />
          ) : (
            <div className="whitespace-pre-wrap break-words">{draft || '（未入力）'}</div>
          )}
        </div>
      )}
    </div>
  )
}
