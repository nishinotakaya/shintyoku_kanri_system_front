import { useEffect, useMemo, useRef, useState } from 'react'
import type { PickableUser } from './UserPickerSelect'
import { SELF_COLOR, colorForUser } from '../lib/userColors'

// Google カレンダーと同じ考え方でメンバーの表示を切り替えるパネル。
//   チェック = そのメンバーの稼働をカレンダーに重ねて表示するかどうか
//   [開く]   = そのメンバーのカレンダーを主体にする（勤怠を代理入力するとき）
// 1行に2つの意味を持たせない。主体は常に先頭の「マイカレンダー」枠に出す。
const SEARCHABLE_THRESHOLD = 9

function surnameOf(displayName: string | undefined) {
  return (displayName ?? '').split(/[\s　]/)[0] ?? ''
}

export default function CalendarUserFilter({
  users, meId, primaryUserId, visibleUserIds, onToggleVisible, onOpenUser,
}: {
  users: PickableUser[]
  meId: number | undefined
  /** いま主体になっているユーザー。通常は自分、[開く] で他メンバーに切り替わる */
  primaryUserId: number
  /** 主体に重ねて表示するメンバー */
  visibleUserIds: number[]
  onToggleVisible: (userId: number) => void
  onOpenUser: (userId: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const primaryUser = users.find((u) => u.id === primaryUserId)
  const isSelfPrimary = meId != null && primaryUserId === meId
  const searchable = users.length >= SEARCHABLE_THRESHOLD

  // 自分は常に緑、ほかのメンバーはIDで決まる色。主体になっても日セルのチップと同じ色で出す
  const colorOf = (userId: number) => (meId != null && userId === meId ? SELF_COLOR : colorForUser(userId))

  const others = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return users
      .filter((u) => u.id !== primaryUserId)
      .filter((u) => !keyword
        || u.display_name.toLowerCase().includes(keyword)
        || u.email.toLowerCase().includes(keyword))
  }, [users, primaryUserId, query])

  // パネルの外をタップしたら閉じる
  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((prev) => !prev); setQuery('') }}
        className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-xs text-[var(--color-text)]"
        title="カレンダーに表示するメンバー"
      >
        {isSelfPrimary ? '👥 表示するメンバー' : `👤 ${surnameOf(primaryUser?.display_name)}さんのカレンダー`}
        {visibleUserIds.length > 0 && ` ＋${visibleUserIds.length}人`} ▾
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-lg border border-gray-300 bg-white shadow-lg">
          {searchable && (
            <div className="border-b border-gray-200 p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="名前・メールで検索"
                className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-base"
              />
            </div>
          )}

          <div className="border-b border-gray-200 px-3 py-2">
            <div className="mb-1 text-[11px] font-semibold text-[var(--color-text-sub)]">
              {isSelfPrimary ? 'マイカレンダー' : '開いているカレンダー'}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked
                disabled
                aria-label="開いているカレンダーは常に表示"
                className="h-4 w-4 shrink-0"
                style={{ accentColor: colorOf(primaryUserId).base }}
              />
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(primaryUserId).base }} />
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold">
                {primaryUser?.display_name ?? 'あなた'}{isSelfPrimary ? '（自分）' : ''}
              </span>
              {!isSelfPrimary && meId != null && (
                <button
                  type="button"
                  onClick={() => onOpenUser(meId)}
                  className="shrink-0 rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-sub)] hover:bg-gray-50"
                >
                  自分に戻す
                </button>
              )}
            </div>
          </div>

          <div className="px-3 pt-2 text-[11px] font-semibold text-[var(--color-text-sub)]">ほかのメンバー</div>
          <div className="max-h-60 overflow-y-auto px-1 py-1">
            {others.map((user) => {
              const color = colorOf(user.id)
              const checked = visibleUserIds.includes(user.id)
              return (
                <div key={user.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleVisible(user.id)}
                    aria-label={`${user.display_name}をカレンダーに表示`}
                    className="h-4 w-4 shrink-0"
                    style={{ accentColor: color.base }}
                  />
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color.base }} />
                  <label className="min-w-0 flex-1 cursor-pointer" onClick={() => onToggleVisible(user.id)}>
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm">{user.display_name}</span>
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[var(--color-text-sub)]">{user.email}</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => { onOpenUser(user.id); setOpen(false) }}
                    className="shrink-0 rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-sub)] hover:bg-gray-50"
                    title={`${user.display_name}のカレンダーを開いて勤怠を編集する`}
                  >
                    開く
                  </button>
                </div>
              )
            })}
            {others.length === 0 && (
              <div className="px-2 py-2 text-sm text-[var(--color-text-sub)]">該当なし</div>
            )}
          </div>

          <div className="border-t border-gray-200 px-3 py-2 text-[11px] leading-relaxed text-[var(--color-text-sub)]">
            チェック＝カレンダーに重ねて表示。<br />
            開く＝その人のカレンダーに切り替えて勤怠を編集する。
          </div>
        </div>
      )}
    </div>
  )
}
