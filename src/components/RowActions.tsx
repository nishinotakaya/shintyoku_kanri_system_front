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
  dlItems?: RowActionDlItem[]            // ダウンロード等のアクションを明示ボタンとして表示する
  viewLabel?: string                     // 「確認」のラベル差替 (例: 詳細)
}

// dlItems の色 (旧 ⋯ メニュー用 variant をそのまま流用)
const VARIANT_BORDER: Record<NonNullable<RowActionDlItem['variant']>, string> = {
  default: 'border-[var(--color-border)] text-[var(--color-text-sub)] hover:bg-gray-50',
  sky: 'border-sky-400 text-sky-600 hover:bg-sky-50',
  emerald: 'border-emerald-400 text-emerald-600 hover:bg-emerald-50',
  amber: 'border-amber-400 text-amber-600 hover:bg-amber-50',
  fuchsia: 'border-fuchsia-400 text-fuchsia-600 hover:bg-fuchsia-50',
}

export default function RowActions({ onView, onEdit, onDelete, dlItems, viewLabel = '確認' }: Props) {
  return (
    <div className="inline-flex gap-1 items-center flex-wrap justify-center">
      {onView && (
        <button
          onClick={onView}
          className="rounded border border-sky-400 bg-white px-2 py-0.5 text-[11px] text-sky-600 hover:bg-sky-50"
        >
          {viewLabel}
        </button>
      )}
      {onEdit && (
        <button
          onClick={onEdit}
          className="rounded border border-fuchsia-400 bg-white px-2 py-0.5 text-[11px] text-fuchsia-600 hover:bg-fuchsia-50"
        >
          編集
        </button>
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          className="rounded border border-red-300 bg-white px-2 py-0.5 text-[11px] text-red-500 hover:bg-red-50"
        >
          削除
        </button>
      )}
      {dlItems?.map((item, i) => (
        <button
          key={i}
          onClick={item.onClick}
          disabled={item.disabled}
          title={item.label}
          className={`rounded border bg-white px-2 py-0.5 text-[11px] disabled:opacity-50 ${VARIANT_BORDER[item.variant ?? 'default']}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
