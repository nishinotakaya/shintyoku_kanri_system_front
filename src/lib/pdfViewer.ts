// PDF をアプリ内モーダルで表示するための小さな状態ストア。
// クリックハンドラなど React の外からも openPdfViewer()/closePdfViewer() を直接呼べるように、
// Context ではなくモジュールスコープの pub/sub にしている。
// src/main.tsx にマウントされる PdfViewerModal が subscribePdfViewer() で購読して描画する。

// viewId: 開くたびに採番する連番。PdfViewerModal 側で React の key に使い、
// PDF を差し替えたときに前の描画状態(ページ数・ズーム等)を引きずらず必ず作り直させるため。
// blob が null の間は「PDFを確認中…」のローディング表示(生成が遅くてもモーダルを先に出す)
export type PdfViewerState = { blob: Blob | null; filename: string; viewId: number } | null

type PdfViewerListener = (state: PdfViewerState) => void

let currentState: PdfViewerState = null
let nextViewId = 1
const listeners = new Set<PdfViewerListener>()

// PDF モーダルを開く。既に開いている場合は表示中の PDF を差し替える。
export function openPdfViewer(state: { blob: Blob; filename: string }): void {
  currentState = { ...state, viewId: nextViewId++ }
  listeners.forEach((listener) => listener(currentState))
}

// モーダルを先に開いてローディング表示にする。戻り値の viewId を resolve/fail に渡す。
export function openPdfViewerLoading(filename: string): number {
  currentState = { blob: null, filename, viewId: nextViewId++ }
  listeners.forEach((listener) => listener(currentState))
  return currentState.viewId
}

// 取得完了。ユーザーが既に閉じた/別の PDF を開いた後なら何もしない。
export function resolvePdfViewer(viewId: number, blob: Blob): void {
  if (currentState?.viewId !== viewId) return
  currentState = { ...currentState, blob }
  listeners.forEach((listener) => listener(currentState))
}

// 取得失敗。ローディング中のモーダルが出たままなら閉じる。
export function failPdfViewer(viewId: number): void {
  if (currentState?.viewId !== viewId) return
  closePdfViewer()
}

// PDF モーダルを閉じる。
export function closePdfViewer(): void {
  currentState = null
  listeners.forEach((listener) => listener(currentState))
}

// 表示状態の変更を購読する。購読開始時に現在の状態を即座に通知する。
// 戻り値の関数を呼ぶと購読解除する。
export function subscribePdfViewer(listener: PdfViewerListener): () => void {
  listeners.add(listener)
  listener(currentState)
  return () => { listeners.delete(listener) }
}
