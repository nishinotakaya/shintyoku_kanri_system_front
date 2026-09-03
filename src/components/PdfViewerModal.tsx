import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { closePdfViewer, subscribePdfViewer, type PdfViewerState } from '../lib/pdfViewer'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const MIN_ZOOM_LEVEL = 0.75
const MAX_ZOOM_LEVEL = 3.0
const DEFAULT_ZOOM_LEVEL = 1.0 // 1.0 = 「幅に合わせる」
const ZOOM_STEP = 0.25
const PAGE_GAP = 8 // px。ページ間の隙間
const PAGE_HORIZONTAL_MARGIN = 16 // px。幅に合わせる計算で左右に差し引く余白 (ページ側の px-2 と対応)

// PDF ビューアーの実体 (pdf.js 読み込み・canvas 描画)。
// PdfViewerModal はストア購読のみを担当し、表示するものが無いときはこれを一切マウントしない。
function PdfViewerDialog({ blob, filename, onClose }: { blob: Blob; filename: string; onClose: () => void }) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const pageContainerRefs = useRef<(HTMLDivElement | null)[]>([])
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const pdfDocumentRef = useRef<PDFDocumentProxy | null>(null)
  const renderTasksRef = useRef<RenderTask[]>([])
  const renderGenerationRef = useRef(0)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [pageCount, setPageCount] = useState(0)
  const [currentPageNumber, setCurrentPageNumber] = useState(1)
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM_LEVEL)
  const [containerWidth, setContainerWidth] = useState(0)

  // 共有可能な File。blob/filename が変わらない限り作り直さない。
  const shareFile = useMemo(() => new File([blob], filename, { type: 'application/pdf' }), [blob, filename])
  const canShareFile = useMemo(() => {
    try {
      return Boolean(navigator.canShare?.({ files: [shareFile] }))
    } catch {
      return false
    }
  }, [shareFile])

  // Esc で閉じる + 背後の body スクロールをロック
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  // 開いたら閉じるボタンにフォーカス
  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

  // PDF 読み込み。閉じるときは pdf.js のドキュメントを破棄する。
  // (PdfViewerDialog は表示対象の PDF ごとに key で作り直されるため、状態の初期化は
  // useState の初期値だけで済み、ここで明示的にリセットする必要はない)
  useEffect(() => {
    let cancelled = false

    blob.arrayBuffer()
      .then((arrayBuffer) => pdfjs.getDocument({ data: arrayBuffer }).promise)
      .then((pdfDocument) => {
        if (cancelled) { pdfDocument.loadingTask.destroy(); return }
        pdfDocumentRef.current = pdfDocument
        setPageCount(pdfDocument.numPages)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setLoadError(true)
        setLoading(false)
      })

    return () => {
      cancelled = true
      renderTasksRef.current.forEach((renderTask) => renderTask.cancel())
      renderTasksRef.current = []
      const pdfDocument = pdfDocumentRef.current
      pdfDocumentRef.current = null
      pdfDocument?.loadingTask.destroy()
    }
  }, [blob])

  // スクロール領域の幅を監視する (リサイズ・画面回転のたびに「幅に合わせる」を再計算するため)
  useEffect(() => {
    const containerElement = scrollContainerRef.current
    if (!containerElement) return
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setContainerWidth(entry.contentRect.width)
    })
    resizeObserver.observe(containerElement)
    setContainerWidth(containerElement.clientWidth)
    return () => resizeObserver.disconnect()
  }, [])

  // ページ描画。1 ページ目を即描画し、残りは 1 フレームずつ譲りながら順番に描画する。
  // ズーム変更・リサイズのたびに再実行され、進行中の描画はキャンセルしてから描き直す。
  useEffect(() => {
    const pdfDocument = pdfDocumentRef.current
    if (!pdfDocument || pageCount === 0 || containerWidth === 0) return

    const generation = ++renderGenerationRef.current
    const availableWidth = Math.max(containerWidth - PAGE_HORIZONTAL_MARGIN, 100)
    const outputScale = window.devicePixelRatio || 1

    const renderPage = async (pageNumber: number) => {
      if (renderGenerationRef.current !== generation) return
      const canvasElement = canvasRefs.current[pageNumber - 1]
      if (!canvasElement) return
      const page = await pdfDocument.getPage(pageNumber)
      if (renderGenerationRef.current !== generation) return
      const baseViewport = page.getViewport({ scale: 1 })
      const fitWidthScale = availableWidth / baseViewport.width
      const viewport = page.getViewport({ scale: fitWidthScale * zoomLevel })
      canvasElement.width = Math.floor(viewport.width * outputScale)
      canvasElement.height = Math.floor(viewport.height * outputScale)
      canvasElement.style.width = `${Math.floor(viewport.width)}px`
      canvasElement.style.height = `${Math.floor(viewport.height)}px`
      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined
      const renderTask = page.render({ canvas: canvasElement, viewport, transform })
      renderTasksRef.current.push(renderTask)
      try {
        await renderTask.promise
      } catch {
        // ズーム変更等で描画中にキャンセルされた場合はここに来る。無視してよい。
      }
    }

    const renderAllPages = async () => {
      await renderPage(1)
      for (let pageNumber = 2; pageNumber <= pageCount; pageNumber++) {
        if (renderGenerationRef.current !== generation) return
        await new Promise((resolve) => requestAnimationFrame(resolve))
        if (renderGenerationRef.current !== generation) return
        await renderPage(pageNumber)
      }
    }
    renderAllPages()

    return () => {
      renderGenerationRef.current += 1
      renderTasksRef.current.forEach((renderTask) => renderTask.cancel())
      renderTasksRef.current = []
    }
  }, [pageCount, zoomLevel, containerWidth])

  // 表示中ページの検出 (ヘッダの「n / 総数」表示用)
  useEffect(() => {
    const containerElement = scrollContainerRef.current
    if (!containerElement || pageCount === 0) return
    const visibleRatios = new Map<number, number>()
    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const pageNumber = Number(entry.target.getAttribute('data-page-number'))
          if (!pageNumber) return
          visibleRatios.set(pageNumber, entry.intersectionRatio)
        })
        setCurrentPageNumber((previousPageNumber) => {
          let mostVisiblePageNumber = previousPageNumber
          let highestRatio = 0
          visibleRatios.forEach((ratio, pageNumber) => {
            if (ratio > highestRatio) { highestRatio = ratio; mostVisiblePageNumber = pageNumber }
          })
          return highestRatio > 0 ? mostVisiblePageNumber : previousPageNumber
        })
      },
      { root: containerElement, threshold: [0, 0.25, 0.5, 0.75, 1] }
    )
    pageContainerRefs.current.forEach((pageElement) => {
      if (pageElement) intersectionObserver.observe(pageElement)
    })
    return () => intersectionObserver.disconnect()
  }, [pageCount])

  const zoomIn = () => setZoomLevel((previous) => Math.min(MAX_ZOOM_LEVEL, Math.round((previous + ZOOM_STEP) * 100) / 100))
  const zoomOut = () => setZoomLevel((previous) => Math.max(MIN_ZOOM_LEVEL, Math.round((previous - ZOOM_STEP) * 100) / 100))

  const downloadFile = () => {
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(objectUrl)
  }

  const handleShareOrDownload = async () => {
    if (canShareFile) {
      try {
        await navigator.share({ files: [shareFile], title: filename })
        return
      } catch (error) {
        // ユーザーがシートをキャンセルした場合は何もしない。それ以外の失敗はダウンロードに落とす。
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    downloadFile()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={filename}
        onClick={(event) => event.stopPropagation()}
        className="flex h-[100dvh] w-full flex-col bg-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] shadow-2xl sm:h-[92vh] sm:w-[min(960px,96vw)] sm:rounded-2xl sm:p-0"
      >
        <header className="flex flex-none items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold text-[var(--color-text)] sm:text-lg">{filename}</div>
            {pageCount > 0 && (
              <div className="text-xs text-[var(--color-text-sub)]">{currentPageNumber} / {pageCount}</div>
            )}
          </div>
          <div className="flex flex-none items-center gap-1.5">
            <button
              type="button"
              onClick={zoomOut}
              disabled={zoomLevel <= MIN_ZOOM_LEVEL}
              aria-label="縮小"
              className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--color-border)] text-lg font-semibold text-[var(--color-text)] disabled:opacity-40"
            >
              −
            </button>
            <button
              type="button"
              onClick={zoomIn}
              disabled={zoomLevel >= MAX_ZOOM_LEVEL}
              aria-label="拡大"
              className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--color-border)] text-lg font-semibold text-[var(--color-text)] disabled:opacity-40"
            >
              ＋
            </button>
            <button
              type="button"
              onClick={handleShareOrDownload}
              className="flex h-11 items-center justify-center whitespace-nowrap rounded-md border border-[var(--color-border)] px-3 text-base font-semibold text-[var(--color-text)]"
            >
              {canShareFile ? '共有' : 'ダウンロード'}
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              className="flex h-11 w-11 items-center justify-center rounded-md text-xl text-[var(--color-text-sub)] hover:bg-gray-100"
            >
              ✕
            </button>
          </div>
        </header>

        <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto bg-gray-100">
          {loading && (
            <div className="flex h-full items-center justify-center">
              <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-sky-500" />
            </div>
          )}
          {!loading && loadError && (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
              <div className="text-sm text-red-500">PDF を表示できませんでした</div>
              <button
                type="button"
                onClick={downloadFile}
                className="rounded-md bg-gradient-to-r from-sky-500 to-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow"
              >
                ダウンロード
              </button>
            </div>
          )}
          {!loading && !loadError && (
            <div className="flex flex-col items-center px-2 py-2" style={{ gap: `${PAGE_GAP}px` }}>
              {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                <div
                  key={pageNumber}
                  data-page-number={pageNumber}
                  ref={(element) => { pageContainerRefs.current[pageNumber - 1] = element }}
                  className="bg-white shadow"
                >
                  <canvas className="block" ref={(element) => { canvasRefs.current[pageNumber - 1] = element }} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// 取得中(blob 未着)のローディング表示。モーダルの枠は本体と同じで、✕ や背景クリックで中断できる。
function PdfViewerLoadingDialog({ filename, onClose }: { filename: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={filename}
        onClick={(event) => event.stopPropagation()}
        className="flex h-[100dvh] w-full flex-col bg-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl sm:h-[92vh] sm:w-[min(960px,96vw)] sm:rounded-2xl"
      >
        <header className="flex flex-none items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <div className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-base font-semibold text-[var(--color-text)] sm:text-lg">{filename}</div>
          <button type="button" onClick={onClose} aria-label="閉じる"
            className="flex h-11 w-11 flex-none items-center justify-center rounded-md text-xl text-[var(--color-text-sub)] hover:bg-gray-100">✕</button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-gray-100">
          <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-sky-500" />
          <div className="text-sm text-[var(--color-text-sub)]">PDF を確認中…</div>
        </div>
      </div>
    </div>
  )
}

// ストアを購読して描画するホスト。src/main.tsx のルートに 1 回だけマウントする。
export default function PdfViewerModal() {
  const [state, setState] = useState<PdfViewerState>(null)

  useEffect(() => subscribePdfViewer(setState), [])

  if (!state) return null
  if (!state.blob) return <PdfViewerLoadingDialog filename={state.filename} onClose={closePdfViewer} />
  return <PdfViewerDialog key={state.viewId} blob={state.blob} filename={state.filename} onClose={closePdfViewer} />
}
