import { useEffect, useRef, useState } from 'react'
import { getStoredDirHandle, saveDirHandle, ensureRwPermission, clearDirHandle } from '../lib/dirHandleStore'
import {
  DOC_TYPE_LABELS,
  describeFailure,
  fetchMyDocuments,
  importDocumentsToFolder,
  SAVE_ROOT_STORAGE_KEY,
  type DocType,
  type ImportProgress,
  type ImportResult,
} from '../lib/documentImport'

// 保存先フォルダのキーは FolderSaveButtons と共通。
// 単発の「フォルダ保存」も、この一括取り込みも同じフォルダを指す。
const HANDLE_KEY = SAVE_ROOT_STORAGE_KEY
const ALL_DOC_TYPES: DocType[] = ['invoice', 'expense', 'purchase_order', 'work_report']

export default function DocumentFolderSync() {
  const [folderName, setFolderName] = useState<string | null>(null)
  const [docTypes, setDocTypes] = useState<DocType[]>(ALL_DOC_TYPES)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  // busy(=progress !== null) は setProgress の直前まで await が続くため、その間の
  // 2 回目クリックを防げない。実行中かどうかは同期的にこの ref で判定する。
  const runningRef = useRef(false)

  const supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window
  const busy = progress !== null

  useEffect(() => {
    if (!supported) return
    getStoredDirHandle(HANDLE_KEY).then((handle) => setFolderName(handle?.name ?? null))
  }, [supported])

  const pickFolder = async () => {
    setMessage(null)
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' })
      await saveDirHandle(HANDLE_KEY, handle)
      setFolderName(handle.name)
      setMessage('保存先を設定しました')
    } catch (error) {
      // ユーザーがキャンセルした場合のみ無言で終える。それ以外(Chrome の system files 制約や
      // IndexedDB 書き込み失敗など)は無反応にせず画面にエラーを出す。
      if (error instanceof DOMException && error.name === 'AbortError') return
      const message = error instanceof Error ? error.message : String(error)
      setMessage(
        message.includes('system files')
          ? 'Chrome の制約でこのフォルダは使えません。Documents 配下など別の場所を選んでください'
          : `保存先を設定できませんでした: ${message}`
      )
    }
  }

  const forgetFolder = async () => {
    await clearDirHandle(HANDLE_KEY)
    setFolderName(null)
    setResult(null)
    setMessage('保存先を解除しました')
  }

  const toggleDocType = (docType: DocType) => {
    setDocTypes((prev) => (prev.includes(docType) ? prev.filter((t) => t !== docType) : [...prev, docType]))
  }

  const runImport = async () => {
    if (runningRef.current) return
    runningRef.current = true
    setMessage(null)
    setResult(null)
    try {
      const root = await getStoredDirHandle(HANDLE_KEY)
      if (!root) { setMessage('先に保存先フォルダを選択してください'); return }
      if (!(await ensureRwPermission(root))) { setMessage('フォルダへの書き込み権限が拒否されました'); return }

      setProgress({ done: 0, total: 0, current: '' })
      const documents = await fetchMyDocuments(docTypes)
      if (documents.length === 0) { setMessage('取り込む帳票がありません'); return }
      setResult(await importDocumentsToFolder(root, documents, setProgress))
    } catch (error) {
      setMessage(`取り込みに失敗しました: ${await describeFailure(error)}`)
    } finally {
      setProgress(null)
      runningRef.current = false
    }
  }

  if (!supported) {
    return (
      <div>
        <div className="text-xs text-[var(--color-text-sub)]">書類の保存先フォルダ</div>
        <div className="mt-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-xs text-[var(--color-text-sub)]">
          このブラウザはフォルダ保存に対応していません。Chrome / Edge で開いてください。
        </div>
      </div>
    )
  }

  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div>
      <div className="text-xs text-[var(--color-text-sub)]">書類の保存先フォルダ</div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={pickFolder}
          disabled={busy}
          className="rounded-xl bg-[var(--color-primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {folderName ? '📁 保存先を変更' : '📁 保存先を選択'}
        </button>
        {folderName && (
          <>
            <span className="rounded-lg bg-[var(--color-bg)] px-3 py-1.5 text-xs text-[var(--color-text)]">{folderName}</span>
            <button
              onClick={forgetFolder}
              disabled={busy}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-sub)] hover:text-[var(--color-text)] disabled:opacity-50"
            >
              解除
            </button>
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {ALL_DOC_TYPES.map((docType) => (
          <label
            key={docType}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs text-[var(--color-text)]"
          >
            <input type="checkbox" checked={docTypes.includes(docType)} onChange={() => toggleDocType(docType)} disabled={busy} />
            {DOC_TYPE_LABELS[docType]}
          </label>
        ))}
      </div>

      <button
        onClick={runImport}
        disabled={busy || !folderName || docTypes.length === 0}
        className="mt-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-xs font-semibold text-white shadow disabled:opacity-50"
      >
        {busy ? '取り込み中…' : '⬇️ 自分の書類をまとめて取り込む'}
      </button>

      {progress && progress.total > 0 && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg)]">
            <div className="h-full bg-[var(--color-primary)] transition-all" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-1 truncate text-[10px] text-[var(--color-text-sub)]">
            {progress.done} / {progress.total} — {progress.current}
          </div>
        </div>
      )}

      {result && (
        <div className="mt-3 text-xs">
          <div className="text-emerald-600">{result.saved} 件を保存しました</div>
          {result.failures.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-red-500">
              {result.failures.map((failure) => (
                <li key={failure.filename}>{failure.filename}: {failure.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {message && <div className="mt-2 text-xs text-[var(--color-text-sub)]">{message}</div>}

      <div className="mt-2 text-[10px] leading-relaxed text-[var(--color-text-sub)]">
        選んだフォルダの中に「2026年07月 / 請求書」のように月別・種別で保存します。
        取り込めるのは<span className="font-semibold">ログイン中のアカウント本人の書類だけ</span>で、他ユーザーの請求書は対象になりません。
      </div>
    </div>
  )
}
