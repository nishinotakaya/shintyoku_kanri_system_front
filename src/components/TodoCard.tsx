import { useEffect, useState } from 'react'
import { api } from '../lib/api'

type Todo = {
  id: number
  title: string
  description: string | null
  due_date: string | null
  completed: boolean
  priority: number
  category: string | null
}

const PRIORITY = ['通常', '高', '緊急'] as const
const P_COLORS = ['', 'text-amber-600', 'text-red-500']

export default function TodoCard() {
  const [todos, setTodos] = useState<{ active: Todo[]; completed: Todo[] }>({ active: [], completed: [] })
  const [draft, setDraft] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)

  const fetch = () => api.get('/todos').then((r) => setTodos(r.data))
  useEffect(() => { fetch() }, [])

  const add = async () => {
    if (!draft.trim()) return
    await api.post('/todos', { title: draft.trim() })
    setDraft('')
    fetch()
  }

  const toggle = async (t: Todo) => {
    await api.patch(`/todos/${t.id}`, { completed: !t.completed })
    fetch()
  }

  const remove = async (id: number) => {
    await api.delete(`/todos/${id}`)
    fetch()
  }

  const cyclePriority = async (t: Todo) => {
    const next = ((t.priority || 0) + 1) % 3
    await api.patch(`/todos/${t.id}`, { priority: next })
    fetch()
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="glass rounded-3xl p-6 shadow-md">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-widest text-[var(--color-text-sub)]">Todo</div>
        <span className="text-xs text-[var(--color-text-sub)]">{todos.active.length} 件</span>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="新しいタスクを追加…"
          className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 text-sm text-[var(--color-text)] placeholder-gray-400 outline-none focus:border-[var(--color-primary)]/60"
        />
        <button
          onClick={add}
          disabled={!draft.trim()}
          className="rounded-xl bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          追加
        </button>
      </div>

      <div className="mt-4 space-y-1">
        {todos.active.map((t) => {
          const overdue = t.due_date && t.due_date < today
          return (
            <div key={t.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--color-bg)] group">
              <button onClick={() => toggle(t)} className="h-5 w-5 flex-shrink-0 rounded border-2 border-[var(--color-border)] hover:border-[var(--color-primary)]" />
              <div className="flex-1 min-w-0">
                <div className={`text-sm truncate ${P_COLORS[t.priority || 0]} ${overdue ? 'text-red-500' : 'text-[var(--color-text)]'}`}>
                  {t.title}
                </div>
                {t.due_date && (
                  <div className={`text-[10px] ${overdue ? 'text-red-400' : 'text-[var(--color-text-sub)]'}`}>
                    期限: {t.due_date}
                  </div>
                )}
              </div>
              <button onClick={() => cyclePriority(t)} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg)] text-[var(--color-text-sub)] opacity-0 group-hover:opacity-100">
                {PRIORITY[t.priority || 0]}
              </button>
              <button onClick={() => remove(t.id)} className="text-xs text-[var(--color-text-sub)] opacity-0 group-hover:opacity-100 hover:text-red-500">×</button>
            </div>
          )
        })}
        {todos.active.length === 0 && <div className="py-4 text-center text-xs text-[var(--color-text-sub)]">タスクなし</div>}
      </div>

      {todos.completed.length > 0 && (
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <button onClick={() => setShowCompleted(!showCompleted)} className="text-xs text-[var(--color-text-sub)] hover:text-[var(--color-text)]">
            {showCompleted ? '▼' : '▶'} 完了済み ({todos.completed.length})
          </button>
          {showCompleted && (
            <div className="mt-2 space-y-1">
              {todos.completed.map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-lg px-2 py-1 group">
                  <button onClick={() => toggle(t)} className="h-5 w-5 flex-shrink-0 rounded border-2 border-[var(--color-primary)] bg-[var(--color-primary)] text-white text-xs">✓</button>
                  <span className="flex-1 text-sm text-[var(--color-text-sub)] line-through truncate">{t.title}</span>
                  <button onClick={() => remove(t.id)} className="text-xs text-[var(--color-text-sub)] opacity-0 group-hover:opacity-100 hover:text-red-500">×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
