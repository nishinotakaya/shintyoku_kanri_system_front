import { useState, useRef, useEffect, useLayoutEffect } from 'react'

export type RowActionDlItem = {
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'default' | 'sky' | 'emerald' | 'amber' | 'fuchsia'
}

type Props = {
  onView?: () => void                    // 確認 (省略可)
  onEdit?: () => void                    // 編集 (省略可)
  onDelete?: () => void                  // 削除 (省略可)
  dlItems?: RowActionDlItem[]            // ダウンロード等のアクション。⋯ メニュー(プルダウン)にまとめる
  viewLabel?: string                     // 「確認」のラベル差替 (例: 詳細)
}

// メニュー項目の文字色 (variant ごと)
const VARIANT_TEXT: Record<NonNullable<RowActionDlItem['variant']>, string> = {
  default: 'text-[var(--color-text)]',
  sky: 'text-sky-600',
  emerald: 'text-emerald-600',
  amber: 'text-amber-600',
  fuchsia: 'text-fuchsia-600',
}

export default function RowActions({ onView, onEdit, onDelete, dlItems, viewLabel = '確認' }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const items = dlItems ?? []

  // ⋯ ボタンの位置に合わせてメニューを fixed 配置する(テーブルの overflow で切れないように)
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) })
  }, [open])

  // 外側クリック / スクロール / リサイズ で閉じる
  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const close = () => setOpen(false)
    document.addEventListener('mousedown', onDocDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <div className="inline-flex gap-1 items-center flex-wrap justify-center">
      {onView && (
        <button onClick={onView}
          className="rounded border border-sky-400 bg-white px-2 py-0.5 text-[11px] text-sky-600 hover:bg-sky-50">
          {viewLabel}
        </button>
      )}
      {onEdit && (
        <button onClick={onEdit}
          className="rounded border border-fuchsia-400 bg-white px-2 py-0.5 text-[11px] text-fuchsia-600 hover:bg-fuchsia-50">
          編集
        </button>
      )}
      {onDelete && (
        <button onClick={onDelete}
          className="rounded border border-red-300 bg-white px-2 py-0.5 text-[11px] text-red-500 hover:bg-red-50">
          削除
        </button>
      )}

      {items.length > 0 && (
        <>
          <button ref={btnRef} onClick={() => setOpen((o) => !o)}
            aria-haspopup="menu" aria-expanded={open} title="ダウンロード / 出力"
            className={`rounded border px-2 py-0.5 text-[13px] leading-none font-bold ${open ? 'border-sky-400 bg-sky-50 text-sky-600' : 'border-[var(--color-border)] bg-white text-[var(--color-text-sub)] hover:bg-gray-50'}`}>
            ⋯
          </button>
          {open && pos && (
            <div ref={menuRef} role="menu"
              style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 50 }}
              className="min-w-[200px] overflow-hidden rounded-lg border border-[var(--color-border)] bg-white py-1 shadow-xl">
              <div className="px-3 pb-1 pt-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-text-sub)]">
                ダウンロード
              </div>
              {items.map((item, i) => (
                <button key={i} role="menuitem"
                  onClick={() => { setOpen(false); item.onClick() }}
                  disabled={item.disabled}
                  className={`block w-full whitespace-nowrap px-3 py-1.5 text-left text-[11px] hover:bg-gray-50 disabled:opacity-50 ${VARIANT_TEXT[item.variant ?? 'default']}`}>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
