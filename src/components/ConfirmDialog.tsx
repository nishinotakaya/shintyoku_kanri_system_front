import type { ReactNode } from 'react'

// 「〜を削除します。よろしいですか？」型の確認モーダル。
// 背景クリック/キャンセルで閉じ、確認ボタンは tone で色分け（danger=赤 / warning=琥珀）。

type Props = {
  title: string
  message: ReactNode
  confirmLabel: string
  /** 実行中に確認ボタンへ出すラベル（例: 削除中…） */
  busyLabel: string
  busy: boolean
  /** 実行中など、確認ボタンを押せなくする条件 */
  disabled?: boolean
  tone?: 'danger' | 'warning'
  onConfirm: () => void
  onClose: () => void
}

const TONE_CLASS: Record<NonNullable<Props['tone']>, string> = {
  danger: 'bg-red-500',
  warning: 'bg-amber-500',
}

export default function ConfirmDialog({
  title, message, confirmLabel, busyLabel, busy, disabled, tone = 'danger', onConfirm, onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="text-sm font-semibold text-[var(--color-text)]">{title}</div>
        <div className="text-xs text-[var(--color-text-sub)]">{message}</div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs">キャンセル</button>
          <button onClick={onConfirm} disabled={disabled ?? busy}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${TONE_CLASS[tone]}`}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
