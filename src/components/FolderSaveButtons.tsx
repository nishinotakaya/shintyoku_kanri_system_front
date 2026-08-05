import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { getStoredDirHandle, saveDirHandle, ensureRwPermission, clearDirHandle } from '../lib/dirHandleStore'
import { SAVE_ROOT_STORAGE_KEY } from '../lib/documentImport'

// 全セクション共通の「フォルダ保存」3ボタン群。
// IndexedDB のキーを統一しているので、どこから保存先を選んでも他セクションでも記憶される。
// fetchSpec(): API から取得する Blob と保存ファイル名・月フォルダ名を返す
const HANDLE_KEY = SAVE_ROOT_STORAGE_KEY

type FetchSpec = {
  blob: Blob
  filename: string
  monthFolderName: string
}

type Props = {
  label?: string
  monthFolderName: string
  // ファイルを取得する処理（API レスポンス→ blob + filename）
  fetchSpec: () => Promise<FetchSpec>
  // ダウンロード用（save_local 不可な単純 blob 取得）— 省略時は fetchSpec を使う
  fetchDownload?: () => Promise<{ blob: Blob; filename: string }>
  // 保存/DL 成功時に呼ばれる（呼び出し側で「DL済」フラグ管理に使う）
  onDownloaded?: () => void
  // ボタン群の下に出す注意書き（例: これはファイル保存であり一覧登録ではない、等）
  hint?: string
}

export default function FolderSaveButtons({ label, monthFolderName, fetchSpec, fetchDownload, onDownloaded, hint }: Props) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [lastSavedTo, setLastSavedTo] = useState<string | null>(null)
  const [savedDirName, setSavedDirName] = useState<string | null>(null)

  const fsaSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window

  useEffect(() => {
    if (!fsaSupported) return
    getStoredDirHandle(HANDLE_KEY).then((h) => { if (h) setSavedDirName(h.name) })
  }, [fsaSupported])

  const writeTo = async (dirHandle: FileSystemDirectoryHandle): Promise<string> => {
    const spec = await fetchSpec()
    const monthDir = await dirHandle.getDirectoryHandle(spec.monthFolderName, { create: true })
    const fh = await monthDir.getFileHandle(spec.filename, { create: true })
    const w = await fh.createWritable()
    await w.write(spec.blob)
    await w.close()
    return `${dirHandle.name}/${spec.monthFolderName}/${spec.filename}`
  }

  const saveToRemembered = async () => {
    if (busy) return
    setBusy(true); setMsg(null)
    try {
      const stored = await getStoredDirHandle(HANDLE_KEY)
      if (!stored) { setMsg('保存先が未設定です'); return }
      if (!(await ensureRwPermission(stored))) { setMsg('書き込み権限が拒否されました'); return }
      const where = await writeTo(stored)
      setLastSavedTo(where); setMsg('保存しました')
      onDownloaded?.()
    } catch (e: any) {
      setMsg(`保存失敗: ${e?.message ?? ''}`)
    } finally { setBusy(false) }
  }

  const pickAndSave = async () => {
    if (busy) return
    if (!fsaSupported) { setMsg('お使いのブラウザはフォルダ選択 API 非対応（Chrome/Edge/Brave）'); return }
    setBusy(true); setMsg(null)
    try {
      const win = window as unknown as { showDirectoryPicker: (opts?: any) => Promise<FileSystemDirectoryHandle> }
      const dirHandle = await win.showDirectoryPicker({ mode: 'readwrite' })
      await saveDirHandle(HANDLE_KEY, dirHandle)
      setSavedDirName(dirHandle.name)
      const where = await writeTo(dirHandle)
      setLastSavedTo(where); setMsg('保存しました')
      onDownloaded?.()
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setMsg('キャンセルしました')
      } else if (typeof e?.message === 'string' && e.message.includes('system files')) {
        setMsg('Chrome の制約でこのフォルダは使えません。Documents 配下など別の場所を選んでください')
      } else {
        setMsg(`保存失敗: ${e?.message ?? ''}`)
      }
    } finally { setBusy(false) }
  }

  const download = async () => {
    if (busy) return
    setBusy(true); setMsg(null)
    try {
      const { blob, filename } = fetchDownload ? await fetchDownload() : await fetchSpec()

      // showSaveFilePicker が使えるなら、ダイアログ経由で同名上書き対応
      const win = window as unknown as { showSaveFilePicker?: (opts?: any) => Promise<FileSystemFileHandle> }
      if (win.showSaveFilePicker) {
        try {
          const ext = (filename.split('.').pop() ?? '').toLowerCase()
          const accept: Record<string, string[]> = {}
          if (ext === 'pdf') accept['application/pdf'] = ['.pdf']
          else if (ext === 'xlsx') accept['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] = ['.xlsx']
          else accept['application/octet-stream'] = ['.' + ext]
          const handle = await win.showSaveFilePicker({
            suggestedName: filename,
            startIn: 'downloads',
            types: [{ description: 'File', accept }],
          })
          const writable = await handle.createWritable()
          await writable.write(blob)
          await writable.close()
          setLastSavedTo(`(picker) ${(handle as any).name ?? filename}`)
          setMsg('保存しました（同名は上書き）')
          onDownloaded?.()
          return
        } catch (e: any) {
          if (e?.name === 'AbortError') { setMsg('キャンセルしました'); return }
          // 失敗したらレガシーダウンロードへフォールバック
        }
      }

      // フォールバック: ブラウザ既定ダウンロード（重複時は (1) 等にリネーム）
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      setLastSavedTo(`Downloads/${filename}`); setMsg('ダウンロードしました')
      onDownloaded?.()
    } catch (e: any) {
      setMsg(`失敗: ${e?.message ?? ''}`)
    } finally { setBusy(false) }
  }

  const forget = async () => {
    await clearDirHandle(HANDLE_KEY)
    setSavedDirName(null)
    setMsg('保存先を解除しました')
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        {savedDirName && (
          <button
            onClick={saveToRemembered}
            disabled={busy}
            className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap text-white shadow disabled:opacity-50"
            title={`記憶済み: ${savedDirName}/${monthFolderName}/`}
          >
            {busy ? '保存中…' : `📁 ${savedDirName}/${monthFolderName} に${label ?? ''}保存`}
          </button>
        )}
        <button
          onClick={pickAndSave}
          disabled={busy}
          className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap shadow disabled:opacity-50 ${
            savedDirName ? 'bg-white border border-[var(--color-border)] text-[var(--color-text-sub)] hover:bg-gray-50' : 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white'
          }`}
          title="フォルダ選択ダイアログを開く"
        >
          {savedDirName ? '📂 フォルダを変更' : `📂 フォルダを選んで${label ?? ''}保存`}
        </button>
        <button
          onClick={download}
          disabled={busy}
          className="rounded-lg bg-white border border-[var(--color-border)] px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap text-[var(--color-text-sub)] hover:bg-gray-50 disabled:opacity-50"
          title="ブラウザの既定ダウンロード先に保存"
        >
          📥 ダウンロード
        </button>
      </div>
      {savedDirName && (
        <button onClick={forget} className="text-[10px] text-[var(--color-text-sub)] hover:text-red-500">
          記憶済み保存先を解除
        </button>
      )}
      {hint && (
        <div className="max-w-[420px] text-right text-[10px] text-amber-600">{hint}</div>
      )}
      {(lastSavedTo || msg) && (
        <div className="max-w-[420px] text-right text-[10px] text-[var(--color-text-sub)] break-all">
          {msg && <div className={msg.startsWith('保存しました') || msg.startsWith('ダウンロードしました') ? 'text-emerald-600' : 'text-red-500'}>{msg}</div>}
          {lastSavedTo && <div className="font-mono">{lastSavedTo}</div>}
        </div>
      )}
    </div>
  )
}

// 共通ヘルパ: API から blob + filename を取得（Content-Disposition 解析）
export async function fetchExportBlob(path: string, params: Record<string, any>, fallbackFilename: string): Promise<{ blob: Blob; filename: string }> {
  const res = await api.get(path, { params, responseType: 'blob' })
  const cd = res.headers?.['content-disposition'] as string | undefined
  let filename = fallbackFilename
  if (cd) {
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i)
    if (m) filename = decodeURIComponent(m[1])
  }
  return { blob: res.data as Blob, filename }
}
