import { useRef, useState } from 'react'
import { api } from '../lib/api'

type PreviewRow = { date: string; content: string; hours: number }

export default function ProgressImport({
  year,
  month,
  onApplied,
}: {
  year: number
  month: number
  onApplied: () => void
}) {
  const [preview, setPreview] = useState<PreviewRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const lastFile = useRef<File | null>(null)

  const mp = `${year}-${String(month).padStart(2, '0')}`

  const handleClick = () => {
    fileRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    lastFile.current = file
    setFileName(file.name)
    setBusy(true)
    setError(null)
    setPreview(null)
    setApplied(false)
    try {
      // 1. プレビュー取得
      const fd = new FormData()
      fd.append('file', file)
      fd.append('month', mp)
      const { data } = await api.post('/work_reports/import_progress', fd)
      setPreview(data.preview)

      // 2. データがあれば自動で適用
      if (data.preview?.length > 0) {
        const fd2 = new FormData()
        fd2.append('file', file)
        fd2.append('month', mp)
        fd2.append('apply', 'true')
        await api.post('/work_reports/import_progress', fd2)
        setApplied(true)
        onApplied()
      }
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Excel の読み込みに失敗しました')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const apply = async () => {
    const file = lastFile.current
    if (!preview?.length || !file) return
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('month', mp)
      fd.append('apply', 'true')
      await api.post('/work_reports/import_progress', fd)
      setApplied(true)
      onApplied()
    } catch (err: any) {
      setError(err?.response?.data?.error ?? '適用に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const totalHours = preview?.reduce((s, r) => s + r.hours, 0) ?? 0

  return (
    <div className="glass rounded-3xl p-6 shadow-md">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-[var(--color-text-sub)]">Excel 読み込み</div>
          <div className="mt-1 text-xs text-[var(--color-text-sub)]">進捗管理表(.xlsx)から AI が作業内容と工数を自動振り分け</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {/* 非表示の file input */}
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          onClick={handleClick}
          disabled={busy}
          className="rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 disabled:opacity-50"
        >
          {busy ? '🔄 AI 処理中…' : '📄 進捗管理表を選択'}
        </button>
        {fileName && (
          <span className="text-xs text-[var(--color-text-sub)]">
            {fileName}
          </span>
        )}
        {preview && !applied && (
          <span className="text-xs text-[var(--color-text-sub)]">
            → {preview.length} 日分 / 合計 {totalHours.toFixed(1)}h
          </span>
        )}
        {applied && <span className="text-xs text-emerald-600">✓ 適用完了</span>}
      </div>

      {error && <div className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-red-500">{error}</div>}

      {preview && preview.length > 0 && !applied && (
        <div className="mt-4">
          <div className="max-h-[320px] overflow-auto rounded-2xl border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 backdrop-blur">
                <tr className="text-left text-xs uppercase tracking-wider text-[var(--color-text-sub)]">
                  <th className="px-4 py-2 w-28">日付</th>
                  <th className="px-3 py-2">作業内容</th>
                  <th className="px-3 py-2 w-16 text-right">時間</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.date} className="border-t border-[var(--color-border)] hover:bg-gray-50">
                    <td className="px-4 py-2 text-[var(--color-text)]">{r.date}</td>
                    <td className="px-3 py-2 font-mono text-[var(--color-text)]">{r.content}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-text)]">{r.hours}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--color-border)] bg-gray-50">
                  <td className="px-4 py-2 font-semibold text-[var(--color-text-sub)]" colSpan={2}>合計</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-600">{totalHours.toFixed(1)}h</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <button
            type="button"
            onClick={apply}
            disabled={busy}
            className="mt-4 w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3 font-semibold text-white shadow-lg shadow-emerald-500/20 disabled:opacity-50"
          >
            {busy ? '適用中…' : `✓ ${preview.length} 日分を業務報告に適用`}
          </button>
        </div>
      )}
    </div>
  )
}
