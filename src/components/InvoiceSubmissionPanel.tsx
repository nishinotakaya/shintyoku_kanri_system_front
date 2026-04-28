import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { fetchExportBlob } from './FolderSaveButtons'

type Submission = {
  id: number
  user_id: number
  user_display_name: string
  year: number
  month: number
  year_month: string
  category: string
  status: 'pending' | 'approved' | 'rejected'
  submitted_at: string | null
  reviewed_at: string | null
  reviewer_id: number | null
  reviewer_display_name: string | null
  note: string | null
}

type Props = {
  isAdmin: boolean
  isOsumi: boolean
  year: number
  month: number
  category: string
  // 川村側の制御用: 該当 (年月×カテゴリ) の請求書 PDF を一度でも DL/保存したか
  pdfDownloaded?: boolean
}

const CATEGORY_LABELS: Record<string, string> = {
  wings: 'Wings',
  living: 'リビング',
  techleaders: 'テックリーダーズ',
  resystems: 'REシステムズ',
}

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function InvoiceSubmissionPanel({ isAdmin, isOsumi, year, month, category, pdfDownloaded = false }: Props) {
  const [mine, setMine] = useState<Submission[]>([])
  const [pending, setPending] = useState<Submission[]>([])
  const [approved, setApproved] = useState<Submission[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const loadAll = async () => {
    if (isAdmin) {
      const [p, a] = await Promise.all([
        api.get<Submission[]>('/invoice_submissions', { params: { status: 'pending' } }),
        api.get<Submission[]>('/invoice_submissions', { params: { status: 'approved' } }),
      ])
      setPending(p.data)
      setApproved(a.data)
    } else {
      const r = await api.get<Submission[]>('/invoice_submissions', { params: { status: 'all' } })
      setMine(r.data)
    }
  }

  useEffect(() => {
    loadAll().catch(() => {})
  }, [isAdmin, year, month, category])

  // 大隅は申請対象外（業務報告自体が薄い想定）
  if (isOsumi) return null

  const myCurrent = mine.find((s) => s.year === year && s.month === month && s.category === category)

  const submit = async () => {
    setBusy(true); setMsg(null)
    try {
      await api.post('/invoice_submissions', { year, month, category })
      setMsg('申請しました')
      await loadAll()
    } catch (e: any) {
      setMsg(`申請失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setBusy(false)
    }
  }

  const approve = async (id: number) => {
    setBusy(true); setMsg(null)
    try {
      await api.patch(`/invoice_submissions/${id}`, { status: 'approved' })
      setMsg('承認しました')
      await loadAll()
    } catch (e: any) {
      setMsg(`承認失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setBusy(false)
    }
  }

  const reject = async (id: number) => {
    if (!confirm('却下しますか？')) return
    setBusy(true); setMsg(null)
    try {
      await api.patch(`/invoice_submissions/${id}`, { status: 'rejected' })
      setMsg('却下しました')
      await loadAll()
    } catch (e: any) {
      setMsg(`却下失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setBusy(false)
    }
  }

  const downloadAsLabop = async (s: Submission) => {
    setBusy(true); setMsg(null)
    try {
      const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
      const filename = `${s.user_display_name.split(/[\s　]/)[0] ?? ''}_請求書_${s.year}年_${s.month}月分_株式会社ラボップ.pdf`
      const { blob, filename: fn } = await fetchExportBlob('/exports/invoice.pdf', {
        month: monthParam,
        category: s.category,
        invoice_submission_id: s.id,
      }, filename)
      downloadBlob(blob, fn)
      setMsg('ダウンロードしました')
    } catch (e: any) {
      setMsg(`DL失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setBusy(false)
    }
  }

  // === 非 admin（川村など）: 申請ボタン + 自分の申請ステータス ===
  if (!isAdmin) {
    const alreadySubmitted = myCurrent?.status === 'pending' || myCurrent?.status === 'approved'
    const blockedByPdf = !pdfDownloaded && !alreadySubmitted
    return (
      <div className="glass rounded-xl px-3 py-2 shadow-md flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-[var(--color-text)]">請求書 申請</div>
          <div className="text-[11px] text-[var(--color-text-sub)]">
            {year}年{month}月分（{CATEGORY_LABELS[category] ?? category}）を西野さんに申請します
          </div>
          {blockedByPdf && (
            <div className="mt-0.5 text-[11px] text-amber-600">
              先に請求書 PDF をダウンロード（または保存）してください
            </div>
          )}
          {myCurrent && (
            <div className="mt-0.5 text-[11px]">
              ステータス: {myCurrent.status === 'pending' && <span className="text-amber-600 font-semibold">申請中</span>}
              {myCurrent.status === 'approved' && <span className="text-emerald-600 font-semibold">✅ 承認済</span>}
              {myCurrent.status === 'rejected' && <span className="text-red-500 font-semibold">却下</span>}
              {myCurrent.reviewed_at && <span className="ml-2 text-[var(--color-text-sub)]">（{new Date(myCurrent.reviewed_at).toLocaleString('ja-JP')}）</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {msg && <span className="text-[11px] text-emerald-600">{msg}</span>}
          <button
            onClick={submit}
            disabled={busy || alreadySubmitted || blockedByPdf}
            title={blockedByPdf ? '先に請求書 PDF をダウンロードしてください' : undefined}
            className="rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? '送信中…' : myCurrent?.status === 'pending' ? '申請中' : myCurrent?.status === 'approved' ? '承認済' : '📤 申請する'}
          </button>
        </div>
      </div>
    )
  }

  // === admin（西野）: 申請一覧 ===
  return (
    <div className="space-y-2">
      {pending.length > 0 && (
        <div className="glass rounded-xl px-3 py-2 shadow-md border border-amber-300/60 bg-amber-50/40">
          <div className="flex items-center justify-between mb-1">
            <div>
              <div className="text-xs font-semibold text-amber-700">📨 請求書の申請が届いています（{pending.length} 件）</div>
              <div className="text-[11px] text-[var(--color-text-sub)]">承認すると「株式会社ラボップ」宛で請求書をダウンロードできます</div>
            </div>
            {msg && <span className="text-[11px] text-emerald-600">{msg}</span>}
          </div>
          <ul className="divide-y divide-amber-200">
            {pending.map((s) => {
              const surname = (s.user_display_name ?? '').split(/[\s　]/)[0] ?? s.user_display_name
              return (
                <li key={s.id} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                  <div>
                    <div className="font-semibold text-[var(--color-text)]">
                      請求書が<span className="text-fuchsia-600">{surname}さん</span>より申請されました
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--color-text-sub)]">
                      {s.year}年{s.month}月（{CATEGORY_LABELS[s.category] ?? s.category}）
                      {s.submitted_at && <span className="ml-2 text-[10px]">{new Date(s.submitted_at).toLocaleString('ja-JP')}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => approve(s.id)}
                      disabled={busy}
                      className="rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1 text-[11px] font-semibold text-white shadow disabled:opacity-50"
                    >
                      ✅ 承認
                    </button>
                    <button
                      onClick={() => reject(s.id)}
                      disabled={busy}
                      className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 text-[11px] font-semibold text-[var(--color-text-sub)] hover:bg-gray-50 disabled:opacity-50"
                    >
                      却下
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {approved.length > 0 && (
        <div className="glass rounded-xl px-3 py-2 shadow-md">
          <div className="text-xs font-semibold text-[var(--color-text)] mb-1">承認済み（株式会社ラボップ宛 DL 可能）</div>
          <ul className="divide-y divide-[var(--color-border)]">
            {approved.map((s) => (
              <li key={s.id} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                <div>
                  <span className="font-semibold text-[var(--color-text)]">{s.user_display_name}</span>
                  <span className="ml-2 text-[var(--color-text-sub)]">{s.year}年{s.month}月（{CATEGORY_LABELS[s.category] ?? s.category}）</span>
                  {s.reviewed_at && <span className="ml-2 text-[10px] text-[var(--color-text-sub)]">承認: {new Date(s.reviewed_at).toLocaleString('ja-JP')}</span>}
                </div>
                <button
                  onClick={() => downloadAsLabop(s)}
                  disabled={busy}
                  className="rounded-md bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-1 text-[11px] font-semibold text-white shadow disabled:opacity-50"
                >
                  📥 ラボップ宛 DL
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
