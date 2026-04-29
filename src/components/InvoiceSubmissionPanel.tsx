import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { fetchExportBlob } from './FolderSaveButtons'

type SubmissionKind = 'invoice' | 'expense'

type ItemRow = {
  label: string
  qty: number
  unit: string
  unit_price: number
  amount: number
}

type Submission = {
  id: number
  user_id: number
  user_display_name: string
  year: number
  month: number
  year_month: string
  category: string
  kind: SubmissionKind
  status: 'pending' | 'approved' | 'rejected'
  submitted_at: string | null
  reviewed_at: string | null
  reviewer_id: number | null
  reviewer_display_name: string | null
  note: string | null
  total_override: number | null
  item_label_override: string | null
  subject_override: string | null
  application_date_override: string | null
  items_override: ItemRow[] | null
  default_total: number | null
  default_item_label: string | null
  default_subject: string | null
  default_items: ItemRow[] | null
  default_application_date: string | null
}

type Props = {
  isAdmin: boolean
  isOsumi: boolean
  year: number
  month: number
  category: string
  kind: SubmissionKind
  pdfDownloaded?: boolean
}

const KIND_LABEL: Record<SubmissionKind, string> = {
  invoice: '請求書',
  expense: '立替金',
}

const CATEGORY_LABELS: Record<string, string> = {
  wings: 'Wings',
  living: 'リビング',
  techleaders: 'テックリーダーズ',
  resystems: 'REシステムズ',
}

const pdfPathFor = (kind: SubmissionKind) => kind === 'expense' ? '/exports/expense.pdf' : '/exports/invoice.pdf'

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

type LabopForm = {
  total: string
  itemLabel: string
  subject: string
  applicationDate: string
  items: ItemRow[]
}

const emptyItem = (): ItemRow => ({ label: '', qty: 1, unit: '式', unit_price: 0, amount: 0 })

export default function InvoiceSubmissionPanel({ isAdmin, isOsumi, year, month, category, kind, pdfDownloaded = false }: Props) {
  const kindLabel = KIND_LABEL[kind]
  const [mine, setMine] = useState<Submission[]>([])
  const [pending, setPending] = useState<Submission[]>([])
  const [approved, setApproved] = useState<Submission[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // 確認モーダル（PDF プレビュー + 承認/却下）
  const [previewFor, setPreviewFor] = useState<Submission | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // ラボップ宛モーダル (invoice 限定)
  const [labopModalFor, setLabopModalFor] = useState<Submission | null>(null)
  const [labopForm, setLabopForm] = useState<LabopForm>({ total: '', itemLabel: '', subject: '', applicationDate: '', items: [] })
  const [labopSaving, setLabopSaving] = useState(false)
  const [labopMsg, setLabopMsg] = useState<string | null>(null)

  const loadAll = async () => {
    if (isAdmin) {
      const [p, a] = await Promise.all([
        api.get<Submission[]>('/invoice_submissions', { params: { status: 'pending', kind } }),
        api.get<Submission[]>('/invoice_submissions', { params: { status: 'approved', kind } }),
      ])
      setPending(p.data)
      setApproved(a.data)
    } else {
      const r = await api.get<Submission[]>('/invoice_submissions', { params: { status: 'all', kind } })
      setMine(r.data)
    }
  }

  useEffect(() => {
    loadAll().catch(() => {})
  }, [isAdmin, year, month, category, kind])

  // 大隅は申請対象外
  if (isOsumi) return null

  const myCurrent = mine.find((s) => s.year === year && s.month === month && s.category === category && s.kind === kind)

  const submit = async () => {
    setBusy(true); setMsg(null)
    try {
      await api.post('/invoice_submissions', { year, month, category, kind })
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
      if (previewFor?.id === id) closePreview()
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
      if (previewFor?.id === id) closePreview()
    } catch (e: any) {
      setMsg(`却下失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setBusy(false)
    }
  }

  // 確認モーダル: 申請者の PDF をそのまま blob 取得して iframe 表示
  const openPreview = async (s: Submission) => {
    setPreviewFor(s); setPreviewUrl(null); setPreviewLoading(true)
    try {
      const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
      const { blob } = await fetchExportBlob(pdfPathFor(s.kind), {
        month: monthParam,
        category: s.category,
        as_user_id: s.user_id,
      }, 'preview.pdf')
      setPreviewUrl(URL.createObjectURL(blob))
    } catch (e: any) {
      setMsg(`プレビュー失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setPreviewLoading(false)
    }
  }
  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null); setPreviewFor(null); setPreviewLoading(false)
  }

  // 申請者本人の PDF DL (admin 視点で as_user_id 使う)
  const downloadAsApplicant = async (s: Submission) => {
    setBusy(true); setMsg(null)
    try {
      const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
      const surname = s.user_display_name.split(/[\s　]/)[0] ?? ''
      const labelForFile = KIND_LABEL[s.kind]
      const filename = `${surname}_${labelForFile}_${s.year}年_${s.month}月分.pdf`
      const { blob, filename: fn } = await fetchExportBlob(pdfPathFor(s.kind), {
        month: monthParam,
        category: s.category,
        as_user_id: s.user_id,
      }, filename)
      downloadBlob(blob, fn)
      setMsg('ダウンロードしました')
    } catch (e: any) {
      setMsg(`DL失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setBusy(false)
    }
  }

  // ラボップ宛 DL (invoice + admin 限定。submission に保存された override が PDF に反映)
  const downloadAsLabop = async (s: Submission) => {
    setLabopSaving(true); setLabopMsg(null)
    try {
      const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
      const filename = `${s.user_display_name.split(/[\s　]/)[0] ?? ''}_請求書_${s.year}年_${s.month}月分_株式会社ラボップ.pdf`
      const { blob, filename: fn } = await fetchExportBlob('/exports/invoice.pdf', {
        month: monthParam,
        category: s.category,
        invoice_submission_id: s.id,
      }, filename)
      downloadBlob(blob, fn)
      setLabopMsg('ダウンロードしました')
    } catch (e: any) {
      setLabopMsg(`DL失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setLabopSaving(false)
    }
  }

  // ラボップモーダルを開く: override 値があれば優先、なければ default にプリセット
  const openLabopModal = (s: Submission) => {
    setLabopMsg(null)
    const baseItems: ItemRow[] = (s.items_override && s.items_override.length > 0)
      ? s.items_override
      : (s.default_items ?? [])
    setLabopForm({
      total: String(s.total_override ?? s.default_total ?? ''),
      itemLabel: s.item_label_override ?? s.default_item_label ?? '',
      subject: s.subject_override ?? s.default_subject ?? '',
      applicationDate: s.application_date_override ?? s.default_application_date ?? '',
      items: baseItems.length > 0 ? baseItems : [emptyItem()],
    })
    setLabopModalFor(s)
  }
  const closeLabopModal = () => setLabopModalFor(null)

  const saveLabop = async (s: Submission): Promise<Submission | null> => {
    setLabopSaving(true); setLabopMsg(null)
    try {
      const totalRaw = labopForm.total.replace(/[^\d]/g, '')
      const items = labopForm.items
        .filter((it) => it.label.trim() !== '' || it.amount > 0)
        .map((it) => ({
          label: it.label,
          qty: Number(it.qty) || 0,
          unit: it.unit || '式',
          unit_price: Number(it.unit_price) || 0,
          amount: Number(it.amount) || 0,
        }))
      const r = await api.patch<Submission>(`/invoice_submissions/${s.id}`, {
        total_override: totalRaw === '' ? '' : totalRaw,
        item_label_override: labopForm.itemLabel,
        subject_override: labopForm.subject,
        application_date_override: labopForm.applicationDate || '',
        items_override: items,
      })
      setLabopMsg('保存しました')
      await loadAll()
      return r.data
    } catch (e: any) {
      setLabopMsg(`保存失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
      return null
    } finally {
      setLabopSaving(false)
    }
  }

  // 明細行操作
  const updateItem = (i: number, patch: Partial<ItemRow>) => {
    setLabopForm((prev) => {
      const items = prev.items.map((it, idx) => idx === i ? { ...it, ...patch } : it)
      return { ...prev, items }
    })
  }
  const addItemRow = () => setLabopForm((prev) => ({ ...prev, items: [...prev.items, emptyItem()] }))
  const removeItemRow = (i: number) => setLabopForm((prev) => ({ ...prev, items: prev.items.filter((_, idx) => idx !== i) }))
  const itemsTotalAmount = labopForm.items.reduce((s, it) => s + (Number(it.amount) || 0), 0)

  // === 非 admin (川村など): 申請ボタン + 自分の申請ステータス ===
  if (!isAdmin) {
    const alreadySubmitted = myCurrent?.status === 'pending' || myCurrent?.status === 'approved'
    const blockedByPdf = !pdfDownloaded && !alreadySubmitted
    return (
      <div className="glass rounded-xl px-3 py-2 shadow-md flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-[var(--color-text)]">{kindLabel} 申請</div>
          <div className="text-[11px] text-[var(--color-text-sub)]">
            {year}年{month}月分（{CATEGORY_LABELS[category] ?? category}）の{kindLabel}を西野さんに申請します
          </div>
          {blockedByPdf && (
            <div className="mt-0.5 text-[11px] text-amber-600">
              先に{kindLabel} PDF をダウンロード（または保存）してください
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
            title={blockedByPdf ? `先に${kindLabel} PDF をダウンロードしてください` : undefined}
            className="rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? '送信中…' : myCurrent?.status === 'pending' ? '申請中' : myCurrent?.status === 'approved' ? '承認済' : '📤 申請する'}
          </button>
        </div>
      </div>
    )
  }

  // === admin (西野): 申請一覧 ===
  return (
    <div className="space-y-2">
      {pending.length > 0 && (
        <div className="glass rounded-xl px-3 py-2 shadow-md border border-amber-300/60 bg-amber-50/40">
          <div className="flex items-center justify-between mb-1">
            <div>
              <div className="text-xs font-semibold text-amber-700">📨 {kindLabel}の申請が届いています（{pending.length} 件）</div>
              {kind === 'invoice' && (
                <div className="text-[11px] text-[var(--color-text-sub)]">承認すると「株式会社ラボップ」宛で請求書をダウンロードできます</div>
              )}
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
                      {kindLabel}が<span className="text-fuchsia-600">{surname}さん</span>より申請されました
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--color-text-sub)]">
                      {s.year}年{s.month}月（{CATEGORY_LABELS[s.category] ?? s.category}）
                      {s.submitted_at && <span className="ml-2 text-[10px]">{new Date(s.submitted_at).toLocaleString('ja-JP')}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => openPreview(s)}
                      disabled={busy}
                      className="rounded-md border border-sky-400 bg-white px-3 py-1 text-[11px] font-semibold text-sky-600 hover:bg-sky-50 disabled:opacity-50"
                    >
                      🔍 確認
                    </button>
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
          <div className="text-xs font-semibold text-[var(--color-text)] mb-1">承認済み（{kindLabel}）</div>
          <ul className="divide-y divide-[var(--color-border)]">
            {approved.map((s) => {
              const surname = (s.user_display_name ?? '').split(/[\s　]/)[0] ?? s.user_display_name
              return (
                <li key={s.id} className="py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-semibold text-[var(--color-text)]">{s.user_display_name}</span>
                    <span className="ml-2 text-[var(--color-text-sub)]">{s.year}年{s.month}月（{CATEGORY_LABELS[s.category] ?? s.category}）</span>
                    {s.reviewed_at && <span className="ml-2 text-[10px] text-[var(--color-text-sub)]">承認: {new Date(s.reviewed_at).toLocaleString('ja-JP')}</span>}
                    {s.kind === 'invoice' && s.total_override != null && (
                      <span className="ml-2 text-[10px] text-sky-600">ラボップ向け ¥{s.total_override.toLocaleString()} 設定済</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openPreview(s)}
                      disabled={busy}
                      className="rounded-md border border-sky-400 bg-white px-3 py-1 text-[11px] font-semibold text-sky-600 hover:bg-sky-50 disabled:opacity-50"
                    >
                      🔍 確認
                    </button>
                    <button
                      onClick={() => downloadAsApplicant(s)}
                      disabled={busy}
                      className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 text-[11px] font-semibold text-[var(--color-text)] hover:bg-gray-50 disabled:opacity-50"
                      title={`${surname}さん本人の${kindLabel}（オリジナル）`}
                    >
                      📥 {surname}さんの{kindLabel}
                    </button>
                    {s.kind === 'invoice' && (
                      <button
                        onClick={() => openLabopModal(s)}
                        disabled={busy}
                        className="rounded-md bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-1 text-[11px] font-semibold text-white shadow disabled:opacity-50"
                      >
                        📥 ラボップ宛
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* === 確認モーダル (PDF プレビュー + 承認/却下) === */}
      {previewFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closePreview}>
          <div className="w-full max-w-4xl h-[85vh] rounded-xl bg-white p-3 shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-sm font-semibold text-[var(--color-text)]">🔍 申請確認: {KIND_LABEL[previewFor.kind]}</div>
                <div className="text-[11px] text-[var(--color-text-sub)]">
                  {previewFor.user_display_name} ／ {previewFor.year}年{previewFor.month}月（{CATEGORY_LABELS[previewFor.category] ?? previewFor.category}）
                </div>
              </div>
              <button onClick={closePreview} className="text-[var(--color-text-sub)] hover:text-red-500" aria-label="閉じる">✕</button>
            </div>
            <div className="flex-1 min-h-0 rounded border border-[var(--color-border)] overflow-hidden">
              {previewLoading && <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-sub)]">PDF を読み込み中…</div>}
              {!previewLoading && previewUrl && (
                <iframe src={previewUrl} className="w-full h-full" title="PDF preview" />
              )}
              {!previewLoading && !previewUrl && (
                <div className="h-full flex items-center justify-center text-sm text-red-500">PDF を取得できませんでした</div>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-[var(--color-text-sub)]">{previewFor.status === 'pending' ? '未承認' : `ステータス: ${previewFor.status}`}</span>
              <div className="flex items-center gap-2">
                <button onClick={closePreview} className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text-sub)] hover:bg-gray-50">閉じる</button>
                {previewFor.status === 'pending' && (
                  <>
                    <button onClick={() => reject(previewFor.id)} disabled={busy} className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text-sub)] hover:bg-gray-50 disabled:opacity-50">却下</button>
                    <button onClick={() => approve(previewFor.id)} disabled={busy} className="rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">✅ 承認</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* === ラボップ宛モーダル (請求書のみ): 明細・金額・件名・申請日 編集 === */}
      {labopModalFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeLabopModal}>
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-sm font-semibold text-[var(--color-text)]">📥 ラボップ宛 請求書</div>
                <div className="text-[11px] text-[var(--color-text-sub)]">
                  {labopModalFor.user_display_name} ／ {labopModalFor.year}年{labopModalFor.month}月（{CATEGORY_LABELS[labopModalFor.category] ?? labopModalFor.category}）
                </div>
              </div>
              <button onClick={closeLabopModal} className="text-[var(--color-text-sub)] hover:text-red-500" aria-label="閉じる">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <div className="text-[11px] font-semibold text-[var(--color-text)] mb-0.5">税込合計（¥）</div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={labopForm.total}
                  onChange={(e) => setLabopForm((p) => ({ ...p, total: e.target.value.replace(/[^\d]/g, '') }))}
                  className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-300"
                  placeholder={labopModalFor.default_total != null ? String(labopModalFor.default_total) : ''}
                />
                <div className="mt-0.5 text-[10px] text-[var(--color-text-sub)]">
                  空欄なら明細合計をそのまま使用 (¥{itemsTotalAmount.toLocaleString()})
                </div>
              </label>

              <label className="block">
                <div className="text-[11px] font-semibold text-[var(--color-text)] mb-0.5">申請日</div>
                <input
                  type="date"
                  value={labopForm.applicationDate}
                  onChange={(e) => setLabopForm((p) => ({ ...p, applicationDate: e.target.value }))}
                  className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </label>

              <label className="block col-span-2">
                <div className="text-[11px] font-semibold text-[var(--color-text)] mb-0.5">件名（任意）</div>
                <input
                  type="text"
                  value={labopForm.subject}
                  onChange={(e) => setLabopForm((p) => ({ ...p, subject: e.target.value }))}
                  className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  placeholder={labopModalFor.default_subject ?? ''}
                />
              </label>
            </div>

            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] font-semibold text-[var(--color-text)]">明細</div>
                <button
                  onClick={addItemRow}
                  className="rounded-md border border-[var(--color-border)] bg-white px-2 py-0.5 text-[11px] font-semibold text-[var(--color-text-sub)] hover:bg-gray-50"
                >+ 行追加</button>
              </div>
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="text-left text-[var(--color-text-sub)]">
                    <th className="py-1 pr-1 font-semibold">品番・品名</th>
                    <th className="py-1 px-1 font-semibold w-14">数量</th>
                    <th className="py-1 px-1 font-semibold w-12">単位</th>
                    <th className="py-1 px-1 font-semibold w-24">単価</th>
                    <th className="py-1 px-1 font-semibold w-24">金額</th>
                    <th className="py-1 pl-1 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {labopForm.items.map((it, i) => (
                    <tr key={i} className="border-t border-[var(--color-border)]">
                      <td className="py-1 pr-1">
                        <input
                          type="text"
                          value={it.label}
                          onChange={(e) => updateItem(i, { label: e.target.value })}
                          className="w-full rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-300"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          type="number"
                          step="0.5"
                          value={it.qty}
                          onChange={(e) => updateItem(i, { qty: Number(e.target.value) })}
                          className="w-full rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-right font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-sky-300"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          type="text"
                          value={it.unit}
                          onChange={(e) => updateItem(i, { unit: e.target.value })}
                          className="w-full rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-300"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          type="number"
                          value={it.unit_price}
                          onChange={(e) => {
                            const up = Number(e.target.value)
                            updateItem(i, { unit_price: up, amount: Math.round(up * (Number(it.qty) || 0)) })
                          }}
                          className="w-full rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-right font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-sky-300"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          type="number"
                          value={it.amount}
                          onChange={(e) => updateItem(i, { amount: Number(e.target.value) })}
                          className="w-full rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-right font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-sky-300"
                        />
                      </td>
                      <td className="py-1 pl-1 text-center">
                        <button onClick={() => removeItemRow(i)} className="text-gray-400 hover:text-red-500" title="削除">🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[var(--color-border)]">
                    <td colSpan={4} className="py-1 pr-1 text-right text-[var(--color-text-sub)]">明細合計</td>
                    <td className="py-1 px-1 text-right font-mono tabular-nums font-semibold">¥{itemsTotalAmount.toLocaleString()}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
              <div className="mt-1 text-[10px] text-[var(--color-text-sub)]">
                税込合計が空欄の時は「明細合計」を税込として 10% 内税で逆算。指定があれば「税込合計」を優先、明細はそのまま PDF に表示されます。
              </div>
            </div>

            <div className="mt-3 rounded-md bg-gray-50 px-2 py-1.5 text-[10px] text-[var(--color-text-sub)]">
              宛先: 株式会社ラボップ ／ 発行者・印鑑・振込先: 西野（自動）
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <span className={`text-[11px] ${labopMsg?.includes('失敗') ? 'text-red-500' : 'text-emerald-600'}`}>{labopMsg ?? ''}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    const updated = await saveLabop(labopModalFor)
                    if (updated) setLabopModalFor(updated)
                  }}
                  disabled={labopSaving}
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-gray-50 disabled:opacity-50"
                >
                  💾 保存
                </button>
                <button
                  onClick={async () => {
                    const updated = await saveLabop(labopModalFor)
                    if (updated) await downloadAsLabop(updated)
                  }}
                  disabled={labopSaving}
                  className="rounded-md bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50"
                >
                  📥 ダウンロード
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
