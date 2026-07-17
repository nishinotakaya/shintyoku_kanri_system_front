// mdファイルダウンロードの共通処理(カンペ台本・マインドマップQ&Aツリーの書き出しで共用)

// ファイル名に使えない文字(/ \ : * ? " < > |)を_に置換する
export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_')
}

// markdown文字列をブラウザからファイルとしてダウンロードする
export function downloadMarkdownFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
