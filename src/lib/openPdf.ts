// スマホで PDF を見るための表示ヘルパー。
// iOS Safari は <iframe>/<embed> で PDF を表示すると 1 ページ目しか描画されずスクロールできないため、
// 別タブで開くのではなく SPA 内のモーダル(pdf.js でページを canvas に描画)で表示する。
// モーダル方式なので window.open のポップアップブロック対策(クリック直後にタブを確保する等)は不要になった。
import { openPdfViewer } from './pdfViewer'

// 取得済みの PDF Blob をモーダルで表示する。
export function showPdf(blob: Blob, filename: string): void {
  openPdfViewer({ blob, filename })
}
