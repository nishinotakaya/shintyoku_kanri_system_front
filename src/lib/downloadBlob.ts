// Blob をブラウザのダウンロードとして保存する共通ヘルパー。
// revoke を 1 秒遅延させるのは、<a download> のクリック処理が完了する前に Blob URL を
// 失効させてダウンロードが空になる事故を避けるため。
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
