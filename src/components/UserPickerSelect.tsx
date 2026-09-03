import { useEffect, useMemo, useRef, useState } from 'react'

export type PickableUser = { id: number; display_name: string; email: string; admin: boolean }

// 「他ユーザーとして閲覧」の切替UI。人数が少ないうちは普通のセレクト、
// 多くなったら(9人以上) 検索ボックス付きのドロップダウンに切り替わる。
// admin / サブ管理者(テナント代表)のカレンダー・勤怠・請求書画面で共通に使う。
const SEARCHABLE_THRESHOLD = 9

export default function UserPickerSelect({ users, value, meId, onChange, className }: {
  users: PickableUser[]
  value: number
  meId: number | undefined
  onChange: (userId: number) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = users.find((u) => u.id === value)
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return users
    return users.filter((u) => u.display_name.toLowerCase().includes(keyword) || u.email.toLowerCase().includes(keyword))
  }, [users, query])

  // ドロップダウンの外をタップしたら閉じる
  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  if (users.length < SEARCHABLE_THRESHOLD) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={className ?? 'rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-xs text-[var(--color-text)]'}
        title="閲覧対象ユーザー"
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            👤 {u.display_name}{u.id === meId ? '（自分）' : ''}
          </option>
        ))}
      </select>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((prev) => !prev); setQuery('') }}
        className={className ?? 'rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-xs text-[var(--color-text)]'}
        title="閲覧対象ユーザー"
      >
        👤 {selected ? `${selected.display_name}${selected.id === meId ? '（自分）' : ''}` : '閲覧対象を選ぶ'} ▾
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-lg border border-gray-300 bg-white shadow-lg">
          <div className="border-b border-gray-200 p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="名前・メールで検索"
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-base"
            />
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => { onChange(u.id); setOpen(false) }}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-fuchsia-50 ${u.id === value ? 'bg-fuchsia-50/60 font-semibold' : ''}`}
              >
                👤 {u.display_name}{u.id === meId ? '（自分）' : ''}
                <span className="block text-[11px] text-[var(--color-text-sub)]">{u.email}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-[var(--color-text-sub)]">該当なし</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
