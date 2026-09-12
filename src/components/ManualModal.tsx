import { useEffect } from 'react'

export type ManualDocument = {
  title: string
  /** モーダル内に表示する Web 版(public/manuals/*.html)。スマホでも読めるレスポンシブ版 */
  htmlUrl: string
  /** 右上のダウンロードで落とす印刷用PDF */
  pdfUrl: string
  /** 保存されるときのファイル名 */
  pdfFileName: string
}

type Props = ManualDocument & { onClose: () => void }

/** ヘッダーの「📘 マニュアル」から開く操作手順書ビューア。スマホは全画面、PCは中央の大きめパネル。 */
export default function ManualModal({ title, htmlUrl, pdfUrl, pdfFileName, onClose }: Props) {
  // 背面のスクロールを止める + Esc で閉じる
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 sm:items-center sm:p-4">
      <div className="flex h-full w-full flex-col overflow-hidden bg-white shadow-xl sm:h-[90vh] sm:max-w-4xl sm:rounded-xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 sm:px-4 sm:py-2.5">
          <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--color-text)] sm:text-sm">
            📘 {title}
          </div>
          <a
            href={pdfUrl}
            download={pdfFileName}
            title="PDFをダウンロード"
            className="whitespace-nowrap rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text-sub)] hover:bg-[var(--color-bg)]"
          >
            ⬇<span className="hidden sm:inline"> ダウンロード</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-sub)] hover:bg-[var(--color-bg)]"
          >
            ✕
          </button>
        </div>
        <iframe src={htmlUrl} title={title} className="w-full min-h-0 flex-1 border-0" />
      </div>
    </div>
  )
}
