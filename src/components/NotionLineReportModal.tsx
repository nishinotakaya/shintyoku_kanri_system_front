// リビング(Notion)タスクの LINE 報告モーダル。開いたときに選択タスクの文面プレビューを取得し、
// 編集してから西野さんの LINE へ送信する。進捗カンバンとカレンダー(日詳細)の両方から使う。
import { useEffect, useState } from 'react'
import { api } from '../lib/api'

export default function NotionLineReportModal({ issueKeys, initialMessage, onClose, onSent }: {
  issueKeys: string[]
  /** 呼び出し側で組み立てた文面。渡されたときはサーバのプレビューを使わない(カレンダーの枠内編集から使う) */
  initialMessage?: string | null
  onClose: () => void
  onSent: () => void
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // モーダルは開くたびにマウントされるので、初回に1度だけプレビューを取る
  useEffect(() => {
    if (initialMessage != null) {
      setMessage(initialMessage)
      return
    }
    api.post<{ message: string }>('/notion_tasks/line_report_preview', { issue_keys: issueKeys })
      .then((r) => setMessage(r.data.message))
      .catch((e) => setError(e?.response?.data?.error ?? 'LINE報告の文面作成に失敗しました'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = async () => {
    if (!message?.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.post('/notion_tasks/line_report', { issue_keys: issueKeys, message })
      onSent()
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'LINE送信に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!busy) onClose() }}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-semibold text-slate-800">📱 LINE報告（西野さんへ送信）</div>
        <div className="mt-1 text-[11px] text-slate-500">
          開始日・終了日・進捗率は Notion の値です（前回同期から変わった項目は「修正前 → 修正後」）。文面は編集できます。
        </div>
        {message == null && !error && (
          <div className="mt-3 py-8 text-center text-xs text-slate-400">文面作成中…</div>
        )}
        {message != null && (
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={14}
            className="mt-3 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs leading-relaxed text-slate-800" />
        )}
        {error && <div className="mt-2 text-xs font-semibold text-red-600">{error}</div>}
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy}
            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">キャンセル</button>
          <button onClick={send} disabled={busy || !message?.trim()}
            className="rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow disabled:opacity-50">
            {busy ? '送信中…' : '送信'}
          </button>
        </div>
      </div>
    </div>
  )
}
