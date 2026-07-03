import type { ReactNode } from 'react'

// 請求書/立替金の「新規作成」「編集」モーダルで共通利用するフォーム部品。
// 両モーダルのレイアウト・スタイルを揃えるために、ラベル付きフィールドをここに集約する。

// 入力要素（input / select / textarea）共通のクラス
export const fieldInputCls =
  'w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm'

// ラベル + 任意の補足説明でフィールドを囲むラッパー。
export function LabeledField({
  label,
  hint,
  className = '',
  children,
}: {
  label: string
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <label className={`block ${className}`}>
      <div className="text-[11px] font-semibold mb-0.5">{label}</div>
      {children}
      {hint && <div className="text-[10px] text-[var(--color-text-sub)] mt-0.5">{hint}</div>}
    </label>
  )
}
