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

async function writeFile(
  root: FileSystemDirectoryHandle,
  document: MyDocument,
  blob: Blob,
): Promise<void> {
  const monthDir = await root.getDirectoryHandle(sanitizeName(document.month_folder), { create: true })
  const typeDir = await monthDir.getDirectoryHandle(sanitizeName(document.label), { create: true })
  const fileHandle = await typeDir.getFileHandle(sanitizeName(document.filename), { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(blob)
  await writable.close()
}

export async function importDocumentsToFolder(
  root: FileSystemDirectoryHandle,
  documents: MyDocument[],
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportResult> {
  const failures: ImportResult['failures'] = []
  let saved = 0

  for (const [index, document] of documents.entries()) {
    onProgress?.({ done: index, total: documents.length, current: document.filename })
    try {
      const res = await api.get(document.fetch.path, {
        params: document.fetch.params,
        responseType: 'blob',
      })
      await writeFile(root, document, res.data as Blob)
      saved += 1
    } catch (e: any) {
      failures.push({
        filename: document.filename,
        reason: e?.response?.data?.error ?? e?.message ?? '取得に失敗しました',
      })
    }
  }

  onProgress?.({ done: documents.length, total: documents.length, current: '' })
  return { saved, failures }
}
