// スマホで PDF を見るための表示ヘルパー。
// iOS Safari は <iframe>/<embed> で PDF を表示すると 1 ページ目しか描画されずスクロールできないため、
// 別タブで開くのではなく SPA 内のモーダル(pdf.js でページを canvas に描画)で表示する。
// モーダル方式なので window.open のポップアップブロック対策(クリック直後にタブを確保する等)は不要になった。
import { failPdfViewer, openPdfViewer, openPdfViewerLoading, resolvePdfViewer } from './pdfViewer'

// 取得済みの PDF Blob をモーダルで表示する。
export function showPdf(blob: Blob, filename: string): void {
  openPdfViewer({ blob, filename })
}

// サーバ側の PDF 生成が遅いケース用。先にモーダルを開いて「確認中…」を出し、
// 取得できたら差し替える。ユーザーが途中で閉じたら結果は捨てる。失敗は throw(呼び元で通知)。
export async function showPdfWhileLoading(filename: string, fetcher: () => Promise<Blob>): Promise<void> {
  const viewId = openPdfViewerLoading(filename)
  try {
    const blob = await fetcher()
    resolvePdfViewer(viewId, blob)
  } catch (error) {
    failPdfViewer(viewId)
    throw error
  }
}
