// スマホで PDF を見るため、ダウンロードではなく別タブで開く。
// iOS Safari は await の後に呼んだ window.open をポップアップとして塞ぐので、
// クリック直後(同期)に空タブを開いておき、取得後に blob URL を流し込む。
// タブを開けなかった(ブロック/Capacitor 等)ときは従来どおりダウンロードに落とす。

// クリックハンドラの先頭で同期的に呼ぶ。空タブを確保し、読み込み中の簡易画面を出しておく
// (別タブが真っ白なままだと不安になるため)。ブロックされていたら null を返す。
export function openPdfWindow(): Window | null {
  const pdfWindow = window.open('', '_blank')
  if (!pdfWindow) return null
  pdfWindow.document.write(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>読み込み中…</title>
<style>
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    margin: 0;
    font-family: sans-serif;
    color: #666;
  }
</style>
</head>
<body>読み込み中…</body>
</html>`)
  pdfWindow.document.close()
  return pdfWindow
}

// openPdfWindow() で確保しておいたタブに、取得した PDF を流し込んで表示する。
// タブを確保できていなかった(ブロック/Capacitor 等)場合は、従来どおりダウンロードにフォールバックする。
export function showPdf(pdfWindow: Window | null, blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
  if (pdfWindow) {
    // 別タブが読み込み終える前に無効化されてしまうため、ここでは revoke しない
    pdfWindow.location.href = objectUrl
    return
  }
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
}
