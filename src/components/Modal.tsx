import type { ReactNode } from 'react'

type ModalSize = 'sm' | 'md' | 'lg'

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-md',     // 確認・1〜2項目
  md: 'max-w-3xl',    // メール / 編集 / 詳細表示 (デフォルト)
  lg: 'max-w-5xl',    // PDFプレビュー・大量データ
}

type Props = {
  onClose: () => void
  size?: ModalSize
  /** 内側パネルに足したいクラス (例: rounded-2xl, p-5, glass 等) */
  panelClassName?: string
  /** 内側パネルの max-h を上書き (デフォルト max-h-[90vh]) */
  maxHeight?: string
  /** 背景クリックで閉じるかどうか。デフォルト false (✕ ボタンでのみ閉じる) */
  closeOnBackdrop?: boolean
  children: ReactNode
}

export default function Modal({
  onClose,
  size = 'md',
  panelClassName = '',
  maxHeight = 'max-h-[90vh]',
  closeOnBackdrop = false,
  children,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        className={`w-full ${SIZE_CLASS[size]} ${maxHeight} overflow-auto rounded-xl bg-white p-4 shadow-xl ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
