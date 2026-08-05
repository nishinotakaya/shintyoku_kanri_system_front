// ログイン中ユーザー本人の帳票を、ローカルの保存先フォルダへ月別に取り込む。
//
// 保存先の構成: <選んだフォルダ>/<YYYY年MM月>/<種別>/<ファイル名>
//   例: 請求書類/2026年07月/請求書/Wings_西野_請求書_2026年7月分.pdf
//
// 対象は必ずサーバ側 (MyDocumentManifest) が本人ぶんだけに絞って返す。
// フロントからユーザーを指定するパラメータは一切送らない。
import { api } from './api'

export type DocType = 'invoice' | 'expense' | 'purchase_order' | 'work_report'

export type MyDocument = {
  key: string
  doc_type: DocType
  label: string
  year: number | null
  month: number | null
  category: string | null
  category_label: string | null
  month_folder: string
  filename: string
  fetch: { path: string; params: Record<string, string> }
}

export type ImportProgress = { done: number; total: number; current: string }

export type ImportResult = {
  saved: number
  failures: { filename: string; reason: string }[]
}

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  invoice: '請求書',
  expense: '立替金',
  purchase_order: '注文書',
  work_report: '業務報告書',
}

// 保存先のキー ('app-save-root') は DocumentFolderSync / FolderSaveButtons で共通に使う。
// 片方をリネームすると無言でフォルダが食い違うため、定数を1つに集約する。
export const SAVE_ROOT_STORAGE_KEY = 'app-save-root'

// ファイル名に使えない文字を落とす。DB 由来のファイル名に "/" や ":" が混ざることがある。
function sanitizeName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
}

export async function fetchMyDocuments(docTypes: DocType[]): Promise<MyDocument[]> {
  const res = await api.get<MyDocument[]>('/exports/my_documents', {
    params: { doc_types: docTypes.join(',') },
  })
  return res.data
}

// 同一実行内で同名ファイル(月フォルダ/種別フォルダ/ファイル名 が一致)が来たら、
// 後勝ちで消してしまわないよう "名前 (2).拡張子" の形式で連番を振る。
// 実行をまたいだ同名上書き(再取り込みで最新版に更新)は意図的な仕様なのでここでは扱わない。
function uniqueFilename(monthFolder: string, label: string, filename: string, usedPaths: Set<string>): string {
  const dotIndex = filename.lastIndexOf('.')
  const stem = dotIndex > 0 ? filename.slice(0, dotIndex) : filename
  const ext = dotIndex > 0 ? filename.slice(dotIndex) : ''
  let candidate = filename
  for (let sequence = 2; usedPaths.has(`${monthFolder}/${label}/${candidate}`); sequence += 1) {
    candidate = `${stem} (${sequence})${ext}`
  }
  usedPaths.add(`${monthFolder}/${label}/${candidate}`)
  return candidate
}

async function writeFile(
  root: FileSystemDirectoryHandle,
  document: MyDocument,
  blob: Blob,
  usedPaths: Set<string>,
): Promise<void> {
  const monthFolder = sanitizeName(document.month_folder)
  const label = sanitizeName(document.label)
  const filename = uniqueFilename(monthFolder, label, sanitizeName(document.filename), usedPaths)
  const monthDir = await root.getDirectoryHandle(monthFolder, { create: true })
  const typeDir = await monthDir.getDirectoryHandle(label, { create: true })
  const fileHandle = await typeDir.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(blob)
  await writable.close()
}

// エラーの詳細文言を取り出す。/exports 系は responseType:'blob' を指定しているため、
// エラーレスポンスの body も Blob として渡ってくる。Blob のときは text() で読んで JSON.parse する。
export async function describeFailure(error: unknown): Promise<string> {
  const response = (error as { response?: { data?: unknown } } | undefined)?.response
  const data = response?.data
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text()) as { error?: string }
      if (parsed.error) return parsed.error
    } catch {
      // JSON でない Blob だった場合はフォールバックへ
    }
  }
  const message = (error as { message?: string } | undefined)?.message
  return message ?? '取得に失敗しました'
}

export async function importDocumentsToFolder(
  root: FileSystemDirectoryHandle,
  documents: MyDocument[],
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportResult> {
  const failures: ImportResult['failures'] = []
  let saved = 0
  const usedPaths = new Set<string>()

  for (const [index, document] of documents.entries()) {
    onProgress?.({ done: index, total: documents.length, current: document.filename })
    try {
      const res = await api.get(document.fetch.path, {
        params: document.fetch.params,
        responseType: 'blob',
      })
      await writeFile(root, document, res.data as Blob, usedPaths)
      saved += 1
    } catch (error) {
      failures.push({
        filename: document.filename,
        reason: await describeFailure(error),
      })
    }
  }

  onProgress?.({ done: documents.length, total: documents.length, current: '' })
  return { saved, failures }
}
